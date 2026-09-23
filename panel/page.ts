import { applyHostReady } from "@openchamber/sdk/ui";
import type { GuestProjectsSnapshot, GuestSessionsSnapshot, GuestWorktreesSnapshot } from "@openchamber/sdk";

import { HostRequestError } from "@openchamber/sdk";

import { createBoardStore, type Board } from "../src/board-store";
import { createHostAdapter, hostFailureMessage, type HostAdapter } from "../src/host-adapter";
import { createDomUiKit, type SurfaceCard } from "../src/render-panel";
import { createPageSurface, type PageSurface, type PageSurfaceState } from "../src/render-page";
import { createSessionWorkflow } from "../src/session-workflow";
import { createWriterLease } from "../src/writer-lease";

const toCards = (board: Board): SurfaceCard[] => [
  ...board.todo,
  ...board.in_progress,
  ...board.needs_review,
  ...board.done,
].map((card) => ({
  id: card.id,
  title: card.title,
  status: card.status,
  mainSessionId: card.mainSessionId ?? undefined,
  reviewSessionId: card.reviewSessionId ?? undefined,
  pendingStartRole: card.pendingStartRole ?? undefined,
}));

const errorMessage = (error: unknown): string => {
  if (error instanceof HostRequestError) return hostFailureMessage(error.code);
  return error instanceof Error && error.message ? error.message : "Unable to load board";
};

export const bootstrapPage = async (host: HostAdapter, renderer: PageSurface) => {
  const boardStore = createBoardStore(host.storage);
  const writerLease = createWriterLease();
  const workflow = createSessionWorkflow(host, boardStore, writerLease);
  let disposed = false;
  let mounted = false;
  let projects: GuestProjectsSnapshot = { kind: "projects", state: "loading", projects: [] };
  let worktrees: GuestWorktreesSnapshot | undefined;
  let sessions: GuestSessionsSnapshot | undefined;
  let board: Board | undefined;
  let settings: { concurrencyLimit: number } | undefined;
  let error: string | null = null;
  let canStart = false;
  let notice: string | null = null;
  let activeProjectId: string | null = null;
  let projectGeneration = 0;
  const projectDisposers: Array<() => void> = [];
  let registration = Promise.resolve();

  const render = () => {
    const next: PageSurfaceState = {
      projects: projects.projects.map(({ id, name }) => ({ id, name })),
      activeProjectId,
      active: board?.in_progress.length ?? 0,
      limit: settings?.concurrencyLimit ?? 1,
      cards: board ? toCards(board) : [],
      empty: !activeProjectId || projects.state !== "ready" || error !== null,
      error,
      notice,
      canStart,
      onSelectProject: setActiveProject,
      onNewCard: board && canStart ? (draft) => void createCard(draft) : undefined,
      onStartMain: board && canStart ? (cardId) => void startSession(cardId, "main") : undefined,
      onStartReview: board && canStart ? (cardId) => void startSession(cardId, "review") : undefined,
      onMoveDone: board && canStart ? (cardId) => void moveCardToDone(cardId) : undefined,
      onAdoptSession: board && canStart ? (cardId) => void recoverSession(cardId, "adopt") : undefined,
      onClearPending: board && canStart ? (cardId) => void recoverSession(cardId, "clear") : undefined,
      onOpenMain: (sessionId) => void host.openSession(sessionId),
      onOpenReview: (sessionId) => void host.openSession(sessionId),
    };
    renderer.update(next);
  };

  function setActiveProject(projectId: string | null): void {
    const generation = ++projectGeneration;
    activeProjectId = projectId;
    worktrees = undefined;
    sessions = undefined;
    board = undefined;
    settings = undefined;
    error = null;
    notice = null;
    projectDisposers.splice(0).forEach((dispose) => dispose());
    render();
    registration = registration.catch(() => undefined).then(async () => {
      if (disposed || generation !== projectGeneration || !projectId) return;
      try {
        settings = await boardStore.getProject(projectId) ?? await boardStore.createProject(projectId, 1);
        board = await boardStore.loadBoard(projectId);
      } catch (nextError) {
        if (disposed || generation !== projectGeneration) return;
        error = errorMessage(nextError);
        render();
        return;
      }
      if (disposed || generation !== projectGeneration) return;
      render();
      const disposeWorktrees = await host.onWorktrees(projectId, (snapshot) => {
        if (disposed || generation !== projectGeneration) return;
        worktrees = snapshot;
        render();
      });
      if (disposed || generation !== projectGeneration) {
        disposeWorktrees();
        return;
      }
      projectDisposers.push(disposeWorktrees);
      const disposeSessions = await host.onSessions(projectId, (snapshot) => {
        if (disposed || generation !== projectGeneration) return;
        sessions = snapshot;
        render();
      });
      if (disposed || generation !== projectGeneration) {
        disposeSessions();
        return;
      }
      projectDisposers.push(disposeSessions);
      const disposeLabels = await workflow.bindSessionLabels(projectId, () => render());
      if (disposed || generation !== projectGeneration) {
        disposeLabels();
        return;
      }
      projectDisposers.push(disposeLabels);
    });
  }

  async function createCard(draft: PageSurfaceState extends { onNewCard?: (input: infer Input) => unknown } ? Input : never): Promise<void> {
    const projectId = activeProjectId;
    const generation = projectGeneration;
    if (!projectId || !board) return;
    try {
      await boardStore.createCard(projectId, draft);
      const nextBoard = await boardStore.loadBoard(projectId);
      if (disposed || generation !== projectGeneration) return;
      board = nextBoard;
      error = null;
      renderer.setDraft({ title: "", prompt: "" });
      render();
    } catch (nextError) {
      if (disposed || generation !== projectGeneration) return;
      error = errorMessage(nextError);
      render();
    }
  }

  async function moveCardToDone(cardId: string): Promise<void> {
    const projectId = activeProjectId;
    const generation = projectGeneration;
    if (!projectId) return;
    try {
      await boardStore.moveCard(cardId, "done", "user");
      const nextBoard = await boardStore.loadBoard(projectId);
      if (disposed || generation !== projectGeneration) return;
      board = nextBoard;
      error = null;
      render();
    } catch (nextError) {
      if (disposed || generation !== projectGeneration) return;
      error = errorMessage(nextError);
      render();
    }
  }

  async function startSession(cardId: string, role: "main" | "review"): Promise<void> {
    const projectId = activeProjectId;
    const generation = projectGeneration;
    if (!projectId) return;
    try {
      notice = await (role === "main" ? workflow.startMain(cardId) : workflow.startReview(cardId)) ?? null;
      const nextBoard = await boardStore.loadBoard(projectId);
      if (disposed || generation !== projectGeneration) return;
      board = nextBoard;
      error = null;
      render();
    } catch (nextError) {
      if (disposed || generation !== projectGeneration) return;
      error = errorMessage(nextError);
      notice = null;
      try {
        board = await boardStore.loadBoard(projectId);
      } catch {
        // Keep the previous board when the reload itself fails.
      }
      if (disposed || generation !== projectGeneration) return;
      render();
    }
  }

  async function recoverSession(cardId: string, action: "adopt" | "clear"): Promise<void> {
    const projectId = activeProjectId;
    const generation = projectGeneration;
    if (!projectId) return;
    try {
      await (action === "adopt" ? workflow.adoptDiscoveredSession(cardId) : workflow.clearPending(cardId));
      const nextBoard = await boardStore.loadBoard(projectId);
      if (disposed || generation !== projectGeneration) return;
      board = nextBoard;
      error = null;
      render();
    } catch (nextError) {
      if (disposed || generation !== projectGeneration) return;
      error = errorMessage(nextError);
      render();
    }
  }

  const disposeReady = host.onReady((context) => {
    if (typeof document !== "undefined") {
      applyHostReady(context, document.documentElement);
      document.documentElement.lang = context.locale;
    }
    if (!mounted) {
      mounted = true;
      renderer.mount();
    }
    renderer.applyReady(context);
    render();
  });
  let disposeProjects: (() => void) | undefined;
  const releaseLeaseChange = writerLease.onChange(() => {
    if (disposed) return;
    canStart = writerLease.isWriter();
    render();
  });
  void writerLease.ready().then(() => {
    if (disposed) return;
    canStart = writerLease.isWriter();
    render();
  });

  try {
    disposeProjects = await host.onProjects((snapshot) => {
      projects = snapshot;
      if (!projects.projects.some((project) => project.id === activeProjectId)) setActiveProject(projects.projects[0]?.id ?? null);
      else render();
    });
    projects = await host.listProjects();
    setActiveProject(projects.projects[0]?.id ?? null);
  } catch (bootstrapError) {
    disposeReady();
    releaseLeaseChange();
    writerLease.dispose();
    host.dispose();
    throw bootstrapError;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    disposeReady();
    releaseLeaseChange();
    disposeProjects?.();
    projectDisposers.splice(0).forEach((dispose) => dispose());
    renderer.destroy();
    writerLease.dispose();
    host.dispose();
  };
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void (async () => {
    const root = document.getElementById("app");
    if (!root) return;
    const dispose = await bootstrapPage(createHostAdapter(), createPageSurface(createDomUiKit(root)));
    window.addEventListener("beforeunload", dispose, { once: true });
  })();
}
