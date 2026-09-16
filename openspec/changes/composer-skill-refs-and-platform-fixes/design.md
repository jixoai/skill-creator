# Design

## C1 —— `$` 技能引用

### 语义边界（与既有触发符的关系）

```text
/name   = 命令/技能触发（W3 统一菜单；/name 落纯文本，内核侧由技能目录语义消费）
@name   = 文件/会话引用（C1：daemon 展开为 [reference: …] 文本块）
$name   = 技能引用（本次：daemon 展开技能文档为 [reference: skill …] 文本块）
```

`$` 复活为引用语义（非触发语义），与 W3 的退役注记不冲突——退役的是「`$` 作为技能
*触发*符」；SlashMenu.svelte 头注与 TriggerMenu 历史注记随本次更新。

### 数据流

```text
draft 首行 "$cod" ──SkillMenu──> TriggerMenu(trigger="$", matcher=fuzzy)
     │                              │ entries: Workspace 组 × provider 子组 × $name 行
     │                              │ （懒加载门：text 以 $ 开头才拉 workspace.list +
     │                              │  每 provider skills.list(排除 disabled)；菜单
     │                              │  会话内缓存；provider 失败置空组不阻塞）
     ↓ Enter/Click
token `$code-review ` 落稿文 ──> registry 入条 {kind:skill, token, skill 三元组}
     │                              （同名 token 出现序配对 = 既有 resolveChipOccurrences）
     ↓ 提交
activeDraftReferences → sendAgentPrompt 映射 wire {kind:"skill", workspaceId, providerId, skillId}
     ↓ daemon
agent-sessions.expandReferences ── skill 分支 ──> registry 解析作用域 → SkillService
     文档读取 → "[reference: skill <name> — <ws>/<provider>]\n<content ≤200k>" → 内核 content
```

### 判定细节

- **契约**：`AgentPromptReferenceSchema` 增 `z.strictObject({kind:"skill", workspaceId,
providerId, skillId})`。skillId 走既有 `SkillIdSchema`（sk_ 24hex）；workspace/provider
  ID 复用 workspaces 契约（浏览器端 import 类型即可，不重复声明）。
- **daemon 展开**：`expandSkillReferences` 注入面（domain.ts 装配，与
  expandFileReferences 同型）：workspace registry `resolveScope({workspaceId, providerId})`
  → `SkillService` 按 skillId 读文档（metadata.name + content）；缺失/越界 =
  typed NOT_FOUND（与 session 引用同法则，不静默降级）。内容截断 200k chars 对齐 file
  引用。既有 references ≤4 上限覆盖 skill（同数组）。
- **菜单数据**：`workspaceState`（shell 级已有）取分组骨架；`rpc.skills.list` 按组并发
  （Promise.allSettled），`includeDisabled` 缺省（false）——disabled 技能对 agent 不可
  用，引用无意义。缓存生命周期 = 菜单一次浮现会话（Esc/选中后失效重拉，避免陈旧）；
  provider `available:false` 跳过（无根可读）。
- **模糊匹配器**（`composer-fuzzy.ts` 纯函数，无依赖）：
  - 归一小写；query 空串 = 全量（组序）。
  - name 子序列匹配（连续段 ×2 加权 + 词首 `-`/`_`/驼峰边界 ×1.5 加权）；description
    子串命中作低权重加成（不改变 name 未命中的淘汰）。
  - 组内按分排序；组序保持 Workspace 声明序（Global → Imported）。
- **TriggerMenu 泛化**：新增可选 props `matcher?: (query, entry) => boolean`（缺省 =
  现行 startsWith，既有菜单零改动）与 `MenuEntry.key?: string`（{#each} 渲染键，缺省
  value——跨组同名 `$name` 行的唯一键）。匹配移动到 matcher 调用侧，选中路由仍以 value
  交回外壳（SkillMenu 自持 providerGroups 反查三元组）。
- **chip 形状**：`ComposerReference` 增判别——file/session 维持 `target: string`；skill
  增 `skill: {workspaceId, providerId, skillId}`（kind:"skill" 时必有）。绘制层/退格/
  剪除复用既有 occurrence 机制零改动。`$name` chip 视觉与 `@` 同底色（bg-primary/15）。
- **键盘先占序**：referenceMenu(`@`) → skillMenu(`$`) → slashMenu(`/`)——按 query 前缀
  天然互斥（首行只可能以一个触发符开头），先占序无冲突。

### 负面清单（不做）

- 不做技能预览/详情面板跳转（菜单行 title 提示 description 即可）。
- 不做 disabled 技能的「显示+标注」——直接不列。
- 不做跨 Workspace 的去重合并——同名技能按组并列（occurrence 配对已处理同名歧义）。

## C2 —— Settings Model 滚动修复

### 现状问题（逐容器判定表）

| #   | 容器                                                     | 位置                     | 判定                                                                                               |
| --- | -------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| 1   | Dialog 右栏 `overflow-y-auto p-4`                        | SettingsDialog:72        | General/Agent/Sessions 的**唯一**滚动所有者，保留；Model 分支下是死容器 + 横滚来源                 |
| 2   | `-m-4 p-4 h-full` 逃逸 wrapper                           | SettingsDialog:78        | **删除**：负边距使子块宽出 32px，overflow-y 隐式 overflow-x:auto → 横向滚动条                      |
| 3   | Model 分区根 `h-full min-h-0 flex-col`                   | ModelSettingsSection:213 | 保留（高度链需要），但父级配合改 `overflow-hidden`                                                 |
| 4   | tab 内容 `flex-1 overflow-y-auto`                        | ModelSettingsSection:350 | **保留**：R16 裁决的 Model 分区唯一纵滚所有者                                                      |
| 5   | tab 条横滚 `overflow-x-auto` + 隐藏滚动条 + wheel 纵转横 | ModelSettingsSection:245 | 保留形态；wheel 劫持改条件式（仅 `scrollWidth > clientWidth` 时 preventDefault，否则交还垂直滚动） |
| 6   | 画廊 `max-h-[52vh] overflow-y-auto`                      | NewRouteTab:376          | **删除**：画廊自然流式，滚动归还 #4（52vh 与 Dialog 高度上限不联动，双滚条)                        |

### 修复后滚动拓扑

```text
Dialog.Content (h-[min(560px,85vh)] overflow-hidden)
 ├─ 左导航（不滚）
 └─ 右栏: model ? overflow-hidden : overflow-y-auto   ← 单一所有者按分区切换
     └─ [model] ModelSettingsSection (flex h-full min-h-0 flex-col)
         ├─ header（固定）
         ├─ tab 条（横滚，隐藏条，条件 wheel）
         └─ tab 内容（flex-1 overflow-y-auto）        ← Model 唯一纵滚
             └─ NewRouteTab pick 画廊（自然流，无独立滚）
```

vision 走查清单（每个容器逐过）：右栏各分区、tab 内容、tab 条、画廊、窄窗（<640px
Dialog 全屏化）行为、滚动条视觉（细/透明轨道，符合全局 tailwind-scrollbar 偏好）、
键盘 Tab 焦点不因滚容器错位。

## C3 —— MCP v2 迁移

```text
v1: @modelcontextprotocol/sdk@1.30.0
    ├─ /mcp: StreamableHTTPServerTransport({sessionIdGenerator:undefined, enableJsonResponse:true})
    │        per-request + server.connect + handleRequest(node req, res)
    └─ stdio: StdioServerTransport + server.connect

v2: @modelcontextprotocol/server@2.0.0 + @modelcontextprotocol/node
    ├─ /mcp: createMcpHandler(() => buildServer(), {legacy:"stateless"}) → 双纪元
    │        （modern server/discover 2026-07-28 + legacy initialize 2025-11-25）
    │        → toNodeHandler(handler)(req, res)；Bearer 鉴权 daemon 侧前置不变
    └─ stdio: serveStdio(() => buildServer())
```

- 注册面：`server.tool(name, desc, shape, cb)` → `server.registerTool(name,
{description, inputSchema: z.object(shape)}, cb)`；无 shape 变体省略 inputSchema。
  `registerResource` 签名兼容（metadata 本就传）。
- 风险与对策：
  - v2 handleRequest 是 Web 标准 Request→Response——用官方 `toNodeHandler` 适配层，
    不手写 body 管道。
  - `createMcpHandler` 每请求从 factory 新建 server 实例（与现行 per-request stateless
    同构）；resource 注册随 server 重建，UiCardRegistry 是 daemon 级单例不受影响。
  - cards/proposals 逻辑层零改动（只换注册 API 形状）。
- 验证：单测（tools/list + tools/call 双纪元 header）+ dev 栈实测内核 mcp row 连通
  （日志无 "Unsupported protocol version"）。

## C4 —— DSH_HOME 隔离

```text
resolveDefaultDshHome():
  env DSH_HOME(非空白) → 用之                        （显式覆盖权保留）
  否则 → <homeDir()>/.skill-creator/dsh-home          （app 隔离默认）
```

- 理由：产品内核宿主（boot/dispose/heal 镜像）与模型路由桥（settings.yaml/
  .credentials.yaml 投影）都在 daemon 控制下，隔离目录可完全自举；用户 `~/.dsh` 的
  CLI 状态不再能压垮产品内核。
- 不做：不迁移不提示旧 `~/.dsh`（无兼容策略；首次启动空目录自举）。steward-store
  的 dsh-settings.json 真源位置不变（homeDir()/steward-store）。
- 用户可见性：最终报告显著标注此默认变更与回滚口（`DSH_HOME=~/.dsh`）。

## 测试与验收

- C1：契约单测（skill 引用 parse/reject）+ daemon 展开单测（命中/NOT_FOUND/截断）+
  fuzzy 匹配器单测 + registry 同名 token 配对单测（已有用例扩 kind）。
- C2：vision 子代理走查（桌面/窄窗 × 明暗）逐容器 PASS + 组件测试不回归。
- C3：MCP 单测迁移双纪元 + dev 栈内核实测 mcp 工具连通。
- C4：resolveDefaultDshHome 单测（env 优先/app 默认）+ dev 栈隔离目录自举实测。
- 全量门禁：pnpm check（test + typecheck + webui check + fmt）+ pnpm build +
  npm pack --dry-run（依赖面变更核对）。
