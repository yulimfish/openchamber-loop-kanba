import { expect, test } from "bun:test";
import type { GuestProjectsSnapshot, GuestSessionsSnapshot, HostReadyContext } from "@openchamber/sdk";

import { bootstrapPanel } from "../panel/main";
import { bootstrapPage } from "../panel/page";
import { createBoardStore } from "../src/board-store";
import { createHostAdapter } from "../src/host-adapter";
import { createPanelSurface } from "../src/render-panel";
import { createPageSurface } from "../src/render-page";
import { createFakeHost, createFakeUiKit } from "./support/fake-host";

test("reapplies ready context without remounting controls or discarding a draft", () => {
  const ui = createFakeUiKit();
  const page = createPageSurface(ui);

  page.mount();
  page.setDraft({ title: "Keep this draft", prompt: "P" });
  page.applyReady({ locale: "en" } as HostReadyContext);
  page.applyReady({ locale: "zh-CN" } as HostReadyContext);

  expect(ui.mountCount).toBe(1);
  expect(page.getDraft().title).toBe("Keep this draft");
  expect(ui.documentElement.lang).toBe("zh-CN");
  expect(ui.visibleText("newCard")).toBe("新建卡片");
});

test("page bootstrap reapplies locale without remounting its surface", async () => {
  const host = createFakeHost();
  const ui = createFakeUiKit();
  const page = createPageSurface(ui);
  const dispose = await bootstrapPage(createHostAdapter(host.client), page);

  host.emitReady({ locale: "en" } as HostReadyContext);
  page.setDraft({ title: "Keep this draft", prompt: "P" });
  host.emitReady({ locale: "zh-CN" } as HostReadyContext);

  expect(ui.mountCount).toBe(1);
  expect(page.getDraft().title).toBe("Keep this draft");
  expect(ui.visibleText("newCard")).toBe("新建卡片");

  dispose();
});

test("page loads its persisted board and creates a card from the draft", async () => {
  const host = createFakeHost();
  const store = createBoardStore(host.storage);
  await store.createProject("project-a", 2);
  await store.createCard("project-a", { title: "Stored card", prompt: "Stored prompt" });
  const ui = createFakeUiKit();
  const page = createPageSurface(ui);
  const dispose = await bootstrapPage(createHostAdapter(host.client), page);

  host.emitReady({ locale: "en" } as HostReadyContext);
  host.emitProjects({
    kind: "projects",
    state: "ready",
    projects: [{ id: "project-a", name: "A", directory: "/a" }],
  });
  await Bun.sleep(1);
  await Bun.sleep(1);

  expect(ui.visibleText("todoCards")).toBe("Stored card");
  expect(ui.visibleText("active")).toBe("Active: 0/2 Limit");
  ui.type("title", "New card");
  ui.type("prompt", "New prompt");
  ui.click("newCard");
  await Bun.sleep(1);
  await Bun.sleep(1);

  expect(ui.visibleText("todoCards")).toBe("Stored card|New card");
  expect(page.getDraft()).toEqual({ title: "", prompt: "" });
  expect((await store.loadBoard("project-a")).todo.map(({ title }) => title)).toEqual(["Stored card", "New card"]);
  dispose();
});

test("page bootstrap applies the Host ready theme before it updates the surface", async () => {
  const host = createFakeHost();
  const page = createPageSurface(createFakeUiKit());
  const documentElement = {
    lang: "",
    dataset: {},
    style: { colorScheme: "", setProperty: () => undefined },
  };
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement } });

  try {
    const dispose = await bootstrapPage(createHostAdapter(host.client), page);
    host.emitReady({
      locale: "zh-CN",
      surface: "page",
      theme: { mode: "dark", tokens: new Proxy({}, { get: () => "" }) },
    } as HostReadyContext);
    expect(documentElement.lang).toBe("zh-CN");
    expect(documentElement.style.colorScheme).toBe("dark");
    dispose();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("rail bootstrap applies the Host ready theme", async () => {
  const host = createFakeHost();
  const panel = createPanelSurface(createFakeUiKit());
  const documentElement = {
    lang: "",
    dataset: {},
    style: { colorScheme: "", setProperty: () => undefined },
  };
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement } });

  try {
    const dispose = await bootstrapPanel(createHostAdapter(host.client), panel);
    host.emitReady({
      locale: "zh-CN",
      surface: "panel",
      theme: { mode: "dark", tokens: new Proxy({}, { get: () => "" }) },
    } as HostReadyContext);
    expect(documentElement.lang).toBe("zh-CN");
    expect(documentElement.style.colorScheme).toBe("dark");
    dispose();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("page ignores a disposed project's delayed session snapshot during rapid switching", async () => {
  const host = createFakeHost();
  const store = createBoardStore(host.storage);
  await store.createProject("project-a", 1);
  await store.createCard("project-a", { title: "Stored card", prompt: "P" });
  const ui = createFakeUiKit();
  const page = createPageSurface(ui);
  const dispose = await bootstrapPage(createHostAdapter(host.client), page);
  const projects: GuestProjectsSnapshot = {
    kind: "projects",
    state: "ready",
    projects: [
      { id: "project-a", name: "A", directory: "/a" },
      { id: "project-b", name: "B", directory: "/b" },
    ],
  };
  const oldSessions: GuestSessionsSnapshot = {
    kind: "sessions",
    projectId: "project-a",
    state: "ready",
    coverage: [],
    sessions: [{ id: "old", title: "Old card", projectId: "project-a", directory: "/a", parentId: null, createdAt: 0, updatedAt: 0, archivedAt: null, worktree: null, activity: "idle", outcome: null, items: [] }],
  };
  const finalSessions: GuestSessionsSnapshot = {
    ...oldSessions,
    sessions: [{ id: "final", title: "Final card", projectId: "project-a", directory: "/a", parentId: null, createdAt: 0, updatedAt: 0, archivedAt: null, worktree: null, activity: "running", outcome: "completed", items: [] }],
  };

  host.emitReady({ locale: "en" } as HostReadyContext);
  host.emitProjects(projects);
  await Bun.sleep(0);
  ui.select("project", "project-b");
  ui.select("project", "project-a");
  await Bun.sleep(0);
  host.emitSessions("project-a", finalSessions);
  host.emitStaleSessions("project-a", oldSessions);

  expect(ui.visibleText("todoCards")).toBe("Stored card");
  expect(host.peakWorkspaceSubscriptionCount()).toBeLessThanOrEqual(3);
  dispose();
});

test("page disposes a subscription that resolves after its project is replaced", async () => {
  const host = createFakeHost({ deferNextWorktreeRegistration: true });
  const ui = createFakeUiKit();
  const dispose = await bootstrapPage(createHostAdapter(host.client), createPageSurface(ui));
  host.emitProjects({
    kind: "projects",
    state: "ready",
    projects: [
      { id: "project-a", name: "A", directory: "/a" },
      { id: "project-b", name: "B", directory: "/b" },
    ],
  });
  await Bun.sleep(0);
  ui.select("project", "project-b");
  host.releaseDeferredWorktreeRegistration();
  await Bun.sleep(0);
  await Bun.sleep(0);

  expect(host.activeWorkspaceSubscriptionCount()).toBe(3);
  dispose();
  expect(host.activeWorkspaceSubscriptionCount()).toBe(0);
});

test("rail directory mapping ignores a previous project's delayed session snapshot", async () => {
  const host = createFakeHost();
  const ui = createFakeUiKit();
  const dispose = await bootstrapPanel(createHostAdapter(host.client), createPanelSurface(ui));
  const projects: GuestProjectsSnapshot = {
    kind: "projects",
    state: "ready",
    projects: [
      { id: "project-a", name: "A", directory: "/a" },
      { id: "project-b", name: "B", directory: "/b" },
    ],
  };
  const sessions = (projectId: string, title: string): GuestSessionsSnapshot => ({
    kind: "sessions",
    projectId,
    state: "ready",
    coverage: [],
    sessions: [{ id: `${projectId}-session`, title, projectId, directory: projectId === "project-a" ? "/a" : "/b", parentId: null, createdAt: 0, updatedAt: 0, archivedAt: null, worktree: null, activity: "idle", outcome: null, items: [] }],
  });

  host.emitReady({ locale: "en" } as HostReadyContext);
  host.emitProjects(projects);
  host.emitDirectory("/a");
  await Bun.sleep(0);
  host.emitDirectory("/b");
  await Bun.sleep(0);
  await Bun.sleep(0);
  host.emitSessions("project-b", sessions("project-b", "B card"));
  host.emitStaleSessions("project-a", sessions("project-a", "Old A card"));

  expect(ui.visibleText("recentCardsList")).toBe("B card");
  expect(host.peakWorkspaceSubscriptionCount()).toBeLessThanOrEqual(1);
  dispose();
});

test("page exposes adopt and clear recovery actions for a pending card", async () => {
  const host = createFakeHost();
  const store = createBoardStore(host.storage);
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "Pending", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-a" });
  const ui = createFakeUiKit();
  const dispose = await bootstrapPage(createHostAdapter(host.client), createPageSurface(ui));

  host.emitReady({ locale: "en" } as HostReadyContext);
  host.emitProjects({ kind: "projects", state: "ready", projects: [{ id: "project-a", name: "A", directory: "/a" }] });
  await Bun.sleep(1);
  await Bun.sleep(1);
  ui.selectCard(card.id);
  await Bun.sleep(0);

  expect(ui.isDisabled("adoptSession")).toBe(false);
  expect(ui.isDisabled("clearPending")).toBe(false);
  ui.click("clearPending");
  await Bun.sleep(1);
  await Bun.sleep(1);

  expect((await store.getCard(card.id)).pendingStartRole).toBeNull();
  dispose();
});

test("page opens Main and Review sessions separately", async () => {
  const host = createFakeHost();
  const store = createBoardStore(host.storage);
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "r1" });
  await store.completeSessionStart(card.id, { role: "main", requestId: "r1", sessionId: "main-1", linked: true, targetStatus: "in_progress" });
  await store.beginSessionStart(card.id, { role: "review", requestId: "r2" });
  await store.completeSessionStart(card.id, { role: "review", requestId: "r2", sessionId: "review-1", linked: true, targetStatus: "needs_review" });
  const ui = createFakeUiKit();
  const dispose = await bootstrapPage(createHostAdapter(host.client), createPageSurface(ui));

  host.emitReady({ locale: "en" } as HostReadyContext);
  host.emitProjects({ kind: "projects", state: "ready", projects: [{ id: "project-a", name: "A", directory: "/a" }] });
  await Bun.sleep(0);
  await Bun.sleep(0);
  ui.selectCard(card.id);
  await Bun.sleep(0);

  expect(ui.isDisabled("openMain")).toBe(false);
  expect(ui.isDisabled("openReview")).toBe(false);
  ui.click("openReview");
  await Bun.sleep(0);
  expect(host.openedSessionIds).toEqual(["review-1"]);
  ui.click("openMain");
  await Bun.sleep(0);
  expect(host.openedSessionIds).toEqual(["review-1", "main-1"]);
  dispose();
});

test("read-only lease state disables Start actions before any click", () => {
  const ui = createFakeUiKit();
  const page = createPageSurface(ui);
  page.mount();
  page.update({
    projects: [{ id: "project-a", name: "A" }],
    activeProjectId: "project-a",
    cards: [{ id: "card-1", title: "T", status: "todo" }],
    empty: false,
    canStart: false,
    onStartMain: () => undefined,
  });
  ui.selectCard("card-1");
  expect(ui.isDisabled("startMain")).toBe(true);
  page.update({ canStart: true });
  expect(ui.isDisabled("startMain")).toBe(false);
});

test("pending cards disable Start and show the notice banner when set", () => {
  const ui = createFakeUiKit();
  const page = createPageSurface(ui);
  page.mount();
  page.update({
    projects: [{ id: "project-a", name: "A" }],
    activeProjectId: "project-a",
    cards: [{ id: "card-1", title: "T", status: "todo", pendingStartRole: "main" }],
    empty: false,
    canStart: true,
    onStartMain: () => undefined,
  });
  ui.selectCard("card-1");
  expect(ui.isDisabled("startMain")).toBe(true);
  page.update({
    cards: [{ id: "card-1", title: "T", status: "in_progress", pendingStartRole: "review", mainSessionId: "m1" }],
  });
  ui.selectCard("card-1");
  expect(ui.isDisabled("startReview")).toBe(true);
  expect(ui.isHidden("banner")).toBe(true);
  page.update({ notice: "Session created but extension item was not linked" });
  expect(ui.isHidden("banner")).toBe(false);
  expect(ui.visibleText("banner")).toBe("Session created but extension item was not linked");
});

test("runtime Host timeout reloads the board so recovery actions become reachable", async () => {
  const host = createFakeHost({ nextStartError: { code: "HOST_TIMEOUT" } });
  const store = createBoardStore(host.storage);
  await store.createProject("project-a", 1);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  const ui = createFakeUiKit();
  const dispose = await bootstrapPage(createHostAdapter(host.client), createPageSurface(ui));

  host.emitReady({ locale: "en" } as HostReadyContext);
  host.emitProjects({ kind: "projects", state: "ready", projects: [{ id: "project-a", name: "A", directory: "/a" }] });
  await Bun.sleep(1);
  await Bun.sleep(1);
  ui.selectCard(card.id);
  await Bun.sleep(0);
  expect(ui.isDisabled("startMain")).toBe(false);
  ui.click("startMain");
  await Bun.sleep(1);
  await Bun.sleep(1);

  expect((await store.getCard(card.id)).pendingStartRole).toBe("main");
  expect(ui.isDisabled("adoptSession")).toBe(false);
  expect(ui.isDisabled("clearPending")).toBe(false);
  dispose();
});
