# openchamber-loop-kanban Traceability

| ID | 需求 | 规格位置 | 计划阶段 | 验收证据 |
| --- | --- | --- | --- | --- |
| EXT-001 | 项目作为 OpenChamber 扩展显示在 rail，并提供完整 page。 | 设计：Surface 设计 | E1, E2 | E2 已通过 page/rail renderer、目录映射和 `bun run build`；folder-install smoke test 待 E7。 |
| EXT-002 | UI 跟随 OpenChamber 用户主题、字体、深浅色、圆角、语言和键盘模式。 | 设计：UI 与主题规则 | E2 | `applyHostReady`、page/rail theme、locale/draft lifecycle 和 UI kit policy 测试已通过；真实 Host 视觉 smoke test 待 E7。 |
| EXT-003 | 看板始终为 `todo`、`in_progress`、`needs_review`、`done` 四列。 | 设计：数据模型 | E3 | E3 已通过持久化 reload、按项目排序、显式用户迁列、并发 position 和 page 新建卡片测试。 |
| EXT-004 | 卡片可通过官方 `startSession` 创建 Main worktree session。 | 设计：SDK v1 工作流 | E4 | E4 已通过 Main 完整请求、并发 reservation、pending 锁与 Adopt/Clear 恢复测试。 |
| EXT-005 | Main/Review 卡片能打开 OpenChamber 原生会话查看完整详情。 | 设计：原生详情边界 | E4 | E4 已通过 `openSession` adapter invocation 与页面 Main/Review 分别打开测试；手动 Context review 待 E7。 |
| EXT-006 | 扩展只使用官方 SDK v1 和最小 `sessions`、`prompt` 权限。 | ADR-001：决策 | E0, E1, E4, E7 | E0 manifest 测试、E4 仅经 adapter 调用公开 API、E7 私有集成扫描（RuntimeAPI/Electron/ipc/zustand/localhost/fetch）零匹配已通过；folder-install 对话框待手动。 |
| EXT-007 | 不用 session summary 猜测自动完成。 | 设计：自动 Loop 上游阶段 | E5 | E5 已通过 `assertNoAutomaticTransition`、completed lifecycle 不改卡状态、源码策略禁止 `onSessionLifecycle`/订阅内 `moveCard` 与常驻不可用 banner 测试。 |
| EXT-008 | 自动 Coordinator/Goal/Review loop 仅在公开 Host API 发布后实现。 | ADR-001：上游前置条件 | E5, E6 | E5 已通过 `automationState()` 四契约 fail-closed 测试；E6 已确认 SDK 1.24.2 缺失全部四 API，闸门保持、E5 不变。 |
| EXT-009 | 扩展数据可跨 reload 保存。 | 设计：数据模型 | E3 | E3 已通过单卡 key 写入、project key SHA-256、64 KiB UTF-8 限制和失败写入不伪报成功测试。 |
| EXT-010 | 扩展不声明 local service、filesystem、files、model、network 或 conversation。 | ADR-001：数据与权限 | E0, E7 | E0 已通过官方 manifest parser 与 capability snapshot；安装对话框待 E7。 |
| EXT-011 | 同一扩展客户端内的 Main Start 不会突破并发上限；跨客户端为 best-effort；超时或失败后只可安全认领或人工解除 pending。 | 设计：数据模型、SDK v1 工作流 | E4 | E4 已通过 writer-lease election、limit-1 reservation、HOST_TIMEOUT 持久锁、唯一匹配 Adopt 与显式 Clear 测试。 |
| EXT-012 | rail 和 page 的项目切换释放旧订阅并忽略陈旧 callback。 | 设计：Surface 设计、错误与生命周期 | E2, E4 | directory/rapid-switch generation/disposer test 已通过；E4 接入 `bindSessionLabels` 后单项目 workspace subscriptions 为 rail 1/page 3，均正确释放。 |
