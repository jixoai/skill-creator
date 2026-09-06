# DSH WebUI Integration Audit

审计日期：2026-09-06

本文件区分两个同名但不同的事实源：本机 `/Users/kzf/Dev/GitHub/dsh` checkout，以及 DeepSeek 官方仓库 `deepseek-ai/deepseek-harness` 的源码快照。前者不能代表后者。

## Local checkout evidence

目标路径：`/Users/kzf/Dev/GitHub/dsh`

当前 checkout 的 `package.json`：

- package name：`dsh-herdr`
- version：`0.1.0`
- description：`DSH plugin: list, create, and attach to herdr terminals from the Web GUI header`
- DSH manifest：`dsh.bundle.patch`、`dsh.client.platform=web`
- client injection：`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-locale`

当前源码 API：

```text
GET /plugins/dsh-herdr/state?cwd=<session cwd>
POST /plugins/dsh-herdr/terminals
WS /plugins/dsh-herdr/stream?terminal=<id>&cols=N&rows=M
```

`src/herdr.js` 通过 `herdr api snapshot`、`herdr tab create` 和 `herdr terminal session control` 获取 workspace、tab、pane 和 terminal；`src/stream.js` 为每个 WebSocket 连接启动 terminal control 子进程，并在 dispose 时回收。

## Official DeepSeek Harness source evidence

审计命令：

```text
git ls-remote https://github.com/deepseek-ai/deepseek-harness.git HEAD
=> d347e703908d0406b7a7ef80e3a0e594d86b2215
```

源码快照：`/tmp/deepseek-harness-review`。根版本为 `0.1.3-alpha.1`，MIT；根 `package.json` 声明 Node `^22.19.0 || >=24.0.0`，并明确采用 `everything-is-a-plugin` 的 Cordis 组合模型。

官方源码确认了以下可复用能力（引用均来自对应 package 的 README 与 `src`）：

| 能力           | 官方 package / seam                                                                                                                                                                                       | 对 Skill Creator 的结论                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Agent 生命周期 | `@deepseek-ai/dsh-agent` + `@deepseek-ai/dsh-agent-loop`：`ctx.agents.create/resume`, `AgentHandle`, `followup/steer/inject/cancel/whenIdle`, `agent/*` 事件                                              | 复用 agent handle 与事件语义；Manager 仍拥有 run identity 和业务状态                                        |
| 会话与持久化   | `@deepseek-ai/dsh-session`：append-only event log；`@deepseek-ai/dsh-session-persistence*`：独立 persistence backend                                                                                      | 只把 session 作为 transcript/replay 载体；不得把 DSH session log 当技能 registry                            |
| 工具注册与权限 | `@deepseek-ai/dsh-tools`：`defineTool`、Zod-like schema、`ctx.tools.register/restrict/guard`、pre/execute/post/result pipeline；`@deepseek-ai/dsh-user-approval` 与 `@deepseek-ai/dsh-permission-presets` | Manager 注册有限的 domain tools；所有写操作继续经过 Manager approval，不暴露 `read_file`/shell 作为产品契约 |
| 专属提示词     | `@deepseek-ai/dsh-system-prompt`：有序 section/context/variable、agent-scoped shadow、tool schema provider、`assemble()`                                                                                  | 注入版本化 Skill Steward system prompt 与 scope snapshot；prompt version 写入 run record                    |
| Agent 配置     | `@deepseek-ai/dsh-agent-presets`：`agent.cordis.yml`、preset roots、per-session composition、default preset；`@deepseek-ai/dsh-agent-default-model`：provider/model default + settings overlay            | 适配 profile/model 选择；配置只留在 runtime adapter，不写 Manager registry                                  |
| 流式会话 UI    | `@deepseek-ai/dsh-api-session-controller`：session/history/queue、`SessionEventStream`、Gateway remote stream；`@deepseek-ai/dsh-client-ui-chat`：transcript、tool/details、system prompt rows            | 复用事件投影和 UI 交互模式；Skill Creator 自己拥有 finding/proposal/approval projection                     |
| Web 插件装载   | `@deepseek-ai/dsh-client-modules` + `@deepseek-ai/dsh-client-web`：`dsh.client` manifest、Host boot graph、lazy client bundles、slot/UI renderer                                                          | 若接入 DSH WebUI，走公开 client manifest/remote seam；不复制 DSH 私有 store 或替换 boot kernel              |
| 沙箱与审批     | `@deepseek-ai/dsh-sandbox`、`sandbox-local`、`dsh-permission-presets`                                                                                                                                     | Agent runtime 可复用能力状态展示；Provider 文件写入仍由 Manager path-safety + approval 控制                 |

这些 package 的公开说明还明确：工具 schema 会进入 system-prompt assembly；agent-scoped registration 会在 dispose 时回收；session history 是从 append-only log 派生；client bundle 由 Host 提供并按 manifest 惰性加载。它们构成可实现的 integration seam，但不是把整个 DSH WebUI 嵌入 Skill Creator 的授权。

官方源码没有在本次审计中证明一个独立、稳定的“DSH WebUI SDK”或可直接 import 的 Agent 配置面板组件。因此实现任务必须先建立 Skill Creator 自己的 adapter 和 projection，再针对实际安装的 DSH composition 做 capability handshake；不能把仓库 README 中的 package 名称误当成已发布的跨项目 UI API。

## Consequence

该 checkout 是一个终端/工作区插件，不是可直接证明 DSH Agent 配置、模型目录、权限策略或会话数据库的 SDK。它可以作为 Skill Creator 的 terminal/session UI 参考，也可以作为未来插件 integration seam 的运行时依赖候选，但不能据此推断 `dsh-acp` 命令或 ACP capability。官方 harness 源码则证明了 Agent、session、tool、prompt、preset、approval 与 Web client 的可组合 seam；这些 seam 需要按版本和实际运行 composition 做握手，不能由本地插件名称推断。

## Required integration decision

实现必须把可复用 UI（Agent 配置、会话列表、流式事件、权限面板）和 Manager 状态（Workspace、Provider、Skill、revision、proposal、approval）分开，使用明确的 adapter/store boundary；DSH store、profile 文件和 terminal snapshot 不能成为 Manager 的事实源。第一阶段以 fixture runtime 验证 Manager vertical slice，第二阶段才允许接入官方 harness；只有真实 handshake、session stream、tool callback 和 unavailable recovery 都通过后，才能宣称融合。

## Verification gap

仍需在目标安装环境补证：

- 实际运行的 DSH composition 是否同时挂载 `dsh-agent-loop`、`dsh-tools`、`dsh-system-prompt`、`dsh-api-session-controller` 与对应 client bundles；
- 目标 DSH WebUI 是否公开可消费的配置/会话组件入口，还是只公开 Remote API；
- DSH profile/plugin 的发布版本与升级策略；
- Skill Creator 如何注册自己的 client plugin，而不复制或侵入 DSH 私有 runtime。
