import { expect, test } from "bun:test";
import type { GuestProjectsSnapshot, GuestSessionsSnapshot, HostReadyContext } from "@openchamber/sdk";

import { bootstrapPanel } from "../panel/main";
import { bootstrapPage } from "../panel/page";
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

  expect(ui.visibleText("todoCards")).toBe("Final card");
  expect(host.peakWorkspaceSubscriptionCount()).toBeLessThanOrEqual(2);
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

  expect(host.activeWorkspaceSubscriptionCount()).toBe(2);
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
