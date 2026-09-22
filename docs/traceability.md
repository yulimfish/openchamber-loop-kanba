# openchamber-loop-kanba Traceability

| ID | 需求 | 规格位置 | 计划阶段 | 验收证据 |
| --- | --- | --- | --- | --- |
| EXT-001 | 项目作为 OpenChamber 扩展显示在 rail，并提供完整 page。 | 设计：Surface 设计 | E1 | manifest 与 folder-install smoke test。 |
| EXT-002 | UI 跟随 OpenChamber 用户主题、字体、深浅色、圆角、语言和键盘模式。 | 设计：UI 与主题规则 | E2 | `applyHostReady`、locale/draft lifecycle 测试与 UI kit audit。 |
| EXT-003 | 看板始终为 `todo`、`in_progress`、`needs_review`、`done` 四列。 | 设计：数据模型 | E3 | storage、排序和受限迁移测试。 |
| EXT-004 | 卡片可通过官方 `startSession` 创建 Main worktree session。 | 设计：SDK v1 工作流 | E4 | start result、partial failure、worktree link 测试。 |
| EXT-005 | Main/Review 卡片能打开 OpenChamber 原生会话查看完整详情。 | 设计：原生详情边界 | E4 | `openSession` invocation test 与手动 Context review。 |
| EXT-006 | 扩展只使用官方 SDK v1 和最小 `sessions`、`prompt` 权限。 | ADR-001：决策 | E0, E1, E4, E7 | E0 已通过 `bun test tests/manifest.test.ts` 与 `bunx tsc --noEmit`；后续 source scan 待 E7。 |
| EXT-007 | 不用 session summary 猜测自动完成。 | 设计：自动 Loop 上游阶段 | E5 | blocked-feature test 与 UI banner。 |
| EXT-008 | 自动 Coordinator/Goal/Review loop 仅在公开 Host API 发布后实现。 | ADR-001：上游前置条件 | E5-E6 | SDK contract compatibility test。 |
| EXT-009 | 扩展数据可跨 reload 保存。 | 设计：数据模型 | E3 | storage reload test。 |
| EXT-010 | 扩展不声明 local service、filesystem、files、model、network 或 conversation。 | ADR-001：数据与权限 | E0, E7 | E0 已通过官方 manifest parser 与 capability snapshot；安装对话框待 E7。 |
| EXT-011 | 同一扩展客户端内的 Main Start 不会突破并发上限；跨客户端为 best-effort；超时或失败后只可安全认领或人工解除 pending。 | 设计：数据模型、SDK v1 工作流 | E4 | writer lease、limit-1 race、pending/reconcile tests。 |
| EXT-012 | rail 和 page 的项目切换释放旧订阅并忽略陈旧 callback。 | 设计：Surface 设计、错误与生命周期 | E2 | directory/rapid-switch generation/disposer test。 |
