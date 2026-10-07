# Tasks: ccski-3-host-migration

> 前置：ccski 3.0.0 publish（Owner 决策）后开工。

## 批 1 · 依赖 + import 面审计

- [x] package.json ccski `^2` → `^3.0.0` + 安装 + 五件套基线绿 — package.json — 无（Owner 批准迁移期 `file:../ccski` 本地链；`^3.0.0` 正式 bump 由 MainAgent 收尾。pnpm file: 为快照拷贝，dist 与兄弟仓 3.0.0 逐位一致）
- [x] 全仓 ccski import 逐点审计清单（对齐面/mutation 面/退役符号引用三分类；应零退役符号残留） — 审计清单进 change 目录 — typecheck（import-audit.md 落盘；源代码退役符号残留 = 0，测试 seam 引用随批 2 重写清零）

## 批 2 · mutation 调用点迁移

- [x] repository install → ensureEntity+projectEntity（installedSkillId 复核链保留） — src/daemon/repository-service.ts — repository 契约测试（16/16：两阶段物理断言 + typed error 映射不透传 + 复核链负例 + force 清障）
- [x] skills-update：apply 换实体 update + computeSkillFolderHash 单源（删本仓第二实现）+ lockSyncPending 诚实化 — src/daemon/skills-update-service.ts — update 契约测试（36/36）
- [x] hash 代际裁决落地：存量 40-hex lock 条目 → stale 一次重装收敛（负例：不伪装成功） — skills-update-service — 契约测试（收敛后 recheck already-current；GUARD_ENTITY 负例不刷覆盖层）
- [x] toggle → toggleEntityProjection 适配（link 摘链语义；conflict 投影原样） — src/daemon/skill-service.ts — skill-service 测试（11/11：真实内核摘链/物化回路 + seam 冲突映射 + 非 ccski 保留路径）

## 批 3 · wrapper 退役 + canonical 命名

- [ ] ccski-symlink-entries 切换调用点 → 删 wrapper（三步序） — skill-service + workspace-registry — 无漂移复跑对照表
- [ ] canonical 层区分逻辑名/folderName/实体路径/投影路径 — dashboard-canonical + skill-service — dom/契约测试
- [ ] webui 启停文案随物理禁用语义复核 — webui — i18n + dom 测试

## 批 4 · 门禁与走查

- [ ] 五件套全绿 + dev 沙箱全链走查（安装/更新/启停/移除/发现含 symlink 实数据） — 走查证据 — 无
- [ ] store-link-kernel 批 6 第 2/3 项回勾（host 无漂移收据）+ 本 change archive 裁决 — 两仓 openspec — 无
