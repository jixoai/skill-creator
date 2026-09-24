# manager-workbench Specification (delta)

## ADDED Requirements

### Requirement: Settings 为标准页面面板（非 Dialog）

Settings MUST 以 shell 页面面板呈现（路由 /settings，App 语义），内部保留
list-detail 分区结构（General/Model/Agent/Sessions）；左导航底部入口点击
= 导航到 /settings（不再开 Dialog）。SettingsDialog MUST 退役。

#### Scenario: 入口导航

- **WHEN** 点击左导航底部 Settings
- **THEN** 主区切换为 /settings 页面（URL 变化、可刷新恢复），
  不出现 Dialog 遮罩

## ADDED Requirements (cont.)

### Requirement: 模型 provider 目录以 zcode Registry 为源

模型 provider 目录数据源 MUST 为 zcode Registry 生成物（zai-org/ZCode
zcode-builtin.json → 生成预设文件；数据结构沿用 shufa 的 ModelPreset），
不再读取 pi-ai 的 models.dev 镜像（目录数据零 models.dev 依赖）。
投影到 ModelProviderCatalogEntry 的映射：api 三值直传、contextWindow
直传、efforts → effortTiers、image = inputTypes 含 image；provider
图标本仓 PROVIDER_ICONS 优先，缺失回退 preset iconUrl（models.dev
静态 logo 资产，shufa 同口径）/ 字母头像；fetch-provider-icons 刷新
脚本的 provider 清单 MUST 来自 zcode 生成物（不再读 pi-ai 包树）。

#### Scenario: 目录来自 zcode 源

- **WHEN** 打开 Settings → Model 分区
- **THEN** provider 画廊来自 zcode-presets 生成物（重跑脚本即可整体换新），
  界面零 models.dev 目录依赖
