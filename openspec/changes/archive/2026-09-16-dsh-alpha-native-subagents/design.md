# Design: dsh-alpha-native-subagents

## 升级发现（0.1.5-rc.2 → 0.1.6-alpha.1，实测）

1. **boot() 第 5 参 bareModuleBaseUrl 从静默忽略变为生效**——唯一实质破坏点。
   我们历史代码传了 `new URL(".", import.meta.url).href`（源码目录）：rc.2 的
   boot 只有 4 参，多余参数被 JS 忽略，裸包名经 `ctx.baseUrl`（profile kernel
   目录）向上解析到 `$DSH_HOME/profiles/node_modules` 的 heal 镜像；alpha 尊重
   该参数后所有 loader entry 钉死在源码目录（只持有直接依赖）→ 镜像被绕过，
   `Cannot find package` 全家桶。修复 = 不传（undefined 回退镜像路径）。
   官方语义注解：该参用于「host 拥有完整插件集」的场景，我们是 config project
   （profile 镜像）拥有，不属于该场景。
2. profile-resolution 子系统重写（link/dual/runtime 模式）但对外 seam
   （initProfile/loadProfile/resolveProfileDir/healProfilesModuleFallback）签名
   兼容；heal + 我们的 completeTransitiveMirror 流程实测照常工作（147 镜像项）。
3. `assertEntriesActivated` 移除 → `auditStartupEntries`（我们未引用前者，无感）。
4. `agent/session-start` 事件移除 → `agent/created` 变 serial（我们两都不监听，无感）。
5. mcp-client 迁移到 @modelcontextprotocol/client；我们的 config 键
   （serverName/streamable-http/url/headers）不变，路由测试实测绿。
6. `tool-ralph` 默认 disabled（我们本来就不用）；workflow → PTC 重命名（不用）。
7. 契约常量：DSH_LOCKED_PACKAGES / DSH_MCP_BRIDGE_PACKAGES ×10 → alpha 版本；
   DSH_AUDITED_COMMIT → 0a15e36e（两份调研在该 tag 检出上完成，审计闭环）。

## 前提修正（调研实证）

子代理能力**不是** 0.1.6 新增：rc.2 的 dsh-base 闭包已含 subagent 家族，内核
boot 即激活 `ctx.subagents` 与模型面工具（subagent/subagent_fork/send_message/
interrupt_agent/list_agents）。产品会话看不见它们只因 productToolDenyList 全拒。
本 change 的升级部分是版本对齐 + 修复；Roles 的关键是「把子代理工具面按角色
受控地放进 allowlist + 服务端定义角色实例」。

## Roles 设计（Option A：per-role tool-subagent 行）

角色 = 一条内核组合里的 `@deepseek-ai/dsh-tool-subagent` 行（非预设里的通用
subagent 行）：

```yaml
- id: tool-role-<slug>
  name: "@deepseek-ai/dsh-tool-subagent"
  config:
    provider: spawn # 零父上下文的全新子进程内 agent
    toolName: role_<slug> # 模型面名（每角色唯一，避开同 fiber 冲突）
    backgroundMode: continuable # durable 子代理；不需要 ctx.jobs
    persona: | # 版本化角色 prompt section
      # Role: <name> (v1) ...
    toolFilter:
      allow: [ask_user_question 禁用, mcp__skill-creator__<能力面>...]
    maxDepth: 1
```

- **spawn 路径**：模型调用 `role_<slug>({description, prompt})` → 工具组装
  SubagentStartRequest → `ctx.subagents.start('spawn', …)` → 子 agent join 产品
  preset、persona 以 scoped section 覆盖、`tools.restrict(toolFilter)` 结构化
  收窄（拒绝 = 隐藏 + 拒执行，非 prompt 约束）。
- **结果回流**：foreground → SubagentResult.output 作工具结果（非 completed →
  isError + diagnostic）；continuable → 即返 subagentId，settlement 以
  subagent-settled notice 用户消息进入父转录下一轮。
- **工具面收窄互操作（D1 法则）**：父会话的 productToolDenyList per-mode
  allowlist 增补角色工具名（专注模式可各自裁决放哪些角色）；子会话由
  toolFilter 结构化收窄，父模式 guard 不下探子会话（官方语义）。
- **ask_user_question 红线**：子代理 ctx 的 user-questions/request 面板不绑定
  （我们只绑父 ctx）→ 角色 toolFilter 一律 deny ask_user_question，杜绝悬空。
- **mutation 红线不变**：子代理经 mcp__skill-creator__* 的 mutation 仍产
  proposal 待审批（manager 侧主体链不受 spawn 影响）。

## 会话面适配（产品投影）

- `agent.sessions.list` 过滤 `origin === 'subagent'` 的子会话（不入面板列表）。
- firehose：子会话事件（session/event 帧带独立 session id）→ 父轨的
  subagent 帧投影（spawn/descriptor/catalog/settled），子转录可经
  session-transcripts 探视。
- 内核 dispose 前调 `ctx.subagents.drainContinuableDescendants(liveParents)`
  有界回收（子代理不留 orphan——与 ACP 池同法则）。

## Roles 目录（首版）

| role       | 场景                             | 能力面（toolFilter allow）                 |
| ---------- | -------------------------------- | ------------------------------------------ |
| reviewer   | 技能评审：读技能给改进意见       | 只读 mcp 能力（skills_list/info/validate） |
| researcher | 源调研：Discover 源扫描分析      | 只读 repository/sources 能力               |
| writer     | 草稿撰写：按模板写 SKILL.md 初稿 | skills_propose（mutation→proposal 链）     |

目录为 browser-safe shared 常量（`src/shared/contracts/agent-roles.ts`），
UI 不手抄；每角色 prompt section 版本化（product-prompt.ts 同法）。

## 测试策略

- 升级面：既有内核/握手/路由/集成套件全绿即门禁（已达成）。
- Roles 面：kernel boot 断言角色行激活；agent-sessions 断言 allowlist 放行
  角色工具、子会话列表过滤、firehose 帧投影、dispose drain；负面：专注模式
  未列角色 → deny；子代理 toolFilter 外工具 → 结构化拒绝（mock provider）。
