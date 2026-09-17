# skill-search 变更（增量：健壮性——内容范围/配置/监听/平台）

## ADDED Requirements

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
