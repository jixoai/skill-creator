# Tasks: steward-product-workflow

依赖：`skill-steward-contracts`、`skill-steward-runtime`、`dsh-runtime-integration`、`dsh-webui-composition` 完成并通过门禁。此 change 不再设计第二套独立 Agent shell。

- [ ] 4.1 在已注册的 DSH client plugin 内实现任务与范围选择。
  - Files: `packages/skill-creator-dsh-client/`, `src/shared/rpc-contract.ts`, `webui/src/lib/stores/`.
  - Steps: 只实现 task/target/selected-skills/runtime-config stores 和对应 workflow view；复用阶段 4 已注册的 plugin/root/connection/RPC owner，不注册第二个 plugin、root、route owner 或 Agent shell。
  - Acceptance: scope/task/runtime config and run projection survive reconnect with latest-request-wins semantics inside the DSH host；plugin registration 仍只由 `dsh-webui-composition` 负责。
- [ ] 4.2 实现 DSH-hosted 产品级 workflow UI。
  - Files: `packages/skill-creator-dsh-client/`, components and styles.
  - Acceptance: timeline, tool calls, evidence graph, diff, validation, approval, rollback and recovery states work at 1100px and 680px without overflow; no iframe or parallel shell.
- [ ] 4.3 验收旧 ACP 入口已移除并补齐最终用户文档。
  - Files: `webui/src/lib/components/creator/`, `README.md`, shared route/contracts.
  - Acceptance: 复核阶段 4 的入口清理，无 generic ACP 产品入口；README 记录真实安装、模型配置、维护与恢复流程，所有命令在生产包实测。
- [ ] 4.4 完成真实 CLI/daemon/RPC/file-system smoke and release checklist。
  - Files: `scripts/steward-smoke.sh.ts`, `docs/release/skill-steward.md`.
  - Acceptance: clean-directory start/stop/restart, workspace mutation, stale conflict, approval, rollback and DSH unavailable are evidenced.
- [ ] 4.5 运行全量门禁：`pnpm test`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`、`openspec validate --all --strict`。
- [ ] 4.6 完成三个任务、四类 action 的真实端到端验收。
  - Files: `scripts/steward-smoke.sh.ts`, 本 change 的 `artifacts/acceptance.md`。
  - Cases: check 单 skill；check 多 skill 关系；optimize edit；organize disable/split/merge；分别记录 DSH session/tool-call id、Manager run/snapshot/proposal/audit id 和 Provider 内容/启停/资源树。
  - Acceptance: fixture 覆盖全部 action 和故障；真实锁定 DSH packages + 真实模型至少完成一次分析到方案、批准、apply、rollback。凭证缺失只记录 blocker，不能把 unavailable 作为通过。
- [ ] 4.7 建立可解释的优化前后评估，不使用单一健康分。
  - Files: `test/fixtures/steward/evaluation/`, `artifacts/effectiveness.md`。
  - Cases: 明确该触发的 5 条输入、不该触发的 5 条输入；含冲突对、分工重叠对、配套脚本技能；保存 baseline 和 candidate 的原始结果、模型版本与判断理由。
  - Acceptance: 文档/资源完整性不退化；展示触发命中和误触发、任务断言、token 估算与真实消耗的区别；未知使用历史显示 unknown。每次优化有预期收益、证据、失败风险和保留/拒绝理由，不能把缩短字数视为默认提升。
- [ ] 4.8 完成实际 package clean-install 验证。
  - Files: `package.json`, build/stage scripts, `artifacts/clean-install.md`。
  - Steps: 消除生产 link:../ccski 或把其必要代码依法打入产物；锁定 DSH runtime 支持的 Node 版本；根 typecheck/build/test 覆盖 DSH plugin；pack 后在仓库外的空目录安装并启动。
  - Acceptance: 无本地源码、/tmp、未发布 private package 或 fixture 依赖；官方 packages/client assets 实际可加载；检查许可信息。不要仅凭 build 或 pack --dry-run 宣称可安装。
- [ ] 4.9 修复复核发现的 permission capability、terminal polling 和 stale projection。
  - Cases: permission capability 必须由实际 handler/restriction 决定；选中终态 run 停止高频刷新；断线错误可见；切 route 后迟到 response 不覆盖新 scope；不用 as never 强行接受 UI 输入。
  - Acceptance: 延迟/失败 RPC 的组件交互测试和真实 1100px/680px 浏览器证据；检查键盘、长路径、空态、错误态和恢复动作，截图不能替代点击后的文件验证。
