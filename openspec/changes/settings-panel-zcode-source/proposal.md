# Proposal: settings-panel-zcode-source

## Why

Owner（2026-09-25）两点裁决：

1. 「目前的 settings 是一个 Dialog，放弃 Dialog，改成标准的页面面板。」
2. 「不再依赖 models.dev，这个源更倾向于 models 而不是 agents-models。请参考
   shufa-server……使用它那套数据结构和 zcode 源更新脚本，我们自己这套
   models.dev 已经可以完全放弃。」

## What Changes

- **Settings 页面化**：SettingsDialog（shell 级 Dialog）退役；Settings 成为
  标准 shell 页面面板（App 语义，路由 /settings；内部保留 list-detail
  分区结构；入口仍钉在左导航底部——按钮行为从开 Dialog 改为导航）
- **模型源换 zcode Registry**：移植 shufa-server 的
  `daemon/scripts/extract-zcode-presets.mjs`（上游 zai-org/ZCode 的
  `config/provider/zcode-builtin.json` → 生成预设文件；按本仓法则转
  `.sh.ts` Bun 脚本），数据结构沿用其 `ModelPreset`（provider/name/
  baseURL/api/iconUrl/models{id,contextWindow,inputTypes,efforts}）；
  model-catalog.ts 从 pi-ai 的 models.dev 镜像（fs 读 dsh-base 包树）
  改为消费生成的 `zcode-presets.ts`，投影到既有
  `ModelProviderCatalogEntry`（api 三值枚举两侧一致；contextWindow 直传；
  efforts → effortTiers；image = inputTypes 含 image）
- models.dev 依赖面清退：model-catalog 的 pi-ai JSON 镜像读取删除；
  provider 图标沿用本仓 PROVIDER_ICONS（zcode templateId 命中则用，
  否则 preset iconUrl/字母头像回退）

## Non-Goals

- 不迁移存量 settings.modelRoutes 数据（无兼容策略：存量路由自带
  baseURL/api 仍可用；目录里 provider id 变化的仅影响 UI 展示名/图标）
- 不做 zcode 源的自动定时更新（脚本手动重跑，随上游 revision 升级）
- 不改 Settings 各分区内部功能（General/Model/Agent/Sessions 平移）

## 影响面

- scripts/extract-zcode-presets.sh.ts（新，Bun）+ src/daemon/zcode-presets.ts
  （生成物）
- src/daemon/model-catalog.ts（数据源重写）+ test/model-catalog*.test.ts
- webui：apps 注册 Settings 页面（manifest + SettingsPage.svelte 骨架 +
  四分区组件平移）；shell 左导航底部入口改导航；settingsUi store 的
  open 语义退役（section 并入路由或 store 保留 section 态）；
  SettingsDialog.svelte 删除；route-match 测试
