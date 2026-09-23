import {
  connectHost,
  type GuestProjectsSnapshot,
  type GuestSessionsSnapshot,
  type GuestWorktreesSnapshot,
  type HostReadyContext,
  type HostRequestErrorCode,
  type JsonValue,
  type StartSessionResult,
} from "@openchamber/sdk";

export type HostFailureCode = HostRequestErrorCode;

export type HostClientPort = Pick<
  ReturnType<typeof connectHost>,
  | "storage"
  | "onReady"
  | "onDirectory"
  | "listProjects"
  | "listWorktrees"
  | "listSessions"
  | "onProjects"
  | "onWorktrees"
  | "onSessions"
  | "startSession"
  | "openSession"
  | "dispose"
>;

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

const itemData = (projectId: string, cardId: string, role: "main" | "review") => ({
  schema: "openchamber-loop-kanban/v1",
  projectId,
  cardId,
  role,
});

export const hostFailureMessage = (code: HostFailureCode): string => {
  const messages: Partial<Record<HostFailureCode, string>> = {
    NOT_GRANTED: "OpenChamber permission was not granted.",
    SESSION_BUSY: "The native session is busy.",
    NO_SESSION: "The native session is no longer available.",
    NO_DIRECTORY: "Open a project directory before continuing.",
    HOST_TIMEOUT: "OpenChamber did not confirm the request in time. Inspect the native project before clearing pending.",
    DISABLED: "This OpenChamber capability is disabled.",
    HOST_UNAVAILABLE: "OpenChamber is unavailable.",
  };

  return messages[code] ?? "OpenChamber rejected the request.";
};

export const createHostAdapter = (client: HostClientPort = connectHost()): HostAdapter => ({
  storage: client.storage,
  onReady: client.onReady,
  onDirectory: client.onDirectory,
  listProjects: client.listProjects,
  listWorktrees: client.listWorktrees,
  listSessions: client.listSessions,
  onProjects: client.onProjects,
  onWorktrees: client.onWorktrees,
  onSessions: client.onSessions,
  startMain: ({ projectId, cardId, title, worktreeName, prompt }) =>
    client.startSession({
      providerId: "openchamber-loop-kanban",
      id: cardId,
      title,
      url: "https://openchamber.dev",
      text: prompt,
      projectId,
      worktree: { kind: "new", name: worktreeName },
      navigation: "preserve",
      data: itemData(projectId, cardId, "main"),
    }),
  startReview: ({ projectId, cardId, title, directory, prompt }) =>
    client.startSession({
      providerId: "openchamber-loop-kanban",
      id: cardId,
      title,
      url: "https://openchamber.dev",
      text: prompt,
      projectId,
      worktree: { kind: "existing", directory },
      navigation: "preserve",
      data: itemData(projectId, cardId, "review"),
    }),
  openSession: client.openSession,
  dispose: client.dispose,
});
