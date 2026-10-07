# Tasks: ccski-3-host-migration

> 前置：ccski 3.0.0 publish（Owner 决策）后开工。

## 批 1 · 依赖 + import 面审计

- [ ] package.json ccski `^2` → `^3.0.0` + 安装 + 五件套基线绿 — package.json — 无
- [ ] 全仓 ccski import 逐点审计清单（对齐面/mutation 面/退役符号引用三分类；应零退役符号残留） — 审计清单进 change 目录 — typecheck

## 批 2 · mutation 调用点迁移

- [ ] repository install → ensureEntity+projectEntity（installedSkillId 复核链保留） — src/daemon/repository-service.ts — repository 契约测试
- [ ] skills-update：apply 换实体 update + computeSkillFolderHash 单源（删本仓第二实现）+ lockSyncPending 诚实化 — src/daemon/skills-update-service.ts — update 契约测试
- [ ] hash 代际裁决落地：存量 40-hex lock 条目 → stale 一次重装收敛（负例：不伪装成功） — skills-update-service — 契约测试
- [ ] toggle → toggleEntityProjection 适配（link 摘链语义；conflict 投影原样） — src/daemon/skill-service.ts — skill-service 测试

## 批 3 · wrapper 退役 + canonical 命名

- [ ] ccski-symlink-entries 切换调用点 → 删 wrapper（三步序） — skill-service + workspace-registry — 无漂移复跑对照表
- [ ] canonical 层区分逻辑名/folderName/实体路径/投影路径 — dashboard-canonical + skill-service — dom/契约测试
- [ ] webui 启停文案随物理禁用语义复核 — webui — i18n + dom 测试

## 批 4 · 门禁与走查

- [ ] 五件套全绿 + dev 沙箱全链走查（安装/更新/启停/移除/发现含 symlink 实数据） — 走查证据 — 无
- [ ] store-link-kernel 批 6 第 2/3 项回勾（host 无漂移收据）+ 本 change archive 裁决 — 两仓 openspec — 无
