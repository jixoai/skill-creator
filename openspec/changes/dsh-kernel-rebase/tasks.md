# Tasks: dsh-kernel-rebase

## 1. capability-core 抽取（行为不变重构）

- [x] 1.1 建立能力定义层：名称 + Zod 输入输出 + handler + authority class（readonly/proposal/approved-mutation），把 skillSteward 工具 registry 的既有能力逐项迁入，工具 registry 改为消费 capability-core 投影。
  - Files: `src/daemon/steward/tool-registry.ts`, `src/daemon/capability/`（新）, `test/`。
  - Acceptance: 全量测试不改断言即绿；capability 清单与既有工具面一一对应（差异表落 artifacts）。
- [x] 1.2 workspace/creator/repository 能力登记：list/inspect/validate（readonly）、toggle 与 skills update apply（approved-mutation——直接写盘/重装写入）、skills update check（readonly——lock hash 对比不写盘）、creator 读写（approved-mutation）、repository preview/install（approved-mutation）进 capability-core。
  - Acceptance: 每项能力有 focused test 且 authority class 逐项标注；class 清单与 manager-contract-map 的 authority 列一致（差异表入 artifacts）。

## 2. headless 内核组合

- [x] 2.1 dsh-host-lifecycle 改造：`initProfile(["dsh-base"])` 单 bundle，无 HTTP server 挂载；boot graph/版本 handshake 断言改内核等价（dsh-manager-mount/dsh-official-profile 测试改写）。
  - Files: `src/daemon/dsh-host-lifecycle.ts`, `src/daemon/steward/dsh-official-profile.ts`, `test/`。
  - Acceptance: 内核 rows 激活（agent/session/settings/approval/permission facts 入证据）；无 web rows；降级 typed reason 不变；**负面场景钉死**——产品会话调用 bash/fs 类通用能力 → typed 拒绝并留审计，全局工具表只含受控注册（design D1 承诺落入验收）。
- [x] 2.2 `agent.*` RPC namespace：session list/create/prompt/cancel/stream 投影 + settings patch（model/preset/approval policy），代次门与终态停轮询语义平移；现有 `dsh.*` namespace（settings/credentials/sessions）收敛并入 `agent.*`，不保留双投影。
  - Files: `src/shared/contracts/`, `src/daemon/rpc-router.ts`, `webui/src/lib/stores/agent.svelte.ts`。
  - Acceptance: 延迟/失败/断线组件交互测试；steward run ↔ 内核 session 绑定回归绿。
- [x] 2.3 session-binder 对接内核会话（无 DSH web host 的绑定路径），transcript/tool-round 投影保持。

## 3. Agent 面板（webui）

- [x] 3.1 面板骨架：shell 级右栏 drawer（收起/展开、跨 tab 存活、<720px 单屏覆盖），会话列表/切换/新建。
- [x] 3.2 对话流组件族：消息行、工具行（展开输入/结果）、审批请求卡（决定经 Manager approval 链）、终态叙述；断线可见与恢复。
- [x] 3.3 配置投影：model/preset/permission/approval policy 面板（ask/never 语义沿用）。
  - Acceptance（3.x）：真实浏览器 1100px/680px 无溢出；键盘走查；组件交互测试（延迟/失败 RPC）；0 JS 错误。

## 4. MCP 供给与 MCP Apps

- [x] 4.1 skill-creator-mcp server（`@modelcontextprotocol/sdk`，同一实现双形态）：capability-core → tools（schema-faithful descriptors）+ resources（技能文档/快照只读面）；形态 A 进程内 `/mcp`（loopback HTTP + Bearer web token 鉴权）、形态 B `skill-creator mcp` CLI（stdio，不依赖 daemon 常驻，**收窄为 readonly + propose-only**——mutation 仅经形态 A 走 daemon 审批链；stdio 的 propose 结果返回 client 自持、不入 Manager 存储，见 design D3）。
- [x] 4.1b 组合 `@deepseek-ai/dsh-mcp-client` 插件行：peer 闭包（`dsh-scope`/`dsh-timeout`/`dsh-attachment`/`dsh-subprocess`，0.1.2-rc.1）入 dependencies 与锁定矩阵；连接配置指向 `/mcp`（token 注入）。
  - Acceptance: 内核会话经官方桥完成一次真实能力调用（tools 注册 + tool round 全链证据入 artifacts）；包漂移 → typed unavailable。
- [x] 4.2 `ui://` MCP Apps 卡片（第一期四类：skill 信息卡 / finding 卡 / proposal 卡 / 安装更新结果卡；均含应用内跳转意图）：tool result `_meta.ui.resourceUri` + raw HTML 资源；面板 host 渲染（沙箱 iframe + CSP + postMessage JSON-RPC，`ui/initialize` 握手对齐 spec MUST 项）；`ui://` 资源经 `agent.*` 代理 RPC 获取（面板不是 MCP client）。卡片模板对内嵌的不可信文本（SKILL.md frontmatter/finding 内容）强制 HTML escape——沙箱防逃逸不防内容注入。
- [x] 4.3 提示词最佳实践（版本化 system prompt section）：可用能力面、何时用卡片代替纯文本、卡片使用约定；引导效果以真实会话取证。
- [ ] 4.4 authority 执行：MCP 面（内置/外部一致）mutation 一律产 proposal 待审批（不直接写盘），审计链完整；外部 client 冒烟（列表/调用/拒绝路径）。
  - Acceptance（4.x）：MCP 协议合规冒烟（真实 client 或 SDK 对拍）；卡片渲染 + 跳转在 1100/680 无溢出；clean-install 后 MCP 面与 CLI 形态可用。

## 5. 退役 hosted 形态

- [ ] 5.1 daemon：移除 DSH web 鉴权代理、入口握手桥、`/manager/*` 通道；web-server 回归 SPA 单一服务面。
- [ ] 5.2 依赖与打包：dsh-web-app/web-frontend/host-webserver/host-frontend-static/client-* 移出 dependencies；`dist/dsh-client` vendor 与消费者链接下线；heal/闭包镜像目标随缩。
- [ ] 5.3 webui：`dsh-island/` 与 `@skill-creator/dsh-client` plugin 包、island 构建通道退役；shell 恢复直连布局。
  - Acceptance（5.x）：产物无 web-composition 残留（grep dist/依赖清单）；全量门禁绿。

## 6. 产品验收与发布证据

- [ ] 6.1 端到端：面板会话 → 工具行 → 审批 → apply → 磁盘验证 → rollback；steward 四 action 回归。
- [ ] 6.2 clean-install drill 更新：内核形态断言（无 dsh-client vendor、内核 mounted、面板可用、MCP 面可用）。
- [ ] 6.3 全量门禁（逐条独立）+ README/AGENTS/GOAL 产品真相同步 + 归档准备。
