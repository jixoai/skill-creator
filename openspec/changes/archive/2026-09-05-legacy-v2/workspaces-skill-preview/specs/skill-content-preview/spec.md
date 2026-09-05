# Spec: skill-content-preview

## ADDED Requirements

### Requirement: 技能详情面板显示完整 SKILL.md 正文

当用户在 Workspace 技能列表中选中某个技能时，详情面板 MUST 显示该技能的完整 `SKILL.md` 内容，包括 frontmatter 元数据与正文。

#### Scenario: 选中技能后展示正文与 frontmatter

- **WHEN** 用户在 instance Tab 的技能列表中点击一个技能卡片
- **THEN** 详情面板加载该技能的 `SkillInfo`（通过 `skills.info`），并将 `content` 切分为 frontmatter 块与 body 块
- **AND** frontmatter 块以只读元数据表（key-value）形式渲染
- **AND** body 块以渲染后的 markdown 文档形式渲染
- **AND** 面板仍保留 Validate / Disable / Edit 操作入口

#### Scenario: 详情面板加载失败时降级显示

- **WHEN** `skills.info` 返回错误或超时
- **THEN** 详情面板显示错误提示，且不破坏列表与其它 Tab 的可用性

### Requirement: frontmatter 渲染为只读元数据表，body 渲染为格式化 markdown

frontmatter MUST 以结构化的键值表呈现（不能与 body 混排为纯文本），body MUST 按 markdown 语义渲染（标题、列表、代码块、链接、强调、段落）。

#### Scenario: frontmatter 字段以元数据表展示

- **WHEN** `content` 包含 YAML frontmatter 块（`---` 包裹）
- **THEN** 已知字段（`name`、`description`）渲染在元数据表中
- **AND** 其余未知字段（passthrough）也作为额外行呈现，不丢失
- **AND** body 不包含 frontmatter 文本

#### Scenario: body 渲染为 markdown

- **WHEN** body 含标题（`##`）、列表、代码块（```）
- **THEN** 标题渲染为对应层级，列表渲染为带项目符号，代码块渲染为等宽 `<pre><code>` 块
- **AND** 渲染输出经过 HTML 转义，原始 `<script>` 标签不会作为可执行 HTML 注入

### Requirement: 行内轻量编辑支持 frontmatter 字段的 revision-safe 保存

在 Provider 可写（`provider.writable === true`）的前提下，`name` 与 `description` 字段 SHALL 作为可编辑输入呈现；保存 MUST 经 `creator.save` 的 `update` 模式并携带当前 `revision`。

#### Scenario: 可写 Provider 下编辑 name 并保存

- **WHEN** 当前选中技能所属 Provider 满足 `writable`
- **AND** 用户将 `name` 输入框改为新值并点击保存
- **THEN** 前端调用 `creator.save({ mode: "update", workspaceId, providerId, skillId, expectedRevision: skill.revision, frontmatter: { ...其余字段透传, name: 新值, description }, body: 原 body })`
- **AND** 保存成功后用新返回的 `SkillDocument.revision` 刷新本地状态
- **AND** toast 提示保存成功

#### Scenario: revision 冲突时安全失败

- **WHEN** 保存时 `creator.save` 因 `expectedRevision` 与服务端当前 revision 不一致返回冲突
- **THEN** 不静默覆盖；显示冲突错误并提示用户重载技能
- **AND** 不修改本地 `skill.revision`，保持本地状态可被用户察觉已过时

#### Scenario: 只读 Provider 下字段不可编辑

- **WHEN** 当前 Provider 不满足 `writable`
- **THEN** `name` / `description` 字段以只读形式呈现，不出现保存按钮

### Requirement: Workspace 级聚合技能数按 canonical path 去重

Workspace 级 `skillCount` MUST 按技能的物理位置（canonical provider 根路径 + 技能目录名）去重，避免同一技能被多个共享路径的 Provider 重复计入。Provider 级 `skillCount` 不受影响。

#### Scenario: 同一技能在两个共享路径的 Provider 下只计一次

- **WHEN** 一个 Imported Workspace 下 Provider A 与 Provider B 共享同一 canonical 根目录（例如两者都解析到 `.agents/skills`）
- **AND** 该根目录下存在技能 `my-skill`
- **THEN** Workspace 级 `skillCount` 对 `my-skill` 只计 1 次
- **AND** Provider A 的 `skillCount` 仍包含 `my-skill`
- **AND** Provider B 的 `skillCount` 仍包含 `my-skill`

#### Scenario: 不同物理路径下的同名技能不去重

- **WHEN** Provider A 与 Provider B 解析到不同的 canonical 根目录
- **AND** 两者根目录下都存在一个名为 `shared-tool` 的技能
- **THEN** Workspace 级 `skillCount` 计为 2（视为两个独立技能）

#### Scenario: Provider 级列表与发现不受去重影响

- **WHEN** 用户在 instance Tab 中切换到某个 Provider
- **THEN** 该 Provider 的技能列表（`skills.list`）显示其根目录下的全部技能
- **AND** Provider 头部展示的 `skillCount` 与去重前一致

### Requirement: Tab 切换在 Tab 内保留技能选中状态

在 Workspaces App 的多个 Tab 之间切换时，每个 Tab 内部的技能选中状态、Provider 选择、查询草稿 SHALL 被该 Tab 的状态作用域隔离保留。

#### Scenario: 切走再切回 instance Tab 仍保持选中

- **WHEN** 用户在 instance Tab A 中选中了技能 `sk_xxx`
- **AND** 切换到另一个 Tab（home 或另一 instance Tab）
- **AND** 再切回 instance Tab A
- **THEN** instance Tab A 仍显示技能 `sk_xxx` 为选中
- **AND** 不重新触发 `skills.info` 加载（除非 revision 已变更）

#### Scenario: 关闭 instance Tab 后其状态被清理

- **WHEN** 用户关闭 instance Tab A
- **THEN** 该 Tab 的选中状态、Provider 查询、草稿被彻底清理
- **AND** 不影响其它 instance Tab 或 home Tab 的状态
