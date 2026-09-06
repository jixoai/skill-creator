# Proposal: dsh-runtime-integration

## Why

只有 fixture vertical slice 通过后，才把 DeepSeek Harness 接入真实 Agent runtime。官方源码已证明 agent、session、tools、system-prompt、presets、approval 和 client stream 的组合 seam；本 change 将这些能力接到 Skill Creator 的 provider-neutral adapter，不复制 DSH 私有数据库或 WebUI 状态。

## What Changes

- 实现官方 DSH composition 的 capability handshake、版本记录和 unavailable projection。
- 适配 agent/session/stream/tool callback；把 Skill Creator domain tools 注册到 agent scope。
- 复用 DSH 的 model/preset/permission/session controls，Manager 保留 snapshot、proposal、approval、audit authority。
- 将 DSH WebUI 作为必需的 Agent-host composition；Skill Creator Manager 通过 DSH client plugin/slot 合并进入同一 WebUI。无 DSH 时仍保留 Manager、Creator、Repository 和确定性 Intelligence 的恢复能力，但不能宣称 Agent 产品已完成。

## Non-Goals

- 不把 `dsh-herdr` 当官方 harness；不依赖 `dsh-acp` 猜测协议。
- 不把 DSH session log、settings 或 profile 文件写入 Manager registry。
- 不使用 iframe 或第二个独立聊天入口；详细宿主合并任务由 `dsh-webui-composition` change 承担。

## Acceptance

在真实安装的官方 DSH composition 上，用户能选择 model/profile/permission、启动 Skill Steward、看到 session stream 和 domain tool calls，并在 DSH 缺失、版本不匹配、断线或取消时得到明确恢复状态；Agent 不能直接写 Provider。
