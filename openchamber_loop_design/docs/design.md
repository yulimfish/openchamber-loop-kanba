# OpenChamber Loop / Agent Design

**状态：** 离线设计与接线参考库（从 openchamber-loop-kanban E0–E7 配方抽取）

**日期：** 2026-09-24

本项目是 OpenChamber 循环看板扩展的 loop/agent 设计参考：核心模块（store、workflow、lease、adapter、automation gate）与主仓同源可测，后续 loop/agent 接线在此库内进行，不触碰主仓已验收的 E0–E7 代码。

## 闸门原则（Gate Principles）

1. **Fail-closed automation gate** — `src/automation-gate.ts` 的 `automationState()` 缺少任一公开 API 即 `available: false`；`assertNoAutomaticTransition()` 在 unavailable 时抛出 `Automation is unavailable on this OpenChamber version`。闸门默认关闭，不因 UI 猜测开放。
2. **无自动列迁移** — `activity`/`outcome`/session lifecycle 事件只作可见状态，不得触发卡片迁移。源码策略测试（`tests/automation-gate.test.ts`）禁止生产源出现 `onSessionLifecycle` 与 `.moveCard(`，从结构上封死自动 loop。
3. **显式用户动作** — `startMain`/`startReview` 仅由用户点击触发；pending 先持久化再调用 Host；`HostRequestError`（含 `HOST_TIMEOUT`）一律保留 pending、绝不自动重试，待用户在原生项目检查后显式清除或 Adopt discovered session（要求唯一精确匹配）。
4. **moveCard(user) 闸门** — `src/board-store.ts` 仅在 `cause === "user"` 时放行列迁移，订阅回调无法迁列。
5. **单键卡片写入** — 会话结果（sessionId、worktree、linked、targetStatus、pending 清除）在一次 card-key 写入中一起保存；不把跨 key 更新称为原子提交。
6. **并发闸门** — 每项目 `concurrencyLimit` + 同卡 in-flight guard + 每项目 reservation 防并发点击突破上限；写侧经 `writer-lease` 单 owner。

## Loop / Agent 工作流（SDK v1 用户驱动）

1. **新建卡片** — full page `todo` 列新增卡片，设置 title、prompt、排序。
2. **Start** — 校验 concurrencyLimit、prompt ≤16,000 字符、SDK 字段限制 → 内存 in-flight guard → 持久化 `pendingStartRole`/requestId/时间戳 → 调用 `host.startSession`（`worktree: { kind: "new" }`、扩展 item data）。
3. **结果落盘** — 带非空 `sessionId` 时一次 card-key 写入保存 session/worktree/linked/目标列并清 pending；`sent !== "sent"` 显示可恢复 banner，不自动重试。`HOST_TIMEOUT` 视为不确定结果：保留 pending、禁止重试、提示先原生检查。
4. **会话摘要** — `onSessions(projectId)` 更新 Main/Review 的 activity/outcome/directory/worktree 摘要，只作可见状态，不改列。
5. **Move to review** — 用户在卡片菜单选择后，以 `worktree: { kind: "existing", directory }` 创建 Review session；或 Open Main/Review session。
6. **审阅** — `openSession(sessionId)` 后由 OpenChamber 原生 Chat、Context、Diff、Terminal、Browser Preview 承载完整审阅。
7. **Move to done** — 用户明确移动；扩展保留会话与 worktree 引用，不执行 merge 或删除。

## 待补 API 接线方案（Automatic Loop 上游阶段）

当前官方 `@openchamber/sdk@1.24.2` 缺失全部四个自动化契约，闸门保持关闭：

| 缺失 API | 预期职责 | 接线点 |
| --- | --- | --- |
| `promptSession` | Coordinator 自动发起/续发 prompt 的唯一入口 | 替代手工 Start/feedback 输入，替代 `startSession` 的 text 直发路径 |
| `sessionDetailsAndEvents` | 读取 Goal run、子会话结束、diff 变化等结构化事件 | 自动判定 `Main Goal succeeds + child sessions end + new diff` → 才允许自动迁入 `needs_review` |
| `openWorktreeReview` | 打开 worktree 审阅 surface | Review 决策回环时自动打开审阅上下文 |
| `sessionGoalRun` | Goal 驱动的审核运行 | Goal 驱动审核循环的启动与观测 |

**接线条件（全部满足才开放闸门）：**

1. 四个 API 在官方 `@openchamber/sdk` 文档化并发布；
2. `package.json` 的 `engines.openchamber` 门槛随之提高；
3. 通过兼容性测试（`automationState().missing` 清空 → `available: true`）；
4. 解除 `assertNoAutomaticTransition` 抛错与源码策略测试禁令前，先补自动迁移的独立验收。

**开放后的目标自动流：**

```text
Coordinator session decides
  -> host sends validated command
  -> extension starts Main worktree session          (promptSession)
Main Goal succeeds + child sessions end + new diff
  -> host event                                       (sessionDetailsAndEvents)
  -> automatic move to needs_review                   (gate open only)
Review session decision
  -> extension sends feedback                         (promptSession)
     or waits for user merge confirmation             (openWorktreeReview)
```

在契约发布前，UI 显示 “Automation unavailable on this OpenChamber version”，保留当前用户驱动操作。

## 模块地图

| 文件 | 职责 |
| --- | --- |
| `src/schema.ts` | `CardStatus`/`BoardCard` 校验、card/project key（SHA-256）、64 KiB 前置约束 |
| `src/board-store.ts` | Host storage 读写、pending 生命周期、`moveCard(user)` 闸门 |
| `src/host-adapter.ts` | 唯一 Host 接触层；`HostClientPort` 事件适配；`hostFailureMessage` 恢复文案 |
| `src/writer-lease.ts` | BroadcastChannel 单写者租约（同客户端 best-effort） |
| `src/session-workflow.ts` | `startMain`/`startReview` 显式动作、concurrency reservation、Adopt discovered session |
| `src/automation-gate.ts` | fail-closed 自动化闸门与自动迁移断言 |
| `src/render-panel.ts` / `src/render-page.ts` | 双 surface 渲染（UI kit、双语文案、automation banner） |
| `panel/` | classic IIFE 入口与提交的构建产物（OpenChamber 安装不编译 TS） |
| `tests/` | 71 tests / 180 expects 基线，含源码策略测试与 fake host |

## 验证

```bash
bun run check   # tsc --noEmit && bun test
bun run build   # panel/main.ts + panel/page.ts → classic IIFE
```
