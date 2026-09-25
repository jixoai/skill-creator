# skill-wiki Specification

## Purpose

TBD - created by archiving change skill-wiki-incubation. Update Purpose after archive.

## Requirements

### Requirement: skill-wiki 库维护双级 wiki workspace 的目录契约

`skill-wiki` 包 MUST 以纯 TS 库形态提供 WikiWorkspace：wiki 目录含
`index.md`（模式目录，每行一条）、`logs.md`（追加式演化日志）、
`skill-impact.md`（提案→结果记录，程序化追加）与 `patterns/<name>.md`
（单模式页）。**目录映射标准（2026-09-22 Owner 裁决）**：wiki 目录 =
`workspaceWikiDirectory(dir) = <dir>/.agents/skill-wiki/`——workspace 是
目录路径，wiki 是目录自身的属性（`.git/` 式约定）；global 为 `~` 特例
（`SKILL_WIKI_HOME` 覆盖，默认 `~/.agents/skill-wiki`）。registry
workspace 的 wiki 与 workspace 目录同居。scope 形状的 slug 校验与
`scopes.json` 中央登记表 MUST 退役（scope 由路径客观决定，名字空间分配
不存在）。`origin` 足迹 MUST 记 `"~"` 或 workspace 目录绝对路径。全部
从磁盘读入的结构 MUST 经 Zod safeParse 收窄；不兼容投影为该领域空值并
typed 失败于 mutation。pattern 元数据 MUST 预留 `origin`/`promotedFrom`
（泛化溯源：由切片③的 LLM Maintainer 蒸馏写入，非机械升格搬运）。

#### Scenario: 双级作用域解析

- **WHEN** 分别以 `~`（global）与某 workspace 目录解析 wiki
- **THEN** 得到 `~/.agents/skill-wiki/`（或 SKILL_WIKI_HOME 覆盖值）与
  `<dir>/.agents/skill-wiki/`，互不重叠

#### Scenario: digest 形状被拒绝

- **WHEN** workspace 参数为空串、或解析失败的非路径形状
- **THEN** 收到 typed `WIKI_INVALID_SCOPE` 失败（形状校验退役 slug 规则
  后仍拒绝非法 workspace 输入）

#### Scenario: 宿主与 CLI 同根

- **WHEN** skill-creator daemon 写入某 workspace wiki 后，CLI 在同一
  workspace 目录读取
- **THEN** 两者看到同一份 patterns（同一物理目录 `<dir>/.agents/skill-wiki`）

#### Scenario: 项目级使用无需 registry

- **WHEN** 在任意目录以 `--workspace ./`（缺省）执行 CLI
- **THEN** 该目录的 `.agents/skill-wiki/` 被创建/使用，不依赖任何中央
  注册状态

#### Scenario: 畸形 wiki 投影为空

- **WHEN** patterns 目录中存在非法 frontmatter 的 md
- **THEN** 列表读取丢弃该条（不抛错）；对该条的 mutation typed 拒绝

#### Scenario: 存量一次性迁移

- **WHEN** 存在旧布局（`~/.skill-wiki/` 中央根或 `~/.skill-creator/wiki`
  侧车）且新址无数据
- **THEN** 迁移工具把 global 存量搬至新 global 址、slug 存量经 registry
  映射搬入对应 workspace 目录；目标冲突时保守拒绝并列出冲突项

### Requirement: cli-kit 原子命令单元与宿主组装器

skill-wiki MUST 提供 cli-kit：命令单元（语义参数 → 结构化结果 + exit
语义，IO 全注入的纯函数）与 `createWikiCli(host)` 组装器。host 插槽
MUST 限于 `resolveScope`（宿主上下文 → workspace 目录）、`commandPrefix`、
`extraCommands`。默认实例 MUST 与既有 bin 行为逐位一致（现有测试守护）。
kit MUST 保证口径原子（exit code 2/3/4/5、`--json` 形状、相似警告管线
单源）与单命令操作原子；MUST NOT 提供跨命令事务。`--workspace <path|~|./>`
MUST 由 kit 默认实现解析，缺省 `./`。

#### Scenario: 默认实例行为不变

- **WHEN** 以空 host 调 createWikiCli 并喂既有 CLI 测试的全部 argv
- **THEN** 输出与 exit code 与重构前逐位一致

#### Scenario: 宿主插槽生效

- **WHEN** 宿主注入 resolveScope（如 skill-creator 的 registry 只读解析）
  与 extraCommands（如 scopes）
- **THEN** scope 解析走宿主实现，扩展命令出现在 usage，通用命令面零新增

### Requirement: skill-creator CLI 提供 wiki 子命令

skill-creator CLI MUST 提供 `wiki` 子命令：经 createWikiCli 组装，
`--workspace` 支持 registry label/ws_id 解析（进程内只读 registry）与
路径直传；MUST 含 `scopes` 扩展命令（scope 清单 × pattern 计数 ×
workspace label 的全局视角）。子命令 MUST 进程内执行（无 daemon 依赖，
与 search 子命令同模式）。

#### Scenario: workspace 感知解析

- **WHEN** `skill-creator wiki list --workspace <label前缀|ws_id|路径>`
- **THEN** 解析为对应 workspace 目录的 wiki；解析失败为用法错误 exit 2

#### Scenario: scopes 全局视角

- **WHEN** `skill-creator wiki scopes`
- **THEN** 输出 global 与各 registry workspace 的 pattern 计数与 label
  （`--json` 结构化）

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

### Requirement: wiki 经 capability/MCP 面可用

wiki 四能力 MUST 进 capability 登记并投影到 MCP 两形态：`wiki.scopes`/
`wiki.list`/`wiki.read`（readonly）与 `wiki.append`（approved-mutation）。
输入 schema MUST 与 rpc-contract 同源（无第二份手写镜像）。MCP 面上
`wiki.append` MUST 仅以 `wiki_append_propose` 出现（产 proposal 待人工审批，
stdio 形态不注册任何 mutation）；readonly 三面两形态都可用。

#### Scenario: agent 只读浏览

- **WHEN** agent 经 MCP 调 `wiki_scopes` → `wiki_list` → `wiki_read`
- **THEN** 依次获得 scope 索引、patterns 投影与单页全文（与 GUI/CLI 同一
  daemon 数据面）

#### Scenario: agent 写入走审批

- **WHEN** agent 经 MCP 调 `wiki_append_propose`（scope/title/body）
- **THEN** 产生 pending proposal（不写盘）；人审批后以 human-ui 主体执行，
  hash 幂等语义与 GUI append 一致

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
[--workspace <path|~|./>]`（stdin 正文；hash 幂等，`deduplicated` 为成功
语义 exit 0）、`edit <name> -f <edits.json>`（patch 批量，原子失败）、
`remove <name>`（删页 + logs.md 足迹）、`find <query>`（相似检索）、
`log`、`impact`。全部命令 SHALL 支持 `--json` 与 `--workspace`（缺省
`./`）；exit code SHALL 映射：2 用法错误、3 WIKI_INVALID_SCOPE、4
WIKI_INVALID_PATTERN、5 WIKI_PATCH_FAILED。

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

### Requirement: 蒸馏提案契约（SDK 冻结面）

skill-wiki MUST 冻结蒸馏契约（Zod，unknown 键拒绝，预算常量版本化导出）：
`DistillProposal`（create/absorb 判别联合——absorb 钉死
`expectedBeforeBodyHash` 与 edits 复用 WikiEdit 原语）、`PromotedFromEntry`
（canonical JSON 单行序列化，多次泛化追加合并不覆盖）、`ItemResult`
（applied/idempotent/stale/patch-failed/model-invalid/rejected/expired/
not-proposed/io-failed——以 E 的 DistillItemStatus 为唯一枚举源）。
`DistillCorpusSchema` / `DistillLedgerRecordSchema`（含 attempts）/
`CapabilityFailureDetailSchema` 为宿主与 SDK 的外部契约（closed-field
strict parsing；设计文档 U/W 块为唯一形状源）。SDK MUST NOT 引入
LLM/网络依赖；SDK MUST 导出版本化 slugifyPatternTitle（v1 = 现实现
行为快照；plan/apply 同源；空 slug → model-invalid(empty-slug)）。

#### Scenario: promotedFrom 追加合并

- **WHEN** 同一 global pattern 经两次不同 run 泛化
- **THEN** promotedFrom 含两条足迹（按 runId 去重），既有足迹不被覆盖，
  frontmatter 单行标量约束保持

### Requirement: promotedFrom 信封 round-trip

frontmatter `promotedFrom` 的存储值 MUST 恒为 canonical JSON 数组（单条
也是 `[{...}]`；键排序、无空白）；entry strictObject（unknown 键拒绝）。
历史/手改坏值 MUST 读投影 null（不伪装空足迹、不覆盖原文），merge 时
typed WIKI_INVALID_PATTERN（提示人工修复）。四个场景为外部契约
（tasks 1.1 必过 fixture）：

#### Scenario: null round-trip

- **WHEN** pattern 无足迹（新页）
- **THEN** frontmatter 值为 null；经泛化合并后变为单条数组信封

#### Scenario: 单条 round-trip

- **WHEN** 已有单条足迹的 pattern 再次解析
- **THEN** 解析得单元素数组；追加不同 run 足迹后按 runId 升序重排落盘

#### Scenario: 双条 round-trip

- **WHEN** 数组含两条不同 runId 足迹
- **THEN** 解析保序不丢字段；同 run 重放 union sourcePatternIds 不产生
  第三条

#### Scenario: 坏值 round-trip

- **WHEN** 手改为非法 JSON 或缺必需键的对象
- **THEN** 读投影 null；merge 拒绝并 typed WIKI_INVALID_PATTERN，
  原值逐字节保留（等待人工修复）

### Requirement: 两段式蒸馏执行（纯计划 + 单项事务）

skill-wiki MUST 提供 `planDistillation`（纯函数：Zod 收窄/锚点预算校验/
before-after hash/相似预警附注；model-invalid 项产出诊断）与
`applyDistillation`（单项原子落盘；宿主以 typed `ledgerRecord` 输入传入
既有判定状态）。absorb 判定 MUST 按 ledger 状态区分：当前 == afterHash
且 ledger ∈ {applying, applied} → idempotent（applying 补 index rebuild +
commit）；当前 == beforeHash 且 ledger ∈ {无, applying} → 执行（锚点
未中 → patch-failed 零写）；当前 == beforeHash 且 ledger == applied →
人工回退：stale 零写，绝不重放；其余 → stale 零写。create 幂等 =
contentHash 去重 + 命中回填足迹。IO 失败 typed 上抛。

#### Scenario: 人工回退后重放

- **WHEN** 提案已 applied，人工把目标页正文恢复为 before 内容后重放
- **THEN** 该项 stale（manual-rollback）零写，页面保持人工回退态，
  ledger 保持 applied；重新泛化必须走新提案

#### Scenario: 人工编辑后重放

- **WHEN** 提案审批前目标页被人工编辑（body hash 不再等于 before/after）
- **THEN** 该项 stale 零写，其余项不受影响，ledger 记录 stale

#### Scenario: 崩溃后重放

- **WHEN** 页写入后进程崩溃，重启后重放同一提案（absorb 或 create）
- **THEN** 结果 idempotent（absorb 走 ledger/afterHash 判定；create 走
  contentHash 去重），不产生重复页

#### Scenario: create 同名人工页零覆盖

- **WHEN** create 项的目标 name 已存在且 contentHash 不等于 afterHash
- **THEN** 该项 stale 零写，既有同名页逐字节不变

### Requirement: 宿主蒸馏编排（run registry + 审批红线）

daemon MUST 提供 DistillJobService（独立于 agentSessions；kernel 一次性
job 只读工具面、120s 有界、stop/cancel/timeout 全路径 dispose；不进面板
列表与持久转录）：run 目录 `<appDir>/wiki-distill/<runId>/`（0700/0600、
原子写、corpus/model-output/proposals.jsonl ledger——机器真相；
≤32 提案、≤20 run LRU + 显式 purge；LRU 引用真相 = 持久 ledger，不信
store 内存态；IO typed DISTILL_IO）。提案创建 MUST 走 McpProposalStore
原子 admission 事务（admitBatch 单一临界区：terminal 回收与全批创建
同事务；回收后仍不足 → 整批拒绝 typed，store 逐字节不变；pending 永不
淘汰）。`wiki.distill_apply` capability 输入 = {runId, ordinal}，
handler 从 registry 反查 digest 校验（伪造 → DISTILL_RUN_NOT_FOUND）；
approved 执行入口 = per-run 串行队列投递（与 cancel/重启扫描同队列，
可串行化）；执行经 proposal 审批（human-ui）。`wiki.distill.start/
status/cancel` RPC/CLI 同一 schema（src/shared/contracts/wiki-distill.ts
冻结；无 phase 字段，RunState 即阶段真相；--limit 默认 20 ≤ 100）。
workspace 原文 MUST 零改动。决定竞争 MUST 按决定点胜者表唯一收敛：
pending 上 human reject → proposal rejected(cause=human) + ledger
rejected；pending 上 cancel → proposal rejected(cause=cancelled) +
ledger expired + run cancelled；approved（token 已发）后 cancel → run
cancelled + apply 二次校验失败 → proposal failed + ledger expired，
迟到 reject 不可覆盖 token。run 终态 MUST 按优先级判定：零合法提案 →
failed(no-valid-proposals)；全部 not-proposed → failed(capacity)；
全部 io-failed → failed(io)；ledger 非空全终态 → completed（末项终态
任务迁移；mixed 含 io-failed 亦 completed，计数在 counters）。
create 项的目标 name（targetPatternName）MUST 持久化于 ledger record
（重放写确切 name，禁止 -N 自动改名；同 run slug 冲突在 plan 期以
model-invalid(target-collision) 拒绝，ordinal 先到先得）。
DISTILL_IO / DISTILL_LIMIT / DISTILL_RUN_NOT_FOUND / DISTILL_STALE /
DISTILL_ACTIVE_RUN / PROPOSAL_STALE MUST 进 RPC 错误闭合集合
（404/409/409/422/503 家族；PROPOSAL_STALE = 迟到 reject，detail 携带
current view），capability 与 MCP 面以 CapabilityFailureDetail（闭合
enum）同码投影；DISTILL_TIMEOUT / DISTILL_CANCELLED /
WIKI_INVALID_PATTERN 为 kernel/daemon-local，不进跨面闭集。

#### Scenario: 手动蒸馏闭环

- **WHEN** 对某 workspace distill 并审批全部提案
- **THEN** global 出现泛化页（足迹引用来源 pattern），workspace patterns
  逐字节不变，ledger 逐项可审计，run 收敛 completed

#### Scenario: 伪造提案引用

- **WHEN** agent 提交 wiki_distill_apply_propose {runId: 伪造, ordinal}
- **THEN** typed DISTILL_RUN_NOT_FOUND，零写

#### Scenario: 容量 admission 事务

- **WHEN** 有效提案数超过「剩余容量 + 可回收 terminal 总量」
- **THEN** typed DISTILL_LIMIT（含 --limit 提示），store 逐字节不变
  （terminal 一个不删、pending 零淘汰）；部分可容纳时也不产生半批；
  run failed(reason=capacity)

#### Scenario: 审批与取消并发

- **WHEN** approve 与 cancel 对同一 run 并发提交
- **THEN** 两操作经 per-run 串行队列化，终态唯一可串行化；pending 上
  取消胜出 → rejected(cause=cancelled) + ledger expired；approve 已胜
  （token 已发）后取消 → run cancelled + 该项 proposal failed + ledger
  expired，迟到决定不覆盖 token

#### Scenario: 用户取消与人工拒绝二分

- **WHEN** 同一 awaiting-approval run 中一项被人在 proposal 面拒绝、
  其余项随后被用户取消 run
- **THEN** 前者 proposal rejected(cause=human) + ledger rejected；后者
  proposal rejected(cause=cancelled) + ledger expired；已执行项保留

#### Scenario: 零合法提案与容量失败的终态优先级

- **WHEN** kernel 输出全部非法（无合法提案），或全部合法项因容量整批
  拒绝（全部 not-proposed）
- **THEN** 前者 run failed(no-valid-proposals)、后者 run
  failed(reason=capacity)；两者都不是 completed；终态后同 source 可
  重新 start

#### Scenario: IO 重试耗尽的三面终态

- **WHEN** 某项 apply 的页写/rebuild IO 失败且有界重试耗尽（双预算：
  页写按 attempts 预留表最多 3 次写页尝试；rebuild-only 队列内 ≤2 次
  重试且不占 attempts——H 唯一口径；io-failed 为永久终态，重启恢复
  仅限仍为 applying 的行）
- **THEN** proposal failed（detail.code=DISTILL_IO）、ledger 行终态
  io-failed、counters["io-failed"] 计入；全部项皆 io-failed → run
  failed(reason=io)；部分成功 → run completed 且失败计数可见

#### Scenario: pending 项绝不被执行路径迁移

- **WHEN** absorb 目标页在审批前被删除/损坏，随后任何 status 轮询或
  重放路径经过该项
- **THEN** pending 项零写、ledger 不动（缺页 preflight 只作用于已批准/
  applying/applied 路径）；只有 approve 才驱动 apply，apply 时才判
  missing-target → stale

#### Scenario: 同 run 目标名冲突 plan 期拒绝

- **WHEN** 模型输出两个 create 的 title 经 slugify 得同名（或与某
  absorb target 相同）
- **THEN** 后 ordinal 项 model-invalid(target-collision)（确定性
  先到先得），不产 plan item 不进 proposal；先项不受影响

#### Scenario: 迟到拒绝

- **WHEN** proposal 已 approved（token 已发）后人工点 Reject
- **THEN** typed PROPOSAL_STALE（detail 携带当前 view），不覆盖
  token、不改 ledger；重复同 cause 的终态 reject 幂等返回 view

#### Scenario: 模型输出混合有效性

- **WHEN** kernel 输出含部分非法提案
- **THEN** 非法项记 model-invalid 诊断，合法项照常生成 proposal；全部
  非法 → run failed(no-valid-proposals)，无半态
