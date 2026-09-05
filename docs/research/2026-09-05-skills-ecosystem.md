# Agent Skills 生态调研：从安装工具到本地技能管家

调研日期：2026-09-05。范围：skills.sh/Vercel Skills CLI、OpenClaw/ClawHub、Claude Code、OpenAI Codex、GitHub Skills 与 Agent Skills 开放规范。优先使用官方仓库、官方文档和官方站点；仓库链接固定到调研时的 commit，动态站点链接同时保留页面 URL。

## 结论先行

现有生态已经解决了“技能放在哪里、如何安装到多个 Agent、如何被模型发现”的一部分问题，却没有解决技能长期治理：用户不知道哪些技能真正生效、哪些过时或冲突、更新是否改变行为、如何验证质量，以及多 Agent 安装后谁是唯一真相。Skill Creator 的机会不是再做一个安装器，而是把技能当作可观测、可验证、可回滚的本地资产，并让 Agent 负责提出治理建议，人在高风险变更前批准。

建议产品分层：

```text
Manager truth: Workspace / Provider / Skill identity, revisions, enablement, audit
        |
        +-- Analyzer: metadata/schema, trigger reachability, overlap/conflict graph,
        |             stale/unused signals, quality/eval evidence
        |
        +-- Steward Agent: explain -> propose patch/split/merge/disable -> preview diff
        |                  -> human approval -> atomic apply -> verify -> rollback
        |
        `-- Adapters: Codex, Claude Code, OpenClaw, ZCode, DSH (optional)
```

## 一手资料与产品卖点

### Vercel Skills CLI 与 skills.sh

官方 CLI README（commit [`435076e`](https://github.com/vercel-labs/skills/tree/435076e78988e1e6ec40d00b0b1d76bdbbc5419/README.md)）把自己定位为“open agent skills ecosystem”的 CLI，支持 73+ Agent。核心卖点是一次命令跨 Agent 分发：GitHub/GitLab/SSH/本地路径来源；项目级或全局安装；按 agent/skill 选择；默认 symlink 维护单一副本，也可 copy；`list/find/use/init/remove/update` 覆盖发现到更新的完整命令面。来源：[README](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419/README.md)、[skills.sh](https://skills.sh/)。

它的发现约定会在多个 Agent 目录中向下遍历最多三层，并规定浅层 `SKILL.md` shadow 深层文件；安装前还支持列出技能。下载有大小、文件数和解压上限，说明供应链输入已被视为不可信。CLI 也把 Git 凭据、GitHub CLI、SSH 与 API fallback 分开处理，避免读取并打印凭据。

维护痛点仍然明显：

- symlink/copy 是部署方式选择，不是版本或行为治理；跨多个 Agent 的启用状态、来源 commit、回滚关系没有统一记录。
- 以名字选择 `update/remove`，同名技能、shadow 关系和多来源覆盖会让“我更新了哪个文件”变得不透明。
- description 是模型触发入口，但 CLI 只负责分发，不评估描述是否可触发、是否与其他技能冲突。

对 Skill Creator 的启发：保留 source、pinned commit、canonical path、投影目标和安装方法的显式记录；把发现树展示成“来源 -> 实际生效文件”的图；更新前生成行为/文本 diff 与影响面，而不是只执行复制或 symlink。

### OpenClaw 与 ClawHub

OpenClaw 官方 README（commit [`8797856`](https://github.com/openclaw/openclaw/tree/8797856260efeb94b71d88029850409416d7f74c/README.md)）的卖点是本地 Gateway：统一会话、工具、消息渠道和 companion apps；技能与插件是扩展能力，Control UI、CLI、TUI 连接同一个 Gateway。README 将 ClawHub 列为技能/插件入口，官方站点 [clawhub.ai](https://clawhub.ai/) 描述其为“skill registry for agents, with vector search”，并提供搜索、作者/来源和安全扫描结果等展示。

官方文档入口：[OpenClaw tools/skills](https://docs.openclaw.ai/tools/skills)、[security](https://docs.openclaw.ai/gateway/security)。README 明确要求把入站消息视为不可信输入，工具默认在宿主机执行，远程或多人场景需配置 sandbox 和安全策略。

卖点是“可运行的个人 Agent + 可发现扩展”，而非单纯文件管理。相应痛点是能力与权限耦合：安装一个技能可能增加宿主机工具权限；registry 的向量搜索提高发现效率，却不能替代内容审计、最小权限和行为验证。Skill Creator 应将每个技能的工具/文件副作用、信任来源、最近验证结果和启用范围列为一等字段；Agent 管家提出禁用建议时必须附证据与可回滚操作。

### Claude Code Skills

官方文档：[Extend Claude with skills](https://code.claude.com/docs/en/skills)。Claude Code 使用带 YAML frontmatter 的 `SKILL.md`，技能可放在项目、用户、插件等作用域；模型依据 `description` 自动触发，也可用 `/skill-name` 手动调用。文档给出 `disable-model-invocation: true` 作为只允许手动调用的控制，并支持 `user-invocable`、`allowed-tools`、`context: fork` 等元数据来约束入口和执行上下文。

文档还揭示一个很实际的治理问题：所有技能名称和描述会进入 skill listing；listing 有上下文预算，过多技能会截短低频技能描述，导致关键词被截掉、触发失败。`/doctor`、`/context` 和 `/skill-doctor` 用于诊断 listing 成本和未使用技能；每个描述还有长度上限。官方建议把关键用例放在描述前部，或把低优先级技能设为 name-only。

这直接验证了“技能越多，效率未必越高”：触发可达性、上下文成本和误触发需要持续监测。Skill Creator 应计算每个 Provider 的 listing token/字符预算，显示被截短的技能、触发关键词覆盖率、手动调用与自动调用比例，并支持基于证据的 disable/name-only 建议。

### OpenAI Codex Skills

官方文档：[Build skills](https://developers.openai.com/codex/skills/)，规范入口：[Agent Skills](https://agentskills.io/home)。Codex 遵循 `SKILL.md` 目录技能模型：frontmatter 提供 `name`、`description`，正文是按需加载的指令；技能既可放项目 `.agents/skills/`，也可放用户 `~/.codex/skills/`。Vercel CLI README 的 supported-agents 表也把 Codex 映射到这两个目录，说明跨工具共享的最低互操作面已经形成。

Codex 的卖点是把技能作为可组合、可按需加载的工作说明，减少每次会话重复提示；Agent Skills 规范则提供跨 Agent 的共同文件格式。代价是格式统一不等于行为统一：不同 Agent 对 frontmatter、触发、工具权限和目录优先级的解释可能不同。管理器必须保存“规范字段”和“adapter 投影字段”两层，不能假设一份 `SKILL.md` 在所有运行时拥有相同效果。

### GitHub Skills

GitHub 官方 Skills 组织页：[github.com/skills](https://github.com/skills)。官方 profile README（当前 `main`，页面列出的能力）把 Skills 定位为在真实 GitHub 项目中通过 Issues、Actions、Codespaces 完成的互动练习；目录提供 Skills catalog、Exercise Creator、Exercise Template、Exercise Toolkit、Changelog 和企业 EMU 指南。其卖点是“任务驱动的学习反馈”和真实工作流，而不是通用本地技能安装器。

对管理器有价值的启发是质量证据链：技能不应只有 Markdown 文本，还应有示例任务、自动检查、版本变更和运行结果。Skill Creator 的 eval/evidence 模型可借鉴 GitHub Skills 的“练习 -> Action 检查 -> 反馈”，但执行地点仍由本地 Manager 控制。

## 普通用户与开发者的真实痛点

普通用户面对的是“技能太多但不知道该留什么”：安装来源分散、同名覆盖、自动触发不透明、上下文变长、旧技能继续生效、禁用后不知道影响了哪个 Agent。开发者面对的是“技能像代码却缺少工程工具”：没有统一 manifest/version/dependency、没有静态 lint 和运行评估、没有变更审查和回滚、无法比较多个技能的职责重叠，也没有跨 Agent 适配测试。

可以把痛点压缩为四个管理器原语：

1. **生效性**：解析目录优先级、symlink/copy、Agent adapter 后，回答“当前请求会加载哪份技能”。
2. **质量**：schema、描述触发、工具声明、引用文件、示例 eval 和最近运行证据可查询。
3. **关系**：技能之间的重叠、矛盾、前置条件、工具权限和来源可视化。
4. **变更**：Agent 的优化必须先生成结构化建议、文本 diff、风险等级和验证计划，经批准后原子提交并可恢复。

## Agent 管家应优先做什么

第一阶段不是让 Agent 自由改文件，而是建立只读分析和建议闭环：扫描全部 Provider，解析 frontmatter，计算触发/上下文成本，检测重复职责、互斥指令和过时引用，生成“保留、禁用、拆分、合并、重写描述”的建议卡片。每条建议带证据（路径、行号、冲突片段、最近运行记录）和预计影响的 Agent/Workspace。

第二阶段才开放受控变更：选定技能快照 -> Agent 生成 patch -> Manager 展示 diff 与验证计划 -> 人批准 -> 临时分支/版本快照 -> 原子写入 -> 重新发现和运行 eval -> 记录结果。禁用优先采用 Manager 层的 enablement overlay，保留原文件并支持一键恢复；删除和跨 Provider 写入应视为高风险操作。

第三阶段再做分享：导出带来源 commit、许可证、依赖、测试证据和 adapter 兼容矩阵的包；导入先隔离扫描再进入 Workspace。社交排名不是早期核心，可信证据和可复现安装更重要。

## 对 harness 基座的判断

这些生态的共同点是 Manager 与执行 Agent 可以分离。Codex、Claude Code、OpenClaw 都有各自的目录/元数据/生命周期；因此 DeepSeek DSH 或 codex-harness 应作为 `HarnessAdapter`，只负责启动会话、注入已批准技能、流式事件和收集证据。Workspace、Provider、revision、enablement、审计和回滚必须留在 Skill Creator 核心。当前不应为了 harness 选择而改变技能真相模型。

## 调研摩擦与解决方式

GitHub REST/API 在本次调研中出现 rate limit，npm registry 也有 DNS 失败；动态站点 HTML 含大量脚本，难以直接提取稳定正文。解决方式是改用官方仓库的 `git ls-remote` 固定 HEAD、raw README/源码/许可证，并对站点只引用可复核的页面 URL；未能确认的 GitHub Skills 仓库 commit 没有伪造 hash，而引用其官方组织 profile 页面。以上限制意味着报告适合做产品方向和协议边界输入，不替代发布前对当前版本文档的再核验。
