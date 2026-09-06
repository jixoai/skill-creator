# dsh-webui-composition verification（进行中）

记录日期：2026-09-06。

## 已完成任务

| Task                               | 提交    | 证据                                                                                                                                                                               |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 web composition 事实与版本锁定 | c35e799 |
| 1.1 最小真实 DSH web host 启动 | 26fadd8 | 事实表（research 文档）+ 契约（DSH_WEB_LOCKED_PACKAGES / typed unavailable）+ 安装面（webui devDeps 浏览器面 / 根 devDeps dsh-web-app）+ test/dsh-web-composition.test.ts 6 passed |

## 关键实测事实（后续任务的约束）

1. DSH web shell 是 React 构建（react/react-dom 19 + css modules）；Skill Creator 的 Svelte 组件不能直接进 slots——host/island（3.1a）或同形态 client 插件（1.2）。
2. `/client` 子入口是 `window.__ModuleLoader__.load({id, factory})` 工厂模块：只能进官方 shell 的模块加载器，Node 下不可执行（预期形态）。
3. `dsh-client-web` 声明 peer 仅有 cordis；真实 import 面 = react 系 + cordis-plugin-loader + client-store/ui-primitives/ui-slots。缺失 → 浏览器 module-not-found → typed unavailable（MISSING_PEER）。
4. `dsh-web-app` exports `./startup`（host 启动 seam）与 `./cordis.patch.yml`（profile patch 通道）；72 直接依赖全家桶，daemon 不应整体引入——1.1 只复用 startup/boot seam。
5. koffi（directory-picker-native 的 FFI）构建脚本显式拒绝：本仓不用原生目录选择器。

## 1.1 实测注记

- 最小组合的服务闭合链（实测）：host-webserver（提供 webServer）→ credentials-local（提供具体 ctx.credentials；dsh-credentials 只是抽象 seam，装它会 `credentials.modifyRecord is not a function`）→ client-connection（webServer+credentials → 提供 connection + /api fence + token/cookie 会话）→ client-modules（扫 loader entries；Loader 必须带 baseUrl，否则 entry 无 resolution base URL）→ web-app（webServer → 自挂官方 dist + authenticatedUrl）。
- token 握手实测形状：`/?token=<launch-token>` → 303 + `Set-Cookie: dsh-auth-…` + `Location: /`；带 cookie GET / → 200，index 从 679B 膨胀到 ~3KB（__DSH_BOOT__ boot graph 注入）。
- cordis Context 无进程退出钩子：独立 smoke 进程在成功路径显式 process.exit（keep-alive 句柄）。
- daemon 侧挂载（/dsh 反代、remote namespace 桥）按任务归属归 3.1a；1.1 交付可复用 boot 模块 + smoke 证据，不做未验证的 daemon wiring。

## 门禁状态

- 0.1 边界：全量 354/354（44 files）。
- 1.1 边界：全量 358/358（45 files）；typecheck 0 错；webui check 0/0；fmt/diff-check 干净；openspec 9/9。
- 1.2 起未完成。
