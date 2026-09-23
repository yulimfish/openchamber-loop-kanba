import type { JsonValue } from "@openchamber/sdk";

export const BOARD_SCHEMA = "openchamber-loop-kanban/v1" as const;
export const CARD_KEY_PREFIX = `${BOARD_SCHEMA}/card/`;
export const PROJECT_KEY_PREFIX = `${BOARD_SCHEMA}/project/`;

export type CardStatus = "todo" | "in_progress" | "needs_review" | "done";
export type SessionRole = "main" | "review";

export interface BoardProject extends Record<string, JsonValue> {
  schema: typeof BOARD_SCHEMA;
  projectId: string;
  concurrencyLimit: number;
  version: number;
}

export interface BoardCard extends Record<string, JsonValue> {
  schema: typeof BOARD_SCHEMA;
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
  pendingStartRole: SessionRole | null;
  pendingRequestId: string | null;
  pendingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const textEncoder = new TextEncoder();

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNullableString = (value: JsonValue | undefined): value is string | null =>
  value === null || isNonEmptyString(value);

const isNullableBoolean = (value: JsonValue | undefined): value is boolean | null =>
  value === null || typeof value === "boolean";

const isCanonicalUuidV4 = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isTimestamp = (value: JsonValue | undefined): value is string =>
  isNonEmptyString(value) && !Number.isNaN(Date.parse(value));

export const isCardStatus = (value: JsonValue | undefined): value is CardStatus =>
  value === "todo" || value === "in_progress" || value === "needs_review" || value === "done";

export function assertBoardProject(value: JsonValue | undefined): asserts value is BoardProject {
  if (
    !isRecord(value)
    || value.schema !== BOARD_SCHEMA
    || !isNonEmptyString(value.projectId)
    || typeof value.concurrencyLimit !== "number"
    || !Number.isInteger(value.concurrencyLimit)
    || value.concurrencyLimit < 1
    || typeof value.version !== "number"
    || !Number.isInteger(value.version)
    || value.version < 1
  ) {
    throw new Error("Invalid board project storage value");
  }
}

export function assertBoardCard(value: JsonValue | undefined): asserts value is BoardCard {
  if (
    !isRecord(value)
    || value.schema !== BOARD_SCHEMA
    || !isCanonicalUuidV4(value.id)
    || !isNonEmptyString(value.projectId)
    || !isNonEmptyString(value.title)
    || value.title.length > 200
    || !isNonEmptyString(value.prompt)
    || value.prompt.length > 16_000
    || !isCardStatus(value.status)
    || typeof value.position !== "number"
    || !Number.isInteger(value.position)
    || value.position < 0
    || !isNullableString(value.worktreeDirectory)
    || !isNullableString(value.worktreeBranch)
    || !isNullableString(value.mainSessionId)
    || !isNullableBoolean(value.mainSessionLinked)
    || !isNullableString(value.reviewSessionId)
    || !isNullableBoolean(value.reviewSessionLinked)
    || (value.pendingStartRole !== null && value.pendingStartRole !== "main" && value.pendingStartRole !== "review")
    || !isNullableString(value.pendingRequestId)
    || (value.pendingStartedAt !== null && !isTimestamp(value.pendingStartedAt))
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || (value.pendingStartRole === null && (value.pendingRequestId !== null || value.pendingStartedAt !== null))
    || (value.pendingStartRole !== null && (value.pendingRequestId === null || value.pendingStartedAt === null))
  ) {
    throw new Error("Invalid board card storage value");
  }
}

export const cardKey = (cardId: string): string => `${CARD_KEY_PREFIX}${cardId}`;

export const projectKey = async (projectId: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(projectId));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${PROJECT_KEY_PREFIX}${hex}`;
};
