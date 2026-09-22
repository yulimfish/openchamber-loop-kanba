# openchamber-loop-kanba Extension Design

**状态：** 已接受，按官方 SDK v1 能力分阶段交付

**日期：** 2026-09-22

**架构决策：** `docs/decisions/ADR-001-openchamber-extension-host-api.md`

## 目标

把工程 loop 的看板放入 OpenChamber：右侧 panel 提供当前项目的精简状态，完整 page 提供四列看板。所有实际 Agent 工作、worktree、会话详情与审阅都留在 OpenChamber 原生工作区。

## Surface 设计

```text
RAIL PANEL
┌──────────────────────────────────┐
│ Loop Kanba                 [3]   │
├──────────────────────────────────┤
│ Current project                  │
│ 2 active · 1 review · 4 queued   │
├──────────────────────────────────┤
│ • Implement command palette      │
│   running · feature/palette       │
│ • Add import tests                │
│   needs review                    │
├──────────────────────────────────┤
│ Open Board from Extension pages   │
└──────────────────────────────────┘

FULL BOARD PAGE
┌──────────────────────────────────────────────────────────────────┐
│ Project selector · active 2 / limit 3 · [New card]               │
├──────── TODO ──────┬──── IN PROGRESS ────┬── NEEDS REVIEW ─┬── DONE ─┤
│ ordered cards      │ session summary     │ review session  │ history  │
│ [Start]            │ [Open session]      │ [Open session]  │ retained │
│                    │                     │                  │          │
└────────────────────┴─────────────────────┴──────────────────┴──────────┘

CARD DETAIL
┌──────────────────────────────────────────────────────────────────┐
│ title · worktree branch · live activity                           │
│ [Open Main session] [Open Review session]                         │
│ session IDs, activity/outcome, timestamps, attached item metadata│
│ Native Chat and Context show transcript, tools, diff and preview  │
└──────────────────────────────────────────────────────────────────┘
```

右 rail 只放适合窄宽度的项目摘要、注意力徽标和最近卡片。完整四列交互放在 `contributes.page`。完整 page 是 OpenChamber 的 Extension pages 菜单显式打开的页面，panel 不尝试绕过宿主自行导航。

panel 以 `onDirectory(directory)` 和 `onProjects` 的 `GuestProject.directory` 映射当前目录到 project ID；目录为 `null`、projects loading/error 或无匹配时显示 Host 风格 empty state。目录或项目 snapshot 改变时先释放旧 project 的 worktree/session 订阅，再加载新 project；generation 不匹配的延迟 callback 不得渲染。

## UI 与主题规则

- 每次 `host.onReady(ctx)` 都先执行 `applyHostReady(ctx, document.documentElement)`，再将 `document.documentElement.lang` 更新为 `ctx.locale`；首次 ready 后只挂载一次控件，后续 ready 仅更新 Host token、语言和上下文数据。
- 优先使用 `mountTabs`、`mountList`、`mountButton`、`mountBadge`、`mountBanner`、`mountEmpty`、`mountSpinner`、`mountMenu`、`mountTextField` 与 `mountProgress`。
- 不硬编码颜色、字体、圆角、暗色判断或对比度；补充 CSS 仅使用 `--oc-*` 和 Host 提供的 `--*-text` token。
- context/theme 刷新不能重建用户正在编辑的卡片草稿或覆盖控件状态；控件的 `update()` 接收当前状态。
- 自定义内容按 UI kit 的紧凑间距、keyboard-first list/menu 和 banner/empty-state 模式呈现；扩展自有文案提供英语和简体中文，其他 locale 回退英语，不以 CSS 或静态 HTML `lang` 猜测语言。

## Manifest 与目录

```text
openchamber-loop-kanba/
├── package.json
├── bun.lock
├── panel/
│   ├── index.html
│   ├── page.html
│   ├── main.ts
│   ├── page.ts
│   ├── main.js
│   └── page.js
├── src/
│   ├── board-store.ts
│   ├── host-adapter.ts
│   ├── session-workflow.ts
│   ├── writer-lease.ts
│   ├── automation-gate.ts
│   ├── render-panel.ts
│   ├── render-page.ts
│   └── schema.ts
└── tests/
    ├── automation-gate.test.ts
    ├── board-store.test.ts
    ├── host-adapter.test.ts
    ├── manifest.test.ts
    ├── session-workflow.test.ts
    ├── surface-lifecycle.test.ts
    ├── ui-policy.test.ts
    ├── writer-lease.test.ts
    └── support/
        └── fake-host.ts
```

`main.js` 与 `page.js` 是提交的 classic IIFE 构建产物。OpenChamber 安装扩展时不会编译 TypeScript 或安装依赖。

```json
{
  "name": "openchamber-loop-kanba",
  "version": "0.1.0",
  "openchamber": {
    "apiVersion": 1,
    "engines": { "openchamber": ">=1.24.2" },
    "contributes": {
      "panel": {
        "id": "openchamber-loop-kanba",
        "name": "Loop Kanba",
        "icon": "kanban-view",
        "entry": "panel/index.html"
      },
      "page": { "entry": "panel/page.html", "title": "Loop Kanba" },
      "capabilities": ["sessions", "prompt"]
    }
  }
}
```

## 数据模型

扩展用 `host.storage` 保存看板数据。Host 项目列表是项目来源，每张卡片独立存为一个 key，因此创建、移动和编辑卡片均只写一个 Host storage value；不把跨 key 的更新称为原子提交。写入前校验 UTF-8 大小不超过 64 KiB，写入失败时保留内存草稿并告知用户未保存。

```ts
type CardStatus = "todo" | "in_progress" | "needs_review" | "done";

interface BoardProject {
  schema: "openchamber-loop-kanba/v1";
  projectId: string;
  concurrencyLimit: number;
  version: number;
}

interface BoardCard {
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
  pendingStartRole: "main" | "review" | null;
  pendingRequestId: string | null;
  pendingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

键名固定为：

```text
openchamber-loop-kanba/v1/project/<sha256(projectId)>
openchamber-loop-kanba/v1/card/<uuid>
```

`projectKey(projectId)` 使用 SHA-256 的 hex digest，确保任意 Host project ID 不会突破 128 字符 storage-key 上限；card ID 由扩展以 UUID 生成。`loadBoard(projectId)` 通过 `storage.keys()` 找到 card key，再按卡片内的 `projectId` 过滤和按 `status`、`position` 排序；card ID 全局唯一。panel 只读 board storage，full page 是唯一可写 surface，避免用没有 CAS 或 multi-key transaction 的 Host storage 实现跨 surface 索引同步。

full page 通过 `BroadcastChannel` writer lease 在**同一扩展客户端**内保证同一时刻只有一个可写 board page；非 owner 只读。Main Start 在调用 Host 前用每项目 reservation 计入 `in_progress`、持久化 pending Main 和尚未落盘的 reservation，避免同一客户端的并发点击突破 `concurrencyLimit`。Host SDK v1 无跨客户端 CAS 或服务端 lease，因此跨设备/客户端仅为 best-effort，不承诺硬上限。

会话创建时附加 `data`，其内容包括 schema、project ID、card ID 和 role。`listSessions(projectId)` 优先以持久化的 Main/Review session ID 匹配卡片，再以 extension item data 核对；当 Host 结果 `linked: false` 时，session 已创建但 item 未保存，扩展保留 session ID 与 linked 状态、显示警告，但不丢失原生会话跳转。

## SDK v1 可交付工作流

1. 用户在 full page 的 `todo` 列新增卡片并设置标题、prompt 和排序。
2. 用户选择 Start。扩展先检查项目的 `concurrencyLimit`、`text` 不超过 16,000 字符、`id`/`title`/`url`/`data` 的 SDK 限制，再同步设置内存 in-flight guard，并将 card 的 `pendingStartRole`、随机 request ID、时间戳写入单个 card key 后禁用该卡的 Start/Review 按钮。只有 pending 写入成功才调用 `host.startSession`，并传入固定 `providerId: "openchamber-loop-kanba"`、card ID、标题、固定扩展 URL、`text: card.prompt`、`projectId`、`worktree: { kind: "new", name }` 和扩展 item data。
3. Host 的 `sent` 是 `"sent" | "no-model" | "skipped" | "failed"`，不是布尔值。只要结果带有非空 `sessionId`，扩展就用**一次** card-key 写入一起保存 session/worktree、`linked` 状态、目标列和已清除的 pending；不得在该写入后单独移动卡片。因为用户的 Start 操作移入 `in_progress`，而 `sent !== "sent"` 额外显示可恢复 banner，绝不自动重试。若这次结果写入失败，原有 pending 保留并阻止再次 Start，直至用户完成原生检查后显式清除。若结果为 `sessionId: null, sent: "skipped"` 且保留 directory/worktree，则也用一次 card-key 写入保存 directory、清空 pending、留在 `todo` 并显示 `bootstrap-failed` 或 `session-create-failed`。`HOST_TIMEOUT` 是 rejected request，结果不证明 Host 未创建 worktree 或会话；扩展保留 pending、禁止重试，并提示用户先在原生项目检查后才能显式清除 pending。

任何 `HostRequestError` 都保留 pending。用户可先选择 Adopt discovered session：仅当 `listSessions` 找到唯一一项、且其 extension item data 精确匹配 card ID 与 role 时，才用一次 card-key 写入认领该 session；零项或多项时保持 pending，绝不猜测、自动发送 prompt 或自动重试。
4. `onSessions(projectId)` 更新 Main/Review session 的 activity、outcome、directory、worktree 和扩展 item 摘要。`activity` 和 `outcome` 只作为可见状态，不能自动改变卡片列。
5. 用户在卡片菜单选择 Move to review 后，扩展以 `{ kind: "existing", directory: card.worktreeDirectory }` 创建 Review session；或选择 Open Main/Review session。
6. Open session 调用 `host.openSession(sessionId)`。之后由 OpenChamber 原生 Chat、Context、Diff、Terminal 和 Browser Preview 显示该 worktree 的完整审阅内容。
7. 用户明确移动卡片到 done。扩展保留会话与 worktree 引用，不执行 merge 或删除。

## 原生详情与扩展详情的边界

| 内容 | 扩展 v1 | OpenChamber 原生 UI |
| --- | --- | --- |
| 项目、worktree、session 摘要 | `list*` 与 `on*` Host API | 完整侧栏与项目导航 |
| session activity/outcome | 可显示，不能推断完成 | 真实 chat 生命周期 |
| 全文消息、思考、工具 Part、附件 | 不读取 | Chat |
| token、cost、context、用量面板 | 不读取 | Context/Usage 面板 |
| diff、终端、Browser Preview | 不强制打开 | Context surfaces |
| 打开某会话 | `openSession` | 选择 chat 与其 worktree context |

## 自动 Loop 的上游阶段

自动 Coordinator、Goal 驱动审核和 ReviewAgent 回环不使用 `activity: idle` 或 `outcome: completed` 猜测。它们需要 ADR 所列、文档化且发布在 `@openchamber/sdk` 的官方 Host API。

等官方 API 可用后，扩展采用以下流程：

```text
Coordinator session decides -> host sends validated command -> extension starts Main worktree session
Main Goal succeeds + child sessions end + new diff -> host event -> needs_review
Review session decision -> extension sends feedback or waits for user merge confirmation
```

在该契约发布前，UI 显示“Automation unavailable on this OpenChamber version”，并保留当前用户驱动操作。

## 错误与生命周期

- 所有 Host 调用保留官方 `HostRequestError.code` 联合；为 `NOT_GRANTED`、`SESSION_BUSY`、`NO_SESSION`、`NO_DIRECTORY`、`HOST_TIMEOUT`、`DISABLED`、`HOST_UNAVAILABLE` 提供专用恢复文案，其他 code（包括 `HOST_REJECTED`）使用安全的通用 Host 拒绝文案。`HOST_TIMEOUT` 被视为不确定结果而非创建失败。
- `onReady`、`onDirectory` 与 `onSessionLifecycle` 同步返回 unsubscribe；`onProjects`、`onWorktrees`、`onSessions` 必须 await 后才得到 unsubscribe。page/panel 销毁时调用全部 unsubscribe 和 `host.dispose()`；每 frame 不超过官方 32 个 workspace subscription 限制。
- v1 不订阅 `onSessionLifecycle` 来触发列迁移；即使接收到 `completed` 或 `failure`，它也不是自动 loop 许可。
- `onReady` 的上下文刷新不能自动切卡、发送 prompt 或新建 session。
- storage 写入失败保留内存草稿并以 error banner 提示，不声称已保存。

## 验收

当前 SDK v1 验收：扩展可由 Settings → Extensions folder install，rail 与 page 跟随主题和 locale，卡片跨 reload 保留，用户可创建 worktree Main/Review session，卡片可打开原生会话，且从完整 manifest 推导的所有权限正好为 `sessions` 和 `prompt`。

完整自动 loop 验收：只有在上游 Host API 前置能力被文档化、版本门槛提高并通过兼容性测试后，才启用自动列迁移与 Agent 决策。
