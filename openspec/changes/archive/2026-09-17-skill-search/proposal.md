# Proposal: 本地 Skill Search Index + `skill-creator search`

## Why

用户需求 [2026-09-17]：「为 `skill-creator` 开发 `skill-creator search <query>`。
目标不是简单增加一个字符串搜索功能，而是建立一个轻量、本地优先、可持续演进的
Skill Search Index……BM25-based lexical search + Skill-specific tokenizer +
canonicalization/deduplication + field-aware ranking，而不是 vector search。」
产品定位：「不是给 skill-creator 加一个搜索命令，而是建立第一代 Skill
Index」——本 change 为后续的 Search → Duplicate Detection → Merge →
Upgrade → Memory → Sync 演进提供 **v1 数据模型基础**（目录级 manifest /
provenance / lock 状态是后续 change 的深化项，不在本 change 承诺）。

三个实证动机（docs/search-design.md §1/§7；2026-09-17 本机快照，live
入口数随时间浮动 241~~244、重复组 9~~11，实现阶段以仓库固化语料为准）：

1. v1 的 `search` 实为 npm registry 在线搜索，本地检索只覆盖单 skill 的
   references 目录；SKILL.md 元数据不可搜。
2. 真实机器上 skills 以 symlink 多安装：本机 6 个 agent root 约 241 个入口
   （其中 ~117 个 symlink）realpath 去重后仅 ~119 个 canonical skill（最多
   装 5 处）；ccski discovery（`entry.isDirectory()`）不跟进 symlink，
   现有 `skills.list` 看不到这些安装。
3. ~119 个 canonical 中存在多组内容级重复（各 4 个 canonical：agents-sdk /
   cloudflare / wrangler 等）——content hash 是真实需求。

## What Changes

### C1 —— Skill Search 域模块（src/daemon/skill-search/ + shared 契约）

- `src/shared/contracts/search.ts`：SkillSearchDocument（installations 为
  结构化 `{path, workspaceId: "~"|ws_*, providerId}[]`）/ SkillSearchResult
  （含 conflict / duplicates）/ SearchOptions Zod 契约。
- `src/daemon/skill-search/`：
  - `tokenizer.ts`：SkillTokenizer——NFKC + Intl.Segmenter(zh) + **连续单字
    滑窗 bigram**（≥2 相邻单字滑窗发射、单字不单独发射、孤立单字作
    unigram）+ 自研 Latin 标识符切分（camel/Pascal/snake/kebab/@scope/
    URL），零依赖；行为版本化 + **冻结期望表逐字契约**（docs §6）；
    small-ICU 探针降级为 pure-bigram。
  - `scanner.ts`：枚举 provider roots（catalog globalPath + imported
    workspaces **持久态只读投影**），跟进入口层 symlink、跳过 broken
    symlink；真实子目录递归 ≤2 且不跟进 symlink；跳过 dot 目录与
    node_modules。
  - `canonicalize.ts`：realpath 去重 + installations 作用域分组 + 双文件
    规则（SKILL.md 优先 / conflict / disabled）+ sha256 contentHash（实际
    被索引文件字节）。
  - `parser.ts`：SKILL.md → SearchDocument（gray-matter + headings +
    markdown-to-search-text + 12k 截断；frontmatter 无效不弃文档：
    回退目录名/空描述 + invalidFrontmatter 标记）。
  - `index.ts`：SkillSearchIndex 抽象 + MiniSearch 7（BM25+）实现；
    **五版本信封**（schema/tokenizer/parser/ranking/engine{name, 确切
    package version, configDigest}）持久化到 `<appDir>/search-index.json`
    （atomicWriteUtf8 0600 + safeParse + loadJSON 失败重建 + IO 故障 hard
    error）；stat 四元组（mtimeMs+size+ino+ctimeMs）新鲜度增量更新；
    并发写 last-writer-wins。
  - `ranking.ts`：冻结公式——BM25 top40 → rerank（exactName .9 /
    namePrefix .5 / queryInName .4 / keywordExact .3 / descCoverage .2×cov；
    final = 0.7×bm25/(bm25+8) + 0.3×rerank）→ **rerank 之后**按
    contentHash 折叠（组内同分按 name→canonicalPath 选主）→ tie-break
    （final → name → canonicalPath）。
  - `service.ts`：编排入口 `createSkillSearchService()`（scan →
    canonicalize → parse → freshen → search），daemon/CLI 进程内可用。

### C2 —— CLI `skill-creator search`

- `src/cli/cli.ts` COMMANDS 增 `search`：`skill-creator search <query...>
[--json] [--limit N]`（上限 50）；进程内组装（仿 `mcp` 命令，不要求
  daemon 运行）。
- 人类可读输出：name / description / canonicalPath / score / installations；
  `--json` 输出 `{results: [{id, name, description, canonicalPath,
installations, contentHash, score, disabled, conflict, duplicates}]}`
  （providerIds 为运行时派生投影，不进 JSON 合同），次序遵循冻结
  tie-break，同一索引下输出可重放。
- exit code：0（含 0 结果）；1（空 query / 参数错误 / IO 故障）。

### C3 —— Benchmark 资产 + 测试 + 文档

- `docs/search-design.md`（已落）：技术调研、选型依据、冻结决策与实测
  基准。
- 回归基准固化入仓库：合成语料 + 标注 query + **冻结 ranking 全链路**
  （完整 SHA-256、top40→rerank→fold→tie-break）+ 指标断言（总体
  R@5 ≥ 0.95 地板 + typo 类 R@5 = 1.00 地板 + 人为构造的 name/desc/body
  次序、同 hash 同分、tie-break、duplicate 主成员案例）；tokenizer/ranking
  改动必须重跑；live 本机语料仅作 env 门控的可选对照。
- 性能脚本：scripts/ 下 1k/10k/50k 构建/体积/延迟测量（手动跑，结果带
  运行方差记入设计文档 §11）。
- 单元/集成测试：tokenizer 冻结期望表逐条断言（含 JA/KO/全角/URL/探针
  伪造）、scanner（symlink/broken/nested/环/越界负向）、dedup（realpath/
  content/双文件冲突）、index 生命周期（fresh/incremental/rebuild/corrupt/
  EACCES/EIO/ENOSPC/rename 失败/保时保长替换/并发 stale-writer 自愈）、
  ranking 次序、CLI 端到端（bun src/cli/cli.ts 或 dist 构建 + 隔离 home）。
- README 增 search 章节；AGENTS.md 诊断同步。

### 明确不在本 change

- daemon RPC `skills.search`、MCP search capability、WebUI/composer `$` 菜单
  接入、内核搜索升级——service 接口按这些消费方设计，实施留后续 change。
- Semantic/Hybrid backend（接口留扩展位，不实现）。
- 目录级 manifest/revision、source provenance、lock 状态（duplicate 深化 /
  merge / upgrade / sync 的完整能力属后续 change；本 change 提供其 v1
  基础：canonicalPath + contentHash + installations 作用域映射）。
