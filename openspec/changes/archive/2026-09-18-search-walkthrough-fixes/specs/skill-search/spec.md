# skill-search 变更（增量：真实语料走查修复）

## REMOVED Requirements

### Requirement: WorkspacesHome 呈现同内容技能区块

**Reason**: 2026-09-18 用户走查裁决——整屏区块形式无意义；同源信息改为
ProviderView 技能行上的 symlink 式小角标（见 ADDED）。

## ADDED Requirements

### Requirement: 同源技能以行内小角标呈现

WorkspacesHome MUST NOT 渲染「同内容技能」区块（2026-09-18 用户裁决废除
整屏列表形式）。ProviderView MUST 在技能列表行与搜索结果行上，对内容
与其他安装相同的技能渲染 symlink 式小角标（图标 + title 描述同源计数）；
角标数据来自连接后单次 `skills.duplicates` 查询构建的 id → 组内其他
成员数映射；查询失败静默（角标缺失不是错误态）。

#### Scenario: 同源技能行角标

- **WHEN** 当前列表中某技能 id 属于某重复组成员
- **THEN** 该行名字旁呈现同源角标，title 注明「Same content as N other
  installations」

#### Scenario: 唯一内容无角标

- **WHEN** 某技能内容唯一
- **THEN** 该行不呈现同源角标

#### Scenario: 首页无区块

- **WHEN** 存在重复组时进入 WorkspacesHome
- **THEN** 页面不出现同内容区块；同源信息只在 Provider 行内呈现

## MODIFIED Requirements

### Requirement: content hash 识别内容级重复并折叠结果

每个索引文档 MUST 携带实际被索引 SKILL.md 原始字节的 SHA-256 contentHash。
搜索 MUST 按 contentHash 在 top-40 竞争池**之前**折叠：全量 BM25 候选先按
contentHash 分组，组代表（bm25 降序、并列时 canonicalPath 升序）进入
top-40 池参与 rerank——同内容副本不挤占独特内容的池位。折叠后主结果的
installations MUST 合并组内全部成员的入口（primary 在前、其余按组内冻结
序追加，按 path+workspaceId+providerId 三元组去重）；其余成员以
`{id, canonicalPath}` 按组内冻结序附着在 duplicates 字段。结果排序 tie-break
不变（final desc → name asc → canonicalPath asc）。排序版本 MUST 为
`rerank-2026-09-18-v2`；无重复语料下输出与 v1 完全一致。

#### Scenario: 同内容多路径

- **WHEN** 两个不同 canonical 路径的 skill 内容完全相同且同时命中查询
- **THEN** 结果只出现代表一个，另一个出现在该结果的 duplicates 里；
  主结果 installations 同时包含两个成员的入口

#### Scenario: 副本不淹没多样性

- **WHEN** 同一内容存在 34 份副本且另有多个不同内容的低分候选
- **THEN** top-40 池由每组代表构成；limit 内结果覆盖多个不同 contentHash

#### Scenario: provider 作用域可命中

- **WHEN** 消费方按某 provider 作用域过滤搜索结果的 installations
- **THEN** 只要该 provider 存在此内容的副本，代表结果的 installations
  即包含该作用域入口（不因代表选择而丢失）
