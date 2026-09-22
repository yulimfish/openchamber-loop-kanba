import type { JsonValue } from "@openchamber/sdk";

import type { BoardStorage } from "./host-adapter";
import {
  assertBoardCard,
  assertBoardProject,
  BOARD_SCHEMA,
  cardKey,
  CARD_KEY_PREFIX,
  type BoardCard,
  type BoardProject,
  type CardStatus,
  type SessionRole,
  projectKey,
} from "./schema";

const MAX_STORAGE_VALUE_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();
const statuses: CardStatus[] = ["todo", "in_progress", "needs_review", "done"];

export interface Board {
  todo: BoardCard[];
  in_progress: BoardCard[];
  needs_review: BoardCard[];
  done: BoardCard[];
}

export interface CreateCardInput {
  title: string;
  prompt: string;
}

export interface CompleteSessionStartInput {
  role: SessionRole;
  requestId: string;
  sessionId: string;
  linked: boolean;
  directory?: string | null;
  branch?: string | null;
  targetStatus: CardStatus;
}

export interface RecordSkippedSessionStartInput {
  role: SessionRole;
  requestId: string;
  directory?: string | null;
  branch?: string | null;
}

export const assertStorageValueSize = (value: JsonValue): void => {
  if (textEncoder.encode(JSON.stringify(value)).byteLength > MAX_STORAGE_VALUE_BYTES) {
    throw new Error("Storage value exceeds 64 KiB");
  }
};

const assertNonEmpty = (value: string, label: string): void => {
  if (!value.trim()) throw new Error(`${label} must not be empty`);
};

const assertCardInput = ({ title, prompt }: CreateCardInput): void => {
  assertNonEmpty(title, "Card title");
  assertNonEmpty(prompt, "Card prompt");
  if (title.length > 200) throw new Error("Card title exceeds 200 characters");
  if (prompt.length > 16_000) throw new Error("Card prompt exceeds 16000 characters");
};

const emptyBoard = (): Board => ({ todo: [], in_progress: [], needs_review: [], done: [] });

export const createBoardStore = (storage: BoardStorage) => {
  const projectWriteQueues = new Map<string, Promise<void>>();

  const enqueueProjectWrite = <T>(projectId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = projectWriteQueues.get(projectId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const queue = result.then(() => undefined, () => undefined);
    projectWriteQueues.set(projectId, queue);
    void queue.finally(() => {
      if (projectWriteQueues.get(projectId) === queue) projectWriteQueues.delete(projectId);
    });
    return result;
  };

  const getCard = async (cardId: string): Promise<BoardCard> => {
    assertNonEmpty(cardId, "Card ID");
    const value = await storage.get(cardKey(cardId));
    assertBoardCard(value);
    if (value.id !== cardId) throw new Error("Card storage key does not match card ID");
    return value;
  };

  const loadBoard = async (projectId: string): Promise<Board> => {
    assertNonEmpty(projectId, "Project ID");
    const board = emptyBoard();
    const keys = await storage.keys();

    for (const key of keys) {
      if (!key.startsWith(CARD_KEY_PREFIX)) continue;
      const value = await storage.get(key);
      assertBoardCard(value);
      if (key !== cardKey(value.id)) throw new Error("Card storage key does not match card ID");
      if (value.projectId === projectId) board[value.status].push(value);
    }

    for (const status of statuses) {
      board[status].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
      for (let index = 1; index < board[status].length; index += 1) {
        if (board[status][index - 1]!.position >= board[status][index]!.position) {
          throw new Error("Card positions must be monotonic within a column");
        }
      }
    }
    return board;
  };

  const nextPosition = async (projectId: string, status: CardStatus): Promise<number> => {
    const cards = (await loadBoard(projectId))[status];
    return cards.length === 0 ? 0 : cards[cards.length - 1]!.position + 1;
  };

  const writeCard = async (card: BoardCard): Promise<void> => {
    assertBoardCard(card);
    assertStorageValueSize(card);
    await storage.set(cardKey(card.id), card);
  };

  const getProject = async (projectId: string): Promise<BoardProject | undefined> => {
    assertNonEmpty(projectId, "Project ID");
    const value = await storage.get(await projectKey(projectId));
    if (value === undefined) return undefined;
    assertBoardProject(value);
    if (value.projectId !== projectId) throw new Error("Project storage key does not match project ID");
    return value;
  };

  const createProject = async (projectId: string, concurrencyLimit: number): Promise<BoardProject> => {
    assertNonEmpty(projectId, "Project ID");
    const project: BoardProject = { schema: BOARD_SCHEMA, projectId, concurrencyLimit, version: 1 };
    assertBoardProject(project);
    assertStorageValueSize(project);
    await storage.set(await projectKey(projectId), project);
    return project;
  };

  const createCard = async (projectId: string, input: CreateCardInput): Promise<BoardCard> => {
    assertNonEmpty(projectId, "Project ID");
    assertCardInput(input);
    return enqueueProjectWrite(projectId, async () => {
      const project = await getProject(projectId);
      assertBoardProject(project);

      const now = new Date().toISOString();
      const card: BoardCard = {
        schema: BOARD_SCHEMA,
        id: crypto.randomUUID(),
        projectId,
        title: input.title,
        prompt: input.prompt,
        status: "todo",
        position: await nextPosition(projectId, "todo"),
        worktreeDirectory: null,
        worktreeBranch: null,
        mainSessionId: null,
        mainSessionLinked: null,
        reviewSessionId: null,
        reviewSessionLinked: null,
        pendingStartRole: null,
        pendingRequestId: null,
        pendingStartedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await writeCard(card);
      return card;
    });
  };

  const editCard = async (cardId: string, input: CreateCardInput): Promise<BoardCard> => {
    assertCardInput(input);
    const current = await getCard(cardId);
    const next = { ...current, ...input, updatedAt: new Date().toISOString() };
    await writeCard(next);
    return next;
  };

  const moveCard = async (cardId: string, nextStatus: CardStatus, cause: "user" | "session-summary" | "activity" | "outcome"): Promise<BoardCard> => {
    if (cause !== "user") throw new Error("Only explicit user actions may move a card");
    const current = await getCard(cardId);
    return enqueueProjectWrite(current.projectId, async () => {
      const persisted = await getCard(cardId);
      const next: BoardCard = {
        ...persisted,
        status: nextStatus,
        position: persisted.status === nextStatus ? persisted.position : await nextPosition(persisted.projectId, nextStatus),
        updatedAt: new Date().toISOString(),
      };
      await writeCard(next);
      return next;
    });
  };

  const beginSessionStart = async (cardId: string, input: { role: SessionRole; requestId: string }): Promise<BoardCard> => {
    assertNonEmpty(input.requestId, "Start request ID");
    const current = await getCard(cardId);
    if (current.pendingStartRole !== null) throw new Error("START_IN_PROGRESS");
    const next: BoardCard = {
      ...current,
      pendingStartRole: input.role,
      pendingRequestId: input.requestId,
      pendingStartedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeCard(next);
    return next;
  };

  const completeSessionStart = async (cardId: string, input: CompleteSessionStartInput): Promise<BoardCard> => {
    assertNonEmpty(input.requestId, "Start request ID");
    assertNonEmpty(input.sessionId, "Session ID");
    const current = await getCard(cardId);
    if (current.pendingStartRole !== input.role || current.pendingRequestId !== input.requestId) {
      throw new Error("No matching pending session start");
    }
    return enqueueProjectWrite(current.projectId, async () => {
      const persisted = await getCard(cardId);
      if (persisted.pendingStartRole !== input.role || persisted.pendingRequestId !== input.requestId) {
        throw new Error("No matching pending session start");
      }
      const next: BoardCard = {
        ...persisted,
        status: input.targetStatus,
        position: persisted.status === input.targetStatus ? persisted.position : await nextPosition(persisted.projectId, input.targetStatus),
        worktreeDirectory: input.directory === undefined ? persisted.worktreeDirectory : input.directory,
        worktreeBranch: input.branch === undefined ? persisted.worktreeBranch : input.branch,
        ...(input.role === "main"
          ? { mainSessionId: input.sessionId, mainSessionLinked: input.linked }
          : { reviewSessionId: input.sessionId, reviewSessionLinked: input.linked }),
        pendingStartRole: null,
        pendingRequestId: null,
        pendingStartedAt: null,
        updatedAt: new Date().toISOString(),
      };
      await writeCard(next);
      return next;
    });
  };

  const recordSkippedSessionStart = async (cardId: string, input: RecordSkippedSessionStartInput): Promise<BoardCard> => {
    assertNonEmpty(input.requestId, "Start request ID");
    const current = await getCard(cardId);
    if (current.pendingStartRole !== input.role || current.pendingRequestId !== input.requestId) {
      throw new Error("No matching pending session start");
    }
    return enqueueProjectWrite(current.projectId, async () => {
      const persisted = await getCard(cardId);
      if (persisted.pendingStartRole !== input.role || persisted.pendingRequestId !== input.requestId) {
        throw new Error("No matching pending session start");
      }
      const targetStatus = input.role === "main" ? "todo" : "in_progress";
      const next: BoardCard = {
        ...persisted,
        status: targetStatus,
        position: persisted.status === targetStatus ? persisted.position : await nextPosition(persisted.projectId, targetStatus),
        worktreeDirectory: input.directory === undefined ? persisted.worktreeDirectory : input.directory,
        worktreeBranch: input.branch === undefined ? persisted.worktreeBranch : input.branch,
        pendingStartRole: null,
        pendingRequestId: null,
        pendingStartedAt: null,
        updatedAt: new Date().toISOString(),
      };
      await writeCard(next);
      return next;
    });
  };

  const clearPendingStart = async (cardId: string): Promise<BoardCard> => {
    const current = await getCard(cardId);
    if (current.pendingStartRole === null) throw new Error("No pending session start");
    const next: BoardCard = {
      ...current,
      pendingStartRole: null,
      pendingRequestId: null,
      pendingStartedAt: null,
      updatedAt: new Date().toISOString(),
    };
    await writeCard(next);
    return next;
  };

  return {
    beginSessionStart,
    clearPendingStart,
    completeSessionStart,
    createCard,
    createProject,
    editCard,
    getCard,
    getProject,
    loadBoard,
    moveCard,
    recordSkippedSessionStart,
  };
};

export type BoardStore = ReturnType<typeof createBoardStore>;
