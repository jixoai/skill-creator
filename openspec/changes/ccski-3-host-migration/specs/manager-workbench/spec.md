# manager-workbench 增量（ccski 3.0 store-link 内核宿主切换：安装两阶段 + 删除双路由）

## MODIFIED Requirements

### Requirement: Repository installs pinned content

Repository preview and install MUST use the same pinned scan session and MUST report each selected skill and target independently. Install MUST 经 ccski 3.0 两阶段内核执行——`ensureEntity`（实体入库 Imported Workspace 的 `<ws>/.agents/skills/` 实体库）+ `projectEntity`（Provider root 下的 symlink 投影 + state 记账）——并 MUST 保留宿主复核链：每个 selected skill × target 的安装结果经 direct-child、regular `SKILL.md`、frontmatter name、canonical 重新发现与 validate 的全链验证后才签发本地 Skill ID（内核防线不替代宿主防线）。内核 typed error MUST 经宿主有限词表映射，不透传内核 message；force 语义只清障非 ccski 管辖的占位条目（普通目录 rmSync、异向链接只摘链），ccski 管辖链接与实体本地形态（provider root === 实体根）从不清障。

#### Scenario: expired session

- **WHEN** a user installs after the scan session has expired
- **THEN** the operation is rejected with a rescan action and no target is modified

#### Scenario: 两阶段物理形态

- **WHEN** 一项 selected skill 安装完成
- **THEN** Provider root 下是指向实体的 symlink 投影，实体入库 `<ws>/.agents/skills/<folderName>`，state 同时记账实体与投影记录，发现面以 `ownership: "ccski"` 呈现该技能

#### Scenario: 复核链负例不签发 Skill ID

- **WHEN** selected skill 的安装输出经运行时解析后与预期身份不匹配（重名、非法 frontmatter、非 direct-child 路径或重新发现失败）
- **THEN** 该项投影为不可安装或 failed、不签发本地 Skill ID，同批已完成并通过复核的项保留

#### Scenario: 内核 typed error 不透传

- **WHEN** 内核对同逻辑名不同源的安装返回 `NAME_EXISTS` 且未启用 force
- **THEN** 该项为 skip 收据并提示 force 语义；内核原始 message 不进入宿主输出

### Requirement: Creator applies reviewed drafts

Creator MUST keep unsaved edits in a draft, save with an expected revision, and distinguish success, conflict and failure. Creator 删除 MUST 保留宿主 revision 契约（删除前身份文件内容 sha256 对 expectedRevision 的校验为第一层），并按发现层 ownership 双路由执行：`ownership === "ccski"` 的技能 MUST 经内核删除——单 face 删除 = `removeEntityProjections`（该 provider root 的投影摘除，实体与其余投影保留）；末投影删除升级全清（内核 last-reference GC 退役实体）；实体 face（provider root === 实体根）= 实体 + 全部投影 + state 记录全清零残留（零投影时直接 `deleteEntity` 受 GUARD_ENTITY 第二层守卫）；判定基准 = state 投影表该实体的注册投影数，state 缺失/不兼容/实体记录缺席 MUST 按保守路径 typed 拒绝（不回落直删制造残留、不假装内核管辖）。其余技能（external/unknown/普通目录）MUST 保留宿主直删路径（provider-root containment + rmSync）。内核 typed error MUST 经有限词表映射（GUARD_* 家族与 FOREIGN_OWNERSHIP/PROJECTIONS_REMAIN/GC_UNKNOWN_REFERENCE → conflict），不透传内核 message。

#### Scenario: revision conflict

- **WHEN** another process changes a document before the user saves
- **THEN** Creator reports conflict, keeps the draft, and offers reload without overwriting the newer file

#### Scenario: 单 face 删除

- **WHEN** 删除一个多投影 ccski 技能的其中一个 provider face
- **THEN** 该 face 的投影与 state 投影记录退役（无悬空链），其余 face 投影仍指向存活的实体，实体记录与内容保留

#### Scenario: 末投影全清零残留

- **WHEN** 删除 ccski 技能的最后一个注册投影（或经实体 face 删除）
- **THEN** 实体目录、全部投影与 state 实体/投影记录一并退役；provider root 无悬空 symlink、state 无 stale 记录

#### Scenario: 非 ccski 直删回归

- **WHEN** 删除一个非 ccski 管辖的普通目录技能
- **THEN** 走宿主直删路径（containment + rmSync），目录消失

#### Scenario: 内核 guard 冲突映射

- **WHEN** 内核删除返回 `GUARD_ENTITY`/`GUARD_PROJECTION` 等 guard 类 typed error
- **THEN** 宿主投影为 conflict 且路径不动，错误文案来自宿主有限词表（携带 ccski code token），内核原始 message 不泄露

#### Scenario: state 缺失保守拒绝

- **WHEN** 删除路由读到 state 缺失/不兼容或实体记录缺席
- **THEN** 以 typed INVALID_OPERATION 拒绝删除，磁盘零副作用，不回落直删
