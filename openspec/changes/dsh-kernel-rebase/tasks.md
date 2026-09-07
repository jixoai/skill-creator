# Tasks: dsh-kernel-rebase

## 1. capability-core 抽取（行为不变重构）

- [ ] 1.1 建立能力定义层：名称 + Zod 输入输出 + handler + authority class（readonly/proposal/approved-mutation），把 skillSteward 工具 registry 的既有能力逐项迁入，工具 registry 改为消费 capability-core 投影。
  - Files: `src/daemon/steward/tool-registry.ts`, `src/daemon/capability/`（新）, `test/`。
  - Acceptance: 全量测试不改断言即绿；capability 清单与既有工具面一一对应（差异表落 artifacts）。
- [ ] 1.2 workspace/creator/repository 能力登记：list/inspect/toggle/validate/update、creator 读写（approved-mutation）、repository preview/install（approved-mutation）进 capability-core。
  - Acceptance: 每项能力有 focused test；authority class 与 manager-contract-map 的 authority 列一致。

## 2. headless 内核组合

- [ ] 2.1 dsh-host-lifecycle 改造：`initProfile(["dsh-base"])` 单 bundle，无 HTTP server 挂载；boot graph/版本 handshake 断言改内核等价（dsh-manager-mount/dsh-official-profile 测试改写）。
  - Files: `src/daemon/dsh-host-lifecycle.ts`, `src/daemon/steward/dsh-official-profile.ts`, `test/`。
  - Acceptance: 内核 rows 激活（agent/session/settings/approval/permission facts 入证据）；无 web rows；降级 typed reason 不变。
- [ ] 2.2 `agent.*` RPC namespace：session list/create/prompt/cancel/stream 投影 + settings patch（model/preset/approval policy），代次门与终态停轮询语义平移。
  - Files: `src/shared/contracts/`, `src/daemon/rpc-router.ts`, `webui/src/lib/stores/agent.svelte.ts`。
  - Acceptance: 延迟/失败/断线组件交互测试；steward run ↔ 内核 session 绑定回归绿。
- [ ] 2.3 session-binder 对接内核会话（无 DSH web host 的绑定路径），transcript/tool-round 投影保持。

## 3. Agent 面板（webui）

- [ ] 3.1 面板骨架：shell 级右栏 drawer（收起/展开、跨 tab 存活、<720px 单屏覆盖），会话列表/切换/新建。
- [ ] 3.2 对话流组件族：消息行、工具行（展开输入/结果）、审批请求卡（决定经 Manager approval 链）、终态叙述；断线可见与恢复。
- [ ] 3.3 配置投影：model/preset/permission/approval policy 面板（ask/never 语义沿用）。
  - Acceptance（3.x）：真实浏览器 1100px/680px 无溢出；键盘走查；组件交互测试（延迟/失败 RPC）；0 JS 错误。

## 4. MCP 供给

- [ ] 4.1 MCP server（`@modelcontextprotocol/sdk`）：capability-core → tools 投影（schema-faithful descriptors）+ resources（技能文档/快照只读面）；loopback HTTP（web token 鉴权）+ stdio（显式本机启动）。
- [ ] 4.2 authority 执行：MCP 面 mutation 一律产 proposal 待审批（不直接写盘），审计链完整；外部 client 冒烟测试（列表/调用/拒绝路径）。
- [ ] 4.3 MCP-apps 扩展位：capability 声明式 app manifest 接口（本期只留接口与文档，不实现渲染端）。
  - Acceptance（4.x）：MCP 协议合规冒烟（真实 client 或 SDK 对拍）；clean-install 后 MCP 面可用。

## 5. 退役 hosted 形态

- [ ] 5.1 daemon：移除 DSH web 鉴权代理、入口握手桥、`/manager/*` 通道；web-server 回归 SPA 单一服务面。
- [ ] 5.2 依赖与打包：dsh-web-app/web-frontend/host-webserver/host-frontend-static/client-* 移出 dependencies；`dist/dsh-client` vendor 与消费者链接下线；heal/闭包镜像目标随缩。
- [ ] 5.3 webui：`dsh-island/` 与 `@skill-creator/dsh-client` plugin 包、island 构建通道退役；shell 恢复直连布局。
  - Acceptance（5.x）：产物无 web-composition 残留（grep dist/依赖清单）；全量门禁绿。

## 6. 产品验收与发布证据

- [ ] 6.1 端到端：面板会话 → 工具行 → 审批 → apply → 磁盘验证 → rollback；steward 四 action 回归。
- [ ] 6.2 clean-install drill 更新：内核形态断言（无 dsh-client vendor、内核 mounted、面板可用、MCP 面可用）。
- [ ] 6.3 全量门禁（逐条独立）+ README/AGENTS/GOAL 产品真相同步 + 归档准备。
