# Proposal: creator-skill-store — 创建与应用分离（origin store + ccski 投影）

## Why

Owner 裁决 [2026-10-09]：「我们得有一个专门管理我们创建出来的这些 skills，比如
~/.skill-creator/creator-skills，然后再通过 ccski-sdk 将这些 skill 安装到本地
agent skills 目录（包括 .agents/skills .codex/skills 等）。所以架构上是两个分开
的。这样的好处是，我们本地创建的这个技能，它始终会有一个唯一的根源目录。然后
才是说怎么把这个本地创建的技能应用给 agents。剩下的工作就是怎么把这个体验做得
更好、更平滑，符合用户直觉，有些能够自动到位的就到位。比方说……直接把技能放在
.agents/skills 目录，这属于我们可以自动化做到事情。」

现行模型把「创建」直接落在目标 provider root（Imported 今日可建、Global 本轮曾
计划开闸）——创建物没有唯一根源，且直写实体库根（.agents/skills）会制造「实体
形态未入账」目录（保守删除防线拒删，跨面残留）。本 change 以架构替代修补。

## What Changes

- **Origin store（唯一根源）**：`<homeDir()>/creator-skills/<directoryName>/`
  （SKILL.md + 附属文件）。Creator 的 new 模式全部落 store——frontmatter/正文/
  revision 契约/change log/原子写机制原样复用，仅目标根改指 store。不再向任何
  provider root 直写创建（Imported 与 Global 一致收口）。
- **应用 = ccski 3.0 两阶段（零内核改动）**：`ensureEntity`（实体入库）+
  `projectEntity`（投影）。global 应用：scope global（实体库 `~/.agents/skills`）+
  用户所选 agent roots（`~/.agents/skills` root 命中 canonical-root → 内核
  entity-local 收据；`.codex/skills` 等 → symlink 投影）。workspace 应用：scope
  project（实体库 `<ws>/.agents/skills`）+ ws provider roots。source = store 内
  该技能目录（provenance 指回 store）。
- **自动到位**：创建成功即自动应用到 `~/.agents/skills`（Owner 点名的开放标准
  位置，entity-local 形态）；其余 roots 由用户显式多选（复用 repository install
  targets 的选择面模式）。
- **同步（re-apply）**：store 编辑后按需重投影 = `updateEntity`（source 仍为
  store）；store hash vs entity hash（`computeSkillFolderHash` 单源）驱动
  「已应用/已过期」状态。
- **卸载与删除分离**：卸载 = `removeEntityProjections`（逐 root）/末投影内核
  GC 全清；删除根源 = 删 store 目录（删除前提示已应用面）。二者正交、可独立
  执行。
- **edit 模式不动**：已安装技能（repository 安装/应用产生）的编辑仍走既有
  provider-scoped 编辑页（revision 契约不变）；store 技能的编辑走 store 身份。

## Impact

- daemon：新 creator-store-service（list/create/save/remove/apply/sync/status）
  - creator-service new 模式目标改 store + workspace-registry 无闸变化
    （resolveWritable 不再被创建面消费）。
- contracts：CreatorStoreSkill / ApplySkillResult 等增量；rpc-contract 增量。
- webui：Creator new 模式 store 化（路由 new 不再要求 providerId）、应用选择面、
  已应用/过期状态；skills 页 store 技能角标（后续批）。
- AGENTS.md §2 Creator 词条 + 核心约束 2 改写（创建面 = store；应用面 = 内核
  投影；Repository 仍 Imported-only）。
- 非目标：内核改动（ensureEntity/projectEntity/updateEntity/remove 现有能力
  足够）；repository 安装面；已安装技能的编辑语义；store 技能的 Git 版本化。

## 验收

- store 全链契约测试（create→auto-apply→edit→sync→uninstall→delete origin）；
- 创建物永无「未入账实体形态目录」（实体库根只经内核写入——负面测试钉死）；
- dev 沙箱走查：Global workspace Creator 页创建技能 → 自动出现在 .agents/skills
  （entity-local）→ 应用到 .codex/skills（symlink）→ 编辑 store → sync → 卸载；
- 五件套 + strict。
