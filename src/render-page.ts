import type { HostReadyContext } from "@openchamber/sdk";
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

import { formatMessage, type SurfaceCard, type UiKit, type UiSlot } from "./render-panel";

export interface PageDraft {
  title: string;
  prompt: string;
}

export interface PageSurfaceState {
  projects: Array<{ id: string; name: string }>;
  activeProjectId: string | null;
  active: number;
  limit: number;
  cards: SurfaceCard[];
  empty: boolean;
  canStart?: boolean;
  error?: string | null;
  notice?: string | null;
  onSelectProject?: (projectId: string) => void;
  onNewCard?: (draft: PageDraft) => void;
  onStartMain?: (cardId: string) => void;
  onStartReview?: (cardId: string) => void;
  onAdoptSession?: (cardId: string) => void;
  onClearPending?: (cardId: string) => void;
  onOpenMain?: (sessionId: string) => void;
  onOpenReview?: (sessionId: string) => void;
}

export interface PageSurface {
  readonly documentElement: { lang: string };
  mount(): void;
  applyReady(context: HostReadyContext): void;
  update(state: Partial<PageSurfaceState>): void;
  setDraft(draft: PageDraft): void;
  getDraft(): PageDraft;
  destroy(): void;
}

const initialPageState: PageSurfaceState = {
  projects: [],
  activeProjectId: null,
  active: 0,
  limit: 1,
  cards: [],
  empty: true,
};

export const createPageSurface = (ui: UiKit): PageSurface => {
  let locale = "en";
  let mounted = false;
  let state = initialPageState;
  let draft: PageDraft = { title: "", prompt: "" };
  let emptySlot: UiSlot | undefined;
  let automationSlot: UiSlot | undefined;
  let bannerSlot: UiSlot | undefined;
  const handles: Array<Handle<unknown>> = [];
  let empty: Handle<EmptyProps> | undefined;
  let automationBanner: Handle<BannerProps> | undefined;
  let banner: Handle<BannerProps> | undefined;
  let project: Handle<SelectProps> | undefined;
  let active: Handle<BadgeProps> | undefined;
  let newCard: Handle<ButtonProps> | undefined;
  let startMain: Handle<ButtonProps> | undefined;
  let startReview: Handle<ButtonProps> | undefined;
  let openMain: Handle<ButtonProps> | undefined;
  let openReview: Handle<ButtonProps> | undefined;
  let adoptSession: Handle<ButtonProps> | undefined;
  let clearPending: Handle<ButtonProps> | undefined;
  let selectedCardId: string | null = null;
  let title: Handle<TextFieldProps> | undefined;
  let prompt: Handle<TextFieldProps> | undefined;
  const columns = new Map<SurfaceCard["status"], { heading: Handle<TextProps>; list: Handle<ListProps> }>();

  const label = (key: Parameters<typeof formatMessage>[1]) => formatMessage(locale, key);
  const columnCards = (status: SurfaceCard["status"]) => state.cards
    .filter((card) => card.status === status)
    .map((card) => ({ id: card.id, title: card.title }));
  const render = () => {
    if (!mounted) return;
    empty?.update({ title: state.error ?? label("noProject") });
    ui.setHidden(emptySlot as UiSlot, !state.empty);
    if (automationBanner) {
      automationBanner.update({ tone: "info", title: label("automationUnavailable") });
    }
    if (banner && bannerSlot) {
      ui.setHidden(bannerSlot, !state.notice);
      banner.update({ tone: "warning", title: state.notice ?? "" });
    }
    project?.update({
      label: label("project"),
      value: state.activeProjectId,
      options: state.projects.map((item) => ({ id: item.id, label: item.name })),
      placeholder: label("noProject"),
    });
    active?.update({ label: `${label("active")}: ${state.active}/${state.limit} ${label("limit")}` });
    newCard?.update({ label: label("newCard"), disabled: !state.canStart || !state.onNewCard });
    const selected = state.cards.find((card) => card.id === selectedCardId);
    const pending = selected?.pendingStartRole != null;
    startMain?.update({ label: label("startMain"), disabled: !state.canStart || pending || selected?.status !== "todo" || !state.onStartMain });
    startReview?.update({ label: label("startReview"), disabled: !state.canStart || pending || selected?.status !== "in_progress" || !state.onStartReview });
    openMain?.update({ label: label("openMain"), disabled: !selected?.mainSessionId || !state.onOpenMain });
    openReview?.update({ label: label("openReview"), disabled: !selected?.reviewSessionId || !state.onOpenReview });
    adoptSession?.update({ label: label("adoptSession"), disabled: !state.canStart || !selected?.pendingStartRole || !state.onAdoptSession });
    clearPending?.update({ label: label("clearPending"), disabled: !state.canStart || !selected?.pendingStartRole || !state.onClearPending });
    title?.update({ label: label("title") });
    prompt?.update({ label: label("prompt") });
    const names: Record<SurfaceCard["status"], Parameters<typeof formatMessage>[1]> = {
      todo: "todo",
      in_progress: "inProgress",
      needs_review: "needsReview",
      done: "done",
    };
    columns.forEach((column, status) => {
      column.heading.update({ text: label(names[status]) });
      column.list.update({ items: columnCards(status), emptyText: label("noProject") });
    });
  };

  return {
    documentElement: ui.documentElement,
    mount: () => {
      if (mounted) return;
      mounted = true;
      const root = ui.mountRoot("page");
      emptySlot = ui.createSlot(root, "empty");
      automationSlot = ui.createSlot(root, "automation");
      bannerSlot = ui.createSlot(root, "banner");
      const toolbar = ui.createSlot(root, "toolbar");
      const form = ui.createSlot(root, "draft");
      const board = ui.createSlot(root, "board");
      empty = ui.mountEmpty(emptySlot, { title: "" });
      automationBanner = ui.mountBanner(automationSlot, { tone: "info", title: "" });
      banner = ui.mountBanner(bannerSlot, { tone: "warning", title: "" });
      ui.setHidden(bannerSlot, true);
      project = ui.mountSelect(ui.createSlot(toolbar, "project"), { value: null, options: [], onChange: (projectId) => state.onSelectProject?.(projectId) });
      active = ui.mountBadge(ui.createSlot(toolbar, "active"), { label: "" });
      newCard = ui.mountButton(ui.createSlot(toolbar, "newCard"), { label: "", onClick: () => state.onNewCard?.(draft) });
      startMain = ui.mountButton(ui.createSlot(toolbar, "startMain"), { label: "", onClick: () => selectedCardId && state.onStartMain?.(selectedCardId) });
      startReview = ui.mountButton(ui.createSlot(toolbar, "startReview"), { label: "", onClick: () => selectedCardId && state.onStartReview?.(selectedCardId) });
      openMain = ui.mountButton(ui.createSlot(toolbar, "openMain"), { label: "", onClick: () => {
        const sessionId = state.cards.find((card) => card.id === selectedCardId)?.mainSessionId;
        if (sessionId) state.onOpenMain?.(sessionId);
      } });
      openReview = ui.mountButton(ui.createSlot(toolbar, "openReview"), { label: "", onClick: () => {
        const sessionId = state.cards.find((card) => card.id === selectedCardId)?.reviewSessionId;
        if (sessionId) state.onOpenReview?.(sessionId);
      } });
      adoptSession = ui.mountButton(ui.createSlot(toolbar, "adoptSession"), { label: "", onClick: () => selectedCardId && state.onAdoptSession?.(selectedCardId) });
      clearPending = ui.mountButton(ui.createSlot(toolbar, "clearPending"), { label: "", onClick: () => selectedCardId && state.onClearPending?.(selectedCardId) });
      title = ui.mountTextField(ui.createSlot(form, "title"), { value: draft.title, onChange: (value) => { draft = { ...draft, title: value }; } });
      prompt = ui.mountTextField(ui.createSlot(form, "prompt"), { value: draft.prompt, multiline: true, rows: 4, onChange: (value) => { draft = { ...draft, prompt: value }; } });
      for (const status of ["todo", "in_progress", "needs_review", "done"] as const) {
        const column = ui.createSlot(board, status);
        const heading = ui.mountText(ui.createSlot(column, `${status}Heading`), { text: "" });
        const list = ui.mountList(ui.createSlot(column, `${status}Cards`), { items: [], onSelect: (id) => {
          selectedCardId = id;
          render();
        } });
        columns.set(status, { heading, list });
        handles.push(heading, list);
      }
      handles.push(empty, automationBanner, banner, project, active, newCard, startMain, startReview, openMain, openReview, adoptSession, clearPending, title, prompt);
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
    setDraft: (next) => {
      draft = { ...next };
      title?.update({ value: draft.title });
      prompt?.update({ value: draft.prompt });
    },
    getDraft: () => ({ ...draft }),
    destroy: () => {
      handles.splice(0).forEach((handle) => handle.dispose());
    },
  };
};
