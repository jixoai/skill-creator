# Tasks: manager-core-consolidation

每个任务完成后运行对应 focused test；全部任务完成后运行 change 验收命令。

- [ ] 1.1 读取 `src/shared/rpc-contract.ts`、`src/shared/contracts/*`、`src/daemon/domain.ts`、`src/daemon/rpc-router.ts`，建立 `docs/manager-contract-map.md`，逐项列出 procedure、输入、输出、authority、错误和测试文件。
- [ ] 1.2 为 `docs/manager-contract-map.md` 添加 ASCII 数据流和“不允许 WebUI 拼路径”的例子；运行 `git diff --check`。
- [ ] 1.3 检查所有 Manager 外部输入（registry JSON、Git/ccski/installer 输出、SKILL.md、RPC/IPC）是否先经 runtime parser；为每个缺口新增最小 Zod schema 或 typed failure，不改无关模块。
- [ ] 1.4 为 registry、Creator、Repository 各补一个负向 focused test：损坏快照、revision conflict、路径逃逸或不匹配 installer output 必须失败且原文件不变。
- [ ] 1.5 删除当前代码中已不再被路由或 RPC 使用的旧 Manager 类型、旧路由入口和重复前端类型；每删除一项用 `rg` 和 typecheck 证明无引用。
- [ ] 1.6 将旧 active changes 归档到 `openspec/changes/archive/2026-09-05-legacy-v2/`，新 change 不得引用已归档 change 作为实现前置条件。
- [ ] 1.7 更新 `AGENTS.md` 与 `README.md` 中 Manager 的真实边界；只保留当前代码能证明的行为。
- [ ] 1.8 验收：`openspec validate --all --strict`、`pnpm test -- --runInBand`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`。
