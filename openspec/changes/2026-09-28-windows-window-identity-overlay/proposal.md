# Proposal: windows-window-identity-overlay

## Why

Windows 实机目检（Owner 2026-09-28 报告）：skill-creator 窗口①无图标；
②`overlay-window-controls` 未生效——原生标题栏与 WebUI 自定义顶栏（ChromeTabs
Shell 的 WindowDragRegion）叠加成双标题栏。诊断证实**两个症状都是 skill-creator
的接线缺口，非 opentray 版本问题**（0.32.0 carrier DLL 已含
`Windowing_GetWindowIdFromWindow` / `titlebarAreaRect` / `startAppRegionDrag` /
`windowControlsOverlay` 全部符号；上游 appwindow.rs 2026-07-14 即落地）：

1. **窗口无图标**：daemon 从不在 show 命令传窗口级 `icon`。macOS 的窗口身份
   由 bundle 再生承载；win32 需要窗口级 `icon`（file ICO）→ HWND
   `WM_SETICON`（标题栏/任务栏/alt-tab）——运行时链路一直在，我们没接。
2. **overlay 未生效**：tray-host 对 win32 显式传
   `windowControlsOverlay: false`（macOS 轮「Windows keeps its native frame」
   的决策，未经 Windows 实机目检）。WebUI Shell 按统一自定义标题栏设计
   （拖拽区 + overlay 几何避让）；win32 关掉 overlay 后 `getTitlebarAreaRect`
   直接 Unsupported，原生框 + 自定义顶栏并存。
3. **dev 启动链断（真机验证的阻塞项）**：`webui/config/daemon-dev.ts`
   `resolveDevDaemonArgs` 把 `resolve("tsx")` 的裸绝对路径直接传给
   `node --import`——Windows 上盘符被 ESM loader 当 URL 协议
   （`ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'e:'`）；POSIX 裸路径
   只是恰好宽容。既有盲区：daemon-dev.test.ts 整用例 `skipIf(win32)` 且
   fake daemon 是 .cjs（不经 `--import` 路径）。

## What Changes

1. `src/daemon/app-icon.ts`：新增导出 `resolveWindowIcon(webuiDir, platform?)`
   ——仅 win32 返回裸 `{ type: "file", path: win32-light.ico }`（wire IconImage
   形状；原生侧按 `type` tag 反序列化，Icon 候选 map 会被拒绝。default/light
   变体；tray template PNG 不晋升为窗口身份，遵守既有法）；其余平台返回
   null（macOS bundle 承载，行为不变）。
2. `src/daemon/tray-host.ts` `mountWindowedTray`：
   - `windowControlsOverlay: true` 无条件化（win32 = AppWindow
     `ExtendsContentIntoTitlebar` + 系统绘制 caption 按钮 + titlebar-area
     几何事件；macOS 原值即 true，行为不变）。
   - show 命令追加 `icon: resolveWindowIcon(...)`（null 时省略）。
   - **降级护栏（真机验证第二弹）**：win32 overlay 经 AppWindow 依赖
     Windows App Runtime bootstrap——Bootstrap.dll 随 WinAppSDK redist 分发，
     CBS 发行不含，Owner 实机全机无此 DLL；overlay show 失败时销毁首
     panel、关 overlay 重试一次，`icon`（与 overlay 正交）保留，绝不让
     overlay 缺席把窗口打成 headless。
   - `frameless: false` 保持——系统仍拥有边框/阴影/resize 与 caption 所有权，
     符合 §2 约束 7 原生窗口管理法则。
3. `webui/config/daemon-dev.ts`：`resolveDevDaemonArgs` 的 tsx loader 统一
   `pathToFileURL` 成 file:// URL（平台中性；函数导出供测试钉）。
4. AGENTS.md §3.1 窗口创建法则同步（win32 同走 overlay 标题栏 + 窗口身份
   经 show `icon`）。
5. 回归钉：app-icon.test.ts（win32 裸 IconImage 投影 / 非 win32 null）+
   tray-mount.test.ts（createWebviewWindow 参数含 `windowControlsOverlay: true`
   - overlay 失败降级路径）
   * daemon-dev.test.ts（`--import` specifier 必须是 file:// URL，全平台）。
6. 测试卫生（真机轮发现的日志污染）：tray-host / tray-mount 测试经
   `setHomeOverride` 隔离临时 home——TrayHost 的 best-effort log 此前直写
   操作者真实 daemon.log（曾以 "fixture.emitState" 假失败误导诊断）。

## 验收

- 真机目检（Owner）：win32 窗口任务栏/alt-tab 出现 app 图标；有 WinAppSDK
  bootstrap 的机器呈单一条自定义顶栏（caption 叠加），缺失机器降级原生框
  窗口（图标仍在），两种机器都绝不变 headless。
- 全量门禁（AGENTS.md §9）通过；macOS 行为零变化（overlay 原值 true、
  icon 平台门控 null）。
