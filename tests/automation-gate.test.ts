import { expect, test } from "bun:test";

import { assertNoAutomaticTransition, automationState } from "../src/automation-gate";
import { createBoardStore } from "../src/board-store";
import { createHostAdapter } from "../src/host-adapter";
import { createSessionWorkflow } from "../src/session-workflow";
import { createFakeHost, createMemoryStorage } from "./support/fake-host";

const createInProgressWorkflowFixture = async () => {
  const host = createFakeHost();
  const store = createBoardStore(createMemoryStorage());
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  await store.beginSessionStart(card.id, { role: "main", requestId: "request-1" });
  await store.completeSessionStart(card.id, {
    role: "main",
    requestId: "request-1",
    sessionId: "main-1",
    linked: true,
    directory: "/worktrees/card-1",
    targetStatus: "in_progress",
  });

  return {
    host,
    store,
    card,
    bindSessionLabels: () => workflow.bindSessionLabels("project-a", () => undefined),
  };
};

test("v1 reports automation unavailable with every missing public contract", () => {
  expect(automationState()).toEqual({
    available: false,
    missing: [
      "promptSession",
      "sessionDetailsAndEvents",
      "openWorktreeReview",
      "sessionGoalRun",
    ],
  });
});

test("summary activity and outcome cannot trigger a card transition", () => {
  expect(() => assertNoAutomaticTransition({ activity: "idle", outcome: "completed" })).toThrow(
    "Automation is unavailable on this OpenChamber version",
  );
});

test("actual Host completion events leave persisted card status unchanged", async () => {
  const fixture = await createInProgressWorkflowFixture();
  await fixture.bindSessionLabels();
  const received: Array<{ sessionId: string; phase: string }> = [];
  const unsubscribe = fixture.host.onSessionLifecycle((event) => received.push(event));

  fixture.host.emitSessions("project-a", {
    kind: "sessions",
    projectId: "project-a",
    state: "ready",
    coverage: [],
    sessions: [{
      id: "main-1",
      title: "Native",
      projectId: "project-a",
      directory: "/worktrees/card-1",
      parentId: null,
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
      worktree: null,
      activity: "idle",
      outcome: "completed",
      items: [],
    }],
  });
  fixture.host.emitSessionLifecycle({ sessionId: "main-1", phase: "completed" });

  unsubscribe();
  expect(fixture.host.lifecycleSubscriptionCount()).toBe(0);
  expect(received).toEqual([{ sessionId: "main-1", phase: "completed" }]);
  expect(fixture.host.sessionLifecycleEvents).toEqual([{ sessionId: "main-1", phase: "completed" }]);
  expect((await fixture.store.getCard(fixture.card.id)).mainSessionId).toBe("main-1");
  expect((await fixture.store.getCard(fixture.card.id)).status).toBe("in_progress");
});

test("session subscriptions never transition cards automatically", async () => {
  const sources = await Promise.all([
    Bun.file("src/session-workflow.ts").text(),
    Bun.file("src/render-page.ts").text(),
    Bun.file("src/render-panel.ts").text(),
    Bun.file("src/automation-gate.ts").text(),
    Bun.file("panel/page.ts").text(),
    Bun.file("panel/main.ts").text(),
    Bun.file("src/host-adapter.ts").text(),
  ]);
  const source = sources.join("\n");
  const workflowSource = sources[0]!;

  expect(source).not.toContain("onSessionLifecycle");
  expect(workflowSource).not.toMatch(/\.moveCard\(/);
});
