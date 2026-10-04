<!--
文件意图（2026-10-04）
用户原始需求（Owner 裁决）：「Agents 屏重复投影……基本同意（独立立项），你最好和 Codex 商量着来。」
正交意图：[1] 立项提案骨架供 Codex 联审；[2] 固化审计 O1 证据与设计张力。
妥协声明：design/tasks 待联审后补——本文件是讨论起点不是定案。
-->

## Why

Agents 屏 provider 目录投影数据失真（workspace-page-polish audit O1 实证）：
Provider catalog 把 76 个社区 Agent 约定根全部投影进**每个** workspace 当独立
provider；物理上同一目录（如 `~/.agents/skills`）被 ~10 家工具约定共享，未按
物理路径去重 → Alpha 工作区「All 58」实际 3–4 个物理技能，计数虚高一个数量级；
连带拖累 Global 页「N agent locations」文案可信度（225 个「位置」多为同一目录
的多重投影）。

## What Changes（提案骨架，待联审）

1. **投影去重**：Provider 投影以**物理根**（realpath）为聚合主键；同一物理目录
   的多家工具约定聚合为一行——工具名成为该行上的「声明者」标签而非独立卡。
2. **口径重定义**：`skillCount` / `available` 按物理根计一次；provider 数语义
   变为「声明工具数」（label 级信息）；Global「N agent locations」= 物理位置数。
3. **少即是多**（Owner 品味总纲）：Agents 屏从 76 卡收敛为实际物理位置行
   （通常 <10），声明工具以 chip/次级文案呈现。
4. 「基本同意」的边界：不改 catalog 约定本身（发现面照旧全量），只改**投影与
   计数聚合层**（provider-roots.ts / daemon catalog 投影）。

## 张力点（联审议题）

- realpath 解析时机与成本（boot 快照 vs 惰性；symlink 链）
- 声明者标签的展示密度（76 个名字在一行上怎么放——截断/浮层/计数）
- Imported ws 与 Global 两种作用域的投影是否同口径
- 与 skills search canonicalize（已有 realpath 去重）的复用关系

## Verification（草案）

- Alpha 型 fixture（多工具共享同一目录）：Agents 屏一行一物理根、计数=物理
  技能数、声明工具可见
- Global locations 计数 = 物理位置数（快照口径同步）
- 聚焦测试 + webui check + 冒烟锚点（librarySnapshot 文案语义更新）
