# Proposal: creator-agent-chat — Creator 会话优先工作台

## Why

Owner 原话：「Creator 页面需要好好整改，它的入口应该是一个 AgentChat，我们很少
会手动去创建一个 skill，更多是通过 agent 来创建 skill，正如我们使用
$skill-creator 一样」。grill Q10 拍板：会话一份真相（Agent 页管理全部），Creator
的专有价值 = **稳定入口**（多 workspace 并行时通过 skill 直达其 Chat）+ **创作
引导**（$skill-creator 循环：capture intent → draft → test prompts → review →
improve 的 seed 与流程护栏）。

## What Changes

- **Creator 首屏 = workspace 会话工作台**（`/w/:wsId/creator`）：当前 ws 的
  技能创作会话列表（target = 本 ws 的会话过滤视图 + creator 前端标记——
  r2 修订：不另定 context.skillId 元数据，会话归属一律复用 skills-agent-page
  的统一 target 契约）+ 新会话引导（创作意图 seed 模板——capture/draft/
  test/review/improve 阶段化提示）；嵌入 Chat（复用 skills-agent-page 的
  共享会话面组件 + creatorPreset）。
- **技能 → Chat 稳定入口**：Skills 主屏详情的「Chat about this skill」直达
  带技能上下文的会话——按统一 target 契约创建；resume 查找键 = target +
  seedSkill=该技能 的精确匹配（命中续聊/无匹配新建；r3 修订：不续上同
  target 他技能的会话；不发明平行
  schema）。
- **创作引导护栏**：creator 会话的工具面预设（skills_search/skills_info 等
  指针读取；mutation 走 proposal）；草稿产出卡（会话内的技能草稿预览 +
  diff + 「保存为技能」proposal 审批链）。
- **编辑器降为二级工作页**（路由统一 r2 修订：edit =
  `/w/:wsId/creator/edit/:providerId/:skillId`、new =
  `/w/:wsId/creator/new/:providerId`，search 携 `subview`/`template`）：现有
  CreatorWorkspace 编辑器保留为深链工作页（YAML/正文/change log/模板；模板
  画廊从首屏退位为新会话 seed 选项）；**skill-detail 只读投影**（残留台账
  吸收：详情查看去行内编辑/输入框/Save/Delete——唯一保留写 = toggle 启停
  管理；frontmatter/正文编辑单一真相源 = Creator 编辑页）。
- **composer 重组**（残留台账吸收）：底排控件分组 + 模型胶囊根治截断。
- Global tab 语义：Creator 项进入后空态引导切换 Imported workspace（沿
  writable 门控哲学，创建/保存目标永远 Imported）。

## Impact

- webui：CreatorHome 重写（会话列表+引导）、CreatorWorkspace 保留深化、
  skill-detail-panel 只读化（skills-dashboard 的 detail 面与本 change 的编辑
  深链分工）、composer 组件重组。
- daemon：creator 会话 seed 模板（finding-propose 模板机制复用扩展）；契约
  零新增（r2 修订：复用 skills-agent-page 的 target 契约与共享组件，seed 沿
  既有 transcript meta seed 机制，无平行 schema）。
- i18n（引用制）：完成时在 webui-i18n-bilingual 的 inventory.md 标记对应
  B 类面完成并双语适配（唯一帐本 = 该 change）。
- 测试：会话-技能上下文恢复（resume 查找键）、proposal 审批链回归、编辑器
  edit/new 深链路由、只读投影零编辑写断言。
