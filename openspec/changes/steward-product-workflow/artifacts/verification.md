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
