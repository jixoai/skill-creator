# Proposal: skill-wiki incubation — 经验→知识库→技能演化（WikiSkill 移植，P1 合并）

## Why

用户裁决 [2026-09-21]：v1 功能补齐中，Context7 方向否决（外置依赖走未来
插件体系）；**P1（用户知识追加+去重）与 skill-wiki 合并**——「P1 本质上
就是在收集一些碎片的认知，这和 skill-wiki 有重叠，是 skill-wiki 输入的
一部分，所以要放在一起做」。

skill-wiki 概念源自 WikiSkill 论文（arXiv:2608.27454，Google Research
2026-08：三层知识架构 raw/wiki/skills + 四 agent 演化循环 + gating 回滚）。
用户已注册 npm 名，计划作为 **monorepo 子包在本仓孵化，稳定后独立发布为
标准包**——与 ccski 之于 skill-creator 的关系同构：纯领域库，不认识
daemon/WebUI。

v2 已有论文地基的四块同构（见 design）：steward 事务≈gating、转录存储≈
raw、skill-search 索引≈wiki 检索面、Agent Role≈四 agent 编排。缺的是
**Wiki Layer 数据结构 + 演化输入通道**。

## What Changes

- **P1 `packages/skill-wiki`（切片①，TS 库 + Zod 契约）**：
  - WikiWorkspace：`wiki/` 目录契约（`index.md` / `logs.md` /
    `skill-impact.md` / `patterns/<name>.md`）+ 双级作用域（global `~`
    与 per-workspace 侧车目录 `<appDir>/wiki/<scope>/`，不污染用户技能
    资产；schema 预留 `origin/promotedFrom` 供 global 升格）
  - patch 引擎（append/replace/insert_after 精确子串锚定，typed 失败）
  - contentHash 去重追加（P1 语义升格为 wiki 输入通道）
  - 分层轨迹采样（论文附录 C：≤5 失败 + ≤3 通过、15k 字符 cap）
  - gate 决策接口（评分无关的 accept/reject + skill-impact 记录格式）
  - **不管理 skills 层**（host 职责；提案输出经 host 对接 creator/steward）
- **P2 daemon + RPC（切片②）**：`wiki-service`（scope 解析 + workspace
  生命周期）+ `wiki.list/read/append` RPC（wiki 为 skill-creator 自有
  数据，direct mutation，不走 proposal 审批链）。
- **P3 WebUI 最小通道（切片②）**：WorkspacesHome workspace 卡的 Wiki
  入口 → wiki 视图（patterns 列表 + 前端过滤 + 碎片认知追加表单）。
  全局检索接入 skill-search 留切片③决策（MVP 量小前端过滤足够）。
- **不做（本轮明确出界）**：四 LLM agent 编排（Maintainer/Proposer
  roles + 会话后 consolidation + global 升格自动化）＝切片③下轮；
  PURPOSE.md 文件（职责由 frontmatter description + skill-impact 承载，
  不足时优先扩展 frontmatter 字段）；论文 prompts 移植（切片③按产品
  语境重写，结构借鉴，避免 CC BY 署名链；py 参考 MIT 仅算法核移植）。

## Impact

- 新增 `packages/skill-wiki`（workspace member；孵化期不发布 npm）。
- daemon：`wiki-service.ts` + rpc-contract `wiki.*` 组 + domain 装配。
- WebUI：Workspaces app 的 wiki 视图 + store。
- 契约：新 `src/shared/contracts/wiki.ts`。
- 索引/skills/steward 零改动（wiki 侧车目录不在 provider roots 内，
  不进 skill-search 索引；切片③再议）。
