# Tasks: creator-skill-store

## 批 1 · daemon：store 服务 + 内核应用链

- [x] creator-store-service：list/create/save/remove（revision 契约沿用；store 枚举 safeParse 收窄） — src/daemon/creator-store-service.ts（新） — 契约测试（10/10）
- [x] apply/sync/uninstall/status：ensureEntity/projectEntity/updateEntity/removeEntityProjections 直连 + typed 有限映射 + auto-apply（默认 roots=[~/.agents/skills]） — 同上 — 契约测试（entity-local 收据/多 root symlink/sync 收敛+degraded fail-closed/末投影 GC+store 原样/零投影 deleteEntity/GUARD_PROJECTION 保护）
- [x] contracts + rpc-contract：CreatorStoreSkill/ApplySkillResult 等增量 — src/shared/ — typecheck 0 + 契约测试
- [x] creator-service new 模式目标改 store（providerId 退出 new 身份；edit 不动；程序化旧语义收窄为内部 createInWorkspace——steward/intelligence/scripts 调用点全迁移） — src/daemon/creator-service.ts — 回归 130/130（含 agent-proposals/dsh-tool fixture 迁移，MainAgent 补刀）
- [x] 负面钉死：创建面永不直写 provider root/实体库根（resolveWritable 不再被 new 消费） — 测试断言（never resolves a writable provider scope from the creation face）

## 批 2 · webui：store 化创建 + 应用面

- [ ] new 路由 store 化（providerId 退出 new 参数；CreatorHome 引导创建对 Global 激活） — manifest + CreatorHome/CreatorWorkspace — dom 测试
- [ ] FileBrowser new 模式接 store 保存（directoryName 输入沿用；保存后跳/示应用结果） — file-browser.svelte — dom 测试
- [ ] 应用选择面（roots 多选，默认 ~/.agents/skills；复用 install targets UI 模式）+ status 角标（已应用 N 处/已过期）+ uninstall/delete-origin 入口 — 新组件 + CreatorHome — dom 测试 + i18n en/zh
- [ ] AGENTS.md §2/约束 2 + i18n.zh.md 同步 — 文档 — 无

## 批 3 · 门禁与走查

- [ ] 五件套 + strict + build — 全仓 — 无
- [ ] dev 沙箱全链走查：Global Creator 创建→自动 entity-local 落 ~/.agents/skills→应用 .codex/skills（symlink）→编辑 store→sync→uninstall→delete origin；console 零新增错误；环境恢复 — walkthrough 证据进 change 目录 — 无
