# Capability: repository-discover

把 Repository App 从「粘贴 Git URL」的空输入框改造成 Discover 体验：内置精选技能源目录 + 用户自定义源持久化 + 浏览卡片 + tab-scoped 扫描会话 + 安装后跳转到 Workspaces。

## ADDED Requirements

### Requirement: Repository home Tab 呈现可浏览的源目录

Repository home Tab MUST 把内置精选源与用户自定义源作为可浏览的卡片呈现，配搜索框与最近扫描入口，而不是一个空 Git URL 输入框。

#### Scenario: 进入 Repository home Tab 看到源目录

- **WHEN** 用户切换到 Repository App 且 URL 未指定实例 Tab
- **THEN** home Tab 渲染 Discover 视图：顶部一个搜索框，下方是源卡片网格
- **AND** 卡片网格包含全部内置精选源（来自 `CURATED_SOURCES`）与全部用户自定义源（来自 `sources.json`）
- **AND** 每张卡片至少展示 label、description、内置/用户徽标

#### Scenario: 搜索过滤源卡片

- **WHEN** 用户在 home Tab 搜索框输入关键词
- **THEN** 源卡片网格仅显示 label 或 description 命中关键词的源
- **AND** 搜索不触发任何远程请求，只过滤当前 home Tab 已投影的源列表
- **AND** 清空搜索框后恢复显示全部源

#### Scenario: home Tab 恒在

- **WHEN** Repository App 已打开任意数量的实例 Tab
- **THEN** home Tab 仍保留在 Tab 栈中且不可关闭（由 change 1 保证）
- **AND** 关闭最后一个实例 Tab 后激活 Tab 自动回到 home Tab

### Requirement: 扫描源打开独立的 tab-scoped 会话

扫描一个源 MUST 为该扫描会话打开或聚焦一个独立的 Repository 实例 Tab，会话状态隔离到该 Tab。

#### Scenario: 从源卡片首次打开扫描 Tab

- **WHEN** 用户在 home Tab 点击某源卡片的 "Scan" 按钮
- **THEN** 为该源打开一个新的 Repository 实例 Tab，instanceKey 来自源 id
- **AND** 实例 Tab 用该源的 `gitUrl` 自动触发首次扫描
- **AND** 新 Tab 被激活，URL 更新为 `/repository/tab/<source-id-or-session>`
- **AND** 实例 Tab 不再渲染顶部 Git URL 输入框（源已确定）

#### Scenario: 重复扫描同一源聚焦而非新建

- **WHEN** 用户对某源再次点击 "Scan"，而该源的实例 Tab 已在 Repository Tab 栈中
- **THEN** 不创建新 Tab，而是聚焦已存在的实例 Tab
- **AND** 若该 Tab 此前扫描已完成，则保留其扫描结果（不强制重扫）

#### Scenario: 实例 Tab 渲染扫描 + 预览 + 多目标安装

- **WHEN** 一个 Repository 实例 Tab 处于激活态且扫描已返回
- **THEN** 实例 Tab 渲染 discovered skills 列表（支持多选）
- **AND** 提供 skill snapshot 预览（复用 `repository.preview`）
- **AND** 提供多目标 Workspace Provider 安装与 dry-run（复用 `repository.install`）
- **AND** 这些状态隔离到该实例 Tab，不影响 home Tab 或其它实例 Tab

### Requirement: 用户可增删自定义 Git 源并跨重启保留

用户 MUST 能向 Discover feed 增加自定义 Git 源、删除已添加的自定义源，且这些源跨 daemon 重启仍保留；内置精选源不可删除。

#### Scenario: 增加自定义源

- **WHEN** 用户在 home Tab 提交一个新的 Git URL（带 label）
- **THEN** 该源经 `repository.sources.add` 写入 `sources.json`
- **AND** home Tab 立即渲染一张新的用户源卡片（用户徽标）
- **AND** 新源出现在搜索过滤范围内

#### Scenario: 自定义源跨重启保留

- **WHEN** 用户增加一个自定义源后重启 daemon
- **THEN** 重新进入 Repository home Tab 仍能看到该自定义源卡片
- **AND** 卡片元数据来自 `repository.sources.list` 返回的用户源列表

#### Scenario: 删除用户自定义源

- **WHEN** 用户在某张用户源卡片上点击删除
- **THEN** 该源经 `repository.sources.remove` 从 `sources.json` 移除
- **AND** home Tab 不再渲染该卡片
- **AND** 已为该源打开的实例 Tab 不被强制关闭（但其源不再可重新打开）

#### Scenario: 内置精选源不可删除

- **WHEN** 某张源卡片来自 `CURATED_SOURCES`
- **THEN** 该卡片不渲染删除按钮
- **AND** 对内置源 id 调用 `repository.sources.remove` 被 RPC 拒绝

#### Scenario: 非法 Git URL 被拒绝

- **WHEN** 用户提交一个非 https 形态或解析失败的 Git URL
- **THEN** `repository.sources.add` RPC 拒绝该输入，不写盘
- **AND** home Tab 不出现新卡片，UI 显示校验错误

### Requirement: 源卡片展示上次扫描的缓存元数据

每张源卡片 MUST 展示来自上次扫描的缓存技能数与 commit 摘要；无缓存或缓存过时时给出相应提示。

#### Scenario: 卡片展示缓存技能数与 commit

- **WHEN** 某源在当前会话内已被扫描过至少一次
- **THEN** 该源卡片显示缓存的技能数（如 "12 skills"）
- **AND** 显示上次扫描固定的 commit 摘要（如 commit 前 12 位）

#### Scenario: 从未扫描的源显示空态提示

- **WHEN** 某源在本会话内从未被扫描
- **THEN** 该源卡片技能数与 commit 位置显示 "Not scanned yet"
- **AND** "Scan" 按钮仍可点击

#### Scenario: 缓存过时显示刷新提示

- **WHEN** 某源缓存的 commit 与其 default ref 不一致或扫描时间超过阈值
- **THEN** 该源卡片显示刷新提示（hint）
- **AND** 该提示不自动触发扫描，仅作为 UI 提示

### Requirement: 安装成功后跳转到 Workspaces 并高亮新技能

安装成功后，结果摘要 MUST 提供一个动作，打开或聚焦目标 Workspaces Tab 并高亮新装的技能。

#### Scenario: 单目标安装后跳转

- **WHEN** 一次安装成功且只安装到一个 Workspace Provider 目标
- **THEN** 结果摘要旁渲染一个 "View in Workspaces" 按钮
- **AND** 点击该按钮打开或聚焦目标 Workspaces 实例 Tab（instanceKey = `{workspaceId}/{providerId}`）
- **AND** 该 Tab 高亮新装的 `skillId` 并滚动入视

#### Scenario: 多目标安装后选择跳转

- **WHEN** 一次安装成功且安装到多个 Workspace Provider 目标
- **THEN** 结果摘要旁渲染一个 "View in Workspaces" 下拉，列出全部已安装目标
- **AND** 用户从下拉选择某目标后，行为与单目标跳转一致

#### Scenario: 跳转动作不改 RPC 契约

- **WHEN** 实现安装后跳转
- **THEN** 跳转所需信息（目标 Workspace/Provider、新装 skillId）全部从既有 `InstallSummarySchema` 响应推导
- **AND** 不向 `repository.install` 增加新的输出字段

### Requirement: Repository Tab 相互隔离

每个 Repository 扫描会话 MUST 隔离到独立的实例 Tab，会话状态（扫描结果、预览、选中项、安装状态）互不污染，关闭 Tab 时彻底清理。

#### Scenario: 不同扫描会话互不污染

- **WHEN** 用户在实例 Tab A（源 X）选中若干技能，并在实例 Tab B（源 Y）选中其它技能
- **THEN** 切换回 Tab A 时仍显示 Tab A 的扫描结果与选中项
- **AND** 切换回 Tab B 时仍显示 Tab B 的扫描结果与选中项
- **AND** 两个 Tab 的选中项与扫描会话互不覆盖

#### Scenario: 关闭扫描 Tab 取消其 in-flight 请求

- **WHEN** 一个实例 Tab 有正在进行的扫描 / 预览 / 安装请求时被关闭
- **THEN** 该 Tab 的请求代次门被 invalidate（由 change 1 TabScope.dispose 触发）
- **AND** 落地的旧响应被判定为 stale 而不写入任何状态
- **AND** 其它实例 Tab 与 home Tab 不受影响

#### Scenario: home Tab 缓存映射按源隔离

- **WHEN** 某实例 Tab 完成扫描
- **THEN** 该源的缓存元数据（技能数、commit）写回 home Tab 作用域的缓存映射
- **AND** 该缓存映射的键为 source id，与其它源互不覆盖
- **AND** 缓存仅活在当前会话的 home Tab 作用域内，不持久化跨重启
