# Proposal: evaluating-world-class — Evaluating 按 world-class-designer 标准重做

## Why

Owner 裁决（2026-10-04）：「Evaluating 你还没做，用 world-class-designer 的要求去
开发。」——现状 evaluating-dashboard（archive 2026-10-04）是最小实现（总览卡网格
+ cases 表 + 失败断言展开），达到了「功能可用」但未经过设计过程（无 persona 故事
验收、无品类地板对标、无批评环），等于没做。本 change 按 world-class-designer
全流程（Stage 0 → T0 → 方向 → 实现 → 批评环 9+ 门）重做该区块。

## What Changes

- **设计过程入档**：design.md 固化 Stage 0（persona 故事即验收）、T0 品类地板
  （评估报告品类拆解 GitHub Actions run 视图）、方向与记忆点。
- **总览屏重做**：技能卡网格 → 「健康度仪表」语言（通过率环 + 最近 run 状态带 +
  stale 黄带 + 断言失败摘要行）；近期 runs 时间线（GitHub Actions run list 式）。
- **详情屏重做**：cases 表 → **左侧 case 步骤树 + 右侧断言详情**的 run 报告式
  布局（GitHub Actions job 视图）；失败断言的**期望 vs 观测 diff 视图**（本区块
  的记忆点）；run 选择器（时间线）。
- **交互细节**：case 树折叠/展开记忆、失败自动展开、键盘导航（↑↓ 选 case、
  Enter 展开）、相对时间、运行中 run 的 live 进度。
- 契约：消费既有 evaluation.overview/cases/results（不新增 RPC；若 case 断言
  逐条投影不足则在 change 内评估最小扩展）。
- i18n C 类出生即双语；品牌绿 token；批评环（新鲜批评者 9+ 门）作为验收门。

## Impact

- webui：apps/evaluating/ 两视图重写 + store 扩展。
- 不动 daemon 契约（除非设计定稿发现投影缺口）。
- 归档的 evaluating-dashboard 是本 change 的功能基座（RPC/路由/Global 闸全部
  沿用），本 change 只重做呈现层与交互。
