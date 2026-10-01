# Proposal: shell-settings-ui — AppSidebar 组件化与 General 偏好生效（工作计划 Ch6）

## Why

+layout.svelte 的左侧导航是记录在案的简化版（「AppSidebar 的完整功能后续迭代」）：
无标签、无折叠态。DevicePrefs v1（theme/sidebarCollapsed）自 2026-07-27 定义以来
零消费者——General 设置区只有 daemon 连接状态，没有可操作的偏好。layout.css 的
`.dark` token 全套就绪但无任何切换路径。

## What Changes

- [x] AppSidebar 组件化：左侧导航从 +layout.svelte 内联抽为独立组件；展开
      （标签 + w-44）/折叠（图标 + w-14）双态，折叠偏好持久化到
      DevicePrefs.sidebarCollapsed；App 列表（含 settings 页）+ 导入入口不变。
- [x] 主题生效：appearance store（$state）消费 DevicePrefs.theme，`.dark`
      类挂 document.documentElement；system 模式跟随 matchMedia 变化。
- [x] General 设置区新增 Appearance：主题三选（Light/Dark/System）+ 侧栏
      默认状态开关；写入 DevicePrefs（localStorage 单源，不新增 RPC）。

## Impact

- webui/src/lib/components/shell/app-sidebar.svelte（新）+ layout 接线。
- webui/src/lib/shell/appearance.svelte.ts（新 store）。
- GeneralSettingsSection.svelte 增加 Appearance 分区。
- 无 daemon/RPC/契约变更（纯 webui 设备偏好，符合「Storage 只存设备偏好」裁决）。
