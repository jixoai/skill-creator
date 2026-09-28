# Tasks

- [ ] 1.1 app-icon.ts：`resolveWindowIcon` 导出（win32 light ICO 裸 IconImage；其余平台 null）+ 单测
- [ ] 1.2 tray-host.ts：`windowControlsOverlay: true` 无条件化 + show `icon` 接线 + overlay 失败降级重试（绝不 headless）
- [ ] 1.3 tray-mount.test.ts：overlay 恒 true 断言 + 降级路径回归钉
- [ ] 1.4 daemon-dev.ts：tsx loader `--import` specifier 转 file:// URL + 全平台单元钉
- [ ] 1.5 AGENTS.md §3.1 窗口创建法则同步（含降级护栏）
- [ ] 1.6 门禁 + Owner 真机目检（任务栏图标 / 单一自定义标题栏或降级原生框）
