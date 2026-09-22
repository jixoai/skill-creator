# Skill Search Index — 技术设计报告

> 2026-09-17。目标：为 `skill-creator` 建立第一代本地 Skill Search Index，
> 交付 `skill-creator search <query>`，并为未来的 duplicate detection / merge /
> upgrade / sync 提供正确的数据模型。本报告的全部结论基于当日在本机
> （darwin-arm64，Node v24.21.0，ICU 78.3）实测的 PoC 基准，实验场位于
> /tmp/skill-search-poc（不入库）；基准脚本与语料将随实现固化为仓库资产。

## 1. v1 search 分析（为什么不重写一遍不行）

v1（skill-creator 仓库）实际有两套搜索，且都不是「跨全部本地 skills 的检索」：

| 命令                   | 实际行为                                                                | 引擎                                                           |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `search <keywords>`    | **npm registry 在线 HTTP 搜索**（registry.npmjs.org，逐结果再拉包详情） | 网络                                                           |
| `search-skill <query>` | 搜**单个 skill 目录**内 `assets/references/**/*.md`，每次先重建索引     | MiniSearch 7（BM25+）+ 7 信号手调 rerank / ufuzzy / sqlite-vec |

v1 的结构性短板（v2 必须超越的点）：

1. 无跨 skill 全局索引；SKILL.md 的 name/description 根本不可搜。
2. 无 frontmatter 元数据检索（v1 没有 YAML frontmatter 概念）。
3. 文档粒度 = 整个 .md 文件，无字段分层；BM25 原始排序不够好，靠 7 个
   手调权重信号 rerank 补偿，且该套启发式在 3 处近似重复实现。
4. auto 回退的 fuzzy 分数是固定常量（1.0/0.7/0.5），与 fulltext 分数不可比。
5. Discovery 只覆盖 `.claude/skills` 两个根；**不跟进 symlink**，而真实机器上
   `npx skills add` 装的 skill 是 symlink（实测本机 6 个 root 244 个入口中
   115 个是 symlink）。
6. 索引存在 skill 目录内（污染 skill 本体）；索引「命中」也要全量重读文件算 hash。
7. vector 路径依赖 sqlite-vec + transformers.js wasm，重且脆，被 auto 排除。

## 2. BM25 原理简述

BM25（Okapi）是 TF-IDF 家族的词频饱和 + 文档长度归一化评分：

```text
score(D,Q) = Σ IDF(q) · tf(q,D)·(k1+1) / (tf + k1·(1 − b + b·|D|/avgdl))
IDF(q)     = ln(1 + (N − n + 0.5)/(n + 0.5))
```

- tf 饱和（k1，典型 1.2–2.0）：词频增益递减，堆词无效。
- 长度归一（b，典型 0.75）：长文档不被天然偏爱。
- BM25F（多字段加权）：工程上有两条等价简化路线——
  (a) 逐字段独立 BM25 后按字段权重加权求和（MiniSearch 的 `boost` 语义）；
  (b) 跨字段加权合并词频后再饱和（Zaragoza 式）。
  本设计取 (a)：实现与调参简单，且查询时可调。
- Lexical search 与 vector search 的区别：BM25 精确匹配字面 token，靠 IDF
  区分词的稀有度；无语义泛化。Skill 的 name/description/keywords 本身就是
  高密度结构化词面信号，lexical 是第一正确解。

BM25 本身不是 tokenizer。检索链路：

```text
Raw SKILL.md → 解析字段 → Normalization → SkillTokenizer → Tokens
  → 倒排索引（含字段、词频、文档长度） → BM25+ 打分 → skill-aware rerank
```

## 3. 底层引擎对比（bm25x / bm25 / MiniSearch / 自研 / FTS5 / Tantivy / flexsearch）

关键事实修正（2026-09-17 一手复核：仓库浅克隆源码审读 + npm registry 实测）：
**npm 上不存在 `bm25x`**（`registry.npmjs.org/bm25x` 与 `@lightonai/bm25x`
均 404）。lightonai/bm25x 是 Rust core + Python 绑定（PyPI `bm25x` / crates.io
`bm25x = "0.1"`），最后一次提交 2026-03-19（v0.3.1 后沉寂 6 个月，54★，
Apache-2.0）。**源码级否决理由**（src/tokenizer.rs、src/index.rs 实读）：

1. tokenizer 是**封闭枚举 + 私有结构体**（`TokenizerMode::{Plain,Unicode,
Stem,UnicodeStem}` = lowercase + 非字母数字切分 + Snowball 英文词干 +
   英文停用词；`struct Tokenizer` 非 pub trait）——**没有任何注入点**，
   中文连续段会被当成整段单 token，且违反任务 Principle 4「Tokenizer 与
   BM25 解耦」；接入我们的 CJK 管线只能侵入式 fork。
2. 无字段概念（文档 = 扁平字符串），不支持 BM25F/字段加权——skill 检索的
   核心信号（name > description > body）无处安放。
3. 无 wasm 发布物；napi/wasm 绑定需自建 + 维护平台分发，对 CLI 是纯成本。

值得记取的设计亮点（不改变结论）：mmap 持久化 + 懒评分（查询时才算 BM25，
索引只存原始词频）与 `search_filtered(subset)` 预过滤打分，是未来大规模/
作用域检索可借鉴的模式。Michael-JB/bm25 同为 Rust crate（有 Tokenizer
trait 注入但无持久化）。任务书「优先评估 bm25x」的前提经实证不成立，
候选池换轨为 JS 生态真实存在的方案。

| 方案                                     | 评分模型                                         | 自定义 tokenizer                                                                        | 增删改                         | 持久化                                              | 字段加权                    | 依赖形态                                                 | 结论                                     |
| ---------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- | --------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| **MiniSearch 7.2**                       | **BM25+**（源码实证 k=1.2,b=0.7,d=0.5；v5.0 起） | `tokenize(text, field)` 全注入                                                          | add/remove(id)/discard/replace | `toJSON()/loadJSON()`                               | fields + 查询期 `boost`     | 0 依赖纯 TS，MIT，活跃（6.1k★）                          | **选定**                                 |
| 自研 ~200 行 BM25                        | Okapi/BM25F 任意                                 | 自带                                                                                    | 自写                           | 自写                                                | 自写                        | 0                                                        | 备选兜底；prefix/fuzzy 需自实现          |
| node:sqlite FTS5                         | bm25()                                           | **无 JS hook**（unicode61/trigram，中文无分词）                                         | SQL                            | 免费 .db                                            | bm25(t,w...) 列权重         | Node 内置（RC 档）                                       | 仅作行为参照，不采用                     |
| flexsearch 0.8                           | 非 BM25（resolution 槽位）                       | encode fn                                                                               | add                            | export/import                                       | 无字段 boost                | 0 依赖，Apache-2.0                                       | 排除                                     |
| wink-bm25                                | BM25F                                            | prepTasks                                                                               | consolidate 后锁死             | exportJSON                                          | fldWeights                  | 停更 4 年 + 英文模型重依赖                               | 排除                                     |
| Tantivy（@oxdev03/node-tantivy-binding） | BM25（k1/b 内核默认）                            | `registerTokenizer` 仅内置 Rust 组合；**PreTokenizedString 未暴露 JS**；内置无 Han 分词 | delete_documents_by_term/query | **磁盘 mmap 目录（Index(schema,path)/Index.open）** | boostQuery 组合（非声明式） | napi-rs，15 平台 optionalDeps，MIT，周下载 95，solo 维护 | v1 排除；**指定为规模化后备**（见 §3.1） |
| fuse.js                                  | bitap 子串模糊，无 IDF                           | —                                                                                       | —                              | 无                                                  | —                           | 0 依赖                                                   | 排除（任务书点名要超越的对象）           |
| lucivy / better-sqlite3                  | —                                                | —                                                                                       | —                              | —                                                   | —                           | native 不可 bundle                                       | 排除                                     |

**为什么选 MiniSearch 且包在抽象后面**：它是唯一同时满足
「真 BM25+ / tokenizer 全注入 / 增删改 / 持久化 / 字段 boost / prefix+fuzzy
（typo 容忍）/ 零依赖可 bundle / MIT / 活跃维护」的现成包。fuzzy + prefix
直接覆盖任务的 typo 需求（实测 typo 类 R@5：fuzzy=0 时 0.73，fuzzy=0.2 时
1.00）。CLI 不直接 import MiniSearch——所有访问经 `SkillSearchIndex`
接口，未来可替换为自研 BM25F 或 semantic backend。

### 3.1 内存边界与 Tantivy 后备（2026-09-17 二轮，源码一手核验）

MiniSearch 是纯内存引擎，内存关切的量化边界（实测 §11）：

```text
文档数 = canonical skill 数（v1 只索引每 skill 的 SKILL.md，
skill 内部的其它文件不进索引——「某个 skill 文件很多」不放大文档数）

1k docs → heap 11MB / 10k → 125MB / 50k → 306MB（极端压测档）
真实规模（100–2k skills）→ 1–20MB；CLI 进程随查询结束释放；
未来 daemon 常驻场景在 ≤2k skills 下 20MB RSS 可接受。
```

结论：**v1 的文档粒度下 MiniSearch 内存不构成风险**；风险在未来的
「file-level 全文索引 / sync 大库」场景（10 万级 docs）。为此把
`@oxdev03/node-tantivy-binding`（tantivy 0.25.0，napi-rs，MIT，Node 22+，
2026-08 发布 0.3.3，15 平台预编译，solo 维护，周下载 95）核验并登记为
**指定规模化后备**，而不是现在采用：

- 它确实解决内存模型：磁盘 mmap 目录索引（`new Index(schema, path)` /
  `Index.open(path)`），reader RSS 有界（页缓存可回收）；富查询代数
  （fuzzyTermQuery/boostQuery/phraseQuery/regex）与真 delete
  （delete_documents_by_term）齐备——是迄今观察到的最佳 Node 入口
  （优于 2019 年死亡的 Frando/tantivy-node 与 @pngwasi 绑定）。
- 但现在不采用的理由：(a) v1 粒度下无内存收益；(b) solo 维护 + 极低采用
  量 + README 自认验证缺口，作为发布 CLI 的硬依赖是支持面风险；
  (c) **CJK 注入路径缺失**——`PreTokenizedString` 只存在于 Rust 内部
  serde 枚举、未暴露 JS；内置 tokenizer（simple/raw/whitespace/regex/
  ngram + 欧语词干/停用词/自定义复合词切分）没有 Han 分词。若未来采用，
  接入路径为「双字段模式」（JS 侧 script-run 抽出 Han 段写入专用字段配
  ngram(2) 分析器，Latin 字段用 simple）或给上游提 PreTokenizedString
  JS 面（tantivy-py 有先例）。
- 触发条件（写进演进决策）：文档数持续 >10k（file-level 索引或大库 sync
  落地时），重新评估并按 SkillSearchIndex 抽象加 TantivyBackend，两轮
  benchmark 对拍后切换；届时 MiniSearch 可保留为元数据字段（name/
  description，量小且需要 typo/fuzzy）的轻量层。

## 4. Tokenizer 方案对比（实测）

候选：Intl.Segmenter（Node 内置 full-ICU）、@node-rs/jieba（napi native）、
nodejieba（node-gyp 编译，弃）、segmentit（2019 停更）、jieba-wasm、
自研 Unicode script-run 切分、CJK n-gram。Lindera 系词典要运行时下载，
违反离线约束，直接排除。

实测环境：Node v24.21.0 / ICU 78.3。语料 = 本机 6 个 agent root 经 realpath
去重后的 119 个真实 skill + 11 个合成 skill（覆盖任务书列出的中英混合、
npm scope、URL、http3、typo 主题），45 条人工标注 query（en 20 / mixed 12 /
zh 4 / ident 4 / typo 5），指标 = Recall@5 / Recall@10 / MRR（结果先按 contentHash 折叠再计分）：

```text
variant            R@5    R@10   MRR    en    mixed  zh    ident  typo
substring 基线     0.278  0.278  0.289  0.28  0.17   0.25  1.00   0.00   ← v1 时代的 naive 水平
seg(Intl.Segmenter)0.963  0.993  0.938  1.00  0.86   1.00  1.00   1.00
seg+bigram(过渡版) 0.985  0.993  0.943  1.00  0.94   1.00  1.00   1.00   ← either-side 规则，已废弃
final（终版规则）  0.985  0.993  0.974  1.00  0.94   1.00  1.00   1.00   ← 选定（滑窗 bigram + Latin 切分）
seg+bigram+trigram 0.985  0.993  0.943  （无增益，索引膨胀）
seg+dict           0.963  0.993  0.938  （PoC 词典未参与合并，无增益）
jieba              0.985  0.993  0.943  （R@5/R@10 与终版打平，MRR 落后 3.1 点）
jieba+bigram       0.985  （同上）
jieba cutForSearch 0.985  （同上）
fuzzy 消融：fuzzy=0 → R@5 0.956，typo R@5 0.73；fuzzy=0.2 → 0.985 / 1.00
```

**选型：`Intl.Segmenter + 连续单字滑窗 bigram + 自研 Latin 标识符切分`（终版
规则集，PoC 文件 /tmp/skill-search-poc/tokenizer-final.mjs 是唯一参考实现；
早期 tokenizer-poc.mjs 的「任一侧单字」规则已被取代并弃用），零依赖**。
理由：与 jieba 家族 R@5/R@10 打平且 **MRR 反超**（0.974 vs 0.943），但
jieba 需要 11.3MB 主包（4.8MB 词典）+ 平台 native optional deps +
~150–700ms 冷启动，且 esbuild 必须 external——对一个 CLI 工具是纯成本零收益。
bigram 是承重组件：ICU 词典系统性收不全新词（实测「组件」「管线」「工作流」
「光刻」均被切成单字），「React组件设计」在 seg-only 下只剩
`react,设计`（单字 token 被丢弃），bigram 兜底后得到 `react,组件,设计`。
唯一残留 miss 是「AI Agent Skill 开发」（期望结果在第 4 位，R@5 仍计命中）。

基准方法论（2026-09-17 修订，吸收复核意见）：结果先按 **contentHash 折叠**
（与产品 ranking 的 duplicate fold 语义一致）再计分；早期按 name 去重的
数字会掩盖同名不同 canonical 的重复组。语料为当日 live 快照
（本机 roots 实时刻画，不同时点入口数在 241~244 间浮动），实现阶段把
合成语料 + 标注集固化为仓库资产后，回归门以仓库语料为准，live 模式仅作
可选对照。

## 5. 中文处理方案（SkillTokenizer 的 CJK 部分）

Segmenter 输出词序列后，对**连续 Han 词序列**做 ES cjk_bigram 语义的兜底：

```text
Han run --Intl.Segmenter(zh, word)--> w1..wn
  wn 长度 ≥2              → 原词发射
  连续单字段（≥2 相邻单字）→ 滑窗 bigram（单字本身不发射；跨词 bigram 噪声由 IDF 压制）
  孤立单字                 → unigram 发射（Han token 豁免 Latin 长度过滤）
```

query 与 document 走同一条管线，切分一致性保证 recall；IDF 自动压低高频
bigram 的干扰。词典方案（自动生成 / 用户自定义 / runtime）第一版**不做文件
格式决策**：Tokenizer 接口预留 dictionary 注入位（`Set<string>`），语料
PoC 显示当前词典不带来增益；等真实用户查询日志表明需要时再落
`~/.skill-creator/dictionary` 格式。

ICU 风险与对策：small-icu/system-ICU 构建会静默把中文断词退化为逐字
（nodejs/node#51752）——Tokenizer 构造时跑探针（「组件设计」若切成
单字序列则 Segmenter 不可用），探针失败时整段退化为 pure-bigram 模式，
行为仍正确（bigram 不依赖词典）。ICU 版本漂移由 TOKENIZER_VERSION +
探针自检兜底。

## 6. Skill-specific tokenizer 设计

```text
text
 ↓ NFKC（全角/半角、组合符归一）
 ↓ script-run 切分：Han/日韩连续段 | [A-Za-z0-9:@/._-] 标识符段 | 其它（分隔符）
 ↓ Han 段 → §5 规则
 ↓ 标识符段（保持原大小写进入切分，发射时统一 lowercase）→
     @scope/pkg 或 URL 尾段 owner/repo → scope、name 整词、scope/name、子词
     原子 camel/Pascal 切分（正则分支序：连续大写+lookahead 在前，否则
     `H` 会抢先吞掉 `HTTP` 的首字母）+ 原子 joined 形态
     整段（若多原子）→ 保留 kebab 整词形态
 ↓ 长度过滤：Latin token ≥2（含数字豁免；Han/日韩 token 豁免——孤立单字合法）
```

**冻结期望表**（终版 tokenizer 实测输出逐字记录，实现阶段直接固化为测试
fixture；任何 tokenizer 改动必须先改此表再改代码，两处同步）：

```text
"react-component-design"    → ["react","component","design","react-component-design"]
"@jixoai/jixoai-ui"         → ["jixoai","jixoai-ui","jixoai/jixoai-ui","ui"]
"React组件设计"              → ["react","组件","设计"]
"组件设计"                   → ["组件","设计"]
"如何创建Svelte组件"          → ["如何","创建","svelte","组件"]
"玻璃拟态 毛玻璃效果"         → ["玻璃","拟态","毛","效果"]        ← ICU 切散「毛玻璃」；query/doc 一致性保 recall
"http3 传输层"              → ["http","3","http3","传输","层"]
"工作流管理"                 → ["工作","流","管理"]
"https://github.com/lightonai/bm25x" → ["lightonai","bm25x","lightonai/bm25x","https","github","com","github-com","bm","25"]
"ＲＥＡＣＴ组件（全角）"       → ["react","组件","全角"]           ← NFKC 生效
"タスク管理とスプリント"      → ["タスク","管理","と","スプリント"]  ← kana 在作用域内
"한국어 검색"               → ["한국어","검색"]                  ← hangul 在作用域内
"getBoundsWidth"            → ["get","bounds","width","getboundswidth"]
"ParseHTTPResponse"         → ["parse","http","response","parsehttpresponse"]
"TypeScript类型检查"         → ["type","script","typescript","类型","检查"]
"光刻与渲染管线优化"          → ["光刻","刻与","渲染","管线","线优","优化"]  ← 滑窗跨词噪声（刻与/线优）由 IDF 压制
"SKILL.md 文档"             → ["skill","md","skill-md","文档"]
"react componet design"    → ["react","componet","design"]       ← typo 不在 tokenizer 层处理，交由 fuzzy
"useSyncExternalStore"     → ["use","sync","external","store","usesyncexternalstore"]
"XMLHttpRequest"           → ["xml","http","request","xmlhttprequest"]
```

small-ICU 降级语义：Segmenter 不可用时 `segmentHan` 退化为逐字序列，经同一
emitHanRun 规则（全部相邻单字 → 滑窗 bigram，孤立单字 → unigram）——即
pure-bigram，行为确定且 query/doc 一致，不抛错。CJK 作用域 =
Han + Hiragana + Katakana + Hangul 连续段（长度过滤豁免同范围）。

打磨轮（2026-09-17 终版规则集）修掉的三个实现级陷阱，实现时直接带测试钉死：
URL 冒号必须进标识符字符集（否则 `https://github.com/o/r` 只剩 "https"）；
camelCase 切分必须先于 lowercase（否则大小写边界被抹掉）；
长度过滤必须豁免 Han token（否则孤立单字被误杀）。终版指标
R@5 0.985 / R@10 0.993 / **MRR 0.974**（较首版 +3.1 个点，MRR 领先 jieba 家族）。

## 7. Canonicalization / dedup 设计

```text
provider root × entry（目录或 symlink）
  → statSync（跟进 symlink；broken symlink 静默跳过）
  → 含 SKILL.md/.SKILL.md 才是候选
  → realpathSync = canonicalPath            ← 去重主键
  → group：{ canonicalPath, installations[]（原始入口路径+所属 root） }
  → 解析 SKILL.md → contentHash = sha256(raw bytes)   ← 去重副键（分析用）
```

- **绝对不以 filesystem 入口路径建索引**：本机实测 244 入口 → 119 canonical
  （最多一个 skill 装 5 处）。index 文档 = canonical skill。
- contentHash 不合并文档（保留 source tracking / 未来 merge 分析），
  而是把同 hash 组折叠为搜索结果里的 duplicates 附注（见 §9）。
  本机实测 119 canonical 中有 9 组 ×4 的内容级重复（agents-sdk、cloudflare、
  wrangler 等）——这不是理论场景。
- skill id = `opaquePathId("sk", canonicalDirectory)`，与 `skills.list` 的
  SkillId 完全一致（sk_<24hex>），Agent 拿 id 可以直接走既有 RPC/工具链。

**双文件冲突语义（冻结）**：一个 canonical 目录同时存在 `SKILL.md` 与
`.SKILL.md` 时——内容源取 `SKILL.md`（enabled 优先），`conflict: true`
标记附着在文档上（结果可见）；仅 `.SKILL.md` 在场 → `disabled: true`、
内容源取 `.SKILL.md`；两者皆无 → 不是候选。contentHash 恒等于
「实际被索引的那个文件的原始字节」，`disabled`/`conflict` 不参与 hash。

**frontmatter 容错（冻结）**：Zod schema 对齐 ccski（name/description
min-1 字符串；未知字段在解析层忽略、不注入 SearchDocument——本索引不承担
round-trip 职责，那是 Creator 服务的边界）。schema 校验失败（缺字段/类型错/
无 frontmatter）→ 文档仍入索引：name 回退 directoryName、description 置空、
`invalidFrontmatter: true` 标记（盘上的 skill 不应因元数据损坏而搜不到）。
`keywords`/`triggers` 接受 `string | string[]`（单字符串视为一元数组），
其它 YAML 类型的条目逐项丢弃，不做 `String()` 强转。

**扫描边界（冻结）**：provider root 的直接子入口（目录或 symlink，statSync
跟进；broken symlink 跳过）；真实子目录递归深度 ≤2（覆盖 plugin/nested
布局），**递归不跟进 symlink**（防环、防逃逸——symlink 只在入口层解析）；
跳过 `.` 开头目录与 `node_modules`。roots 只来自 provider catalog
globalPath 解析 + workspace registry 持久态的 server 侧投影，不经过
`WorkspaceRegistry.list()` 的 ccski 动态计数（只读 root seam，防无谓
discovery）。

## 8. SearchDocument schema（src/shared/contracts/search.ts）

```ts
SkillSearchDocument = {
  id: SkillId                    // sk_<24hex>，canonical path digest
  name: string                   // frontmatter name（无效回退目录名）
  description: string            // frontmatter description（无效置空）
  keywords: string[]             // frontmatter keywords（string|string[] 收窄）
  triggers: string[]             // frontmatter triggers（同上）
  headings: string               // body 的 #/##/### 标题拼接（截 30 条）
  body: string                   // markdown-to-search-text（截 12k chars）
  canonicalPath: string          // realpath 真相
  installations: Array<{         // 每个入口绑定 scope（未来 RPC/GUI 直接可用）
    path: string                 // 入口原始绝对路径（Agent 环境视角）
    workspaceId: "~" | `ws_…`    // 该 root 所属 workspace
    providerId: string           // 该 root 的 provider
  }>
  contentHash: string            // 实际被索引文件的 sha256 hex
  disabled: boolean              // 仅 .SKILL.md 在场
  conflict: boolean              // SKILL.md 与 .SKILL.md 并存
  invalidFrontmatter: boolean    // frontmatter 未过 schema
}
```

installations 是「canonical skill → 可安装位置」的完整映射（含 Global `~`
与 Imported ws_* 两个来源域）；`providerIds` 由 installations 派生（运行时
投影，不进持久态与 JSON 合同）。`invalidFrontmatter` 随文档进入 stats 信封
（stat 未变时从持久索引可重放同一投影）。directory-level manifest/revision
（整目录指纹）是后续 duplicate/merge/upgrade 的深化项，本 change 的
contentHash 明确限定为 SKILL.md 文档级哈希。

字段权重（查询期 boost，常量集中定义于 search 模块，不散落 CLI）：

```text
name ×10   description ×6   keywords ×5   triggers ×5   headings ×3   body ×1
```

（任务书建议值；PoC 基准即用此配比达到 0.985。）

## 9. Ranking 设计

```text
query → SkillTokenizer → MiniSearch BM25+（fuzzy 0.2, prefix, field boost）
      → top 40 候选（按 BM25 原始分）
      → 对每个候选计算 rerank 信号（全部定义大小写不敏感、query trim）：
          exactName    = name.toLowerCase() === q        ? 0.9 : 0
          namePrefix   = name.toLowerCase().startsWith(q)? 0.5 : 0
          queryInName  = name.toLowerCase().includes(q)  ? 0.4 : 0
          keywordExact = keywords 任意项 toLowerCase()===q ? 0.3 : 0
          descCoverage = description 中含 query token 的比例（同管线分词）
                         × 0.2
          rerank = exactName + namePrefix + queryInName + keywordExact
                   + descCoverage（上限 1.0）
      → 混合：final = 0.7 × norm(bm25) + 0.3 × rerank，
        norm(s) = s / (s + 8)          ← K=8：实测 BM25 分数量级下软帽归一
      → content-dup 折叠（rerank 之后）：同 contentHash 组内 final 最高者为
        主结果，其余成员进 duplicates（保 id+canonicalPath，按主 tie-break
        同序输出）——折叠置于 rerank 之后保证同组低分成员不抢主位但参与
        top40 竞争；组内 final 相等时按 name asc → canonicalPath asc 选主
        （结果不依赖扫描顺序）
      → 排序 tie-break（冻结，保证 CLI JSON 稳定）：final desc → name asc
        （codepoint 序）→ canonicalPath asc（codepoint 序）
      → top N（默认 10，--limit 可调，上限 50）
```

第一版不引入 v1 式 7 信号全家桶——BM25+ 字段 boost 已把「name 命中 >
description 命中 > body 命中」内化（MiniSearch 逐字段独立评分后加权），
rerank 只保留少量可解释的 skill 语义信号。

## 10. Index 生命周期（Option B-lite：持久索引 + stat 新鲜度）

```text
<appDir>/search-index.json = {
  schemaVersion: 3,                            // 信封结构变更（v3 起文件集 stat + searchConfigDigest）
  tokenizerVersion: "segmenter-bigram-v1",     // 分词行为变更
  parserVersion: "matter-mdset-v2",            // frontmatter/headings/body/额外 md 文件集抽提规则变更
  rankingVersion: "rerank-2026-09-17-v1",      // rerank 公式/权重变更
  engine: { name: "minisearch", version: "7.2.0"（写入运行时解析到的确切包版本,
                                   非通配；版本不符即重建）,
            configDigest: sha256(fields/boost/fuzzy/prefix/processTerm 常量的
                                   JSON 序列化) },
  searchConfigDigest: sha256(生效排除目录名 join("\n")),  // search-config.toml 变更即重建
  payloadDigest: sha256(JSON.stringify({index, stats})),  // 写入时算、加载时重算
  index: <MiniSearch.toJSON()>,
  stats: { [id]: { canonicalPath,
                   files: [{path, mtimeMs, size, ino, ctimeMs}]（身份源 + 额外 md，
                            路径序；v2 顶层四元组已废弃）,
                   installations, contentHash, disabled, conflict,
                   invalidFrontmatter } }
}
```

任一 version/digest 不符 → 全量重建（防「stat 相同但语义已变」的假新鲜）。
payloadDigest（实现期经复核对抗轮固化）：一切不重算摘要的篡改——控制面
元数据（documentCount 等可注入 NaN/乱序）、倒排、投影文本、stats——在加载时
整体失效；威胁模型边界为「持有 app 缓存写权限且重算摘要的 envelope 级伪造」
（无密钥不可约；若未来纳入可写缓存攻击者，需改带密钥认证或每次重读源文件）。
stat 新鲜度键 = 文件集（身份源 + 额外 md，路径序）逐文件
`mtimeMs + size + ino + ctimeMs`（inode/ctime 防保时保长的替换 false negative；
额外 md 的增删改经文件集增删检出）。**错误矩阵（冻结）**：

```text
索引文件不存在                        → 全量重建（静默，正常首跑）
JSON 解析失败 / Zod safeParse 失败 /
MiniSearch loadJSON 抛错               → 按空索引全量重建（不迁移不写回旧内容）
EACCES / EIO / ENOSPC / 原子 rename 失败 → hard error：命令 exit 1、保留原文件、
                                         不降级为空值（对齐 workspace-registry
                                         persistence 的「不兼容 vs IO 故障」边界）
并发写：两个 CLI 同时 freshen         → last-writer-wins（索引是缓存非真相，
                                         对方 stat 校验下次自愈）；v1 不加锁
```

- 正确性优先：stat 不一致即重解析该文件，不做复杂的 cache invalidation；
  信封任一 version/engine configDigest 不符无条件全量重建（继承 v1
  rulesetVersion 的成功经验，抛弃它「命中也全量重读算 hash」的失败设计）。
- 不引入 watcher（Option C）。50k skills 全量重建 ~12.9s（终版 tokenizer；旧 tokenizer 16.9s 为历史
  对照）的场景由增量路径覆盖（改动 doc 级 <1ms）；真实规模（≤1k）全量
  重建 ~0.25s。
- 索引文件经 atomicWriteUtf8 落盘（0600），加载走 safeParse，失败按空索引
  处理（不迁移不写回），遵循仓库无兼容策略。
- MiniSearch 7 细节：`discard(id)` 接受 **id 字符串**（v6 起不再接受文档
  对象）；auto-vacuum 默认条件即可，脏度过高时直接全量重建兜底。

## 11. Benchmark 结果（PoC，2026-09-17 本机实测）

质量基准见 §4 表。性能基准（MiniSearch 7.2 + **终版 tokenizer**，语料为
混合中英、含 camelCase/npm scope/typo 的合成 skill 形态文档；darwin-arm64
/ Node v24.21.0 / --expose-gc；三次采样（两轮自测 + 评审独立复跑），构建与
体积稳定，搜索延迟 p50 波动可达 ~15%（JIT/负载敏感，取中位数与范围，不作
验收常数)）：

```text
规模      构建            索引 JSON   heapΔ      搜索 p50/p95       单文档增量更新
1,000    235–246ms       1.0MB       9–13MB     0.5 / 2.9ms        0.47–0.48ms
10,000   2.45–2.46s      10.5MB      103MB      4.7 / 18–20ms      0.39–0.40ms
50,000   12.5–12.9s     57.2MB      430MB      34–39 / 140–163ms  0.45–0.50ms
真实 119  35–47ms 扫描+解析 + 82–84ms 建索引     0.4 / 1.1–1.2ms
```

（早期以废弃的 either-side PoC tokenizer 测得的 387ms/3.3s/16.9s 与
63.6MB JSON 仅作历史对照，不作为实现证据。）结论：任务书第 23 节的性能目标
（1k/10k/50k 本地运行、快速启动、低延迟、可接受内存）全档达成；真实规模亚秒级；50k 属极限压测，增量路径使其可接受。

**实现版 receipt（2026-09-17，scripts/search-perf.sh.ts，生产引擎配置）**：
bun 1.4.1：1k build 319ms / json 1.4MB / heap 10MB / p50·p95 0.7·2.9ms；
10k 3.6s / 14.5MB / 90MB / 6.2·17.8ms；50k 18.3s / 77.4MB / 356MB /
30.0·98.6ms；单文档增量 ~0.5ms；node v24.21.0 同体积（50k 搜索 p50·p95
79·316ms，JIT 路径差异）。JSON 体积大于 PoC 因 storeFields 携带完整结果
投影（body/headings 只索引不存储）。质量回归（test/skill-search-benchmark.
test.ts，冻结 ranking 全链路 + 磁盘加载重放）：R@5=0.993（地板 0.95）/
typo R@5=1.00 / MRR=0.959（地板 0.95）/ 两次运行输出逐字节相等。

## 12. 最终技术选型

```text
引擎    MiniSearch 7.2（BM25+，dependencies + esbuild external，经抽象注入）
分词    SkillTokenizer：NFKC + Intl.Segmenter(zh) + 连续单字滑窗 bigram + 自研 Latin 切分
身份    canonicalPath realpath 去重 + sha256 contentHash + sk_<24hex> 稳定 id
排序    BM25+ 字段 boost → top40 → rerank（冻结公式）→ content-dup 折叠 → tie-break → top N
生命周期 持久索引 + stat 新鲜度 + 版本强制重建；无 watcher；无向量
落位    src/daemon/skill-search/（domain module）+ src/shared/contracts/search.ts
CLI     skill-creator search <query> [--json] [--limit N]（进程内，无需 daemon）
```

不选 bm25x（无 JS 入口）、不选 jieba native（质量打平但 +14MB/冷启动/分发面）、
不选 SQLite FTS5（tokenizer 无 hook，RC 档）、不选 flexsearch（非 BM25、无字段
boost）、不选 Tantivy/lucivy/better-sqlite3（native 不可 bundle）、不做
vector/embedding（任务书明确排除，架构留 SemanticSearch 扩展位）。

## 13. 已知限制

1. BM25 无语义泛化：「组件怎么写」搜不到只说 component 的英文 skill
   （除非 body 含中文）；这是 lexical 的边界，靠未来 semantic backend 补。
2. 单汉字查询在 bigram 规则下仅命中 unigram 形态（孤立单字）——单字查询
   本身语义弱，可接受。
3. body 截断 12k chars：超长 SKILL.md 的尾部不参与索引（截断阈值可配）。
4. Intl.Segmenter 依赖 Node full-ICU（官方构建默认满足）；small-icu 环境
   探针降级为 pure-bigram，质量略降但行为正确。
5. contentHash 基于原始字节：仅换行差异的同内容 skill 不判重（wild 实例
   均为字节级拷贝，风险低）。
6. disabled（.SKILL.md）skill 仍入索引（带 disabled 标记）——它们在盘上
   存在，未来 merge/upgrade 分析需要完整视图。
7. 搜索质量基准的标注集（45 query）规模有限，是回归地板不是天花板。

## 14. 后续扩展

```text
LexicalSearch（本 change）→ rpc skills.search（daemon 域过程，GUI Queue/$ 引用升级）
                          → MCP search capability（readonly authority class）
                          → SemanticSearch backend（接口已抽象：tokenize/search 可替换）
                          → HybridSearch（lexical + semantic 融合）
                          → TantivyBackend（触发条件与接入路径见 §3.1：docs >10k 时）
                          → duplicate analysis / merge / upgrade / sync
                            （canonicalPath + contentHash + installations 数据已备）
```

内核与 GUI 内化路径：`createSkillSearchService()` 是纯 domain module，
daemon rpc-router 加 `skills.search` 过程 + webui ProviderView 的 `q`
参数改走后端搜索，即可让 composer `$` 引用、Workspaces 过滤等全部消费
同一索引——本 change 的接口按此消费方设计，不在本 change 实施。

## 15. Tantivy 落地验证与架构定型（2026-09-21，jixoai-search-core D1/D2）

Owner 裁决提前触发 §3.1 的 Tantivy 评估（内存红线取代 >10k 文档触发条件）。
两个前置验证门结论：

### D1 冒烟（PASS；/tmp/tantivy-smoke/，脚本与 benchmark-result.json 留存）

「JS 冻结分词 → 空格 join → tantivy `whitespace` tokenizer 字段」注入路径可用。
两条架构路线的 45 条标注 query 对拍（语料复刻等价性已证：主仓真管线跑复刻
语料与 vitest oracle 逐位一致）：

| 路线                                | R@5   | MRR   | typo R@5 | 判定                |
| ----------------------------------- | ----- | ----- | -------- | ------------------- |
| 冻结地板                            | 0.95  | 0.95  | 1.00     | —                   |
| oracle（MiniSearch 现役）           | 0.993 | 0.959 | 1.00     | 基准                |
| tantivy 召回 + JS 冻结打分 + rerank | 0.993 | 0.959 | 1.00     | **逐位复原，采用**  |
| tantivy 原生 BM25 + rerank          | 0.978 | 0.963 | 0.93     | typo 差 1 hit，弃用 |

**定型（tasks 1.3）**：`@jixoai/search` 默认后端 = tantivy，架构 =「后端只做
倒排召回与持久化，BM25 变体打分在 JS 共享层」——打分常量冻结自 MiniSearch
实测算术（k1=1.2 / b=0.7 / **底分 d=0.5**；fuzzy/prefix 折扣 0.45/0.375，
prefix 前缀扩展按 L/(L+0.3d) 衰减；fuzzy 距离 = min(6, round(len×0.2))；多
token OR 乘数行为 score(doc) = 命中数 × Σ 单 token 贡献）。sqlite(FTS5)
回落后端共享同一 JS 打分层（两后端仅召回实现不同，语义测试逐位一致）。
纯引擎路线的差距根因：binding 不暴露 BM25 参数，d=0.5 底分与乘数分布无法
从引擎侧对齐，且降地板等于基准回退，违反迁移门禁。

**Phase 1 冻结规则补订（2026-09-21，codex 复核处置）**：

- **长词 fuzzy 距离 canonical（P1-2）**：min(6, round(len×0.2)) 给出的距离
  3-6 是 MiniSearch 7.2 的实测真实行为（对照实验 /tmp/jixoai-fuzzy-canonical.mjs
  留存：len16 距离 3、len15 距离 3、len20 距离 4、len30 距离 6 均命中；距离
  6>3（len16）与 7>6（len30）不命中；**且不按长度差钳 2**——len16→len13
  删除与 len16→len19 插入的距离 3 变体均命中）。D1 冒烟脚本 levenshtein 助手
  的 |m−n|>2 早退（固定返回 99）是其自身简化，非 MiniSearch 行为；包实现
  （早退阈值 = maxDistance）以实测为准，冻结不回退，scoringDigest 不变。
- **CJK 跳过 fuzzy（P2-3，已有实现行为的文档化）**：query token 含 Han/
  Hiragana/Katakana/Hangul 任一 script 时跳过 fuzzy 变体展开（exact/prefix
  不受影响）。中文经 Segmenter 词典词 + 滑窗 bigram 召回，逐码点编辑距离对
  CJK 的语义贡献低而误召回高；此规则属冻结口径的一部分，非已知偏差。
- **包级信封错误三态与重建收紧（P1-1）**：`@jixoai/search` 信封读取区分
  missing（ENOENT → 正常新建）/ invalid（文件存在但 JSON/Zod 失败 → 重建）/
  其余 fs 异常（EACCES/EIO/… → typed SEARCH_IO hard error，目录零改动）；
  重建删除前审计目录内容——仅信封产物（envelope.json/.tmp）+ 信封声明
  backend 的已知产物（sqlite：index.sqlite3[-journal/-wal/-shm]；tantivy：
  meta.json/.managed.json/两个 lock/段文件/合并临时文件）+ OS 元数据噪音
  （.DS_Store/Thumbs.db）可删，未知内容 SEARCH_IO 拒删且消息列名。这是
  §10 错误矩阵「IO 故障保留原文件、不降级为空值」在包层的落地。

观测（89 合成文档）：建索引 ~510ms；磁盘索引 89 KiB；查询 ~1ms；进程
RSS +37MiB（native 库常驻 + mmap，对比 MiniSearch 10k 文档 103MB 纯堆，
文档数增长时差距继续拉大）。

### D2 供应链（PASS 有条件；/tmp/tantivy-d2/）

0.3.3（2026-08-23 发布，年龄 29 天）：13/13 平台子包 registry 存在、os/cpu
一致；四主力平台 tarball 实测下载，sha512 与 integrity 重算一致，.node 二
进制 file 识别正确；发布链含 SLSA provenance + 签名。风险登记：solo 维护
（bus factor 1）、周下载 108——由 sqlite 回落策略对冲。

**白名单决策：暂不登记** `minimumReleaseAgeExclude`。事实：主仓未配置
`minimumReleaseAge`（门禁关闭，grep 全仓 + `pnpm config get` 均空；D2 纠正
了「19 条」的误记——现有 exclude 174 条）；且 0.3.3 于 2026-09-22T13:43Z
满 30 天，早于任何可能的门禁启用时点。触发条件：未来开启门禁（≤30 天档）
且升级到发布不足 30 天的新版本时，按 opentray 段样式登记主包 + 13 平台
子包（草案 14 条见 /tmp/tantivy-d2/report.md §5）。

### binding 实现注意事项（自 D1 实测，喂给包实现）

static 方法宿主是 `TokenizerStatic`（非 .d.ts 字面）；`fuzzyTermQuery`
distance 上限 2；`regexQuery` 拒绝可空算子（不能当 prefix 用）；
`termSetQuery` 常数分无 BM25 权重（前缀扩展须逐 term `termQuery`）；
`Index` 要求目录已存在；`garbageCollectFiles` 是 no-op（增量删除的膨胀
风险由信封重建兜底）。

## 16. Phase 2 迁移记录：skill-search 消费 @jixoai/search，MiniSearch 退役（2026-09-21）

### 引擎替换与两层信封

`src/daemon/skill-search/index.ts` 的 MiniSearch 三层封装（createSearchMiniSearch /
searchMiniSearchInstance / MiniSearchSkillSearchIndex）替换为 `@jixoai/search`
消费；根 package.json 移除 minisearch 依赖。ranking v2（池前折叠 + rerank +
tie-break）、watcher、canonicalize、scanner、parser、config 的语义全部冻结未动。

```text
<appDir>/search/                       ← searchHome（检索自有子目录）
├── index/                             ← @jixoai/search 目录（包信封 envelope.json 自管）
└── meta.json                          ← skill-search 登记表（skill-search 自有状态）
    { schemaVersion: 4,
      configDigest,                    ← sha256({引擎名/字段权重/fuzzy/prefix/RANKING/
      │                                   PARSER/双侧 TOKENIZER/SCORING_CONSTANTS/backend/
      │                                   searchConfigDigest})——旧 ENGINE_CONFIG_DIGEST 与
      │                                   searchConfigDigest 两摘要的合并
      payloadDigest,                   ← sha256(JSON.stringify(documents))
      documents: id → { canonicalPath, files[stat 四元组], installations,
                        contentHash, disabled, conflict, invalidFrontmatter, name } }
```

旧 `search-index.json`（v3）不再读取——在场即等价空重建（与 safeParse 失败
同语义）。文档映射：name/description/keywords/triggers/headings/body → 包
fields（数组字段 join(" ")）；name/description/keywords/canonicalPath/
installations/contentHash/disabled/conflict/invalidFrontmatter → stored（命中
还原 RankingCandidate 所需的完整投影，JSON safeParse 收窄读回）。duplicates()
与 documentCount() 是登记表纯内存投影（不依赖包枚举 API，保持同步——watcher
维护门零改动）。引擎候选窗口 = 包 limit 上限 100（≥ TOP_CANDIDATES 40，为
池前折叠留副本余量；折叠仍在 rankResults 内做）。REBUILD_DISCARD_RATIO=0.2
语义保留：超阈值 close + 删 index 目录与 meta + 重新 openIndex 灌全量。

### backend 默认偏离决策 #6 的实证（tantivy 目录锁）

决策 #6 原定默认走包默认（tantivy）；实测（/tmp/tantivy-lock-probe.mts 留存）
同目录第二个 writer 持锁失败——而 skill-search 的既定持有者是多进程并发的：
常驻 daemon + `skill-creator search` CLI（AGENTS.md：不要求 daemon）+ stdio
MCP 形态。tantivy 默认会让「daemon 运行时终端跑 CLI search」直接 typed 失败，
属产品回归。故 **daemon 侧默认 sqlite**（事务级文件锁，串行多持有者安全）；
`SKILL_CREATOR_SEARCH_BACKEND=tantivy|sqlite` 为显式覆盖（单持有者高语料
部署/CI 无 binary 环境各自取用；非法取值回落默认）。backend 名进 configDigest，
切换 backend = 摘要不符 = 全量重建，与包信封的 backend 重建语义对齐。

### 引擎金丝雀（包静默重建的消费方防线）

包信封缺失/不匹配时 openIndex 会静默删除重建空索引——登记表完好而引擎空，
搜索会永久静默空结果。消费侧防线：加载时以登记表首个名字可分词的条目做
金丝雀探针（引擎 search(name) 的 total 必须 > 0），失败按 corrupt 全量重建
（test/skill-search-index.test.ts「silently wiped」用例钉死）。configDigest
额外纳入包 TOKENIZER_VERSION 与 SCORING_CONSTANTS，使包侧口径漂移也走显式
重建而非静默清空。

### 异步化与并发语义

包 API 全 async：SkillSearchIndex 的 freshen/search 转 Promise，service.ts
微量适配（maintain/ensureMaintained async 化，编排路径不变；watcher 回调契约
语义冻结——onFlush 同步返回后失败态由 service 侧 flushFailed 标记接管，下次
search 重走完整路径自愈；索引实例内部操作链串行化 + 登记表原子交换，同步
读者（duplicates/documentCount/watcher 维护门）不见半更新状态）。RPC/CLI/
WebUI 契约零改动（service.search/duplicates 本就是 async）。「upsert 已提交
而 meta 落盘失败」的分裂由下一轮 freshen 的 stat diff 幂等收敛（同 id upsert
覆盖、remove 缺席幂等）。

### 指标结论（迁移门禁）

- **质量（test/skill-search-benchmark.test.ts，消费方真实门禁）**：
  R@5=0.993 / R@10=0.993 / MRR=0.959 / typo R@5=1.00——与 §11 实现版 receipt
  （MiniSearch 现役：R@5=0.993 / typo=1.00 / MRR=0.959）**逐位持平，零回退**；
  新进程视角逐字节重放、contentHash 折叠端到端用例均过。
- **性能（scripts/search-perf.sh.ts，node v26.3.0 / darwin-arm64，单轮采样）**：
  sqlite：1k build 322ms / p50·p95 12.3·30.0ms；10k 3.1s / 155·266ms；
  50k 16.6s / 1404·8118ms（磁盘 135.7MB）。tantivy：1k 461ms / 19.6·38.6ms；
  10k 2.7s / 238·353ms；50k 13.9s / 2082·10489ms（磁盘 59.2MB）。对比
  MiniSearch（§11：1k p50 0.7ms / 50k 34ms）：单查询延迟上升一个量级——
  包冻结口径为逐 query 全量装载词表 + JS 层重打分（与 sqlite 后端同口径的
  已声明妥协，词表分桶属包侧后续优化）；真实语料规模（119–130 文档）下
  检索全链路（含 ranking）仍在 ~14ms/query 量级（benchmark 45 query 645ms），
  产品体验无感。内存面显著改善（sqlite heapΔ 1k 仅 2MB vs MiniSearch 10MB；
  tantivy 常驻 native mmap）。

## 17. Windows 实机验证（2026-09-22，wiki-directory-standard P4.2）

主机 `gaubeehonor`（Windows、Node v26.3.1、git 2.53）：工作树经 `git archive | ssh tar`
直传（GitHub 私有凭证不涉），`npx pnpm@12.3.4` 安装（宿主 Volta/独立 pnpm shim 均损坏）。

结论：

- **包测试 165/165**（packages/search + packages/skill-wiki）：tantivy win32-x64-msvc
  binding 正常工作，两后端行为与 macOS 一致。
- **CLI 冒烟**：skill-wiki CLI 绝对路径 workspace / `~`（SKILL_WIKI_HOME）/ find BM25
  / `WIKI_INVALID_SCOPE` exit 3 全部符合预期。
- **发现并修复（三类）**：
  1. `PersistentSkillSearchIndex` 缺公开 close 面——daemon 停机与测试都无法释放
     sqlite 引擎句柄，Windows 上任何后续目录删除 EPERM（macOS 对打开句柄的
     unlink 宽容掩盖了这一点）。探针实证：`node:sqlite` close 本身是确定性
     释放（含未 finalize 的 prepared statement 引用与 WAL）。修复：接口加
     `close()`（enqueue 串行）+ `service.dispose()` 同关引擎。
  2. 双实例 rebuild 的进程边界：后继实例 rebuild rm 目录时，同进程内仍存活的
     前身实例持有 sqlite 句柄 → EPERM（`maxRetries` 重试无效——持久句柄非
     AV 瞬时锁）。真实进程模型里「下一次 CLI 进程」意味着前身已退出；8 个
     多实例用例改为创建后继前显式 `await 前身.close()`。
  3. `fs.chmodSync(dir, 0o500)` 失败注入在 Windows 无效（mode 位不映射 ACL，
     注入静默失效、断言假红）——service 时序用例改用「meta.json 换同名目录」
     的跨平台注入（原子 rename 落盘 POSIX EISDIR / Windows EPERM）。
- **防御性加固**：产品 rebuild、包信封重建与测试沙箱的 `rmSync` 统一
  `maxRetries: 10, retryDelay: 100`（Node 对 EPERM/EBUSY/ENOTEMPTY 线性退避
  重试，吸收 Defender/搜索索引器对刚写入文件的瞬时锁）。
- **验证后状态**：skill-search index+service 焦点 22/22（修复前 20 失败），
  其余 skill-search/wiki 焦点文件首轮即全绿。
- **全量套件（补充证据）**：1233 过 / 74 失败 / 6 跳过。其中 search 辖区
  11 个失败（rpc-search 2 / search-robustness 6 / benchmark 3）均为同族
  「domain/service 持引擎句柄未 dispose」——已修复（域/服务创建登记 +
  afterEach dispose + rm 重试），Windows 复验全绿。其余 63 个失败为
  **既有 Windows 债，非本 change 引入**，待后续独立 change 处理：
  skill-steward-runtime 39、r8-independent-probes 8、webui
  composer-submission 8 / agent-busy-enter 3 / model-settings-b1 1、
  skill-creator-mcp 2、repository-service 2、dsh-settings 2、dsh-kernel 1、
  cli-lifecycle 1。
