# Proposal: workspace-page-polish — 单 Workspace 专注清理 + 二级页面打磨

## Why

Owner 裁决（2026-10-04）：「目前我们已经专注于『单个 Workspace』。但是界面上
仍然存在 Multi-Workspaces 的一些设计痕迹，好好走查一下」+「大部分一级导航
看起来还可以，但是二级页面的细节和布局都没有打磨，让 vision 子代理基于
world-class-designer 打磨所有 Workspace 的页面」。

## What Changes

- **痕迹清理**（audit-multi-workspace-traces.md 的 5 项违规 + 3 件死代码）：
  V1 wiki 返回按钮死路由→当前 ws 上下文；V2 五条 ws 命令硬编码 ~ → 当前 tab
  wsId + 删退役 Repository 命令；V3 CreatorHome Global 空态不列全 ws 按钮；
  V4 安装目标多选默认当前 ws（其他收次级）；V5 composer $ 菜单当前 ws 置顶
  分组（跨 ws 能力保留，折叠其他）；死代码删除（WikiHome/EvaluatingPage/
  app-sidebar）。
- **二级页面打磨**（清理后）：vision 子代理按 world-class-designer 批评协议
  逐页走查 Workspace 全部二级页（skills detail/creator 编辑器子视图/wiki
  detail/repos scan/settings 分区），产出问题清单 → 处置批 → 复评收口。
- 台账（不在本 change 处置）：Agents 屏社区根重复投影计数失真（audit §独立
  立项建议）；omnibox ws 补全 label 用原始 id；Global 页脚 ws 管理区与 tab
  右键双入口收纳（Owner 裁决项）。

## Impact

- webui：wiki/creator/repository-scan/composer/commands 的上下文化修正 +
  死代码删除；二级页面样式打磨（token 内）。
- 排除域：apps/agent/**（zcode-parity 重做中）、apps/evaluating/**
  （world-class 重做中）、一级导航壳（已过）。
