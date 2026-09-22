import type { HostReadyContext } from "@openchamber/sdk";
import type {
  BadgeProps,
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
  onSelectProject?: (projectId: string) => void;
  onNewCard?: (draft: PageDraft) => void;
  onOpenSession?: (sessionId: string) => void;
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
  const handles: Array<Handle<unknown>> = [];
  let empty: Handle<EmptyProps> | undefined;
  let project: Handle<SelectProps> | undefined;
  let active: Handle<BadgeProps> | undefined;
  let newCard: Handle<ButtonProps> | undefined;
  let title: Handle<TextFieldProps> | undefined;
  let prompt: Handle<TextFieldProps> | undefined;
  const columns = new Map<SurfaceCard["status"], { heading: Handle<TextProps>; list: Handle<ListProps> }>();

  const label = (key: Parameters<typeof formatMessage>[1]) => formatMessage(locale, key);
  const columnCards = (status: SurfaceCard["status"]) => state.cards
    .filter((card) => card.status === status)
    .map((card) => ({ id: card.id, title: card.title }));
  const render = () => {
    if (!mounted) return;
    empty?.update({ title: label("noProject") });
    ui.setHidden(emptySlot as UiSlot, !state.empty);
    project?.update({
      label: label("project"),
      value: state.activeProjectId,
      options: state.projects.map((item) => ({ id: item.id, label: item.name })),
      placeholder: label("noProject"),
    });
    active?.update({ label: `${label("active")}: ${state.active}/${state.limit} ${label("limit")}` });
    newCard?.update({ label: label("newCard"), disabled: !state.onNewCard });
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
      const toolbar = ui.createSlot(root, "toolbar");
      const form = ui.createSlot(root, "draft");
      const board = ui.createSlot(root, "board");
      empty = ui.mountEmpty(emptySlot, { title: "" });
      project = ui.mountSelect(ui.createSlot(toolbar, "project"), { value: null, options: [], onChange: (projectId) => state.onSelectProject?.(projectId) });
      active = ui.mountBadge(ui.createSlot(toolbar, "active"), { label: "" });
      newCard = ui.mountButton(ui.createSlot(toolbar, "newCard"), { label: "", onClick: () => state.onNewCard?.(draft) });
      title = ui.mountTextField(ui.createSlot(form, "title"), { value: draft.title, onChange: (value) => { draft = { ...draft, title: value }; } });
      prompt = ui.mountTextField(ui.createSlot(form, "prompt"), { value: draft.prompt, multiline: true, rows: 4, onChange: (value) => { draft = { ...draft, prompt: value }; } });
      for (const status of ["todo", "in_progress", "needs_review", "done"] as const) {
        const column = ui.createSlot(board, status);
        const heading = ui.mountText(ui.createSlot(column, `${status}Heading`), { text: "" });
        const list = ui.mountList(ui.createSlot(column, `${status}Cards`), { items: [], onSelect: (id) => {
          const sessionId = state.cards.find((card) => card.id === id)?.sessionId;
          if (sessionId) state.onOpenSession?.(sessionId);
        } });
        columns.set(status, { heading, list });
        handles.push(heading, list);
      }
      handles.push(empty, project, active, newCard, title, prompt);
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
