# Proposal: skill-wiki-maintainer（切片③：LLM 认知蒸馏）

## Why

skill-wiki 的双级模型已经闭环：workspace 承载碎片认知（P1 摄取 + hash 去重 +
相似警告），global 承载泛化认知——但「泛化」目前只有语义占位：`promotedFrom`
字段预留、i18n 词汇定义了「LLM Maintainer 把 workspace 认知蒸馏进 global
（新建页面或经 patch 吸收）；workspace 原文永不删除」。Owner 明确纠正过：
**泛化 = LLM 蒸馏，非机械搬运**。本切片补上这条链路的宿主编排。

## What Changes

- **Maintainer 编排落在宿主（skill-creator daemon），SDK 保持纯领域库**：
  skill-wiki 不引入 LLM 依赖；蒸馏的编排（语料收集 → 模型调用 → 产物校验）
  由 daemon 的 agent kernel（dsh-base headless，既有 create/manage persona 与
  model routes）执行
- **触发面 v1 = 手动**：
  - CLI：`skill-creator wiki distill --workspace <label|ws_id|路径>`
    [--limit N] [--json]（进程内 kernel，与 wiki 子命令同模式）
  - GUI：WikiScopeView 的 workspace scope 加「Distill to global」入口
    （进度与产物经现有 proposal 面审阅）
  - 自动触发（gate 后钩子/定时）为 Non-Goal
- **写路径走审批**：蒸馏产物是结构化提案集（每项 = create 新 global pattern
  或 absorb 进既有 global pattern 的 patch），经 MCP proposal 链（与
  wiki_append_propose 同一 authority 红线）逐项人工审批后执行；
  执行时在 global pattern 上盖 `promotedFrom`（来源 workspace + pattern 名单），
  workspace 原文零改动
- **审计**：机器真相 = run 目录内 `proposals.jsonl` ledger（逐项状态/哈希/
  结果，见 design §5）；global logs.md 只追加一行**人读**摘要（不作 machine
  truth）；蒸馏输入快照与模型原始输出落 `<appDir>/wiki-distill/<runId>/`
- **SDK 侧新增（两段式）**：蒸馏提案 Zod 契约 + `planDistillation`（纯校验/
  哈希计算）+ `applyDistillation`（单项原子落盘 + promotedFrom 合并 +
  崩溃可恢复的 intent/commit 判定，见 design §3）

## Non-Goals

- 不做自动触发/定时蒸馏（v1 手动；自动触发等真实使用反馈）
- 不改 workspace patterns（原文永不删除是红线；跨 workspace 合并也不做）
- 不在 SDK 引入 LLM/网络依赖
- 不做蒸馏产物的 GUI 专用 diff 视图（v1 复用 proposal 面的通用审批）

## 影响面

- packages/skill-wiki：distill 契约 + applyDistillation + 测试
- src/daemon：wiki-distill 编排服务（kernel 调用 + 提案集生成 + proposal 桥）
- src/cli：`wiki distill` 子命令（cli-kit extraCommands）
- webui：WikiScopeView 入口（workspace scope）
- MCP：`wiki_distill_apply_propose` 随 capability 自动投影（公开面；安全由
  handler 的 run-registry digest 校验承担，输入不含提案体——design §5）
