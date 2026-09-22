import { applyHostReady } from "@openchamber/sdk/ui";
import type { GuestProjectsSnapshot, GuestSessionsSnapshot, GuestWorktreesSnapshot } from "@openchamber/sdk";

import { createBoardStore, type Board } from "../src/board-store";
import { createHostAdapter, type HostAdapter } from "../src/host-adapter";
import { createDomUiKit, type SurfaceCard } from "../src/render-panel";
import { createPageSurface, type PageSurface, type PageSurfaceState } from "../src/render-page";

const toCards = (board: Board): SurfaceCard[] => [
  ...board.todo,
  ...board.in_progress,
  ...board.needs_review,
  ...board.done,
].map((card) => ({
  id: card.id,
  title: card.title,
  status: card.status,
  sessionId: card.mainSessionId ?? card.reviewSessionId ?? undefined,
}));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load board";

export const bootstrapPage = async (host: HostAdapter, renderer: PageSurface) => {
  const boardStore = createBoardStore(host.storage);
  let disposed = false;
  let mounted = false;
  let projects: GuestProjectsSnapshot = { kind: "projects", state: "loading", projects: [] };
  let worktrees: GuestWorktreesSnapshot | undefined;
  let sessions: GuestSessionsSnapshot | undefined;
  let board: Board | undefined;
  let settings: { concurrencyLimit: number } | undefined;
  let error: string | null = null;
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
      onSelectProject: setActiveProject,
      onNewCard: board ? (draft) => void createCard(draft) : undefined,
      onOpenSession: (sessionId) => void host.openSession(sessionId),
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

  try {
    disposeProjects = await host.onProjects((snapshot) => {
      projects = snapshot;
      if (!projects.projects.some((project) => project.id === activeProjectId)) setActiveProject(projects.projects[0]?.id ?? null);
      else render();
    });
    projects = await host.listProjects();
    setActiveProject(projects.projects[0]?.id ?? null);
  } catch (error) {
    disposeReady();
    host.dispose();
    throw error;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    disposeReady();
    disposeProjects?.();
    projectDisposers.splice(0).forEach((dispose) => dispose());
    renderer.destroy();
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
