# dsh-webui-composition verification（进行中）

记录日期：2026-09-06。

## 已完成任务

| Task                               | 提交    | 证据                                                                                                                                                                               |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 web composition 事实与版本锁定 | c35e799 |
| 1.1 最小真实 DSH web host 启动     | 26fadd8 | 事实表（research 文档）+ 契约（DSH_WEB_LOCKED_PACKAGES / typed unavailable）+ 安装面（webui devDeps 浏览器面 / 根 devDeps dsh-web-app）+ test/dsh-web-composition.test.ts 6 passed |

## 关键实测事实（后续任务的约束）

1. DSH web shell 是 React 构建（react/react-dom 19 + css modules）；Skill Creator 的 Svelte 组件不能直接进 slots——host/island（3.1a）或同形态 client 插件（1.2）。
2. `/client` 子入口是 `window.__ModuleLoader__.load({id, factory})` 工厂模块：只能进官方 shell 的模块加载器，Node 下不可执行（预期形态）。
3. `dsh-client-web` 声明 peer 仅有 cordis；真实 import 面 = react 系 + cordis-plugin-loader + client-store/ui-primitives/ui-slots。缺失 → 浏览器 module-not-found → typed unavailable（MISSING_PEER）。
4. `dsh-web-app` exports `./startup`（host 启动 seam）与 `./cordis.patch.yml`（profile patch 通道）；72 直接依赖全家桶，daemon 不应整体引入——1.1 只复用 startup/boot seam。
5. koffi（directory-picker-native 的 FFI）构建脚本显式拒绝：本仓不用原生目录选择器。

## 1.1 实测注记

- 最小组合的服务闭合链（实测）：host-webserver（提供 webServer）→ credentials-local（提供具体 ctx.credentials；dsh-credentials 只是抽象 seam，装它会 `credentials.modifyRecord is not a function`）→ client-connection（webServer+credentials → 提供 connection + /api fence + token/cookie 会话）→ client-modules（扫 loader entries；Loader 必须带 baseUrl，否则 entry 无 resolution base URL）→ web-app（webServer → 自挂官方 dist + authenticatedUrl）。
- token 握手实测形状：`/?token=<launch-token>` → 303 + `Set-Cookie: dsh-auth-…` + `Location: /`；带 cookie GET / → 200，index 从 679B 膨胀到 ~3KB（**DSH_BOOT** boot graph 注入）。
- cordis Context 无进程退出钩子：独立 smoke 进程在成功路径显式 process.exit（keep-alive 句柄）。
- daemon 侧挂载（/dsh 反代、remote namespace 桥）按任务归属归 3.1a；1.1 交付可复用 boot 模块 + smoke 证据，不做未验证的 daemon wiring。

## 1.2 实测注记

- client-modules 扫描协议（lib/index.js resolveMeta 实测）：loader entry 的包 → package.json `dsh.client`（platform 必须 "web"；inject/external 为可选 string[]）→ `exports["./client"].default` 指向的 bundle 必须存在（MissingClientBundleError 附构建说明）；combo script 路由 `/plugins/??<id>/client.js,...&rev=...`（HTML 中 `&` 转义为 `&amp;`）。
- 官方 browser-only 插件的 node half 形状 = 空 `apply()` 导出（dsh-client-ui-session 实证）；Manager plugin 沿用同形。
- 手写 JS 插件包（无构建链）：Loader 的 internal.import 是原生 ESM，node half 不能是 TS。
- 单 RPC owner 语义在 factory 闭包内固化；传输（daemon loopback / DSH connection channel）归 3.1a。

## 2.1 实测注记（step 1）

- 路线决策：api-session-controller 的 peer 链 26 包（sessions/persistence/projection/agents/llm/jobs/subagent/...）证明子集拼装必然滚成完整 base 层——正路是官方 profile 机制（dsh-app-boot：initProfile/loadProfile/healProfilesModuleFallback/boot），bundles = dsh-base（85 rows 单包闭包）+ dsh-web-app。
- 首次失败链：webserver row `inject: [webStartup]`（非仅 config 表达式）；disable web-startup 会级联 7 entries pending。正解 = prepare 钩子提供 cmdlineArgs launcher seam（等价 dsh-cmdline provideCmdline：ctx.provide("cmdlineArgs",{get}) + appExit），web-startup 真实解析 `--no-open --port 0` 并 provide webStartup。
- healProfilesModuleFallback 把本仓 node_modules 闭包 symlink 进 $DSH_HOME/profiles/node_modules——profile rows 的裸包名经 Node parent-walk 解析，无需 profile 内 install。
- 完整 profile 启动 ~4s：85+ rows 全激活（assertEntriesActivated）；index 注入完整 roster（337 个 dsh-client-* 引用；ui-settings/ui-session/ui-chat/ui-approval 全在）；combo scripts 可服务；干净 home dispose→重启 ready。
- 待完成（step 2/3）：内置浏览器交互验证（model/profile 选择、session/tool/permission 事件、断线/取消/重连/重启恢复按钮）与 Steward run↔DSH session id 绑定面（daemon 侧）。task 2.1 不勾。

## 门禁状态

- 0.1 边界：全量 354/354（44 files）。
- 1.1 边界：全量 358/358（45 files）。
- 1.2 边界：全量 362/362（46 files）。
- 2.1 step1 边界（47739b7）：全量 365/365（47 files）；typecheck 0 错；webui check 0/0；fmt/diff-check 干净；openspec 9/9。
- 2.1 step2/3 起未完成。
