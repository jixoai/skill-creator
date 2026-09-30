# WebUI 残留工作计划（2026-09-30，待 Codex 复核）

> 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
> 测试与评估，你整理一份工作计划（可能是几个 changes），你和 codex 去讨论讨论。
> 等全部做好了再让我来参与走查验收。切记，你让 vision 子代理自己去尝试走查验收
> 确定使用体验没问题再来找我。」

事实源：Explore 子代理全仓盘点（2026-09-30；证据行号见各节）。本文档是工作计划
提案，供 Codex（大地三）复核切分、优先级与验收语义；定稿后逐 change 立 openspec。

## 盘点结论（事实，非计划）

1. **Creator「Test」子视图**是全 WebUI 唯一明式 "Not yet implemented" 占位
   （CreatorWorkspace.svelte:146-155；五个 tab 已注册可点击可入 URL）。后端无
   `skills.test` 类 RPC——「在 agent 会话中试跑本技能」的语义未定义。
2. **Intelligence 提案面半接**：审查面完整（before/after/approve/reject/stale），
   但创建面只覆盖 disable/edit 两种 proposal；split/merge 只能渲染不能创建
   （IntelligenceView.svelte:234-293 vs 732-753；全 webui 无 proposeSplit/proposeMerge）。
3. **Steward 面后端完整、UI 入口被 2026-09-11 用户裁决下线**：`steward.*` 七个
   RPC 就绪、webui 零消费；`steward-product-workflow`/`agent-steward` specs 仍
   要求 Manager 工作流面——spec 与裁决矛盾未收口。
4. **评估（evaluation）只有回归资产**：`test/fixtures/steward/evaluation/` 十条
   期望矩阵 + steward-effectiveness 回归，无任何产品面。
5. 小债：CodeMirror 懒加载（现为 monospace textarea）、AppSidebar 简化版、
   General 偏好空分区、new 模式草稿不能校验、两处 archive 未勾 tasks、
   creator manifest stale 注释。

## 拟议 changes（切分提案）

### C1 `creator-test-subview`（skill 测试——用户点名的核心项）

把 Test tab 做实：最小可用版 = 在 Agent 面板打开一个 seed 会话，系统提示携带
被测技能的 `$` 引用 + 一段固定的「试跑脚本」（按技能 description 生成一组探针
任务），会话帧流回面板；结果不做自动判定（第一版人工判读），但保留会话转录供
后续评估。

- 复用面：agent.sessions 既有创建/帧流（creator 上下文注入 skill ref 的展开已
  由 `$` 引用链承担）；不新建 backend 域，只补一个 creator→agent 的 seed 入口
  RPC（或纯前端路由 + 预填 prompt，零后端——二选一待定）。
- 备选：若 codex 认为第一版价值不足，可先移除 tab（防「死面」），把实现推迟到
  评估语料产品化之后。
- 验收：桌面+窄屏走查；会话可见技能引用展开块；转落入档。

### C2 `evaluation-corpus-surface`（skill 评估——用户点名的核心项）

把既有评估资产（expectation 矩阵 + analyzer）升格为产品面：

- Creator Test 子视图第二期：技能 × 期望 case 的批量跑分（analyzer 已产品化，
  差的是 case 的用户可编辑存储与跑分编排 UI）。
- 存储裁决候选：case 放技能目录内（`_evaluation/` 约定，随技能分发）vs 放
  workspace 侧（.skill-creator 私有）——倾向前者（评估语料随技能演进），待议。
- 与 C1 的关系：C1 是「人看的一次试跑」，C2 是「机器判的批量回归」；共用
  analyzer，不共用 UI 状态。

### C3 `intelligence-proposal-parity`

补 split/merge 的 UI 发起入口（ IntelligenceView 增两种 proposal 草稿表单），
或显式裁决「split/merge 只能由 agent run 产生」并在 UI 标注来源——二选一，
倾向前者（半接面是债）。

### C4 `steward-surface-resolution`（spec 收口，小）

对 2026-09-11 裁决做终局：本计划倾向**正式退役 Manager 入口**（后端保留为
agent 内部面），同步改写 `steward-product-workflow`/`agent-steward` specs，
清掉 SessionsSettings 的 kernel-only 残留解释。若 codex/用户认为需要入口，
则反向恢复最小 StewardView——默认不走这条。

### C5 `webui-debts-sweep`（小项打包）

CodeMirror 懒加载、AppSidebar 完整化、General 偏好分区（主题/语言起步）、
new 模式草稿校验（validate 走草稿内容而非磁盘）、stale 注释清理、两处 archive
未勾 tasks 的补测试收尾。

## 序与依赖

```text
C4（spec 收口，独立先行，半天级）
  -> C3（独立，小-中）
  -> C1（核心；依赖裁决：seed 会话形态）
  -> C2（依赖 C1 的 Test 子视图落位）
  -> C5（随时可插，最后清场）
```

## 给 Codex 的复核问题

1. C1 第一版选「agent 面板 seed 会话」还是「移除 tab 推迟」？seed 形态选
   纯前端预填 prompt（零后端）还是新 RPC（creator.test.seed）？
2. C2 评估 case 的存储位置裁决：技能目录内约定 vs workspace 私有？
3. C4 默认退役 Manager 入口是否符合 2026-09-11 裁决的本意？
4. 切分/顺序是否需要调整（例如 C5 中的 CodeMirror 是否应该并进 C1——Test
   场景与编辑器场景共享代码高亮诉求）？
5. 各 change 的验收语义（特别是 C1/C2 的「测试通过」如何客观判定）。

## 验收纪律（用户指令）

全部 changes 完成后：vision 子代理先自行走查（桌面 + 窄屏、真实 daemon、
console/overflow/contrast/disconnected 全查），确认使用体验无问题后才请 Owner
参与走查验收。
