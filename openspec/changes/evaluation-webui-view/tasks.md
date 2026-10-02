# Tasks: evaluation-webui-view

## 1. 路由与子视图入口

- [x] 1.1 creator manifest 两处 subview search enum 扩展 `"eval"`（父路由 +
      子路由同形状，复刻 WS4 复走查 N2 纪律）
      —— `webui/src/lib/apps/creator/manifest.ts`
- [x] 1.2 `sub-view-tabs.svelte` 增加 Eval tab（clipboard-check 图标）；
      `CreatorWorkspace.svelte` 挂载 `eval-view.svelte`
      —— `webui/src/lib/components/creator/{sub-view-tabs,eval-view}.svelte`、
      `webui/src/lib/apps/creator/CreatorWorkspace.svelte`

## 2. store 与投影

- [x] 2.1 `evaluation-view.svelte.ts`：latest-request-wins 代次门 +
      loading/error/empty 三态；new 模式不发 RPC；被取代/断线请求不提交
      —— `webui/src/lib/stores/evaluation-view.svelte.ts`
- [x] 2.2 纯函数投影：`latestResultByCase`（endedAt 倒序 + resultId tie-break）、
      `buildEvaluationRows`（case × 每案最新结果）、`evaluationOutcomeBadge`
      （五态配色互异）
      —— 同文件导出，单测钉死

## 3. 测试与门禁

- [x] 3.1 store 聚焦测试：loading / error / empty / latest-wins / 连接替换 /
      五态徽标映射 / 每案最新结果选取（含同时多结果 tie-break）
      —— `webui/src/lib/stores/__tests__/evaluation-view.test.ts`（8 例）
- [x] 3.2 门禁：`pnpm exec vp test run`（聚焦两文件）+ `pnpm typecheck` +
      `pnpm --dir webui check` + 触碰文件 `vp fmt` + `openspec validate
evaluation-webui-view --strict` 通过（webui check 的唯一报错位于并行 change
      的在途文件，非本批边界——见验收证据）

## 验收证据

- 3.1：`pnpm exec vp test run webui/src/lib/stores/__tests__/evaluation-view.test.ts`
  → 8/8 passed（webui 项目）。
- 3.2：`pnpm typecheck` 0 error；`pnpm --dir webui check` 全仓唯一 1 error 位于
  并行 change（ux-polish-walkthrough-residue）在途文件
  `webui/src/lib/render-skill-md.ts:65`（非本批文件边界，不在本批处置）；
  本 change 全部触碰文件 0 error / 0 warning；
  `openspec validate evaluation-webui-view --strict` → "change is valid"；
  fmt --check 对全部触碰文件通过。
- 只读红线：eval-view 无任何 mutation 调用（源文件仅
  `evaluation.cases.list` / `evaluation.results.list` 两个只读过程）。
