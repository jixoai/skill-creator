# creator-skill-store · creator delta

## ADDED Requirements

### Requirement: 技能创建的唯一根源是 creator store

Creator 的 new 模式 MUST 将技能写入 `<homeDir()>/.agents/creator-skills/<directoryName>/`（生产 `~/.agents/creator-skills`）
（origin store）：frontmatter 校验、revision（SKILL.md sha256）、change log 与
原子写契约沿用既有文档机制，仅目标根改指 store。创建面 MUST NOT 向任何
provider root 或 ccski 实体库根直写技能目录——agent 目录中的创建物只能经内核
应用产生（ensureEntity + projectEntity）。workspace 身份（含 Global `~`）MUST
不限制创建：store 无 workspace 归属，任何 ws 上下文的 Creator 页均可创建。

#### Scenario: 创建落 store 并自动应用

- **WHEN** 在 Global workspace 的 Creator 页创建技能 `my-skill`（auto-apply 默认开启）
- **THEN** store 出现 `<homeDir>/.agents/creator-skills/my-skill/SKILL.md`；内核
  `~/.agents/skills/my-skill` 实体入库（entity-local 收据，无 symlink 无复制）；
  provider root 与实体库根上没有任何宿主直写痕迹

#### Scenario: 创建面不直写 agent 目录

- **WHEN** 对创建面执行源扫描断言（任何 ws、任何 provider）
- **THEN** creator new 模式的落盘路径全部解析进 creator store；resolveWritable
  不出现在 new 模式调用链

### Requirement: 应用与同步经 ccski 内核投影

store 技能的应用 MUST 走 ccski 两阶段（`ensureEntity` source=store 目录 +
`projectEntity` roots）：global 应用（scope global）与 workspace 应用（scope
project + workspaceDir）同构；root 等于实体库根时按内核 entity-local 收据消费。
同步（store 编辑后重投影）MUST 走 `updateEntity`（source 仍为 store）并按逐
root 收据裁决——GUARD_PROJECTION 收据 MUST 保留用户修改的物化副本并如实失败。
应用/同步的 typed error MUST 经宿主有限词表映射，不透传内核 message。

#### Scenario: 多 root 应用与同步

- **WHEN** store 技能应用到 `~/.agents/skills` 与 `~/.codex/skills` 后编辑 store 并 sync
- **THEN** `~/.agents/skills` 为实体本体（内容更新）、`~/.codex/skills/<name>`
  为指向实体的 symlink；store hash 与 entity hash 一致

#### Scenario: 用户改动物化副本受保护

- **WHEN** 某已应用 root 为物化副本且被用户修改后执行 sync
- **THEN** 该 root 按内核收据如实失败（GUARD_PROJECTION 映射文案），副本字节
  原样，其余 root 的同步结果不受影响

### Requirement: 卸载与删除根源分离

卸载（`removeEntityProjections`，末投影由内核 GC 全清实体）与删除根源（删
store 目录）MUST 是两个正交操作；删除根源时若存在已应用面 MUST 在结果中如实
列出。status（已应用 roots + store hash vs entity hash 的过期判定）MUST 以
`computeSkillFolderHash` 单源计算，宿主不落第二实现。

#### Scenario: 卸载不删根源

- **WHEN** 对已应用两个 roots 的 store 技能执行全部卸载
- **THEN** 实体与投影全清（内核 GC）、store 目录与 change log 原样；重新应用
  可完整恢复
