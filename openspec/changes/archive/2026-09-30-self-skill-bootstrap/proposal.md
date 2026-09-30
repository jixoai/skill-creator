# Proposal: self-skill bootstrap — 启动时向全局技能根注入 `Skill Creator V2` 自描述技能

## Why

用户原始需求 [2026-09-30]：「在启动 skill creator 的时候会在 ~/.agents/skills/skill-creator-v2
这个目录提供一个 `Skill Creator V2` 的技能，目的是让其他的 Agent 也知道怎么通过
skill creator 去管理和搜索技能。这是一个闭环，因为我们 skill creator 本身也在使用
全局的 ~/.agents/skills 这个目录。也就是说，原本我们内置到内部提示词的东西，现在
直接和普通流程一样，也去读取全局的 Skill Creator V2 就行。」

产品已从「单纯管理器」演进为「技能管理 + 检索 + wiki 的能力入口」（search/wiki/MCP
面），但这些用法知识目前只存在于两处封闭管道里：

1. `product-prompt.ts` 的版本化 section——只服务产品内嵌 agent 会话；
2. README/docs——不进入任何 Agent 的技能发现流。

机器上的其他 Agent 无从得知可以用 `skill-creator search` / `skill-creator mcp`
来管理检索本机技能。`~/.agents/skills` 是社区标准全局根（provider catalog 中
cline/dexto/kimi-code-cli/loaf/warp/zed 等的 globalPath 即该目录；ZCode/Codex/
Claude Code 等在项目级 workspace 约定同样读取 `.agents/skills`）。把产品用法
沉淀为该根下的一份普通技能后：读该根的 Agent 经各自技能机制自然发现；产品内嵌
agent 与外部 Agent 消费同一份文档，消除双源。

## What Changes

- **新增产品自举（bootstrap）行为**：生产 daemon 入口（`src/daemon/main.ts`）启动时
  确保 `~/.agents/skills/skill-creator-v2/SKILL.md`（含 `references/tools.md`）存在。
  - 缺失 → 原子写入；
  - 存在且 frontmatter 标记 `x-managed-by: skill-creator`、`x-managed-version` 落后
    → 整组升级重写（SKILL.md + references）；
  - 存在但无产品标记 / 版本已是当前 / 用户改动（同版本）→ 不触碰；
  - IO 故障 → 记日志继续启动，绝不阻塞或击穿 daemon boot。
- **产品提示词 v2**：`product-prompt.ts` 内嵌的「能力面用法枚举」移除，改为指针——
  告知 agent 用 `skills_search` → `skills_info` 按普通流程读取全局技能
  `skill-creator-v2` 获取完整用法（检索/管理/更新/wiki）。会话特有的约定
  （无 shell/审批叙述/卡片最佳实践/ask_user_question）保留在 section 内。
- **技能内容**：SKILL.md 精炼（触发条件丰富的 description + 决策路径），完整
  MCP 工具目录与 CLI 参考放 `references/tools.md`（渐进披露，省 token）。

```text
daemon start (main.ts)
   |
   v
ensure self-skill at ~/.agents/skills/skill-creator-v2/ ----+--> 其他 Agent 技能机制自然发现
   |                                                        |
   +--> watcher/搜索索引照常收录（无特殊管道）                 +--> 产品内嵌 agent 经 MCP
                                                             skills_search/skills_info 读取
product-prompt v2: 指针而非内嵌（单一事实源）
```

## Impact

- **新增能力**：产品自描述技能的自举注入；不改任何既有 RPC/协议/持久态形状。
- **安全不变量**：本行为是产品对**用户全局技能根**的一次受控写例外（Workspace
  Registry 的「Global 不落写」约束针对 Creator/Repository 的用户 mutation 管道，
  本自举是 server-owned 启动行为，与 search-config.toml boot 模板同一授权类别），
  以 frontmatter 所有权标记区分产品内容与用户内容，永不覆盖无标记文件。
- **开发态隔离**：dev daemon（`src/daemon/dev.ts`）不执行自举（其意图 [1] 即
  「不读写正式用户状态」）；测试经 `SKILL_CREATOR_SELF_SKILL_ROOT` env 隔离。
- 受影响文件：`src/daemon/self-skill.ts`（新增）、`src/daemon/main.ts`、
  `src/daemon/kernel/product-prompt.ts`、`test/self-skill.test.ts`（新增）、
  `test/product-prompt.test.ts`、AGENTS.md、i18n.zh.md。
