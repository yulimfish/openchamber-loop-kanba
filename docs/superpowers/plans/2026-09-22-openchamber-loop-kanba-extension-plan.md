# openchamber-loop-kanba Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a theme-native OpenChamber SDK v1 extension whose rail panel summarizes the active project and whose Extension page provides a persistent, user-driven four-column engineering loop board.

**Architecture:** The extension is a browser guest iframe with two classic-IIFE entry points: a compact rail panel and a full board page. `src/host-adapter.ts` is the only module that talks to `@openchamber/sdk`; `src/board-store.ts` owns versioned, project-scoped `host.storage` data; renderers consume those two boundaries and never infer automation from session summaries.

**Tech Stack:** Bun, TypeScript in strict mode, `@openchamber/sdk@1.24.2`, `@openchamber/sdk/ui`, Bun's built-in test runner, OpenChamber folder installation.

**Execution status:** This is an unexecuted plan. The repository intentionally has no package, source files, generated IIFEs, or runnable tests until E0 is implemented; every command below is future-stage acceptance criteria, not evidence from this document-only change.

## Global Constraints

- Package name, panel ID, and storage prefix are exactly `openchamber-loop-kanba`.
- Require OpenChamber `>=1.24.2` and declare `openchamber.apiVersion: 1`.
- Request exactly `sessions` and `prompt`; never request `service`, `filesystem`, `files`, `model`, `network`, or `conversation`.
- Only use documented `@openchamber/sdk` APIs. Do not use private HTTP endpoints, Zustand stores, DOM scraping, RuntimeAPI, or Electron IPC.
- Each entry point must call `applyHostReady(ctx, document.documentElement)` for every `host.onReady(ctx)` event before rendering or updating UI.
- Prefer `@openchamber/sdk/ui` controls and Host CSS tokens. Do not hard-code colors, font families, border radii, dark-mode predicates, or contrast values.
- Do not read or duplicate message transcripts, thinking, tools, usage, diff, terminal, Browser Preview, Goal state, or session internals. `host.openSession()` is the sole detail hand-off.
- Never derive a card transition from `SessionSummary.activity` or `SessionSummary.outcome`; all v1 column changes are explicit user actions.
- Never use `onSessionLifecycle` to transition a card in v1; its `completed` and `failure` phases do not satisfy the ADR-001 automation prerequisites.
- Before calling `startSession`, enforce SDK v1 limits: ID <= 128 characters, title <= 200 characters, URL <= 2,000 characters, text <= 16,000 characters, and JSON-serialized item data <= 16,000 characters.
- Treat a rejected `HostRequestError` with code `HOST_TIMEOUT` as an indeterminate request. Do not retry it or infer that its session/worktree does not exist.
- Before the first edit that changes UI layout, hierarchy, or component structure in `panel/*.html` or `src/render-*.ts`, show the approved ASCII wireframe from the design spec and obtain one-line user confirmation. Pure behavior-only edits do not need this gate.
- Do not run `git add`, `git commit`, or `git push` unless the user explicitly authorizes it for that execution session.

**Source of truth:** `docs/decisions/ADR-001-openchamber-extension-host-api.md`, `docs/superpowers/specs/2026-09-22-openchamber-loop-kanba-extension-design.md`, and `docs/traceability.md`.

---

## File Map

| Path | Responsibility | Created in |
| --- | --- | --- |
| `package.json` | Extension manifest, SDK pin, build and test scripts. | E0 |
| `tsconfig.json` | Strict browser TypeScript configuration. | E0 |
| `panel/index.html` | Rail panel document with a single extension root. | E1 |
| `panel/page.html` | Extension page document with a single board root. | E1 |
| `panel/main.ts` | Rail bootstrap, Host lifecycle, panel renderer wiring. | E1 |
| `panel/page.ts` | Full-page bootstrap, Host lifecycle, board renderer wiring. | E1 |
| `src/schema.ts` | Versioned board types, storage-key functions, pure validation. | E3 |
| `src/board-store.ts` | Project/card persistence and explicit column transitions. | E3 |
| `src/host-adapter.ts` | Typed wrapper for SDK connection, lists, subscriptions, session start/open. | E1 |
| `src/render-panel.ts` | Compact, Host-themed project summary. | E2 |
| `src/render-page.ts` | Full four-column board and user-triggered controls. | E2 |
| `src/session-workflow.ts` | Main/Review creation and Host-result reconciliation. | E4 |
| `src/writer-lease.ts` | Single writable board-page lease and per-project start reservations. | E4 |
| `src/automation-gate.ts` | Fail-closed definition of unavailable automation. | E5 |
| `tests/support/fake-host.ts` | Deterministic in-memory storage/Host fake plus a read-only corrupt-board fake for boundary tests. | E1 |
| `tests/manifest.test.ts` | Manifest, capability, and entrypoint contract. | E0 |
| `tests/host-adapter.test.ts` | SDK boundary and lifecycle behavior. | E1 |
| `tests/board-store.test.ts` | Persistence, ordering, and explicit-transition behavior. | E3 |
| `tests/session-workflow.test.ts` | Main/Review workflow, partial failures, and open-session behavior. | E4 |
| `tests/writer-lease.test.ts` | Board-page writer election and same-project reservation behavior. | E4 |
| `tests/automation-gate.test.ts` | No summary-derived automation and unavailable-feature policy. | E5 |
| `tests/ui-policy.test.ts` | Theme/UI-kit source policy assertions. | E2 |
| `tests/surface-lifecycle.test.ts` | Repeated ready context, locale fallback, and draft-retention behavior. | E2 |

## Interfaces

All later tasks must use these names; avoid introducing parallel adapters or a global mutable store.

```ts
// src/schema.ts
export type CardStatus = "todo" | "in_progress" | "needs_review" | "done";

export interface BoardProject {
  schema: "openchamber-loop-kanba/v1";
  projectId: string;
  concurrencyLimit: number;
  version: number;
}

export interface BoardCard {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: CardStatus;
  position: number;
  worktreeDirectory: string | null;
  worktreeBranch: string | null;
  mainSessionId: string | null;
  mainSessionLinked: boolean | null;
  reviewSessionId: string | null;
  reviewSessionLinked: boolean | null;
  pendingStartRole: "main" | "review" | null;
  pendingRequestId: string | null;
  pendingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const projectKey = async (projectId: string) =>
  `openchamber-loop-kanba/v1/project/${await sha256Hex(projectId)}`;
export const cardKey = (cardId: string) =>
  `openchamber-loop-kanba/v1/card/${cardId}`;
```

```ts
// src/host-adapter.ts
import type {
  GuestProjectsSnapshot,
  GuestSessionsSnapshot,
  GuestWorktreesSnapshot,
  HostReadyContext,
  HostRequestErrorCode,
  JsonValue,
  StartSessionResult,
} from "@openchamber/sdk";

export type HostFailureCode = HostRequestErrorCode;

export interface StartMainInput {
  projectId: string;
  cardId: string;
  title: string;
  worktreeName: string;
  prompt: string;
}

export interface StartReviewInput {
  projectId: string;
  cardId: string;
  title: string;
  directory: string;
  prompt: string;
}

export interface BoardStorage {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface HostAdapter {
  readonly storage: BoardStorage;
  onReady(listener: (context: HostReadyContext) => void): () => void;
  onDirectory(listener: (directory: string | null) => void): () => void;
  listProjects(): Promise<GuestProjectsSnapshot>;
  listWorktrees(projectId: string): Promise<GuestWorktreesSnapshot>;
  listSessions(projectId: string): Promise<GuestSessionsSnapshot>;
  onProjects(listener: (snapshot: GuestProjectsSnapshot) => void): Promise<() => void>;
  onWorktrees(projectId: string, listener: (snapshot: GuestWorktreesSnapshot) => void): Promise<() => void>;
  onSessions(projectId: string, listener: (snapshot: GuestSessionsSnapshot) => void): Promise<() => void>;
  startMain(input: StartMainInput): Promise<StartSessionResult>;
  startReview(input: StartReviewInput): Promise<StartSessionResult>;
  openSession(sessionId: string): Promise<void>;
  dispose(): void;
}
```

The adapter must construct SDK `StartSessionRequest` values and return the pinned SDK `StartSessionResult` without reshaping `sent`, `failure`, `linked`, or timeout semantics. Renderers consume dedicated view models, not untyped snapshots. Card IDs are extension-generated UUIDs; `projectKey()` hashes Host project IDs so every storage key stays below 128 characters.

## E0: Lock the Public SDK Contract and Manifest

**Traceability:** EXT-001, EXT-006, EXT-010.

### Task 1: Add the installable extension contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tests/manifest.test.ts`

**Consumes:** Official `@openchamber/sdk@1.24.2` package and the manifest in the accepted design.

**Produces:** A pinned, testable extension manifest; `bun run check` and `bun run build` commands used by every later task.

- [ ] **Step 1: Write the failing manifest contract test.**

```ts
// tests/manifest.test.ts
import { test, expect } from "bun:test";

import { requestedGuestCapabilities } from "@openchamber/sdk";
import { parseManifest } from "@openchamber/sdk/schemas";

const manifest = await Bun.file("package.json").json();

test("declares the minimum OpenChamber v1 extension surface", () => {
  expect(manifest.name).toBe("openchamber-loop-kanba");
  expect(manifest.openchamber.apiVersion).toBe(1);
  expect(manifest.openchamber.engines.openchamber).toBe(">=1.24.2");
  expect(manifest.openchamber.contributes.panel.id).toBe("openchamber-loop-kanba");
  expect(manifest.openchamber.contributes.panel.entry).toBe("panel/index.html");
  expect(manifest.openchamber.contributes.page.entry).toBe("panel/page.html");
  expect(manifest.openchamber.contributes.capabilities).toEqual([
    "sessions",
    "prompt",
  ]);
});

test("does not request elevated capabilities", () => {
  const parsed = parseManifest(manifest);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Manifest must parse before grant inspection");
  const contributes = parsed.manifest.contributes;
  expect(contributes).not.toHaveProperty("service");
  expect(contributes).not.toHaveProperty("integration");
  expect(contributes).not.toHaveProperty("filesystem");
  expect(contributes).not.toHaveProperty("actions");
  expect([...requestedGuestCapabilities(contributes)].sort()).toEqual([
    "prompt",
    "sessions",
  ]);
});

test("is accepted by the official OpenChamber manifest parser", () => {
  expect(parseManifest(manifest).ok).toBe(true);
});
```

- [ ] **Step 2: Run the test before adding the manifest.**

Run: `bun test tests/manifest.test.ts`

Expected: FAIL because `package.json` is absent or has no `openchamber` manifest.

- [ ] **Step 3: Create the minimal manifest and strict TypeScript configuration.**

```json
{
  "name": "openchamber-loop-kanba",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bun build panel/main.ts --outdir panel --target browser --format iife --bundle --naming '[name].js' && bun build panel/page.ts --outdir panel --target browser --format iife --bundle --naming '[name].js'",
    "test": "bun test",
    "check": "tsc --noEmit && bun test"
  },
  "devDependencies": {
    "@openchamber/sdk": "1.24.2",
    "@types/bun": "latest",
    "typescript": "^5.8.3"
  },
  "openchamber": {
    "apiVersion": 1,
    "engines": { "openchamber": ">=1.24.2" },
    "contributes": {
      "panel": {
        "id": "openchamber-loop-kanba",
        "name": "Loop Kanba",
        "icon": "kanban-view",
        "entry": "panel/index.html"
      },
      "page": { "entry": "panel/page.html", "title": "Loop Kanba" },
      "capabilities": ["sessions", "prompt"]
    }
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["panel/**/*.ts", "src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Install the pinned dependencies and generate `bun.lock`.**

Run: `bun install`

Expected: `bun.lock` exists and `@openchamber/sdk` resolves to `1.24.2`.

- [ ] **Step 5: Make the manifest test pass and record the SDK public API baseline.**

Run: `bun test tests/manifest.test.ts && bunx tsc --noEmit`

Expected: PASS. Record the exported `StartSessionRequest`, `StartSessionResult`, `HostReadyContext`, snapshot, storage, and `requestedGuestCapabilities` contracts used below. If any type or manifest field differs from the pinned `1.24.2` package, stop this phase, update the ADR/spec/traceability together with the exact public contract, then resume. Do not make a private-API compatibility shim.

## E1: Bootstrap Two Extension Surfaces and One Host Boundary

**Traceability:** EXT-001, EXT-005, EXT-006.

### Task 2: Create the panel/page documents and Host lifecycle adapter

**Files:**
- Create: `panel/index.html`
- Create: `panel/page.html`
- Create: `panel/main.ts`
- Create: `panel/page.ts`
- Create: `src/host-adapter.ts`
- Create: `tests/support/fake-host.ts`
- Create: `tests/host-adapter.test.ts`

**Consumes:** E0 manifest and the SDK's exported types/functions.

**Produces:** Both installable pages connect through one adapter, unsubscribe on teardown, and can open an existing native session.

- [ ] **Step 1: Write the adapter tests against a fake Host.**

```ts
// tests/host-adapter.test.ts
import { afterEach, expect, test } from "bun:test";
import { createHostAdapter } from "../src/host-adapter";
import { createFakeHost } from "./support/fake-host";

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
```

- [ ] **Step 2: Run the adapter test before implementation.**

Run: `bun test tests/host-adapter.test.ts`

Expected: FAIL because `createHostAdapter` and the fake Host do not exist.

- [ ] **Step 3: Implement the documents and adapter with exactly one connection path.**

Each HTML file must only supply the viewport metadata, `<main id="app"></main>`, and its built JavaScript entry; no inline styles, inline event handlers, or private Host probes.

```html
<!-- panel/index.html; page.html substitutes page.js -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Loop Kanba</title>
  </head>
  <body>
    <main id="app"></main>
    <script src="./main.js"></script>
  </body>
</html>
```

`createHostAdapter(client = connectHost())` must create and wrap the client synchronously, call only the list/subscription/session/storage APIs named in ADR-001, and preserve the complete SDK `HostRequestErrorCode` union. It maps `NOT_GRANTED`, `SESSION_BUSY`, `NO_SESSION`, `NO_DIRECTORY`, `HOST_TIMEOUT`, `DISABLED`, and `HOST_UNAVAILABLE` to specific recovery copy; every other code, including `HOST_REJECTED`, receives safe generic Host-rejection copy. Its optional `client` parameter exists solely for unit-test fakes. `createFakeHost()` supports typed `nextStart`, `nextStartError`, subscription emitters, and a `disposed` assertion. `createUnsafeBoardStore(card)` is test-only and implements the BoardStore read methods by returning the supplied raw card without schema validation, so workflow limits are tested even against corrupted persisted data. It preserves the SDK's `HostReadyContext`, `Guest*Snapshot`, `StartSessionResult`, and asynchronous workspace-subscription signatures. `panel/main.ts` and `panel/page.ts` await workspace subscription registration, then attach `beforeunload` cleanup that invokes every subscription disposer exactly once and calls `adapter.dispose()`. No production module other than this adapter imports or receives the SDK Host client.

- [ ] **Step 4: Verify adapter behavior, type safety, and IIFE outputs.**

Run: `bun test tests/host-adapter.test.ts && bun run check && bun run build`

Expected: PASS; `panel/main.js` and `panel/page.js` exist and contain bundled IIFEs, not unresolved TypeScript imports.

## E2: Apply Host Theme and Build the Two Deliberate Surfaces

**Traceability:** EXT-001, EXT-002.

### Task 3: Render a compact panel and a full board using the UI kit

**Files:**
- Create: `src/render-panel.ts`
- Create: `src/render-page.ts`
- Create: `tests/ui-policy.test.ts`
- Create: `tests/surface-lifecycle.test.ts`
- Modify: `panel/main.ts`
- Modify: `panel/page.ts`

**Consumes:** E1 `HostAdapter`, its ready lifecycle, and the accepted Surface design.

**Produces:** A rail summary and full Extension page that inherit Host context without losing a user draft during a theme/context refresh.

- [ ] **Step 1: Obtain the mandatory layout confirmation before touching UI code.**

Present this exact difference and wait for the user's one-line confirmation:

```text
before
┌────────────── Empty extension surface ──────────────┐
│                                                      │
└──────────────────────────────────────────────────────┘

after
RAIL: project summary + recent cards + "Open Board" guidance
PAGE: project selector | active/limit | new card
      TODO | IN PROGRESS | NEEDS REVIEW | DONE
```

Do not create or edit the renderer/HTML files until confirmation arrives.

- [ ] **Step 2: Write failing source-policy tests.**

```ts
// tests/ui-policy.test.ts
import { expect, test } from "bun:test";

const sources = await Promise.all([
  Bun.file("panel/main.ts").text(),
  Bun.file("panel/page.ts").text(),
  Bun.file("src/render-panel.ts").text(),
  Bun.file("src/render-page.ts").text(),
]);
const source = sources.join("\n");

test("every surface applies every Host ready context", () => {
  expect(source.match(/applyHostReady\(/g)?.length).toBeGreaterThanOrEqual(2);
  expect(source).toContain("document.documentElement");
  expect(source).toContain("document.documentElement.lang = context.locale");
});

test("renderers use the OpenChamber UI kit without hard-coded visual tokens", () => {
  expect(source).toContain("@openchamber/sdk/ui");
  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|font-family\s*:/);
});

test("extension-owned labels use the Host locale with a defined fallback", () => {
  expect(source).toContain("formatMessage");
  expect(source).toContain('"zh-CN"');
  expect(source).toContain('"en"');
});
```

```ts
// tests/surface-lifecycle.test.ts
import { expect, test } from "bun:test";
import type { HostReadyContext } from "@openchamber/sdk";
import { createPageSurface } from "../src/render-page";
import { createFakeUiKit } from "./support/fake-host";

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
```

- [ ] **Step 3: Implement the rendering contract.**

`createPageSurface(ui)` and the equivalent rail constructor must expose `mount()`, `applyReady(context)`, `update(state)`, and `destroy()`; the page surface also exposes `setDraft()`/`getDraft()` for its local form state. On the first `onReady`, mount the UI kit controls. On subsequent `onReady`, first call `applyHostReady(context, document.documentElement)`, set `document.documentElement.lang = context.locale`, and then call surface `applyReady(context)` and `update(state)` methods; do not replace the root or reset text-field values. `createFakeUiKit()` provides the same narrow mount/text/document-element ports for lifecycle tests without a browser DOM. Add `formatMessage(locale, key)` with complete English and Simplified Chinese labels for every extension-owned visible control; unrecognized locales use English. The rail renderer shows current-project identity, active/review/queued counts, and recent cards only. The page renderer shows the project selector, active/limit summary, New card action, and the four fixed columns. Its session-detail actions call the adapter's `openSession()` rather than rendering unavailable details.

Both entry modules must export testable `bootstrapPanel(host, renderer)` / `bootstrapPage(host, renderer)` functions. Add fake-Host bootstrap tests that emit `onReady` first with `en`, set a draft, then with `zh-CN`; assert `renderer.applyReady()` is called twice, controls mount once, `renderer.update()` preserves the draft, and the visible `newCard` label changes to `新建卡片`.

```ts
// Required bootstrap shape in both panel/main.ts and panel/page.ts
const adapter = createHostAdapter();
const disposeReady = adapter.onReady((context) => {
  applyHostReady(context, document.documentElement);
  document.documentElement.lang = context.locale;
  renderer.applyReady(context);
  renderer.update(currentState);
});
window.addEventListener("beforeunload", () => {
  disposeReady();
  adapter.dispose();
}, { once: true });
```

- [ ] **Step 4: Verify policy and perform a live Host visual check.**

Run: `bun test tests/ui-policy.test.ts && bun run check && bun run build`

Expected: PASS.

Manual acceptance in OpenChamber: folder-install the extension, open its rail panel and its Extension page, switch the Host theme, change font/rounding if available, and confirm both surfaces update without clearing an in-progress card draft.

The page bootstrap must own `setActiveProject(projectId)`: increment a `projectGeneration`, dispose the prior project-specific `onWorktrees`, `onSessions`, and `bindSessionLabels` subscriptions before registering replacements, clear stale project view data, then await the three new subscriptions. Every callback captures its generation and returns without rendering when it no longer matches. If selection changed while registration awaited, immediately dispose those newly returned callbacks. The rail subscribes to `onDirectory(directory)` and `onProjects`; it maps the current directory to `GuestProject.directory`, displays a Host-style empty state for null/loading/error/unmatched directory, and runs the same generation/dispose-before-subscribe sequence when the match changes. Add fake-Host page rapid-switch (`project-a -> project-b -> project-a`) and rail directory-switch tests with delayed old snapshots; prove only the final project renders and the active workspace-subscription count never exceeds the three subscriptions for one selected project.

## E3: Persist the Four-Column Board by Project

**Traceability:** EXT-003, EXT-009.

### Task 4: Implement validated, project-scoped storage and explicit transitions

**Files:**
- Create: `src/schema.ts`
- Create: `src/board-store.ts`
- Create: `tests/board-store.test.ts`
- Modify: `src/render-page.ts`

**Consumes:** The types and keys in the Interfaces section and Host `storage` supplied through the E1 adapter.

**Produces:** Cards survive reload, are ordered per project, and only a user action can move them between the four columns.

- [ ] **Step 1: Write failing persistence and transition tests.**

```ts
// tests/board-store.test.ts
import { expect, test } from "bun:test";
import { assertStorageValueSize, createBoardStore } from "../src/board-store";
import { projectKey } from "../src/schema";
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
```

- [ ] **Step 2: Run the storage tests before implementation.**

Run: `bun test tests/board-store.test.ts`

Expected: FAIL because schema, store, and memory storage do not exist.

- [ ] **Step 3: Implement schema validation and single-key store writes.**

`createBoardStore(storage)` must validate the literal schema name, non-empty IDs/titles/prompts, title length <= 200, prompt length <= 16,000, the four statuses, per-project ownership, monotonic `position`, and the UTF-8 byte size of every serialized value before writing. `createCard()` itself generates a UUID, so `cardKey(cardId)` is always below the 128-character key limit; `projectKey(projectId)` awaits a SHA-256 hex digest. Export `assertStorageValueSize(value: JsonValue)` so the 64 KiB byte-limit guard is directly tested. A card create/edit/move writes exactly its `cardKey(cardId)`; project settings write exactly `await projectKey(projectId)`. `beginSessionStart()` writes the pending fields in one card write. `completeSessionStart()` must use one subsequent card write to set session ID, linked state, worktree references, target status, and cleared pending fields together; it must never call `moveCard()` afterward. `recordSkippedSessionStart()` likewise writes preserved worktree data, `todo`, and cleared pending together. If either result write fails, the prior persisted pending record remains unchanged, blocking another Start until the user has inspected the native project and explicitly cleared pending. `loadBoard(projectId)` derives the board by awaiting `storage.keys()`, loading card keys, filtering their `projectId`, and sorting by `status`, `position`, then `id`. A validation failure or failed Host write must leave persisted storage untouched and surface an error rather than claiming persistence. `moveCard(cardId, nextStatus, cause)` must accept only `cause === "user"`, record an ISO timestamp, and reject `"session-summary"`, `"activity"`, and `"outcome"` causes with the exact test message. The rail never writes board data; no v1 behavior depends on cross-key atomicity, a global card index, or an unavailable compare-and-swap operation.

- [ ] **Step 4: Verify reload, ordering, and strict typing.**

Run: `bun test tests/board-store.test.ts && bun run check`

Expected: PASS. The oversized serialized-value test proves no storage value crosses the 64 KiB Host limit; cards contain metadata only and never transcript-like content.

## E4: Create and Open Main/Review Worktree Sessions

**Traceability:** EXT-004, EXT-005.

### Task 5: Connect explicit card actions to `startSession` and `openSession`

**Files:**
- Create: `src/session-workflow.ts`
- Create: `src/writer-lease.ts`
- Create: `tests/session-workflow.test.ts`
- Create: `tests/writer-lease.test.ts`
- Modify: `src/host-adapter.ts`
- Modify: `src/board-store.ts`
- Modify: `src/render-page.ts`

**Consumes:** E1 adapter, E3 store, and the data envelope `{ schema, projectId, cardId, role }`.

**Produces:** Users can explicitly start a Main worktree session, explicitly create a Review session on that same worktree, and open native OpenChamber session details.

`createWriterLease()` uses `BroadcastChannel("openchamber-loop-kanba/board-writer")` with a per-page UUID. It waits for peer announcements before enabling mutations; when two pages in the same extension client are present, the lexicographically smaller UUID is writer and the other page is read-only. `reserveMain(projectId, cardId, limit, board)` synchronously measures existing capacity before inserting: persisted pending-Main cards plus existing `in_progress` cards plus other unpersisted reservations. Reject when that pre-insertion count is `>= limit`; otherwise insert this reservation, so the admitted Start consumes one of the available slots without rejecting itself. On successful persistence of the initial pending record, release the in-memory reservation immediately: that persisted pending record is now the sole capacity count. If the pending write fails, release it too. Every later terminal path (successful session link, skipped-result record, timeout/rejection, result-write failure, adoption, or explicit pending clear) must leave no in-memory reservation; the persistent pending or `in_progress` state then supplies the count when applicable. This prevents same-client double Start only; SDK v1 lacks CAS or a server-side lease, so cross-client concurrency is explicitly best-effort. Test two leases and the limit-1/two-card race without a real browser by injecting a fake channel factory.

- [ ] **Step 1: Write failing workflow tests.**

```ts
// tests/session-workflow.test.ts
import { expect, test } from "bun:test";
import { createSessionWorkflow } from "../src/session-workflow";
import { createHostAdapter } from "../src/host-adapter";
import { createFakeHost, createMemoryStorage, createUnsafeBoardStore } from "./support/fake-host";
import { createBoardStore } from "../src/board-store";

test("starts a Main session with the complete SDK request and records its link", async () => {
  const host = createFakeHost({ nextStart: {
    sessionId: "main-1",
    directory: "/worktrees/card-1",
    sent: "sent",
    linked: true,
  } });
  const store = createBoardStore(createMemoryStorage());
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await workflow.startMain(card.id);

  expect(host.startRequests).toEqual([{
    providerId: "openchamber-loop-kanba",
    id: card.id,
    title: card.title,
    url: "https://openchamber.dev",
    text: card.prompt,
    projectId: "project-a",
    worktree: { kind: "new", name: card.id },
    navigation: "preserve",
    data: {
      schema: "openchamber-loop-kanba/v1",
      projectId: "project-a",
      cardId: card.id,
      role: "main",
    },
  }]);
  expect((await store.getCard(card.id)).mainSessionId).toBe("main-1");
  expect((await store.getCard(card.id)).mainSessionLinked).toBe(true);
  expect((await store.getCard(card.id)).status).toBe("in_progress");
});

test("preserves a skipped bootstrap worktree without retrying", async () => {
  const host = createFakeHost({ nextStart: {
    sessionId: null,
    directory: "/worktrees/card-1",
    worktree: {
      directory: "/worktrees/card-1",
      name: "card-1",
      branch: "card-1",
      status: "ready",
    },
    sent: "skipped",
    failure: "bootstrap-failed",
  } });
  const store = createBoardStore(createMemoryStorage());
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await expect(workflow.startMain(card.id)).rejects.toThrow("bootstrap-failed");

  expect((await store.getCard(card.id)).worktreeDirectory).toBe("/worktrees/card-1");
  expect((await store.getCard(card.id)).status).toBe("todo");
  expect(host.startRequests).toHaveLength(1);
});

test("rejects a too-long prompt before it reaches the Host", async () => {
  const host = createFakeHost();
  const store = createBoardStore(createMemoryStorage());
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });
  const workflow = createSessionWorkflow(
    createHostAdapter(host.client),
    createUnsafeBoardStore({ ...card, prompt: "x".repeat(16_001) }),
  );

  await expect(workflow.startMain(card.id)).rejects.toThrow("Session text exceeds 16000 characters");
  expect(host.startRequests).toHaveLength(0);
});

test("blocks a second Start while the same card request is in flight", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", sent: "sent" } });
  const store = createBoardStore(createMemoryStorage());
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  const first = workflow.startMain(card.id);
  await expect(workflow.startMain(card.id)).rejects.toThrow("START_IN_PROGRESS");
  await first;
  expect(host.startRequests).toHaveLength(1);
});

test("keeps a created session usable when the Host could not link item data", async () => {
  const host = createFakeHost({ nextStart: { sessionId: "main-1", sent: "sent", linked: false } });
  const store = createBoardStore(createMemoryStorage());
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await workflow.startMain(card.id);

  expect((await store.getCard(card.id)).mainSessionId).toBe("main-1");
  expect((await store.getCard(card.id)).mainSessionLinked).toBe(false);
});

test("keeps the persistent Start lock after an indeterminate Host timeout", async () => {
  const host = createFakeHost({ nextStartError: { code: "HOST_TIMEOUT" } });
  const store = createBoardStore(createMemoryStorage());
  const workflow = createSessionWorkflow(createHostAdapter(host.client), store);
  await store.createProject("project-a", 3);
  const card = await store.createCard("project-a", { title: "T", prompt: "P" });

  await expect(workflow.startMain(card.id)).rejects.toThrow("HOST_TIMEOUT");

  expect((await store.getCard(card.id)).pendingStartRole).toBe("main");
  expect(host.startRequests).toHaveLength(1);
});

test("opens the native session instead of rendering its unavailable transcript", async () => {
  const host = createFakeHost();
  const workflow = createSessionWorkflow(createHostAdapter(host.client), createBoardStore(createMemoryStorage()));

  await workflow.open("main-1");

  expect(host.openedSessionIds).toEqual(["main-1"]);
});
```

Add these non-optional cases in the same test file:

1. Seed a persisted `in_progress` card with `worktreeDirectory: "/worktrees/card-1"`, call `startReview(card.id)`, and assert the sole request exactly equals the Main request shape except `worktree: { kind: "existing", directory: "/worktrees/card-1" }` and `data.role: "review"`. Return a review session and assert one `completeSessionStart()` write sets `reviewSessionId`, `reviewSessionLinked`, `needs_review`, and cleared pending fields together.
2. Return `sessionId: null`, `sent: "skipped"`, a fully populated `GuestWorktree`, and `failure: "session-create-failed"` from `startReview()`. Assert the card stays `in_progress`, pending is cleared, the returned worktree remains attached, and the Host received one request only.
3. After the Host returns a Main session, configure the next storage `set` to fail. Assert the card retains its prior pending record with no `mainSessionId`, a second `startMain()` rejects `START_IN_PROGRESS`, and the Host received one request only.
4. Reload a `linked: false` card from a new `createBoardStore(storage)`, call `bindSessionLabels()`, emit a ready `onSessions` snapshot containing only `id: "main-1"`, and assert the callback receives the Main label through the persisted session-ID match.
5. With `concurrencyLimit: 1` and two `todo` cards, invoke `startMain()` for both in the same turn. Assert the first measures pre-reservation capacity as zero and makes one Host request, the second rejects `PROJECT_CONCURRENCY_LIMIT`, and neither card can bypass the limit through a pending state.
6. Complete one Main start successfully, then move that card out of `in_progress`; assert its in-memory reservation was released when pending persisted and the remaining capacity becomes available. Repeat for a `HOST_TIMEOUT`, a result-write failure, and a skipped-result record; assert each has no reservation leak and that only the persisted pending state occupies capacity where applicable. In separate recovery cases, Adopt a uniquely discovered session and invoke `Clear pending after native inspection`; assert both leave the reservation set empty and capacity is supplied only by their resulting persisted state.
7. Use a valid card whose `projectId` makes `JSON.stringify(data)` exceed 16,000 characters, and separately one whose trimmed prompt exceeds 16,000 characters. For each, assert `startMain()` rejects before reservation/pending mutation, makes zero Host calls and zero storage writes, leaves the reservation set empty, and preserves the card. Repeat both overlong data and overlong trimmed-prompt cases for `startReview()` with the same zero-mutation assertions.

- [ ] **Step 2: Run the workflow tests before implementation.**

Run: `bun test tests/session-workflow.test.ts`

Expected: FAIL because the workflow module does not exist.

- [ ] **Step 3: Implement Main and Review request construction.**

`startMain(cardId)` must reject non-`todo` cards, cards with `mainSessionId !== null` or `pendingStartRole !== null`, blank or trimmed prompts longer than 16,000 characters, titles longer than 200 characters, IDs longer than 128 characters, item data whose `JSON.stringify(data)` length exceeds 16,000 characters, and projects whose current `in_progress` count reaches `BoardProject.concurrencyLimit`. Build the trimmed `text` and exact `{ schema, projectId, cardId, role: "main" }` data object first; all length checks finish before acquiring the writer lease, adding a reservation, or writing pending. An invalid payload rejects with no Host call and no mutation. The full page is the sole writer surface within its extension client; it must hold a page-writer lease before enabling Start, and a second local board page remains read-only. Before its first await after validation it adds `cardId` to a workflow-local card `Set`, measures existing project capacity before inserting this card's reservation, rejects when that count is `>= BoardProject.concurrencyLimit`, and otherwise adds the card to a per-project reservation `Set`. A `finally` after the Host/result branch clears that local card guard; durable pending remains the cross-reload lock. It then writes `pendingStartRole: "main"`, a new request UUID, and `pendingStartedAt` to the card key. If either guard is present or the pending write fails, it must release its reservation, reject with `START_IN_PROGRESS` or the write error, and never call `startSession`; if the pending write succeeds, release the in-memory reservation immediately because that persisted pending record now occupies capacity. This is a same-client guard only; SDK v1 cannot make a cross-client hard concurrency guarantee. It constructs this complete public SDK request:

```ts
{
  providerId: "openchamber-loop-kanba",
  id: card.id,
  title: card.title,
  url: "https://openchamber.dev",
  text: card.prompt.trim(),
  projectId: card.projectId,
  worktree: { kind: "new", name: card.id },
  navigation: "preserve",
  data: {
  schema: "openchamber-loop-kanba/v1",
  projectId: card.projectId,
  cardId: card.id,
  role: "main",
  },
}
```

If `StartSessionResult.sessionId` is non-null, call `completeSessionStart()` exactly once to persist the session, any returned directory/worktree, `linked` (defaulting an omitted value to `true`), cleared pending fields, and `in_progress` together. Do not call `moveCard()` afterward. If this one result write fails, retain the already-persisted pending record and block another Start; show the native-inspection recovery banner. `sent: "no-model"`, `"skipped"`, and `"failed"` show a banner but do not cause an automatic retry. If `linked === false`, additionally show `Session created but extension item was not linked`; the persisted session ID remains the first-choice match after reload. If the result instead has `sessionId: null, sent: "skipped"` with `failure: "bootstrap-failed" | "session-create-failed"`, call `recordSkippedSessionStart()` exactly once to preserve the returned directory/worktree, clear pending, and keep the card in `todo`; show the failure banner and do not retry. A rejected `HOST_TIMEOUT` has no reliable worktree/session result: keep the card in `todo` with pending intact, show an indeterminate-result banner instructing the user to inspect the native project, and do not retry. Only a user action labelled `Clear pending after native inspection` may clear this lock; it never sends a retry prompt. The reservation was already released when the initial pending write succeeded, so none of these branches may retain or recreate one.

Every rejected `HostRequestError`, including non-timeout codes, leaves the pending card unchanged because no error proves that no native session was created. The recovery UI offers `Adopt discovered session` before `Clear pending after native inspection`: it calls `listSessions(card.projectId)`, filters only sessions whose extension item data exactly matches the persisted `{ schema, projectId, cardId, role }`, and requires exactly one match. It then calls `completeSessionStart()` once with that session's ID/worktree/link data. Zero or multiple matches keep pending intact and show the user the native session list; recovery never chooses a session, sends a prompt, or retries automatically. Add fake-Host tests for one-match adoption, zero-match preservation, multiple-match preservation, and `NOT_GRANTED` rejection retaining pending.

`startReview(cardId)` must require `in_progress`, `reviewSessionId === null`, no pending role, and a non-null `worktreeDirectory`; it validates the trimmed text and serialized `{ schema, projectId, cardId, role: "review" }` data against the same limits before pending/reservation mutation, applies the same in-flight/persistent-pending protocol, then calls the full request shape with `worktree: { kind: "existing", directory }` and item-data `role: "review"`. It calls `completeSessionStart()` once with target status `needs_review` only when the result has a non-null review session ID, and persists `reviewSessionLinked` in that same write; non-`sent` status only changes the banner. Neither path chooses model, agent, or variant; the Host uses the user's current selections.

- [ ] **Step 4: Reconcile summary subscriptions without treating them as commands.**

Expose `workflow.bindSessionLabels(projectId, listener): Promise<() => void>`; it awaits `adapter.onSessions(projectId, listener)` only to update visible Main/Review labels. Match persisted `mainSessionId`/`reviewSessionId` first, then extension item data, so a `linked: false` session remains visible and openable after reload. Do not alter `BoardCard.status` inside a subscription callback, and do not subscribe to `onSessionLifecycle` in v1. Add a fake-Host regression case that begins with an `in_progress` card, emits a ready session snapshot containing `{ id: "main-1", activity: "idle", outcome: "completed" }` without item data, then emits `{ sessionId: "main-1", phase: "completed" }`; after both events, assert the stored link remains usable and the card remains `in_progress`. The test must invoke `bindSessionLabels()`, not `assertNoAutomaticTransition()` in isolation.

- [ ] **Step 5: Verify the workflow end-to-end.**

Run: `bun test tests/session-workflow.test.ts && bun run check && bun run build`

Expected: PASS.

Manual acceptance in OpenChamber: create a card, Start it, confirm a new worktree session appears; choose Move to review after work is ready, confirm the Review session attaches to the same directory; use Open Main/Review session and verify native Chat/Context displays the real details.

## E5: Make Automation Unavailability Explicit and Fail Closed

**Traceability:** EXT-007, EXT-008.

### Task 6: Gate all automatic loop behavior on absent public SDK capabilities

**Files:**
- Create: `src/automation-gate.ts`
- Create: `tests/automation-gate.test.ts`
- Modify: `src/render-page.ts`
- Modify: `src/session-workflow.ts`

**Consumes:** Current SDK v1 contract and ADR-001's four upstream requirements.

**Produces:** A visible unavailable banner and a code path that cannot accidentally use summary fields as automation events.

- [ ] **Step 1: Write failing gate tests.**

```ts
// tests/automation-gate.test.ts
import { expect, test } from "bun:test";
import { automationState, assertNoAutomaticTransition } from "../src/automation-gate";
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

  fixture.host.emitSessions("project-a", {
    state: "ready",
    sessions: [{ id: "main-1", activity: "idle", outcome: "completed" }],
  });
  fixture.host.emitSessionLifecycle({ sessionId: "main-1", phase: "completed" });

  expect(fixture.host.lifecycleSubscriptionCount()).toBe(0);
  expect((await fixture.store.getCard(fixture.card.id)).mainSessionId).toBe("main-1");
  expect((await fixture.store.getCard(fixture.card.id)).status).toBe("in_progress");
});
```

- [ ] **Step 2: Run the gate test before implementation.**

Run: `bun test tests/automation-gate.test.ts`

Expected: FAIL because the gate module does not exist.

- [ ] **Step 3: Implement a static, fail-closed v1 gate.**

`automationState()` returns the test fixture exactly while `@openchamber/sdk@1.24.2` is pinned. The page renders a Host-themed, localized banner whose English fallback is `Automation unavailable on this OpenChamber version`; it does not render Coordinator, Goal, auto-review, auto-feedback, merge, or retry controls. Session subscription handlers must not import or call board-transition methods, and v1 must not register `onSessionLifecycle` at all.

- [ ] **Step 4: Verify the gate and the full test suite.**

Run: `bun test tests/automation-gate.test.ts && bun run check`

Expected: PASS. The fake-Host completed lifecycle regression proves persisted state stays unchanged; inspect `src/session-workflow.ts` and subscription callbacks to verify all state changes originate from visible user-action handlers only.

## E6: Upgrade to an Automatic Loop Only After an Official SDK Release

**Traceability:** EXT-008.

### Task 7: Treat automation as a future compatibility milestone, not v1 implementation work

**Files:**
- Modify only after all four APIs exist: `package.json`, `src/host-adapter.ts`, `src/automation-gate.ts`, `src/session-workflow.ts`, related tests, ADR-001, design spec, traceability, and a new dated implementation plan.

**Consumes:** A newly published and documented `@openchamber/sdk` release containing every contract below.

**Produces:** Nothing in the v1 release. This is an executable release gate that prevents a misleading partial automation implementation.

- [ ] **Step 1: Confirm all four public APIs from the installed package and official SDK docs.**

Required contracts, without substitutes:

```text
1. Idempotent prompt sending to an exact sessionId plus a session-creation request ID.
2. Paginated per-session details and resumable events for messages/Parts, usage, diff, todo,
   permissions/questions, and Goal-run state.
3. Atomic openWorktreeReview(project, worktreeDirectory, sessionId, initialSurface).
4. Set/replace Session Goal and receive a stable Goal-run ID.
```

Expected: every contract is documented and has an SDK type import. If any item is absent, retain E5 unchanged and release only the user-driven version.

- [ ] **Step 2: Write a new dated design/plan before changing the gate.**

The successor design must define request idempotency, event replay after extension reload, deduplication keys, permission/question escalation, and the exact user-visible recovery path for each Host error. It must never infer success from an idle summary.

- [ ] **Step 3: Raise the minimum SDK/Host version and replace the static gate only with tests for real capability calls.**

Run: `bun test && bun run check && bun run build`

Expected: PASS with fixtures proving duplicate events create no duplicate session/prompt and an unavailable new capability keeps automatic transitions disabled.

## E7: Verify Least Privilege, Installation, and Native Handoff

**Traceability:** EXT-001, EXT-002, EXT-006, EXT-009, EXT-010, EXT-011, EXT-012.

### Task 8: Run release-quality checks without broadening scope

**Files:**
- Modify only if a failed check exposes a defect: the exact file named by that failure.

**Consumes:** E0-E5 built outputs and OpenChamber's standard folder installer.

**Produces:** Evidence that the extension installs, preserves board data, follows the Host theme, and has no private/elevated integration path.

- [ ] **Step 1: Run all deterministic checks.**

Run: `bun test && bun run check && bun run build && git diff --check`

Expected: all tests pass, strict TypeScript passes, both generated IIFE outputs exist, and `git diff --check` has no output for tracked changes.

Run: `git status --short`

Expected: identify every `??` path. For each untracked file that must ship, run `git diff --check --no-index /dev/null <that exact path>`; its exit status is `1` because it is a new file, but it must emit no whitespace diagnostic. This is required because ordinary `git diff --check` does not inspect untracked files.

- [ ] **Step 2: Run the narrow private-integration scan.**

Run: `rg -n "RuntimeAPI|Electron|ipc|zustand|localhost|127\\.0\\.0\\.1|fetch\\(" --glob '*.ts' --glob '*.html' panel src tests`

Expected: no output. Any match requires removal or an ADR/spec correction before release; no exception for a convenience fallback.

- [ ] **Step 3: Verify folder installation and the Host permission dialog manually.**

Open **Settings → Extensions → Install from folder**, choose the repository root, then confirm the permission dialog contains exactly the `sessions` and `prompt` grants produced by `requestedGuestCapabilities(manifest.openchamber.contributes)`. Verify the rail panel is visible and the full board is reachable through **Extension pages**; do not attempt to force-open the full page from the rail.

- [ ] **Step 4: Run the user workflow manually.**

Create a card, reload OpenChamber, verify it remains in `todo`, Start it, open its native Main session, explicitly move it to review, create/open its native Review session, explicitly move it to done, and reload again. Confirm no merge, deletion, prompt retry, or automatic card movement occurs.

- [ ] **Step 5: Record evidence without committing unless authorized.**

Record the OpenChamber version, installed extension version, test command output, and manual acceptance date in the delivery summary. Do not stage, commit, or push any file unless the user explicitly requests it.

## Completion Checklist

- [ ] EXT-001 through EXT-012 each have passing automated or manual evidence in `docs/traceability.md`.
- [ ] `requestedGuestCapabilities(manifest.openchamber.contributes)` returns exactly `sessions` and `prompt`.
- [ ] `panel/main.js` and `panel/page.js` are generated classic IIFEs and are included in the install folder.
- [ ] Both extension surfaces respond to every Host `onReady` context without clearing user draft state.
- [ ] All session-detail actions call the native `openSession` hand-off.
- [ ] The E5 unavailable-automation banner remains enabled on SDK v1.
- [ ] No automatic loop code ships before the E6 public API gate passes.
