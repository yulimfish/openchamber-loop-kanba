import {
  HostRequestError,
  type GuestProjectsSnapshot,
  type GuestSessionsSnapshot,
  type GuestWorktreesSnapshot,
  type HostReadyContext,
  type HostRequestErrorCode,
  type JsonValue,
  type StartSessionRequest,
  type StartSessionResult,
} from "@openchamber/sdk";

import type { HostClientPort } from "../../src/host-adapter";

type FakeHostOptions = {
  nextStart?: StartSessionResult;
  nextStartError?: { code: HostRequestErrorCode; message?: string };
};

const emptyProjects = (): GuestProjectsSnapshot => ({
  kind: "projects",
  state: "ready",
  projects: [],
});

const emptyWorktrees = (projectId: string): GuestWorktreesSnapshot => ({
  kind: "worktrees",
  projectId,
  state: "ready",
  worktrees: [],
});

const emptySessions = (projectId: string): GuestSessionsSnapshot => ({
  kind: "sessions",
  projectId,
  state: "ready",
  coverage: [],
  sessions: [],
});

export const createMemoryStorage = () => {
  const values = new Map<string, JsonValue>();
  let nextSetError: Error | undefined;

  return {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: JsonValue) => {
      if (nextSetError) {
        const error = nextSetError;
        nextSetError = undefined;
        throw error;
      }
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
    keys: async () => [...values.keys()],
    failNextSet: (error: Error) => {
      nextSetError = error;
    },
  };
};

export const createUnsafeBoardStore = <T extends { id: string }>(card: T) => ({
  getCard: async (cardId: string) => {
    if (cardId !== card.id) throw new Error("Card not found");
    return card;
  },
});

export const createFakeHost = (options: FakeHostOptions = {}) => {
  const subscriptions = new Set<() => void>();
  const readyListeners = new Set<(context: HostReadyContext) => void>();
  const directoryListeners = new Set<(directory: string | null) => void>();
  const projectListeners = new Set<(snapshot: GuestProjectsSnapshot) => void>();
  const worktreeListeners = new Map<string, Set<(snapshot: GuestWorktreesSnapshot) => void>>();
  const sessionListeners = new Map<string, Set<(snapshot: GuestSessionsSnapshot) => void>>();
  const storage = createMemoryStorage();

  let projects = emptyProjects();
  const worktrees = new Map<string, GuestWorktreesSnapshot>();
  const sessions = new Map<string, GuestSessionsSnapshot>();
  let nextStart = options.nextStart;
  let nextStartError = options.nextStartError;

  const addSubscription = <T>(listeners: Set<T>, listener: T) => {
    listeners.add(listener);
    const dispose = () => {
      listeners.delete(listener);
      subscriptions.delete(dispose);
    };
    subscriptions.add(dispose);
    return dispose;
  };

  const projectSubscription = (projectId: string, listener: (snapshot: GuestWorktreesSnapshot) => void) => {
    const listeners = worktreeListeners.get(projectId) ?? new Set();
    worktreeListeners.set(projectId, listeners);
    return addSubscription(listeners, listener);
  };

  const sessionSubscription = (projectId: string, listener: (snapshot: GuestSessionsSnapshot) => void) => {
    const listeners = sessionListeners.get(projectId) ?? new Set();
    sessionListeners.set(projectId, listeners);
    return addSubscription(listeners, listener);
  };

  const openedSessionIds: string[] = [];
  const startRequests: StartSessionRequest[] = [];
  const fake = {
    client: undefined as unknown as HostClientPort,
    openedSessionIds,
    startRequests,
    disposed: false,
    storage,
    activeSubscriptionCount: () => subscriptions.size,
    setNextStart: (result: StartSessionResult) => {
      nextStart = result;
      nextStartError = undefined;
    },
    setNextStartError: (error: { code: HostRequestErrorCode; message?: string }) => {
      nextStartError = error;
    },
    emitReady: (context: HostReadyContext) => {
      readyListeners.forEach((listener) => listener(context));
    },
    emitDirectory: (directory: string | null) => {
      directoryListeners.forEach((listener) => listener(directory));
    },
    emitProjects: (snapshot: GuestProjectsSnapshot) => {
      projects = snapshot;
      projectListeners.forEach((listener) => listener(snapshot));
    },
    emitWorktrees: (projectId: string, snapshot: GuestWorktreesSnapshot) => {
      worktrees.set(projectId, snapshot);
      worktreeListeners.get(projectId)?.forEach((listener) => listener(snapshot));
    },
    emitSessions: (projectId: string, snapshot: GuestSessionsSnapshot) => {
      sessions.set(projectId, snapshot);
      sessionListeners.get(projectId)?.forEach((listener) => listener(snapshot));
    },
  };

  fake.client = {
    storage,
    onReady: (listener) => addSubscription(readyListeners, listener),
    onDirectory: (listener) => addSubscription(directoryListeners, listener),
    listProjects: async () => projects,
    listWorktrees: async (projectId) => worktrees.get(projectId) ?? emptyWorktrees(projectId),
    listSessions: async (projectId) => sessions.get(projectId) ?? emptySessions(projectId),
    onProjects: async (listener) => addSubscription(projectListeners, listener),
    onWorktrees: async (projectId, listener) => projectSubscription(projectId, listener),
    onSessions: async (projectId, listener) => sessionSubscription(projectId, listener),
    startSession: async (request) => {
      startRequests.push(request);
      if (nextStartError) {
        throw new HostRequestError(nextStartError.code, nextStartError.message ?? nextStartError.code);
      }
      return nextStart ?? { sessionId: "session-1", sent: "sent" };
    },
    openSession: async (sessionId) => {
      openedSessionIds.push(sessionId);
    },
    dispose: () => {
      fake.disposed = true;
    },
  };

  return fake;
};
