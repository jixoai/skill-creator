# Proposal: composer `$` 技能引用 + Settings Model 滚动修复 + MCP v2 迁移 + DSH_HOME 隔离

## Why

handoff（2026-09-16）后置工作 + 用户两条新增指令：

1. **用户指令 [2026-09-16]**：「AgentChatInput 输入要支持 `$` 开头引用 skill（类似 `@` 的
   引用能力）。注意我们的 skill 是有 Workspace 概念的，所以要基于 Workspace 分组，然后
   要支持模糊的搜索能力。」——`@` 引用基建（触发菜单、芯片绘制层、registry 有序消费、
   daemon 展开）已在 composer-references-queue-actions 落地；`$` 语义不同：`/name` 是
   「以命令触发技能」，`$name` 是「把技能内容作为引用注入上下文」。W3 时 `$` 触发符
   曾退役（统一进 `/`），本次以「技能引用」语义复活，两者并存不冲突。
2. **用户指令 [2026-09-16]**：「Settings>Model 这里的界面存在滚动条滥用的问题……这里有
   很多滚动容器，需要一个个过一遍。」——实测存在 4 层滚动容器（Dialog 右栏外层纵滚 +
   Model 分区 `-m-4` 逃逸自建内层纵滚 + NewRouteTab 画廊第三层 `max-h-[52vh]` 纵滚 +
   tab 条隐藏横滚），且 `-m-4` 负边距使子元素宽出父级 32px，配合 overflow-y 的隐式
   overflow-x:auto 产生横向滚动条。
3. **handoff 遗留 1（唯一功能性待修）**：daemon `/mcp` 端点协议协商失败——内核
   `dsh-mcp-client@0.1.6-alpha.1` 依赖 `@modelcontextprotocol/client@2.0.0`（2026-07-28
   spec），后续请求头 `MCP-Protocol-Version: 2026-07-28` 被 daemon 侧
   `@modelcontextprotocol/sdk@1.30.0`（支持止于 2025-11-25）拒为 400，agent 会话的
   `mcp__skill-creator__*` 工具面实际不可用。
4. **handoff 遗留 2**：内核 DSH_HOME 默认 `~/.dsh`，用户真实 harness 状态不兼容时整个
   agent 内核挂载失败；产品模型路由桥已能自闭环写 settings.yaml/凭据，隔离到 app home
   架构自洽（用户未答复裁决提问，按推荐方案推进，env DSH_HOME 保留覆盖权）。

## What Changes

### C1 —— composer `$` 技能引用（Workspace 分组 + 模糊搜索）

- 契约：`AgentPromptReferenceSchema` 增 `skill` 变体（strict：workspaceId + providerId +
  skillId opaque 三元组，server 解析）。references 上限维持 ≤4。
- daemon：`agent-sessions.expandReferences` 增 skill 分支——经 workspace registry 作用域
  解析 + SkillService 文档读取，展开为 `[reference: skill <name> — <workspace>/<provider>]`
  - SKILL.md 内容（≤200k chars 截断，与 file 引用同界）；目标缺失 = typed NOT_FOUND。
- WebUI：
  - `SkillMenu`（`$` 触发）：数据 = workspace.list × 每 provider `skills.list`（排除
    disabled；懒加载门同 ReferenceMenu——稿文以 `$` 开头才拉，菜单会话内缓存）；组头 =
    Workspace label（Global 在前）/ provider label；选中落 token `$name` + 引用入
    registry（同名 token 按出现序配对，与 `@` 同法）。
  - `TriggerMenu` 泛化：可选 `matcher` prop（缺省 startsWith 不变）承载模糊匹配；
    `MenuEntry` 增可选 `key`（跨组同名技能的唯一渲染键）。
  - 模糊匹配器（纯函数）：大小写不敏感子序列匹配 + 连续段/词首加权，name 主匹配、
    description 辅助匹配；排序后仍按组序渲染。
  - `ComposerReference` 增 `skill` 目标形状；`sendAgentPrompt` 映射 wire 引用；
    ChipPaintLayer/原子退格/提交剪除零改动（复用出现序消费）。

### C2 —— Settings → Model 滚动所有权修复

- 单一滚动所有者：Model 分支下 Dialog 右栏改 `overflow-hidden`（其余分区维持
  `overflow-y-auto`），删除 `-m-4 p-4` 逃逸 wrapper——消除横向滚动条与死滚容器。
- NewRouteTab pick 画廊去 `max-h-[52vh] overflow-y-auto`——画廊自然流式，滚动只属于
  tab 内容容器（R16 裁决的本意）。
- tab 条 wheel 纵转横只在可横滚时劫持（scrollWidth > clientWidth），否则交还页面滚动。
- vision 子代理逐容器走查（桌面 + 窄窗 × 明暗）：枚举剩余滚动容器并逐一裁决去留与
  滚动条样式；顺带修 handoff P3 项（QueueDock 图标激活态/热区、TriggerMenu 高亮对比度、
  composer 卡顶边框）。

### C3 —— MCP server 迁移 v2 线（协议协商修复）

- 依赖：`@modelcontextprotocol/sdk@^1.30.0` → `@modelcontextprotocol/server@2.0.0` +
  `@modelcontextprotocol/node`（Node req/res 适配）；`@modelcontextprotocol/core` 随
  传递依赖入 lock。
- `/mcp` 端点：per-request stateless 模式改 `createMcpHandler({ legacy: "stateless" })`
  工厂（双纪元：modern `server/discover` + legacy `initialize`），`toNodeHandler` 接
  Node http；Bearer 鉴权保持在 daemon 侧前置。
- stdio 形态：`StdioServerTransport` 直连改 `serveStdio(() => buildServer())`。
- 注册面：variadic `server.tool()` → `registerTool(name, {description, inputSchema}, cb)`
  （raw shape 包 `z.object`）；resources 注册面签名对齐。
- 验证：dev 栈真实内核挂载后 `mcp__skill-creator__*` 工具面连通（网关会话实测）+ 既有
  MCP 单测迁移。

### C4 —— DSH_HOME 默认隔离到 app home

- `resolveDefaultDshHome()`：env `DSH_HOME`（非空白）→ `<homeDir()>/.skill-creator/dsh-home`；
  不再默认读 `~/.dsh`。装配点不传 dshHome 的行为随之改变（生产/开发一致）。
- 影响面：内核挂载目录与模型路由桥（dsh-settings.ts 的 settings.yaml/.credentials.yaml
  投影）一致隔离；首次启动自举空目录（heal 镜像补全已有机制）。
- 回滚口：`DSH_HOME=~/.dsh` 环境变量即恢复旧行为。

## Impact

- 代码：`src/shared/contracts/agent.ts`；`src/daemon/{agent-files→不动, kernel/agent-sessions,
domain}`（skill 引用展开）；`webui/src/lib/components/agent/{TriggerMenu,SkillMenu(新),
ComposerCard, composer-chips, composer-fuzzy(新)}`；`webui/src/lib/stores/{agent-composer,
agent}`；`webui/src/lib/components/settings/{SettingsDialog,ModelSettingsSection,NewRouteTab}`；
  `src/daemon/{web-server,mcp/skill-creator-mcp}.ts` + `src/cli/cli.ts` + `package.json`；
  `src/daemon/dsh-host-lifecycle.ts`。
- 规格：agent-surface（$ 引用 Requirement）、agent-kernel（skill 引用展开）追加；
  MCP 迁移在 dsh-runtime-integration 或 manager-core 的既有 MCP Requirement 上改写；
  DSH_HOME 在 dsh-runtime-integration 追加隔离约束。
- 兼容：prompt references 增 kind——strict 联合对旧 daemon 是未知 kind 会被拒（无兼容
  策略：产品自体 daemon+webui 同步发版）；DSH_HOME 行为变更为用户可见（报告显著标注）。
