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

## 2.1 实测注记（step 2：浏览器交互验证）

- 宿主：`DSH_WEB_LIVE_HOME=/tmp/dsh-web-live-fixed pnpm exec tsx scripts/dsh-web-live.sh.ts`（常驻官方 profile；固定 home 复用模式，脚本已提交）。工作区记录为 server 侧 `storages/workspace.json`（dsh-workspace defineDomain v2：path/title/sessionIds/时间戳，id=randomUUID）——「添加工作区」按钮走 koffi 原生目录选择器（本仓 allowBuilds 显式拒绝），web 端以 server 侧预置工作区验证。
- 关键根因修复（提交 6b3595c）：官方 agent-presets 的 standard/minimal 行引用 `@deepseek-ai/dsh-persona`/`@deepseek-ai/dsh-tool-ask-user`（ptc 另需 `@deepseek-ai/dsh-agent-tool-presentation`），不在 dsh-base 闭包内；heal 的 module fallback 只遍历根 manifest dependencies/peerDependencies。缺包时 `POST /api/session/create` 返回 200 包体 `agent-preset/invalid`（UI 静默不建会话）。三包已入根 dependencies。
- 交互证据（内置浏览器，全程 0 JS 错误；POST /api/session/create、/api/session/prompt 均 200）：
  - 首启：内测声明 modal → 选择工作区引导 → API Key 引导（稍后配置可跳过）。
  - 设置面板：通用（权限默认模式/语言/外观/字号/对话显示/繁忙 Enter）/ 模型（DeepSeek 官方 provider 密钥 + 自定义提供方）/ 插件 / Agent 预设 tabs（dsh-web-2.1-settings*.png）。
  - Agent 预设 tab：standard（当前使用）/PTC/minimal 全部挂载（修复前 2-3 行 unresolvable；修复后仅剩描述性提示，可选）。
  - Composer 面：模型选择（当前 DeepSeek-V4-Flash + 推理等级 High）、Agent 预设选择（standard/PTC 菜单）、访问模式（仅可查看/工作区内修改/完全权限；完全权限有确认对话框文案）（-preset-menu/-access-modes/-model-menu.png）。
  - 发送消息 → 真实 session 建立：侧边栏会话列表（标题+时间）、详情 tabs（对话/轨迹/系统提示词）、上下文注入行（AGENTS.md、@deepseek-ai/dsh-system-prompt、skill-catalog）、轮/步计数（dsh-web-2.1-session-transcript.png）。
  - 无凭证运行失败呈现为类型化错误：`MISSING_CREDENTIAL` + 明确恢复指引（web Models 页写 key 或 DEEPSEEK_API_KEY）（dsh-web-2.1-missing-credential.png）——对齐 integration-contract「首次无凭证打开」行。
- 待完成（step 3）：Steward run↔DSH session id 绑定（daemon 侧：packages/skill-creator-dsh-client/src/agent/ + rpc-contract + steward）；tool/permission 事件经 Manager 域工具流入官方 transcript；断线/取消/重连/daemon restart 恢复按钮。task 2.1 不勾。

## 2.1 实测注记（step 3：run ↔ DSH session 绑定，daemon 侧）

- 新模块 `src/daemon/steward/dsh-session-binder.ts`：`createDshSessionBinder({host})` 在官方组合内以 `ctx.sessions.create`（meta.cwd=workspace realpath）+ `workspaceRegistry.resolveByPath ?? create` + `attachSession`（cwd 对齐校验由官方 registry 执行）建立 workspace 归属 session；事件语法实测对齐 dsh-agent-loop：`session/title` → `turn/start` → `step/start` → `user/message`（`createUserMessage`，source kind "user"）→（run 终态）`assistant/message`（`createAssistantMessage`，source provider "skill-creator-steward"）→ `step/end` → `turn/end`（reason completed/error）。durable 事实仍只写 Manager audit-store；DSH 侧是纯展示投影（tools 逐 call 关联按任务归属归 2.2）。
- 绑定链：`SkillStewardRunResultSchema` + 可选 `dshSessionId`；`PersistedRunRecord` 同步携带（listRuns 收窄透传）；`createSkillStewardPipelineService` 可注入 `dshSessionBinder`（宿主不可用/绑定失败 → run 正常完成、结果无绑定字段，无假成功）。生产 daemon 的 host 生命周期按任务归属归 3.1a，本步交付绑定面 + 注入测试。
- 存储隔离教训（重要，已修复）：dsh storage 单元经 `resolveDshHome()`（env DSH_HOME ?? ~/.dsh）定位 storages，不看 boot 的 home 参数；`bootOfficialWebProfile` 现在在 boot 前固定 `process.env.DSH_HOME = home`、dispose 恢复（含删除原值）。修复前 binder 测试曾把两条临时 workspace 记录写进用户真实 `~/.dsh/storages/workspace.json`——已按 entry 精确清除（仅两条 /var/folders 测试路径），用户原有 4 条 workspace 记录未动，留 `.bak-zcode-pollution` 备份核对。
- 测试 `test/dsh-session-binder.test.ts` 3/3：typed HOST_UNAVAILABLE；真实官方组合内 openBoundSession（workspace.json sessionIds 收录 + store 事件语法断言）+ completeBoundSession 终态；pipeline 注入后 startRun 结果与 runs.jsonl 均携带 dshSessionId 且 DSH 侧呈现终态叙述。`test/dsh-official-profile.test.ts` 3/3 复跑通过（env 隔离无回归）。
- 门禁（step 3 边界）：全量 374/374（48 files）；typecheck 0；目标文件 fmt 绿；git diff --check 干净。
