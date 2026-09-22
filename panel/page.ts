import { applyHostReady } from "@openchamber/sdk/ui";
import type { GuestProjectsSnapshot, GuestSessionsSnapshot, GuestWorktreesSnapshot } from "@openchamber/sdk";

import { createHostAdapter, type HostAdapter } from "../src/host-adapter";
import { createDomUiKit, type SurfaceCard } from "../src/render-panel";
import { createPageSurface, type PageSurface, type PageSurfaceState } from "../src/render-page";

const toCards = (snapshot: GuestSessionsSnapshot): SurfaceCard[] => snapshot.sessions.map((session) => ({
  id: session.id,
  title: session.title,
  status: "todo",
  sessionId: session.id,
}));

export const bootstrapPage = async (host: HostAdapter, renderer: PageSurface) => {
  let disposed = false;
  let mounted = false;
  let projects: GuestProjectsSnapshot = { kind: "projects", state: "loading", projects: [] };
  let worktrees: GuestWorktreesSnapshot | undefined;
  let sessions: GuestSessionsSnapshot | undefined;
  let activeProjectId: string | null = null;
  let projectGeneration = 0;
  const projectDisposers: Array<() => void> = [];
  let registration = Promise.resolve();

  const render = () => {
    const cards = sessions ? toCards(sessions) : [];
    const next: PageSurfaceState = {
      projects: projects.projects.map(({ id, name }) => ({ id, name })),
      activeProjectId,
      active: sessions?.sessions.filter((session) => session.activity === "running" || session.activity === "retrying").length ?? 0,
      limit: 1,
      cards,
      empty: !activeProjectId || projects.state !== "ready",
      onSelectProject: setActiveProject,
      onOpenSession: (sessionId) => void host.openSession(sessionId),
    };
    renderer.update(next);
  };

  function setActiveProject(projectId: string | null): void {
    const generation = ++projectGeneration;
    activeProjectId = projectId;
    worktrees = undefined;
    sessions = undefined;
    projectDisposers.splice(0).forEach((dispose) => dispose());
    render();
    registration = registration.catch(() => undefined).then(async () => {
      if (disposed || generation !== projectGeneration || !projectId) return;
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
