# skill-search Specification

## Purpose

skill-search 是 Skill Creator 的本地技能检索域：以 Canonical Skill（realpath
去重）+ 冻结规则分词器 + 字段加权 BM25 + 冻结 rerank 构建第一代本地索引，
经 CLI、daemon RPC、MCP 双面与 agent 工具面供给全部消费方——含 GUI 三链路
（ProviderView 过滤 / ⌘K 命令面板 / composer `$` 菜单）。索引 server-owned
持久化（五版本信封 + payloadDigest），为未来的重复检测、合并、升级与同步
提供数据基座。

## Requirements

### Requirement: Skill tokenizer 是确定、版本化且以冻结期望表为契约的检索分词器

SkillTokenizer MUST 以同一条管线处理 query 与 document 文本：NFKC 归一 →
script-run 切分（Han/Hiragana/Katakana/Hangul 连续段 | Latin 标识符段 |
分隔符）→ CJK 段 Intl.Segmenter(zh, word) 分词 + **连续单字段滑窗 bigram**
（≥2 个相邻单字成对滑窗发射、单字本身不发射、孤立单字作 unigram；多字词
原样发射）→ Latin 段保持原大小写做 camel/Pascal/snake/kebab 切分（正则
分支序：连续大写+lookahead 在前）并保留 joined/@scope/owner-repo 形态 →
长度过滤（Latin ≥2 或含数字；CJK 豁免）。行为 MUST 由 TOKENIZER_VERSION
版本化，且 MUST 以 docs/search-design.md §6 的冻结期望表为逐字契约（改动
先改表、再改实现、再跑基准）。构造时 MUST 以中文探针自检 Intl.Segmenter；
不可用时逐字退化 + 滑窗 = pure-bigram，不得抛错。

#### Scenario: 冻结期望表逐条钉死

- **WHEN** 对冻结期望表的全部 20 条输入逐一 tokenize
- **THEN** 输出与表内 JSON 数组逐字相等（含 `React组件设计 →
["react","组件","设计"]`、`ParseHTTPResponse → […"http"…]`、
  `https://github.com/lightonai/bm25x → […"lightonai/bm25x"…]`、
  `タスク管理とスプリント`、`한국어 검색` 条目）

#### Scenario: 探针降级

- **WHEN** 运行环境的 Intl.Segmenter 不可用或词典探针失败
- **THEN** CJK 段退化为逐字 + 滑窗 bigram，tokenizer 正常返回不抛异常，
  query/doc 管线一致

### Requirement: 索引身份以 canonical skill 为真相，installations 绑定 workspace/provider 作用域

扫描器 MUST 枚举 Global Workspace 的全部 catalog provider roots 与每个
Imported Workspace 的 provider roots（只读持久态投影，不触发 ccski 动态
计数）；每个入口（目录或 symlink）经 statSync 跟进后含 SKILL.md 或
.SKILL.md 才是候选；broken symlink MUST 静默跳过；真实子目录递归深度
≤2 且递归不跟进 symlink；`.` 开头目录与 node_modules MUST 跳过。候选
MUST 经 realpathSync 归并为 canonicalPath；同一 canonicalPath 的多个入口
MUST 合并为一个索引文档，installations MUST 为结构化
`{path, workspaceId: "~" | ws_*, providerId}[]`（未来 RPC/GUI 可直接组装
WorkspaceProviderTarget）。文档 id MUST 等于 `opaquePathId("sk",
canonicalDirectory)`（与 skills.list 的 SkillId 一致）。

#### Scenario: symlink 多安装合并

- **WHEN** ~/.claude/skills/foo 与 ~/.codex/skills/foo 都是指向 ~/repo/foo 的
  symlink，且 ~/.agents/skills/foo 是同一物理目录的第三入口
- **THEN** 索引只含一个 canonical 文档，installations 含三个入口（各自带
  正确的 workspaceId/providerId），id 等于按 ~/repo/foo 计算的 sk_ id

#### Scenario: broken symlink 与递归边界

- **WHEN** provider root 内存在指向已删除目标的 symlink，或嵌套 symlink 目录
- **THEN** broken 入口被跳过；目录 symlink 只在入口层解析、递归不跟进；
  其余入口扫描正常完成

#### Scenario: 双文件冲突

- **WHEN** 一个 canonical 目录同时存在 SKILL.md 与 .SKILL.md
- **THEN** 内容源取 SKILL.md，文档标记 conflict=true；仅 .SKILL.md 在场时
  disabled=true 且内容源取 .SKILL.md；contentHash 恒为实际被索引文件字节

#### Scenario: 无效 frontmatter 不弃文档

- **WHEN** SKILL.md 缺 frontmatter 或 name/description 未过 schema
- **THEN** 文档仍入索引：name 回退目录名、description 置空、标记
  invalidFrontmatter=true；keywords/triggers 只接受 string|string[]，
  其它类型条目丢弃

### Requirement: content hash 识别内容级重复并在候选池前折叠

每个索引文档 MUST 携带实际被索引 SKILL.md 原始字节的 SHA-256 contentHash。
搜索 MUST 按 contentHash 在 top-40 竞争池**之前**折叠（2026-09-18 真实语料
走查修订，v1 的「池后折叠」被 30+ 份跨 agent 副本挤爆）：全量 BM25 候选先按
contentHash 分组，组代表（bm25 降序、并列时 canonicalPath 升序）进入 top-40
池参与 rerank——同内容副本不挤占独特内容的池位。折叠后主结果的
installations MUST 合并组内全部成员的入口（primary 在前、其余按组内冻结
序追加，按 path+workspaceId+providerId 三元组去重）；其余成员以
`{id, canonicalPath}` 按组内冻结序附着在 duplicates 字段。排序 tie-break
不变（final desc → name asc → canonicalPath asc）；无重复语料下输出与
v1 完全一致。

#### Scenario: 同内容多路径

- **WHEN** 两个不同 canonical 路径的 skill 内容完全相同且同时命中查询
- **THEN** 结果只出现代表一个，另一个出现在该结果的 duplicates 里；
  主结果 installations 同时包含两个成员的入口

#### Scenario: 副本不淹没多样性

- **WHEN** 同一内容存在 34 份副本且另有多个不同内容的低分候选
- **THEN** top-40 池由每组代表构成；limit 内结果覆盖多个不同 contentHash

#### Scenario: provider 作用域可命中

- **WHEN** 消费方按某 provider 作用域过滤搜索结果的 installations
- **THEN** 只要该 provider 存在此内容的副本，代表结果的 installations
  即包含该作用域入口（不因代表选择而丢失）

### Requirement: 字段加权 BM25 排序与冻结 rerank 公式，输出次序确定

检索 MUST 基于 BM25+（MiniSearch）按字段加权评分：name ×10、description
×6、keywords ×5、triggers ×5、headings ×3、body ×1（常量集中于 search
模块），启用 prefix 与 fuzzy（0.2）。BM25 top-40 候选（contentHash 组代表，
见上一 requirement）MUST 逐个计算冻结的
rerank 信号（大小写不敏感、query trim）：exactName 0.9 / namePrefix 0.5 /
queryInName 0.4 / keywordExact 0.3 / description 覆盖率 ×0.2（上限 1.0）；
最终分 = 0.7×(bm25/(bm25+8)) + 0.3×rerank；折叠后排序 MUST 以
final desc → name asc → canonicalPath asc 为 tie-break（CLI JSON 输出
稳定可重放）。

#### Scenario: name 命中压制 body 命中

- **WHEN** skill A 的 name 含查询词、skill B 仅 body 含同一查询词
- **THEN** A 排在 B 前

#### Scenario: typo 容忍

- **WHEN** 查询含 1 字符级编辑距离的拼写错误（如 "sveltte"）
- **THEN** fuzzy 路径仍能召回正确目标（基准 typo 类 R@5 = 1.00 为回归地板）

### Requirement: 持久索引以五版本信封与 stat 新鲜度维护，错误矩阵闭合

索引 MUST 持久化于 `<appDir>/search-index.json`，信封含
schemaVersion / tokenizerVersion / parserVersion / rankingVersion /
engine{name, version, configDigest} 与 MiniSearch 序列化 + 每 id 的 stat
元数据（canonicalPath、mtimeMs、size、ino、ctimeMs、installations、
contentHash、disabled、conflict、invalidFrontmatter），写入走 0600
原子写。freshen MUST 先做
无内容读取的 stat 扫描：stat 键全等时直接查询；增删改走 MiniSearch 增量
（discard(id)/add）；任一版本/engine digest 不符、JSON/Zod safeParse 失败
或 MiniSearch loadJSON 失败 MUST 全量重建。**IO 故障（EACCES/EIO/ENOSPC/
原子 rename 失败）MUST hard error（命令失败、保留原文件），不得降级为空
索引**。并发写遵循 last-writer-wins（索引是缓存，stat 校验自愈），v1
不加锁。

#### Scenario: 未变更时零重解析

- **WHEN** 索引存在且 stat 扫描与持久化元数据完全一致
- **THEN** 不读取任何 SKILL.md 内容，直接返回查询结果

#### Scenario: 保时保长的替换仍被检出

- **WHEN** 一个 SKILL.md 被替换但 mtimeMs 与 size 恰好不变
- **THEN** ino/ctimeMs 变化触发该文档重解析

#### Scenario: 版本升级强制重建

- **WHEN** 任一信封版本或 engine configDigest 与当前常量不一致
- **THEN** 全量重建并以新信封落盘

#### Scenario: 索引文件损坏

- **WHEN** search-index.json 为非法 JSON 或 MiniSearch loadJSON 抛错
- **THEN** 按空索引全量重建，本次命令正常出结果

#### Scenario: 权限故障不静默

- **WHEN** 索引目录不可写（EACCES）导致原子写失败
- **THEN** 命令以错误退出，保留原索引文件，不输出伪造的空结果

### Requirement: CLI search 输出对人与 Agent 双友好

`skill-creator search <query...>` MUST 进程内完成（不要求 daemon），支持
`--json` 与 `--limit N`（默认 10，上限 50）。人类模式输出 name、
description、canonicalPath、score 与安装数；JSON 模式输出 `{results: [{
id, name, description, canonicalPath, installations, contentHash, score,
disabled, conflict, duplicates}]}`，次序遵循冻结 tie-break，id 为稳定
sk_ id。空 query 或 flag 解析失败 exit 1；查询成功（含 0 结果）exit 0。

#### Scenario: 无 daemon 检索

- **WHEN** daemon 未运行时执行 skill-creator search "React 组件设计"
- **THEN** 命令独立完成扫描/索引/查询并输出结果

#### Scenario: JSON machine-readable

- **WHEN** 传 --json
- **THEN** stdout 仅含合法 JSON（人读信息走 stderr），字段符合契约且同
  一索引下输出可重放

### Requirement: 索引文件是 server-owned 的 app 数据

索引文件 MUST 位于 appDir() 下；扫描 roots MUST 只来自 provider catalog
与 workspace registry 持久态的 server 侧解析，不接受调用方传入的任意
路径；索引内容经 Zod safeParse 收窄后才进入内存。

#### Scenario: 调用方路径不被接受

- **WHEN** 任何调用入口试图传入自定义扫描 root 或索引路径
- **THEN** 该输入不参与 root 解析（接口不存在该参数）；索引文件路径恒由
  appDir() 派生，且经 safeParse 后才进入内存

### Requirement: daemon 以域单例服务 skills.search RPC

daemon domain MUST 持有进程级 `skillSearch` 单例（生产零参
`createSkillSearchService()`，server-owned roots；跨 RPC 调用保活——索引
惰性加载 + stat 增量 freshen 是该 service 的既有形态）。`skills.search`
RPC 输入 MUST 为 `{query: string(min 1), limit?: 1..50}`，输出
`{results: SkillSearchResult[]}`（复用 shared 契约，无第二份手写类型）。
空 query 由输入 schema 拒绝为 typed 校验错误；索引 IO 故障经错误边界透传
为 typed 失败，不伪装空结果。

#### Scenario: RPC 检索与作用域元数据

- **WHEN** 经 oRPC client 调 `skills.search({query: "React 组件"})`
- **THEN** 返回结果含稳定 sk_ id、canonicalPath、installations（workspaceId
  - providerId 三元组）与 contentHash，字段与 CLI `--json` 同契约

#### Scenario: 空 query 是校验错误

- **WHEN** 调 `skills.search({query: ""})`
- **THEN** 输入校验失败（typed error），不返回空数组的伪成功

### Requirement: MCP 面自动暴露 readonly skills_search

`skills.search` MUST 以 readonly authority 登记进 domain capability
registry；MCP server 据此自动注册 `skills_search` 工具（无 propose 变体），
stdio 与 in-process 两个 face 均可用。工具返回结构化结果（id/name/
description/canonicalPath/作用域/分数），供 Agent 直接消费。

#### Scenario: stdio face 可检索

- **WHEN** stdio MCP client 调 `skills_search`（query 命中沙箱技能）
- **THEN** 返回该技能的稳定 id 与作用域三元组；无 mutation 工具被注册

### Requirement: 内核专注模式放行 skills_search

全部专注模式（create/manage/explore）的 MCP 工具名单 MUST 包含
`skills_search`（free 模式保持既有全放行）——产品 agent 会话在任何模式都能
检索本地技能；模式 guard 对该工具不再以模式外为由拒绝。

#### Scenario: 专注模式调用不被拒

- **WHEN** create 模式会话调用 `mcp__skill-creator__skills_search`
- **THEN** 模式 guard 放行（全局 deny 面与其它既有拒绝不因本变更放宽）

### Requirement: skills store 提供 latest-request-wins 的检索动作

`searchSkills(query, limit?)` MUST 复用 request-generation 代次门 +
connection owner generation（断线重连后旧响应不得提交）；空/全空白 query
MUST NOT 发起 RPC（输入 schema min-1 是合同）并清空结果态；提交与 loading
清理遵循 isCurrent / isLatest 分工。结果态 MUST 携带完整
SkillSearchResult（含 installations 作用域三元组）。

#### Scenario: 断线重连不提交旧响应

- **WHEN** 检索在途时连接替换（owner generation++）
- **THEN** 旧响应被丢弃，重连后由新请求重新提交

### Requirement: ProviderView 过滤以后端检索为主、前端过滤为降级

URL `q` 参数仍是过滤状态的唯一真相源；非空 `q` 经 debounce 触发
`skills.search`，列表渲染检索投影（BM25 排序）；检索失败（断线/错误）MUST
降级为当前已载技能的前端 includes 过滤并给出错误提示，不得渲染空白。

#### Scenario: 中文查询命中

- **WHEN** 在 ProviderView 输入「组件设计」
- **THEN** 列表由 BM25 检索排序（含中文分词命中），而非仅子串匹配

#### Scenario: 断线降级不空白

- **WHEN** 检索请求失败
- **THEN** 列表回退前端 includes 过滤并显示错误提示

### Requirement: 命令面板提供跨 Workspace 的 Skills 全局搜索

Cmd/Ctrl+K 面板 MUST 增异步 Skills 组：输入 debounce 后走 `skills.search`
（加载态可见），结果按 workspace/provider 分组，选中跳转对应 provider
路由并打开技能详情（`?skill=…&view=detail`）。窄屏保持面板 Dialog 可用。

#### Scenario: 全局发现到详情

- **WHEN** 在面板输入技能关键词并选中结果
- **THEN** 导航到该技能所属 workspace/provider 的 ProviderView 且详情打开

### Requirement: composer `$` 菜单以 BM25 检索为数据源

`$` 态且 needle 非空时经 debounce 调 `skills.search`；菜单行从结果
installations 派生（组头 = workspace label / provider label；同一技能多
安装呈现多行同引用）；空 needle 显示占位提示而非全量列表；选中语义不变
（`$name` token + skill 三元组引用入 registry）；断线沿 getRpc() 优雅
失败先例。全量拉取路径 MUST 移除。

#### Scenario: 中文与 typo 输入

- **WHEN** `$` 菜单输入「组件」或拼错的技能名
- **THEN** BM25/分词/模糊召回目标技能，选中后引用正确落稿

### Requirement: 技能正文索引覆盖 skill 目录内的全部 Markdown（排除目录除外）

`SKILL.md`（或 `.SKILL.md`）仍是唯一身份/结构源（frontmatter、headings、
首段正文）；skill 目录内其余 `*.md` 文件 MUST 作为正文补充文本进入 `body`
字段。收集 MUST 只走真实目录（symlink 目录/文件一律不进），深度 ≤4、
文件数 ≤32、dot 目录与排除目录（配置清单 ∪ 内置清单）MUST NOT 进入；
每文件文本 cap 6k、合计 cap 12k；收集顺序按路径排序确定。`contentHash`
MUST 覆盖实际被索引的全部文件字节（身份源 + 额外文件，路径序拼接）。

#### Scenario: 额外 md 命中正文检索

- **WHEN** 某技能的 `reference/guide.md` 含独有关键词且 `SKILL.md` 不含
- **THEN** 该关键词能检索到该技能，且 hash 随 guide.md 内容变化

#### Scenario: 排除目录不进正文

- **WHEN** skill 目录下 `node_modules/lib.md` 存在
- **THEN** 其内容不影响该技能的任何索引字段与 contentHash

### Requirement: 排除目录由 server-owned TOML 配置追加

`<appDir>/search-config.toml`（daemon boot 缺失时原子写注释模板）持有
`excludeDirs: string[]`；语义为在内置清单之上**追加**（dot 目录全跳与内置
排除不可移除）。配置 MUST 经 TOML parse → Zod safeParse 收窄；语法/结构
失败按领域空值（仅内置默认）处理且不写回；IO 硬错误为 hard error。配置
摘要 `configDigest` MUST 进索引信封，变更触发全量重建。

#### Scenario: 追加排除立即生效并重建

- **WHEN** 配置追加 `"vendor"` 后下一次 freshen
- **THEN** 名为 vendor 的子目录不再进入正文，且信封 configDigest 改变触发
  全量重建

#### Scenario: 畸形配置不炸索引

- **WHEN** 配置文件含 TOML 语法错误
- **THEN** 索引按内置默认继续可用（不迁移、不删除文件、不写回）

### Requirement: 索引信封 v3 以文件集 stat 维护增量

`stats[id].files` MUST 持有身份源 + 额外 md 的逐文件四元组
（mtimeMs/size/ino/ctimeMs，路径排序）；freshen 的 unchanged 判定 MUST
要求文件集合与逐文件四元组同时相等。`schemaVersion` MUST 为 3；v2 缓存
加载失败一次性全量重建（无迁移）。

#### Scenario: 额外文件删除被检出

- **WHEN** 索引后删除一个额外 md 文件
- **THEN** 下一次 freshen 判定该 skill changed 并重读重建其文档

### Requirement: watcher 让无变化检索零扫描、有变化近实时刷新

service MUST 对去重后的 canonical provider roots 维护 `fs.watch`
（recursive、persistent:false）集合并在 freshen 后 reconcile；watch 失败
的 root MUST 回退逐搜索扫描。无 dirty 且全部 root watched 时 `search`
MUST 跳过扫描直接查询内存；事件去抖后，文档量 ≤20k 时 MUST 同步 freshen
（实时），更大语料保持 dirty 到下次 search。`dispose()` MUST 关闭全部
watch 句柄并接入 daemon stop coordinator。

#### Scenario: 无变化时零扫描

- **WHEN** watcher 活跃且自上次 freshen 无任何文件事件
- **THEN** search 不发生 readdir/realpath 扫描（纯内存查询）

#### Scenario: 变更近实时可见

- **WHEN** watcher 活跃且某 SKILL.md 被编辑
- **THEN** 去抖窗口后无需等待下一次 search，索引已刷新（新内容可查）

### Requirement: 配置文件可从界面在编辑器中打开

`skills.searchConfig.open` RPC（无输入）MUST 以 server-owned 常量路径
调用平台 opener 打开 `search-config.toml`（macOS `open` / Windows
`explorer` 或 `start` / Linux `xdg-open`），不接受调用方路径。命令面板
Navigate 组与 ProviderView 过滤栏 MUST 各有一个入口。

#### Scenario: 面板命令打开配置

- **WHEN** 用户在 ⌘K 面板执行「Open search config」
- **THEN** 系统默认编辑器打开 `<appDir>/search-config.toml`

### Requirement: 检索面工程卫生（复审小包）

`SEARCH_DEBOUNCE_MS` MUST 由 skills store 单点导出供三消费方引用；palette
行 scope 字段 MUST 使用 `WorkspaceId`/`ProviderId` 类型；检索失败 MUST 有
debug 级 console 诊断；Esc/外点 dismiss 与「安装后立即可搜」MUST 有真实
证据（可见窗口走查 / 集成测试）。

#### Scenario: 安装后立即可搜

- **WHEN** Repository 完成一次真实安装后立即调用 `skills.search`
- **THEN** 新技能可被检索（freshen 增量发现，无需重启或手动刷新）

### Requirement: 索引提供无查询的内容重复组投影

service MUST 暴露 `duplicates()`：按 `contentHash` 分组、仅保留成员数 >1
的组；成员携带 `{id, name, canonicalPath, installations, disabled,
conflict}`；组间按成员 canonicalPath 最小值升序、组内按 canonicalPath
升序（冻结次序）。新鲜度 MUST 与 `search()` 共用同一 freshen 路径。

#### Scenario: 同内容双安装成组

- **WHEN** 两个 canonical 目录的 SKILL.md 字节相同（或被索引文件集字节相同）
- **THEN** duplicates() 返回一个含两个成员的组，成员各带自身 installations

#### Scenario: 唯一内容不出组

- **WHEN** 某技能内容唯一
- **THEN** 它不出现在任何 duplicates 组中

### Requirement: duplicates 经 RPC 与 MCP 面可查

`skills.duplicates`（readonly，无输入）MUST 返回 `{groups}`；capability
登记后 MCP 面 MUST 自动投影 `skills_duplicates` 工具。

#### Scenario: 面板与 agent 同源

- **WHEN** WebUI 调 RPC 与 stdio MCP 调 `skills_duplicates`
- **THEN** 两者来自同一 service 实例投影，结果一致

### Requirement: 同源技能以行内小角标呈现

WorkspacesHome MUST NOT 渲染「同内容技能」区块（2026-09-18 用户走查裁决
废除整屏列表形式）。ProviderView MUST 在技能列表行与搜索结果行上，对内容
与其他安装相同的技能渲染 symlink 式小角标（箭头图标 + 同源计数 + title
描述）；角标数据来自连接后单次 `skills.duplicates` 查询构建的 id → 组内
其他成员数映射；查询失败静默（角标缺失不是错误态）。

#### Scenario: 同源技能行角标

- **WHEN** 当前列表中某技能 id 属于某重复组成员
- **THEN** 该行名字旁呈现同源角标，title 注明「Same content as N other
  installations」

#### Scenario: 唯一内容无角标

- **WHEN** 某技能内容唯一
- **THEN** 该行不呈现同源角标

#### Scenario: 首页无区块

- **WHEN** 存在重复组时进入 WorkspacesHome
- **THEN** 页面不出现同内容区块；同源信息只在 Provider 行内呈现
