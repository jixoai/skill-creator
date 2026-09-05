<!--
文件意图（2026-09-05）
用户原始需求摘录：「当前这个项目是 ../skill-creator 这个项目的升级……我想把它开发成本地的技能管理器。它首先得是一个管理器，然后接入 Agent 能力。我有打算使用 deepseek-dsh 作为 harness 基座，或者使用 codex-harness 作为基座。你先调研一下，目前的这个管理器也非常初级，我希望听听你的意见。」
正交意图：
  [1] 记录旧版、新版与候选 harness 的可复查事实。
  [2] 划分 Manager 控制平面与 Agent 执行平面的边界。
  [3] 给出 harness 选型和分阶段演进建议。
妥协声明：候选项目版本持续变化；本记录固定了调研时的 Git commit，后续实现仍需重新核对协议。
-->

# Skill Creator 本地技能管理器调研

日期：2026-09-05  
调研边界：当前仓库 `82dfda351ad8a689fd610d808d77aded8e03f37a`，旧版 `../skill-creator` 的 `10d758697413a77a7c070d0fbf80a81512d8eeb9`，DeepSeek Harness `d347e703908d0406b7a7ef80e3a0e594d86b2215`，OpenAI Codex `ddf04ad26789d040f9ef6a96736f76602e35a6cc`。

## 结论

Skill Creator 的产品主语应该是 **Manager**，不是某个 Agent。Manager 拥有技能的身份、来源、作用域、文件内容、revision、校验、启停、安装和更新结果；Harness 只负责在一个被授权的上下文里执行推理、工具调用和对话。

因此不建议把 DSH 或 Codex 的代码树直接变成 Skill Creator 的基座。建议保留现有 Node daemon + WebUI 作为控制平面，定义一个版本化的 `HarnessAdapter`，先以外部进程桥接，逐步接入 DSH 和 Codex：

```text
WebUI
  |
  v
Skill Creator daemon  (Manager authority)
  |-- Workspace / Provider / Skill / Source / Revision
  |-- scan / validate / install / update / enable
  |-- draft / approval / audit / lifecycle
  `-- HarnessAdapter
        |-- ACP adapter (generic first)
        |-- DSH adapter (plugin/profile based)
        `-- Codex adapter (app-server based)
```

第一阶段只需要选一个**默认 Agent**用于 Creator 辅助；接口不要绑定 DSH 或 Codex 的专有模型、会话和 UI 数据结构。

## 现有项目盘点

### 旧版 `../skill-creator`

旧版是一个文档和搜索 CLI，不是管理器。它的核心能力是：

- `createSkill`、`init`、`removeSkill` 等文件工作流；
- Context7 下载、Markdown 内容索引和搜索；
- MiniSearch、模糊搜索和 sqlite-vec 等多种搜索后端；
- CLI JSON contract、scope 选择和发布检查。

它没有 daemon、Workspace/Provider 注册、原子 revision 写入、Git 固定快照、多目标安装或 Agent 会话边界。v2 继承了创建/校验意图，但产品边界已经从“创建工具”变成“本地技能工作台”。

证据：旧版 `package.json` 的脚本、`src/commands/`、`src/core/`；旧版 README 和提交 `10d7586`。

### 当前 v2

当前 v2 已经有一条相当完整的 Manager 内核：

- Workspace registry：canonical path、opaque `ws_*` 身份、Global/Imported Workspace、Provider projection；
- Skill service：按 Workspace Provider 发现、读取、启停和校验；
- Creator service：`SKILL.md` frontmatter round-trip、atomic write、SHA-256 revision 检查、删除；
- Repository service：临时 shallow clone、固定 commit、scan/preview/install、逐目标安装结果复核；
- source registry、skills-cli update、OpenTray 生命周期和 WebSocket/oRPC transport；
- ACP bridge：发现本机 CLI、spawn 子进程、stdio 与 WebSocket 转发。

这些能力与 Manager 方向一致，问题主要在于产品表面和责任边界还没有收敛：

1. 工作树存在大量未提交改动，`webui/src/routes` 正在从旧页面迁移到 app/shell 结构；当前应先冻结领域契约，再继续增加功能。
2. ACP discovery 目前把多个二进制统一按 `--acp` 探测；`which` 命中不等于协议握手成功，Agent registry 需要 capability/handshake 状态。
3. ACP 文件安全门只拦截 `readTextFile`/`writeTextFile`。Agent 通过 shell 或自身工具访问文件时，不能仅靠这道门实现沙箱；必须使用 Harness 自己的 sandbox/approval，或让 Agent 只能操作隔离 draft。
4. Creator 的“AI 改写技能”还缺一个 Manager-owned draft/patch 流程。让 Agent 直接写已安装 Provider 会绕过 revision、预览和用户确认。
5. `Skill`、`Agent`、`Harness session`、`Run`、`Permission` 目前还未形成统一的公开产品词汇；没有这层模型，接入第二个 harness 时会把专有字段泄漏到 RPC 和 UI。

## DeepSeek Harness

调研版本：`deepseek-ai/deepseek-harness`，commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`。

官方架构是 **everything-is-a-plugin**：Cordis context 中的模型适配器、工具注册、session log、agent loop 和 Web UI 都是可替换插件。运行时由 profile 和 bundle 组合，官方提供 `web`、`headless`、`sdk`、`sdk-minimal`、`acp` 等 profile；层通过 `cordis.patch.yml` 覆盖配置。插件可以作为 npm bundle 安装到 profile，生命周期 effect 会在卸载时回收。

官方 ACP 包 `@deepseek-ai/dsh-acp` 是 automation-only server：支持 `session/new`、`session/list`、`session/resume`、`session/close`、`session/prompt`、`session/update`、权限请求和模型/推理选项；session 可持久化并跨进程 resume。它明确不提供 DSH UI 私有卡片、terminal、plan、额外目录和 client filesystem API。

适配价值：

- TypeScript/Cordis 与当前 daemon 技术栈接近；
- 插件、profile、bundle 与“技能生态”概念天然相邻；
- ACP server 可作为 Manager 的外部 Agent adapter；
- 有成熟的 session event、工具生命周期和权限扩展点。

主要风险：

- 官方 README 明确处于 developer preview，存在 compatibility-breaking changes；
- profile/home/plugin 安装模型会引入第二套状态和依赖管理，可能与 Manager 的 Workspace/Provider 产生双重真相；
- `dsh plugin add` 安装包时可能执行 package 代码，官方文档要求用户显式授权并建议 pin commit；
- Cordis 是很大的运行时抽象，直接把 Skill Creator 变成 DSH plugin 会让管理器依赖 DSH 的发布节奏、模型目录、session persistence 和 UI 语义。

判断：DSH 适合作为**第一个可选 Agent backend**，或作为“Agent 能力实验 profile”；不适合作为 Manager 的主数据库、文件权限层或产品路由基座。

证据：`README.md`、`docs/architecture.md`、`packages/acp/acp/README.md`、`docs/user/develop/basic/publish.md`，均来自上述固定 commit。

## OpenAI Codex / app-server

这里将“codex-harness”按 OpenAI Codex 官方开源仓库的执行内核理解；若目标是另一个同名项目，应单独固定仓库再复核。

Codex 的 `codex app-server` 是供 VS Code 等富客户端使用的双向 JSON-RPC 服务。官方 app-server 文档定义了：

- stdio JSONL、Unix socket，以及实验性的 WebSocket transport；
- `initialize` 后的 `thread/start`、`thread/resume`、`thread/fork`；
- `turn/start`、`turn/interrupt` 和 item/agent-message/tool 的增量通知；
- thread/turn/item 三层持久交互模型；
- sandbox、approval、MCP、model/cwd/permission 选项；
- 运行时生成与当前版本匹配的 TypeScript/JSON Schema。

Codex 自己也有 skills 和 plugin marketplace 代码，但其身份、配置和安装语义以 Codex thread、`CODEX_HOME`、plugin marketplace 为中心。app-server 文档同时标注 WebSocket 为 experimental/unsupported；稳定的本地集成应优先使用 stdio 或 Unix socket，并由 Manager 做桥接。

适配价值：

- app-server 是明确的机器客户端边界，适合 Manager 做外部 process adapter；
- thread/turn/item 和通知流适合实现 Creator 的对话、运行记录和可恢复会话；
- sandbox/approval 是比“只拦截文件 RPC”更完整的执行安全基础；
- schema 可由运行中的 Codex 生成，便于版本锁定和 runtime validation。

主要风险：

- 核心是 Rust 大型 monorepo，直接内嵌会带来构建、发布和升级成本；
- app-server 协议随 Codex 版本演进，必须 pin binary/schema，不应把其内部 Rust 类型复制进共享契约；
- Codex 的 workspace/plugin/skill 语义不是通用技能 Manager 的领域模型；
- WebSocket 目前不适合作为生产依赖，Manager 需要自己拥有本地 IPC 和认证。

判断：Codex 更适合做**可靠的执行引擎 adapter**，尤其适合以后需要 sandbox、approval、thread resume 和多轮运行记录的场景；它仍不应拥有 Manager 的 Workspace/Provider/Skill 真相。

证据：`codex-rs/app-server/README.md`、`codex-rs/app-server-daemon/README.md`、`docs/skills.md`，来自 `openai/codex` 固定 commit `ddf04ad26789d040f9ef6a96736f76602e35a6cc`。

## 选型比较

| 维度         | DeepSeek Harness                  | Codex app-server              | 对 Skill Creator 的决定                  |
| ------------ | --------------------------------- | ----------------------------- | ---------------------------------------- |
| 接入边界     | ACP、Cordis plugin/service        | JSON-RPC app-server           | 两者都走外部 adapter，不内嵌             |
| 当前技术距离 | TypeScript，较近                  | Rust，进程边界明显            | 先做协议适配，不复制内部类型             |
| UI/插件扩展  | 强，插件树和 profile 原生         | 强，但以 Codex 产品模型为中心 | Manager 自己拥有 UI                      |
| 会话能力     | ACP 持久 session、标准更新        | thread/turn/item、resume/fork | Manager 只存引用和审计投影               |
| 执行安全     | DSH sandbox/approval，可组合      | sandbox/approval 已是核心能力 | Agent 操作必须再过执行安全策略           |
| 版本风险     | developer preview，明确会破坏兼容 | app-server/CLI 版本绑定       | adapter 必须带 capability + version gate |
| 首期建议     | 首个实验 backend                  | 第二个 backend / 强安全场景   | 先 ACP contract，再分别实现              |

## 建议的 Manager 领域模型

先把以下对象固化为 Manager-owned contract：

```text
Workspace
  `-- Provider
       `-- Skill (canonical path, frontmatter, validation, enabled)

Source -> ScanSession(commit) -> RemoteSkill -> InstallAttempt -> Provenance

SkillDraft -> Revision -> Validation -> UserApproval -> Apply

AgentDefinition -> HarnessAdapter -> AgentSession -> Run -> PermissionDecision
```

其中：

- `AgentDefinition` 是本机可用执行器的 capability 描述，不等于二进制路径；
- `HarnessAdapter` 只暴露 start/resume/prompt/cancel/events/approval/close 等最小能力；
- `AgentSession` 只引用 Manager 的 Workspace/Provider 或隔离 Draft，不拥有路径组合权；
- `Run` 保存输入、输出摘要、工具事件、变更集和最终 validation 结果；
- `PermissionDecision` 是一次性、可审计的用户决定，不能被 Agent 自行推断；
- AI 生成必须先进入 Draft/patch，Manager 校验并由用户确认后才能写入 Provider。

建议的第一版 adapter 形状：

```ts
interface HarnessAdapter {
  discover(): Promise<AgentDefinition[]>;
  open(input: { agentId: string; executionRoot: string }): Promise<AgentSessionRef>;
  prompt(session: AgentSessionRef, input: PromptInput): Promise<void>;
  events(session: AgentSessionRef): AsyncIterable<AgentEvent>;
  cancel(session: AgentSessionRef): Promise<void>;
  close(session: AgentSessionRef): Promise<void>;
}
```

这个接口故意不包含 `writeFile(path)`、provider-specific model types 或 UI card。文件变更应作为 Agent 工具调用/patch 事件进入 Manager 的安全门。

## 演进顺序

### M0：冻结 Manager 真相

- 清理当前迁移中的 route/app shell，确认唯一的 Workspace、Provider、Skill、Source、Revision 词汇；
- 把当前未提交变更拆成可验证的垂直切片；
- 补齐 `AgentDefinition`、`AgentSession`、`Run`、`PermissionDecision` 的 shared contract，但先不绑定具体 harness；
- 明确“Global Workspace 只读管理、Imported Provider 才能写入”的不变量。

### M1：把管理器做完整

- Workspace/Provider 列表、skill 详情、启停、校验、创建/编辑/删除；
- Repository scan/preview/install 和 provenance；
- update 检查、失败/冲突/跳过的真实反馈；
- Manager-owned audit/run record；
- 独立的 draft apply 流程，所有 mutation 仍由 daemon 解析 opaque ID 和路径。

### M2：接入一个 Agent

- 先实现 ACP-compatible adapter，完成 capability handshake，而不是只做 `which`；
- 首选 DSH ACP 作为实验 backend，默认以隔离 draft root 启动；
- Creator 只展示消息、工具状态、待批准变更和 validation，不把 DSH 私有 UI 状态写入 Manager contract；
- session 断线、重连、取消、退出和 daemon stop 都要有明确终态。

### M3：执行安全和 Codex adapter

- 接入 Codex app-server 的 stdio/Unix socket；
- 将 sandbox/approval 映射到 Manager 的 PermissionDecision；
- 用 thread/turn/item 做 Run 的事件投影，Manager 只保存可重建的摘要和 provenance；
- 对 DSH/Codex 版本分别做 capability matrix 和 contract tests。

### M4：技能生命周期闭环

- AI 生成或修改 Draft；
- Manager 运行静态校验、测试样例和可选 harness eval；
- 用户批准后原子应用 revision；
- 从来源 commit 追踪更新，允许回滚和冲突处理；
- 将通过验证的技能发布到 Repository/source，而不是把发布逻辑交给 Agent。

## 不建议现在做的事

- 不要先做“支持所有 Agent”的 UI；先做一个 adapter 和清晰的 capability/error 状态。
- 不要把 DSH profile、Codex thread 或某个 CLI 的配置文件当成 Skill Creator 的数据库。
- 不要让 Agent 直接写已安装 skill 目录；先做隔离 draft + patch + validation + approval。
- 不要为兼容两个候选而在同一 RPC schema 中堆 provider-specific 可选字段；用 adapter 文件和 discriminated union 物理隔离。
- 不要在 ACP bridge 上宣称“已沙箱化”；只有执行引擎的 sandbox/approval 或隔离工作目录能支撑这个结论。

## 一手资料

- [DeepSeek Harness README](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/README.md)
- [DeepSeek Harness Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/docs/architecture.md)
- [DeepSeek Harness ACP package](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/acp/acp/README.md)
- [DeepSeek plugin publishing guide](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/docs/user/develop/basic/publish.md)
- [OpenAI Codex app-server README](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/app-server/README.md)
- [OpenAI Codex app-server daemon](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/codex-rs/app-server-daemon/README.md)
- [OpenAI Codex skills documentation](https://github.com/openai/codex/blob/ddf04ad26789d040f9ef6a96736f76602e35a6cc/docs/skills.md)
- 当前仓库：`README.md`、`AGENTS.md`、`src/daemon/*`、`src/shared/contracts/*`、`openspec/changes/acp-agent-bridge/*`。
