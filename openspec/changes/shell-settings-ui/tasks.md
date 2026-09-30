# Tasks: shell-settings-ui

- [x] 1. appearance store（theme → .dark 类 + system matchMedia 跟随；
      sidebarCollapsed 读写 DevicePrefs）
- [x] 2. app-sidebar.svelte 组件化（展开/折叠双态 + 标签 + tooltip/aria），
      +layout.svelte 接线替换内联 nav
- [x] 3. GeneralSettingsSection Appearance 分区（主题三选 + 侧栏默认开关）
- [x] 4. 门禁：focused webui tests + `pnpm --dir webui check` + typecheck +
      fmt + full build

## 验收证据

- appearance store：`webui/src/lib/shell/__tests__/appearance.test.ts` 3/3
  （dark 类即时切换 + DevicePrefs 持久化 + 侧栏折叠翻转）。
- AppSidebar：+layout.svelte 内联 nav 移除，组件双态（w-44 标签 / w-14 图标）
  + 底部折叠开关（aria-pressed）；svelte-check 0 errors。
- 门禁：typecheck 0、svelte-check 0、vp fmt --check 0、pnpm build 0、
  sessions-settings 7/7。
