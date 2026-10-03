# Design: creator-agent-chat

## 1. 页面结构（r2 修订：路由统一 + 会话标记不另定 schema）

```text
/w/:wsId/creator                             首屏：会话工作台
  左：本 ws 创作会话列表（target=ws 过滤 + creator 前端标记）
  主：新会话引导（意图输入 + seed 模板选择）或所选会话 Chat
/w/:wsId/creator/new/:providerId             新建工作页（?template= 模板 seed）
/w/:wsId/creator/edit/:providerId/:skillId   编辑器工作页（?subview= 子视图；
                                             现有 CreatorWorkspace 深化）
```

- 路由与 shell-page-tabs §1.4 redirect 表目标一致
  （`/w/:ws/creator/edit/:p/:skill`、`/w/:ws/creator/new/:p`）；search 携
  `subview`/`template`，路径段不重复编码。
- 会话面组件与 SkillsAgentPage 共享（skills-agent-page 1.4 的组件化产出），
  Creator 传入 creatorPreset（工具面 + persona 段 + seed）。
- **Creator 会话标记（r2 修订；r3 补数据面）**：不另定 `context.skillId`
  元数据——会话归属一律用 skills-agent-page 的统一 target 契约
  （workspaceId/providerId）；「creator 会话」= 会话列表前端过滤
  （summary.target=ws + summary.seedSkill 非 null 即创作会话——seedSkill
  投影由 skills-agent-page r3 修订进 AgentSessionSummarySchema，creator
  不新增 RPC）。会话真相仍一份（Agent 页 / Panel / Creator 同源）。
- 「Chat about this skill」（r3 修订：查找键带技能维度）：从 skills 详情
  发起，按统一 target（workspaceId/providerId）+ **seedSkill = 该技能**
  过滤会话列表——命中最近一条即续聊；**无 seedSkill 匹配即新建**
  （首条消息由 UI 层携带技能上下文，如 `$` 技能引用/结构化 prompt，新会话
  seed 记录该技能引用）。不做「同 target 最近会话不分技能一律续上」——那
  会把 A 技能的对话续给 B 技能。不发明平行 schema。

## 2. 创作引导（$skill-creator 循环护栏）

```text
capture → draft → test → review → improve
```

- 新会话引导卡三输入：想解决什么（意图）/ 何时触发（描述线索）/ 例子输入
  输出；「让 agent 起草」= 首条结构化 prompt（seed）。
- 会话内阶段 chip（当前环节提示，不阻塞自由对话）；test 环节提供「生成测试
  话术建议」（agent 产出 2-3 条，用户点选填入 eval case 草稿——衔接
  evaluating-dashboard）。
- 草稿产出卡：会话中 agent 产出/修改技能时，渲染 diff 预览卡 + 「Save via
  proposal」按钮（走 creator.create/update 的 proposal 链 + revision 闸）。

## 3. 编辑器二级化与只读投影（r2 修订：detail 所有权与 skills-dashboard 同源）

- 编辑器入口收敛：Creator 首屏会话列表的技能行 Edit 深链 + skills 详情的
  Edit in Creator（现有语义保留）。
- skill-detail（skills-dashboard 1.3 的 detail 面）**只读化**：去掉行内
  轻量编辑/头部可编辑输入/Save/Delete；编辑唯一入口 = Creator 编辑页深链。
  单一真相源断言：detail 面 skills 域零写 RPC（skills.toggle 除外）、无任何
  creator.save/delete 调用（源扫描断言）。按钮归属清单（与
  skills-dashboard §2 完全一致）：

```text
留 Dashboard detail（skills-dashboard 所有）：
  文档查看（只读）/ Validate / Update check（只读）
  Toggle enable/disable（skills 域唯一写 RPC = skills.toggle）
  Chat about this skill（本 change 增补入口）
  Edit in Creator（深链 /w/:wsId/creator/edit/:providerId/:skillId）
归 Creator 编辑页（唯一编辑真相）：
  name/description 行内轻量编辑（现 ProviderView，退役）
  frontmatter/正文编辑 + Save（revision 闸）/ Delete（revision-checked）
  change log / 模板
```

- 模板画廊退位：模板作为新会话 seed 选项（capture 阶段可载入模板 frontmatter
  起点）；CreatorHome 的画廊区删除。

## 4. composer 重组（残留台账项）

- 底排控件分组：左（附件/@/$ 引用族）/ 中（模式 chip）/ 右（发送/queue）；
- 模型胶囊：完整名称 title 化已有，本项根治截断（flex min-w + 渐隐 + title）。

## 5. 测试（r2 修订）

- 会话上下文：resume 查找键（target + seedSkill 匹配）命中/无匹配两态
  （同技能命中续聊 vs 新建；r3 与 §1 一致）；
  creator 会话列表前端过滤；契约面无 context.skillId 平行字段（schema 无
  此键断言）。
- seed：结构化 prompt 逐字断言（沿 transcript meta seed 既有机制）。
- 只读投影：detail 面 skills 域零写 RPC（skills.toggle 除外）、无 creator.save/delete
  ——agent 域过程（如 Chat 入口建会话）不属 skills 域写，不受此断言
  调用（源扫描断言模式）。
- proposal 链：草稿卡保存 → proposal → 审批 → 落盘 → 编辑器刷新 revision。
- 编辑器回归：现有 CreatorWorkspace 测试全量保持绿；edit/new 深链路由（含
  subview/template search 参数）断言。
