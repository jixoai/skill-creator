# Proposal: dsh-webui-composition

## Problem

上一轮把 DSH 当作 daemon 侧的 ACP/stdio adapter，完全没有实现用户要求的产品合并：DSH WebUI 已经提供 Agent 配置、模型/profile、session、stream、permission、approval 和交互面板；Skill Creator 需要在这个基础上成为一个带 Manager authority 的 Skill Steward，而不是继续维护第二套通用聊天 UI。

## Outcome

以官方 DSH Web profile 和 client plugin composition 作为 Agent 产品宿主，将 Skill Creator Manager、Skill Intelligence、Creator、Repository 和 Skill Steward 以同一套 DSH Web composition 提供。DSH 负责 Agent runtime/UI infrastructure；Skill Creator 负责 Workspace/Provider/Skill identity、context snapshot、finding、proposal、revision-safe apply、rollback 和 audit。

## Scope

- 采用官方 `@deepseek-ai/dsh-web-app` / `@deepseek-ai/dsh-client-web` 的真实版本和插件加载机制。
- 为 Skill Creator 建立 DSH client plugin/bundle，接入 Manager RPC 和专属 Skill Steward tools、prompts、task workflow。
- 将 DSH 的 Agent settings、model/profile、session transcript、stream、permission 和 approval UI 合并进 Skill Creator 的产品入口。
- 将现有 Manager surface 迁移到同一宿主；一个生产入口、一个 Agent session authority、一个 Manager mutation authority。

## Non-goals

- 不使用 iframe、打开第二个独立 DSH 页面或保留 ACP chat 作为产品替代。
- 不把 DSH session/profile/store 当作 Skill Manager 的数据源。
- 不在此阶段做公开 skill 市场、社交分享或多租户云服务。
