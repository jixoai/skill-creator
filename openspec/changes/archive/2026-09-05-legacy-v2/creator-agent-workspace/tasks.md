# Tasks: creator-agent-workspace

> 每个 task 必须可通过 `pnpm check`（test + typecheck + webui check + fmt）验证。涉及 UI 的 task 必须包含桌面 + 窄屏（`max-[720px]`）视觉验证。涉及 daemon 生命周期的 task 必须运行对应 focused tests。本变更依赖 change 0（`chrometabshell-standard`）、change 1（`chrometabs-shell`）与 change 4（`acp-agent-bridge`），相关 task 假设 Shell 标准、三个 App manifest 与 ACP 桥接已就绪。

## 1. Creator home Tab 重设计（模板画廊 + 最近 + 入口）

- [x] 1.1 在 Creator App manifest（change 1 声明的 home activity `/creator`）下新增 home 视图：渲染模板画廊卡片网格（按 `TEMPLATE_CATEGORIES` 分组），每张卡片显示模板 name / description / category icon。
- [x] 1.2 卡片点击 = 调 `navigate.go(creatorNewRoute, { provId })` 推 URL 到 `/creator/new/<provId>?template=<id>`，在新编辑 Tab 中以模板内容初始化草稿（草稿存编辑器组件局部 `$state`，保存时 `creator.save` `mode: "create"`）。
- [x] 1.3 「最近编辑」区：按需调用 `creator.revisions`（task 5 提供）RPC 跨技能聚合最近 N 条 revision（不缓存到前端 memory），点击跳到对应技能的编辑 Tab。
- [x] 1.4 「打开已有技能」入口：跳到 Workspaces App 或 Creator 内的 workspace provider 技能列表选择器，选中后 `navigate.go` 推到对应编辑 Tab URL。
- [x] 1.5 「新建技能」入口：以空白模板（`# Instructions\n\n...` 默认正文）打开新编辑 Tab。
- [x] 1.6 桌面 + 窄屏视觉验证（窄屏画廊改为单列）。
- [x] 1.7 `pnpm check` 通过。

## 2. 编辑 Tab 分栏布局（ACP 面板 + 子视图 tabs，子视图 → URL）

- [x] 2.1 在 Creator App manifest 的编辑 activity（`/creator/edit/:wsId/:provId/:skillId`）下新增编辑 Tab 视图，渲染左右分栏容器；左侧 40% / 右侧 60%，中间可拖拽分隔条（resizable splitter）。
- [x] 2.2 窄屏（`max-[720px]`）改为上下堆叠 + 顶部 toggle（对话 / 子视图），沿用 change 1 的断点。
- [x] 2.3 新增 `webui/src/lib/components/creator/sub-view-tabs.svelte`：渲染 `[文件] [日志] [预览] [校验] [测试]` 五个 tab。**激活子视图编码到 URL search param `subview=file|log|preview|validate|test`**，组件用 `useSearch` getter + `$derived` 读，切换调 `navigate.go` 推 URL（不写 `$state` 全局单例）。
- [x] 2.4 分栏比例收敛进编辑 Tab 视图组件局部 `$state`（瞬时 UI，不写 localStorage）；切换 Tab 互不污染（各 Tab 的 URL 独立，视图状态来自 URL）。
- [x] 2.5 桌面 + 窄屏视觉验证。
- [x] 2.6 `pnpm check` 通过。

## 3. ACP 面板集成（连接 bridge，渲染 session 更新；session daemon-owned）

- [x] 3.1 新增 `webui/src/lib/components/creator/acp-panel.svelte`：作为浏览器 ws-client 连接 daemon 的 ACP bridge（change 4），为当前编辑 Tab 建立 session。
- [x] 3.2 绑定 agent 的 cwd 到当前技能的 workspace provider root（与 `creator.save` target 同一作用域）。
- [x] 3.3 渲染对话流（用户 prompt + agent 回复 + tool_call），支持流式更新。**ACP session 状态（messages / tool_calls / plans）daemon-owned**，浏览器经 WS 推送渲染、不累加进前端全局 `$state` 或 localStorage。
- [x] 3.4 底部 prompt 输入框 + 发送按钮（未提交文本是组件局部 `$state`，瞬时 UI）；发送经 ACP bridge 转发。
- [x] 3.5 **sessionId 编码到 URL search param `?session=acp_xxx`**（视图状态，刷新可恢复指向）；关闭编辑 Tab 时调 `acp.session.close` RPC，daemon 杀子进程；浏览器侧不缓存会话历史。
- [x] 3.6 ACP session 集成测试（mock daemon bridge：连接 → 发送 prompt → 收到 agent 回复 + tool_call → dispose；断言浏览器不缓存历史到 memory，重连后视图来自 daemon 推送）。
- [x] 3.7 `pnpm check` 通过。

## 4. 文件浏览器子视图（技能树 + SKILL.md 代码编辑器，内容来自 RPC，草稿在组件 `$state`）

- [x] 4.1 新增 `webui/src/lib/components/creator/file-browser.svelte`：渲染技能目录树（`SKILL.md` + references / scripts / assets），目录结构来自扩展后的 `skills.info` 或新增只读 `creator.listFiles` RPC（输入输出 Zod safeParse）。数据按需拉取，**不缓存在前端 memory 跨渲染周期**。
- [x] 4.2 代码编辑器组件（CodeMirror 或 Monaco）懒加载：首次切到「文件」子视图才动态 `import()`，加载期间显示 skeleton。
- [x] 4.3 `SKILL.md` 内容（frontmatter / body / revision）来自 daemon RPC（`creator.load` / `skills.info`），按需拉取；**未保存草稿收敛在编辑器组件局部 `$state`**（临时表单，状态分层 memory 层），组件卸载即消失。
- [x] 4.4 frontmatter 以结构化字段（name/description 输入 + 额外 key-value 表）编辑，正文用代码编辑器编辑；保存走 `creator.save`（`mode: "update"` + `expectedRevision`）RPC 落盘；成功后用返回 revision 刷新组件局部持有值，并触发文件浏览器与变更日志重新拉取 RPC。
- [x] 4.5 桌面 + 窄屏视觉验证（窄屏代码编辑器高度自适应）。
- [x] 4.6 `pnpm check` 通过。

## 5. 变更日志子视图（revision 历史 RPC + diff 渲染，浏览器渲染不缓存）

- [x] 5.1 后端：在 `src/shared/contracts/creator.ts` 新增只读 `CreatorRevisionsInputSchema` / `CreatorRevisionEntrySchema`（含 revision hash、时间戳、可选正文、unified diff）；输入输出经 Zod safeParse。
- [x] 5.2 后端：在 creator-service 新增 `revisions` RPC，读取已维护的 revision 日志（SHA-256 content hash）；磁盘只持久化最近 N 条完整正文，更早的只保留 hash + 时间戳。
- [x] 5.3 在 `src/shared/rpc-contract.ts` 的 `creator` 命名空间注册 `revisions` 方法。
- [x] 5.4 前端：新增 `webui/src/lib/components/creator/change-log.svelte`：按时间倒序列出 revision，每条显示时间戳 + unified diff，点击展开只读查看完整正文。Revision 数据来自 `creator.revisions` RPC，按需拉取，**不缓存在前端 memory 跨渲染周期**。
- [x] 5.5 保存成功后重新拉取 `creator.revisions` RPC 刷新 revision 列表。
- [x] 5.6 单元测试：revision 历史 RPC（含只持久化最近 N 条的策略）、diff 渲染、只读查看历史版本；断言 revision 列表不缓存到前端 memory / localStorage。
- [x] 5.7 daemon focused tests 通过 + `pnpm check` 通过。

## 6. 预览子视图（markdown 渲染当前技能，草稿来自组件 `$state`）

- [x] 6.1 新增 `webui/src/lib/components/creator/preview.svelte`：frontmatter 渲染为只读 key-value 元数据表，正文按 markdown 渲染。
- [x] 6.2 复用 change 4（`workspaces-skill-preview`）的同一套 markdown 渲染管线，保证渲染结果与 agent 实际看到的一致。
- [x] 6.3 预览实时跟随文件浏览器中的草稿（编辑器组件局部 `$state`）变化，不要求先保存。
- [x] 6.4 桌面 + 窄屏视觉验证。
- [x] 6.5 `pnpm check` 通过。

## 7. 校验子视图（保存自动校验，展示错误）

- [x] 7.1 新增 `webui/src/lib/components/creator/validation-view.svelte`：调用 `skills.validate`（ccski）并展示 errors / warnings。
- [x] 7.2 每次保存成功后自动展示 `creator.save` 返回的 `SaveSkillResult.validation` 结果。
- [x] 7.3 提供「手动重新校验」按钮，对当前草稿（编辑器组件局部 `$state`，未保存）运行 `skills.validate`。
- [x] 7.4 errors 与 warnings 分区列出，每条带文件/行号（若 ccski 提供）；校验结果不缓存到前端 memory 跨渲染周期。
- [x] 7.5 单元测试：保存后自动校验、手动校验草稿。
- [x] 7.6 `pnpm check` 通过。

## 8. 测试运行子视图（secondary ACP session 测试技能；session daemon-owned）

- [x] 8.1 新增 `webui/src/lib/components/creator/test-run.svelte`：打开一个独立于左侧创作 session 的 secondary ACP session（复用 task 3 的 ws-client 接入）。
- [x] 8.2 把当前已保存技能交给 agent，注入用户输入的测试 prompt；agent 行为（工具调用、输出）流式渲染。**测试 session 状态 daemon-owned**，浏览器经 WS 推送渲染、不缓存历史到前端 memory。
- [x] 8.3 测试 session 只读消费当前技能版本，不写回技能文件。
- [x] 8.4 **测试 sessionId 编码到 URL search param `?testSession=acp_yyy`**；关闭子视图或编辑 Tab 时调 `acp.session.close` RPC，daemon 杀子进程。
- [x] 8.5 集成测试（mock daemon bridge：测试 session 启动 → agent 用技能跑 → 输出渲染 → dispose；断言浏览器不缓存会话历史到 memory）。
- [x] 8.6 `pnpm check` 通过。

## 9. ACP 写入安全网关（containment + revision-safe 转译，daemon-owned）

- [x] 9.1 在 daemon ACP bridge（change 4）的安全网关层接入：拦截 agent 的 `tool_call(writeFile)`，做 containment check（路径必须落在该 workspace provider root 内）。
- [x] 9.2 通过 containment 的写入转译为 `creator.save`（`mode: "update"` + `expectedRevision`）；revision 冲突时回报 agent 需重试。
- [x] 9.3 路径越界或 revision 冲突的写入被拒，ACP 面板提示原因，不落盘。
- [x] 9.4 落盘成功后触发文件浏览器与变更日志子视图重新拉取 RPC 刷新（数据不缓存到前端 memory）。
- [x] 9.5 单元测试：containment 拒绝、revision 冲突重试、成功落盘后子视图刷新。
- [x] 9.6 daemon focused tests 通过 + `pnpm check` 通过。

## 10. Creator 状态分层迁移（来自 change 0 / 1）

- [x] 10.1 `webui/src/lib/stores/creator.ts`（当前纯命令封装）保持无状态：调用方在编辑 Tab 视图组件内 per-call 构造请求代次门，不引入 TabScope。
- [x] 10.2 视图状态（激活子视图、sessionId、testSession）编码到 URL search params（`subview` / `session` / `testSession`），组件用 `useSearch` + `$derived` 读；不写全局 `$state`。
- [x] 10.3 SKILL.md 内容 / revision 历史按需从 daemon RPC（`creator.load` / `skills.info` / `creator.revisions`）拉取，不缓存到前端 memory 跨渲染周期；未保存草稿收敛进编辑器组件局部 `$state`，关闭含未保存草稿的 Tab 触发 dirty-check 确认。
- [x] 10.4 消费者改为从 URL（视图状态）+ daemon RPC（持久态）+ 组件 `$state`（临时态）取数据，而非 import 全局 store 对象。
- [x] 10.5 适配现有 Creator 相关测试（依赖全局单例的断言改为「视图状态来自 URL + 持久态来自 RPC mock」）。
- [x] 10.6 `pnpm check` 通过。

## 11. 测试（含状态分层）

- [x] 11.1 分栏布局测试：左右分栏渲染、可拖拽分隔、窄屏堆叠 + toggle、Tab 间视图状态隔离（各 Tab URL 独立）。
- [x] 11.2 ACP 集成 mock 测试：连接 → 对话 → agent 回复 + tool_call → 审批落盘 → dispose；session 隔离；浏览器不缓存会话历史。
- [x] 11.3 revision 历史测试：`creator.revisions` RPC（含最近 N 条持久化策略）、变更日志渲染、只读查看历史版本；revision 列表不缓存到前端 memory。
- [x] 11.4 模板应用测试：home Tab 模板画廊选择 → 新编辑 Tab 初始化草稿（组件 `$state`）；占位符原样保留。
- [x] 11.5 测试运行子视图测试：secondary session 启动 → agent 用技能跑 → 只读不写回 → dispose。
- [x] 11.6 安全网关测试：containment 拒绝越界写入、revision 冲突重试、成功落盘后子视图刷新。
- [x] 11.7 状态分层测试：激活子视图刷新可恢复（URL `subview`）；SKILL.md 内容 / revision / ACP 历史不缓存到前端 memory 跨渲染周期、不写 localStorage；sessionId 在 URL，刷新可恢复指向。
- [x] 11.8 全量 `pnpm check` 通过。
