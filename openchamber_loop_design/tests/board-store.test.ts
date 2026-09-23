import { expect, test } from "bun:test";

import { assertStorageValueSize, createBoardStore } from "../src/board-store";
import { cardKey, projectKey } from "../src/schema";
import { createMemoryStorage } from "./support/fake-host";

test("stores each card independently from the per-project settings", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", {
    title: "Implement command palette",
    prompt: "Implement the command palette and tests.",
  });

  expect(await storage.get(await projectKey("project-a"))).toEqual(
    expect.objectContaining({ projectId: "project-a", concurrencyLimit: 3 }),
  );
  expect(await storage.get(`openchamber-loop-kanba/v1/card/${card.id}`)).toEqual(
    expect.objectContaining({ id: card.id, projectId: "project-a" }),
  );
});

test("hashes an arbitrarily long Host project ID into a valid storage key", async () => {
  const key = await projectKey("p".repeat(10_000));

  expect(key.length).toBeLessThanOrEqual(128);
});

test("does not infer or permit an invalid status transition", async () => {
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await expect(store.moveCard(card.id, "done", "session-summary")).rejects.toThrow(
    "Only explicit user actions may move a card",
  );
});

test("reload restores the four canonical columns", async () => {
  const storage = createMemoryStorage();
  const first = createBoardStore(storage);
  await first.createProject("project-a", 3);
  const card = await first.createCard("project-a", { title: "T", prompt: "P" });
  await first.moveCard(card.id, "in_progress", "user");

  const second = createBoardStore(storage);
  expect((await second.loadBoard("project-a")).in_progress.map(({ id }) => id)).toEqual([card.id]);
});

test("rejects a serialized value that would exceed one Host storage value", () => {
  expect(() => assertStorageValueSize({ payload: "x".repeat(70 * 1024) })).toThrow(
    "Storage value exceeds 64 KiB",
  );
});

test("does not claim a card was saved when the single-key Host write fails", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 3);
  storage.failNextSet(new Error("quota exceeded"));

  await expect(store.createCard("project-a", { title: "T", prompt: "P" })).rejects.toThrow(
    "quota exceeded",
  );
  expect((await store.loadBoard("project-a")).todo).toEqual([]);
});

test("does not apply a stale session result over a later pending request", async () => {
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-a" });
  await store.recordSkippedSessionStart(card.id, { role: "main", requestId: "request-a" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-b" });

  await expect(store.completeSessionStart(card.id, {
    role: "main",
    requestId: "request-a",
    sessionId: "main-a",
    linked: true,
    targetStatus: "in_progress",
  })).rejects.toThrow("No matching pending session start");
  expect((await store.getCard(card.id)).pendingRequestId).toBe("request-b");
});

test("rejects a foreign namespaced card record instead of injecting it into a board", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await storage.set(cardKey("foreign-card"), { ...card, id: "foreign-card", title: "Injected" });

  await expect(store.loadBoard("project-a")).rejects.toThrow("Invalid board card storage value");
});

test("rejects a corrupt namespaced card record", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 1);
  await storage.set(cardKey(crypto.randomUUID()), { schema: "openchamber-loop-kanba/v1" });

  await expect(store.loadBoard("project-a")).rejects.toThrow("Invalid board card storage value");
});

test("filters other projects and sorts cards by their stored positions", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 1);
  await store.createProject("project-b", 1);
  const later = await store.createCard("project-a", { title: "Later", prompt: "P" });
  const earlier = await store.createCard("project-a", { title: "Earlier", prompt: "P" });
  await store.createCard("project-b", { title: "Other project", prompt: "P" });
  await storage.set(cardKey(later.id), { ...later, position: 9 });
  await storage.set(cardKey(earlier.id), { ...earlier, position: 3 });

  expect((await store.loadBoard("project-a")).todo.map(({ title }) => title)).toEqual(["Earlier", "Later"]);
});

test("assigns unique monotonic positions to concurrent card creation", async () => {
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);

  const cards = await Promise.all([
    store.createCard("project-a", { title: "First", prompt: "P" }),
    store.createCard("project-a", { title: "Second", prompt: "P" }),
  ]);

  expect(new Set(cards.map(({ position }) => position)).size).toBe(2);
  expect((await store.loadBoard("project-a")).todo.map(({ position }) => position)).toEqual([0, 1]);
});

test("assigns unique positions when cards move into the same column concurrently", async () => {
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const [first, second] = await Promise.all([
    store.createCard("project-a", { title: "First", prompt: "P" }),
    store.createCard("project-a", { title: "Second", prompt: "P" }),
  ]);

  await Promise.all([
    store.moveCard(first.id, "in_progress", "user"),
    store.moveCard(second.id, "in_progress", "user"),
  ]);

  expect((await store.loadBoard("project-a")).in_progress.map(({ position }) => position)).toEqual([0, 1]);
});

test("continues queued card creation after a write failure", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 1);
  storage.failNextSet(new Error("quota exceeded"));

  await expect(store.createCard("project-a", { title: "Fails", prompt: "P" })).rejects.toThrow("quota exceeded");
  await expect(store.createCard("project-a", { title: "Succeeds", prompt: "P" })).resolves.toMatchObject({ position: 0 });
});

test("keeps a pending start when writing its result fails", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-a" });
  storage.failNextSet(new Error("quota exceeded"));

  await expect(store.completeSessionStart(card.id, {
    role: "main",
    requestId: "request-a",
    sessionId: "main-a",
    linked: true,
    targetStatus: "in_progress",
  })).rejects.toThrow("quota exceeded");
  expect(await store.getCard(card.id)).toMatchObject({
    status: "todo",
    pendingStartRole: "main",
    pendingRequestId: "request-a",
  });
});

test("keeps a pending start when writing a skipped result fails", async () => {
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-a" });
  storage.failNextSet(new Error("quota exceeded"));

  await expect(store.recordSkippedSessionStart(card.id, {
    role: "main",
    requestId: "request-a",
    directory: "/worktrees/card-a",
  })).rejects.toThrow("quota exceeded");
  expect(await store.getCard(card.id)).toMatchObject({
    status: "todo",
    pendingStartRole: "main",
    pendingRequestId: "request-a",
  });
});

test("enforces the precise UTF-8 64 KiB storage limit", () => {
  const prefix = "界".repeat(20_000);
  const remainingBytes = 64 * 1024 - new TextEncoder().encode(JSON.stringify({ payload: prefix })).byteLength;
  const atLimit = { payload: `${prefix}${"x".repeat(remainingBytes)}` };

  expect(new TextEncoder().encode(JSON.stringify(atLimit)).byteLength).toBe(64 * 1024);
  expect(() => assertStorageValueSize(atLimit)).not.toThrow();
  expect(() => assertStorageValueSize({ payload: `${atLimit.payload}x` })).toThrow("Storage value exceeds 64 KiB");
});

test("records a skipped Main start in todo while preserving its worktree", async () => {
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-a" });

  await store.recordSkippedSessionStart(card.id, {
    role: "main",
    requestId: "request-a",
    directory: "/worktrees/card-a",
  });

  expect(await store.getCard(card.id)).toEqual(expect.objectContaining({
    status: "todo",
    worktreeDirectory: "/worktrees/card-a",
    pendingStartRole: null,
  }));
});
