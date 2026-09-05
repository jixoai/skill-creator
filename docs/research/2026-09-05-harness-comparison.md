# Harness 基座调研：DeepSeek DSH 与 Codex Harness

调研日期：2026-09-05。目标是判断本地技能管理器应如何接入 Agent harness。所有关键判断均来自项目仓库、仓库内 README/源码或 GitHub 官方页面；未把社区文章当作事实来源。

## 先给结论

`skill-creator-v2` 应先成为稳定的本地技能管理器，再通过 adapter 接入 harness。技能发现、Workspace/Provider 作用域、文档编辑、版本/校验、安装与权限是管理器的长期数据和安全真相；harness 只是“执行一个 Agent 任务时如何组织上下文、工具、验证和恢复”的运行策略。把任一 harness 的目录结构直接当作技能管理器模型，会把短期工作流绑定到某个客户端。

第一阶段建议：定义 `HarnessAdapter`（能力探测、启动会话、注入选定 skills、事件/日志流、取消、结果与验证证据），先实现 Codex plugin/MCP 适配；DeepSeek DSH 作为可选的进程/插件适配。不要在核心层引入 DSH 的 Cordis、session 或 React 依赖。

## DeepSeek DSH

### 可核实的项目身份

截至本次调研，没有在可访问的一手仓库中找到名为 `deepseek-dsh/dsh` 的公开官方源码仓库。可确认的官方 npm 命名空间是 `@deepseek-ai/*`：社区插件的 `package.json` 将 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-credentials` 等列为 peer dependency，并要求 Node 22.19+（[dsh-workspace/package.json](https://github.com/deepseek-dsh/dsh-workspace/blob/68b5736e22b29dcda2bc3dc06646aeea399b96d5/package.json)）。因此对 DSH 核心协议的判断应保持“由公开插件接口反推”，不能宣称已审阅官方核心实现。

### 插件与运行模型（公开证据）

`deepseek-dsh/dsh-workspace` 明确自称“Unofficial”，是独立社区项目；README 的安装命令是 `dsh plugin --profile web add "github:deepseek-dsh/dsh-workspace#dev"`，安装后必须重启 `dsh web`。这说明 DSH 的主要扩展边界是 profile/plugin bundle，而不是一个与管理器共享数据库的 SDK（[README.md](https://github.com/deepseek-dsh/dsh-workspace/blob/68b5736e22b29dcda2bc3dc06646aeea399b96d5/README.md#install)）。

该插件的 `dsh` manifest 注入 `@deepseek-ai/dsh-client-runtime` 和 `@deepseek-ai/dsh-client-ui-sidebar`，通过 Cordis patch 挂载到 web profile（[package.json](https://github.com/deepseek-dsh/dsh-workspace/blob/68b5736e22b29dcda2bc3dc06646aeea399b96d5/package.json)、[cordis.patch.yml](https://github.com/deepseek-dsh/dsh-workspace/blob/68b5736e22b29dcda2bc3dc06646aeea399b96d5/cordis.patch.yml)）。服务端注册了 `/api/v1/dsh-workspace/*` 路由，覆盖项目快照、文件/差异/日志、用量摘要、更新和 PTY；源码还显示通过 `ctx.credentials` 解析 API key，并以 `@deepseek-ai/dsh-session` 的事件聚合用量（[src/index.ts](https://github.com/deepseek-dsh/dsh-workspace/blob/68b5736e22b29dcda2bc3dc06646aeea399b96d5/src/index.ts)）。

对技能接入的含义：DSH 适合“把已选技能注入到一个 DSH profile/session”或“在 DSH Web UI 中提供管理入口”；它不提供从该社区插件可见的通用 skill registry、安装事务或跨 Workspace 身份模型，这些必须由本项目保留。

### 维护与许可

`dsh-workspace` 当前公开 HEAD 为 `68b5736e22b29dcda2bc3dc06646aeea399b96d5`（2026-08-20），`package.json` 声明 MIT；README 同时保留 unofficial 警示。它是活跃的社区插件，但不能作为 DeepSeek 官方支持或稳定 API 承诺的证据。来源：[commit](https://github.com/deepseek-dsh/dsh-workspace/commit/68b5736e22b29dcda2bc3dc06646aeea399b96d5)、[package.json license](https://github.com/deepseek-dsh/dsh-workspace/blob/68b5736e22b29dcda2bc3dc06646aeea399b96d5/package.json)（该浅克隆没有独立 LICENSE 文件；发布前应再核对当前 HEAD 的许可文件与依赖许可）。

## “codex-harness”候选并非一个项目

### minhnguyen1108/codex-harness（更像 Codex 原生插件）

README 将其定义为 Codex plugin：Router 决定 direct/harness 路径，Explorer/Planner/Reviewer 只读，唯一 Implementer 可写和运行变更验证；Context7、CodeGraph 是可选 MCP，CodeGraph 不自动初始化。安装通过 `codex plugin marketplace add ...` 与 `codex plugin add ...`，当前 README 标注滚动 `main` 和未公开发布阶段的 `v0.2.0`（[README.md](https://github.com/minhnguyen1108/codex-harness/blob/eea965ddb9e1fc57993c6b395113b698232d072b/README.md)）。

源码布局包含 `.codex-plugin/plugin.json`、skills、agents、hooks、`.mcp.json` 和静态验证脚本；其安全文档明确生命周期 hook 可读写本地插件状态，MCP 只在配置和使用时访问外部服务（[threat-model.md](https://github.com/minhnguyen1108/codex-harness/blob/eea965ddb9e1fc57993c6b395113b698232d072b/docs/security/threat-model.md)）。许可证为 MIT（[LICENSE](https://github.com/minhnguyen1108/codex-harness/blob/eea965ddb9e1fc57993c6b395113b698232d072b/LICENSE)）。

适配评价：与本项目“技能管理器 + Agent 能力”分层最匹配。管理器可以把选定 skill 以 Codex plugin/managed profile 或 MCP 配置暴露给会话；harness 的路由和只写者规则放在 adapter/运行策略层。限制是它依赖 Codex plugin 生命周期，且 README 明确尚非稳定公共 release。

### zzzkeepdd/codex-harness（流程型、脚本驱动）

该仓库是 Trae Harness 的 Codex-native 改编，核心是阶段状态机：research -> Red/Blue/Judge -> locked spec/manifest -> TDD -> code/functional/user QA -> audit。所有阶段产物和 context ledger 落在任务目录；通过 Python `harness_orchestrator.py`、验证脚本和 `SKILL.md` 驱动（[README.md](https://github.com/zzzkeepdd/codex-harness/blob/10c6c0096b020897ac53cec460e244ef1382104c/README.md)）。许可证 MIT（[LICENSE](https://github.com/zzzkeepdd/codex-harness/blob/10c6c0096b020897ac53cec460e244ef1382104c/LICENSE)）。

适配评价：适合作为“复杂任务的执行协议/模板”，不适合作为常驻本地管理器内核。其状态目录、Python orchestrator、阶段产物应被视为可选 workflow backend，不能成为 Workspace/Provider/Skill 身份真相。

### chapzin/codex-harness-mcp（控制面型 MCP）

这是本地 Node MCP 控制面，不执行 shell 或远程调用；提供 contract、持久知识/RAG、raw traces、verification records、治理 PASS/FLAG/BLOCK、observability、eval/profile/promotion 记录和多客户端配置生成。项目明确说它不替代 Codex/Claude/OpenCode，而是为 MCP 客户端提供可审计状态和完成门（[README.md](https://github.com/chapzin/codex-harness-mcp/blob/ba22003e330198aef3b7a5c3858d279a9664cf2d/README.md)）。许可证 MIT（[LICENSE](https://github.com/chapzin/codex-harness-mcp/blob/ba22003e330198aef3b7a5c3858d279a9664cf2d/LICENSE)），HEAD 为 `ba22003e330198aef3b7a5c3858d279a9664cf2d`，最新提交信息为 v0.3.0 eval framework（[commit](https://github.com/chapzin/codex-harness-mcp/commit/ba22003e330198aef3b7a5c3858d279a9664cf2d)）。

适配评价：如果目标是“管理器记录 Agent 工作证据”，它的 contract/trace/gate 语义很有价值；但它明确不负责执行任务，也不负责技能安装。因此应作为可选 MCP evidence adapter，不能取代本项目的安装与作用域服务。

## 面向本项目的决策

建议的边界：

```text
Skill Creator core
  Workspace / Provider / Skill identity
  discover -> validate -> edit -> install -> enable
  revisions, permissions, audit records
          |
          +-- HarnessAdapter (stable local interface)
                |-- CodexPluginAdapter (首选)
                |-- CodexHarnessWorkflowAdapter (可选)
                |-- DshProfileAdapter (可选、实验性)
                `-- EvidenceMcpAdapter (可选)
```

优先级判断：

1. 先完成 manager vertical slice：扫描本地 roots、Workspace/Provider 选择、技能详情和安全安装/启停；这些不依赖模型供应商。
2. 把 skill 投影定义成 adapter 能力，而不是复制文件：`resolve(skillId) -> immutable snapshot`、`prepareContext(snapshot[])`、`launch(request)`、事件流和取消。
3. 首个 Agent 集成选 `minhnguyen1108/codex-harness` 的 Codex plugin 边界，原因是它已有 plugin/agent/hook/MCP 形态且直接面向 Codex；把只读/唯一写者作为策略声明，不能当作文件系统安全边界。
4. DSH 仅在确认官方公开 SDK、session 生命周期和 plugin 版本策略后接入；当前证据只足以支持 profile/plugin 实验适配，不足以承诺稳定深度集成。
5. 将 `chapzin/codex-harness-mcp` 的 contract、trace、verification、gate 概念映射为本地事件模型；禁止 MCP 或任意 harness 直接拥有 Workspace 文件写入权。

## 资料与指令摩擦

本次按仓库要求先读取 `~/.agents/AGENTS.md`，再读取 research skill。调研期间 GitHub REST API 触发 rate limit，且 npm registry 出现 DNS 不可解析；因此改用 GitHub 官方仓库的浅克隆、固定 commit、README、源码和 LICENSE 作为证据。没有把搜索结果中的同名项目当作唯一 `codex-harness`，而是并列记录三个候选并明确不确定性。报告只新增本文件，未修改源码。
