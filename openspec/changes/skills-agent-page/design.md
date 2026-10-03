# Design: skills-agent-page

## 1. 布局（对标 ZCode，Owner Q8/Q15 裁决）

```text
┌─ omnibox 行 ─────────────────────────── actions: [terminal][rightPanel] ─┐
├────────────┬──────────────────────────────────────┬──────────────────────┤
│ workspaces │  Chat（transcript + composer）        │ 扩展面板 panelTabs    │
│  └ sessions│                                      │ [Agent 终端][审批][卡] │
│     树     │                                      │                      │
├────────────┴──────────────────────────────────────┴──────────────────────┤
│ 终端（人类 PTY，xterm.js；可多 tab；可拖高）                               │
└──────────────────────────────────────────────────────────────────────────┘
```

- 左栏宽 ~240px（折叠 ~36px）；扩展面板宽 ~320px（可关）；终端高 ~200px 起
  （可拖调 + 可关）；全部显隐状态入 DevicePrefs（appearance 域，非 tab session）。
- 窄屏（<1024）：扩展面板转 overlay drawer；终端转底部 drawer；左栏折叠。

## 2. 会话 target binding（Codex r1 P0；r2 修订：越权边界补齐为完整契约）

现状取证：`create` 直接采用传入 cwd，无任何校验（src/daemon/kernel/
agent-sessions.ts:1305-1321）；转录 meta 无 target 字段（src/daemon/kernel/
session-transcripts.ts:35-45）——归属事实不存在，「能分组」不等于「不能越权」。
r2 修订把归属升级为带 server enforcement 的完整契约：

```ts
// contracts/agent.ts 扩展（破坏性，无兼容）
AgentSessionMeta += {
  target?: { workspaceId: WorkspaceIdSchema, providerId?: ProviderIdSchema }
}
agent.session.create += { target?: TargetInput }   // server 校验见下
// r3 修订：summary 投影同步扩展——UI 分组/过滤的合法数据面
AgentSessionSummarySchema += {
  target?: { workspaceId, providerId? },           // 与 meta 同形直投影
  seedSkill: SkillIdSchema | null                  // 必填 nullable（r4：与 spec
}                                                  // 统一——无 seed = null，
                                                   // 不用可缺席；creator 续聊
                                                   // 查找键，见 creator-agent-chat）
```

1. **创建校验（SHALL）**：workspaceId 必须解析于 workspace registry（未知 →
   typed 拒绝，不建会话不写 meta）；providerId 给出时必须属于该 ws 的
   provider 投影；target 与 cwd 一起落 transcript meta（mode/seed 同层）。
2. **不可变（SHALL）**：target 创建后在会话生命周期内不可变——不提供任何
   setTarget/update 变更面；setMode 的 dispose+resume 复活链从 meta 读取，
   target 天然保留。
3. **无 target 旧会话降级（r2 裁决：一律只读）**：可读可续聊，但 mutation
   类能力调用（`*_propose` 创建、写类工具）server typed 拒绝（错误 code 区分
   「无归属」）。理由：写权限需要「可证明的 Imported target」，归属不可证明
   = 与 Global target 同构的只读语义；从客户端传入的 cwd 反推归属正是 r1
   指出的伪造面，不做推断。UI 投影「未归属（只读）」徽标。
4. **server enforcement（SHALL）**：每次写入路径在**执行前**验证目标 scope：
   - mcp `*_propose` 链：proposal 创建时验证其目标三元组落在会话 target
     允许范围（target 未含 providerId = 该 ws 全 provider；含 = 仅该
     provider）；越权 typed 拒绝，无 proposal 落库。
   - 内核工具面：per-mode `tools.guard`（agent-kernel 既有机制）扩展拒绝面
     ——无 target / Global target 会话的写类能力调用直接拒绝并 audit。
   - Global target 会话禁止一切写入 proposal（只读分析用途）。
5. **list 投影**：按 target.workspaceId 分组 + 无 target 归「Unassigned
   （只读）」组；篡改面不存在（归属 server-owned，客户端无法伪造）。
   **summary 投影扩展（r3 修订）**：target 与 seedSkill 直投影进
   AgentSessionSummarySchema（现状 agent.ts:47 无此字段，UI 无分组依据）——
   这是本 change 的契约交付物之一，缺它分组/Creator 过滤都拿不到合法数据面。
6. **subagent 裁决（r2 定稿）**：`list()` 维持现状过滤（origin=subagent
   不入列，agent-sessions.ts:1281-1285，与 agent-kernel spec 既有
   「subagent lifecycle is visible and bounded」一致）；sessions 树不引入
   subagent 节点——subagent 以父会话节点内的 subagent 帧事件行呈现（现有
   帧机制），不作为独立可续聊会话。
7. **bash 边界的诚实声明（r3 修订）**：General（free/Open）模式保留原生
   bash 内核工具（AGENTS.md 模式矩阵），而 `tools.guard` 只收到工具名
   （agent-modes.ts:227）——**target 契约管辖的是 Manager 域 mutation 能力**
   （mcp `*_propose` 链、creator/evaluation/repository 写入 proposal），不
   封装内核 bash 的文件系统行为。bash 是内核执行面（受模式矩阵与专注模式
   deny 管辖），不在 target scope 内；文档不假装 target 封住了 bash。若
   Owner 需要 bash 也按 target 收紧，那是 agent-kernel 模式矩阵的独立变更
   （非本 change）。

## 3. per-workspace AgentPanel

- 挂载：SkillsWorkspacePage 壳内右侧（原 shell drawer 位置语义下放到 page）；
  宽度/开关偏好 DevicePrefs。
- 内容：本 ws 会话列表（target.workspaceId = 当前 ws）+ 当前会话 transcript +
  composer（**同一 session 可被 Agent 页与 Panel 同时打开**——帧流多订阅者，
  发送互斥锁由内核队列语义天然承载；面板显示「also open in Agent page」角标）。
- 「在 Agent 页打开」= `/agent?session=<id>` 深链（omnibox 可达）。

## 4. 人类终端（PTY，复刻 openspecui；r2 修订：协议冻结，不再「实现时再选」）

- 参考：`jixoai-labs/openspecui` 的 terminal-shell-profiles 归档实现
  （packages/server 的 pty-manager.ts / pty-websocket.ts 与前端 xterm 集成
  ——实现子代理开工前先读该仓对应源码与归档 change 文档）。
- **transport 定稿：专用 `/ws/terminal` 单端点**。理由：
  1. 本仓已有双 WebSocketServer per-path upgrade 路由先例（rpcWsServer /
     acpWsServer，src/daemon/web-server.ts:112-113、338-371），第三条端点
     同构，鉴权（`?token=` web token）与 401/404 分层照抄；
  2. `/ws/rpc` 是 oRPC 请求响应语义，高频 PTY 输出走它会把终端背压耦合进
     RPC 通道；
  3. 参考实现 openspecui pty-websocket.ts 即专用 WS + typed JSON 消息协议
     （PtyClientMessage/PtyServerMessage，sessionId 多路复用），且有
     2026-07-21「终端输出饿死 Server」owner 实报——输出必须独立 batcher，
     本实现同款必抄。
- **协议（r3 修订：消息语义冻结）**：create/write/resize/exit/list 控制消息
  与 output/buffer/exit 通知同走该 WS 的 typed JSON 帧（双向 Zod schema 校验，
  非法帧 typed error 回执不杀终端）；按 sessionId 多路复用，一条 WS 承载多
  终端 tab。**可靠性语义冻结**：
  - 每条 `output` 帧携带 `seq`（per-session 单调递增整数）；
  - `create` 的 ack 回执携带 `replayFrom`（服务端当前缓冲首行 seq）——
    客户端检测到 seq 缺口 MUST 发 `buffer` 请求（携带缺口区间），服务端
    从环形缓冲回放；缓冲已裁剪的区间回执 `gap` 消息（客户端清屏重拉）；
  - 控制消息可靠语义（r4 修订：write 非幂等——追加输入，重送会重复按键）：
    write 每条携带 `reqId`（客户端 per-session 单调整数）；server 维护
    per-session 已见 reqId 高水位，`reqId ≤ 高水位` 的 write 判定为重试
    重复，回执 `duplicate` 不注入 PTY；resize 以最终值为准（幂等）；exit
    对已退会话 typed error（不复活，幂等）；
  - 断线重连 = 新 create（携带 `resume: sessionId`）+ 上述 seq 对账。
- **数量上限（SHALL）**：daemon 全局同时 ≤4 个活 PTY；超限 create typed
  拒绝，UI 预先禁用入口。
- **输出缓冲（SHALL）**：10k 行环形 scrollback（行数 + 字节双上限裁剪，
  照 openspecui pty-manager 的 maxBufferLines/maxBufferBytes 双闸）；
  断线重连 replay 有界。
- **进程回收（SHALL）**：daemon stop coordinator 有界回收（terminal 域入
  domain 关停序：SIGHUP → 宽限 → SIGKILL 升级，不留孤儿进程）；idle 超时
  30 分钟（无 WS 附着且无输入）自动 exit 回收。
- **权限语义（如实声明，r2 修订）**：cwd 限定（默认用户 home 或所选 ws
  root）只是启动目录，**不是 sandbox**——PTY 以 daemon 用户本地权限全权
  运行；产品文档与终端首开提示如实声明，不假装隔离。该终端是人类直接操作
  的 shell：不对接 dsh，agent 工具面（内核收窄面）无法触达它，技能 mutation
  链与它无关。
- 前端：xterm.js（webui 依赖新增，懒加载 chunk）；多终端 tab；拖高分隔条。

## 5. 扩展面板 panelTabs

| panelTab   | 内容                                     | 数据源                          |
| ---------- | ---------------------------------------- | ------------------------------- |
| Agent 终端 | 内核 tool-bash 执行流（只读回放 + 展开） | transcript 帧（tool_call 结果） |
| 审批       | proposal 队列 + 批准/拒绝                | agent.proposals.*（统一审批面） |
| 卡片       | ui:// 卡片渲染（沙箱 iframe 沿用）       | 工具结果卡                      |

- panelTabs 按会话上下文自动切换（新审批到达 → 审批 tab 角标）；用户手动
  切换优先（会话内记忆）。

## 6. 测试

- target binding（r2 修订扩面）：create 校验（未知 ws/provider typed 拒绝）/
  不可变（无变更面 + setMode 后 target 保留）/ list 分组 / 旧会话 Unassigned
  只读 / 越权 proposal（目标 ws ≠ 会话 target ws）typed 拒绝且无 proposal
  落库 / Global target 写 proposal 全拒（server 单测）。
- PTY（r2 修订扩面）：create/resize/exit 生命周期 + stop 有界回收 + idle
  超时回收 + 并发上限（第 5 个 typed 拒绝）+ 缓冲环形裁剪 + 输出 batcher
  公平（洪泛输出不阻塞事件循环）；token 鉴权 401；前端组件 dom 测试。
- Panel 与 Agent 页双开同一 session：帧流一致性（同一 transcript 投影）。
- 走查：布局三尺寸 + terminal 拖高 + panelTab 切换 + 「在 Agent 页打开」深链。
