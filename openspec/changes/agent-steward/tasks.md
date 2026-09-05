# Tasks: agent-steward

依赖：`skill-intelligence` 已通过验收。一次只实现一个 backend，完成后再开始另一个。

- [x] 1.1 新建 `src/shared/contracts/agent-steward.ts`，定义 StewardRun、Recommendation、PermissionDecision、RunEvent、terminal status。
  - Evidence: contracts 落地 branded `StewardRunId sr_*` / `StewardPermissionRequestId prm_*`；`RunStatusSchema` 七态（running + completed/cancelled/failed/disconnected/unavailable/stopped）；Recommendation 复用 intelligence `ProposalPayloadSchema`；输出经 oRPC runtime 校验（修正过 observedRevisions 的 `sha256:` 前缀契约）。
- [x] 1.2 新建 `src/daemon/steward-service.ts`：串联 analyze -> recommend -> draft -> validate -> approval -> apply；每一步可取消且有 terminal result。
  - Evidence: 六阶段管线，AbortSignal 贯穿（含 awaiting-approval 的 abort-race 与未决授权 denied 收尾）；`dispose()` 把活动 run 折叠为 stopped 并回收隔离根；run/事件有界存储（20 runs / 500 events）。
- [x] 1.3 实现 fixture HarnessAdapter；覆盖 prompt、ordered events、cancel、disconnect、early exit、handshake failure 和 daemon stop。
  - Evidence: `steward/fixture-adapter.ts` + `test/agent-steward.test.ts`：完整生命周期 16 事件顺序断言、cancel→cancelled+隔离根回收、process-lost→disconnected、handshakeError→typed unavailable 不建 run、dispose→stopped。
- [x] 1.4 把 Agent 建议映射为 edit/disable/split/merge ProposalDraft；不允许 adapter 直接调用 filesystem mutation。
  - Evidence: adapter 接口无任何 Provider 路径/mutation 通道（隔离 execution root 之外不可写）；sink/返回值/最终文本三通道推荐一律 `RecommendationSchema.safeParse` 收窄，目录穿越 payload 在契约层丢弃（测试：escaped 目录不存在、proposalIds=0）。
- [x] 1.5 实现 DSH backend adapter：固定版本、ACP/profile capability matrix、显式配置、缺失或 handshake 失败 typed unavailable。
  - Evidence: `steward/dsh-adapter.ts`：命令仅来自 `commandSpec`/`SKILL_CREATOR_STEWARD_DSH_ACP_CMD`（默认 dsh-acp），initialize+clientInfo 固定版本握手；测试覆盖 ENOENT 与空配置两条 typed unavailable；实机 backend 列表显示 `dsh unavailable: spawn dsh-acp ENOENT`。
- [x] 1.6 实现 Codex app-server adapter：优先 stdio/Unix socket，thread/turn/item 映射为 normalized RunEvent；不复制 Rust 类型。
  - Evidence: 协议以实机 `codex app-server generate-json-schema --out` 证据锚定（initialize/thread/start/turn/start + item/started|completed、turn/completed、error 通知）；`steward/codex-adapter.ts` 仅做未知收窄 + 封闭 item 投影，零 Rust 类型复制；脚本化 stdio peer 测试验证握手版本、item 映射与无完成通知→disconnect；实机握手可用（userAgent: skill-creator-steward/0.153.4 …）。
- [x] 1.7 新增 steward UI：运行列表、实时事件、推荐队列、approval/reject、stale run 和失败原因；不把历史写入 localStorage。
  - Evidence: `StewardView.svelte` + `steward.svelte.ts` store（latest-wins 门）+ provider 入口按钮；实机（导入 workspace, fixture backend）：Start→Permission 面板 Grant→awaiting-approval→Approve→apply→completed 16 事件全链、Cancel→cancelled、backend 矩阵（fixture ✓/dsh typed unavailable/codex ✓）；桌面 1280 与窄屏 680 双端零 console 错误、无文档横向溢出、vision 复核 acceptable；无 localStorage 使用。
- [x] 1.8 增加 focused tests：Agent 不能越过 Manager apply、approval 一次性、backend 不自动 fallback、daemon stop 无 orphan process。
  - Evidence: `test/agent-steward.test.ts` 16 tests（契约丢弃穿越 payload、重复授权/重复裁决 CONFLICT、终态 run 审批 INVALID_OPERATION、显式 backend 失败不 fallback 且零 run 创建、dispose 后无隔离根残留、Global workspace 拒绝）；全套 253 passed。
- [x] 1.8a 以 `demo/agent-steward.html` 作为 run timeline、recommendation 和 approval gate 的交互参考；静态页面不能替代真实 backend smoke test。
  - Evidence: `rg "demo/agent-steward" src webui/src` 零引用；smoke 为真实 daemon domain fixture run（scripts/steward-smoke.sh.ts）。
- [x] 1.9 验收：fixture tests、启用 backend 的 smoke test、`pnpm check`、`pnpm build`，并保存去敏 protocol transcript。
  - Evidence: `openspec/changes/agent-steward/artifacts/fixture-run-transcript.json`（16 事件、applied=2、sandbox 路径已替换为 `<sandbox>`）；门禁：253/253 tests、tsc 0、svelte-check 0/0、build+staged 5 entries、fmt --check 全绿、git diff --check 干净、openspec 4/4。
