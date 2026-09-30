# Design: agent-models-config-v1

## Context

标准 v1 文档（docs/standards/agent-models-config.md）是本设计的规范源；ZCode
语义基线见调查报告 §1–§5。本设计只落「生成管道 + 消费投影」两层，不引入
ZCode runtime。

## 数据流

```text
zai-org/ZCode config/provider/zcode-builtin.json (rev 30, Apache-2.0)
   │  scripts/extract-agent-models.sh.ts（Bun，手动重跑）
   │    ├── scripts/lib/restricted-cel.ts（vendor ZCode DSL 求值器）
   │    ├── zod 收窄上游（strict schema，结构漂移即失败）
   │    ├── 五层规则求值（ZCode overlay 精确语义）
   │    ├── CEL map 逐档静态求值 → tiers[].params / paramName
   │    └── enabled/access/visibility/names 求值
   v
src/daemon/agent-models.generated.ts（标准 v1 信封 + providers[]，勿手改）
   │  src/daemon/model-catalog.ts（纯投影）
   v
ModelProviderCatalogEntry[]（+toolCall/structuredOutput；enabled:false 与
account 型过滤）→ rpc.agent.models.catalog → WebUI（不变）
```

## 关键决策

### D1 生成物形态：TS 常量（类型 = 标准 schema 推导）+ 测试期 safeParse

生成物 import contracts/agent-models 的推导类型（编译期保证）；测试
`test/agent-models-generated.test.ts` 对生成物跑标准 schema safeParse
（runtime 门）。daemon 启动零解析成本，type-safe=runtime-safe 由测试门承担
（与 zcode-presets 生成物同模式，规模升级）。

### D2 CEL vendor 边界：仅 scripts 侧

vendor 范围 = tokenizer + parser + evaluator（ZCode packages/model-option-map
的这三个文件语义，Apache-2.0，头部署名 + NOTICE 引用）。compiler 的
merge-patch/option-maps 运行时装配不需要——生成期只做「map 源 × 逐档值 →
params 对象」。vendor 产物不进 src/（daemon 不依赖 DSL）。

### D3 paramName 提取：哨兵求值 + 恒等断言

maxOutput map 以哨兵值（如 1234）求值，结果必须为「单键且值 === 哨兵」的
对象 → paramName = 该键；否则省略 paramName（标准 L2：线映射未知不伪造）。

### D4 enabled 求值与产品过滤分离

标准生成物保留 `enabled:false` 条目（数据保全，标准 §9）；产品投影
（model-catalog）过滤之——UI 只列可选模型。account 型 provider（订阅登录）
同理进生成物、不进产品目录（路由 apiKey-only 是现状约束，非标准约束）。

### D5 协议名映射维持现状

标准协议枚举 = ZCode 三值（anthropic-messages / openai-chat-completions /
openai-responses）；产品路由契约沿用自己的 `openai-completions` 命名——
投影层维持既有 API_NAME_MAP 映射（两侧命名差异是历史事实，映射点单一）。

### D6 vendor 字段推导

templateId 前缀推导（`zai-*` → zai、`bigmodel-*` → bigmodel；其余省略）；
account provider 的 vendor = `access.accountType`（标准 §9 映射，B9 修复），
group 仅作一致性校验（group 与 accountType 不一致 = 上游数据异常，拒绝）。
不维护全量厂商表。

### D7 覆盖层（overlay）schema 落地但消费后启

contracts/agent-models.ts 含 overlay schema（标准 §4 完整落地，类型面完整）；
产品消费（用户自定义 provider/model 覆盖合并）不在本变更展开。

## 风险与对策

- 上游结构漂移 → zod strict 收窄，失败优于残缺生成（沿用既有脚本哲学）
- CEL 求值器 vendor 漂移 → 测试用 rev 30 真实 25 map 形态断言；上游升级时
  生成器对未知 map 形态降级为「tiers 无 params」（L2），不阻塞生成
- 生成物体积增长（params 重复）→ 单模型 JSON 单行紧凑序列化（vp fmt 兼容），
  预估 <400KB，bundled 可接受
