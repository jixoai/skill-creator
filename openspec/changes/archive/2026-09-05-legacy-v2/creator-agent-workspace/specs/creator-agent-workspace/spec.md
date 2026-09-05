# Capability: creator-agent-workspace

AI 驱动的技能创作工作台：Creator 编辑 Tab 渲染为左右分栏（左侧 ACP 对话面板 + 右侧 tabbed 子视图），通过对话驱动 agent 创作/改进技能，并在子视图中查看文件、变更历史、预览、校验与测试运行。

## ADDED Requirements

### Requirement: 编辑 Tab 左右分栏布局

Creator 编辑 Tab MUST 渲染为左右分栏：左侧 ACP 对话面板，右侧 tabbed 子视图组（文件 / 日志 / 预览 / 校验 / 测试）。两栏比例可拖拽调整；窄屏下上下堆叠并提供 toggle 切换。

#### Scenario: 进入编辑 Tab 看到分栏

- **WHEN** 用户打开一个 Creator 编辑 Tab（已加载某技能或新建技能）
- **THEN** 左侧渲染 ACP 对话面板
- **AND** 右侧渲染子视图 tab 栏与当前激活子视图内容
- **AND** 中间有一条可拖拽分隔条调整两栏宽度

#### Scenario: 窄屏堆叠与 toggle

- **WHEN** 视口宽度小于或等于 720px
- **THEN** 左右分栏改为上下堆叠
- **AND** 顶部出现一个 toggle 在「对话」与「子视图」之间切换显示
- **AND** 任一时刻只完整显示一区，避免互相挤压

#### Scenario: 分栏状态随 Tab 隔离

- **WHEN** 用户在编辑 Tab A 把分隔条拖到 30/70，切到编辑 Tab B 再切回 Tab A
- **THEN** Tab A 的分隔比例与激活子视图被保留
- **AND** Tab B 拥有自己独立的分隔比例与激活子视图，互不污染

### Requirement: ACP 对话面板驱动创作

左侧 ACP 对话面板 MUST 连接 daemon 的 ACP bridge（change 4）为当前编辑 Tab 建立的 session，agent 的 cwd 绑定到该技能的 workspace provider root，用户通过对话驱动 agent 创作/改进技能。

#### Scenario: 对话触发 agent 创作

- **WHEN** 用户在 ACP 面板输入「帮我写一个代码审查技能，关注安全性」并发送
- **THEN** 该 prompt 经 daemon ACP bridge 转发给 agent 子进程
- **AND** agent 的 cwd 已绑定到当前技能的 workspace provider root
- **AND** agent 的回复（frontmatter 提议、正文草稿、tool_call）流式回到 ACP 面板渲染

#### Scenario: agent 写入经审批落盘

- **WHEN** agent 发起 `tool_call(writeFile, SKILL.md, ...)`
- **THEN** 该写入请求出现在 ACP 面板等待用户审批
- **AND** 用户批准后，写入经安全网关转译为 `creator.save`（`mode: "update"` + `expectedRevision`）落盘
- **AND** 文件浏览器子视图与变更日志子视图自动刷新

#### Scenario: 关闭编辑 Tab 销毁 ACP session

- **WHEN** 用户关闭当前编辑 Tab
- **THEN** 该 Tab 的 ACP session 被 dispose
- **AND** 其 in-flight 请求被请求代次门 invalidate，落地被判 stale
- **AND** 其它编辑 Tab 的 ACP session 不受影响

### Requirement: agent 文件写入 containment-check 与 revision-safe

agent 通过 ACP 发起的一切文件写入 MUST 经 containment check（路径落在该 workspace provider root 内）并转译为 revision-safe 保存，禁止任何绕过安全网关的直写。

#### Scenario: 路径越界被拒

- **WHEN** agent 发起 `writeFile` 目标路径在该 workspace provider root 之外
- **THEN** 安全网关拒绝该写入
- **AND** ACP 面板提示拒绝原因
- **AND** 不落盘，revision 历史不新增条目

#### Scenario: revision 冲突需重试

- **WHEN** agent 与用户几乎同时修改同一技能，agent 的写入基于过期 `expectedRevision`
- **THEN** `creator.save` 返回 revision 冲突
- **AND** ACP 面板提示冲突
- **AND** agent 需基于最新 revision 重新生成写入

### Requirement: 文件浏览器子视图

「文件」子视图 MUST 展示技能的目录树（`SKILL.md` + 任何 references / scripts / assets），并提供 `SKILL.md` 的代码编辑器与结构化 frontmatter 字段编辑。

#### Scenario: 渲染技能目录树

- **WHEN** 用户切到「文件」子视图
- **THEN** 显示该技能的目录树，根节点为 `SKILL.md`
- **AND** 子节点列出 references / scripts / assets 等已存在文件
- **AND** 代码编辑器懒加载（首次切到该子视图才动态 `import()`），加载期间显示 skeleton

#### Scenario: 编辑 SKILL.md 并保存

- **WHEN** 用户在代码编辑器改正文，在结构化字段改 frontmatter，点击保存
- **THEN** 保存走 `creator.save`（`mode: "update"` + `expectedRevision`）
- **AND** 成功后文件浏览器与变更日志刷新，revision 推进

### Requirement: 变更日志子视图列出 revision 历史

「日志」子视图 MUST 列出该技能的全部 revision 历史，每条 entry 含时间戳与 unified diff，支持只读查看任意历史版本。

#### Scenario: 列出 revision 历史

- **WHEN** 用户切到「日志」子视图
- **THEN** 显示该技能按时间倒序排列的 revision 列表
- **AND** 每条 entry 显示时间戳与该 revision 相对上一版的 unified diff
- **AND** revision 数据来自只读 RPC `creator.revisions`，输入输出经 Zod safeParse

#### Scenario: 保存后新增一条 revision

- **WHEN** 用户（或经审批的 agent）保存一次技能
- **THEN** 变更日志子视图自动刷新并新增一条 revision entry
- **AND** 新 entry 显示本次保存相对上一版的 diff

#### Scenario: 只读查看历史版本

- **WHEN** 用户点击变更日志中的某条历史 revision
- **THEN** 以只读模式显示该 revision 的完整正文
- **AND** 不提供回滚写路径（回滚由用户在文件浏览器手动复制旧正文再保存完成）

### Requirement: 预览子视图渲染技能

「预览」子视图 MUST 把当前 `SKILL.md` 渲染为 agent 实际看到的样子：frontmatter 作为只读元数据表，正文按 markdown 渲染，并实时跟随文件浏览器中的草稿变化。

#### Scenario: 渲染当前技能

- **WHEN** 用户切到「预览」子视图
- **THEN** frontmatter 渲染为只读 key-value 元数据表
- **AND** 正文按 markdown 渲染为格式化文档
- **AND** 渲染结果与 agent 实际看到的完全一致（消费同一套 markdown 渲染管线）

#### Scenario: 跟随草稿实时更新

- **WHEN** 用户在文件浏览器子视图修改了正文（尚未保存）
- **THEN** 切回「预览」子视图时显示的是当前草稿（含未保存改动）的渲染效果
- **AND** 不要求先保存才能预览

### Requirement: 校验子视图自动校验

「校验」子视图 MUST 调用 `skills.validate`（ccski）并展示 errors / warnings，每次保存后自动重跑，同时提供手动重新校验。

#### Scenario: 保存后自动校验

- **WHEN** 一次保存成功完成
- **THEN** 校验子视图自动展示 `creator.save` 返回的 `SaveSkillResult.validation` 结果
- **AND** errors 与 warnings 分别列出

#### Scenario: 手动校验当前草稿

- **WHEN** 用户在文件浏览器改了草稿但未保存，点击校验子视图的「手动重新校验」按钮
- **THEN** 对当前草稿运行 `skills.validate`
- **AND** 展示 errors / warnings，无需先保存

### Requirement: 测试运行子视图让 agent 用技能

「测试」子视图 MUST 打开一个 secondary ACP session，把当前技能交给 agent 并注入测试 prompt，用户观察 agent 行为以判断技能是否有效。

#### Scenario: 启动测试 session

- **WHEN** 用户切到「测试」子视图并输入测试 prompt（如「用这个技能审查这段代码」）后启动
- **THEN** 打开一个独立于左侧创作 session 的 secondary ACP session
- **AND** agent 被赋予当前技能，cwd 同样绑定该 workspace provider root
- **AND** agent 的行为（工具调用、输出）流式渲染供用户观察

#### Scenario: 测试 session 只读不写回

- **WHEN** 测试 session 运行中
- **THEN** 测试 session 只读消费当前已保存的技能版本
- **AND** 测试 session 不写回技能文件
- **AND** 用户若想据测试结果修改，需回到左侧创作面板或文件浏览器

### Requirement: home Tab 模板画廊与入口

Creator home Tab MUST 提供模板画廊（来自 `webui/src/lib/templates.ts`）、最近编辑列表与打开/创建技能的入口。

#### Scenario: 模板画廊预填技能

- **WHEN** 用户在 home Tab 的模板画廊选择某个模板（如 code-review）
- **THEN** 在新编辑 Tab 中以该模板的 frontmatter 与正文骨架初始化草稿（`mode: "create"`）
- **AND** 正文中的 `{{placeholder}}` 占位符原样保留待用户替换

#### Scenario: 最近编辑与打开入口

- **WHEN** 用户进入 Creator home Tab
- **THEN** 显示最近编辑列表（基于 `creator.revisions` 跨技能聚合的最近 N 条）
- **AND** 提供「打开已有技能」入口（跳到对应 workspace provider 的技能列表）
- **AND** 提供「新建技能」入口（以空白模板打开新编辑 Tab）
