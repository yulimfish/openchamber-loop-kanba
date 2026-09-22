# ADR-001: 作为官方 Host API 扩展交付

**状态：** 已接受

**日期：** 2026-09-22

## 背景

用户将原独立应用方案改为 OpenChamber 扩展：功能必须显示在 OpenChamber 面板中，遵循宿主的 UI 模式和用户自定义主题，并且只能通过官方接口接入。

当前官方 `@openchamber/sdk@1.24.2` 能创建带 worktree 的会话、订阅项目/worktree/会话摘要、保存扩展数据、打开会话，以及提供宿主主题和 UI kit。它不提供任意会话全文、工具 Part、token/usage、Goal 状态、指定会话定向 prompt、完整事件流，或原子打开指定 worktree 审阅面板的 API。

## 决策

将项目重命名为 `openchamber-loop-kanba`，实现为标准 guest iframe extension：

- `package.json` 使用 `openchamber.apiVersion: 1`、rail `panel`、完整 `page`，并要求 OpenChamber `>=1.24.2`。
- `panel/index.html` 是 rail 入口，`panel/page.html` 是完整看板页；所有脚本均由官方 guest bundler 或等价的 classic-IIFE bundler 预构建后提交。
- 使用 `connectHost()`、`host.storage`、`listProjects`、`listWorktrees`、`listSessions`、`onDirectory`、`onProjects`、`onWorktrees`、`onSessions`、`startSession` 和 `openSession`。不直连 OpenChamber 私有 HTTP、Zustand store、DOM、RuntimeAPI 或 Electron IPC。
- 面板和完整页调用 `applyHostReady` 继承每次 `onReady` 提供的 `theme.tokens`、字体、圆角、语言和深浅色模式；优先使用 `@openchamber/sdk/ui` 控件。
- 卡片打开时调用 `host.openSession(mainSessionId 或 reviewSessionId)`，由 OpenChamber 原生 Chat 和 Context 面板显示完整消息、思考、工具调用、diff、终端、Browser Preview 与用量，而扩展不复制或伪造这些数据。
- 当前可交付版本仅提供用户驱动的卡片创建、按 worktree 创建 Main/Review 会话、会话摘要状态和原生会话跳转。自动 Coordinator、自动进入 review、ReviewAgent 回环与一键打开特定审阅 surface 被列为公开 Host API 的上游前置条件。

## 数据与权限

- 看板状态存于 `host.storage`，按 `projectId` 分片，受 64 KiB/值、2 MiB/命名空间和 2,000 key 的官方限制约束。
- `sessions` 允许列出项目、worktree 和会话摘要，以及创建/打开会话。
- `prompt` 仅用于带初始 prompt 的 `startSession`。扩展不选择模型、Agent 或 variant，宿主捕获用户当前选择。
- 不申请 `conversation`；会话正文只在原生 OpenChamber 中阅读。
- 不声明 `service`，因而不引入拥有完整用户权限的辅助进程。

## 结果

### 正向

- 安装、权限审批、主题、深浅色、字体和无障碍交互全部遵循 OpenChamber 的标准扩展机制。
- 详情数据继续由已经成熟的 OpenChamber 原生界面呈现，避免创建一个不完整的会话查看器。
- 扩展可以从 folder、ZIP 或 Git URL 安装，并直接在 Settings → Extensions 管理。

### 约束

- 右 rail 空间适合摘要，不适合完整四列看板；完整看板必须由用户从 Extension pages 打开，扩展不能自行打开全屏 page。
- `onSessions` 的 `activity/outcome` 仅是摘要，不能解释为任务完成。
- 在官方 Host API 增补前，扩展不能声明“自动选择任务”“Goal 成功自动审核”或“完整 session 数据在扩展内”。
- Host storage 没有 CAS、transaction 或服务端 lease。`concurrencyLimit` 只能在同一扩展客户端的 writer lease 内尽力避免重复 Start；跨 OpenChamber 客户端/设备不作硬上限保证。

## 被拒绝方案

### 独立 Tauri 应用

已被用户撤回。它会绕开 OpenChamber 的扩展安装、面板和主题系统。

### Extension local service

虽是官方 manifest 功能，但它启动具完整用户权限的本地进程；当前功能不需要该能力，且会违背最小权限原则。

### 调用 OpenChamber 私有 HTTP 或 UI store

这不属于稳定 Host API，会在宿主升级时破坏扩展，也不符合“按照官方接口进行接入”的要求。

## 自动 Loop 的公开 API 前置条件

完整 Loop 仅在下列能力以官方文档和 `@openchamber/sdk` 形式发布后启用：

1. 对指定 `sessionId` 的幂等 prompt 发送与会话创建请求 ID。
2. 单会话分页详情和可恢复事件订阅，至少包含消息/Part、usage、diff、todo、权限/问题和 Goal run 状态。
3. 原子 `openWorktreeReview`，以 project、worktree directory、session 和初始 surface 打开原生审阅上下文。
4. 设置或替换 Session Goal 并返回稳定 Goal run ID。

在此之前，扩展维持为准确、明确标注的用户驱动工作流，而不是以猜测的 summary 状态模拟自动化。
