# Tasks: dsh-webui-composition

依赖：`dsh-runtime-integration`。顺序和唯一任务归属见根级 `GOAL.md`。先阅读 `docs/research/2026-09-06-dsh-integration.md` 和本 change 的 `integration-contract.md`。

- [ ] 0.1 固定 DSH Web composition 事实和版本。
  - Files: `package.json`, `pnpm-lock.yaml`, `src/shared/contracts/dsh-runtime.ts`, `docs/research/2026-09-06-dsh-integration.md`。
  - Steps: 逐个读取锁定 commit 中候选 package 的 `package.json`、`exports`、`types`、`peerDependencies`、构建脚本和最小实例测试；核对 `@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-client-web`、client modules、ui session/chat/approval 的真实 package name；再用已发布包或可复现 commit tarball/workspace pack 做 clean install，记录 browser entry 与实际可加载的 `AppWebEntry`。
  - Acceptance: 事实表包含 package name、版本/commit、entry、peer graph、安装来源和加载结果；clean install 能解析同一依赖图。任何版本/缺包/exports/peer/build/安装失败都变成 typed unavailable 和恢复命令；不得猜测 `dsh-acp` 或高层嵌入 API。

- [x] 1.1 建立官方 DSH web host 的最小真实启动。
  - Files: `dsh-web/` 或 `webui/dsh/`, `src/daemon/web-server.ts`, `scripts/dsh-web-smoke.sh.ts`.
  - Evidence: 26fadd8 —— `src/daemon/steward/dsh-web-host.ts`：真实 Cordis Loader + 五个官方 rows（host-webserver / credentials-local（具体 provider，满足 client-connection 的 ctx.credentials seam）/ client-connection / client-modules / web-app）；web-app 自行挂载官方 dsh-web-frontend dist（无 iframe、无静态 demo）；loader baseUrl 使 client-modules 把裸包名 entry 解析到 dsh.client manifest 并组装 window.**DSH_BOOT**。`pnpm exec vitest run test/dsh-web-host.test.ts` 4 passed：loopback OS-assigned 端口、无认证 401、?token= 握手 303+Set-Cookie、会话 index 200 且注入 **DSH_BOOT**、/api fence 401、dispose→二次 boot ready。`pnpm exec tsx scripts/dsh-web-smoke.sh.ts` 在干净临时 home（SKILL_CREATOR_HOME+DSH_HOME 隔离）跑 primary+recovery 双启动，证据落 artifacts/dsh-web-smoke.json（boot graph entries/activationOrder、session connection=token→cookie 会话、16 个 client 模块引用、恢复 ready）。daemon HTTP 反代与 remote namespace 桥按任务归属留 3.1a（同一 host 挂 Manager），本任务不提前做半成品 wiring。

- [x] 1.2 将 Skill Creator Manager 注册为 DSH client plugin。
  - Files: `packages/skill-creator-dsh-client/` 或等价 `webui/dsh-plugin/`, `package.json`, `cordis.patch.yml`/profile manifest.
  - Evidence: 33d7740 —— `packages/skill-creator-dsh-client`（workspace 包，root devDep 链接进 node_modules 供 Loader baseUrl 解析）：package.json 携带 `dsh.client = {platform:"web", inject:[], external:[]}` manifest + `./client` 导出（client-modules 扫描器实测契约：readFileSync package.json → parse dsh.client → exports["./client"].default → clientPath 必须存在）；node half `lib/index.js` 与官方 browser-only 插件同形（空 apply）；browser half `lib/client.js` 是 `window.__ModuleLoader__.load({id, factory})` 工厂，factory 内持有唯一 Manager RPC owner（懒建立、重复 acquire 同一实例、dispose 重置生命周期——DSH lifecycle 语义）。宿主集成：MINIMAL_ROWS 增加第六行 `@skill-creator/dsh-client`，activation 失败使 boot reject（fail-closed 测试覆盖：坏 entry create rejects）。端到端证据：boot graph 注入含插件行、host 在会话 cookie 后 serve combo script（工厂源码）。`pnpm exec vitest run test/dsh-client-plugin.test.ts` 4 passed；无第二个 SvelteKit shell/iframe/ACP chat route（plugin 仅含 owner 单例）；slots/remote surfaces 接入按任务归属归 2.1/2.2/3.1a，不提前做。

- [ ] 2.1 合并 DSH Agent settings/session UI。
  - Files: `packages/skill-creator-dsh-client/src/agent/`, `src/shared/rpc-contract.ts`, `src/daemon/steward/`。
  - Steps: 复用 DSH 的 model/provider/profile、session list/detail、stream transcript、permission 和 approval presentation；Skill Steward run 绑定 DSH session id 与 Manager run id；实时 stream 只做展示，durable audit 仍由 Manager 保存。
  - Acceptance: 用户能选择 model/profile，看到 session/tool/permission 事件；断线、取消、重连和 daemon restart 有恢复按钮和可验证状态。task/target/skills 专属控件归下一阶段。

- [ ] 2.2 将已注册的 Manager tools 事件接入官方 transcript。
  - Files: `packages/skill-creator-dsh-client/src/tools/`, `test/dsh-tool-composition.test.ts`。
  - Steps: 复用阶段 3 的 tool registration/restriction；将 call id、结果与错误关联 Manager run/tool event，UI 不重新注册工具或建立执行入口。
  - Acceptance: 一次真实 DSH tool round 在 transcript 与 Manager audit 中可对应；重复渲染/重连不重新执行工具；领域白名单保持不变。

- [ ] 3.1a 把 Manager host/island 挂载到同一 DSH host。
  - Files: `packages/skill-creator-dsh-client/src/manager/`, `webui/src/lib/apps/`, `src/shared/`。
  - Steps: 只完成 root/slot、route identity、navigation adapter、single connection owner 和 island mount/unmount；保留现有 Manager 操作实现，不批量改写页面。
  - Acceptance: 一个可运行的 DSH host 同时显示一个原有 ProviderView 和一个 DSH session transcript；重连/卸载无第二 root、iframe 或重复 RPC owner。此任务不包含 Creator/Repository 迁移。

- [ ] 3.1b 迁移 Workspaces/Provider/Skill surfaces。
  - Files: `packages/skill-creator-dsh-client/src/manager/`, `webui/src/lib/apps/`, `src/shared/`。
  - Steps: 在 3.1a 的宿主和连接边界内迁移 Workspaces、Provider、Skill；保留 URL identity、loading/error/conflict/recovery 状态。
  - Acceptance: DSH host 内可真实导入 workspace、浏览 skill、启停 skill；文件系统和 Manager RPC 证据与旧实现一致；1100px/680px 无横向溢出。旧 Svelte route 只作迁移夹具，不能继续作为生产 Agent 入口。

- [ ] 3.1c 迁移 Creator/Repository surfaces。
  - Files: `packages/skill-creator-dsh-client/src/manager/`, `webui/src/lib/apps/creator/`, `webui/src/lib/apps/repository/`, `src/shared/`。
  - Steps: 在同一 host 内迁移 Creator 编辑和 Repository pinned preview/install；保留 dirty draft、revision conflict、session expiry、recovery 状态，不重写 Manager authority。
  - Acceptance: DSH host 内 Creator 编辑和 Repository 预览安装可达；与官方 session 往返不丢 draft；实际文件树和 pinned commit 证据正确；1100px/680px 无横向溢出。
  - Ownership: 本阶段只实现挂载、路由、store bridge 与原有操作可达性；专属 workflow 控件和全部 action/recovery 用户流程由下一阶段 `steward-product-workflow` 唯一实现，不重复构建。

- [ ] 3.2 删除双入口和旧 ACP 产品叙事。
  - Files: `webui/src/routes/`, `webui/src/lib/components/creator/acp-panel.svelte`, `README.md`, `src/shared/rpc-contract.ts`。
  - Steps: 移除生产导航中的 generic ACP session；把残留 adapter 标为内部 legacy 或删除；README 只描述 DSH host + Skill Creator Manager。
  - Acceptance: `rg` 不再显示 ACP 是 Steward/Creator 产品入口；应用启动只有一个 DSH-hosted Agent surface。

- [ ] 4.1 完成浏览器、daemon、filesystem 和 release evidence。
  - Files: `scripts/dsh-web-smoke.sh.ts`, `docs/release/dsh-web-composition.md`, `docs/reviews/`。
  - Steps: 验证组合宿主启动/停止/重启；DSH 缺失/版本错误/插件失败；真实 DSH packages 的 tool round；浏览器检查 settings/session/tool 与 Manager 原有操作。最终真实模型维护、proposal/recovery 工作流和生产 pack clean-install 归阶段 5。
  - Acceptance: 保存真实 boot graph、session/tool transcript、Manager 原有操作的 filesystem diff、宿主恢复记录和截图；Manager-only recovery 不显示 Agent/session/chat；通过 `pnpm test`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`、`openspec validate --all --strict`，任何超时都不能标记完成。
