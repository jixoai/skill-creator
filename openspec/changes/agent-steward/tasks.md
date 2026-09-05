# Tasks: agent-steward

依赖：`skill-intelligence` 已通过验收。一次只实现一个 backend，完成后再开始另一个。

- [ ] 1.1 新建 `src/shared/contracts/agent-steward.ts`，定义 StewardRun、Recommendation、PermissionDecision、RunEvent、terminal status。
- [ ] 1.2 新建 `src/daemon/steward-service.ts`：串联 analyze -> recommend -> draft -> validate -> approval -> apply；每一步可取消且有 terminal result。
- [ ] 1.3 实现 fixture HarnessAdapter；覆盖 prompt、ordered events、cancel、disconnect、early exit、handshake failure 和 daemon stop。
- [ ] 1.4 把 Agent 建议映射为 edit/disable/split/merge ProposalDraft；不允许 adapter 直接调用 filesystem mutation。
- [ ] 1.5 实现 DSH backend adapter：固定版本、ACP/profile capability matrix、显式配置、缺失或 handshake 失败 typed unavailable。
- [ ] 1.6 实现 Codex app-server adapter：优先 stdio/Unix socket，thread/turn/item 映射为 normalized RunEvent；不复制 Rust 类型。
- [ ] 1.7 新增 steward UI：运行列表、实时事件、推荐队列、approval/reject、stale run 和失败原因；不把历史写入 localStorage。
- [ ] 1.8 增加 focused tests：Agent 不能越过 Manager apply、approval 一次性、backend 不自动 fallback、daemon stop 无 orphan process。
- [ ] 1.8a 以 `demo/agent-steward.html` 作为 run timeline、recommendation 和 approval gate 的交互参考；静态页面不能替代真实 backend smoke test。
- [ ] 1.9 验收：fixture tests、启用 backend 的 smoke test、`pnpm check`、`pnpm build`，并保存去敏 protocol transcript。
