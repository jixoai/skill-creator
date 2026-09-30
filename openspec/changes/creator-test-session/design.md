# Design: creator-test-session（契约体 = 工作计划 r3 §冻结契约 A）

## A1 CreatorTestSeed（冻结）

```ts
interface CreatorTestSeed {
  text: string;                       // 探针模板正文（占位符已替换；用户可编辑）
  references: ComposerReference[];    // 恰 1 条 kind:"skill" 完整三元组
  templateId: "probe-recall-v1";
  templateVersion: 1;
}
```

## A2 统一 seed 入口（冻结）

`seedAgentTestRun(seed)` 是唯一同时写「文本 + ComposerReference + 模板元数据」
的入口；startAgentAction（agent.svelte.ts:366）与 AgentPanel 预填
（AgentPanel.svelte:61）改走它。行为：写文本、注册芯片、开面板、不自动发送。
new 模式（无稳定 skillId）：Test tab 空态 + 保存引导，禁止临时 id。

## A3 探针模板协议（冻结，可复现）

```text
templateId: probe-recall-v1  version: 1
正文（逐字）：
  请阅读引用的技能文档（${skillName} 芯片）。然后：
  1. 复述该技能的触发条件与适用场景；
  2. 列出它声明提供的工具与参考文件；
  3. 给出一个你会使用它的典型任务示例。
占位符：{skillName}；替换：纯文本；编辑：用户改最终 prompt，模板版本仍落档；
自动发送：false。
```

## A4 test-run 元数据（冻结）

transcripts meta 可选块：
`{ kind:"test-run", workspaceId, providerId, skillId, revision:"sha256:…",
templateId, templateVersion }`；revision 取 creator.load 的文档 revision（同源）。

## A5 测试矩阵（冻结）

1. store 断言 `agent.session.prompt` 的 `references[0]` 为完整三元组（非裸文本）。
2. 发送失败：错误入 error 面，seed 芯片与草稿保留可重试。
3. 切换会话：seed 落到目标会话轨，不串轨。
4. 断线重连：草稿 + 芯片经 draft 持久化恢复。
5. 真实 daemon 集成：展开块/帧流/落盘/重启回放。

## 边界

只证明会话链路，不证明技能质量；质量判定、断言与五态结果归 evaluation-corpus。
