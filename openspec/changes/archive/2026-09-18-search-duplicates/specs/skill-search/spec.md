# skill-search 变更（增量：内容重复面）

## ADDED Requirements

### Requirement: 索引提供无查询的内容重复组投影

service MUST 暴露 `duplicates()`：按 `contentHash` 分组、仅保留成员数 >1
的组；成员携带 `{id, name, canonicalPath, installations, disabled,
conflict}`；组间按成员 canonicalPath 最小值升序、组内按 canonicalPath
升序（冻结次序）。新鲜度 MUST 与 `search()` 共用同一 freshen 路径。

#### Scenario: 同内容双安装成组

- **WHEN** 两个 canonical 目录的 SKILL.md 字节相同（或被索引文件集字节相同）
- **THEN** duplicates() 返回一个含两个成员的组，成员各带自身 installations

#### Scenario: 唯一内容不出组

- **WHEN** 某技能内容唯一
- **THEN** 它不出现在任何 duplicates 组中

### Requirement: duplicates 经 RPC 与 MCP 面可查

`skills.duplicates`（readonly，无输入）MUST 返回 `{groups}`；capability
登记后 MCP 面 MUST 自动投影 `skills_duplicates` 工具。

#### Scenario: 面板与 agent 同源

- **WHEN** WebUI 调 RPC 与 stdio MCP 调 `skills_duplicates`
- **THEN** 两者来自同一 service 实例投影，结果一致

### Requirement: WorkspacesHome 呈现同内容技能区块

WorkspacesHome MUST 在存在重复组时渲染「同内容技能」区块：成员行含名称、
作用域标签，点击跳转对应 ProviderView 技能详情；无重复组时区块不渲染；
加载失败呈现区块内错误文案（不 toast、不阻塞其余区块）。

#### Scenario: 跳转详情

- **WHEN** 点击某重复组成员行
- **THEN** 导航到该成员 installation 作用域的 provider 详情页
