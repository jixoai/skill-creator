# agent-kernel 变更（增量：会话 target binding 契约）

## ADDED Requirements

### Requirement: 会话 target 不可变且由 server 校验

`agent.session.create` MUST 接受可选 `target: { workspaceId, providerId? }`。
server MUST 在创建时校验：workspaceId 解析于 workspace registry、providerId
（给出时）属于该 workspace 的 provider 投影；校验失败 MUST 以 typed 错误
拒绝且不产生会话与转录 meta。target 落 transcript meta（mode/seed 同层）
后 MUST 在会话生命周期内不可变：不得存在任何变更 target 的 RPC，模式切换
的 dispose+resume 复活链 MUST 保留 target。无 target 的旧会话 MUST 保持
可读可续聊，但其 mutation 类能力调用与写入 proposal MUST 被 typed
拒绝
（无归属）；server MUST NOT 从客户端传入的 cwd 推断归属。**target 管辖
范围 = Manager mutation 域**（MCP `*_propose` 链及产品能力域写入
proposal）——每次此类写入 MUST 在执行前验证写入目标落在会话 target
允许的 workspace（target 含 providerId 时进一步限定到该 provider）内；
越权 MUST typed 拒绝且不落 proposal。target 为 Global Workspace 的会话
MUST 拒绝一切写入 proposal（只读分析用途）。内核 bash 工具**不在 target
管辖内**（受 agent-kernel 模式矩阵与专注模式 deny 管辖；按 target 收紧
bash 属模式矩阵的独立变更，见 change design §2 第 7 条）。
`AgentSessionSummarySchema` MUST 携带 `target?`（与 meta 同形直投影）与
必填 nullable 的 `seedSkill: SkillIdSchema | null`。

#### Scenario: 未知 workspace 创建即拒

- **WHEN** create 携带 registry 不认识的 target.workspaceId
- **THEN** RPC 以 typed 错误拒绝，不创建会话、不写转录 meta

#### Scenario: target 经模式切换保留

- **WHEN** 携带 target 的会话执行 setMode（dispose + revive）
- **THEN** 复活后的会话从转录 meta 读到同一 target

#### Scenario: 跨 workspace proposal 执行前拒绝

- **WHEN** 绑定 workspace A 的会话提交目标位于 workspace B 的写入 proposal
- **THEN** proposal 链在 handler 执行前 typed 拒绝，无 proposal 落库

#### Scenario: 旧会话（无 target）只读

- **WHEN** 本契约之前创建的无 target 会话调用 mutation 类能力
- **THEN** 调用被 typed 拒绝（无归属）并 audit，读取与续聊不受影响

#### Scenario: Global target 会话拒绝一切写入 proposal

- **WHEN** target 为 Global Workspace 的会话提交任意写入 proposal
- **THEN** proposal 链在执行前 typed 拒绝

#### Scenario: summary 投影携带 target 与 seedSkill

- **WHEN** 创建带 target 与技能 seed 的会话后调用 sessions list
- **THEN** summary 条目携带与 meta 同形的 target 投影与 seedSkill（无 seed
  会话为 null），UI 分组与 Creator 过滤零额外 RPC

#### Scenario: provider 不匹配的 proposal 执行前拒绝

- **WHEN** 会话 target 含 providerId=zcode，向 providerId=agents 的技能发起
  *_propose 写入
- **THEN** server 在 proposal 落库前 typed 拒绝，审计记录含会话 id 与目标
  三元组
