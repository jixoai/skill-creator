# skill-wiki Specification

## Purpose

TBD - created by archiving change skill-wiki-incubation. Update Purpose after archive.

## Requirements

### Requirement: skill-wiki 库维护双级 wiki workspace 的目录契约

`skill-wiki` 包 MUST 以纯 TS 库形态提供 WikiWorkspace：`wiki/` 目录含
`index.md`（模式目录，每行一条）、`logs.md`（追加式演化日志）、
`skill-impact.md`（提案→结果记录，程序化追加）与 `patterns/<name>.md`
（单模式页：现象/根因/workaround）。存储 root SHALL 统一为
`~/.skill-wiki/`（`SKILL_WIKI_HOME` env 可覆盖，测试隔离用），scope =
global `~` 或 npm-scope 式 slug `^[a-z0-9](-?[a-z0-9])*$`（1-3+ 个以
连字符串联的单词，例：`skill-creator`、`my-app`）；`ws_<24hex>` digest
形状 MUST NOT 再被接受（破坏性变更，private 窗口期执行）。skill-creator
宿主 MUST 以 symlink `~/.skill-creator/wiki → ~/.skill-wiki/` 衔接
（存量实体目录一次性迁移：mv 后建链），MUST NOT 写入用户 workspace 的
技能资产目录。全部从磁盘读入的结构 MUST 经 Zod safeParse 收窄；不兼容
投影为该领域空值并 typed 失败于 mutation。pattern 元数据 MUST 预留
`origin`/`promotedFrom`（泛化溯源：由切片③的 LLM Maintainer 蒸馏写入，
非机械升格搬运）。宿主 MUST 维护 workspaceId → slug 映射层：digest 仍是
registry 内部 id，wiki scope 使用人类可读名。

#### Scenario: 双级作用域解析

- **WHEN** 分别以 `~` 与某单词串 slug（如 `skill-creator`）解析 wiki
- **THEN** 得到统一 root 下两个独立 scope 目录，互不重叠

#### Scenario: digest 形状被拒绝

- **WHEN** 以 `ws_0123456789abcdef01234567` 作为 scope
- **THEN** 收到 `WIKI_INVALID_SCOPE` typed 失败

#### Scenario: 畸形 wiki 投影为空

- **WHEN** patterns 目录中存在非法 frontmatter 的 md
- **THEN** 列表读取丢弃该条（不抛错）；对该条的 mutation typed 拒绝

#### Scenario: 宿主与 CLI 同根

- **WHEN** skill-creator daemon 写入 global wiki 后，CLI 以默认 root 读取
- **THEN** 两者看到同一份 patterns（经 symlink）

### Requirement: patch 引擎以精确锚定应用结构化编辑

skill-wiki MUST 提供 append / replace / insert_after 三种编辑原语；
replace 与 insert_after 的 target MUST 是文件中的精确子串，未命中
MUST 产生 typed PatchError（不静默、不模糊匹配）。patch 应用 MUST
原子（失败不落部分编辑）。

#### Scenario: 锚点未命中

- **WHEN** replace 的 target 不在目标文件中
- **THEN** 该编辑 typed 失败，文件内容不变

### Requirement: 碎片认知追加带内容级去重

`wiki.append` 输入通道（P1 升格）MUST 以 pattern 内容的 contentHash
对同 scope 已有条目去重：完全相同的内容 MUST 幂等返回既有条目；
不同内容 MUST 新建 pattern 页并同步更新 index.md。

#### Scenario: 幂等追加

- **WHEN** 连续两次 append 相同内容
- **THEN** 第二次返回第一次的条目，patterns 目录仍只有一个该内容文件

### Requirement: wiki 经 RPC 面可查可写

daemon MUST 暴露 `wiki.list`（scope → patterns 投影）、`wiki.read`
（单 pattern 全文）、`wiki.append`（碎片认知 + 去重）；wiki 为
skill-creator 自有数据，append 为 direct mutation（不走 steward
proposal 审批链）。未知 scope MUST typed NOT_FOUND。

#### Scenario: 面板读写同源

- **WHEN** WebUI 经 RPC 追加后立刻 list
- **THEN** 新 pattern 出现在同 scope 列表中（同一 service 实例投影）

### Requirement: WebUI 提供 workspace 级 wiki 通道

Workspaces 的每个 workspace（global 与 imported）MUST 提供 Wiki 入口，
视图呈现该 scope 的 patterns 列表（前端过滤）与追加表单；追加成功
MUST 即时入列；scope 无 wiki 数据时呈现空态引导。

#### Scenario: 追加闭环

- **WHEN** 用户在 wiki 视图提交一段碎片认知
- **THEN** 去重通过后列表出现新条目，重复提交同一内容不产生第二条

### Requirement: 轨迹采样与 gate 决策为库接口（无 LLM 依赖）

skill-wiki MUST 提供分层轨迹采样（≤5 失败 + ≤3 通过、单样本 15k
字符 cap）与 gate 决策记录（accept/reject + 理由 → skill-impact.md
条目）作为纯函数接口；本轮不含任何 LLM 调用（编排属切片③）。

#### Scenario: 采样上限

- **WHEN** 20 条失败轨迹进入采样
- **THEN** 输出至多 5 条失败 + 3 条通过，且单条不超字符 cap

### Requirement: CLI 命令面（skill-wiki bin，随包私有）

`skill-wiki` CLI SHALL 提供：`list`（offset=0/limit=100 分页，`--sort
name|updated`，`--json` 带 total/nextOffset）、`show <name>`、`add --title
[--scope]`（stdin 正文；hash 幂等，`deduplicated` 为成功语义 exit 0）、
`edit <name> -f <edits.json>`（patch 批量，原子失败）、`remove <name>`
（删页 + logs.md 足迹）、`find <query>`（相似检索）、`log`、`impact`。
全部命令 SHALL 支持 `--json`；exit code SHALL 映射：2 用法错误、3
WIKI_INVALID_SCOPE、4 WIKI_INVALID_PATTERN、5 WIKI_PATCH_FAILED。

#### Scenario: add 的幂等与退出码

- **WHEN** 同正文重复 add
- **THEN** 输出 `Already captured`，exit 0，`--json` 携带
  `deduplicated: true`

#### Scenario: patch 原子失败的退出码

- **WHEN** edits.json 中任一锚点未命中
- **THEN** exit 5，页面零改动，stderr 含 WIKI_PATCH_FAILED

### Requirement: 写入相似警告（查重闭环）

`add` SHALL 默认在写入（或 hash 幂等返回）后对同 scope 执行相似检索，
近亲条目以 warning 附带输出（人读：名称+分数列表；`--json`：
`similar: [{ name, score }]`）；exit code SHALL 仍为 0（警告不是错误）。
`--no-similarity` SHALL 跳过。相似度 SHALL 由 @jixoai/search 提供，
阈值冻结为版本化常量。

#### Scenario: 语义近亲触发警告

- **WHEN** add 一条与既有 pattern 措辞不同但语义相近的正文
- **THEN** 命令成功（exit 0）且输出附 `similar:` 近亲清单，
  AI 可据警告走 `edit`（吸收）+ `remove`（删重复页）纠偏

### Requirement: 派生物归属 search

`patterns/` SHALL 保持唯一真相；`index.md` 与查重索引等一切派生物 SHALL
由 @jixoai/search / 宿主编排维护（读命令结束后自动刷新 index.md）。
skill-wiki CLI 命令面 MUST NOT 包含 `reindex`。

#### Scenario: 人改 patterns 后目录页自愈

- **WHEN** 外部编辑器直接修改 patterns/ 下的页面后运行任一读命令
- **THEN** 命令输出反映 patterns 真相，index.md 被自动刷新，
  无需人工调用任何维护命令
