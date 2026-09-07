# steward-product-workflow verification（进行中）

记录日期：2026-09-07。

## 4.1 实测注记（任务/范围选择 + runtime config + run 投影）

- Store：`webui/src/lib/stores/steward-workflow.svelte.ts`。选择 `{taskKind, selectedSkillIds, instructions}` 按 `workspaceId/providerId` 键控存于模块级 `$state` 表（island 卸载/重连存活；instructions 以 `STEWARD_INSTRUCTIONS_MAX=2000` 钳制——与 SkillStewardTask 契约同界；startRun 输入契约暂无 instructions 字段，选择面先建立，待契约扩展再上送）。runtime config 与 run 投影按代次协议：提交要求 `isCurrent`（最新请求 + 同一连接 owner），`loading/starting` 清理只需 `isLatest`；迟到的 startRun/settings 响应一律投影为无结果。
- 视图：`StewardWorkflowView.svelte`（manifest activity `workspaces.steward-workflow` = `/workspaces/workflow/:wsId/:providerId`，与 intelligence/steward 同形 3 段路由；ProviderView 新 Workflow tab）。选择初始化必须在 `$effect.pre` 内——`$derived.by` 里调 `selectionFor` 会写 `$state` 触发 Svelte `state_unsafe_mutation`，实测击穿叶子渲染并伪装成路由 no-match（本轮定位到的真实缺陷）。
- 单测：`webui/src/lib/__tests__/steward-workflow.test.ts` 6/6（vi.hoisted + mock connection 模块：owner generation 可控）；`route-match.test.ts` 6/6（manifest 全 activity 匹配回归——含 workflow 路由与未知前缀负例；icon/$app 以 stub/mock 隔离）。
- 测试基建：root `vite.config.ts` vitest 改 `projects`——`webui` 项目（`webui/src/**`）经 `createRequire(webui)` 解析的 `@sveltejs/vite-plugin-svelte` 编译 runes/组件，`$lib/$shared` alias 显式声明；`node` 项目（`test/**`、`webui/config/**`）保持原管线。动机：root 管线无 svelte 转换，`.svelte.ts` 的 `$state` 在 vitest 下是裸引用（ReferenceError）。`webui/vite.config.ts` 补 `$lib` resolve.alias（仅测试路径消费，dev/build 不变）。
- 浏览器取证（真实生产组合宿主 `scripts/dsh-release-evidence.sh.ts --hold`，0 JS 错误，artifacts/steward-workflow-4.1-island-{initial,run-projection,runtime-config,survives-reopen}.png）：
  - island Workflow tab：真实技能列表（release-evidence-skill）勾选 → `1 selected`；Organize 切换（aria-pressed）；
  - `Run organize` → `skillSteward.startRun` RPC → run 投影：1 tool call、4 accepted / 0 dropped、1 proposal（split `spp_37d173a4dfdc9f16`）、终态 completed、DSH session 绑定字段随绑定存在；
  - runtime config：`dsh.settings` 视图（deterministic · steward-deterministic/steward-echo、approval: ask、rev 0）+ approval ask→never 补丁生效；
  - island 关闭（0 残留）→ 重开 → 重导航：选择（1 selected + Organize）与 run 投影完整存活——「survive reconnect」验收点。
- 门禁：`pnpm test` 454/454（54 files，projects 拆分后 node+webui 双管线）；typecheck 0；webui check 0/0；`pnpm build`；`vp fmt --check` 482 clean；`git diff --check` clean；`openspec validate --all --strict` 9/9。

## 4.2 实测注记（产品级 workflow UI）

- 视图/Store：`StewardWorkflowView` 提案卡片 + timeline + agent stream 三段（同一 island root，零 iframe/零第二 shell）。store 增 `workflowTimeline`（append-only 事件）、`proposalStates`（validation/grant/apply/rollbackResult/rollbackPrep/busy/error 逐提案事实链）、`streamFramesState` + `framesForCurrentRun`（按当前 run 的 dshSessionId 过滤）。全部走既有 `skillSteward.*` / `dsh.sessions.streams` RPC，无契约改动。
- rollback 双形态（approval-service 实测）：disable/enable 的逆 = 真实 reverse proposal（note 要求 separate human approval → UI 走 Approve reverse + Apply reverse）；split/merge 的逆 = rollback grant（reverseProposalId 是 `spp_`+16 零占位 → UI 直接 Rollback(replay) 消费 grant）。`isReverseProposalPlaceholder` 固化该哨兵语义。
- 生产 stream 接线：`dsh-session-binder` 增 `createCollector` 钩子（session 开启 → onTurnStart；每投影 tool call → onToolCall；失败只丢帧不影响绑定）；`pipeline-service.setDshSessionBinder` 运行时注入点；`bootDaemon` 在 DSH host 挂载后以 `domain.dshSettings.createStreamCollector` 构造 binder 注入——此前 `dsh.sessions.streams` 在生产无数据源（collector 只有测试/脚本消费），UI 恒空。
- 轮内三个真实缺陷（全部 4.2 产品化浏览器实测暴露）：
  1. Svelte 信号丢失：store 的 `$state` Record getter 返回裸对象（`selectionFor`/`proposalStateFor`）——store 函数改裸目标不触发信号（Validate 徽章靠偶发重渲染出现、busy spinner 永久卡死）。修复：统一返回 record 内 proxy。
  2. journal 双射零计数缺陷：`expectedJournalStepsOf` 对 `bump("resource", 0)` 也入表，observed 只计实际出现的 kind → resource-less split/merge 的 rollback/重放双射必然失配，全部误报 recovery-required（真实磁盘无法恢复）。修复：零计数不入表（skill-steward-runtime +1 回归：expected kinds 恰为 precheck/create-target/disable）。
  3. darwin canonical 豁免缺口：豁免只覆盖 /var→/private/var，不覆盖 /tmp→/private/tmp（IPC sun_path 短路径 sandbox 的标准形态）→ /tmp home 下 apply 全部 compensated（journal 根非 canonical）。修复：豁免扩为 darwin 系统级 symlink 根（/var、/tmp、/etc；r8 probes +2：/tmp 根接受 + 无关 realpath 仍拒）。
     另：applyRollback 的 catch 此前吞掉 undo 错误（recovery 只有终态无诊断）——failure 文本现在经内部返回值穿透到 ApplyResult 并落 daemon 日志（契约不变）。
- 浏览器验收（真实生产组合宿主 `scripts/dsh-release-evidence.sh.ts --hold`；截图 steward-workflow-4.2-{agent-stream,applied-mutation-diff,rolled-back,width-1100px,width-680px,approved,full-chain}.png，全程 0 JS 错误）：organize run（绑定 dsh session-2）→ Validate（3/3 checks passed）→ Approve（grant_3c27…）→ Apply（applied；mutation diff 3 行 relPath/semantic/revision；磁盘 split 真实落盘 `release-evidence-skill-exec/SKILL.md`、`-plan/SKILL.md`、源 `.SKILL.md`）→ Prepare rollback（grant minted）→ Rollback(replay)（timeline `rollback: applied · 3 mutations`；磁盘 find 恢复为仅 `skills/release-evidence-skill/SKILL.md`）；agent stream 真实帧（turn-start + tool-call skills.propose）；1100px/680px 强制容器宽度 scrollWidth===clientWidth。
- 门禁：`pnpm test` 462/462（54 files）；typecheck 0；webui check 0/0；build；`vp fmt --check` 473 clean；`git diff --check` clean；`openspec validate --all --strict` 9/9。

## 4.3 实测注记（ACP 复核 + 最终用户文档）

- ACP 复核：`rg -i acp webui/src` = 3 行（`CreatorWorkspace.svelte` 头部意图注释 ×2 + 分区注释 ×1，全部为 3.2 移除决策记录）；README 3 处提及（/creator 产品表注、模块树 internal-legacy 标注、RPC 表 internal-legacy 标注），无产品叙事。
- 命令生产包实测（`pnpm build` → `dist/`，与 tarball 同运行内容；`HOME=/tmp/sc-43-home` 隔离 + `SKILL_CREATOR_DISABLE_TRAY=1` 走 headless 终态——tray/windowed 路径由 dsh-webui-composition 4.1 浏览器证据持有）：
  - `node dist/cli.js version` → `2.0.0`；`help` → 用法清单。
  - `start` → `skill-creator daemon started.` + headless 恢复提示（exit 0）。
  - `status` → pid 76882 / version 2.0.0 / port 61000 / tray headless (browser mode) / 带 token WebUI URL。
  - `open` → headless 提示 `openinbrowser`（exit 0；README 措辞由「失败并提示」改为与实测一致的「不可用并提示」）。
  - `openinbrowser` → `Opening browser: http://127.0.0.1:61000/#token=…`（系统浏览器被调用）。
  - HTTP：`/api/health` → `{"ok":true}`；`/` → 200（DSH host 同源入口，headless tray 下 WebUI 仍浏览器可达）。
  - `stop` → `daemon stopped.`；endpoint 立即 ECONNREFUSED；复跑 `status` → `cannot reach daemon (connect ENOENT …)` + `start` 恢复提示。
- 复现事实（4.8 owner）：`npm install <skill-creator-2.0.0.tgz>` 于干净目录在解析 `ccski@link:../ccski` 时静默 exit 1（npm 11.19，node 24.20/26.1 与 legacy-peer-deps/16GB heap 均复现；单独安装任意依赖正常）。本地 `../ccski` 领先发布版 2.4.0 两个提交（`customDirs`/`customProvider`——本仓 provider 投影依赖该特性，不能直接换 registry 版本）。已在 README CLI 节如实记录；「消除 link: 或依法打入产物」归 4.8 发布清单验收。
- README 新增/同步：「技能管家（Skill Steward）」章节（模型配置/维护流程/恢复流程）；intro 与产品边界表（DSH 默认入口 + Workflow 标签）；运行架构树（+dsh-host-lifecycle、steward/、dsh-session-binder、dsh-settings）；RPC 表（+skillSteward 六端点、dsh settings/credentials/sessions）；CLI `open` 行为措辞对齐实测。
- 门禁：462/462（54 files）；typecheck 0；`vp fmt --check` 473 clean；`git diff --check` clean；openspec 9/9（本轮仅 README/openspec 文档变更）。
