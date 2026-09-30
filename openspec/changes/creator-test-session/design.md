# Design: creator-test-session（契约体 = 工作计划 r3 §A + r4 补遗 A′）

## A′ wire 级补遗（r4；冲突处以本节为准；r4-codex 勘误已并入）

- **A′1 registry 唯一写者（字段分工精确化）**：`addComposerReference(input:
  ComposerReferenceInput)` 只内部生成 `uid`；**token/target/label/skill 由调用方
  构造**（ComposerReference = Input + uid）。seed 入口构造
  `{kind:"skill", token:"$"+name, target:skillId, label:name, skill:三元组}`
  后交给 registry——不自造并行 registry、不生成第二套 uid。CreatorTestSeed 的
  `references` 即该 Input 形状（非完整 ComposerReference）。
- **A′2 占位符统一 `${skillName}`**；替换示例：name=`code-review` → 正文首行
  「请阅读引用的技能文档（code-review 芯片）。」芯片来自 references 通道，
  不来自文本解析。
- **A′3 revision + 透传**：`CreatorTestSeed.revision: "sha256:…"`（creator.load
  同源）；`SessionTranscriptMeta` 增可选 `testRun` 块；`agent.session.create`
  契约增可选 `metadata` 输入（破坏性，无兼容）；seed 存 pending testRun meta，
  首次 prompt 触发 createAgentSession 时透传写 transcript。
- **A′4 分流**：`seedComposerPrompt(text)`（通用；startAgentAction/
  WorkspacesHome 行为不变）与 `seedAgentTestRun(seed)`（模板+引用+元数据）
  两入口；普通行动永不标 test-run。

## A1 CreatorTestSeed（冻结，含 A′3 revision；r4-codex 勘误：references 为 Input 形状）

```ts
interface CreatorTestSeed {
  text: string;                       // 探针模板正文（占位符已替换；用户可编辑）
  references: ComposerReferenceInput[]; // 恰 1 条 kind:"skill"（token/target/label/
                                        // skill 由 seed 构造；uid 由 registry 生成）
  templateId: "probe-recall-v1";
  templateVersion: 1;
  revision: string;                   // sha256:…（creator.load 同源）
}
```

## A2 入口（冻结，A′4 分流后）

`seedAgentTestRun(seed)`：写文本 + 经 addComposerReference 注册芯片 + 存
pending testRun 元数据 + 开面板 + 不自动发送。`seedComposerPrompt(text)`：通用
预填（无模板/引用/元数据）。startAgentAction 字符串路径委托 seedComposerPrompt。

## A3 探针模板协议（冻结，A′2 语法）

```text
templateId: probe-recall-v1  version: 1
正文（逐字；占位符 ${skillName}；渲染输出含 `$name` token——芯片配对按文中
token 匹配，正文必须携带 `$` 前缀，r4 实现轮测试实证）：
  请阅读引用的技能文档（$${skillName} 芯片）。然后：
  1. 复述该技能的触发条件与适用场景；
  2. 列出它声明提供的工具与参考文件；
  3. 给出一个你会使用它的典型任务示例。
替换示例：name="code-review" → 「请阅读引用的技能文档（$code-review 芯片）。…」
替换：纯文本；编辑：用户改最终 prompt，模板版本仍落档；自动发送：false。
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
