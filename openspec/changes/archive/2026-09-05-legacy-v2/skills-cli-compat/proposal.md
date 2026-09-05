## Why

Skill Creator 目前通过 ccski 发现技能，但只回答「这里有哪些技能」，从不回答「这技能从哪来、是不是最新」。生态里事实标准是 `vercel-labs/skills` CLI——用户用 `npx skills add` 安装技能，技能来源被写进 lock 文件（全局 `.skill-lock.json` schema v3、项目 `skills-lock.json` schema v1）。如果 Skill Creator 不读这些 lock、不感知 skills-CLI 的存在，就永远只能当查看器，无法做真正的技能管理：用户升级时还得切回 CLI，两条工具链各跑各的。本变更让 Skill Creator 主动对齐 skills-CLI：识别哪些技能是经它装的、标记可升级、并直接在 Skill Creator 里一键升级——而不是逼用户抛弃既有的 skills CLI 工作流。

## What Changes

- 新增 `skills-cli-probe` daemon 能力：通过 `npx skills list --json` shell-out 探测「经 skills-CLI 安装的技能」，读取其 provenance（source、folder hash、installedAt）。
- 将探测到的技能在 Workspace 技能列表里标记为「可升级」（badge / icon）。
- 新增 `update-check` RPC：读取 `.skill-lock.json`（v3）+ `skills-lock.json`（v1），将存储 hash 与上游 hash 对比（GitHub 源走 Trees API；其余源浅克隆后算 on-disk hash），返回有待更新的技能列表。
- 新增 `apply-update` RPC：复用现有 `repository-service.ts` 安装流水线，对过时技能重装（pinned source 重克隆 → 装到原 target），完成后刷新对应 lock 文件条目。
- **BREAKING**：`SkillMetadataSchema` 增加可选 provenance 字段 `updatable`（boolean）与 `installedVia`（判别联合：`"skills-cli" | "manual" | "unknown"`）。破坏性更新策略不变——老 daemon/WebUI 收到新字段无法识别即按默认值加载，不做向下兼容。

## Capabilities

### New Capabilities

- `skills-update`: 检测、检查并应用技能更新——读取 skills-CLI 的 lock 文件、对比上游 hash、按需重装并刷新 lock 条目；同时把「经 skills-CLI 安装」这一 provenance 投影到技能列表。

### Modified Capabilities

<!-- 本变更不修改既有 capability 的 requirements，仅向 SkillMetadataSchema 投影新字段；provenance 字段为新增可选字段，行为增量属于新 capability。 -->

## Impact

- 新增 daemon 模块：`src/daemon/skills-cli-compat.ts`（probe + lock 读取 + update checker 三个正交意图）。
- 新增 vendored lock 文件契约：`src/shared/contracts/skills-lock.ts`（v3 全局锁 + v1 项目锁的 Zod schema，供 daemon 与单测复用；WebUI 不直接消费）。
- 契约变更：`src/shared/contracts/skills.ts` 的 `SkillMetadataSchema` 增 provenance 字段；`src/shared/rpc-contract.ts` 新增 `skills.update.check` / `skills.update.apply` 两个 RPC。
- 安全不变量影响：所有外部输入（`npx skills list --json` 输出、lock 文件 JSON）一律走 `unknown → Zod safeParse`；解析失败的条目降级为「无 provenance」，不抛错、不崩溃。lock 读取仅在 server-owned 路径（`$XDG_STATE_HOME/skills/`、`~/.agents/`、cwd 根）下进行，沿用 containment check，WebUI 永远不直接读盘。
- 运行依赖：检查更新需要 `npx` 与网络（GitHub API）。无 npx / 无网络 / 无 token 时静默降级——`updatable` 保持 false，技能列表照常返回。
- 既有流水线复用：`apply-update` 复用 `repository-service.ts` 的 pinned clone + ccski install 路径，不另起安装实现。
