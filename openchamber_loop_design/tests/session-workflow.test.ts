import { expect, test } from "bun:test";
import type { JsonValue } from "@openchamber/sdk";

import { createBoardStore } from "../src/board-store";
import { createHostAdapter } from "../src/host-adapter";
import { createSessionWorkflow } from "../src/session-workflow";
import { createFakeHost, createMemoryStorage, createUnsafeBoardStore } from "./support/fake-host";

const sessionRecord = (overrides: Partial<{
  id: string; projectId: string; directory: string;
  items: Array<{ id: string; data?: JsonValue }>;
}> = {}) => ({
  id: overrides.id ?? "s1",
  title: "Native",
  projectId: overrides.projectId ?? "project-a",
  directory: overrides.directory ?? "/a",
  parentId: null,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  worktree: null,
  activity: "idle" as const,
  outcome: null,
  items: overrides.items ?? [],
});

const matchingItem = (cardId: string, role: string, projectId = "project-a") => ({
  id: "item",
  data: { schema: "openchamber-loop-kanban/v1", projectId, cardId, role },
});

test("starts a Main session with the complete SDK request and records its link", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", directory: "/worktrees/card-1", sent: "sent", linked: true } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await createSessionWorkflow(createHostAdapter(host.client), store).startMain(card.id);

  expect(host.startRequests).toEqual([{
    providerId: "openchamber-loop-kanban",
    id: card.id,
    title: "T",
    url: "https://openchamber.dev",
    text: "P",
    projectId: "project-a",
    worktree: { kind: "new", name: card.id },
    navigation: "preserve",
    data: { schema: "openchamber-loop-kanban/v1", projectId: "project-a", cardId: card.id, role: "main" },
  }]);
  expect(await store.getCard(card.id)).toMatchObject({ mainSessionId: "main-1", mainSessionLinked: true, status: "in_progress", pendingStartRole: null });
});

test("starts Review on the persisted Main worktree", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "review-1", sent: "sent", linked: true } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "main-request" });
  await store.completeSessionStart(card.id, { role: "main", requestId: "main-request", sessionId: "main-1", linked: true, directory: "/worktrees/card-1", targetStatus: "in_progress" });

  await createSessionWorkflow(createHostAdapter(host.client), store).startReview(card.id);

  expect(host.startRequests[0]).toMatchObject({ worktree: { kind: "existing", directory: "/worktrees/card-1" }, data: { role: "review" } });
  expect(await store.getCard(card.id)).toMatchObject({ reviewSessionId: "review-1", reviewSessionLinked: true, status: "needs_review", pendingStartRole: null });
});

test("keeps a pending Main lock after an indeterminate Host timeout", async () => {
  const host = createFakeHost({ nextStartError: { code: "HOST_TIMEOUT" } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await expect(createSessionWorkflow(createHostAdapter(host.client), store).startMain(card.id)).rejects.toThrow("HOST_TIMEOUT");
  expect(await store.getCard(card.id)).toMatchObject({ status: "todo", pendingStartRole: "main" });
  expect(host.startRequests).toHaveLength(1);
});

test("opens the native session instead of rendering unavailable details", async () => {
  const host = createFakeHost();
  const workflow = createSessionWorkflow(createHostAdapter(host.client), createBoardStore(createMemoryStorage()));

  await workflow.open("main-1");

  expect(host.openedSessionIds).toEqual(["main-1"]);
});

test("labels a persisted unlinked Main session without changing its card status", async () => {
  const host = createFakeHost();
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "main-request" });
  await store.completeSessionStart(card.id, { role: "main", requestId: "main-request", sessionId: "main-1", linked: false, targetStatus: "in_progress" });
  const labels: Array<{ sessionId: string; role: string }> = [];
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);
  const dispose = await workflow.bindSessionLabels("project-a", (next) => labels.push(...next));

  host.emitSessions("project-a", {
    kind: "sessions", projectId: "project-a", state: "ready", coverage: [],
    sessions: [{ id: "main-1", title: "Native", projectId: "project-a", directory: "/a", parentId: null, createdAt: 0, updatedAt: 0, archivedAt: null, worktree: null, activity: "idle", outcome: "completed", items: [] }],
  });
  host.emitSessionLifecycle({ sessionId: "main-1", phase: "completed" });

  expect(labels).toEqual([{ sessionId: "main-1", role: "main" }]);
  expect((await store.getCard(card.id)).status).toBe("in_progress");
  expect((await store.getCard(card.id)).mainSessionId).toBe("main-1");
  await workflow.open("main-1");
  expect(host.openedSessionIds).toEqual(["main-1"]);
  dispose();
});

test("adopts exactly one discovered pending Main session and clears it explicitly", async () => {
  const host = createFakeHost();
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-a" });
  host.emitSessions("project-a", {
    kind: "sessions", projectId: "project-a", state: "ready", coverage: [],
    sessions: [{ id: "main-1", title: "Native", projectId: "project-a", directory: "/worktrees/card-1", parentId: null, createdAt: 0, updatedAt: 0, archivedAt: null, worktree: null, activity: "idle", outcome: null, items: [{ id: "item", data: { schema: "openchamber-loop-kanban/v1", projectId: "project-a", cardId: card.id, role: "main" } }] }],
  });
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);

  await workflow.adoptDiscoveredSession(card.id);
  expect(await store.getCard(card.id)).toMatchObject({ mainSessionId: "main-1", status: "in_progress", pendingStartRole: null });
  await store.beginSessionStart(card.id, { role: "review", requestId: "request-b" });
  await workflow.clearPending(card.id);
  expect((await store.getCard(card.id)).pendingStartRole).toBeNull();
});

test("blocks a second Start for the same card while the first is in flight", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", sent: "sent" } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);

  const first = workflow.startMain(card.id);
  await expect(workflow.startMain(card.id)).rejects.toThrow("START_IN_PROGRESS");
  await first;
  expect(host.startRequests).toHaveLength(1);
});

test("rejects a second project Start at the concurrency limit", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", sent: "sent" } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const firstCard = await store.createCard("project-a", { title: "First", prompt: "P" });
  const secondCard = await store.createCard("project-a", { title: "Second", prompt: "P" });
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);

  const first = workflow.startMain(firstCard.id);
  await expect(workflow.startMain(secondCard.id)).rejects.toThrow("PROJECT_CONCURRENCY_LIMIT");
  await first;
  expect(host.startRequests).toHaveLength(1);
  await store.moveCard(firstCard.id, "done", "user");
  await expect(workflow.startMain(secondCard.id)).resolves.toBeUndefined();
  expect(host.startRequests).toHaveLength(2);
});

test("keeps pending and blocks a second Start when the result write fails", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", sent: "sent" } });
  const raw = createMemoryStorage();
  const storage = {
    ...raw,
    set: async (key: string, value: JsonValue) => {
      if (typeof value === "object" && value !== null && "mainSessionId" in value && value.mainSessionId) {
        throw new Error("quota exceeded");
      }
      await raw.set(key, value);
    },
  };
  const store = createBoardStore(storage);
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);

  await expect(workflow.startMain(card.id)).rejects.toThrow("quota exceeded");
  expect(await store.getCard(card.id)).toMatchObject({ status: "todo", pendingStartRole: "main", mainSessionId: null });
  expect(host.startRequests).toHaveLength(1);
  await expect(workflow.startMain(card.id)).rejects.toThrow("START_IN_PROGRESS");
  expect(host.startRequests).toHaveLength(1);
});

test("preserves a skipped bootstrap worktree without retrying", async () => {
  const host = createFakeHost({ nextStart: {
    sessionId: null,
    sent: "skipped",
    failure: "bootstrap-failed",
    directory: "/worktrees/card-1",
    worktree: { directory: "/worktrees/card-1", name: "card-1", branch: "card-1", status: "ready" },
  } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await expect(createSessionWorkflow(createHostAdapter(host.client), store).startMain(card.id)).rejects.toThrow("bootstrap-failed");
  expect(await store.getCard(card.id)).toMatchObject({
    status: "todo",
    worktreeDirectory: "/worktrees/card-1",
    pendingStartRole: null,
  });
  expect(host.startRequests).toHaveLength(1);
});

test("keeps a created session usable when the Host could not link item data", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", sent: "sent", linked: false } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  const notice = await createSessionWorkflow(createHostAdapter(host.client), store).startMain(card.id);
  expect(notice).toContain("Session created but extension item was not linked");
  expect(await store.getCard(card.id)).toMatchObject({ mainSessionId: "main-1", mainSessionLinked: false, status: "in_progress" });
});

test("non-sent success returns a no-automatic-retry notice", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", sent: "no-model" } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  const notice = await createSessionWorkflow(createHostAdapter(host.client), store).startMain(card.id);
  expect(notice).toContain("no automatic retry");
  expect((await store.getCard(card.id)).mainSessionId).toBe("main-1");
});

test("Review skipped result keeps the card in progress with its worktree", async () => {
  const host = createFakeHost({ nextStart: {
    sessionId: null,
    sent: "skipped",
    failure: "session-create-failed",
    directory: "/worktrees/card-1",
    worktree: { directory: "/worktrees/card-1", name: "card-1", branch: "card-1", status: "ready" },
  } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "r1" });
  await store.completeSessionStart(card.id, { role: "main", requestId: "r1", sessionId: "main-1", linked: true, directory: "/worktrees/card-1", targetStatus: "in_progress" });

  await expect(createSessionWorkflow(createHostAdapter(host.client), store).startReview(card.id)).rejects.toThrow("session-create-failed");
  expect(await store.getCard(card.id)).toMatchObject({
    status: "in_progress",
    worktreeDirectory: "/worktrees/card-1",
    pendingStartRole: null,
  });
  expect(host.startRequests).toHaveLength(1);
});

test("Review request equals the Main shape except worktree and role", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "review-1", sent: "sent", linked: true } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "r1" });
  await store.completeSessionStart(card.id, { role: "main", requestId: "r1", sessionId: "main-1", linked: true, directory: "/worktrees/card-1", targetStatus: "in_progress" });

  await createSessionWorkflow(createHostAdapter(host.client), store).startReview(card.id);

  expect(host.startRequests[0]).toEqual({
    providerId: "openchamber-loop-kanban",
    id: card.id,
    title: "T",
    url: "https://openchamber.dev",
    text: "P",
    projectId: "project-a",
    worktree: { kind: "existing", directory: "/worktrees/card-1" },
    navigation: "preserve",
    data: { schema: "openchamber-loop-kanban/v1", projectId: "project-a", cardId: card.id, role: "review" },
  });
});

test("HOST_TIMEOUT pending occupies capacity until the user clears it", async () => {
  const host = createFakeHost({ nextStartError: { code: "HOST_TIMEOUT" } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const firstCard = await store.createCard("project-a", { title: "First", prompt: "P" });
  const secondCard = await store.createCard("project-a", { title: "Second", prompt: "P" });
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);

  await expect(workflow.startMain(firstCard.id)).rejects.toThrow("HOST_TIMEOUT");
  host.setNextStart({ sessionId: "main-2", sent: "sent" });
  await expect(workflow.startMain(secondCard.id)).rejects.toThrow("PROJECT_CONCURRENCY_LIMIT");
  await workflow.clearPending(firstCard.id);
  await expect(workflow.startMain(secondCard.id)).resolves.toBeUndefined();
  expect(host.startRequests).toHaveLength(2);
});

test("a skipped result frees capacity without leaving a reservation", async () => {
  const host = createFakeHost({ nextStart: {
    sessionId: null,
    sent: "skipped",
    failure: "bootstrap-failed",
    directory: "/wt",
    worktree: { directory: "/wt", name: "w", branch: "w", status: "ready" },
  } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const firstCard = await store.createCard("project-a", { title: "First", prompt: "P" });
  const secondCard = await store.createCard("project-a", { title: "Second", prompt: "P" });
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);

  await expect(workflow.startMain(firstCard.id)).rejects.toThrow("bootstrap-failed");
  host.setNextStart({ sessionId: "main-2", sent: "sent" });
  await expect(workflow.startMain(secondCard.id)).resolves.toBeUndefined();
  expect(host.startRequests).toHaveLength(2);
});

test("frees capacity after an adopted session", async () => {
  const host = createFakeHost();
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const firstCard = await store.createCard("project-a", { title: "First", prompt: "P" });
  const secondCard = await store.createCard("project-a", { title: "Second", prompt: "P" });
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);

  await store.beginSessionStart(firstCard.id, { role: "main", requestId: "r1" });
  host.emitSessions("project-a", {
    kind: "sessions", projectId: "project-a", state: "ready", coverage: [],
    sessions: [sessionRecord({ id: "main-1", items: [matchingItem(firstCard.id, "main")] })],
  });
  await workflow.adoptDiscoveredSession(firstCard.id);
  host.setNextStart({ sessionId: "main-2", sent: "sent" });
  await expect(workflow.startMain(secondCard.id)).rejects.toThrow("PROJECT_CONCURRENCY_LIMIT");
  await store.moveCard(firstCard.id, "done", "user");
  await expect(workflow.startMain(secondCard.id)).resolves.toBeUndefined();
  expect(host.startRequests).toHaveLength(1);
});

test("overlong prompt rejects before any Host call or storage write", async () => {
  const host = createFakeHost();
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  const workflow = createSessionWorkflow(
    createHostAdapter(host.client),
    createUnsafeBoardStore({ ...card, prompt: "x".repeat(16_001) }),
  );
  const writesBefore = storage.setCount();

  await expect(workflow.startMain(card.id)).rejects.toThrow("Session text exceeds 16000 characters");
  await expect(workflow.startReview(card.id)).rejects.toThrow("Session text exceeds 16000 characters");
  expect(host.startRequests).toHaveLength(0);
  expect(storage.setCount()).toBe(writesBefore);
  expect((await store.getCard(card.id)).pendingStartRole).toBeNull();
});

test("overlong item data rejects for Main and Review before any mutation", async () => {
  const host = createFakeHost();
  const storage = createMemoryStorage();
  const store = createBoardStore(storage);
  const projectId = "p".repeat(16_000);
  await store.createProject(projectId, 1);
  const card = await store.createCard(projectId, { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "r1" });
  await store.completeSessionStart(card.id, { role: "main", requestId: "r1", sessionId: "main-1", linked: true, directory: "/wt", targetStatus: "in_progress" });
  const writesBefore = storage.setCount();

  const unsafeMain = createSessionWorkflow(
    createHostAdapter(host.client),
    createUnsafeBoardStore({ ...card, status: "todo", mainSessionId: null, mainSessionLinked: null }),
  );
  await expect(unsafeMain.startMain(card.id)).rejects.toThrow("Session item data exceeds 16000 characters");

  const reviewWorkflow = createSessionWorkflow(
    createHostAdapter(host.client),
    createUnsafeBoardStore(card),
  );
  await expect(reviewWorkflow.startReview(card.id)).rejects.toThrow("Session item data exceeds 16000 characters");

  expect(host.startRequests).toHaveLength(0);
  expect(storage.setCount()).toBe(writesBefore);
});

test("NOT_GRANTED rejection retains pending", async () => {
  const host = createFakeHost({ nextStartError: { code: "NOT_GRANTED" } });
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await expect(createSessionWorkflow(createHostAdapter(host.client), store).startMain(card.id)).rejects.toThrow("NOT_GRANTED");
  expect(await store.getCard(card.id)).toMatchObject({ pendingStartRole: "main", status: "todo" });
  expect(host.startRequests).toHaveLength(1);
});

test("adopt with zero matches preserves pending", async () => {
  const host = createFakeHost();
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "r1" });
  host.emitSessions("project-a", { kind: "sessions", projectId: "project-a", state: "ready", coverage: [], sessions: [] });

  await expect(createSessionWorkflow(createHostAdapter(host.client), store).adoptDiscoveredSession(card.id)).rejects.toThrow("native sessions: none");
  expect((await store.getCard(card.id)).pendingStartRole).toBe("main");
});

test("adopt with multiple matches preserves pending", async () => {
  const host = createFakeHost();
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "r1" });
  host.emitSessions("project-a", {
    kind: "sessions", projectId: "project-a", state: "ready", coverage: [],
    sessions: [
      sessionRecord({ id: "m1", items: [matchingItem(card.id, "main")] }),
      sessionRecord({ id: "m2", items: [matchingItem(card.id, "main")] }),
    ],
  });

  await expect(createSessionWorkflow(createHostAdapter(host.client), store).adoptDiscoveredSession(card.id)).rejects.toThrow("native sessions: m1, m2");
  expect((await store.getCard(card.id)).pendingStartRole).toBe("main");
});
