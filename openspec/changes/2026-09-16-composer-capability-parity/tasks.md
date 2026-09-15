# Tasks: composer-capability-parity

## W1 编辑器内核

- [ ] 1.1 富文本底座：textarea → contenteditable 芯片模型（clipboard/detect 双投影、
      占位符字符 U+E100–E11D/U+FFFC 消毒、芯片 = 原子节点 + clipboardText 投影）
- [ ] 1.2 IME 守卫：isComposing + keyCode 229 + compositionend 后 10ms 窗口 +
      data-composer-composing 占位抑制
- [ ] 1.3 键位表：Shift+Enter 无条件换行、Enter repeat 守卫、菜单仲裁优先级、
      焦点保持（工具栏 mousedown 防抢焦点）
- [ ] 1.4 撤销纪律：1000ms 合并窗、发送成功后 undo 切断、round-trip 期间纯后缀保留
- [ ] 1.5 粘贴：文本消毒插入（独立 undo 边界）+ 文件项路由附件通道
- [ ] 1.6 状态链：占位符优先级链 + aria-label + 禁用/只读矩阵
- [ ] 1.7 W1 聚焦测试 + vision 子代理走查

## W2 附件面

- [ ] 2.1 服务端限额投影（imageLimits 形状：count/size/total/media types）+
      整批拒绝 + reason-keyed 文案
- [ ] 2.2 DnD：document 级监听 + 嵌套深度计数 + 全窗覆盖层（dropEffect 光标语义）
- [ ] 2.3 发送门控：uploading/failed 拦截 + still-uploading 通知；失败卡 Retry/移除
- [ ] 2.4 纯附件发送（无文本 part）+ 失败恢复（草稿提交序还原、附件回队头）
- [ ] 2.5 W2 聚焦测试 + vision 子代理走查

## W3 触发管线

- [ ] 3.1 触发检测核心：守卫层（plain/claimed/frozen）、URL carve-outs、
      带引号路径文法
- [ ] 3.2 候选菜单：overlay 座位、分组、400px 钳制、stale 行保留、
      aria-activedescendant 列表盒、外点关闭
- [ ] 3.3 `/` 命令：claim 状态机（matchSpace 同步 / matchEnter 异步裁决）、
      popup/action/host 三类、命令目录缓存
- [ ] 3.4 `/` 技能：纯文本 `/name ` 落点 + 词法装饰（TextRef 等价）+ 点击预览；
      触发符 `$` → `/` 迁移
- [ ] 3.5 `@` 引用：文件/会话芯片、目录下钻 + 面包屑、失效芯片阻塞发送
- [ ] 3.6 `+` 编程式启动器
- [ ] 3.7 W3 聚焦测试 + vision 子代理走查

## W4 提交与会话面

- [ ] 4.1 提交状态机：attempt + AbortSignal、stale 丢弃、anti-backwash
- [ ] 4.2 queue/steer 双模 + 忙碌 Enter 持久偏好（设置面行 + composer 内切换）
- [ ] 4.3 乐观回显 + 撤退休止 + 发送失败恢复
- [ ] 4.4 QueueDock：计数头、行内编辑（纯文本）、移除、插话、发送中态
- [ ] 4.5 按会话草稿持久化 + 换轨携带（仅空编辑器时再播种）
- [ ] 4.6 停止语义：Stop 取消当前 turn、queue 存活 FIFO 续跑
- [ ] 4.7 主按钮状态矩阵（Stop/排队发送/插话发送）
- [ ] 4.8 W4 聚焦测试 + vision 子代理走查

## 收尾

- [ ] 5.1 全量电池 + typecheck + webui check + build
- [ ] 5.2 最终 vision 子代理全量表走查
- [ ] 5.3 spec 同步归档
