# Tasks: composer-capability-parity

## W1 编辑器内核

- [x] 1.1 IME 守卫：isComposing + keyCode 229 + compositionend 后 10ms 窗口 +
      composing 占位抑制标记（textarea 适配：占位符本身保留，data 属性就绪）
- [x] 1.2 键位表：Shift+Enter 无条件换行（既有）、Enter repeat 守卫、菜单仲裁
      优先级（SlashMenu 先占）
- [x] 1.3 撤销纪律：发送成功清轨 → sendEpoch 重建 textarea 丢弃原生 undo 栈
      （Cmd+Z 不复活已发送内容；失败保留草稿与 undo）
- [x] 1.4 粘贴：芯片占位字符消毒（U+E100–E11D/U+FFFC，检测无状态化）+
      文件项统一路由双通道
- [x] 1.5 状态链：占位符优先级链（owner > disconnected > unavailable > mode >
      default）+ aria 语义保留
- [x] 1.6 W1 聚焦测试（composer-keymap 11 用例）+ vision 走查（双态 PASS）

## W2 附件面

- [x] 2.1 整批预检 + 限额常量化（IMAGE/DOC_INTAKE_LIMITS；tooMany/
      fileTooLarge/unsupportedType 整批拒绝，reason-keyed 单通知，零项入场）
- [x] 2.2 DnD：document 级监听 + 嵌套深度计数 + 全窗覆盖层（copy dropEffect）
- [x] 2.3 发送门控：attachmentReads 读入计数拦提交（still-reading 通知）；
      双通道无 upload 态（daemon fs 适配——receipt 协议不引入，design 记录）
- [x] 2.4 纯附件发送（既有）+ 失败恢复（R17-A 既有；附件回队头为 receipt 协议
      语义，本面 N/A）
- [x] 2.5 W2 聚焦测试（composer-attachments 7 用例）+ vision 走查（覆盖层 +
      落点双态 PASS）

## W3 触发管线

- [x] 3.1 触发检测核心：URL carve-outs（`//` 与触发位 `://`）+ claim 压制
      （composer-trigger.ts 纯函数）
- [x] 3.2 候选菜单：TriggerMenu 组头（roster 序）+ forcedOpen（`+` 启动器）+
      suppress 输入
- [x] 3.3 `/` 命令：claim 状态机（matchSpace/matchEnter 同步投影、前缀存活、
      提交剥 token）——首版目录无 input-taking 命令，机器就绪并单测钉死；
      客户端命令通道（/queue /steer）
- [x] 3.4 `/` 技能：`$` → `/` 迁移（SkillMenu 退役，统一菜单两组候选）；
      纯文本 `/name ` 落点（官方同法）；词法装饰为富文本面能力，textarea
      适配不做（design 记录）
- [x] 3.5 `@` 引用：**延后**——芯片需要富文本底座 + daemon 侧引用展开契约
      （非 UI 单侧可交付）；占位字符消毒（W1）已挡伪造面
- [x] 3.6 `+` 编程式启动器（无 query 全量展开；再点切换；Tab 选中）
- [x] 3.7 W3 聚焦测试（composer-trigger 10 + slash-menu 7）+ vision 走查
      （敲 `/` 与 `+` 双态 PASS）

## W4 提交与会话面

- [x] 4.1 提交模式契约：prompt.mode（queue/steer）→ 内核 followup/steer
      （原生 next-turn/next-step）
- [x] 4.2 queue/steer 双模 + 忙碌 Enter 持久偏好（localStorage；/queue /steer
      切换；Cmd/Ctrl+Enter 取反）
- [x] 4.3 乐观回显 + 撤退休止（既有 pendingUserEcho）+ 失败退队
- [x] 4.4 QueueDock：计数头 + 折叠 + 行投影（durable 帧到达退队；会话切换
      重置）；行级编辑/移除/插话待内核 inbox 项级操作契约（延后，design 记录）
- [x] 4.5 按会话草稿持久化（文本面 localStorage；迁移随所有权转移——已发草稿
      不复活）+ 换轨携带（既有内存轨 + 持久层）
- [x] 4.6 停止语义：cancel keepInbox——queue 存活 FIFO 续跑（官方 Stop 语义）
- [x] 4.7 主按钮状态矩阵（stop/send/queue/steer 四态 + 标签命名解析模式）
- [x] 4.8 W4 聚焦测试（submission 7 + queue-dock 4）+ 走查：真网关竞态窗实测
      队列全链（入 dock → 下一轮 → 退队）；几何 P1 经代码事实裁决（truncate
      工具类 + 宽度受限，组件测试钉死）；P3 计数 chip 对比度实修

## 收尾

- [x] 5.1 全量电池 880 + typecheck + webui check（30 文件/284）+ build + dist
      冒烟（CI 双 job 绿）
- [x] 5.2 vision 走查覆盖：W1 双态/W2 双态/W3 双态/W4 实链 + 裁决（每波独立）
- [x] 5.3 spec 同步归档（延后项在 design 记录：@ 引用芯片、dock 行级操作、
      词法装饰）
