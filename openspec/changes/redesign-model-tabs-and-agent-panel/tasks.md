# Tasks: redesign-model-tabs-and-agent-panel

## 1. 设计（fast-remix plan）

- [x] 1.1 super-thinker 产出统一蓝图：Model tabs（New-Tab 同源理念 + 自定义
      provider/图标）+ Agent 面板 IA 重设计（dsh-webui 事实对齐）。
- [x] 1.2 蓝图入 design.md；PM 按新评审纪律过发布会截图测试。

## 2. Model 配置 tabs 化

- [x] 2.1 Model 分区重构为路由 tabs：每 tab = provider 图标+名 + key 状态 +
      模型 tags 编辑 + 设为活动模型；+ New 打开统一建路由。
- [x] 2.2 New Tab 体验：预设网格（icon/名/URL 卡）→ 选中预填同一表单；空白
      Custom = 同表单纯手填；图标可替换（内置 + 自定义 svg dataURL，路由持久
      化）。
- [x] 2.3 契约扩展：DshModelRoute 增 icon（自定义覆盖）等字段 + settings 桥
      透传。

## 3. Agent 面板重设计

- [x] 3.1 IA 重排（消息/工具行/思考/任务卡/composer/附件解剖学对齐 dsh-webui
      事实），保留 markstream 气泡/审批卡等必要组件。
- [x] 3.2 差距收尾：工具参数流式、assistant 附件回显、edit-resend 语义标注。

## 4. R2 修复（codex R1 NEEDS-WORK 5.2/10 → 阻塞清偿）

- [x] 4.0a 阻塞 1：AgentToolRow todo 分支违反 kind 封闭 union（webui check 红）→
      改 args 形状驱动；编排者管道吞 exit 的假绿已纠正。
- [x] 4.0b 阻塞 6：specs/ delta 补齐（agent-surface ×3 + dsh-runtime-integration ×2）+ add-agent-settings-modes RFC2119 措辞修正 → `openspec validate --all --strict` 13/13。
- [x] 4.0c 规范裁决：PRODUCT_MODEL.md §5 拆「路由配置（唯一真源）」与「活动模型
      （会话运行时，composer 可热切）」两行；design.md §3.4 附裁决回引。
- [x] 4.0d 阻塞 2：composer model chip 下拉热切（routes 分组/current 标记/dangling
      amber/running 置灰/只写 settings.model）。
- [x] 4.0e 阻塞 3+4+5：firehose 事件、thumb 契约、工具 payload 的 Zod 运行时收窄。
- [x] 4.0f 旅程与打磨：ModelTagsInput Enter 提交 live bug（根因 =
      loadProviderPresets 的 $effect 自触发死循环致组件僵尸）、Identity 双名、
      scrollIntoView、Saved ✓、icon 重复清理（核实为 codex 误报，无重复）、
      ContextMeter 真实分母（目录真值：zai 家族 1M，204800 属 glm-4.7）、ModeRow
      标签、sweep 1.6s、diff 着色、回放附件对称 chip。

## 5. 验证（用户指定流程）

- [x] 5.1 vision 全量走查：R1 三截图 + R2 复走（B1/B2/B4/B5/ctx 行为断言；
      04 下拉 / 06 popover 截图 analyze_image 均 PASS）；探针误报经 DOM 裁决。
- [ ] 5.2 codex 打分：R1 5.2 → R2 7.3（方向1 8.1 / 治理 8.2 达标；方向2 6.8 /
      架构 5.4 / 工程 6.8 低于线）→ R3。不达标回到 §1。
- [ ] 5.3 全量门禁 + 提交。

## 6. R3 修复（codex R2 NEEDS-WORK 7.3/10 → 阻塞清偿）

- [x] 6.1 阻塞 1：firehose safeParse 全事件覆盖（六类事件 schema 按包内 d.ts
      实测契约最小化；顺带钉死 tool/result 非字符串 text、tool/call 空串 name
      两个隐性类型洞）+ 四类 malformed 测试。
- [x] 6.2 阻塞 2：reasoning 终帧 durable——projectEvent 返回有序帧数组，与
      text 同路径 append + retention trim；dispose/reload 回放等价 live 测试。
- [x] 6.3 阻塞 3：AgentToolRow 旁路 cast 收窄（content blocks/todo 摘要/
      error envelope 共享 schema + 纯函数投影）+ 8 例 malformed 测试。
- [x] 6.4 阻塞 4：WebUI 帧 payload（todo-snapshot/approval-request/
      mode-changed）safeParse（复用 AgentApprovalQuestionSchema/DshAgentMode
      枚举，零手写镜像）+ 7 例 malformed 帧测试。
- [x] 6.5 阻塞 5：composer 草稿防擦除（reset effect 拆分，一次性挂载重置）+
      「model 热切/loading 翻转/慢 RPC 后草稿保留」3 例测试。
- [x] 6.6 方向2 补完：mode chip → DropdownMenu（与 model chip 同族 + 当前项
      check）；SlashMenu 落地（注册表开放、↑↓/Enter/Esc、Esc 驳回语义）；
      AgentPanel 拆分（623→113 行容器 + AgentHeader/TranscriptView）；计划外
      修复：菜单 trigger Esc 冒泡收面板（mode+model 双 chip）。

## 7. R4 修复（codex R3 NEEDS-WORK 7.5/10 → 仅架构一致性 5.5 低于线）

- [x] 7.1 阻塞 1：schema 收紧到 dsh-session d.ts 契约——tool/call 必填非空
      callId+name；tool/result 必填 message；message 必填非空 content（空事件
      不产帧不消耗 seq，回归钉死）；turn/start 与 agent/status 补 record 门；
      `event.data as Record` / usageSnapshotOf / assistant payload spread cast
      全部清零（rg 无命中）；WebUI isToolErrorResult 与附件信封 cast → schema。
- [x] 7.2 阻塞 2：网关真实内核集成测试（用户指定的 BASE_URL/MODEL_ID；探活
      失败自动 skip）——真实 LLM 完整工具回合六分支全投影 + 零 dropped-malformed
      断言。
