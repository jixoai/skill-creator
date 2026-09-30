# WebUI 残留工作计划（终稿索引版 2026-09-30）

> 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
> 测试与评估，你整理一份工作计划（可能是几个 changes），你和 codex 去讨论讨论。
> 等全部做好了再让我来参与走查验收。切记，你让 vision 子代理自己去尝试走查验收
> 确定使用体验没问题再来找我。」

**本文档只是索引与复核台账**（r4 复核结论：契约散落多文档产生漂移——单一
契约源 = 各 change 的 proposal/design/spec/tasks，本文不再复述契约文本）。

## Changes 与唯一契约源

| # | change | 契约源 | 状态 |
|---|---|---|---|
| Ch1 | steward-surface-closure | archive/2026-09-30-steward-surface-closure/ | ✅ 归档 e2eb536（codex r4 裁定边界关闭） |
| Ch2 | creator-test-session | openspec/changes/creator-test-session/ | 实现 039e10f（store/面板/模板/元数据/8 例测试，含真实内核网关 1 例）；vision 走查待 WS4 |
| Ch3 | evaluation-corpus | openspec/changes/evaluation-corpus/ | 契约冻结；实现未开始 |
| Ch4 | intelligence-proposal-parity | openspec/changes/intelligence-proposal-parity/ | 契约冻结；实现未开始 |
| Ch5 | creator-editor-polish | （未立；CodeMirror 懒加载 + 草稿校验） | 待立 |
| Ch6 | shell-settings-ui | （未立；AppSidebar + General 偏好） | 待立 |
| Ch7 | docs-archive-hygiene | archive/2026-09-30-docs-archive-hygiene/ | ✅ 归档 04e2a91（Purpose 三连 21/21 + stale 注释 + 归档债注记） |

## 序（codex r3/r4 裁定一致）

```text
[done] Ch1 -> [done] Ch2 实现 -> Ch4 接线（依赖 Ch2 seed）
  -> Ch3 实现（analyzer 数据层可并行；provider runner 依赖 Ch2 的 daemon 侧会话面）
  -> Ch5/Ch6 清场 -> WS4 vision 自走查（1100/680 + 真实 daemon + Ch2 链路端到端）
```

## 复核台账（codex 大地三 ws3-codex-review）

| 轮 | 基线 | 分数 | 关键结论 |
|---|---|---|---|
| r1 | 盘点计划 r0 | 6.2 | 事实纠错 + 五 P1（引用接线/模板/评估 schema/双 store/退役边界） |
| r2 | r3 计划 | 7.0 | Ch1 边界认可；wire 级缺口七项 |
| r3 | r4 计划 | 7.2 | 方向关闭；A′/B′/C′ 补遗被要求（round 内评价「仍非判别联合」） |
| r4 | 52301dc（不含实现 039e10f） | 6.8 | 契约多文档漂移是病根；expectTrigger 布尔映射错误等真缺口；**单一契约源 + 实现即证据** |
| r5 | HEAD（含 Ch2 实现） | 待评 | —— |

## r4 真缺口的处置（落对应 change docs，不回填本文）

- Ch2：实现已含 `$token` 渲染修正（039e10f 测试实证）；A1 补 `ComposerReference →
  ComposerReferenceInput` 的转换语义（uid 由 registry 生成、调用方构造其余字段）。
- Ch3：expectTrigger 是**布尔**——断言映射改 `finding-triggered`（布尔触发断言，
  analyzer 语义：期望 finding 触发/不触发）；corpusDigest（语料域）与
  boundRevision（技能文档域）分字段；result Zod 判别联合含「error 不得携带
  unavailable 族码 / unavailable 不得携带 runner 族码」互斥 refine 与
  `assertions.min(1)`；run.cancel 返回 `{runId, status}` + 竞态胜者（completed
  后 cancel 幂等返终态；running 时 cancel → cancelled 且已有结果保留）。
- Ch4：四 capability 输入改 action 判别联合（split/merge 多源 target+revision 数
  组）；复用 ProposalPayloadSchema；kernel 工具名 `intelligence_propose_*` 与
  MCP `intelligence_propose_*_propose` 命名冻结（对齐 wiki_append →
  wiki_append_propose 既有惯例）；UnifiedProposalView 补全 schema + `mcp:`/`si:`
  前缀与既有 id 的映射规则；daemon 侧 provider-model 会话 adapter 接口冻结
  （create/prompt/references 展开/transcript 读/cancel/version——Ch3 runner 消费，
  不依赖 webui store）。
