# Tasks: steward-product-workflow

依赖：`skill-steward-contracts`、`skill-steward-runtime`、`dsh-runtime-integration`、`dsh-webui-composition` 完成并通过门禁。此 change 不再设计第二套独立 Agent shell。

- [x] 4.1 在已注册的 DSH client plugin 内实现任务与范围选择。
  - Files: `packages/skill-creator-dsh-client/`, `src/shared/rpc-contract.ts`, `webui/src/lib/stores/`.
  - Steps: 只实现 task/target/selected-skills/runtime-config stores 和对应 workflow view；复用阶段 4 已注册的 plugin/root/connection/RPC owner，不注册第二个 plugin、root、route owner 或 Agent shell。
  - Acceptance: scope/task/runtime config and run projection survive reconnect with latest-request-wins semantics inside the DSH host；plugin registration 仍只由 `dsh-webui-composition` 负责。
  - Evidence: 新 store `webui/src/lib/stores/steward-workflow.svelte.ts`（per-target 键控选择 `{taskKind, selectedSkillIds, instructions≤2000}` 模块级 $state——跨 island 卸载/重连存活、无 localStorage；`loadStewardRuntimeConfig`/`applyStewardRuntimeConfigPatch` 走 `dsh.settings.*`，typed rejected 原样返回；`startStewardWorkflowRun` 走 `skillSteward.startRun`，run 投影绑定 targetKey——提交要求 isCurrent、loading 清理只需 isLatest 的代次协议）+ 新视图 `StewardWorkflowView.svelte`（manifest 新 activity `workspaces.steward-workflow`，ProviderView 增 Workflow tab；无第二个 plugin/root/Agent shell）。单测 `webui/src/lib/__tests__/steward-workflow.test.ts` 6/6（键控/toggle 去重/instructions 钳制/慢请求不覆盖新 run/断线后回落响应零提交+新连接可提交/unavailable typed 错误/rejected 不动视图+迟到补丁丢弃）+ `route-match.test.ts` 6/6（全部 activity 路径匹配含 workflow 3 段路由、未知前缀不吞）。测试基建：root vitest 改 projects（webui 项目经 webui 安装的 vite-plugin-svelte 编译 runes；node 项目不变——root 管线无 svelte 插件，`.svelte.ts` 的 `$state`会变裸引用）。轮内真实缺陷修复：视图曾在`$derived.by` 内调用 `selectionFor` 初始化 $state 选择表 → Svelte `state_unsafe_mutation` 击穿叶子渲染（SPA 表现为路由 fallback）——改为 `$effect.pre` 初始化。浏览器取证（`scripts/dsh-release-evidence.sh.ts --hold` 真实生产组合宿主，artifacts/steward-workflow-4.1-island-*.png 4 张，0 JS 错误）：island 内 Workflow tab 真实技能多选（1 selected）+ Organize 切换 + `Run organize` 经 RPC 产出 run 投影（1 tool call、4 accepted/0 dropped、1 proposal split `spp_*`、completed）+ runtime config 补丁 approval ask→never 生效（rev 0 视图刷新）+ island 关闭重开后选择与 run 投影完整存活。门禁：454/454（54 files）、typecheck 0、webui check 0/0、build、fmt 482 clean、diff-check clean、openspec 9/9。
- [x] 4.2 实现 DSH-hosted 产品级 workflow UI。
  - Files: `packages/skill-creator-dsh-client/`, components and styles.
  - Acceptance: timeline, tool calls, evidence graph, diff, validation, approval, rollback and recovery states work at 1100px and 680px without overflow; no iframe or parallel shell.
  - Evidence: `StewardWorkflowView` 扩为完整提案工作流（同一 island/root，无 iframe/第二 shell）：每提案 validate→approve→apply→rollback 操作链（valid 才可 Approve、grant 才可 Apply、applied 才可 rollback；两类 rollback 形态——enablement reverse proposal 走 Approve reverse/Apply reverse、split/merge rollback grant 走 Rollback(replay)，以 `spp_`+16 零占位 id 区分）、mutation diff 表（relPath+semantic+before→after revision——Manager 修订级事实，不伪造内容 diff）、validation checks 逐项清单、recovery/compensated/rollback-failure 恢复横幅（含 daemon 侧 failure 文本）、append-only timeline（run-started→validated→approved→applied→rollback-prepared→rolled-back/error）、agent stream（dsh.sessions.streams 脱敏帧按当前 run session 过滤，tool-call/tool-result 即 tool calls 证据链）。生产 stream 数据源接线：`bootDaemon` 在 DSH host 挂载后 `setDshSessionBinder`（binder 增 collector 钩子把 turn/tool 事件喂进 dsh.settings 环形缓冲——此前生产无消费者，stream 恒空）。轮内修复三个真实缺陷：① store record 返回裸对象致 mutation 不触发 Svelte 信号（busy/validation 卡死）→ 统一返回 proxy；② `expectedJournalStepsOf` 零计数入表使 resource-less split/merge 的 rollback 双射必然失配（全部误报 recovery-required）→ 零计数不入表（runtime 测试 +1 回归）；③ darwin canonical 豁免只盖 /var 不盖 /tmp→/private/tmp（/tmp 短路径 sandbox 的 apply 全部 compensated）→ 豁免扩为 darwin 系统级 symlink 根（r8 probes +2）。单测：steward-workflow 11/11（新增双 rollback 形态/recovery 投影/stale 门/帧过滤）+ runtime 70/70 + r8 probes 20/20。浏览器取证（真实生产组合宿主，7 张 steward-workflow-4.2-*.png，0 JS 错误）：organize run→Validate(3/3 checks)→Approve(grant_*)→Apply(applied + mutation diff 3 行 + 磁盘 split 落盘 exec/plan/.SKILL.md)→Prepare rollback→Rollback(replay)→磁盘恢复原状（find 证据）；agent stream 真实帧（dsh session-2：turn-start + tool-call skills.propose）；1100px/680px 容器强制宽度下 scrollWidth===clientWidth 无横向溢出。门禁：462/462（54 files）、typecheck 0、webui check 0/0、build、fmt 473 clean、diff-check clean、openspec 9/9。
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
