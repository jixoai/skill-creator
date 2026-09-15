# Proposal: composer 收尾三件套——@ 引用芯片、队列行级操作、技能装饰 + 忙碌 Enter 设置行

## Why

composer-capability-parity 归档时记录了四项遗留，用户裁决「继续完善遗留工作。完成 1/2/3」：

1. `@` 引用芯片：官方 composer 的 `@` 触发（文件/会话引用）在产品中缺位；引用内容展开
   只能靠用户手贴，daemon 侧无契约。
2. QueueDock 行级操作：W4 的队列 dock 是只读投影；官方 updateQueue（编辑/移除/插话）
   需要「内核 inbox 项级操作」契约，已实证内核 `ReactLoopInbox` 暴露
   `nextTurn/nextStep/replace(messageId)/remove(messageId)` 原生面。
3. 技能词法装饰 + 忙碌 Enter 的 Settings 行：`/name` token 目前是纯文本无视觉身份；
   忙碌 Enter 偏好只有 `/queue //steer` 命令入口，设置面不可见。

## What Changes

### C1 —— `@` 引用芯片（rich 面适配 + daemon 展开）

- 契约：`AgentSessionPromptInputSchema` 增 `references`（≤4：file{path} |
  session{sessionId}）；strict 判别联合。
- daemon 展开（server-owned，UI 只传 opaque 引用）：`agent-files.resolvePromptReferences`
  读文本文件（绝对路径 + realpath + regular file + ≤512KiB + 文本扩展名守卫，与 path
  附件同法则；二进制 typed 拒绝并指引附件通道）；session 引用经 transcripts 帧流投影
  有界摘要（≤30 条 text 帧 / ≤24k chars）。展开为 `[reference: …]` 文本块注入内核
  content（与文件附件内联同构）；引用目标缺失 = typed NOT_FOUND 整体拒绝（不静默降级）。
- slash 命令分流不吞引用：携带 references 的 prompt 不走 commands.execute 路径。
- WebUI：
  - 芯片底座适配（官方 Lexical 芯片 → textarea 镜像绘制层）：ChipPaintLayer 在
    textarea 同度量底层渲染引用 token 的芯片底色；退格在 token 尾部整删（原子性）。
    W1–W4 全部行为（IME/undo-cut/claim/队列手势）不迁移基座。
  - ReferenceMenu（`@` 触发）：Sessions 组（排除当前会话）+ Files 组（agent.files.list
    目录钻取，目录行续览、文件行落 token `@basename`）；TriggerMenu 泛化
    （大小写不敏感前缀 + 结构性 header row）。
  - 草稿 registry（agent-composer）：引用按 token 出现序消费；提交时仅提交文中仍
    存在的 token 对应引用；发送成功随轨清理。

### C2 —— QueueDock 行级操作（内核 inbox 真相）

- 契约：`agent.queue.list`（live 会话的 next-turn/next-step 待处理项投影：
  messageId/target/text/附件计数）+ `agent.queue.update`（edit{messageId,text} |
  remove{messageId} | steer{messageId}，discriminated union；非 live / 已被消费 =
  typed NOT_FOUND，竞态可见）。
- daemon：AgentLike 增可选 `inbox` 面；edit 经 `inbox.replace`（保留非文本块——附件
  不丢）；remove 经 `inbox.remove`；steer = next-turn 移除 + next-step 追加（仅
  running；idle 无语义，typed INVALID_OPERATION）。
- WebUI：QueueDock 转内核真相驱动（发送后/帧到达/轮次边界刷新 queue.list；乐观
  outbox 保留为 prompt 在途过渡）；行操作：行内编辑（Enter 保存/Esc 取消）、移除、
  插话（steer）。

### C3 —— 技能词法装饰 + 忙碌 Enter Settings 行

- ChipPaintLayer 对 `/name `（skills store 命中的 token）渲染引用样式（官方
  TextRefNode 视觉适配；文本基座，无点击预览——记录适配）。
- Settings → Agent 增「Busy Enter」行：queue/steer 二选一（读写同一 localStorage 键
  `sc.composer.busyEnter`，单一事实源不变；设置面打开即生效，无需保存）。

## Impact

- 代码：src/shared/contracts/agent.ts、src/daemon/{agent-files,agent-sessions 调整,
  rpc-router}.ts、webui composer 组件群 + stores、settings Agent 分区。
- 规格：agent-surface（composer 面）、agent-kernel（inbox 操作面）各追加 Requirement。
- 兼容：prompt 输入增字段 default []——旧客户端不受影响；无持久化 schema 变更。
