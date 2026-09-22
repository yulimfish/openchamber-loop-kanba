import { afterEach, expect, test } from "bun:test";

import { createHostAdapter, hostFailureMessage } from "../src/host-adapter";
import { bootstrapPanel } from "../panel/main";
import { bootstrapPage } from "../panel/page";
import { createPanelSurface } from "../src/render-panel";
import { createPageSurface } from "../src/render-page";
import { createFakeHost, createFakeUiKit } from "./support/fake-host";

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
});

test("forwards a requested session ID to the official openSession method", async () => {
  const host = createFakeHost();
  const adapter = createHostAdapter(host.client);

  await adapter.openSession("session-main");

  expect(host.openedSessionIds).toEqual(["session-main"]);
});

test("maps Main and Review inputs to the complete public StartSession requests", async () => {
  const host = createFakeHost();
  const adapter = createHostAdapter(host.client);

  await adapter.startMain({
    projectId: "project-a",
    cardId: "card-a",
    title: "Implement adapter",
    worktreeName: "card-a",
    prompt: "Implement it.",
  });
  await adapter.startReview({
    projectId: "project-a",
    cardId: "card-a",
    title: "Implement adapter",
    directory: "/worktrees/card-a",
    prompt: "Review it.",
  });

  expect(host.startRequests).toEqual([
    {
      providerId: "openchamber-loop-kanba",
      id: "card-a",
      title: "Implement adapter",
      url: "https://openchamber.dev",
      text: "Implement it.",
      projectId: "project-a",
      worktree: { kind: "new", name: "card-a" },
      navigation: "preserve",
      data: {
        schema: "openchamber-loop-kanba/v1",
        projectId: "project-a",
        cardId: "card-a",
        role: "main",
      },
    },
    {
      providerId: "openchamber-loop-kanba",
      id: "card-a",
      title: "Implement adapter",
      url: "https://openchamber.dev",
      text: "Review it.",
      projectId: "project-a",
      worktree: { kind: "existing", directory: "/worktrees/card-a" },
      navigation: "preserve",
      data: {
        schema: "openchamber-loop-kanba/v1",
        projectId: "project-a",
        cardId: "card-a",
        role: "review",
      },
    },
  ]);
});

test("uses specific recovery copy only for supported Host failures", () => {
  expect(hostFailureMessage("NOT_GRANTED")).toBe("OpenChamber permission was not granted.");
  expect(hostFailureMessage("HOST_TIMEOUT")).toBe("OpenChamber did not confirm the request in time.");
  expect(hostFailureMessage("HOST_REJECTED")).toBe("OpenChamber rejected the request.");
});

test("awaits workspace subscriptions and disposes the Host client on surface teardown", async () => {
  const host = createFakeHost();
  const adapter = createHostAdapter(host.client);
  disposers.push(adapter.onReady(() => undefined));
  disposers.push(adapter.onDirectory(() => undefined));
  disposers.push(await adapter.onProjects(() => undefined));
  disposers.push(await adapter.onSessions("project-a", () => undefined));

  for (const dispose of disposers.splice(0)) dispose();
  adapter.dispose();

  expect(host.activeSubscriptionCount()).toBe(0);
  expect(host.disposed).toBe(true);
});

test("surface bootstraps release their ready and workspace subscriptions exactly once", async () => {
  const panelHost = createFakeHost();
  const pageHost = createFakeHost();
  const disposePanel = await bootstrapPanel(createHostAdapter(panelHost.client), createPanelSurface(createFakeUiKit()));
  const disposePage = await bootstrapPage(createHostAdapter(pageHost.client), createPageSurface(createFakeUiKit()));

  expect(panelHost.activeSubscriptionCount()).toBe(3);
  expect(pageHost.activeSubscriptionCount()).toBe(2);

  disposePanel();
  disposePanel();
  disposePage();
  disposePage();

  expect(panelHost.activeSubscriptionCount()).toBe(0);
  expect(pageHost.activeSubscriptionCount()).toBe(0);
  expect(panelHost.disposed).toBe(true);
  expect(pageHost.disposed).toBe(true);
});
