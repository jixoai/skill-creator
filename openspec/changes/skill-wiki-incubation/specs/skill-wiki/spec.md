# skill-wiki 变更（新增 capability 域）

## ADDED Requirements

### Requirement: skill-wiki 库维护双级 wiki workspace 的目录契约

`skill-wiki` 包 MUST 以纯 TS 库形态提供 WikiWorkspace：`wiki/` 目录含
`index.md`（模式目录，每行一条）、`logs.md`（追加式演化日志）、
`skill-impact.md`（提案→结果记录，程序化追加）与 `patterns/<name>.md`
（单模式页：现象/根因/workaround）。存储 MUST 位于 daemon appDir 侧车
`wiki/<scope>/`（scope = global `~` 或 `ws_<id>`），MUST NOT 写入用户
workspace 的技能资产目录。全部从磁盘读入的结构 MUST 经 Zod safeParse
收窄；不兼容投影为该领域空值并 typed 失败于 mutation。pattern 元数据
MUST 预留 `origin`/`promotedFrom`（global 升格语义，本轮只落 schema）。

#### Scenario: 双级作用域解析

- **WHEN** 分别以 `~` 与某 Imported WorkspaceId 解析 wiki
- **THEN** 得到 appDir 下两个独立侧车目录，互不重叠

#### Scenario: 畸形 wiki 投影为空

- **WHEN** patterns 目录中存在非法 frontmatter 的 md
- **THEN** 列表读取丢弃该条（不抛错）；对该条的 mutation typed 拒绝

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
