import { applyHostReady } from "@openchamber/sdk/ui";
import type { GuestProjectsSnapshot, GuestSessionsSnapshot } from "@openchamber/sdk";

import { createHostAdapter, type HostAdapter } from "../src/host-adapter";
import { createDomUiKit, createPanelSurface, type PanelSurface, type PanelSurfaceState, type SurfaceCard } from "../src/render-panel";

const toCards = (snapshot: GuestSessionsSnapshot): SurfaceCard[] => snapshot.sessions.map((session) => ({
  id: session.id,
  title: session.title,
  status: "todo",
  sessionId: session.id,
}));

export const bootstrapPanel = async (host: HostAdapter, renderer: PanelSurface) => {
  let disposed = false;
  let mounted = false;
  let directory: string | null = null;
  let projects: GuestProjectsSnapshot = { kind: "projects", state: "loading", projects: [] };
  let sessions: GuestSessionsSnapshot | undefined;
  let activeProjectId: string | null = null;
  let projectGeneration = 0;
  let disposeProject: (() => void) | undefined;
  let registration = Promise.resolve();

  const render = () => {
    const project = projects.projects.find((item) => item.id === activeProjectId) ?? null;
    const cards = sessions ? toCards(sessions) : [];
    const next: PanelSurfaceState = {
      project: project && { id: project.id, name: project.name },
      active: sessions?.sessions.filter((session) => session.activity === "running" || session.activity === "retrying").length ?? 0,
      review: cards.filter((card) => card.status === "needs_review").length,
      queued: cards.filter((card) => card.status === "todo").length,
      recent: cards.slice(0, 5),
      empty: !project || projects.state !== "ready",
      onOpenSession: (sessionId) => void host.openSession(sessionId),
    };
    renderer.update(next);
  };

  const setActiveProject = (projectId: string | null) => {
    const generation = ++projectGeneration;
    activeProjectId = projectId;
    sessions = undefined;
    disposeProject?.();
    disposeProject = undefined;
    render();
    registration = registration.catch(() => undefined).then(async () => {
      if (disposed || generation !== projectGeneration || !projectId) return;
      const disposeSessions = await host.onSessions(projectId, (snapshot) => {
        if (generation !== projectGeneration || disposed) return;
        sessions = snapshot;
        render();
      });
      if (disposed || generation !== projectGeneration) {
        disposeSessions();
        return;
      }
      disposeProject = disposeSessions;
    });
  };

  const reconcileDirectory = () => {
    const project = projects.projects.find((item) => item.directory === directory) ?? null;
    if (project?.id !== activeProjectId) setActiveProject(project?.id ?? null);
    else render();
  };

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
  const disposeDirectory = host.onDirectory((next) => {
    directory = next;
    reconcileDirectory();
  });
  let disposeProjects: (() => void) | undefined;

  try {
    disposeProjects = await host.onProjects((snapshot) => {
      projects = snapshot;
      reconcileDirectory();
    });
    projects = await host.listProjects();
    reconcileDirectory();
  } catch (error) {
    disposeReady();
    disposeDirectory();
    host.dispose();
    throw error;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    disposeReady();
    disposeDirectory();
    disposeProjects?.();
    disposeProject?.();
    renderer.destroy();
    host.dispose();
  };
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void (async () => {
    const root = document.getElementById("app");
    if (!root) return;
    const dispose = await bootstrapPanel(createHostAdapter(), createPanelSurface(createDomUiKit(root)));
    window.addEventListener("beforeunload", dispose, { once: true });
  })();
}
