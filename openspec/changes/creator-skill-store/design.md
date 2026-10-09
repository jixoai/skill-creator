# Design: creator-skill-store

## D1 架构分层（Owner 裁决的机制映射）

```text
Creator（编辑/revision/change log）      ccski 3.0 内核（应用/投影）
        |                                        |
  <homeDir>/creator-skills/<name>/        ensureEntity(scope, source=store/<name>)
  = 唯一根源（origin）                      + projectEntity(roots=[...])
        |                                        |
   store 编辑（唯一编辑面）                 ~/.agents/skills/<name>   实体（global）
   sync = updateEntity(source=store)       <ws>/.agents/skills/<name> 实体（project）
                                           ~/.codex/skills/<name> 等  symlink 投影
```

- **为什么不把实体库当根源**：Owner 明确 origin 在 ~/.skill-creator/creator-skills
  （与 agent-facing 目录分离）；且实体库归内核单写者所有，Creator 直写会制造
  未入账实体形态目录（既有保守删除防线会拒删 = 跨面残留）。store 与实体是
  「源码 vs 安装物」关系（npm 心智）：编辑永远在 store，应用/同步永远经内核。
- **`.agents/skills` root 的内核语义**：projectEntity 的 root 等于该 scope 实体
  库根时内核返回 entity-local 收据（canonical-root，无 symlink、无复制）——
  Owner 的「直接放在 .agents/skills 属于可自动化」正落在此：auto-apply 默认
  roots = [`~/.agents/skills`]，产物即 entity-local，全局开放标准位置立即可见。
- **零内核改动**：所需能力（ensureEntity/projectEntity/updateEntity/
  removeEntityProjections/deleteEntity/entity-local/GUARD 族）3.0 全部在册
  （终审 APPROVE 9.5/10）。

## D2 store 形态与身份

- 路径：`<homeDir()>/creator-skills/<directoryName>/SKILL.md`（+附属文件随目录）。
- directoryName 沿用 SkillDirectoryNameSchema（lowercase 安全名）；逻辑名 =
  frontmatter name（重名冲突 = store 内目录名唯一性拒绝，typed NAME_EXISTS 语义
  对齐内核词表映射面）。
- revision = 现行 creator 文档契约（SKILL.md 内容 sha256）；change log 随目录
  （.change-log 机制原样，落 store 内）。
- 外部输入纪律：store 目录枚举结果 Zod safeParse 收窄（不兼容条目跳过并计数，
  不硬失败——同发现层法则）。

## D3 应用/同步/卸载的状态机

```text
create(store) ──auto-apply──> ensureEntity(global) + project([~/.agents/skills])
   │                                     │ entity-local 收据
   ▼                                     ▼
 edit(store) ──sync──> updateEntity(source=store)  逐 root 收据裁决（P0-1 语义
   │                  GUARD_PROJECTION 保留用户改动物化副本，宿主如实失败）
   ▼
 status = storeHash vs entityHash（computeSkillFolderHash 单源，daemon 缓存）
   ▼
 uninstall(root) = removeEntityProjections（末投影内核 GC 全清 entity）
 delete-origin   = rm store 目录（删除前 UI 列出仍应用的 roots；有应用面时确认）
```

- workspace 应用：scope project + workspaceDir=<ws>，roots = ws 内所选 provider
  roots（ Imported 实体库 `<ws>/.agents/skills` 同样 entity-local 语义）。
- typed error 全部经既有 KERNEL_FAILURE_MESSAGES 族有限映射，不透传内核 message。
- lock/hash：不触 npm lock（store 技能非 skills-CLI 安装物）；hash 仅
  computeSkillFolderHash 单源（本仓不落第二实现）。

## D4 RPC 与 UI 面

- RPC：`creatorStore.list / create / save / remove / apply / sync / status /
  uninstall`（oRPC；mutation 均有 typed result）。creator.save 的 new 模式改经
  store（webui 唯一创建入口）；edit 模式（已安装技能）契约不动。
- 路由：`/w/:wsId/creator/new`（providerId 退出 new 模式参数——manifest zod 与
  路由表同步；edit 路由原样）。CreatorHome 引导创建对 Global 不再哑（store 无
  workspace 归属，任何 ws 上下文都可建）。
- 应用选择面：多选 roots（Global agent roots + Imported workspace providers），
  复用 repository install targets 的 UI 模式与 i18n 族；默认勾选
  `~/.agents/skills`。
- 状态展示：store 列表行 + CreatorHome「已应用 N 处 / 已过期」角标
  （status RPC；过期 = 任一已应用 entity hash ≠ store hash）。

## D5 批次

1. daemon：creator-store-service 全链 + contracts/RPC + auto-apply + 契约测试
   （含负面：创建面永不直写实体库根；Global Creator 页可用）。
2. webui：new 模式 store 化（路由/草稿/保存）+ 应用选择面 + 状态角标 + i18n。
3. 门禁与走查：五件套 + dev 沙箱全链（proposal 验收链）+ AGENTS/i18n.zh 同步。

## Open Questions（实现批内裁决，超界上报）

- store 技能在 skills 页的呈现形态（canonical 分组如何标注 origin）——批 2/3
  以最小角标落地，完整信息架构另立。
- change log 在 store 目录内的文件名沿用现状即可（不迁移既有 provider 内
  change log）。
