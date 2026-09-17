# Design: skill-search

> 完整调研、选型依据与实测数据见 `docs/search-design.md`（2026-09-17）。
> 本文只记录实现层面的结构与约束，不复述调研。

## 模块结构（遵守 AGENTS.md 依赖方向）

```text
src/shared/contracts/search.ts          [2] SkillSearchDocument/Result/Options Zod 契约
src/daemon/skill-search/
  tokenizer.ts   [2] SkillTokenizer（Segmenter+bigram+Latin 切分；版本化；探针降级）
  scanner.ts     [2] provider roots 枚举（catalog global + imported）→ 候选入口
  canonicalize.ts[2] realpath 去重 + installations + sha256 contentHash
  parser.ts      [2] SKILL.md → SearchDocument（gray-matter + headings + 正文抽提）
  index.ts       [3] SkillSearchIndex 抽象 + MiniSearch 实现 + 持久化/新鲜度
  ranking.ts     [2] rerank 信号 + content-dup 折叠
  service.ts     [2] createSkillSearchService()：编排，唯一对外面
src/cli/cli.ts  COMMANDS.search         （+1 意图：query/flag 解析与输出投影）
```

关键取舍与理由：

1. **不建 packages/search/**：本仓是单包 esbuild bundle 结构（src/ → dist/
   cli.js+daemon.js）；workspace `packages/*` glob 虽存在但无 bundle 基建，
   独立包只会破坏 externals 规则。域模块放 src/daemon/skill-search/ 与
   workspace-registry/ 同构。
2. **MiniSearch 放 dependencies**（registry 真实包，esbuild external，安装期
   解析）；不 inline。CLI 不直接 import MiniSearch——一律经 SkillSearchIndex。
   已知 API 事实：MiniSearch 7 `discard(id)` 按 id 字符串（非文档对象）。
   锁定当前确切版本的序列化格式（升级任何版本都触发重建）；engine 信封记录 name + 运行时确切 version + configDigest。
3. **ccski discovery 不复用**：`entry.isDirectory()` 不跟进 symlink（实测），
   与本任务的 symlink 多安装场景冲突；scanner 自研但只产出候选路径，
   frontmatter 解析复用 gray-matter。frontmatter 容错：Zod 对齐 ccski
   （name/description min-1，其余 passthrough）；校验失败不弃文档——name
   回退 directoryName、description 置空、`invalidFrontmatter: true`；
   keywords/triggers 收窄 `string | string[]`，其它类型条目丢弃。

## 冻结决策（2026-09-17 评审修订）

- **双文件冲突**：SKILL.md 与 .SKILL.md 并存 → 内容源 SKILL.md +
  `conflict: true`；仅 .SKILL.md → `disabled: true`；contentHash = 实际
  被索引文件字节。
- **扫描边界**：root 直接子入口（symlink 入口层解析）；真实子目录递归
  ≤2 且不跟进 symlink；跳过 dot 目录与 node_modules；roots 来自 catalog +
  workspace registry 持久态的只读投影（不走 list() 的 ccski 计数）。
- **索引信封五版本**：schemaVersion / tokenizerVersion / parserVersion /
  rankingVersion / engine{name,version,configDigest}，任一不符全量重建；
  stat 键 = mtimeMs+size+ino+ctimeMs。
- **错误矩阵**：文件缺失 → 重建；JSON/Zod/loadJSON 失败 → 空索引重建；
  EACCES/EIO/ENOSPC/rename 失败 → hard error exit 1 保留原文件；并发写
  last-writer-wins（索引是缓存，stat 自愈），v1 无锁。
- **installations 结构化**：`{path, workspaceId: "~"|ws_*, providerId}[]`，
  未来 RPC/GUI 直接可组装 WorkspaceProviderTarget；providerIds 派生不存储。
- **ranking 冻结**：top40（BM25 原始分）→ 逐候选 rerank（exactName .9 /
  namePrefix .5 / queryInName .4 / keywordExact .3 / descCoverage .2×cov，
  上限 1.0，全部大小写不敏感 + query trim）→ final = 0.7×bm25/(bm25+8) +
  0.3×rerank → **之后**按 contentHash 折叠（组内 final 最高者为主）→
  tie-break：final desc → name asc → canonicalPath asc（CLI JSON 稳定）。
- **tokenizer 冻结**：唯一实现 = 连续单字滑窗 bigram 规则（见
  docs/search-design.md §6 冻结期望表，20 条实测输出逐字固化，改动必须
  先改表再改代码）；small-ICU 探针失败 → 逐字退化 + 滑窗 = pure-bigram。
- **集成测试入口**：源码树用 `bun src/cli/cli.ts`（仓库 dev:cli 同款），
  或构建后 execFile dist/cli.js；均隔离 SKILL_CREATOR_HOME 与真实 roots。
- **测试 seam 边界声明**：`createSkillSearchServiceWithRoots` 是显式命名的
  测试专用导出（JSDoc 标注，测试/基准专用）——它是文档化的测试边界而非安全
  不变量；安全不变量 = 生产装配（CLI/daemon/RPC）只经零参
  `createSkillSearchService()`，不存在调用方 root 传参路径。索引外部输入
  边界：加载时序列化活跃 id 集与 stats 键等值 + 存储投影与 stats 逐字段
  交叉校验（stats 为唯一可重放元数据源），矛盾即损坏重建；documentIds 值
  唯一 + 与 storedFields 键一一对应（防倒排词伪装）；statIsCurrent 额外绑定
  canonicalPath（联合篡改 stats+projection 时按真实 scan 重解析恢复真相）。
  文档级 SKILL.md symlink 以 lstat 拒绝（symlink 跟进仅限入口层目录），
  读取走 open(O_NOFOLLOW, POSIX) + fstat 身份校验（ino+size 对扫描快照）
  - 从 fd 读字节（TOCTOU 替换抛 typed 错误，不接受无法证明身份的字节）。
    v2 信封新增 payloadDigest（sha256(JSON.stringify({index, stats}))，写入
    时计算、加载时重算）：一切不重算摘要的篡改——控制面元数据（documentCount
    等 NaN/排序注入向量）、倒排、投影文本、stats——在加载整体失效。已知残留
    （无密钥模型不可约边界）：持有 app 缓存写权限且重算摘要的完整伪造——stat
    零内容读取原则下不做每次字节重读；canonicalPath+四元组绑定与 digest 已
    闭合全部「部分篡改」向量。

## 数据流

```text
roots(catalog ∪ workspaces.json 持久态) --readdir+stat--> 候选入口(含 symlink)
  --realpath--> canonical 分组 {canonicalPath, installations[{path,workspaceId,providerId}]}
  --读 SKILL.md--> SearchDocument（字段契约 + contentHash + stat）
  --SkillTokenizer--> MiniSearch(BM25+, fields×boost)   ──持久化 search-index.json
query --SkillTokenizer--> BM25 top40 --> rerank --> content-dup 折叠 --> tie-break --> SearchResult[]
```

## 关键实现约束

- 字段权重、fuzzy/prefix 参数、rerank 权重全部集中在 `index.ts`/`ranking.ts`
  顶部常量区（可调，不散落 CLI）。
- 索引 JSON：五版本信封（engine.version 写运行时解析到的**确切**包版本，
  configDigest = 字段/boost/fuzzy/prefix/processTerm 常量的 JSON 序列化
  sha256）+ stats 键 `{canonicalPath, mtimeMs, size, ino, ctimeMs,
installations, contentHash, disabled, conflict, invalidFrontmatter}`（全文
  见 docs/search-design.md §10 与上方冻结决策）；加载 safeParse 失败 →
  空索引；写入 atomicWriteUtf8；IO 故障 hard error。
- body 抽提：frontmatter 剥离后的 markdown 文本（去 code fence 围栏符号、
  保留代码内标识符文本），截 12k chars。
- freshen 粒度：stat 扫描（不读内容）→ 差异集 → 增量 discard(id)+add；
  discarded 占比 > 20% 或版本不符 → 全量重建。
- service 无状态副作用：单次调用内完成 freshen+search；不做后台 watcher。
- CLI：query = 非 flag 参数拼接；`--limit` 默认 10，上限 50；JSON 模式 stdout
  纯 JSON。进度/诊断信息（扫描耗时、索引状态）走 stderr 且仅人类模式。

## 测试与验证

- 单元：tokenizer（spec 场景逐条 + JA/KEBAB/URL 边界）、scanner（symlink/
  broken/nested 深度上限）、canonicalize（realpath/content dedup）、index
  （fresh/incremental/rebuild/corrupt）、ranking 次序断言。
- 集成：临时 sandbox 写真实形态 skill 目录 + symlink，端到端跑 service 与
  CLI（`bun src/cli/cli.ts`，或构建后 execFile dist/cli.js），断言 exit
  code、JSON 字段与可重放次序。
- 回归基准：`test/search-benchmark/` 固化合成语料 + 标注 query + 指标断言
  （R@5 ≥ 0.95 地板，防 tokenizer/ranking 回退）；性能脚本 `scripts/` 手动跑。
- 验证门：pnpm check / pnpm build / npm pack --dry-run（确认 minisearch 在
  dependencies 且产物不含其内联代码）。
