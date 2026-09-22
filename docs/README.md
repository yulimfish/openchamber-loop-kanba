# openchamber-loop-kanba

`openchamber-loop-kanba` 是一个 OpenChamber 扩展，不是独立桌面应用。它在右侧 rail 提供轻量看板面板，并由用户从 **Extension pages** 打开完整看板页。

所有 Agent、worktree、会话、Chat、Context、Diff、终端和 Preview 均由 OpenChamber 原生功能运行与展示。扩展只通过公开的 `@openchamber/sdk` Host API 与 UI kit 接入。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| `docs/decisions/ADR-001-openchamber-extension-host-api.md` | 扩展架构与官方 API 边界。 |
| `docs/superpowers/specs/2026-09-22-openchamber-loop-kanba-extension-design.md` | 面板、完整页面、数据模型、权限和已知 SDK 能力边界。 |
| `docs/traceability.md` | 每项需求对应的实现阶段和验收证据。 |
| `docs/superpowers/plans/2026-09-22-openchamber-loop-kanba-extension-plan.md` | 严格分阶段实施清单。 |

## 固定约束

- 包名、面板 ID 和项目逻辑名均为 `openchamber-loop-kanba`。
- manifest 使用 `apiVersion: 1`，并声明 `engines.openchamber: ">=1.24.2"`。
- 扩展要求的当前权限仅为 `sessions` 与 `prompt`；不声明 `service`、`filesystem`、`files`、`model`、`network` 或 `conversation`。
- 所有扩展 UI 通过 `applyHostReady` 和 `@openchamber/sdk/ui` 跟随宿主主题、字体、圆角、配色、语言与键盘模式。
- 当前官方 API 支持用户驱动的卡片、worktree 会话和原生会话跳转；自动调度、自动 Goal 审核和扩展内完整会话详情必须等待公开 Host API 补充后才可实现。

## 官方基线

计划依据 OpenChamber `1.24.2`、`@openchamber/sdk@1.24.2` 及官方扩展文档：

- <https://docs.openchamber.dev/extensions/>
- <https://docs.openchamber.dev/sdk/>
- <https://docs.openchamber.dev/sdk/host/>
- <https://docs.openchamber.dev/sdk/ui/>
- <https://docs.openchamber.dev/sdk/example/>
