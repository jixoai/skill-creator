# WS4 ego-browser 走查收据（2026-10-01）

> 用户裁决：「你让 vision 子代理自己去尝试走查验收确定使用体验没问题再来找我。」
> 走查代理：vision 子代理 × ego-browser（TaskSpace 隔离）；主视口 1100×680，
> 辅以 1600×1000 / 720×900 对照；真实 daemon（沙箱 home + Workspace
> Walkthrough/openclaw 三技能）+ 真实模型 local-gateway/glm-5.3-flash。
> 截图：宿主 `/tmp/sc-ws4-shots{,-r5,-r6,-r7}/`（临时目录，收据以本文结论为准）。

## Round 4（全量首走）

结论：**存在阻塞，暂不交付**。A Workspaces / B Creator（部分）/ D Agent 面板 /
E Wiki / F Repository / G Settings / H 跨切面全 pass；**0 console error**
（覆盖全部 SPA 导航 + 两次整页 reload + 断连恢复）。

阻塞（已修，见处置表）：B1 既有技能无 Creator 编辑入口；B2 Create 成功不转
编辑态（Test tab 永久 gated）。

非阻塞在录：详情硬加载首轮竞态错误（已修）、frontmatter `>-` 折叠标量显示、
muted-foreground 对比度 ≈3.6:1、Agent 面板小命中区、Repository 文案混杂、
graph 密集标签重叠、Workspace 卡片默认落点。

## Round 5（B1/B2 复验）

B1 全解除（Edit in Creator 深链 + CodeMirror 软换行实证：400 字符长行折 4 行、
无横滚）。B2 部分解除并发现两个新阻塞：N1 create→edit 后编辑器空白
（markDraftHydrated 先于缓存交接的竞态）；N2 编辑路由子视图切换失效
（子路由缺 search schema → subview 恒回落 file）。替代探针：Agent 面板直发
消息，真实模型 6.0s 回复 "R5-PROBE-OK" 渲染正常——模型链路健全。
重复目录名文案 pass（精确命中新文案）。0 console error。

## Round 6（N1/N2 复验 + Ch2 主链收官）

三项全 pass：N1 create 后编辑器立即有内容（reload 保留）；N2 History/Preview/
Validate/Test 全部真实切换（`?subview=test` 直开落点正确）；**Ch2 主链端到端
打通**——Test tab probe 模板 → Run in Agent panel → 面板 seed（$技能名 引用、
不自动发送）→ 手动发送 → 真实回复 58.8s（含 Thinking 块、skills_search/
skills_info 工具 chip、turn 统计 ↑27.9k·↓1.6k·58.8s）。0 console error。

遗留 minor（已修）：深链 ?subview=test 的陈旧空态（路由属主兜底加载）。

## Round 7（v2.5.0 合入后快速回归）

上游 v2.5.0（bindWindowRegion 顶栏 + 暗色 color-scheme）与本轮 AppSidebar/
编辑链共存**无回归**：顶栏三按钮正常、侧栏双态正常、Edit in Creator 链路
完好、`?subview=test` 硬刷新 0.8/4.3/8s 三观察点均无 "not connected"（连接
重试修复实证）、Dark 主题全页生效（含 CodeMirror 区）。0 console error。

## 处置对照表

| 发现                    | 轮次  | 处置                                      | commit     |
| ----------------------- | ----- | ----------------------------------------- | ---------- |
| B1 无 Creator 编辑入口  | r4    | ProviderView 详情 Edit in Creator 深链    | d60e794    |
| B2 create 不转编辑态    | r4    | hydrateFromDocument 补 mode=edit + 转路由 | d60e794    |
| N1 编辑器空白竞态       | r5    | create 显式 cacheCreatorDraft 交接        | 2d2d422 段 |
| N2 子路由 search schema | r5    | creator.workspace.skill 补 search         | 4af6940    |
| 硬刷新首轮连接竞态      | r4/r6 | 连接就绪自动重试（detail/doc）            | 2d2d422    |
| 深链 Test 陈旧空态      | r6/r7 | CreatorWorkspace 兜底加载                 | 37f3e01    |
| CodeMirror 无软换行     | r4    | EditorView.lineWrapping                   | d60e794    |
