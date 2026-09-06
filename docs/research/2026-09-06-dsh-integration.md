# DeepSeek Harness integration audit

审计日期：2026-09-06  
事实源：官方仓库 `deepseek-ai/deepseek-harness`，commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`，本地 checkout `/tmp/deepseek-harness-review`。

本报告只记录源码可复用的 seam。官方仓库版本为 `0.1.3-alpha.1`、MIT；要求 Node `^22.19.0 || >=24.0.0`。当前本地 `/Users/kzf/Dev/GitHub/dsh` 是 `dsh-herdr` 插件，不能作为官方 Web/Agent SDK 的替代证据。

## 推荐拓扑

```text
DSH Cordis composition
  agent-loop -> agent -> session + persistence
       |             |
       v             v
  llm adapters    tools + systemPrompt + approval + sandbox
       |
       v
Skill Creator plugin
  typed skill tools -> immutable manager snapshot -> proposal/patch
  revision validation -> approval -> manager-owned apply/audit
       |
       v
DSH client/web remote and session projections
```

DSH 应作为运行时基础设施；Workspace、Provider、Skill、revision、proposal、apply 和审计仍由 Skill Creator 持有。不能让 DSH session/profile 变成技能事实源。

## Agent 配置与生命周期

来源：`packages/core/agent/src/runtime-types.ts:26-36,109-129`、`packages/core/agent/src/index.ts:165-207,400-424`、`packages/core/agent-loop/src/index.ts:359-423`。

- `AgentOptions` 提供 `provider`、`model`、adapter-owned `reasoningEffort` 和 `maxTokens`。
- `ctx.agents.create({ sessionId, meta, seed, agentOptions, setup })` 返回只由创建者持有的 `AgentHandle`；`resume({ resumeSessionId, agentOptions, setup })` 从持久化会话恢复。
- `setup(agentCtx)` 在发布前完成，可在 agent scope 注册工具、prompt、变量、限制和事件监听；setup/commit 失败会回滚，适合安装 Skill Steward 的专属能力集。
- `Agent` 暴露 `session`、`inbox`、`status`、`ctx`、`followup`、`steer`、`inject`、`cancel`、`whenIdle`。取消默认清空 inbox，可 `keepInbox` 保留待处理输入。
- `installModelSelection(agentCtx, selection)`（`packages/core/agent/src/model-selection.ts:9-74`）把 prompt assembly 与实际 request 的 provider/model/effort 绑定，避免并发切换拆裂一次请求。

关键事件：`agent/pre-step` 可拒绝或替换进入 step 的消息；`agent/request` 可修改本次 `LlmCallConfig`；`agent/request-error` 可拥有 retry；`agent/assistant-stream` 发布 start/chunk/end；`agent/turn-stopping` 可追加 steering；`agent/error` 观察错误。Skill Steward 应使用这些事件做进度投影和恢复，不能从最终文本猜测结构化结果。

## 模型、profile 与流式事件

来源：`packages/llm/llm/src/index.ts:53-72,161-180,192-255`、`packages/llm/llm/src/types.ts:39-50,195-239`、`packages/core/agent-default-model/src/index.ts:21-74`。

- `ctx.llm` 是 adapter registry。适配器通过 `registerAdapter(providers, adapter)` 注册；`LlmAdapter` 提供 `providerInfo`、`listModels`、`resolveModel`、retry policy 和 `prepare`/`stream` 相关能力。
- `LlmRuntime` 有 `llm/stream` waterfall；监听器可以 retry、replay 或路由，但 loop 构建的请求是 deep-frozen 且不可改写。
- `LlmProviderInfo { id, name }` 是路由目录；`LlmConfigurableProvider { provider, displayName, settingsNs, settingsPath, declared? }` 是设置 UI 可用的 provider profile 目录。`llm/adapters-updated` 是无 payload 的刷新通知。
- agent 默认模型由 `agent-default-model` settings namespace 持有 `{ provider, model, reasoningEffort? }`，并在无 session-specific selection 时使用。Skill Creator 可以把“技能管家模型”做成自己的 profile/选择层，再映射为 `AgentOptions`。
- `StreamChunk` 经过 adapter 翻译为 text/reasoning/tool-call 等标准 block；agent 层的 `AssistantStreamFrame` 是给 UI 的进程内事件。end 之前，loop 会把完整 compact stream 作为一个 `assistant/message` 或 `assistant/attempt` 写入 session；因此 chunk 只适合实时 UI，回放必须读 durable event。

限制：model catalog 是 advisory；`listModels` 没有列出的模型不代表 request 必然拒绝。provider/model 的真实可用性必须在 adapter dispatch 时验证。

## 专属 Tool registration 与限制

来源：`packages/core/tools/src/index.ts:204-240,581-704,780-828,1028-1087,1333-1540`、`packages/core/system-prompt/src/index.ts:388-570`。

- `ToolDefinition` 要声明输入 schema、canonical JSON output schema、`execute(args, exec)`，并可声明 call/result presentation；`ctx.tools.register(definition)` 返回 disposer。
- tool execution pipeline 是 `tools/pre-execute`（allow/deny/ask）、`tools/execute`（timeout/retry/metrics）、`tools/post-execute`（接受/替换/阻断）和 `tools/result`（最终冻结结果）；每一步都有 cancellation signal。
- `ctx.tools.restrict({ allow?, deny? })` 必须从 `agent.ctx` 使用，因而可为每个管家 agent 安装最小能力集；全局 restriction 会被拒绝。工具注册和 restriction 变化触发 `tools/change`。
- `ctx.systemPrompt.tools(context => ...)` 动态提供 schemas；`section`、`context`、`variable` 都是有序、可 scoped、可 disposer 的 prompt seam。Skill Steward 的版本化 system prompt 和任务模板应在 agent setup 中注册，名称/版本应进入 Manager 审计。
- 专属工具建议按领域拆成 `skill.snapshot`、`skill.inspect`、`skill.validate`、`skill.propose_patch`、`skill.propose_split`、`skill.propose_merge`、`skill.apply`（后者必须经 Manager approval），每个输出使用稳定 JSON union；不要解析 agent 最终文本中的 JSON。

## Session 与 persistence

来源：`packages/core/session/src/types.ts:258-313,447-470`、`packages/session/session-persistence/src/index.ts:45-197`。

- session 是 event-sourced log；标准 durable vocabulary 含 turn/step、user/assistant、tool call/result、assistant embedded stream。未知 event vocabulary 在当前格式下 fail closed。
- `ctx.sessionPersistence.create(header, options)` / `open(id, 'read'|'write', options)` 返回 per-session handle；`stat`/`list` 只读 metadata + opaque revision，`flush` 是 durability barrier。写 ownership 是单写者，append 后读保证看到至少该 prefix。
- session header 可带 `cwd`、parent lineage、origin、delegation depth 等；可把 Skill Steward task id / manager scope 放入 Manager 自己的事件或 metadata，不应篡改 DSH 内建语义。
- session append 是回放事实源，assistant stream 的实时 frame 不应直接当持久化协议。Manager proposal/apply/audit 应有自己的明确事件/存储边界，并用 session id 关联 Agent 会话。

## Approval、permission 与 sandbox

来源：`packages/interaction/user-approval/src/index.ts:47-68,103-124,142-225`、`packages/sandbox/sandbox/src/index.ts:20-122,177-236`、`packages/sandbox/sandbox-policy/src/index.ts:89-167`。

- `ApprovalService.request({ agent, toolName, callId?, reason?, signal? })` 只允许在 open turn 内调用；每次请求写 `approval/asked` + `approval/decided` 审计 pair。结果 vocabulary 为 `allowed-once | rejected | cancelled | unavailable`，缺少 answerer 或 answerer 出错时 fail closed。
- policy 为 `ask | never`；`never` 用于 CI/headless。`approval:policy` 作为 runtime context 注入模型，但不应被当作 Manager apply 的最终授权；Manager 仍需自己检查 scope、revision 和 proposal 状态。
- `SandboxProvider.confine(argv, policy)` 接受 per-call policy：`read-only`、`workspace-write`、`danger-full-access`，无 backend 时 confined mode 必须拒绝，不得静默 unconfined。`SandboxPolicyService.resolve({ session?, mode? })` 以 session cwd 和 session override 解析最终 root/mode。
- 对技能管家而言，读取/分析可用 read-only；生成 patch 可写入独立 draft/snapshot 目录；真实 Workspace.Provider mutation 仍应走 Manager 的 revision-safe apply，不可直接给模型任意文件句柄。

## Web、session UI、stream transport 与插件加载

来源：`apps/web/src/main.ts:1-6`、`packages/client/web/src/index.ts:1-11`、`packages/client/connection/src/index.ts:67-132`、`packages/client/ui-session/src/client/index.ts:213-499`、`packages/client/ui-chat/src/client/apply.ts:45-165`、`packages/boot/app-boot/src/index.ts:804-860`。

- 前端入口只有 `new AppWebEntry(root).run()`；`@deepseek-ai/dsh-client-web` 暴露 `AppWebEntry`、静态 module table 和平台 module contract。Web shell 不是独立业务 app，启动注入 `window.__DSH_BOOT__` 等 boot seam。
- `client-connection` 在 `/api` 提供受 Host/Origin trust fence + persistent browser auth 保护的 RPC gateway；动态远程事件通过 `ctx.remote.$on(...)`，客户端业务插件通过 `inject` 声明 `remote.<namespace>`、`sessions`、`slots` 等依赖。
- UI session (`UiSession`) 维护 session snapshot、pending interaction publisher、source contribution；ui-chat 把 durable session projections 和实时事件折叠为 transcript node。Skill Creator 可复用 session/chat/approval 的 transport 与 slot 模型，但必须挂自己的业务 view/store/remote namespace。
- 服务端插件由 Cordis `ctx.plugin(...)`/Loader 按 manifest/profile composition 加载；插件可声明 `name`、`inject`、`Config` 和 `apply`，注册 service、tool、prompt、remote 与事件。客户端同样是 plugin，使用 `inject` + slots + `ctx.remote`。DSH 官方源码没有一个承诺“外部应用直接嵌入整套 WebUI”的稳定高层 API，因此集成应优先采用 plugin composition 和独立 App surface，避免复制内部组件。
- `dsh-web-app` 负责静态 frontend、Web URL、web-surface prompt、browser handoff；它不是 Agent 管家业务层。

## 对 Skill Creator 的落地顺序

1. 先在 Manager 内定义 immutable `SkillStewardContextSnapshot`、typed `SkillToolCall`、`SkillFinding`、`SkillProposal`、`SkillPatch`、revision/validation/audit contracts。
2. 写 fixture Agent adapter，使用 DSH `ctx.agents.create + setup + tools.register + systemPrompt` 跑完整 vertical slice：observe → propose → validate → approval → Manager apply → audit → rollback。
3. 再接 DSH 的真实 `llm` adapter/profile 和 `assistant-stream` 到 WebUI；流式文本只做过程显示，工具事件和 Manager 事件做结构化卡片。
4. 最后把 Agent 配置、session list/detail、模型 profile、approval 面板接入现有 shell 的 remote/slot 边界；DSH 不可用时 Manager、Creator、Repository、确定性 Intelligence 仍须可用。

## 审计困难与解决方式

- 目录没有 `packages/agent`、`packages/tool`、`packages/session-persistence` 这些直观路径；实际实现分布在 `packages/core/agent`、`packages/core/tools`、`packages/core/session` 和 `packages/session/session-persistence`。通过 package.json 的 package name 与 `find/rg` 重新定位。
- 初始搜索只读 README，容易把 adapter/插件能力误判为缺失；改为追到 `src/index.ts`、runtime types、测试和 client entry，并用带行号源码作为证据。
- 本地 `/Users/kzf/Dev/GitHub/dsh` 与官方 harness 同名语境但只是 `dsh-herdr` 插件；将两者明确分开，官方源码 commit 作为唯一 Agent/Web API 事实源。
- Agent stream 是实时 presentation，而 session event 才是 replay source；报告明确区分两者，避免后续把 chunk 或 UI 文本当领域协议。

## 结论与限制

DSH 官方源码足以作为 Skill Creator 的 Agent runtime foundation：它提供 scoped setup、typed tools、prompt assembly、model/profile registry、durable sessions、stream events、approval 和 sandbox。它没有替 Skill Creator 定义技能领域的 snapshot、冲突分析、patch、拆分/合并或 Manager-owned apply；这些必须在本项目实现。官方包仍是 alpha，版本和内部 Web 组件 API 可能变化，生产接入必须锁定 commit/版本并保留 fixture adapter 与完整回归证据。

## DSH Web composition 事实表（dsh-webui-composition task 0.1，2026-09-06 npm 实测）

来源：`npm view <pkg> versions/peerDependencies/dependencies`、临时目录 `pnpm add -E` clean install
（浏览器面 `/tmp/dsh-web-facts-*`、服务端 host `/tmp/dsh-webapp-facts-*`）、安装产物
`lib/index.js`/`lib/client.js`/`package.json` 逐文件阅读。锁定原则：全部候选包取与 runtime
五包同代的 `0.1.2-rc.1`。

### 包事实

| package                                                          | 锁定版本   | peer graph（声明）                                                                                           | entry / 加载结果                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@deepseek-ai/dsh-client-web`                                    | 0.1.2-rc.1 | 仅 `cordis ^4.0.2`（不完整）                                                                                 | `lib/index.js` 导出 `AppWebEntry`；**React 浏览器构建**：import `boot-page.module.css`、`react`、`react-dom`、`react/jsx-runtime`、`cordis-plugin-loader`、`dsh-client-store`、`dsh-client-ui-primitives`、`dsh-client-ui-slots`。Node 原生 ESM 加载失败（`ERR_UNKNOWN_FILE_EXTENSION ".css"`）——只能在 bundler（Vite css 处理）或浏览器宿主内加载。这是预期形态，不是缺陷。 |
| `@deepseek-ai/dsh-client-connection`                             | 0.1.2-rc.1 | `cordis ^4.0.2`                                                                                              | `./client` 子入口是浏览器模块；deps：zod、dsh-credentials、schemastery（服务端 bundle 内提供）                                                                                                                                                                                                                                                                               |
| `@deepseek-ai/dsh-client-ui-session`                             | 0.1.2-rc.1 | `cordis ^4.0.2`                                                                                              | `./client` = `window.__ModuleLoader__.load({ id, factory: (require) => … })` 工厂模块——客户端插件只能在 DSH web shell 的模块加载器内执行，factory 内 require `dsh-client-store`、`dsh-client-ui-slots`、`react`                                                                                                                                                              |
| `@deepseek-ai/dsh-client-ui-chat`                                | 0.1.2-rc.1 | `cordis ^4.0.2`                                                                                              | 同上形态；deps schemastery                                                                                                                                                                                                                                                                                                                                                   |
| `@deepseek-ai/dsh-client-store` / `-ui-primitives` / `-ui-slots` | 0.1.2-rc.1 | —                                                                                                            | client-web/ui-session 的隐藏依赖（未被声明为 peer），必须显式锁定安装                                                                                                                                                                                                                                                                                                        |
| `@deepseek-ai/cordis-plugin-loader`                              | 1.0.3      | —                                                                                                            | client-web 隐藏 peer；也是 dsh-web-app 的 peer                                                                                                                                                                                                                                                                                                                               |
| `@deepseek-ai/dsh-web-app`                                       | 0.1.2-rc.1 | `cordis ^4.0.2`、`cordis-plugin-loader ^1.0.3`、`dsh-shell-env ^0.1.2-rc.1`、`dsh-system-prompt ^0.1.2-rc.1` | 服务端 web host 启动器：CLI（deps commander/open）+ 72 直接依赖（client-ui-* 全家桶）；exports 含 `./startup`（启动 seam）与 `./cordis.patch.yml`（Cordis profile patch——客户端 plugin 的 manifest 通道）。clean install 180 个 .pnpm 条目全解析                                                                                                                             |
| `@deepseek-ai/dsh-user-approval`                                 | 0.1.2-rc.1 | dsh-agent/brand/llm/scope/session/system-prompt/invariants + cordis                                          | 服务端 approval 服务（runtime 面，非浏览器）                                                                                                                                                                                                                                                                                                                                 |

### 隐藏 peer（peerDependencies 未声明但构建实际 import）

`dsh-client-web`：`react`、`react-dom`、`@deepseek-ai/cordis-plugin-loader`、
`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`、
`@deepseek-ai/dsh-client-ui-slots`。实测 react@19 系可用；缺任一项 → 浏览器端
module-not-found。仓内安装面把后四者并入 `DSH_WEB_LOCKED_PACKAGES`，react 系记录在
`DSH_WEB_HIDDEN_PEER_PACKAGES`，缺失时投影 typed unavailable（MISSING_PEER）。

### clean install 记录

- 浏览器面（client-web/connection/ui-session/ui-chat + client-store/ui-primitives/ui-slots
  - cordis-plugin-loader + cordis@4.0.2 + react@19）：pnpm 解析成功；`/client` 子入口均为
    `window.__ModuleLoader__` 工厂模块（Node 下执行会在 `window` 处 ReferenceError——证明
    它们只能进 DSH web shell）。
- 服务端（dsh-web-app@0.1.2-rc.1）：72 直接依赖、180 .pnpm 条目全部解析；无版本冲突。

### 架构结论（后续任务的边界）

1. DSH web shell 是 **React** 应用；Skill Creator 的 Svelte 组件不能直接进它的 slots，
   只能按 3.1a 的 host/island 方式挂载，或产出同形态 `window.__ModuleLoader__.load` 的
   client 插件（1.2）。
2. `dsh-web-app` 是官方 host 启动器（含 CLI 全家桶）；本仓 1.1 优先复用其 `./startup`
   与 boot manifest，而不是把 72 个依赖全部引入 daemon——daemon 只需提供 loopback RPC
   与静态宿主页。
3. 任何缺包/版本漂移/隐藏 peer 缺失都走 `DshWebRuntimeStatusSchema` 的 typed
   unavailable + recoveryCommand，不猜测、不静默降级。
