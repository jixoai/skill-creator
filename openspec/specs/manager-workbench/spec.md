# manager-workbench Specification

## Purpose

Provide the Workspace, Creator, and Repository workbench surfaces on top of the Manager core.

## Requirements

### Requirement: Workspaces expose provider-scoped skills

The Workspaces surface MUST show Global and Imported Workspaces, their Providers, and provider-scoped skill state including availability, validation and enabled status.

#### Scenario: imported workspace discovery

- **WHEN** a user imports a readable directory
- **THEN** the UI shows its server-derived Providers and skills and Remove removes only the registry entry

### Requirement: Creator applies reviewed drafts

Creator MUST keep unsaved edits in a draft, save with an expected revision, and distinguish success, conflict and failure.

#### Scenario: revision conflict

- **WHEN** another process changes a document before the user saves
- **THEN** Creator reports conflict, keeps the draft, and offers reload without overwriting the newer file

### Requirement: Repository installs pinned content

Repository preview and install MUST use the same pinned scan session and MUST report each selected skill and target independently.

#### Scenario: expired session

- **WHEN** a user installs after the scan session has expired
- **THEN** the operation is rejected with a rescan action and no target is modified

### Requirement: Settings 为标准页面面板（非 Dialog）

Settings MUST 以 shell 页面面板呈现（路由 /settings，App 语义），内部保留
list-detail 分区结构（General/Model/Agent/Sessions，窄屏 ≤720px 分区导航
折叠为 44px 横向 chip 行）；入口 = shell App 主列表齿轮（与其他 App 同列，
单入口——vision 走查裁决底部 Dialog 时代常驻齿轮退役，双入口无法区分）。
SettingsDialog MUST 退役。

#### Scenario: 入口导航

- **WHEN** 点击左导航 App 列表中的 Settings 齿轮
- **THEN** 主区切换为 /settings 页面（URL 变化、可刷新恢复），
  不出现 Dialog 遮罩，也不出现第二个齿轮入口

### Requirement: 模型 provider 目录以 zcode Registry 为源

模型 provider 目录数据源 MUST 为 zcode Registry 生成物（zai-org/ZCode
zcode-builtin.json → 生成预设文件；数据结构沿用 shufa 的 ModelPreset），
不再读取 pi-ai 的 models.dev 镜像（目录数据零 models.dev 依赖）。
投影到 ModelProviderCatalogEntry 的映射：api 三值直传、contextWindow
直传、efforts → effortTiers、image = inputTypes 含 image；provider
图标本仓 PROVIDER_ICONS 优先（刷新脚本 provider 清单与 logo slug 均来自
zcode 生成物，20/20 dataURL 覆盖——图标面运行时零网络），缺失回退
preset iconUrl（models.dev 静态 logo 资产，shufa 同口径）/ 字母头像。

#### Scenario: 目录来自 zcode 源

- **WHEN** 打开 Settings → Model 分区
- **THEN** provider 画廊来自 zcode-presets 生成物（重跑脚本即可整体换新），
  界面零 models.dev 目录依赖
