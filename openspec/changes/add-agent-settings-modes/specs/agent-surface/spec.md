# agent-surface 变更

## ADDED Requirements

### Requirement: agent settings panel edits model configuration and credentials

设置面板 MUST 以分区表单承载模型配置：provider、model、可选 reasoningEffort 构成
ModelSelection 形状；provider 凭据为只写输入（存/清），视图永不回显凭据值，只回
configured 状态。全部写入经 `agent.settings.update` / `agent.credentials.*` RPC，
服务端 revision 与跨字段校验（live preset ↔ 凭据）裁决冲突。

#### Scenario: 编辑模型并保存

- **WHEN** 用户修改 provider/model/effort 并保存
- **THEN** `agent.settings.update` 收到 model 补丁；成功后视图刷新为新 revision
- **AND** live preset 下切换到无凭据 provider 返回 `MODEL_PROVIDER_WITHOUT_CREDENTIAL`
  typed rejection，面板显示 code，不落任何写

#### Scenario: 写入与清除凭据

- **WHEN** 用户在 provider 行输入 API key 保存，随后清除
- **THEN** key 经 `agent.credentials.set` 落 0600 私有存储；重载视图只显示
  configured 徽章；清除后徽章消失，凭据值任何时刻不出现在响应里

### Requirement: agent panel exposes four switchable modes

面板 MUST 提供 create/manage/explore/free 四种模式：设置面选择新会话默认模式；面板 header
的模式 chip 切换当前会话模式；`mode-changed` 帧以分隔行渲染。free 模式在 UI 上明示
token 成本更高。

#### Scenario: 新会话继承默认模式

- **WHEN** settings.defaultMode = manage 且用户新建会话
- **THEN** 会话摘要的 mode 为 manage，内核 setup 注入 manage 专有 prompt section

#### Scenario: 会话内切换模式

- **WHEN** 会话 idle 且用户把模式从 create 切到 explore
- **THEN** `agent.session.setMode` 持久化 mode、当前 live 句柄被释放、对话流出现
  `mode-changed` 分隔行；下一次 prompt 以 explore 模式复活（历史保留）

#### Scenario: 运行中拒绝切换

- **WHEN** 会话 status = running 且用户尝试切换模式
- **THEN** 返回 typed rejection，模式不变，UI 提示稍后重试
