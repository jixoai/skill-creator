# Proposal: skills-workspace-world-class — Skills 工作区世界级打磨

## Why

Owner 评价（2026-10-05）：「改进空间还非常大」——全面 review 确认三屏 dashboard 已达功能完整、结构清晰基线，但用户体验流的连续性、概念简洁度、视觉层级三维度仍有显著摩擦（37 条 findings，P1×6）。最大机会聚焦在：duplicates 概念歧义（「这个功能很奇怪」）、Agents 屏双入口混淆、扫描/详情的上下文断裂、IntelligenceView 定位模糊、WorkspaceManager 窄屏不可用（P0）。

review §4 推荐结构性重组（Agents 屏保留强化差异化、RepositoryScan 子路由内修、IntelligenceView 改名+分区、duplicates 降级呈现）与 §6 Owner 再裁决清单——本 change 以此为基线。

## What Changes

- **Agents 屏差异化强化**（R-A1，FD-03/09/19 处方）：卡片承载 chips 承担不了的信息——真实路径、可写性、磁盘可用性、per-provider findings/proposals 待审计数徽标、主按钮区与次要操作区视觉分隔。点击卡片仍是筛选联动（保留双入口但以信息价值差异化消除困惑）。
- **RepositoryScan 子路由内修**（settled 不翻案，FP-01/02/03/04/13）：?session= 进 URL + targets sessionStorage；sessionExpired 灰态+单一恢复路径；安装结果失败分组前置+原因；面包屑 Repos ‹ label；installing 内联进度。
- **IntelligenceView 重定位+分区**（R-I1+R-I2，FP-05/06/07/08/12）：路由段 intelligence→insights + ?skill= 上下文参数；页内 Analysis（findings+关系图）/ Proposals 两区锚点分区；术语清理（kind→动词、capability 降级、siDraft→Draft、observedRevision→Analyzed version+stale 前置）。
- **duplicates 降级呈现**（§5 O2，Owner 待批）：行徽标保留；header 开关收进 Search config 同级位（高级过滤），文案改 Same content in N locations；RPC/store 全保留。
- **WorkspaceManager 窄屏卡片化**（FP-09 P0）+ missing amber 化+行级 Refresh（FP-11）+ 删重复 path 列（FP-10）。
- **逐屏打磨**（§3 findings 处方）：chips 横滚 affordance、header 计数视觉权重、补全条区分已载/未载、Chat 按钮上下文衔接、焦点恢复加固、Load more 反馈、虚拟化行高复查、深链滚动 reduced-motion、最近扫描相对时间、新增源实时校验。
- **代码内务**：skills-screen 重连补救段删除（FD-14）、Footer librarySnapshot 死分支删除（FD-21）。

## Impact

- webui：/w/:wsId/skills 三屏（Skills/Agents/Repos）样式打磨 + Agents 卡片信息扩展；/w/:wsId/skills/repos/scan/:sourceId 状态持久化+结果重组；/w/:wsId/skills/intelligence/:providerId 改名→insights + 分区 + 术语清理；/workspace 窄屏卡片化+交互修正。
- 非目标：provider-catalog-dedup 投影（独立批）、URL search 参数结构重构（破坏性收益低）。
