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
- token 握手实测形状：`/?token=<launch-token>` → 303 + `Set-Cookie: dsh-auth-…` + `Location: /`；带 cookie GET / → 200，index 从 679B 膨胀到 ~3KB（`__DSH_BOOT__` boot graph 注入）。
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

## 2.1 实测注记（step 2 补充：断线/重启恢复）

- 宿主进程整体死亡：浏览器层 ERR_CONNECTION_REFUSED + 重新加载入口（dsh-web-2.1-disconnected.png）；进程内 WS 断连横幅属官方 client-connection 自带行为（复用，不改写）。
- 宿主重启（dispose → 同一固定 home 重启，端口/token 轮换）：workspace 与既有 session 列表完整恢复（「hello, this is a skill-creator · 12分钟」仍在侧边栏；dsh-web-2.1-restarted.png / -restarted-session-detail.png）——session persistence + workspace storage 的重启可验证状态成立；干净 home 的 dispose→二次 boot ready 已由 official-profile 测试与 smoke 脚本覆盖。
- 2.1 勾选状态（诚实边界）：settings/model/preset/permission 选择面、session list/detail、transcript、类型化 MISSING_CREDENTIAL、断线/重启恢复均已有真实证据；「tool 事件进 transcript」与「运行中取消控件」按任务归属由 2.2 的 Manager tools 逐 call 关联（确定性、无需 LLM 凭据）与后续 Agent 运行面交付——2.1 checkbox 暂不勾，待 2.2 落地后合并浏览器验收再勾。

## 2.2 实测注记（Manager tools → 官方 transcript）

- 实现：`dsh-session-binder.recordToolRounds(dshSessionId, calls)`——每个 Manager `SkillToolCall` 一对官方事件 `tool/call`（{turn,step,callId,name,arguments}）+ `tool/result`（`createToolResultMessage`，`sourceEventSeqs` 引用 call 事件；failed 附 error code/message），callId 即 Manager 调用 id（跨体系关联键；brand 为零成本编译标记，边界一处显式转换）。纯投影：不注册工具、无执行入口；per-session callId 集合幂等（重连/重渲染再投影 → projected:0，不追加第二份事件，执行更不会重放）。
- Manager 侧关联：`PersistedRunRecord.toolCalls`（id/tool/resultKind，denied 非域调用照实入档）随 runs.jsonl 落盘，listRuns 收窄透传；pipeline 在 completeBoundSession 前投影工具轮，事件顺序 user → tool rounds → assistant → step/end → turn/end 与 agent-loop 一致。
- 测试 `test/dsh-tool-composition.test.ts` 2/2：(a) 真实 pipeline run（官方组合）——runs.jsonl 的每个 toolCalls[].id 都出现在 DSH session log 的 tool/call data.callId，tool/call 与 tool/result 数量配对，顺序断言，域调用全部落在 `AGENT_ALLOWED_TOOLS` 白名单；(b) 同批调用重复投影幂等（1 对事件，projected 1→0）。
- 浏览器验收（`scripts/dsh-tool-round-live.sh.ts`：干净 home 官方 profile + daemon Workspace/技能 + binder 化 pipeline.startRun，terminal completed、toolCalls 2）：官方 UI 侧边栏出现绑定会话「Steward sr_67db76a7218049aa57a1f4db」；会话详情 transcript 呈现 user turn（含 Manager run id）、「2 次工具调用」折叠行、终态 assistant 叙述（responses/toolCalls/proposals 计数）、「1 轮 · 1 步」统计（dsh-web-2.2-tool-round-transcript.png / -tool-calls-expanded.png / -trace-tab.png；全程 0 JS 错误）。
- 诚实边界：permission/approval 的交互对话框属官方 agent 运行面（需 LLM 凭据，最终产品阶段验收）；本 change 会话事件流已含 permission/preset + sandbox/mode + approval/policy（官方组合在 session 创建时自动附加，探针实证 seq 0-2），权限输入面（默认模式设置/会话访问模式三档+完全权限确认文案）已浏览器取证。
- 门禁（2.2 边界）：全量 376/376（49 files）；typecheck 0；webui check 0/0；目标文件 fmt 绿；git diff --check 干净。

## 3.1a 实测注记（Manager host/island 挂载同一 DSH host——进行中）

- step1 已提交：`WebServer.mountDsh` 同源挂载（Manager 保留 `/ws/rpc`、`/ws/acp/*`、`/api/health`、`/manager/*` 资产前缀；DSH 官方 route 经 HTTP/升级双代理；DSH 未挂载时 SPA 静态回退=恢复入口；代理在 daemon 边界改写 origin/referer 为 DSH host origin——两套鉴权仍各自执行）。测试 `test/dsh-manager-mount.test.ts`：路由分区、token 握手过代理（303+cookie+`__DSH_BOOT__`）、`/manager/*` 静态可达、卸载恢复。
- step2/3 实现完成（浏览器已验证数据面）：`@skill-creator/dsh-client` browser half 向官方 `sidebar.footer.action`（root-scope list slot）贡献 Manager 入口（apply/inject 协议测试 2/2）；点击动态加载 `/manager/dsh-island.js`（新 `webui/vite.island.config.ts` 单文件 IIFE + scoped CSS 稳定资产名）挂载 Svelte island——`webui/src/lib/dsh-island/`：IslandRoot/IslandShell（AppShell 同源逻辑，location 为 island 进程内状态）、island-nav（注入 NavControllerAdapter，无宿主 URL 副作用）、$app/navigation + $app/state shims；entry mount 等 Manager 连接 connected 后再挂载（WorkspacesHome 首载不重试）。plugin 工厂在 combo 加载时捕获 `#token=`（DSH shell 会清理地址栏）。
- 浏览器证据（`scripts/dsh-manager-island-live.sh.ts`，daemon WebServer + 官方 DSH host + 双 token 入口 `?token=<dsh>#token=<manager>`）：DSH 页面 footer 出现 Manager 入口；island 挂载后渲染**原有 WorkspacesHome 真实数据**（Global Workspace 543 skills/75 agent locations）并可导航进 **原有 ProviderView**（Amp provider：列表+markdown 正文+Insights/Steward/Updates tabs，island 导航 adapter 生效）；同源 /ws/rpc 从页面探测 WS_OPEN_OK（dsh-web-3.1a-island-mounted.png / -provider-view-island.png）。
- 已知问题（3.1a 未完项）：DSH live-sync 通道经朴素 node 代理周期性断流重连（所有 HTTP 单发请求 200、SSE /plugins/events 可流式；连接层内部 sync 断流触发官方重连 UI）——session 列表/transcript 同屏被此阻塞（session/transcript 本身在 2.1/2.2 直连 host 已验证）。owner：本任务收尾（代理流兼容性）。
- live-sync 断流根因已修复（同轮）：DSH connection 的 remote 流是 WebSocket（dsh-api-gateway client `remoteStreamUrl()`：`/api/remote.mux`，ws:// 协议升级）。代理升级桥接缺 origin 改写——浏览器升级携带 daemon origin，DSH host Origin 校验 403（无页面请求痕迹、连接层静默重连，故此前误判为"流兼容性"）。`proxyUpgradeToDsh` 与 HTTP 代理同源改写 origin 后：0 重连，workspace/session 列表、绑定 Steward 会话（含 2 次工具调用 transcript）全部经代理可见。
- 同屏验收（`scripts/dsh-manager-island-live.sh.ts`：daemon WebServer + 官方 DSH host + 预置 workspace + 绑定 steward run + 双 token 入口）：同一 DSH 页面内——sidebar 显示绑定会话「Steward sr_…」；点击打开 transcript（user turn + 「2 次工具调用」+ 终态叙述）；footer Manager 入口挂载 island 并可导航到原有 ProviderView（截图 dsh-web-3.1a-same-page-transcript-island.png / -same-page-providerview-transcript.png / -final-same-page.png；全程 0 JS 错误、0 连接重试）。
- 重连/卸载单 owner 验证（浏览器）：island 关闭→0 host 残留；重开→恰好 1 host、1 style、1 css link（无重复注入）、transcript 不受影响；协议级 owner 单例/幂等由 test/dsh-client-plugin.test.ts 覆盖。
- 门禁（3.1a 收尾边界）：全量 379/379（50 files）；typecheck 0；webui check 0/0；fmt/diff-check 干净。

## 3.1b 实测注记（Workspaces/Provider/Skill surfaces 迁移）

- island 全局浮层：SPA layout 拥有的 ImportWorkspaceDialog / CommandPalette / ToastContainer 在 IslandRoot 等价挂载（bits-ui Portal 锚定 island portal root，不逃逸 DSH 宿主 DOM）——此前 Import 点击无反应的根因即对话框不在 island 内。
- close/reopen 生命周期修复：插件 closeIsland 把 host 元素传给 entry.unmount，而 mount 注册的是内层 panel → unmount 匹配失败静默 no-op（残留 Svelte root 阻断重挂、disconnect 未执行）。修复：插件追踪 panelEl 并传 panel；entry 兼容包含 mount 目标的容器。验证：关闭→0 残留，重开→恰好 1 host/1 style/1 link，transcript 不受影响。
- live 脚本改用真实 skills 探测（deterministic fixture 探测会掩盖真实文件系统证据；真实 `npx skills list` 单次导入 ~15-30s）。
- 浏览器验收（同源组合，`scripts/dsh-manager-island-live.sh.ts`）：
  - 导入：island 对话框输入 `/tmp/3p1b-ws` + 标签 → daemon registry 落盘 `3p1b-ws`（workspaces.json 证据）；workspace 行展示全部 provider 与真实计数（OpenClaw 1）。
  - 浏览：provider 视图技能列表 → 技能详情（frontmatter name/description 表 + SKILL.md markdown 正文 + Save/Validate/Disable 操作）。
  - 启停：Disable → 磁盘 `SKILL.md` 变 `.SKILL.md`、UI 出现 Enable；Enable → 恢复 `SKILL.md`（前后 ls 磁盘证据；截图 dsh-web-3.1b-skill-detail-toggle.png / -workspaces-home.png）。
  - 溢出：island 面板（min(560px,92vw) 容器查询布局）scrollWidth=clientWidth，无横向溢出。
- 3.1b 勾选；生产入口切换（daemon 默认 DSH host + SPA 仅恢复夹具）归 3.2/4.1。

## 3.1c 实测注记（Creator/Repository surfaces 迁移）

- 实现：`IslandRoot.svelte` 匹配面扩到三 App（workspaces/creator/repository manifest activities，复用 SPA 同源 matchRouteTree，无 manifest 改动）；`creator-editor.svelte.ts` 新增模块级跨卸载草稿缓存（`creatorDraftKey` route-identity 键 + `snapshotCreatorDraft` 拷贝隔离；卸载快照键取草稿自身身份——new 保存成功后草稿已切 edit 语义，不落 URL 的 new 键）与身份级 hydration 标记（同一身份只自动 hydrate 一次；显式 Reload/Retry 走 `resetDraftHydration`；delete 后 `dropCachedCreatorDraft`）。CreatorWorkspace 挂载恢复优先缓存并标记已 hydrate（FileBrowser 不重拉重置 baseline）；FileBrowser delete 成功清缓存与标记。
- 浏览器验收（`pnpm exec tsx scripts/dsh-manager-island-live.sh.ts`，真实 skills 探测 + 真实网络 clone，0 JS 错误）：
  - Creator：island palette（cmd+k）→ Creator → New skill（ws_bcafc73bcbac89a26a92417e / aider-desk）；dirty draft 四字段（directoryName/name/description/body）经 island 关闭（0 残留、connection idle）→ 重开 → 重导航完整恢复；Create 真实落盘 `ws/.aider-desk/skills/final-save-probe/SKILL.md`（frontmatter name/description + body 与表单一致）。
  - Repository：Discover curated feed 可达；扫描 Anthropic 官方源 pinned commit `41bbe19d1a1a`（20 skills，真实 GitHub clone）；勾选 academy-guide + 安装目标 island-ws/AiderDesk → Install → `ws/.aider-desk/skills/academy-guide/SKILL.md`（真实官方 skill 内容）落盘。
  - 溢出：Creator 编辑器与 Repository scan 视图在 1100px/680px 面板宽均 scrollWidth===clientWidth（截图 dsh-web-3.1c-creator-1100px.png / dsh-web-3.1c-repository-installed.png 等）。
- 单测：`pnpm exec vitest run webui/src/lib/__tests__/creator-draft-cache.test.ts` 3/3（身份键语义、快照双向隔离、hydration 标记 reset）。
- 工具限制（诚实声明）：bb-browser 合成 `input` 事件不触发 island 包内 Svelte bind（palette bits-ui 过滤例外）；表单输入改经 `document.execCommand('insertText')` 真实编辑管线完成，点击均走真实 DOM handler。revision conflict / session expiry / recovery 状态语义未在 island 内逐项重演——由 store 层代次门与 creator save CONFLICT 既有测试持有（本轮未改其逻辑，只加了缓存层）。

## 3.2 实测注记（移除 generic ACP 产品入口）

- `webui/src/lib/components/creator/acp-panel.svelte` 删除；CreatorWorkspace 单列化（分栏/拖拽/chat-toggle 移除），Test 子视图文案指向 DSH-hosted agent session。
- `rpc-contract.ts` acp namespace 标注 internal legacy（不追加能力；daemon 诊断/测试保留）；README 与 AGENTS.md 产品真相同步（ACP Bridge = internal legacy，Agent 会话由 DSH host 唯一承载）。
- 验收：`rg -i acp webui/src` 仅余移除决策注释；README/产品面零 ACP 叙事。daemon 默认入口切 DSH host 归 4.1。
- 门禁：typecheck 0、webui check 0/0、全量 411/411、fmt 绿、openspec 9/9。
