# Tasks

## C1 —— 域模块

- [x] 1.1 契约：src/shared/contracts/search.ts（SkillSearchDocument /
      SkillSearchResult / SkillSearchOptions / SkillInstallation，Zod strict，
      installations={path,workspaceId,providerId}[]，含 conflict /
      invalidFrontmatter / duplicates 字段）
- [x] 1.2 tokenizer.ts：NFKC + script-run + Segmenter(zh) + 连续单字滑窗
      bigram + Latin 标识符切分（camel/Pascal/snake/kebab/@scope/URL，分支
      序正确）；TOKENIZER_VERSION；small-ICU 探针降级（逐字+滑窗）；
      测试 = docs/search-design.md §6 冻结期望表逐条断言（20 条）+ JA/KO/
      全角/探针伪造场景
- [x] 1.3 scanner.ts：roots 枚举（catalog global + imported workspaces 持久
      态只读投影，不走 WorkspaceRegistry.list() 的 ccski 计数）+ symlink
      入口层跟进 + broken 跳过 + 真实子目录递归 ≤2 不跟进 symlink + dot/
      node_modules 跳过；单元测试（symlink/broken/nested/环/SKILL.md 目录陷阱）
- [x] 1.4 canonicalize.ts：realpath 去重 + installations[{path,workspaceId,
      providerId}] 分组 + 双文件规则（SKILL.md 优先 / conflict / disabled）+ sha256 contentHash（实际被索引文件）；单元测试（same realpath /
      same content / different / 双文件冲突）
- [x] 1.5 parser.ts：SKILL.md → SearchDocument（gray-matter + headings +
      markdown-to-search-text + 12k 截断 + frontmatter 容错：无效回退目录
      名/空描述 + invalidFrontmatter + keywords/triggers 收窄）；单元测试
- [x] 1.6 index.ts：MiniSearch 封装（fields×boost、prefix、fuzzy 0.2）+
      五版本信封（schema/tokenizer/parser/ranking/engine{name,version,
      configDigest}）+ search-index.json 持久化（atomicWriteUtf8 0600 /
      safeParse / loadJSON 失败重建 / IO 故障 hard error）+ stat 新鲜度
      （mtimeMs+size+ino+ctimeMs）增量（discard(id)+add、脏度阈值全量重建）；
      单元测试（fresh/incremental/rebuild/corrupt JSON/loadJSON 失败/存储投影篡改拒绝/缺 stats
      自愈/EACCES hard error + 写失败后内存失效自愈（EIO/ENOSPC/rename 共用 save
      hard-error 分支，经该事务语义测试覆盖）/保时保长替换/并发 last-writer-wins）
- [x] 1.7 ranking.ts：冻结公式（exactName .9/namePrefix .5/queryInName .4/
      keywordExact .3/descCoverage .2，final=0.7×bm25/(bm25+8)+0.3×rerank，
      rerank 后按 contentHash 折叠，tie-break final→name→canonicalPath）；
      测试（name>description>body 次序、dup 折叠、tie-break 稳定、typo 召回）
- [x] 1.8 service.ts：createSkillSearchService()（生产零参、server-owned roots）+
      createSkillSearchServiceWithRoots 测试 seam + 默认装配测试（catalog global +
      imported workspaces 真实路径）

## C2 —— CLI

- [x] 2.1 cli.ts：COMMANDS.search + runSearch（query 拼接、--json、--limit
      上限 50、exit code：空 query/flag 错误 1，查询成功含 0 结果 0）；
      help 文案
- [x] 2.2 人类输出投影（name/description/canonicalPath/score/installations，
      诊断走 stderr）
- [x] 2.3 集成测试：sandbox 真实形态 skills + symlink，`bun src/cli/cli.ts`
      （或 dist 构建）断言 exit code / JSON 字段集与可重放次序 / 无 daemon；server-owned root 越界负向（接口无自定义 root 参数）

## C3 —— Benchmark / 测试资产 / 文档

- [x] 3.1 依赖：minisearch ^7.2 入 dependencies（esbuild external 默认规则）
- [x] 3.2 回归基准固化：合成语料 + 标注 query + 指标脚本（Recall@5/@10、
      MRR；结果按 contentHash 折叠后计分）入仓库；R@5 ≥ 0.95 总地板 + typo 类 R@5=1.00 地板 + 人为构造案例（name/desc/body 次序、同 hash 同分选主、tie-break、duplicate 主成员）；
      live 本机语料为可选对照模式（env 门控），不进回归门
- [x] 3.3 性能脚本：scripts/ 下 1k/10k/50k 构建/体积/延迟测量（手动跑，
      结果记 docs/search-design.md §11）
- [x] 3.4 README search 章节 + docs/search-design.md 交叉引用
- [x] 3.5 验证门全绿：pnpm check、pnpm build、npm pack --dry-run
      （dependencies 含 minisearch、dist 无内联 minisearch）
- [x] 3.6 AGENTS.md 诊断同步（目录树 + i18n 词条）+ openspec archive
