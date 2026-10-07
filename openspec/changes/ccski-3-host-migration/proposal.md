# Proposal: ccski-3-host-migration — 宿主切换到 ccski 3.0 内核

## Why

ccski `store-link-kernel`（3.0.0，发版门全过、未 publish）已完成 store-and-link 主内核演进：两阶段安装（ensureEntity/projectEntity）、symlink 一等发现（canonicalPath/entryKind/ownership）、物理禁用、投影先行 remove + 实体 GC、稳路径 update、四维护命令、`computeSkillFolderHash` 单源导出；**2.x mutation API（installSkills/removeSkills/toggleSkills 等 16 导出 + 九型）已全部移除**。skill-creator-v2 仍钉 `^2`——本 change 完成宿主切换，是 store-link-kernel 批 6 跨仓项（tasks 第 2/3 项）的承接。

## What Changes

- **依赖与策略前置**：ccski 3.0.0 publish（Owner 决策，`^2` 消费者不受破坏）→ 本仓 bump `^3.0.0`。
- **repository install 换内核**：repository-service 的 `installSkills` 调用点 → `ensureEntity + projectEntity`；**保留** installedSkillId 的 direct-child/regular SKILL.md/frontmatter/重新发现/validate 整条复核链（ccski 内核防线不替代宿主防线）。
- **skills-update 三件**：apply 侧换实体 update 内核 API（2.x 重装路径已退役）；hash 对比改消费 `computeSkillFolderHash` 单源（删除本仓第二实现防漂移）；**hash 代际裁决**——存量 lock 的 40-hex 旧算法条目（G0 实证）视为 stale 触发一次重装收敛；apply 结果诚实携带 `lockSyncPending`。
- **toggle 适配**：skill-service 的启停路径（2.x `toggleSkills` 退役）→ `toggleEntityProjection`（link 摘链物理禁用语义；UI 文案随 per-provider 禁用语义复核）。
- **ccski-symlink-entries 三步退役**：①ccski 3.0 已发布（发现层一等）→ ②切换宿主全部调用点（skill-service/workspace-registry）→ ③删 wrapper；无漂移复跑（provider/sourcePriority/canonical path/mutation target 对照）后才删。
- **canonical 层命名区分**：dashboard-canonical/skill-service 区分逻辑名/目录名（folderName）/实体路径（canonicalPath）/投影路径——对齐 3.0 SkillMetadata 增量字段。
- **import 面审计**：creator-service/wiki-service/skill-search scanner/workspace-registry/cli 的 ccski import 逐点核对——list/info/validate/search 对齐面不动，mutation 使用点全部迁移。

## Impact

- src/daemon/{repository-service,skills-update-service,skill-service,ccski-symlink-entries(删),workspace-registry/*}、webui 启停文案、package.json 依赖。
- 非目标：MCP/CLI 面的 canonical 投影同步（后续批）；ccski Windows 实机验证（ccski 仓平台门）；npm lock 写入（分层单写者恒定）。
- 后续注记（Codex 终审质量项，不在本批动代码）：skills-update-service 的职责聚合度偏高（lock 读取 + 上游 hash + 内核重装 + 覆盖层四类关注点同文件），后续 change 应评估按「上游探测 / 内核重装编排」物理拆分。
- 验收：store-link-kernel tasks 批 6 第 2/3 项勾选（host 无漂移复跑收据）+ 本仓五件套门禁 + dev 沙箱走查（安装/更新/启停/移除全链真实交互）。
