import {
  mountBadge,
  mountBanner,
  mountButton,
  mountEmpty,
  mountList,
  mountSelect,
  mountText,
  mountTextField,
  type BadgeProps,
  type BannerProps,
  type ButtonProps,
  type EmptyProps,
  type Handle,
  type ListProps,
  type SelectProps,
  type TextFieldProps,
  type TextProps,
} from "@openchamber/sdk/ui";
import type { HostReadyContext } from "@openchamber/sdk";

export type UiSlot = object;

export interface UiKit {
  readonly documentElement: { lang: string };
  mountRoot(name: string): UiSlot;
  createSlot(parent: UiSlot, name: string): UiSlot;
  setHidden(slot: UiSlot, hidden: boolean): void;
  mountBadge(slot: UiSlot, props: BadgeProps): Handle<BadgeProps>;
  mountBanner(slot: UiSlot, props: BannerProps): Handle<BannerProps>;
  mountButton(slot: UiSlot, props: ButtonProps): Handle<ButtonProps>;
  mountEmpty(slot: UiSlot, props: EmptyProps): Handle<EmptyProps>;
  mountList(slot: UiSlot, props: ListProps): Handle<ListProps>;
  mountSelect(slot: UiSlot, props: SelectProps): Handle<SelectProps>;
  mountText(slot: UiSlot, props: TextProps): Handle<TextProps>;
  mountTextField(slot: UiSlot, props: TextFieldProps): Handle<TextFieldProps>;
}

export const createDomUiKit = (root: Element): UiKit => {
  const createSlot = (parent: UiSlot, name: string): UiSlot => {
    const slot = root.ownerDocument.createElement("section");
    slot.dataset.loopKanbaSlot = name;
    (parent as Element).append(slot);
    return slot;
  };
  const element = (slot: UiSlot) => slot as Element;

  return {
    documentElement: root.ownerDocument.documentElement,
    mountRoot: () => root,
    createSlot,
    setHidden: (slot, hidden) => {
      (slot as HTMLElement).hidden = hidden;
    },
    mountBadge: (slot, props) => mountBadge(element(slot), props),
    mountBanner: (slot, props) => mountBanner(element(slot), props),
    mountButton: (slot, props) => mountButton(element(slot), props),
    mountEmpty: (slot, props) => mountEmpty(element(slot), props),
    mountList: (slot, props) => mountList(element(slot), props),
    mountSelect: (slot, props) => mountSelect(element(slot), props),
    mountText: (slot, props) => mountText(element(slot), props),
    mountTextField: (slot, props) => mountTextField(element(slot), props),
  };
};

type MessageKey =
  | "active"
  | "adoptSession"
  | "automationUnavailable"
  | "clearPending"
  | "done"
  | "inProgress"
  | "limit"
  | "moveDone"
  | "needsReview"
  | "newCard"
  | "noProject"
  | "openBoardGuidance"
  | "project"
  | "prompt"
  | "queued"
  | "recentCards"
  | "openMain"
  | "openReview"
  | "startMain"
  | "startReview"
  | "todo"
  | "title";

const messages: Record<"en" | "zh-CN", Record<MessageKey, string>> = {
  en: {
    active: "Active",
    adoptSession: "Adopt discovered session",
    automationUnavailable: "Automation unavailable on this OpenChamber version",
    clearPending: "Clear pending after native inspection",
    done: "Done",
    inProgress: "In progress",
    limit: "Limit",
    moveDone: "Move to Done",
    needsReview: "Needs review",
    newCard: "New card",
    noProject: "Open a project to see its board.",
    openBoardGuidance: "Open the Extension page to manage the full board.",
    project: "Project",
    prompt: "Prompt",
    queued: "Queued",
    recentCards: "Recent cards",
    openMain: "Open Main",
    openReview: "Open Review",
    startMain: "Start Main",
    startReview: "Start Review",
    todo: "To do",
    title: "Title",
  },
  "zh-CN": {
    active: "进行中",
    adoptSession: "认领已发现会话",
    automationUnavailable: "当前 OpenChamber 版本不支持自动化",
    clearPending: "原生检查后清除待处理",
    done: "已完成",
    inProgress: "处理中",
    limit: "上限",
    moveDone: "移至已完成",
    needsReview: "待审查",
    newCard: "新建卡片",
    noProject: "打开项目以查看看板。",
    openBoardGuidance: "打开扩展页面以管理完整看板。",
    project: "项目",
    prompt: "任务说明",
    queued: "排队中",
    recentCards: "最近卡片",
    openMain: "打开 Main",
    openReview: "打开 Review",
    startMain: "启动 Main",
    startReview: "启动 Review",
    todo: "待办",
    title: "标题",
  },
};

export const formatMessage = (locale: string, key: MessageKey): string =>
  (messages[locale === "zh-CN" ? "zh-CN" : "en"])[key];

export interface SurfaceCard {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "needs_review" | "done";
  mainSessionId?: string;
  reviewSessionId?: string;
  pendingStartRole?: "main" | "review";
}

export interface PanelSurfaceState {
  project: { id: string; name: string } | null;
  active: number;
  review: number;
  queued: number;
  recent: SurfaceCard[];
  empty: boolean;
  onOpenSession?: (sessionId: string) => void;
}

export interface PanelSurface {
  readonly documentElement: { lang: string };
  mount(): void;
  applyReady(context: HostReadyContext): void;
  update(state: Partial<PanelSurfaceState>): void;
  destroy(): void;
}

const initialPanelState: PanelSurfaceState = {
  project: null,
  active: 0,
  review: 0,
  queued: 0,
  recent: [],
  empty: true,
};

export const createPanelSurface = (ui: UiKit): PanelSurface => {
  let locale = "en";
  let mounted = false;
  let state = initialPanelState;
  let emptySlot: UiSlot | undefined;
  const handles: Array<Handle<unknown>> = [];
  let projectText: Handle<TextProps> | undefined;
  let activeBadge: Handle<BadgeProps> | undefined;
  let reviewBadge: Handle<BadgeProps> | undefined;
  let queuedBadge: Handle<BadgeProps> | undefined;
  let recentHeading: Handle<TextProps> | undefined;
  let recentCards: Handle<ListProps> | undefined;
  let empty: Handle<EmptyProps> | undefined;
  let openBoard: Handle<TextProps> | undefined;

  const render = () => {
    if (!mounted) return;
    const label = (key: MessageKey) => formatMessage(locale, key);
    projectText?.update({ text: state.project ? `${label("project")}: ${state.project.name}` : label("noProject") });
    activeBadge?.update({ label: `${label("active")}: ${state.active}` });
    reviewBadge?.update({ label: `${label("needsReview")}: ${state.review}` });
    queuedBadge?.update({ label: `${label("queued")}: ${state.queued}` });
    recentHeading?.update({ text: label("recentCards") });
    recentCards?.update({
      ariaLabel: label("recentCards"),
      emptyText: label("noProject"),
      items: state.recent.map((card) => ({ id: card.id, title: card.title, badge: { label: label(card.status === "in_progress" ? "inProgress" : card.status === "needs_review" ? "needsReview" : card.status) } })),
    });
    empty?.update({ title: label("noProject") });
    ui.setHidden(emptySlot as UiSlot, !state.empty);
    openBoard?.update({ text: label("openBoardGuidance") });
  };

  return {
    documentElement: ui.documentElement,
    mount: () => {
      if (mounted) return;
      mounted = true;
      const root = ui.mountRoot("panel");
      const projectSlot = ui.createSlot(root, "project");
      const countsSlot = ui.createSlot(root, "counts");
      const recentSlot = ui.createSlot(root, "recentCards");
      emptySlot = ui.createSlot(root, "empty");
      const openBoardSlot = ui.createSlot(root, "openBoardGuidance");
      projectText = ui.mountText(projectSlot, { text: "" });
      activeBadge = ui.mountBadge(ui.createSlot(countsSlot, "active"), { label: "" });
      reviewBadge = ui.mountBadge(ui.createSlot(countsSlot, "review"), { label: "", tone: "warning" });
      queuedBadge = ui.mountBadge(ui.createSlot(countsSlot, "queued"), { label: "", tone: "neutral" });
      recentHeading = ui.mountText(ui.createSlot(recentSlot, "recentCardsHeading"), { text: "" });
      recentCards = ui.mountList(ui.createSlot(recentSlot, "recentCardsList"), { items: [], onSelect: (id) => {
        const card = state.recent.find((item) => item.id === id);
        const sessionId = card?.reviewSessionId ?? card?.mainSessionId;
        if (sessionId) state.onOpenSession?.(sessionId);
      } });
      empty = ui.mountEmpty(emptySlot, { title: "" });
      openBoard = ui.mountText(openBoardSlot, { text: "" });
      handles.push(projectText, activeBadge, reviewBadge, queuedBadge, recentHeading, recentCards, empty, openBoard);
      render();
    },
    applyReady: (context) => {
      locale = context.locale;
      ui.documentElement.lang = context.locale;
      render();
    },
    update: (next) => {
      state = { ...state, ...next };
      render();
    },
    destroy: () => {
      handles.splice(0).forEach((handle) => handle.dispose());
    },
  };
};
