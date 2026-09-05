# Tasks: manager-workbench

依赖：`manager-core-consolidation` 已通过验收。每个 UI 任务都要提供桌面和窄窗口证据。

- [x] 1.1 画出当前三条真实路由和返回路径，删除或重定向重复入口；加入一个 route contract test 覆盖非法 opaque ID 在渲染前 redirect。（路由图见 `docs/manager-contract-map.md`「WebUI 三 App 路由」；新增 `route-hygiene.ts` + TabOutlet `$effect.pre` 渲染前 replaceState 清理；修复 import-workspace-dialog / command-palette 3 处指向已删除 `/workspace` 单数路由的 goto；删除死组件 app-sidebar / skill-detail / workspace-removal / categorize；`route-hygiene.test.ts` 6/6 通过，svelte-check 0 错）
- [ ] 1.2 完成 Workspaces home：Global/Imported Workspace、Provider、availability、skill count、import/remove；Remove 只删除 registry entry，不删除目录。
- [ ] 1.3 完成 Provider view：列表、筛选、详情、markdown/frontmatter 预览、validate、enable/disable；加载、空数据、更新中、失败状态可区分。
- [ ] 1.4 完成 Creator new/edit：draft 只在组件内，save/delete 携带 target 和 expectedRevision；冲突不覆盖 draft，重载后用户能继续决定。
- [ ] 1.5 完成 Repository：source list/add/remove、scan commit、remote skill selection、preview、dry-run、multi-target install；session 失效时提示重新扫描。
- [ ] 1.6 为所有 mutation 加 disabled/loading 锁和结果分类；禁止 skipped-only 显示为成功 0 项。
- [ ] 1.7 增加 focused tests：route cleanup、revision conflict、session mismatch、Global Workspace write rejection、stale response。
- [ ] 1.8 视觉验收：桌面宽度至少 1100px、窄窗口 680px；验证列表/详情往返、键盘焦点、横向代码块滚动、无控制台错误。
- [ ] 1.8a 以 `demo/manager-workbench.html` 作为信息层级和状态表达参考；不得把静态 DEMO 当作生产验收证据。
- [ ] 1.9 验收：`pnpm test -- --runInBand`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`。
