# Proposal: evaluating-dashboard — 独立 Evaluating 左导航入口（评估总览）

## Why

Owner 会话补充（2026-10-03）：「左侧导航需要新增一个 evaluating 入口，这个我们
之前一直说要做，一直没做」。现状 evaluation 面只在 Creator 的 per-skill 只读子
视图（evaluation-webui-view 归档）+ CLI/MCP；RPC 全部 per-target 粒度，无跨
skill 聚合。Codex r1 F 题裁决：独立入口 + server-owned 聚合 RPC（cursor 分页，
不整库下发）。

## What Changes

- **Evaluating 区块实体化**（替换 shell-page-tabs 占位；`/w/:wsId/evaluating`）：
  - **总览屏**：当前 ws 有评估语料的技能卡列表（通过率/最近 run 时间/stale
    标记/断言失败摘要）+ 近期 runs 行（运行中含进度态）。
  - **技能详情**（r2 修订：路由定稿）：`/w/:wsId/evaluating/:providerId/:skillId`
    path 三段路由（无歧义可深链；替代 `?skill=` 单参数——同 ws 多 provider
    同名技能下有歧义）；迁移 eval-view 为独立详情面（cases 全列表 + 五态结果
    + 失败断言展开 + observedEndRevision 对比）；run 发起（显式 target 三元组
    标注确认，不自动运行）+ cancel；case 创建/编辑（Imported only）。
- **聚合 RPC**：`evaluation.overview`（ws 级：有语料 targets + 每 target 摘要
  + 近期 runs；cursor 分页 + 有界响应；r2 修订：targets 补 typed `error`
  行投影单技能 IO 失败，recentRuns 定稿固定窗口 20 条不分页）；Global 可读。
- **Global run 前置闸**（r2 修订：真实缺口）：现状 `run.start` 未在排队前
  拒绝 Global target（写闸只在结果落盘时）——Global run 会真实执行全部
  case 后才失败且 run 卡 running。server MUST 在排队/调用 runner 之前
  typed 拒绝 Global target；测试断言 adapter 未被调用。
- **与 Creator 引导衔接**：creator-agent-chat 的「测试话术建议」填入 case
  草稿的深链落点。

## Impact

- daemon：evaluation namespace 增 overview 过程；store 层 ws 级扫描（有界
  目录扇出）；`evaluation.run.start` 增 Global target 排队前前置拒绝
  （rpc-router / service 排队路径）。
- webui：evaluating 区块两视图（总览+三段路由详情）；eval-view 迁移退役。
- i18n：C 类出生即双语。
- 测试：overview 分页/权限/空态/targets error 投影；Global run 前置拒
  （adapter 未调用断言）；run 发起与 cancel 竞态回归；迁移路由。
