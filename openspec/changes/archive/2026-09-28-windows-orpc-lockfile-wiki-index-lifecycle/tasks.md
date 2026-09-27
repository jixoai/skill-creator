# Tasks

- [x] 1.1 Windows 全量基线：16 failed / 1504 passed，按失败族归因（@orpc 解析族 16 = lockfile 不自洽 + sqlite 句柄泄漏显形）
- [x] 1.2 lockfile 修复：`pnpm install --fix-lockfile`（root `@orpc/client` → `1.14.6(@opentelemetry/api@1.9.1)`，1 行）+ import 解析验证
- [x] 1.3 skill-wiki：导出 `withWikiSearchIndex` 会话边界；`cli.ts` `withWikiIndex` 委托化
- [x] 1.4 daemon：`buildCorpus` 两处索引使用改走会话边界（clusters + candidates）
- [x] 1.5 回归钉：`similarity-lifecycle.test.ts`（closed-use 拒绝 / 异常仍 close / 目录可删）
- [x] 1.6 Windows 全量复验 0 失败 + 全量门禁 + 报告
