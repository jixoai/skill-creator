## Context

Creator 现状是一个表单编辑器：左栏列出当前 Workspace 的已有技能，右栏是 `name` / `description` 输入 + 正文 textarea + Edit/Preview 切换（`webui/src/routes/creator/+page.svelte`）。状态由 `webui/src/lib/stores/creator.ts`（纯命令封装：`saveSkill` / `loadSkillDoc` / `removeSkill`）+ 模块级全局 store（`skillsState`、`workspaceState`、`connectionState`）承载，并用 `createRequestGenerationGate(getConnectionGeneration)` 做 latest-wins 提交判定。

底层支持已经齐全，但没被 UI 用上：

- `creator.save` 每次都走 revision-safe（`mode: "update"` + `expectedRevision`），保存返回 `SkillDocument.revision`（SHA-256 content hash，见 `src/shared/contracts/creator.ts`）。
- `skills.info` 已经返回完整 `content` 与 `revision`（见 `src/shared/contracts/skills.ts`），change 4 的 `workspaces-skill-preview` 已用其做正文渲染。
- `webui/src/lib/templates.ts` 已有覆盖 coding/writing/data/design/devops/legal 的内置模板集，目前只被一个下拉菜单消费。
- change 0 的 `chrometabshell-standard` 提供 Shell 标准（RouteContract / defineApp / AppShell / TabOutlet / navigate / hooks）；change 1 的 `chrometabs-shell` 在其上声明三个 App manifest + 把现有 store 迁到状态分层模型。
- change 4 的 `acp-agent-bridge` 提供 daemon 桥接的 ACP 对话能力：daemon spawn agent 子进程、stdio↔WS 转发、浏览器作 ws-client 连入。Agent 的文件写入可被安全网关拦截 → 转译为 creator 保存路径。**ACP session 状态全部 daemon-owned**（见 change 4 状态分层），浏览器经 WS 推送渲染。

依赖方向（AGENTS.md）：`shared contracts < domain < transport < entry`。本变更同时动 WebUI 层（分栏布局与子视图）与 daemon 层（新增只读 revision 历史 RPC），所有跨进程边界仍走 Zod safeParse；WebUI 不直接 import daemon 实现或 `node:fs`。

## 状态分层（来自 config.yaml 原则）

| 状态                                                     | 存储层                                                              | 说明                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| 当前激活子视图（file / log / preview / validate / test） | **URL search param** `subview=file\|log\|preview\|validate\|test`   | 视图状态真相源；刷新可恢复；用 `useSearch` 读            |
| ACP sessionId（编辑 Tab 对应的创作 / 测试 session）      | **URL search param** `?session=acp_xxx`（+ `?testSession=acp_yyy`） | 视图状态；刷新可恢复指向                                 |
| SKILL.md 内容 / frontmatter / revision                   | **daemon RPC**（`creator.load` / `skills.info`）                    | 按需拉取，**不缓存在前端 memory 跨渲染周期**             |
| 变更日志 / revision 历史                                 | **daemon RPC**（`creator.revisions`）                               | 浏览器渲染，不缓存                                       |
| ACP session（messages / tool_calls / plans）             | **daemon**（change 4 子进程池）                                     | daemon-owned；浏览器经 WS 推送渲染，不存前端 memory      |
| 文件浏览器目录树                                         | **daemon RPC**（`creator.listFiles` 或扩展 `skills.info`）          | 按需拉取                                                 |
| 未保存草稿（正文 / frontmatter 输入）                    | **组件级 `$state`**                                                 | 临时表单；保存时 `creator.save` RPC 落盘；组件卸载即消失 |
| 分栏比例 / dropdown / loading / toast                    | **组件级 `$state`**                                                 | 瞬时 UI                                                  |

**禁止**：把 SKILL.md 内容、revision 历史、ACP 会话历史缓存在前端 memory 跨渲染周期；把它们写入 localStorage。

## 布局

```
Creator edit tab
┌────────────────────────┬──────────────────────────────┐
│ ACP 对话面板 (左)       │ 子视图 tabs (右)              │
│                        │ [文件] [日志] [预览] [校验] [测试]│
│ • agent: claude code   │ ┌──────────────────────────┐ │
│ • session active       │ │                          │ │
│                        │ │ active sub-view content  │ │
│ "帮我写一个代码审查     │ │                          │ │
│  技能，关注安全性"      │ │ 文件: SKILL.md 源码编辑    │ │
│                        │ │ 日志: revision diff 列表   │ │
│ ▸ agent 生成 frontmatter│ │ 预览: 渲染后效果           │ │
│ ▸ agent 写 body        │ │ 校验: ccski validate       │ │
│ ▸ tool_call: writeFile │ │ 测试: agent 用这个技能跑   │ │
│   (你审批 → 落盘)       │ │                          │ │
│                        │ └──────────────────────────┘ │
│ [prompt input]         │                              │
└────────────────────────┴──────────────────────────────┘
```

## 数据流

```
用户在 ACP 面板输入 prompt
        │
        v
ACP client (browser ws-client) ──> daemon ACP bridge (change 4)
        │                                   │
        │                          spawn agent 子进程
        │                          cwd = skill 的 workspace provider root
        │                                   │
        │                          agent 输出: frontmatter / body / tool_call(writeFile)
        │                                   │
        v                                   v
agent 文件写入 ──> 安全网关 (containment check)
        │                                   │
        │  通过  ─> revision-safe save (creator.save mode:"update")
        │                          │
        │                          v
        │                  文件浏览器子视图自动刷新 (skills.info / skills.list)
        │                          │
        │                          v
        │                  变更日志子视图新增一条 revision (creator.revisions)
        │                          │
        │                          v
        │                  校验子视图重跑 (skills.validate)  ──> 显示 errors/warnings
        │
        └─  拒绝  ─> 在 ACP 面板内提示，不落盘
```

## Goals

- Creator 编辑 Tab 渲染为左右分栏：左 ACP 对话面板，右 tabbed 子视图。
- ACP 对话面板连接 daemon 的 ACP bridge（change 4），agent 的 cwd = 当前技能所在的 workspace provider root。
- Agent 的文件写入经安全网关 → revision-safe 保存 → 文件浏览器与变更日志自动刷新。
- 五个子视图各自独立、可切换，且共享同一份当前技能文档投影（单一事实源）。
- Creator home Tab 提供：模板画廊 + 最近编辑 + 打开/创建入口。
- 变更日志暴露完整 revision 历史，每条含 unified diff。

## Non-Goals

- 实时多人协作编辑（不支持多用户同时编辑同一技能）。
- 技能发布到外部 registry（发布流程不在本变更范围）。
- 自动技能质量打分（校验子视图只跑 `skills.validate`，不引入主观评分模型）。
- ACP 对话历史的跨会话持久化（关闭编辑 Tab 即结束该 ACP session，不做磁盘持久化）。
- 测试运行子视图的自动化断言（用户人工观察判断，不自动判定技能好坏）。

## Decisions

### D1. 分栏比例与响应式

- 左侧 ACP 面板 40% / 右侧子视图 60%，中间一条可拖拽分隔条（resizable splitter）。
- 窄屏（沿用 change 1 的 `max-[720px]` 断点）：上下堆叠，顶部一个 toggle 在「对话」与「子视图」之间切换，避免双区在窄屏互相挤压。
- **状态分层**：分栏比例是组件级瞬时 UI 态，收敛在编辑 Tab 视图组件局部 `$state`（不写 localStorage）；**当前激活子视图编码到 URL search param `subview=file|log|preview|validate|test`**（视图状态真相源，刷新可恢复），组件用 change 0 的 `useSearch<{ subview?: "file"|"log"|"preview"|"validate"|"test" }>()` getter + `$derived` 读，切子视图调 `navigate.go` 推 URL。

### D2. ACP 面板接入（session daemon-owned，URL 持 sessionId）

- ACP 面板连接 daemon 的 ACP bridge（change 4）为当前编辑 Tab 建立的 session。
- Agent 的 cwd 绑定到该技能的 workspace provider root（与 `creator.save` 的 target 同一作用域）。
- Agent 的文件写入经安全网关：containment check（路径必须落在该 workspace provider root 内）+ revision-safe save（转译为 `creator.save` 的 `mode: "update"` + `expectedRevision`）。用户在 ACP 面板内对 `tool_call(writeFile)` 审批后落盘。
- 落盘成功后，文件浏览器子视图（按需拉取 `skills.info` / `skills.list` RPC）与变更日志子视图（按需拉取 `creator.revisions` RPC）重新拉取刷新。
- **状态分层**：ACP session 状态（messages / tool_calls / plans）全部 daemon-owned（change 4），浏览器经 WS 推送渲染、**不存前端 memory**；sessionId 编码到 URL search param `?session=acp_xxx` 支持深链，刷新可恢复指向。
- 请求代次门（`createRequestGenerationGate`）保持 per-call：在编辑 Tab 视图组件内构造，组件卸载即被 GC（不再依赖 TabScope.dispose）。

### D3. 文件浏览器子视图（SKILL.md 内容来自 daemon RPC，草稿在组件 `$state`）

- 渲染技能的目录树：`SKILL.md` + 任何 references / scripts / assets 子项（通过扩展 `skills.info` 返回的目录结构，或新增一个只读 `creator.listFiles` RPC）。目录树数据按需从 daemon RPC 拉取，**不缓存在前端 memory 跨渲染周期**。
- `SKILL.md` 内容（frontmatter + body + revision）来自 daemon RPC（`creator.load` / `skills.info`），按需拉取；**不在前端 memory 跨渲染周期缓存**。
- 编辑 `SKILL.md` 用代码编辑器（CodeMirror 或 Monaco），**懒加载**——首次切到该子视图才动态 `import()`，避免拖大主 bundle。
- **草稿（未保存的正文 / frontmatter 输入）收敛在编辑器组件局部 `$state`**（临时表单状态，状态分层 memory 层）；保存时通过 `creator.save`（`mode: "update"` + `expectedRevision`）RPC 落盘。组件卸载即丢弃草稿；切走再切回重新从 RPC 拉取最新已保存值。
- Frontmatter 以结构化字段（name/description 输入 + 额外 key-value 表）编辑，正文用代码编辑器编辑；保存仍走 `creator.save`。

### D4. 变更日志子视图（revision 历史来自 daemon RPC，浏览器渲染）

- 列出该技能的全部 revision，每次保存生成一条。
- 每条 entry：时间戳 + unified diff（与上一版正文对比）。
- 用户可点开任意历史 revision 只读查看（不提供回滚——回滚等价于「复制旧正文 → 再保存一次」，由用户在文件浏览器手动完成，避免引入隐式写路径）。
- **Revision 历史由新增只读 RPC `creator.revisions` 提供**，读取 creator-service 已维护的 revision 日志（SHA-256 content hash）。浏览器按需拉取并渲染，**不缓存在前端 memory 跨渲染周期**；保存成功后重新拉取刷新。RPC 输入输出走 Zod safeParse。

### D5. 预览子视图

- 渲染当前 `SKILL.md`：frontmatter 作为只读元数据表（key-value），正文按 markdown 渲染为格式化文档。
- 渲染结果与 agent 实际看到的完全一致（消费 change 4 的 `workspaces-skill-preview` 同一套 markdown 渲染管线）。
- 预览实时跟随文件浏览器中的草稿（dirty draft）变化，而非仅在保存后更新——让用户在保存前就能看到效果。

### D6. 校验子视图

- 调用 `skills.validate`（ccski）并展示 errors / warnings。
- 每次保存后自动重跑（复用 `creator.save` 返回的 `SaveSkillResult.validation`）。
- 同时提供「手动重新校验」按钮（在 agent 改了草稿但尚未保存时，让用户对当前草稿跑一次校验）。

### D7. 测试运行子视图（闭环核心）

- 一个 secondary ACP session（独立于左侧创作 session）：把当前技能交给 agent，并注入一个测试 prompt（如「用这个技能审查这段代码」）。
- 用户观察 agent 的行为（工具调用、输出、是否遵循技能指引），人工判断技能是否有效。
- 这是 AI 闭环的「测试」环节：写 → 测试 → 观察 → 迭代。测试 session 的 cwd 同样绑定该技能的 workspace provider root。
- 测试 session 不写回技能文件（只读消费当前已保存版本）；若用户想根据测试结果修改，回到左侧创作面板或文件浏览器。

### D8. 模板画廊（home Tab）

- 模板源是已存在的 `webui/src/lib/templates.ts`（`TEMPLATES` 数组，按 `TEMPLATE_CATEGORIES` 分类）。
- 每个模板预填 frontmatter（name/description）+ 正文骨架（含 `{{placeholder}}`）。
- 选择模板 = 在新编辑 Tab 中以模板内容初始化草稿（`mode: "create"`），与现有 `useTemplate` 行为一致，只是入口从下拉菜单升级为画廊卡片。
- home Tab 还提供「最近编辑」列表（基于 `creator.revisions` 跨技能聚合最近 N 条）+ 「打开已有技能」入口（跳到对应 workspace provider 的技能列表）。

### D9. Svelte 5 runes 选择（状态分层，无全局可变 store）

- 当前激活子视图：从 URL search param 派生——`useSearch<{ subview?: "file"|"log"|"preview"|"validate"|"test" }>()` getter + `$derived`，**不用 `$state`**。
- ACP sessionId：从 URL search param 派生（`useSearch<{ session?: string }>()` + `$derived`）。
- 当前技能文档（frontmatter / body / revision）：按需从 daemon RPC（`creator.load` / `skills.info`）拉取，存组件局部 `$state` 仅用于当前渲染周期；切走再切回重新拉取，不跨渲染缓存、不写 localStorage。
- 未保存草稿：编辑器组件局部 `$state`（临时表单）。
- ACP session 渲染数据（messages / tool_calls / plans）：经 WS 推送流式到达，渲染到组件局部 `$state` 的「当前可见窗口」——**不累加进全局 store**，刷新 / 重连由 daemon 重新推送。
- Revision 列表：`$derived`，从 `creator.revisions` RPC 拉取结果派生；保存动作触发重新拉取。
- 分栏比例 / dropdown / loading / toast：组件局部 `$state`（瞬时 UI）。
- 不引入新的全局可变 store：视图状态来自 URL，持久态来自 daemon RPC，临时态在组件 `$state`。

## Risks

- **代码编辑器 bundle 体积**：Monaco / CodeMirror 体量较大，全量打包会拖大主 bundle。**缓解**：编辑器组件懒加载（动态 `import()`），仅在用户切到「文件」子视图时才加载；首次加载显示 skeleton。
- **每个编辑 Tab 一个 ACP session 资源开销大**：ACP session = daemon 内一个 agent 子进程，并发开多个编辑 Tab 会爆资源。**缓解**：限制并发 ACP session 数（如最多 3 个活跃创作 session + 1 个测试 session）；超过上限时新 Tab 的 ACP 面板显示「session 排队中」并在用户聚焦时才拉起。
- **Revision 历史存储**：完整 diff 历史可能膨胀。**缓解**：内存中保留全部 revision 元数据，磁盘上只持久化最近 N 条（如 N=50）的完整正文，更早的只保留 SHA-256 hash 与时间戳；超出部分按需从 git（若 workspace 是 git repo）回填，否则只读不可回看正文。
- **ACP 写入与用户手动编辑竞态**：用户在文件浏览器手改正文的同时，agent 也发起 `writeFile`。**缓解**：所有写入都串行化经过 `creator.save` 的 revision 约束——`expectedRevision` 不匹配即报冲突，agent 与用户都需基于最新 revision 重试。
- **窄屏分栏可用性**：窄屏下左右分栏不可行。**缓解**：沿用 change 1 的 `max-[720px]` 断点，窄屏堆叠 + toggle 切换，与 Tab 栏折叠断点一致。
