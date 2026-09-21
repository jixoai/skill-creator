# Tasks

## Phase 1 — @jixoai/search 包地基（含验证门）

- [x] 1.1 D1 冒烟：临时目录安装 @oxdev03/node-tantivy-binding，核验
      macOS arm64 平台二进制；whitespace 注入路径验证（JS 冻结分词 →
      空格 join → whitespace 字段）；45 条标注 query 中文对拍
      （指标不低于 docs/search-design.md §4 现行基准）；结论落
      docs/search-design.md 补记
- [x] 1.2 D2 供应链：minimumReleaseAge 白名单登记；macOS arm64/x64、
      Linux、Windows 安装矩阵核验；失败项记录
- [x] 1.3 两门全过 → backend 默认分层定稿（终审 P1-3 同步）：包级默认
      tantivy（spec 不变）；daemon/CLI 消费方默认 sqlite（tantivy 目录锁
      单写者 vs 多进程持有者，探针见 docs/search-design.md §16）；
      SKILL_CREATOR_SEARCH_BACKEND=tantivy|sqlite 覆盖。「任一门失败 →
      全局切 sqlite」的回落分支未触发
- [x] 1.4 packages/search 包骨架（@jixoai/search、private、src 直出）+ workspace/tsconfig/vitest 接线
- [x] 1.5 冻结 tokenizer 下沉（从 src/daemon/skill-search/tokenizer.ts
      迁入包内，TOKENIZER_VERSION 延续；daemon 侧 re-export 过渡）+ 冻结期望表平移
- [x] 1.6 通用 API 契约层：文档/命中/字段声明类型 + openIndex/upsert/
      remove/search/close 全 async 签名
- [x] 1.7 sqlite 后端（node:sqlite FTS5，预分词 token 入库）
- [x] 1.8 tantivy 后端（whitespace 注入 + 目录锁生命周期封装）
- [x] 1.9 信封版本化 + 不匹配自动重建
- [x] 1.10 包级单测：幂等 upsert/分页/两后端同一组语义测试/中文对拍
      语料复用/信封重建

## Phase 2 — skill-search 迁移（MiniSearch 退役）

- [x] 2.1 src/daemon/skill-search 改造为 @jixoai/search 消费方
      （ranking v2 / 持久信封 / watcher / rootsKey 缓存语义不变）
- [x] 2.2 对拍基准作迁移门禁（现网指标不回退）+ 根 package.json
      移除 minisearch 依赖
- [x] 2.3 全量回归（skill-search 现有测试全绿）

## Phase 3 — skill-wiki 松绑 + CLI

- [x] 3.1 parseWikiScope 放宽为 npm-scope 式 slug（破坏性，含测试更新）+ 宿主 workspaceId → slug 映射层（wiki-service 适配）
- [x] 3.2 root 统一 ~/.skill-wiki/ + SKILL_WIKI_HOME env + 宿主 symlink
      衔接 + 存量目录一次性迁移
- [x] 3.3 CLI 骨架：命令路由 / --json / exit code 映射 / root 解析链
- [x] 3.4 list（分页/排序/--json 元数据）、show、log、impact
- [x] 3.5 add（stdin 正文 + hash 幂等 + 写入后自动相似警告 +
      --no-similarity）+ find（写入前主动查）
- [x] 3.6 edit（-f edits.json patch 批量）+ remove（删页 + log 足迹）
- [x] 3.7 index.md 派生物移交 search 侧维护（读命令自动刷新；命令面
      无 reindex）
- [x] 3.8 CLI 级测试（幂等/警告/原子失败/exit code/分页）+ wiki-service
      RPC 回归

## Phase 4 — 门禁与复核

- [x] 4.1 门禁全绿（test/typecheck/webui check/build/fmt/pack）+
      冒烟记录归档 docs/
- [ ] 4.2 codex 复核（herdr 异步回调）+ 处置
