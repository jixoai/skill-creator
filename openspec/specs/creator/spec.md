# creator Specification

## Purpose
TBD - created by archiving change creator-agent-chat. Update Purpose after archive.

## Requirements

### Requirement: Creator 首屏是 workspace 会话工作台

Creator 首屏（/w/:wsId/creator）MUST 呈现当前 workspace 的创作会话列表 +
新会话引导；会话列表过滤依据 MUST 为 summary 投影（target.workspaceId =
当前 ws 且 seedSkill 非 null），MUST NOT 调用独立的 creator 会话 RPC 或维护
平行会话 schema。技能编辑器（frontmatter/正文 + Save + Delete + change log）
MUST 保留为二级工作页（/w/:wsId/creator/edit/:providerId/:skillId），并是
全应用唯一的技能文档编辑面——skills 详情面除 skills.toggle 外 MUST NOT
携带任何 skills 域写 RPC。

#### Scenario: 会话列表按 summary 过滤

- **WHEN** 打开 /w/ws_a/creator 且存在 3 个 target=ws_a 会话（2 个带技能
  seed、1 个无 seed）与 2 个其他 ws 会话
- **THEN** 列表仅显示 2 个（ws_a 且 seedSkill 非空），其余不渲染、不请求

#### Scenario: 编辑单一真相源

- **WHEN** 渲染 skills 详情面（skills-dashboard）并执行源扫描
- **THEN** 除 skills.toggle 外无任何 skills 域写 RPC 调用；编辑/保存/删除
  动作全部为深链到 Creator 编辑页

### Requirement: 技能维度的续聊精确匹配

「Chat about this skill」入口 MUST 以 target（workspaceId/providerId）+
seedSkill=该技能 过滤候选会话：命中最近一条则续聊，无 seedSkill 匹配则
新建会话（其 seed 记录该技能引用）。MUST NOT 复用仅 target 相同但 seed
指向其他技能的会话。

#### Scenario: 同技能命中即续聊

- **WHEN** target=（ws_a, zcode）下存在 seedSkill=bash-utils 的最近会话，
  用户从 bash-utils 详情点击 Chat about this skill
- **THEN** 续聊该会话（不新建），首条消息进入既有 transcript

#### Scenario: 不续上他技能的对话

- **WHEN** target=（ws_a, zcode）下最近会话的 seedSkill=vue-helper，用户
  从 bash-utils 详情点击 Chat about this skill
- **THEN** 新建会话（seed 记录 bash-utils 引用），vue-helper 会话不被续聊
