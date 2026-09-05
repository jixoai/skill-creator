# Proposal: creator-agent-workspace

## Why

当前 Creator 只是一个裸表单：目录名输入 + frontmatter（name/description）输入 + 正文 textarea + 保存按钮（见 `webui/src/routes/creator/+page.svelte`）。它完全没有借助 AI——用户得自己手写正文、自己猜 frontmatter 字段、自己排版。它也没有变更历史：每次保存静默覆盖磁盘版本，用户无从回看「上一版写了什么」。它更没法让用户在创建技能的当下就用这个技能试一试——只能写完、保存、切到别处、再人工跑一遍才能判断技能到底好不好用。

产品的愿景是一个完整的 AI 闭环工作台：用 AI 写技能、让 AI 用这个技能、观察结果、再迭代——全部在一个编辑 Tab 内完成。本变更把 Creator 从「表单编辑器」改造成「AI 驱动的技能创作工作台」：左侧 ACP 对话面板让 agent 帮你写 / 改技能，右侧一组子视图（文件浏览器、变更日志、预览、校验、测试运行）让你随时看到技能的现状、历史与实际效果。

## What Changes

- 把 Creator 的编辑 Tab 重设计为左右分栏布局：
  - 左：ACP 对话面板（来自 change 4 的 `acp-agent-bridge`）—— 通过对话驱动 agent 创作 / 改进技能。
  - 右：tabbed 子视图（文件浏览器 / 变更日志 / 渲染预览 / 校验 / 测试运行）。
- Creator home Tab 改为引导式入口：打开已有技能 / 从模板新建技能 / 最近编辑列表。
- 变更日志（Change Log）：技能 `SKILL.md` 修订历史的 git 风格 diff 视图。每次保存 = 一条 revision 条目（含 unified diff）。
- 测试运行（Test-run）子视图：「让 agent 用这个技能」—— 打开一个 secondary ACP session，把技能交给 agent 并给出测试 prompt；用户观察 agent 行为以判断技能是否有效。
- 模板画廊（Template Gallery）：以技能模板（blank、frontend-dev、code-review 等）作为起点。模板源是已存在的 `webui/src/lib/templates.ts`。
- **BREAKING**：Creator 路由变为 tab-scoped（依赖 change 1 的 `chrometabs-shell`）。编辑 Tab = `/creator/tab/<wsId>/<provId>/<skillId|new>`；旧 `/creator` 路由由 tab 化路由层重定向到 home Tab 或对应实例 Tab。

## Capabilities

- 新增：`creator-agent-workspace` —— 左右分栏的 AI 驱动技能创作工作台（ACP 对话面板 + 子视图组）。
- 改造：creator 的保存流程——revision 历史在 UI 中显式暴露（变更日志子视图），而不再只是在底层被静默强制。

## Impact

- WebUI：Creator 页面大幅重写；新增 `AcpPanel`、`SubViewTabs`、`ChangeLog`、`TestRun`、`FileBrowser`、`Preview`、`ValidationView` 等组件；消费 change 1 的 Tab 外壳与 change 4 的 ACP 对话面板。
- 后端：creator-service 已经在每次保存时记录 SHA-256 content revision（见 `src/shared/contracts/creator.ts` 的 `SkillDocument.revision`）；本变更新增一个只读 RPC `creator.revisions` 暴露 revision 历史，供变更日志子视图消费。
- 安全不变量：agent 的文件写入仍走既有 containment check + revision-safe save（`creator.save` 的 `mode: "update"` + `expectedRevision` 路径），loopback / token-in-fragment / server-owned path 全部不变。
- 依赖：change 1（`chrometabs-shell`，提供 Tab 外壳与状态隔离层）+ change 4（`acp-agent-bridge`，提供 daemon 桥接的 ACP 对话能力）。
- 测试：新增分栏布局、ACP 集成 mock、revision 历史、模板应用、测试运行子视图等测试；Creator 现有 store 测试因 Tab 化与 ACP 集成需适配（由 change 1 主导）。
