# agent-models-config — Agent 模型运行时配置标准（v1）

/**

- 用户原始需求 [2026-09-30]：「我们主打的不是价格名称等信息，而是完整的 Agent
- 运行时能力标注。注意，你将作为一个标杆，设计数据结构，将 zcode 标准作为
- agent-models-config 配置标准。」
- 正交意图：
- [1] 定义 agent-models-config v1 规范（数据模型/字段语义/覆盖语义/版本化）；
- [2] 固化 ZCode Registry → 本标准的规范导入映射（含五层规则求值与 option map
-       声明化策略）；
- [3] 附录固化 models.dev → 本标准的有损导入边界。
- 妥协声明：无。
-
- 事实基线：zai-org/ZCode @ v3.14.3（config/provider/zcode-builtin.json rev 30）；
- 源码级调查见 docs/research/2026-09-30-zcode-provider-registry.md。
  */

## 1. 定位

本标准描述「一个 Agent 如何**正确选择并调用**一个模型」所需的全部静态配置：

```text
Provider（产品 × 协议 × endpoint 的接入单元）
  └── Models（运行时能力标注 + 请求选项规约）
```

**非目标**：价格、发布日期、知识截止、开放权重、模型营销描述——这些是目录/比价
信息，不是运行时事实，本标准不承载。

本标准采纳 ZCode Registry 的语义模型为基准（见 §10 差异清单），将其改造为**可直接
消费的交换格式**：规则引擎在生成期求值完毕，消费方零解释器依赖。

## 2. 设计法则（L1–L6）

- **L1 身份法则**：Provider id = 「厂商产品 × API 协议 × endpoint」单元。同一厂商
  的 Coding Plan 与标准 API、同一服务的三种协议，各自是独立 Provider。
- **L2 能力/线协议分层法则**：字段分两类——**能力事实**（contextWindow、模态、
  toolCall、reasoning 档位表……）与**线映射事实**（tier params、paramName）。能力
  事实缺省为「未知」（undefined，绝非遗漏成 false）；线映射事实不知道就省略，
  **绝不伪造**。
- **L3 声明式法则**：所有「语义选项 → 协议参数」映射用逐档位参数表（tier → params
  对象）与参数名（paramName）表达，不引入表达式语言（ZCode 的 CEL map 经实证
  25 种形态全部可声明化，零算术）。
- **L4 数据/覆盖分离法则**：目录（catalog，生成物，整体换新）与用户覆盖
  （overlay，稀疏补丁）是两种文件；覆盖语义 = ZCode overlay 法则（§7）。
- **L5 溯源法则**：信封携带 schemaVersion（规范破坏性版本）+ revision（数据修订，
  单调递增）+ sources（逐源登记 url/上游 revision/fetchedAt/license）。溯源粒度是
  **整个文件**，不是逐条目（生成物整体换新，条目级 source 标记无意义）。
- **L6 单调发布法则**：同一 schemaVersion 内 revision 单调递增；消费方收到低
  revision 拒绝回退（对齐 ZCode `stale` 语义）。

## 3. 数据模型总览

```text
AgentModelsConfig                       ← 信封（schemaVersion/revision/sources）
 └── providers: ProviderEntry[]
      ├── id                            ← 产品×协议×endpoint 单元标识
      ├── vendor?                       ← 厂商分组（zai / bigmodel / moonshot…）
      ├── names?                        ← { "zh-CN": …, "en-US": … }（开放 locale）
      ├── logoUrl?
      ├── visibility?                   ← visible(缺省) | hidden
      ├── access                        ← api-key | plan-api-key | account
      ├── api                           ← { protocol, baseUrl, headers? }
      └── models: ModelEntry[]          ← 数组序 = 目录序
           ├── id                       ← 请求中的真实 model id
           ├── label?                   ← 显示名（可选，非主打）
           ├── enabled?                 ← 缺省 true；false = 存在但不可选
           ├── properties?              ← 能力标注（稀疏，§5）
           └── options?                 ← 请求选项规约（稀疏，§6）

AgentModelsOverlay（用户覆盖文件，可选实现）
 └── providers: [{ id, …稀疏, models: [{ id, …稀疏 }] }]
```

## 4. 规范 Schema（normative，Zod v4）

```ts
import { z } from "zod";

// ── 协议注册表（开放枚举：注册值之外允许消费方自行理解的扩展；
//    消费方遇到未知协议必须原样保留，不得重构成已知值）──
// 已注册：anthropic-messages | openai-chat-completions | openai-responses
//        | google-generative-ai | google-vertex | bedrock-converse-stream
//        | azure-openai-responses | mistral-conversations | openai-codex-responses
export const ProtocolSchema = z.string().min(1);

// ── 模态：registered keys = text|image|video|audio|pdf（input）/ text|audio（output）──
const ModalityFlagsSchema = z.record(z.string().min(1), z.boolean());

export const AccessSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("api-key"),
      apiKeyManagementUrl: z.string().url().nullable().optional(),
    })
    .strict(),
  // 订阅产品专用 key（如 Coding Plan 购买的 key；鉴权机制同 api-key，产品语义不同）
  z
    .object({
      type: z.literal("plan-api-key"),
      apiKeyManagementUrl: z.string().url().nullable().optional(),
    })
    .strict(),
  // 账号登录型（订阅会话）；entitled 是运行时事实，目录生成方必须省略
  z
    .object({
      type: z.literal("account"),
      vendor: z.string().min(1), // "zai" | "bigmodel" | …
      plan: z.string().min(1), // "individual-coding-plan" | "off-peak" | …
      entitled: z.boolean().optional(), // 仅运行时覆盖层可写
    })
    .strict(),
]);

export const ApiSchema = z
  .object({
    protocol: ProtocolSchema,
    baseUrl: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const ModelPropertiesSchema = z
  .object({
    contextWindow: z.number().int().positive().optional(),
    input: ModalityFlagsSchema.optional(), // { text, image, video, audio, pdf }
    output: ModalityFlagsSchema.optional(), // { text, audio }
    supportsToolCall: z.boolean().optional(),
    supportsJsonSchemaOutput: z.boolean().optional(), // structured output
    supportsNativeWebSearch: z.boolean().optional(),
    supportsMidConversationSystem: z.boolean().optional(), // 对话中途注入 system 的容忍性
    requiresMfjsToolSchema: z.boolean().optional(), // 工具 schema 必须走 MFJS
  })
  .strict();

export const ReasoningTierSchema = z
  .object({
    id: z.string().min(1), // "low"|"medium"|"high"|"max"|"disabled"|"enabled"|…
    label: z.string().min(1).optional(),
    // effort = 语义强度档；toggle = 开关档（disabled/enabled 类）
    kind: z.enum(["effort", "toggle"]).optional(),
    // 该档位注入的请求参数对象（线映射事实；未知则省略，绝不伪造）
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ReasoningSpecSchema = z
  .object({
    // 语义强度升序；首项 = 辅助调用可选的最低档（对齐 ZCode 语义）
    tiers: z.array(ReasoningTierSchema).min(1),
  })
  .strict();

export const MaxOutputSpecSchema = z
  .object({
    max: z.number().int().positive(), // 能力事实：输出上限
    paramName: z.string().min(1).optional(), // 线映射事实：max_tokens|max_completion_tokens|max_output_tokens…
    min: z.number().int().positive().optional(),
    step: z.number().int().positive().optional(),
    default: z.number().int().positive().optional(),
  })
  .strict();

export const ModelOptionsSchema = z
  .object({
    reasoning: ReasoningSpecSchema.optional(),
    maxOutputTokens: MaxOutputSpecSchema.optional(),
  })
  .strict();

export const ModelEntrySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    enabled: z.boolean().optional(), // 缺省 true
    properties: ModelPropertiesSchema.optional(),
    options: ModelOptionsSchema.optional(),
  })
  .strict();

export const ProviderEntrySchema = z
  .object({
    id: z.string().min(1),
    vendor: z.string().min(1).optional(),
    names: z.record(z.string().min(1), z.string().min(1)).optional(),
    logoUrl: z.string().url().optional(),
    visibility: z.enum(["visible", "hidden"]).optional(), // 缺省 visible
    access: AccessSchema,
    api: ApiSchema,
    models: z.array(ModelEntrySchema).min(1),
  })
  .strict();

export const SourceSchema = z
  .object({
    id: z.string().min(1), // zcode-registry | models-dev | manual | official-docs | …
    url: z.string().optional(),
    upstreamRevision: z.union([z.string(), z.number()]).optional(),
    fetchedAt: z.string().optional(), // ISO 8601
    license: z.string().optional(), // 如 "Apache-2.0"
  })
  .strict();

export const AgentModelsConfigSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    generatedAt: z.string().optional(),
    sources: z.array(SourceSchema).min(1),
    providers: z.array(ProviderEntrySchema).min(1),
  })
  .strict()
  // §8：provider id 全局唯一 + provider 内 model id 唯一（superRefine 拒绝重复）
  .superRefine(uniquenessRefine);

// 覆盖层属性叶子：null = 清空该能力为显式未知（目录本体不接受 null——能力只可缺省或为值）
const OverlayModelPropertiesSchema = z.strictObject({
  contextWindow: z.number().int().positive().nullable().optional(),
  input: ModalityFlagsSchema.nullable().optional(),
  output: ModalityFlagsSchema.nullable().optional(),
  supportsToolCall: z.boolean().nullable().optional(),
  supportsJsonSchemaOutput: z.boolean().nullable().optional(),
  supportsNativeWebSearch: z.boolean().nullable().optional(),
  supportsMidConversationSystem: z.boolean().nullable().optional(),
  requiresMfjsToolSchema: z.boolean().nullable().optional(),
});

const OverlayModelOptionsSchema = z.strictObject({
  reasoning: ReasoningSpecSchema.nullable().optional(),
  maxOutputTokens: MaxOutputSpecSchema.nullable().optional(),
});

// 用户覆盖文件：稀疏投影 + overlay 标记；可清空字段一律 nullable（§7 null 法则）
export const AgentModelsOverlaySchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    overlay: z.literal(true),
    providers: z
      .array(
        z
          .object({
            id: z.string().min(1),
            names: z.record(z.string().min(1), z.string().min(1)).nullable().optional(),
            api: ApiSchema.partial().nullable().optional(), // 允许只改 baseUrl（自定义端点）
            access: AccessSchema.nullable().optional(),
            models: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    enabled: z.boolean().nullable().optional(),
                    properties: OverlayModelPropertiesSchema.nullable().optional(),
                    options: OverlayModelOptionsSchema.nullable().optional(),
                    // 手动新增模型：overlay 里 model id 不在目录中 = 追加
                  })
                  .strict(),
              )
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
```

## 5. 能力标注语义（properties）

| 字段                            | 语义                                       | 缺省                       |
| ------------------------------- | ------------------------------------------ | -------------------------- |
| `contextWindow`                 | 上下文窗口 token 数                        | 未知                       |
| `input` / `output`              | 输入/输出模态旗标表                        | 未知（不得推断成全 false） |
| `supportsToolCall`              | 服务端 tool calling                        | 未知                       |
| `supportsJsonSchemaOutput`      | structured output（JSON Schema 约束输出）  | 未知                       |
| `supportsNativeWebSearch`       | 服务端原生 web search 工具                 | 未知                       |
| `supportsMidConversationSystem` | 对话中途 system 注入不报错                 | 未知                       |
| `requiresMfjsToolSchema`        | 工具 schema 必须经 MFJS 包装（互操作坑位） | 未知                       |

**unknown ≠ false**：所有能力字段缺省表示「目录未知」，消费方按自身策略处理
（回退、禁用入口或放行尝试），标准不规定。

## 6. 请求选项语义（options）

### 6.1 reasoning

```text
tiers: 按语义强度升序；首项 = 最低可用档。
kind:  "effort"（强度档）| "toggle"（disabled/enabled 开关档）；
       消费方聚合档位时应把 toggle 档与 effort 档区别对待（如 UI 补全候选）。
params: 该档注入请求体的参数对象（线映射事实）。
       省略 = 目录未知线映射（档位仍可作为 UI 候选展示）。
       合并语义 = JSON Merge Patch（RFC 7396，与 ZCode 运行时一致）：
       对象深合并、null 删除键（对齐 zcode merge-patch.ts）。
supportsReasoning ≡ tiers 非空。
```

### 6.2 maxOutputTokens

`max` 是能力事实（输出上限）；`paramName` 是线映射事实（请求参数名）。**paramName
未知时必须省略整个 paramName 而非猜测默认值**——实证反例：同为 openai 兼容协议，
Z.ai 标准线用 `max_completion_tokens`，OpenAI 用 `max_tokens`，无安全默认。

## 7. 覆盖层语义（overlay，采纳 ZCode overlay 法则）

目录与用户覆盖合并时，逐字段执行：

```text
undefined → 继承目录值
null      → 清空该字段（显式未知）
值        → 替换
```

- Provider 按 `id` 匹配；Model 按 `id` 匹配，覆盖中目录不存在的 model id = 追加。
- `api` 允许稀疏覆盖（只改 `baseUrl` 即自定义端点场景；协议不变）。
- `access.entitled` 只允许运行时覆盖层写入（订阅权益是运行时事实）。
- 目录 revision 变化时覆盖层自然叠加在新目录上（条目消失则覆盖项失效，不报错）。

## 8. 版本化与消费规则

```text
schemaVersion 不认识 → 整份拒绝（消费方策略：报错 / 视为不可用，不得部分解析）
revision 回退        → 拒绝（L6）
providers/models id 重复 → 整份拒绝（对齐 ZCode 唯一性校验）
```

## 9. ZCode Registry 导入映射（normative）

生成器从 `zcode-builtin.json`（envelope：`{schemaVersion:1, revision, config}`）
产出本标准：

```text
ZCode                                          → agent-models-config v1
─────────────────────────────────────────────────────────────────────
revision                                       → revision（直传）+ sources[].upstreamRevision
templateRules[].templateId                     → providers[].id
templateNameMap                                → names（原样 locale 键）
config.api.type                                → api.protocol（三值同名直传）
config.api.baseUrl / headers                   → api.baseUrl / headers
config.access{api-key|zhipu-coding-plan-key}   → access{api-key | plan-api-key}
（account:* providerRules）                    → access{account, vendor=accountType,
                                                  plan=mode}；entitled 省略；
                                                  visibility=hidden 的（off-peak）直传
builtinModelIds ∪ templateModelRules[].modelId → models[]（去重保序，builtin 在前）
五层规则有序叠加求值（下述）                    → 每模型 properties/options（resolved）
rule 求值 enabled === false                    → models[].enabled = false（保留条目，
                                                  是否展示由消费方决定）
logo（builtin key，仓库内图标）                → 不映射；logoUrl 由生成器从外部源补
```

**五层求值顺序**（数组序即优先级，后到覆盖先到；稀疏叠加 = §7 法则）：

```text
modelRules（modelMatch 正则，忽略大小写）
→ modelApiRules（modelMatch + apiTypeMatch）
→ providerSiteRules（modelMatch + baseUrlMatch[URL 规范化后全串正则] + apiTypeMatch?）
→ templateModelRules（templateId + modelId 精确）
→ builtinProviderModelRules（providerId + modelId 精确）
```

**option map 声明化**：ZCode `reasoningLevel.map`（Restricted CEL 字符串）在生成期
按 `values` 逐档求值 → `tiers[].params`；`maxOutputTokens.map` 求值 → `paramName`
（提取顶层参数名）。经实证 rev 30 全部 25 个 map 均为「枚举分派 / 参数名直传 /
布尔开关」形态，无算术，静态求值无损。`values ∈ {disabled, enabled}` 的档 →
`kind: "toggle"`，其余 → `kind: "effort"`。

## 10. 与 ZCode 原标准的差异（及理由）

| #   | 差异                                                   | 理由                                                                               |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | 规范形为**已求值**的 provider×model 条目，不含规则引擎 | 规则层是 ZCode 的**维护期**去重手段；交换格式不该要求消费方实现正则规则机（L3/L4） |
| 2   | CEL map DSL → 声明式 `tiers[].params` + `paramName`    | 25 map 实证零算术；参数表可检视、可校验、零解释器                                  |
| 3   | 完整性硬门 → 字段全 optional（unknown 语义）           | ZCode 丢不完整模型是为自身 runtime 安全；目录标准保留条目让消费方自决（L2）        |
| 4   | `group` 枚举（zai-family…）→ 开放 `vendor`             | 标准不绑定单一厂商家族                                                             |
| 5   | `templateNameMap` 固定双语 → 开放 locale record        | 通用性，零成本                                                                     |
| 6   | 协议 3 值封闭枚举 → 注册表 + 可扩展                    | 覆盖 DSH 等消费方 9 协议现实                                                       |
| 7   | logo 为内置 key → `logoUrl` 外部 URL                   | key 对仓外无意义；内联是消费方本地增强                                             |
| 8   | reasoning 档位无类型标注 → `kind: effort               | toggle`                                                                            | 固化消费方已验证的档位分类需求 |
| 9   | `modelOrder` 显式字段 → 数组序                         | 静态目录中二者等价，少一个字段                                                     |
| 10  | 新增 `sources[]` 溯源信封                              | ZCode 单源无需溯源；多源合成的标准必须携带                                         |

## 11. 真实示例（rev 30 求值产物，同模型跨产品分化）

同一 `GLM-5.3` 在 Z.ai 两个产品条目下的完整标注（生成器实求值输出）：

```jsonc
{
  "schemaVersion": 1,
  "revision": 30,
  "generatedAt": "2026-09-30T00:00:00Z",
  "sources": [
    {
      "id": "zcode-registry",
      "url": "https://raw.githubusercontent.com/zai-org/ZCode/main/config/provider/zcode-builtin.json",
      "upstreamRevision": 30,
      "fetchedAt": "2026-09-30T00:00:00Z",
      "license": "Apache-2.0",
    },
  ],
  "providers": [
    {
      "id": "zai-api",
      "vendor": "zai",
      "names": { "zh-CN": "Z.ai Coding Plan", "en-US": "Z.ai Coding Plan" },
      "access": { "type": "plan-api-key" },
      "api": { "protocol": "anthropic-messages", "baseUrl": "https://api.z.ai/api/anthropic" },
      "models": [
        {
          "id": "GLM-5.3",
          "enabled": true,
          "properties": {
            "contextWindow": 1000000,
            "input": { "text": true, "image": true, "video": true, "audio": false, "pdf": false },
            "output": { "text": true },
            "supportsToolCall": true,
            "supportsJsonSchemaOutput": false,
            "supportsNativeWebSearch": true,
            "supportsMidConversationSystem": true,
            "requiresMfjsToolSchema": false,
          },
          "options": {
            "reasoning": {
              "tiers": [
                {
                  "id": "low",
                  "kind": "effort",
                  "params": {
                    "thinking": { "type": "enabled" },
                    "output_config": { "effort": "low" },
                  },
                },
                {
                  "id": "high",
                  "kind": "effort",
                  "params": {
                    "thinking": { "type": "enabled" },
                    "output_config": { "effort": "high" },
                  },
                },
                {
                  "id": "max",
                  "kind": "effort",
                  "params": {
                    "thinking": { "type": "enabled" },
                    "output_config": { "effort": "max" },
                  },
                },
              ],
            },
            "maxOutputTokens": { "max": 128000, "paramName": "max_tokens" },
          },
        },
      ],
    },
    {
      "id": "zai-standard-api",
      "vendor": "zai",
      "names": { "zh-CN": "Z.ai API", "en-US": "Z.ai API" },
      "access": { "type": "api-key" },
      "api": { "protocol": "openai-chat-completions", "baseUrl": "https://api.z.ai/api/paas/v4" },
      "models": [
        {
          "id": "GLM-5.3",
          "enabled": true,
          "properties": {
            "contextWindow": 1000000,
            "input": { "text": true, "image": false, "video": false, "audio": false, "pdf": false },
            "output": { "text": true },
            "supportsToolCall": true,
            "supportsJsonSchemaOutput": false,
            "supportsNativeWebSearch": false,
            "supportsMidConversationSystem": false,
            "requiresMfjsToolSchema": false,
          },
          "options": {
            "reasoning": {
              "tiers": [
                {
                  "id": "low",
                  "kind": "effort",
                  "params": {
                    "thinking": { "type": "enabled" },
                    "enable_thinking": true,
                    "reasoning_effort": "low",
                    "reasoning": { "effort": "low" },
                  },
                },
                {
                  "id": "high",
                  "kind": "effort",
                  "params": {
                    "thinking": { "type": "enabled" },
                    "enable_thinking": true,
                    "reasoning_effort": "high",
                    "reasoning": { "effort": "high" },
                  },
                },
                {
                  "id": "max",
                  "kind": "effort",
                  "params": {
                    "thinking": { "type": "enabled" },
                    "enable_thinking": true,
                    "reasoning_effort": "max",
                    "reasoning": { "effort": "max" },
                  },
                },
              ],
            },
            "maxOutputTokens": { "max": 128000, "paramName": "max_completion_tokens" },
          },
        },
      ],
    },
  ],
}
```

对照可见 L1 身份法则的价值：**同一个模型，经不同产品/协议/endpoint，模态、web
search、mid-system 容忍性、输出参数名、reasoning 参数族全部不同**——这正是 flat
model list（models.dev 形态）无法表达的部分。

## 12. models.dev 导入映射（附录：有损，仅长尾补充用）

```text
provider key                        → providers[].id
provider.name                       → names["en-US"]
provider.api（仅 196/225 家有）      → api.baseUrl；protocol 由 npm 推断表得出
（npm: @ai-sdk/anthropic → anthropic-messages；@ai-sdk/openai-compatible →
  openai-chat-completions；@ai-sdk/openai-responses → openai-responses；
  其余 → 无法导入，跳过该 provider）
model.limit.context / limit.output  → contextWindow / maxOutputTokens.max（无 paramName）
model.modalities.input/output       → input / output
model.tool_call / structured_output → supportsToolCall / supportsJsonSchemaOutput
model.reasoning / reasoning_options → 无法产出 tiers（档位语义缺失）→ 整个 reasoning 省略
价格/日期/权重/描述                  → 不导入（非目标）
```

结论重申：models.dev 在本标准下只能充当**长尾 endpoint 清单**，无法提供主打能力
（reasoning 档位、线映射、订阅语义、多协议分化）。

## 13. 本仓消费路径（后续实现指引，非本文件范围）

1. `scripts/extract-zcode-presets.sh.ts` 演进为本标准生成器：五层求值 + option map
   静态求值 → 产出 `agent-models` 生成物（revision/sources 随行导出）。
2. `src/shared/contracts` 落地 §4 Schema（runtime-safe 边界，safeParse 收窄）。
3. `model-catalog.ts` 投影层把标准条目映射为产品 UI 契约（现有
   `ModelProviderCatalogEntry` 扩展 optional 能力字段）。
4. 具体实现以 openspec change 推进（含 zhumo 侧同步共享本标准的可行性）。
