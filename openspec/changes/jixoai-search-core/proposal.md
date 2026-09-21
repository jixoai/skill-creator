# Proposal: jixoai-search-core — @jixoai/search 通用检索内核 + skill-wiki 语义松绑与 CLI 地基

## Why

Owner 三轮裁决（2026-09-21）收敛出一个一致方向：

1. **内存红线**：MiniSearch 全内存驻留与「不浪费内存」的 Owner 立场根本冲突，
   该退役。`docs/search-design.md`（2026-09-17）本就把
   `@oxdev03/node-tantivy-binding` 指定为规模化后备——Owner 裁决提前触发。
2. **Tantivy 定向后不泄漏引擎**：通用 API 提供索引/搜索能力，tantivy 的
   schema builder / Query 代数 / 同步阻塞全部关在实现层；solo 维护风险由
   「后端可替换」兜住，冒烟不过回落 `node:sqlite` FTS5（Node 24 内置）。
3. **org 级命名**：检索是 jixoai 通用能力（skill 检索与 wiki 查重只是前两个
   消费方），包名 `@jixoai/search`，不锁死在 skill-creator 产品名下。
4. **skill-wiki CLI 与查重的前置**：AI 写入前 find / 写入后自动相似警告 /
   edit+remove 纠偏闭环，依赖本包；scope 单词串（token 经济性）、root 统一、
   list 分页同批松绑，为切片③（LLM 编排，工具参数即 scope 名）铺平。

## What Changes

### A. 新包 `@jixoai/search`（packages/search，孵化 private）

- **通用文档/查询 API**（全 async）：`openIndex({ directory, fields+weight,
backend })` → `upsert / remove / search(query, {limit, offset}) / close`
  （search 为 MiniSearch 惯例的位置参数 query + 可选 options）；
  文档 = `{ id, fields, stored? }`（stored 回传不打分）；命中 = `{ id, score,
stored }` + `total`。公共面零引擎概念泄漏。
- **冻结分词内置**：NFKC + Intl.Segmenter(zh) + bigram 滑窗 + Latin 标识符
  切分从 src/daemon/skill-search/tokenizer.ts 下沉，`TOKENIZER_VERSION`
  续命；调用方送原文，口径唯一。
- **Tantivy 后端**：JS 冻结分词 → 空格 join → tantivy `whitespace`
  tokenizer 字段（绕开 PreTokenizedString 未暴露 JS 的缺口；打分即发生在
  我方 token 上）。目录 mmap 磁盘索引；`waitMergingThreads` 生命周期由包
  封装。
- **sqlite 后端**（FTS5，node:sqlite 内置）：回落与轻量测试后端，同一 API。
- **信封版本化**：索引目录携带 backend + tokenizerVersion + schema 指纹，
  不匹配自动重建（沿 skill-search v3 信封哲学）。
- **前置验证门（先于一切实现）**：
  - D1 冒烟：npm 装机 + 平台二进制核验 + whitespace 注入路径 + 中文查询
    对拍（复用 docs/search-design.md §4 的 45 条标注 query + Recall/MRR 框架，
    阈值不降）；不过 → 全局回落 FTS5，Tantivy 记为阻塞待上游。
  - D2 供应链：minimumReleaseAge 白名单登记 + macOS(arm64/x64)/Linux/
    Windows 安装矩阵；主仓 17 包白名单流程复用。

### B. skill-search 迁移（还债）

- src/daemon/skill-search 改为消费 @jixoai/search（tantivy 后端），
  MiniSearch 依赖移除；冻结 rerank/ranking v2/持久信封语义不变，
  对拍基准作迁移门禁；watcher/rootsKey 缓存等宿主编排保留。

### C. skill-wiki 松绑 + CLI 命令面（消费 A）

- **scope 单词串**：`parseWikiScope` 从 `~ | ws_<24hex>` 放宽为
  `~ | <npm-scope 式 slug>`（1-3+ 单词，小写+连字符）；宿主侧
  workspaceId → slug 映射层（digest 仍为内部 id）。
- **root 统一** `~/.skill-wiki/`；skill-creator 宿主以 symlink
  `~/.skill-creator/wiki` 衔接（存量侧车目录一次性迁移）。
- **查重管线**：`find <query>`（写入前主动查）；`add` 默认写入后自动相似
  检索，近亲以 warning 附带输出（`--json` 结构化字段，exit 仍 0），
  `--no-similarity` 跳过。
- **命令面定稿**：`list`（offset=0/limit=100 分页 + `--sort name|updated` +
  `--json` 带 total/nextOffset）/ `show` / `add` / `edit`（patch，-f
  edits.json）/ `remove`（删页 + log 足迹）/ `find` / `log` / `impact`；
  exit code 映射错误三码。
- **index.md 归属 search**：一切派生物（index.md 目录页、查重索引）由
  @jixoai/search/宿主编排维护；`reindex` 从 skill-wiki 命令面消失。

## Impact

- 新增 `packages/search`（@jixoai/search）；根 package.json devDependencies
  接入；tsconfig/vitest/build 接线（原生 binding 走 external+prebuilds，不进
  bundle）。
- `src/daemon/skill-search/*`：index/tokenizer 消费方替换（tokenizer 源迁至
  包内后 daemon 侧 re-export 过渡）；测试基准平移。
- `packages/skill-wiki`：parseWikiScope 破坏性放宽（private 窗口期）+
  root 常量；CLI bin（`skill-wiki`）随包私有，发版时启用。
- `src/daemon/wiki-service.ts`：rootDir/scope 映射适配；RPC 契约不变形。
- 出界：切片③ LLM 编排、语义（向量）检索、skill-wiki 发版与
  README-zh、tantivy 上游协作（PreTokenizedString JS 面提案）。
