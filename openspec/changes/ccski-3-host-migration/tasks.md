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

- [x] ccski-symlink-entries 切换调用点 → 删 wrapper（三步序） — skill-service + workspace-registry — wrapper-retirement-receipt.md（fixture 语料 all:true/all:false 两形状，消费口径 7 字段逐行全等，漂移行=0；调用点直连 ccski 3.0 listSkills 后聚焦测试 51/51）
- [x] state-backed disabled 补充面（批 2 遗留边界闭合：摘链后 UI 仍见/可重启） — src/daemon/ccski-state-disabled.ts + skill-service list 合并 — skill-service 测试（12/12：禁用后同 id disabled 行在场 + 补充行 info 可读[skillFile 对侧回退] + includeDisabled=false 不补 + re-enable 摘链-重链往返闭合 + 坏 state JSON 零补充降级不计错）
- [x] canonical 层区分逻辑名/folderName/实体路径/投影路径 — shared projectionPath 契约 + skill-service（path=canonical 实体路径、projectionPath=投影路径、directoryName=folderName）+ detail 面板双路径/folderName 徽标 — 契约断言（skill-service 测试）+ dom 测试（13/13）
- [x] webui 启停文案随物理禁用语义复核 — skill-detail-panel toggle title/aria 按 ccski link 投影（摘链/重链）vs 其余（改名）双语义；i18n en/zh 成对四键 — dom 测试（三态文案 + 双路径/单路径断言）

## 批 5 · 内核感知卸载（走查 F-3 补）

> 走查 W8 发现：安装面已内核化（实体+投影+state 记账）而卸载面仍直删文件系——
> Creator 删 entity face 留悬空投影链 + stale state 记录；删 symlink face 被
> containment 拒（Internal server error）。removeEntityProjections/deleteEntity
> 在宿主零引用。这是迁移的必然连带缺口（旧直删在 2.x 复制模型下是完整的，
> 在 3.0 投影模型下产生残留），按 Owner「不希望有残留」补齐。

- [x] remove 双路由：ownership==="ccski" 的技能删除走 removeEntityProjections（单 face）/末投影升级全清（实体 face 带投影 = 全部注册投影根摘除 + 内核 last-reference GC 退役实体；零投影 = deleteEntity 受 GUARD_ENTITY）；非 ccski 保留现有直删 — creator-service + 新 ccski-entity-remove（state 镜像路由 + typed 词表映射）+ ccski-state-disabled（导出信封读取器）— 契约测试 test/ccski-entity-remove.test.ts 9/9（单 face 存活断言 / 末投影与实体 face[W8 复现]零残留断言[无悬空链+无 stale state 记录] / disabled 投影记录退役 / 非 ccski 直删回归 / GUARD_ENTITY+GUARD_PROJECTION conflict 映射不透传 / 宿主 revision 契约拒绝零副作用 / state 缺失·不兼容·实体记录缺席保守拒绝）
- [x] 整 change spec deltas 补全（strict 从缺 delta 失败 → 通过）— specs/{manager-workbench,manager-core,skill-registry}/spec.md（MODIFIED×2：Repository 两阶段安装+复核链、Creator 删除双路由；ADDED×4：toggle 双路由+禁用补充行、update 单源 hash+代际收敛+lockSyncPending、canonical 四名、state-backed disabled 补充面）— `openspec validate ccski-3-host-migration --strict` exit 0

## 批 4 · 门禁与走查

- [x] 五件套全绿 + dev 沙箱全链走查（安装/更新/启停/移除/发现含 symlink 实数据） — walkthrough-evidence.md（W1-W8 三元组；全链通过 + 三项走查发现 F-1/F-2/F-3 如实记录） — 门禁数字见 host-receipts-summary.md（test 2393/2393 ×2、typecheck/webui check/build/fmt[任务文件]/diff-check/pack 全 exit 0；已知 watcher 抖动未出现）
- [ ] store-link-kernel 批 6 第 2/3 项回勾（host 无漂移收据）+ 本 change archive 裁决 — 两仓 openspec — host 收据已备齐（host-receipts-summary.md），跨仓回勾与 archive 由 MainAgent 执行

## 批 6 · 宿主修复（Codex 终审 4/10 否决项）

> 五批提交后的终审否决项修复：P0-1 更新绕过物化投影守卫删用户修改、
> P0-2 state 降级后实体根删除回落直删、P1-4 state 镜像伪造路径越界读、
> P1-5 GitHub 默认分支硬编码 main、P1-6 退役收据不可独立复核 + 三项质量项。

- [x] P0-1：apply 逐投影收据裁决——updateEntity 顶层 ok 不再触发 legacy 清理；该 root 收据 failed（GUARD_PROJECTION 家族）= 如实失败保留被改副本，legacy 收敛仅在收据缺席（root 未注册）时执行 — skills-update-service — 回归测试（真实内核 GUARD_PROJECTION 物理：用户修改保留 + state 仍 materialized + 覆盖层不刷；mock 边界：failed 收据后 ensureEntity/projectEntity 不可达）
- [x] P0-2：实体根 face（provider root === `<ws>/.agents/skills` 实体库根，与删除路由同源 helper）上的删除无论 ownership 标注不得直删——非 ccski（state 降级标 unknown）保守拒绝 INVALID_OPERATION 指路 state repair — creator-service（writableDirectory → writableScope 取全量 scope）— 集成测试（损坏/缺失 state：实体与全部投影原样、无悬空链；普通 provider root 直删不回归）
- [x] P1-4：state 镜像路径绑定校验下沉共享层（ccski-state-disabled 导出 ccskiEntityLibraryRoot/ccskiEntityPathBound/ccskiProjectionPathBound）——实体路径词法 + realpath 双 containment 绑定 `<stateBase>/skills/<folderName>`、投影路径绑定 `<rootPath>/<folderName>`、SKILL.md lstat 拒符号链接；disabled 补充面与 ccski-entity-remove 删除路由双消费同源 — ccski-state-disabled + ccski-entity-remove — fixture 断言（外部实体目录/库内逃逸 symlink/符号链接 SKILL.md/伪造投影路径全拒绝 + 合法记录对照仍补行；删除路由伪造实体 path 保守拒绝、伪造投影 path 视为 face 缺席）
- [x] P1-5：GitHub 无 ref 探针先解析真实默认分支（git ls-remote --symref，不占 API 限额、daemon 生命周期缓存；解析失败按探针不可达，不猜 main）— skills-update-service（新增 resolveDefaultBranch 注入面）— 测试（非 main 默认分支探针 URL 断言 / 有 ref 不解析 / 解析失败 unavailable 且零探针请求 / 本地 git 沙箱真实 symref 解析）
- [x] P1-6：退役收据可独立复跑——scripts/ccski-wrapper-receipt.sh.ts 生成器入库（wrapper 半边经 git show fe52b62^ 恢复动态 import，与当前 ccski 直连同 fixture 双形状复跑）；结构化原始收据 JSON + md 逐字段值表（行键出表格单元格杜绝 `\|` 拆列；fixture 路径归一化，复跑 diff 为空）— scripts/ + wrapper-retirement-receipt.{json,md} — 复跑确定性实测（双次 diff 为空，drift = 0）
- [x] 质量项：readCcskiState 非 ENOENT 判定改运行时类型守卫（isErrnoException）；40-hex 收敛语义如实化为「daemon 生命周期内一次」（manager-core delta Requirement + Scenario 措辞，覆盖层为内存态、重启后 lock 仍 40-hex 则再收敛）；skills-update-service 职责聚合注记进 proposal 后续注记（不动代码）
