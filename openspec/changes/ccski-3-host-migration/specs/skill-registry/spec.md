# skill-registry 增量（ccski 3.0 发现投影：canonical 四名 + state 禁用补充面）

## ADDED Requirements

### Requirement: SkillMetadata canonical 四名区分

发现投影 MUST 区分四个名字维度：逻辑名（`name`，frontmatter name）、目录名（`directoryName` = folderName）、实体路径（`path`，恒为 canonical 实体路径——realpath 归一后的实体库内路径，symlink 投影经 realpath 并归实体）与投影路径（`projectionPath`，发现位置与 canonical 实体路径不同时携带；link 投影的物理落点/重链落点）。增量顶层形态字段 `entryKind`（directory/symlink）与 ownership 认证（ccski/external/unknown）MUST 随发现面透传（toggle/remove 双路由的判定依赖面）。

#### Scenario: symlink 投影行携带双路径

- **WHEN** 一个 ccski link 投影技能经 provider face 发现
- **THEN** 行携带 `path` = canonical 实体路径与 `projectionPath` = provider root 下的链接路径，`directoryName` = folderName，`entryKind` = symlink、`ownership` = ccski

#### Scenario: 实体本地形态单路径

- **WHEN** 经实体根 face（provider root === 实体根）发现同一技能
- **THEN** 行的 `path` 为实体路径且不携带 `projectionPath`，`entryKind` = directory

### Requirement: state-backed disabled 补充面

`skills.list`（includeDisabled）MUST 以只读方式读取 provider 对应 stateBase 的 `.ccski-state.json`，为「link 投影已摘链（记录 disabled、链接物理缺席）」的技能补回同 id 的 disabled 行（内容源 = state 实体记录指向的实体库 `SKILL.md`）。数据不兼容（JSON parse 或 schema 收窄失败）或无 state 文件 MUST 投影为零补充降级、不计错；非环 IO 故障（EACCES/EIO…）MUST 向上传播。重复防护：投影路径已有文件系条目（记录过时/被外部占位）或实体 canonical 路径已在文件系发现面 = 文件系胜出，不补。

#### Scenario: 禁用行补充

- **WHEN** 一个 ccski link 投影被摘链禁用后读取 provider 列表
- **THEN** 同 id 的 disabled 行在场（`disabled: true`、`ownership: ccski`、`path` = 实体路径、`projectionPath` = 记录的投影路径），includeDisabled=false 时不补

#### Scenario: 坏 state 零补充降级

- **WHEN** state 文件内容为不兼容 JSON
- **THEN** 列表成功返回、零补充行，不产生错误

#### Scenario: 文件系胜出不补

- **WHEN** state 记录的投影路径已被外部条目占位或实体 canonical 路径已在文件系发现面
- **THEN** 不为该记录补充 disabled 行
