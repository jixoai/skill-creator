# @jixoai-search Specification

## Purpose
TBD - created by archiving change jixoai-search-core. Update Purpose after archive.

## Requirements

### Requirement: 通用索引/搜索 API（零引擎泄漏）

`@jixoai/search` 的公共面 SHALL 只包含领域语义：`openIndex({ directory,
fields, backend })`、`upsert(docs)`（同 id 覆盖的幂等写入）、`remove(ids)`、
`search(query, { limit, offset })`（MiniSearch 惯例：位置参数 query 字符串 +
可选 options）返回 `{ hits: [{ id, score, stored }],
total }`、`close()`。全部方法 SHALL 为 async。引擎特定类型（tantivy
schema/query/builder、SQLite 语句）MUST NOT 出现在公共导出、参数或返回
类型中。

#### Scenario: 调用方只见领域语义

- **WHEN** 使用方 import `@jixoai/search`
- **THEN** 可见的类型只有文档（`{ id, fields, stored? }`）、命中
  （`{ id, score, stored }`）、字段声明（`{ weight }`）、后端选项
  （`"tantivy" | "sqlite"` 字符串）与错误类型
- **AND** 不存在任何需要先构造引擎对象/schema 才能建索引的路径

#### Scenario: 同 id upsert 幂等覆盖

- **WHEN** 同一 `id` 的文档被 `upsert` 两次（第二次字段内容不同）
- **THEN** 索引中该 id 只有一份，`search` 命中的内容为第二次的版本

#### Scenario: 分页与总数

- **WHEN** `search(query, { limit, offset })` 的结果超过单页
- **THEN** 返回的 `total` 反映去重后的命中总数，翻页由 `offset` 递进，
  排序稳定可重放

### Requirement: 冻结分词口径内置且唯一

分词 SHALL 由包内冻结 tokenizer（NFKC + Intl.Segmenter(zh) + 连续单字
滑窗 bigram + Latin 标识符切分）统一执行；调用方 SHALL 提供原文而非预分词
token。`TOKENIZER_VERSION` SHALL 随包版本化，口径变化 MUST 递增。

#### Scenario: 中英混合查询与文档同口径

- **WHEN** 文档字段与查询串包含中文、camelCase 标识符与 npm scope
- **THEN** 两侧经同一管线分词，检索行为与冻结期望表逐字一致

### Requirement: 后端可替换（tantivy 默认，sqlite 回落）

`backend: "tantivy"` SHALL 为默认后端：JS 冻结分词 → 空格 join → tantivy
`whitespace` tokenizer 字段；索引持久于 `directory` 指定的磁盘目录
（mmap），`close()` MUST 释放目录锁（waitMergingThreads 封装）。
`backend: "sqlite"`（node:sqlite FTS5）SHALL 提供同一 API 的零原生依赖
回落。两后端 SHALL 通过同一组语义测试（含中文对拍语料）。

#### Scenario: 切换后端不改调用方

- **WHEN** 同一段调用方代码在 `"tantivy"` 与 `"sqlite"` 两个 backend 下运行
- **THEN** 公共 API 调用序列完全相同，语义测试结果一致（分数分布差异
  允许，命中集合与排序语义由对拍基准守护）

#### Scenario: 同步阻塞不泄漏到调用方

- **WHEN** tantivy 后端执行索引写入或查询
- **THEN** 公共 API 仍为 Promise 语义（首版允许进程内同步完成，但接口
  形状不得暴露同步性，为 worker 化留位）

### Requirement: 索引信封版本化与自动重建

索引目录 SHALL 携带信封（backend 标识 + tokenizerVersion + 字段 schema
指纹）。`openIndex` 发现信封不匹配（缺失/损坏/指纹不符）且目录内容全部
属于索引已知产物时 MUST 丢弃旧索引并以空索引重建，MUST NOT 读取不兼容
结构。信封读取遇到 IO 故障（EACCES/EIO/…）或目录含未知非索引内容时
MUST 以 typed `SEARCH_IO` hard error 拒绝并保留原文件，MUST NOT 降级为
空索引重建（对齐 docs/search-design.md §10 错误矩阵）。

#### Scenario: tokenizer 升级后旧索引自动重建

- **WHEN** `TOKENIZER_VERSION` 递增后打开既有索引目录
- **THEN** `openIndex` 成功返回空索引（调用方重新灌数据），无异常

#### Scenario: 目录混入未知内容时拒绝重建

- **WHEN** 信封不匹配的目录中存在非索引产物文件（如用户数据）
- **THEN** `openIndex` 抛 typed `SEARCH_IO` 且消息列出未知文件，目录字节
  原样保留

#### Scenario: 信封读取 IO 故障不伪装成重建

- **WHEN** 信封读取因权限或磁盘 IO 异常失败
- **THEN** `openIndex` 抛 typed `SEARCH_IO`，目录零改动

### Requirement: 前置验证门（D1 冒烟 + D2 供应链）

实现任务 SHALL 先通过 D1（npm 装机 + 平台二进制核验 + whitespace 注入
路径验证 + 45 条标注 query 中文对拍，指标不低于现行基准）与 D2
（minimumReleaseAge 白名单 + macOS arm64/x64、Linux、Windows 安装矩阵）
才进入消费方集成；任一门失败 SHALL 触发全局回落 FTS5 并将 Tantivy 记为
阻塞项。

#### Scenario: 冒烟失败回落

- **WHEN** D1 的中文对拍指标低于现行基准或平台二进制缺失
- **THEN** 默认 backend 变更为 `"sqlite"`，Tantivy 依赖不进入默认安装面，
  阻塞原因记录于本 change
