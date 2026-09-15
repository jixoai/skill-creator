# Design: composer-capability-parity

## 官方矩阵来源

deepseek-ai/deepseek-harness tag `dsh-v0.1.6-alpha.1`（commit 0a15e36e）的
packages/client：ui-conversation（InputBar + SubmitMachine + Lexical）、
ui-input-trigger（/ 与 @ 触发管线）、ui-commands / ui-skill / ui-reference /
ui-attachment / file-upload / ui-model-selection 等座位贡献。完整能力矩阵
（含 file:line）由调研报告固化；官方**没有**的四能力（计数器/上箭头历史/
语音/引用回复）实现对齐 = 不做。

## 底座适配决策（Svelte 5 + textarea）

官方 composer 是 React 19 + Lexical contenteditable（芯片 = decorator 节点、
双投影、undo API）。本仓栈为 Svelte 5 + textarea——**能力语义对齐矩阵，底座
不移植**：

- 芯片语义的等价面：`@` 引用芯片与词法装饰需要富文本底座，延后（见下）；
  W1 的占位字符消毒已把伪造面挡在 textarea 世界之外。
- undo-cut-after-send：Lexical 有 undo API；textarea 等价 = 发送成功清轨时
  以 sendEpoch 重建元素，丢弃原生 undo 栈。
- 占位符链：官方在 Lexical 上自绘占位符并按 composing 抑制；textarea 保留
  原生占位符，composing 标记以 data 属性就绪。

## 各波落点与差异记录

- **W1**：IME 守卫判定序（isComposing → 229 → 10ms 宽限）与官方逐条对齐；
  repeat 守卫；粘贴文本消毒 + 文件分道；占位符链（disconnected 态消费
  shell connection store）。
- **W2**：官方 imageLimits 是 host 投影（服务端下发限额）；本产品限额为
  composer 模块常量（产品语义固定：4×4MiB 图 + 2×512KiB 文件）——投影位
  置不同、整批拒绝语义相同。附件传输无 receipt 协议（daemon fs 桌面面，
  路径 + base64 双通道既有）；「上传门控」适配为 base64 读入门控。
- **W3**：`/` 统一命令 + 技能（官方 roster 序 Commands → Skills）；claim 机
  就绪（matchSpace/matchEnter/前缀存活/提交剥 token）但首版目录无
  input-taking 命令——不造死 UI；`$` → `/` 迁移是破坏性对齐（官方同符）。
  `@` 引用延后：需要富文本底座 + daemon 侧引用展开契约（文件/会话引用的
  内容注入是 host 职责，UI 单侧不可交付）。
- **W4**：queue/steer 直译内核 loop 的 followup/steer（next-turn/next-step）
  ——这是 alpha 升级后原生的语义，无客户端模拟。Stop 的 queue 存活 =
  cancel keepInbox。QueueDock 行级编辑/移除/插话需要 inbox 项级操作契约
  （官方 updateQueue），延后。草稿持久化只落文本面（附件 base64 不入
  localStorage——配额与生命周期）。忙碌 Enter 偏好落 localStorage（官方为
  settings 行；产品面小，命令切换已足够，Settings 行可后补）。

## 走查与裁决记录

每波独立 vision 子代理走查：W1 双态 PASS、W2 双态 PASS、W3 双态 PASS、
W4 真网关链路实测（队列入 dock → 成为下一轮 → durable 帧退队，帧序列实证）。
W4 首轮 FAIL 的 P1（dock 行截断/碰撞）按视觉判读法则以代码事实裁决：
行使用 truncate 工具类（ellipsis + hidden + nowrap）、dock 宽度受 flex 列
约束（shrink-0），queue-dock 组件测试钉死；该读数来自竞态混沌截图（悬空
模型 chip 与 dock 分属不同行带）。P3 计数 chip 对比度为真实修复（边框 chip）。

## 延后项（后续 change 候选）

1. `@` 引用：富文本底座（contenteditable）+ daemon 引用展开契约。
2. QueueDock 行级操作：inbox 项级 RPC（edit/remove/steer）。
3. 技能词法装饰 + 点击预览（富文本面能力）。
4. 忙碌 Enter 偏好的 Settings 行（现为 /queue /steer 命令 + localStorage）。
