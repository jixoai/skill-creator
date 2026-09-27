# Proposal: windows-orpc-lockfile-wiki-index-lifecycle

## Why

Windows 实机全量基线 16 failed / 1504 passed（2.3.0 功能未经 Windows 实机，
node_modules 停在 9/25 上一轮）。按失败族归因实证为**两个系统性根因**，
macOS 全绿均为 POSIX 宽容的假象：

1. **lockfile 不自洽（供应链面，任意平台全新安装都会炸）**：root importer
   的 `@orpc/client` 解析为无 peer 后缀变体 `1.14.6`，而 `snapshots:` 段只
   存在 `1.14.6(@opentelemetry/api@1.9.1)` 快照——pnpm 物化器不建无后缀
   store 目录，链接器仍写 `node_modules/@orpc/client → .pnpm/@orpc+client@1.14.6`
   （悬空）。macOS 绿是旧 node_modules 遗留目录遮蔽；本机 9/28 `pnpm exec`
   触发 auto-rebuild 后显形为 16 失败（wiki CLI 9 + distill CLI 7，全部
   `Cannot find package '@orpc/client'`）。`pnpm install --fix-lockfile`
   一行修复（root 条目对齐带后缀变体，与 webui importer 一致）。
2. **distill corpus 构建泄漏查重索引 sqlite 句柄**：`buildCorpus` 两处
   `openWikiSearchIndex` 后从不 close；Windows 上打开中的 sqlite 文件不可
   unlink → 测试 afterEach 清理沙箱 EBUSY。POSIX 允许 unlink 打开中文件
   （假象绿）。skill-wiki CLI 自有 `withWikiIndex`（open → action → finally
   close）纪律，daemon 未遵守。

## What Changes

1. `pnpm-lock.yaml`：root importer `@orpc/client` 版本引用对齐已物化的
   `1.14.6(@opentelemetry/api@1.9.1)` 快照（`--fix-lockfile` 产出，1 行）。
2. `packages/skill-wiki/src/similarity.ts`：新增导出
   `withWikiSearchIndex(directory, loadPatterns, action)`——查重索引会话
   边界，成功与异常路径必 close；`cli.ts` 私有 `withWikiIndex` 改为委托
   薄壳（4 个调用点零改动，纪律单点承载）。
3. `src/daemon/wiki-distill-service.ts` `buildCorpus`：source 工作区簇检索
   与 global wiki 候选检索两处改走会话边界（skill-search 主索引的 dispose
   链路 9/25 已修，非辖区）。
4. 回归钉（平台无关）：`packages/skill-wiki/test/similarity-lifecycle.test.ts`
   ——会话后 closed-use 必拒（`SEARCH_IO "search index is closed"`）+
   action 抛错仍 close + 会话后 wiki 目录可整体删除（Windows EBUSY 实弹）。

## 验收

- Windows 全量 `npx pnpm@12.3.4 exec vitest run`：0 失败（基线 16 failed）。
- `node -e "import('@orpc/client')"` 在重建后的 node_modules 上解析成功。
- 全量门禁（AGENTS.md §9）通过。
