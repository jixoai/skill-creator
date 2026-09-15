# Roles 即子代理：`@` 召唤架构提案（讨论稿，未实现）

用户原始需求 [2026-09-12]：「目前这四种模式，要升级成四个 Role，每个都有自
己的头像，选择模式其实是选择 Chat 的目标。如果 dsh 支持子代理，那么就意味着
这些 Role 本身也是子代理。能通过自带的的方式去调用，而不是现在这样"切换
Role"，可以用 `@` 来召唤这些 Role。召唤的结果，就是当前的 MainAgentRole 帮
你用 subagent 的方式去管理这些 SubAgentRole。你看能否做到，不能做到就先不
做，和我讨论一下你的想法（画图）。」

正交意图：
[1] 可行性实证：dsh 0.1.5-rc.2 的 dsh-goal 面已有 subagent 概念（catalog/
descriptor/settled/depth）但未挂进产品内核——提案基于包扫描事实。
[2] 架构提案：产品侧 daemon 子会话 + role_invoke MCP 工具桥的完整链路
（ASCII），留上游原生子代理的对齐缝。
[3] 决策请求：`@` 软/硬召唤、Role 命名、并发上限三问待用户拍板。
妥协声明：本文档是讨论稿，不构成实现承诺。

## 1. 可行性结论（先说答案）

**能做到，但不建议直接等 dsh 原生子代理；建议产品侧薄桥接，留上游对齐缝。**

实证（2026-09-12，dsh 0.1.5-rc.2 包扫描）：

- `@deepseek-ai/dsh-goal` 的 RPC 面（typert.host.js 字符串）存在
  `subagent/catalog`、`subagent/descriptor`、`subagent-settled`、
  `subagentDepth` —— **上游正在构建 goal 编排型子代理**（目录注册、描述符、
  完结事件、深度控制）。
- 但我们挂载的产品内核（dsh-kernel.ts 的 product preset）**没有包含
  dsh-goal**；我们消费的 `ctx.agents.create` 是扁平会话面，无嵌套 spawn 语义。
- 结论：原生子代理是上游路线图上的东西，当前版本拿不到。产品侧可以用
  「daemon 代管子会话 + MCP 工具桥」达到同等的用户可感知行为。

## 2. 目标体验（用户视角）

```text
┌─ Agent Panel ──────────────────────────────────────────────┐
│  Main: [🛠 Maker]  （当前主 Role，有头像；可随时换）          │
│                                                              │
│  你: 帮我审一遍这个 skill，然后让 Explorer 找找社区里类似的   │
│                                                              │
│  🛠 Maker (main):                                            │
│    先审校……（自己的推理）                                    │
│    ┌─ 🔭 Explorer (subagent) ────────────── 委托 ▾ ──────┐  │
│    │ task: 找社区相似 skill                                │  │
│    │ …3 个发现…（折叠行，点开看全过程）                    │  │
│    └─ settled: 2 个高相似候选 + 链接 ────────────────────┘  │
│    综合两步：你的 skill 有两个近亲，建议……                   │
│                                                              │
│  composer: 「@Explorer 」输入中 → 角色召唤浮层（头像+描述）   │
└──────────────────────────────────────────────────────────────┘
```

- 四模式 → 四 Role（Maker / Curator / Explorer / General），各有头像、
  prompt section、工具面（沿用现有 AGENT_MODES 注册表升级）。
- 「选模式」= 选主 Role（对话目标）。
- `@Role` 召唤 = 主 Role 在当轮内把一段任务委托给该 Role 的子会话；
  主 Role 保持叙述主线，子代理结果以内嵌折叠块呈现。

## 3. 架构（产品侧实现，不动上游）

```text
composer "@Explorer 找相似 skill"
   │ ①客户端 sugar：把 @Explorer 高亮/补全（复用 $ 补全基建）
   ▼
消息文本（含 "@Explorer …"）
   │ ②daemon agent-sessions.prompt
   ▼
┌─ 主会话 (Maker prompt section + 面向主 Role 的工具) ─────────┐
│  LLM 看到 prompt 里的 Role 契约：                            │
│  「委托它人 = 调 role_invoke 工具，不要自己转述它的职责」     │
│                                                              │
│  tool-call: role_invoke(role:"explorer", task:"…")           │
└──────┬───────────────────────────────────────────────────────┘
       │ ③daemon 工具实现（skill-creator-mcp 内）
       ▼
┌─ 子会话（新 kernel agent，Explorer section + 收窄工具面）───┐
│  独立转录（appDir/sessions/…，meta.parent = 主会话 id）      │
│  深度上限 subagentDepth=1（不允许再嵌套委托）                 │
└──────┬───────────────────────────────────────────────────────┘
       │ ④完结（终帧或超时）
       ▼
  role_invoke 返回 { summary, artifacts, sessionId }
  主会话以 tool-result 继续叙述；面板把子会话投影为
  「Role 委托折叠块」（复用 DisclosureRow + tool 行管线，
  新 frame kind: subagent-settled / subagent-delta 可后加）
```

关键点：

1. **Role = 升级版 AGENT_MODES 注册表**：`{id, label, avatar, promptSection
(版本化), tools, canDelegate[]}`。四个内置 + 未来用户自建（头像复用
   IconPicker 管线）。
2. **委托工具**：`mcp__skill-creator__role_invoke`（mutation 性质但产
   proposal-free 结果——它是会话内计算，不动技能盘；走 MCP 桥而非全局工具，
   专注模式只开放自己 + 可委托名单内的 Role）。
3. **`@` 的两种语义**（建议取 A）：
   - A. **软召唤**（纯提示）：`@Explorer` 展开为文本指令「请委托 Explorer
     子代理处理：…」，由主 Role 决定调工具。实现最小、行为可预期。
   - B. **硬召唤**（客户端直发）：面板识别 `@Role` 前缀 → daemon 绕过主 LLM
     直接起子会话，结果回贴主转录。控制力强但打断主 Role 的叙事连续性。
4. **上游对齐缝**：role_invoke 的 daemon 实现收口在一个模块；dsh-goal 的
   `subagent/*` RPC 正式可用后，把「自建子会话」替换为原生 spawn，UI 与
   Role 注册表不变。

## 4. 成本与风险

| 项         | 评估                                                         |
| ---------- | ------------------------------------------------------------ |
| Token/延迟 | 子会话 = 独立 LLM 轮；默认串行、深度 1、可并发上限 2         |
| 凭据       | 子会话复用主会话的 model route（无新配置面）                 |
| 审批面     | 子会话继承主会话审批策略；子代理的 proposal 仍走主面板审批链 |
| 转录/清理  | 子会话即普通转录（parent meta），Session 管理页天然覆盖      |
| 工程量     | 约一轮 R 级迭代：注册表升级 + 工具桥 + 折叠块投影 + `@` 补全 |

## 5. 请你拍板的三个点

1. `@` 语义取 A（软召唤，主 Role 决定委托）还是 B（硬召唤，面板直发）？
2. 四个 Role 的名字/头像方向：Maker/Curator/Explorer/General 有没有想改的？
3. 子代理并发：默认「同时最多 1 个」够不够？

## 6. 裁决记录（2026-09-15，Owner）

1. **产品侧桥接方案否决**（本文 §3 的「daemon 代管子会话 + MCP 工具桥」）：不做。
2. **采纳路径改为上游原生子代理**：DSH 官方 `packages/subagent` 家族已在 npm 发布
   （`@deepseek-ai/dsh-subagent` + spawn/fork-in-process/driver/codex 等），且
   `dsh-base@0.1.6-alpha.1` 已将其列为内置依赖——本文写作时「上游拿不到」的前提
   （基于 0.1.5-rc.2 扫描）已过期。
3. **重启触发条件**：下一个大迭代（DSH 升级 0.1.6-alpha.1 + composer 能力矩阵复刻）
   中，Roles 基于原生子代理实现；§5 的三问（@ 语义/命名/并发）随该迭代的
   openspec 设计稿重新进入决策面。
4. 配套指令（Owner，2026-09-15）：Agent Chat 输入框能力「100% 复刻官方 webui」
   ——以 `packages/client` 的 composer 为规格源，能力对等实现（能力矩阵钉死差距），
   非代码移植。
