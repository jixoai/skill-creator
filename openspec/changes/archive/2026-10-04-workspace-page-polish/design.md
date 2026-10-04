# Design: workspace-page-polish

## 背景与范围

Owner 指令（2026-10-03）：「目前大部分一级导航看起来还可以，但是二级页面的细节和
布局都没有打磨，让 vision 子代理基于 world-class-designer 打磨所有 Workspace 的
页面」+「目前我们已经专注于单个 Workspace。但是界面上仍然存在 Multi-Workspaces
的一些设计痕迹，好好走查一下」。两问合一个 change：先走查清理 multi-workspace
痕迹（audit-multi-workspace-traces.md：5 违规 + 3 死代码），再对全部二级页跑
world-class-designer 批评环。

## 批评环轨迹（2.1 → 2.3）

| 轮 | 分 | 判定 | 处置 |
| --- | --- | --- | --- |
| 2.1 走查（33 帧证据） | 7.2 | 未达线 | P1×3 + P2×10 处方 |
| 2.2 处置批 | — | P1×3 全修 + P2 全做（+NUL 转义/settings 行话补刀） | 110/110 |
| 2.3 换新批评者复评（29 帧） | 8.2（+1.0） | 12/12 修复面有效、零 P1/P2 遗留；**停止条件成立** | P3 顺带批 ×3 |

页面均分（2.3）：Settings 8.0 / Wiki 7.7→有效修复 / Skills / Creator / Repos 全部
六维 ≥8.0。停止条件依据：剩余 4 项全 P3（2 项 ≤0.2 分小修已顺带处置、1 项文案
已补刀、1 项 Owner 裁决），继续独立批评轮预期分差 <0.5——收益低于轮次成本。

## 关键裁决

1. **安装目标默认**（P1-1）：默认勾选收敛为当前 tab workspace 的可写 provider
   （Global 不预填）；selected > 10 时 Install 前确认对话框（计数 + 目标清单）。
   ExpectedInstallTarget 服务端验证链不变——只改默认面与确认步。
2. **批评的 CSS 可证事实优先**：2.1/2.3 两轮均以 DOM 计量/像素采样复核视觉判读
   （沿用 evaluating 批评环的证伪传统）。
3. **`$` 菜单分组无需活会话**：registry 驱动，2.3 实证分组头齐现（2.1 的「需活
   会话」前提比实际验收面更严）。

## 遗留（报 Owner / 后续批）

- **Owner 裁决**：Global 页计数口径统一（同屏 200/2594/76/225 四数打架——渲染
  上限 vs 库总量 vs 物理位置 vs catalog provider 数，需先裁决屏上真相语义）。
- **i18n B 线收尾批**：settings 分区组件整体 i18n 化（当前英文硬编码形态）。
- 环境注记：dev 沙箱 kernel 挂载为环境级偶发差异（2.1 挂载 94 entries / 2.3 因
  `.pnpm/node_modules` 陈旧 symlink + session-telemetry-otel 插件链失败未挂载），
  不归因本 change 修复面。
