# Tasks: creator-skill-store

## 批 1 · daemon：store 服务 + 内核应用链

- [x] creator-store-service：list/create/save/remove（revision 契约沿用；store 枚举 safeParse 收窄） — src/daemon/creator-store-service.ts（新） — 契约测试（10/10）
- [x] apply/sync/uninstall/status：ensureEntity/projectEntity/updateEntity/removeEntityProjections 直连 + typed 有限映射 + auto-apply（默认 roots=[~/.agents/skills]） — 同上 — 契约测试（entity-local 收据/多 root symlink/sync 收敛+degraded fail-closed/末投影 GC+store 原样/零投影 deleteEntity/GUARD_PROJECTION 保护）
- [x] contracts + rpc-contract：CreatorStoreSkill/ApplySkillResult 等增量 — src/shared/ — typecheck 0 + 契约测试
- [x] creator-service new 模式目标改 store（providerId 退出 new 身份；edit 不动；程序化旧语义收窄为内部 createInWorkspace——steward/intelligence/scripts 调用点全迁移） — src/daemon/creator-service.ts — 回归 130/130（含 agent-proposals/dsh-tool fixture 迁移，MainAgent 补刀）
- [x] 负面钉死：创建面永不直写 provider root/实体库根（resolveWritable 不再被 new 消费） — 测试断言（never resolves a writable provider scope from the creation face）

## 批 2 · webui：store 化创建 + 应用面

- [x] new 路由 store 化（providerId 退出 new 参数；CreatorHome 引导创建对 Global 激活） — manifest + CreatorHome/CreatorWorkspace — route-match/route-hygiene/deeplink 回归 + store 编辑/创建 dom 测试（旧 `new/:providerId` 形态跨 Activity 拒绝钉）
- [x] FileBrowser new 模式接 store 保存（directoryName 输入沿用；保存后跳/示应用结果） — file-browser.svelte — dom 测试（create 调 creatorStore.create；auto-apply 收据 toast 含已应用位置；跳 `/w/:wsId/creator/store/:directoryName`）
- [x] 应用选择面（roots 多选，默认 ~/.agents/skills；复用 install targets UI 模式）+ status 角标（已应用 N 处/已过期）+ uninstall/delete-origin 入口 — CreatorStore.svelte + creator-store-targets/store 包装 — dom 测试（角标三态/默认勾选/确认闸列剩余应用面）+ i18n en/zh（creator-store 域 40+ 键成对）
- [x] AGENTS.md §2/约束 2 + i18n.zh.md 同步 — 文档 — 创建与应用分离真相（创建面 = store；应用面 = 内核投影；Repository 仍 Imported-only）
- [x] 批 2 增补（Owner 拍板 2026-10-09）：creatorStore.load 读面（批 1 八过程无文档 load——list/status 均不带 body，store 编辑页无法回读正文；增量最小：契约 schema + service 暴露 readStoreDocument + router 一行，不触应用链） — src/shared/contracts/creator-store.ts + creator-store-service.ts + rpc-router.ts — 契约测试（create↔load 往返同 revision + 缺席 NOT_FOUND typed，11/11）

## 批 3 · 门禁与走查

- [x] 五件套 + strict + build — 全仓 — 无（全量 2448/2448+4 skip 网关既有；typecheck 0；webui check 0/0；build 0；fmt 任务文件过；strict valid）
- [x] dev 沙箱全链走查 W1-W7 全过（walkthrough-evidence.md：Global 创建/store 落 appDir 形态/auto-apply entity-local/多 root symlink/Outdated→Sync 收敛/uninstall GC+store 原样/delete origin 确认闸；console 零错误标记；生产 daemon 恢复）；走查抓两真 bug 当场修（updatedAt 浮点击穿输出契约/globalProviderRoot 默认 os.homedir 绕过 override——dev 隔离漏洞）+ store 路径基点对齐 Owner 原文（appDir()/creator-skills） — walkthrough 证据进 change 目录 — 无
