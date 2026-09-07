# Proposal: steward-product-workflow

## Why

Manager 与 Agent runtime 完成后，仍需把技能管家做成可上线产品：用户必须能理解 scope、证据、diff、风险和审批，而不是面对一张通用聊天页。UI 还要覆盖失败恢复、窄窗口和真实 daemon 生命周期。

## What Changes

- 在官方 DSH Web host 中新增 Skill Creator client plugin surface：任务、scope、runtime 配置、事件、tool calls、findings、proposal diff、validation、approval、rollback。
- 移除或降级旧 Creator ACP 直通面板，README 和导航改为 Skill Management Agent 叙事。
- 覆盖 loading/empty/updating/error/conflict/disconnected/unavailable/recovery 状态和键盘可达性。
- 完成真实 CLI/daemon/RPC/文件系统构建门禁与产品验收记录。

## Non-Goals

- 不实现分享、排行榜或远程社区市场。
- 不以 demo HTML、mock adapter、静态截图替代真实实现。

## Acceptance

新用户可通过 CLI 启动并进入 DSH-hosted Skill Creator，选择单 skill 或 skill 集执行 check/optimize/organize，审阅证据与 patch，批准后 apply 并 rollback；桌面 1100px 与窄窗口 680px 无横向溢出，DSH unavailable、断线、冲突和重启均有可执行恢复路径。不得用 iframe 或第二个通用 ACP chat 替代合并。
