import type { Board, BoardStore } from "./board-store";
import type { HostAdapter } from "./host-adapter";
import type { BoardCard, SessionRole } from "./schema";
import type { createWriterLease } from "./writer-lease";

export interface SessionLabel {
  sessionId: string;
  role: SessionRole;
}

export type SessionWorkflowStore = Pick<
  BoardStore,
  | "getCard"
  | "getProject"
  | "loadBoard"
  | "beginSessionStart"
  | "completeSessionStart"
  | "recordSkippedSessionStart"
  | "clearPendingStart"
>;

const requestId = (): string => crypto.randomUUID();

const isDataRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const itemRole = (session: { items: Array<{ data?: unknown }> }, projectId: string): SessionRole | undefined => {
  for (const item of session.items) {
    const data = item.data;
    if (
      isDataRecord(data)
      && data.schema === "openchamber-loop-kanban/v1"
      && data.projectId === projectId
      && (data.role === "main" || data.role === "review")
    ) return data.role;
  }
  return undefined;
};

const assertStartPayload = (card: BoardCard, role: SessionRole): string => {
  const text = card.prompt.trim();
  if (!text) throw new Error("Session text must not be empty");
  if (text.length > 16_000) throw new Error("Session text exceeds 16000 characters");
  if (card.title.length > 200) throw new Error("Session title exceeds 200 characters");
  if (card.id.length > 128) throw new Error("Session ID exceeds 128 characters");
  const data = { schema: "openchamber-loop-kanban/v1", projectId: card.projectId, cardId: card.id, role };
  if (JSON.stringify(data).length > 16_000) throw new Error("Session item data exceeds 16000 characters");
  return text;
};

export const createSessionWorkflow = (
  adapter: HostAdapter,
  store: SessionWorkflowStore,
  lease?: ReturnType<typeof createWriterLease>,
) => {
  const inFlight = new Set<string>();
  const mainReservations = new Map<string, Set<string>>();
  const sessionRoles = new Map<string, SessionRole>();

  const releaseReservation = (projectId: string, cardId: string): void => {
    const reservations = mainReservations.get(projectId);
    if (!reservations) return;
    reservations.delete(cardId);
    if (reservations.size === 0) mainReservations.delete(projectId);
  };

  const start = async (cardId: string, role: SessionRole): Promise<string | undefined> => {
    const card = await store.getCard(cardId);
    const text = assertStartPayload(card, role);
    if (
      card.pendingStartRole !== null
      || (role === "main" && (card.status !== "todo" || card.mainSessionId !== null))
      || (role === "review" && (card.status !== "in_progress" || card.reviewSessionId !== null || card.worktreeDirectory === null))
      || inFlight.has(cardId)
    ) throw new Error("START_IN_PROGRESS");
    inFlight.add(cardId);
    let reserved = false;
    try {
      if (lease) {
        await lease.ready();
        if (!lease.isWriter()) throw new Error("BOARD_READ_ONLY");
      }
      const project = await store.getProject(card.projectId);
      if (!project) throw new Error("Project not found");
      const board = await store.loadBoard(card.projectId);
      const reservations = mainReservations.get(card.projectId) ?? new Set<string>();
      const occupied = board.in_progress.length
        + board.todo.filter((item) => item.pendingStartRole === "main").length
        + reservations.size;
      if (role === "main" && occupied >= project.concurrencyLimit) throw new Error("PROJECT_CONCURRENCY_LIMIT");
      if (role === "main") {
        reservations.add(cardId);
        mainReservations.set(card.projectId, reservations);
        reserved = true;
      }
      const pendingRequestId = requestId();
      await store.beginSessionStart(cardId, { role, requestId: pendingRequestId });
      if (reserved) {
        releaseReservation(card.projectId, cardId);
        reserved = false;
      }
      const result = role === "main"
        ? await adapter.startMain({ projectId: card.projectId, cardId: card.id, title: card.title, worktreeName: card.id, prompt: text })
        : await adapter.startReview({ projectId: card.projectId, cardId: card.id, title: card.title, directory: card.worktreeDirectory!, prompt: text });

      const directory = result.directory ?? result.worktree?.directory;
      const branch = result.worktree?.branch;
      if (result.sessionId === null) {
        await store.recordSkippedSessionStart(cardId, { role, requestId: pendingRequestId, directory, branch });
        throw new Error(result.failure || "Session start failed");
      }
      await store.completeSessionStart(cardId, {
        role,
        requestId: pendingRequestId,
        sessionId: result.sessionId,
        linked: result.linked ?? true,
        directory,
        branch,
        targetStatus: role === "main" ? "in_progress" : "needs_review",
      });
      sessionRoles.set(result.sessionId, role);
      const notices: string[] = [];
      if ((result.linked ?? true) === false) notices.push("Session created but extension item was not linked");
      if (result.sent !== "sent") notices.push(`Session created with status "${result.sent}"; no automatic retry will run`);
      return notices.join(" ") || undefined;
    } finally {
      inFlight.delete(cardId);
      if (reserved) releaseReservation(card.projectId, cardId);
    }
  };

  const bindSessionLabels = async (projectId: string, listener: (labels: SessionLabel[]) => void): Promise<() => void> => {
    const board: Board = await store.loadBoard(projectId);
    for (const card of [...board.todo, ...board.in_progress, ...board.needs_review, ...board.done]) {
      if (card.mainSessionId) sessionRoles.set(card.mainSessionId, "main");
      if (card.reviewSessionId) sessionRoles.set(card.reviewSessionId, "review");
    }
    return adapter.onSessions(projectId, (snapshot) => {
      const labels = snapshot.sessions.flatMap((session) => {
        const role = sessionRoles.get(session.id) ?? itemRole(session, projectId);
        return role ? [{ sessionId: session.id, role }] : [];
      });
      listener(labels);
    });
  };

  const clearPending = (cardId: string) => store.clearPendingStart(cardId);

  const adoptDiscoveredSession = async (cardId: string): Promise<void> => {
    const card = await store.getCard(cardId);
    const role = card.pendingStartRole;
    const pendingRequestId = card.pendingRequestId;
    if (!role || !pendingRequestId) throw new Error("No pending session start");
    const sessions = await adapter.listSessions(card.projectId);
    const matches = sessions.sessions.filter((session) => session.items.some((item) => {
      const data = item.data;
      return isDataRecord(data)
        && data.schema === "openchamber-loop-kanban/v1"
        && data.projectId === card.projectId
        && data.cardId === card.id
        && data.role === role;
    }));
    if (matches.length !== 1) {
      const available = sessions.sessions.map((session) => session.id).join(", ") || "none";
      throw new Error(`No unique discovered session (native sessions: ${available})`);
    }
    const session = matches[0]!;
    await store.completeSessionStart(cardId, {
      role,
      requestId: pendingRequestId,
      sessionId: session.id,
      linked: true,
      directory: session.worktree?.directory ?? session.directory,
      branch: session.worktree?.branch,
      targetStatus: role === "main" ? "in_progress" : "needs_review",
    });
    sessionRoles.set(session.id, role);
  };

  return {
    startMain: (cardId: string) => start(cardId, "main"),
    startReview: (cardId: string) => start(cardId, "review"),
    bindSessionLabels,
    adoptDiscoveredSession,
    clearPending,
    open: (sessionId: string) => adapter.openSession(sessionId),
  };
};
