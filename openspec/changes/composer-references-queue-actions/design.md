# Design: composer-references-queue-actions

## C1 决策

1. **芯片底座 = textarea 镜像绘制层，不迁移 contenteditable**。W1–W4 已在 textarea 上
   固化 IME 守卫/undo-cut/claim/队列手势与 280+ 测试；官方 Lexical 芯片的原子性以
   「token 整删退格 + 底层绘制」复刻语义，基座不移植（避免全量交互回归）。绘制层与
   textarea 同字体/字号/行高/内边距/white-space，token 底色即芯片视觉。
2. **引用展开全在 daemon**（官方 host-side 注入同法）：UI 只提交
   `{kind:"file",path}|{kind:"session",sessionId}`；file 走 agent-files 既有 fs 守卫
   （绝对路径/realpath/regular/512KiB/文本扩展名——与 path 附件同一法则；二进制 typed
   INVALID_OPERATION 指引附件通道）；session 走 transcripts 帧流（user-text/assistant-text
   有界摘要）。缺失目标 = NOT_FOUND 整体拒绝。
3. **token ↔ 引用绑定 = 有序出现消费**：草稿 registry 持有序引用；绘制与提交按 token
   在文中的出现序逐一消费（同名 token 多引用按序配对）；token 被编辑掉 = 引用失效，
   提交时剪除。
4. **@ 菜单 = TriggerMenu 泛化**：前缀匹配大小写不敏感；新增结构性 header row（`..`
   上级目录行不受前缀过滤约束）。Files 组 value 为自浏览基起的完整前缀路径
   （`@Dev/GitHub/`），天然与 startsWith 过滤契合；目录行选中 = 续览（写入稿文并保
   持菜单），文件行选中 = 落 `@basename` token。Sessions 组仅在无 `/` 段时并列。
5. **user 气泡回显 = 原文 token**（与 `/name` 一致）；展开块只进模型 content，
   不改 frame 文本。

## C2 决策

1. **队列真相迁内核 inbox**：`agent.queue.list` 读 live agent 的
   `inbox.nextTurn/nextStep`（UserMessage → text 块拼接 + 附件块计数）；非 live 会话
   返回空 items（重启后未复活的挂起队列不可操作——记录为已知边界）。
2. **update 三动作**：edit=`inbox.replace`（重建 content = 新文本块 + 原非文本块，附件
   不丢）；remove=`inbox.remove`；steer=next-turn `remove` + next-step `append`（仅
   running；idle 时 typed INVALID_OPERATION）。messageId 已被消费 = NOT_FOUND（竞态
   可见，UI 刷新列表）。
3. **QueueDock 混合刷新**：乐观 outbox 保留为 prompt 在途过渡；prompt 落定、
   user-text/turn-end 帧到达、dock 展开时拉 queue.list；内核项与乐观项按文本去重
   （内核项优先）。
4. **edit 仅文本**（官方 updateQueue 编辑面同限制）；附件计数展示为行尾 chip。

## C3 决策

1. **装饰复用绘制层**：`/name ` token 命中 skillsState.skills 名称集即上引用样式
   （TextRefNode 视觉适配）；无点击预览（文本基座限制，记录）。
2. **Busy Enter 行落 Settings→Agent「Behavior」**：queue/steer segmented 读写
   `sc.composer.busyEnter`（与 /queue //steer 命令同键同源）。

## 风险与边界

- 绘制层与 textarea 庡量错位：同 Tailwind 类 + `white-space: pre-wrap` +
  `overflow-wrap: break-word` 双侧复制；仅芯片底色，不重绘文本，错位容忍度高。
- references prompt 不走 slash 命令分流（`/compact` + 引用同发 = 普通消息）。
- queue.list 的 items 与乐观 outbox 竞态：去重键 = 文本全等；重复文本多条时按序配对。
