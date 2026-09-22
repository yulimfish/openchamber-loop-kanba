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
import type { UiKit, UiSlot } from "../../src/render-panel";
import type {
  BadgeProps,
  BannerProps,
  ButtonProps,
  EmptyProps,
  Handle,
  ListProps,
  SelectProps,
  TextFieldProps,
  TextProps,
} from "@openchamber/sdk/ui";

type FakeHostOptions = {
  deferNextWorktreeRegistration?: boolean;
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

type FakeSlot = { name: string };

export const createFakeUiKit = (): UiKit & {
  mountCount: number;
  visibleText(name: string): string | undefined;
  click(name: string): void;
  select(name: string, id: string): void;
  type(name: string, value: string): void;
} => {
  const text = new Map<string, string>();
  const buttons = new Map<string, () => void>();
  const selects = new Map<string, (id: string) => void>();
  const textFields = new Map<string, (value: string) => void>();
  let mountCount = 0;
  const slot = (value: UiSlot) => value as FakeSlot;
  const handle = <T extends object>(value: UiSlot, initial: T): Handle<T> => {
    const update = (next: Partial<T>) => {
      const props = { ...initial, ...next } as T & { label?: string; text?: string; items?: Array<{ title: string }> };
      Object.assign(initial, next);
      if (props.label !== undefined) text.set(slot(value).name, props.label);
      if (props.text !== undefined) text.set(slot(value).name, props.text);
      if (props.items !== undefined) text.set(slot(value).name, props.items.map((item) => item.title).join("|"));
    };
    update(initial);
    return { update, dispose: () => undefined };
  };

  return {
    documentElement: { lang: "en" },
    get mountCount() {
      return mountCount;
    },
    visibleText: (name) => text.get(name),
    click: (name) => buttons.get(name)?.(),
    select: (name, id) => selects.get(name)?.(id),
    type: (name, value) => textFields.get(name)?.(value),
    mountRoot: (name) => {
      mountCount += 1;
      return { name };
    },
    createSlot: (_parent, name) => ({ name }),
    setHidden: () => undefined,
    mountBadge: (value, props: BadgeProps) => handle(value, props),
    mountBanner: (value, props: BannerProps) => handle(value, props),
    mountButton: (value, props: ButtonProps) => {
      buttons.set(slot(value).name, props.onClick);
      return handle(value, props);
    },
    mountEmpty: (value, props: EmptyProps) => handle(value, props),
    mountList: (value, props: ListProps) => handle(value, props),
    mountSelect: (value, props: SelectProps) => {
      selects.set(slot(value).name, props.onChange);
      return handle(value, props);
    },
    mountText: (value, props: TextProps) => handle(value, props),
    mountTextField: (value, props: TextFieldProps) => {
      textFields.set(slot(value).name, props.onChange);
      return handle(value, props);
    },
  };
};

export const createFakeHost = (options: FakeHostOptions = {}) => {
  const subscriptions = new Set<() => void>();
  const readyListeners = new Set<(context: HostReadyContext) => void>();
  const directoryListeners = new Set<(directory: string | null) => void>();
  const projectListeners = new Set<(snapshot: GuestProjectsSnapshot) => void>();
  const worktreeListeners = new Map<string, Set<(snapshot: GuestWorktreesSnapshot) => void>>();
  const sessionListeners = new Map<string, Set<(snapshot: GuestSessionsSnapshot) => void>>();
  const retiredSessionListeners = new Map<string, Set<(snapshot: GuestSessionsSnapshot) => void>>();
  const storage = createMemoryStorage();
  let peakSubscriptionCount = 0;
  const workspaceSubscriptions = new Set<() => void>();
  let peakWorkspaceSubscriptionCount = 0;

  let projects = emptyProjects();
  const worktrees = new Map<string, GuestWorktreesSnapshot>();
  const sessions = new Map<string, GuestSessionsSnapshot>();
  let nextStart = options.nextStart;
  let nextStartError = options.nextStartError;
  let releaseDeferredWorktreeRegistration: (() => void) | undefined;

  const addSubscription = <T>(listeners: Set<T>, listener: T, onDispose?: () => void, workspace = false) => {
    listeners.add(listener);
    const dispose = () => {
      listeners.delete(listener);
      onDispose?.();
      subscriptions.delete(dispose);
      workspaceSubscriptions.delete(dispose);
    };
    subscriptions.add(dispose);
    peakSubscriptionCount = Math.max(peakSubscriptionCount, subscriptions.size);
    if (workspace) {
      workspaceSubscriptions.add(dispose);
      peakWorkspaceSubscriptionCount = Math.max(peakWorkspaceSubscriptionCount, workspaceSubscriptions.size);
    }
    return dispose;
  };

  const projectSubscription = (projectId: string, listener: (snapshot: GuestWorktreesSnapshot) => void) => {
    const listeners = worktreeListeners.get(projectId) ?? new Set();
    worktreeListeners.set(projectId, listeners);
    return addSubscription(listeners, listener, undefined, true);
  };

  const sessionSubscription = (projectId: string, listener: (snapshot: GuestSessionsSnapshot) => void) => {
    const listeners = sessionListeners.get(projectId) ?? new Set();
    sessionListeners.set(projectId, listeners);
    return addSubscription(listeners, listener, () => {
      const retired = retiredSessionListeners.get(projectId) ?? new Set();
      retiredSessionListeners.set(projectId, retired);
      retired.add(listener);
    }, true);
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
    peakSubscriptionCount: () => peakSubscriptionCount,
    activeWorkspaceSubscriptionCount: () => workspaceSubscriptions.size,
    peakWorkspaceSubscriptionCount: () => peakWorkspaceSubscriptionCount,
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
    emitStaleSessions: (projectId: string, snapshot: GuestSessionsSnapshot) => {
      retiredSessionListeners.get(projectId)?.forEach((listener) => listener(snapshot));
    },
    releaseDeferredWorktreeRegistration: () => releaseDeferredWorktreeRegistration?.(),
  };

  fake.client = {
    storage,
    onReady: (listener) => addSubscription(readyListeners, listener),
    onDirectory: (listener) => addSubscription(directoryListeners, listener),
    listProjects: async () => projects,
    listWorktrees: async (projectId) => worktrees.get(projectId) ?? emptyWorktrees(projectId),
    listSessions: async (projectId) => sessions.get(projectId) ?? emptySessions(projectId),
    onProjects: async (listener) => addSubscription(projectListeners, listener),
    onWorktrees: async (projectId, listener) => {
      const dispose = projectSubscription(projectId, listener);
      if (!options.deferNextWorktreeRegistration) return dispose;
      options.deferNextWorktreeRegistration = false;
      await new Promise<void>((resolve) => {
        releaseDeferredWorktreeRegistration = resolve;
      });
      return dispose;
    },
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
