# ZCode Provider / Model Registry 调查报告

/**

- 用户原始需求 [2026-09-30]：「调查并接入 ZCode Provider / Model Registry……以 ZCode
- 当前 GitHub 源码为事实依据……先输出一份调查报告……与 models.dev 客观比较……最后才提出
- 实现方案。」用户补充：「参考 ../../zhumo 这个项目」。
- 正交意图：
- [1] ZCode Registry 架构取证（schema/数据/加载/合并/更新/消费，源码级）；
- [2] models.dev 数据模型取证（api.json 实测，非二手描述）；
- [3] 与当前项目（已换源 zcode-presets）+ zhumo 参考实现的对照与接入建议。
- 妥协声明：无。
  */

调查基线（全部一手取证）：

- ZCode 源码：`zai-org/ZCode` main @ `29628c9`（v3.14.3，2026-09-23），浅克隆于 `/tmp/zcode-investigate`
- ZCode 数据：`config/provider/zcode-builtin.json`，`schemaVersion:1` / `revision:30`
- models.dev：`https://models.dev/api.json` 实拉（225 providers，5.3MB）
- 当前项目：`src/daemon/zcode-presets.ts`（revision 30，2026-09-24 生成）+ `scripts/extract-zcode-presets.sh.ts`
- zhumo：`shufa-server`（本套「zcode 预设提取」方案的源头项目）

---

## 0. 先修正一个前提

任务描述假设「项目可能仍在使用 models.dev」。事实：**2026-09-25 归档 change
`settings-panel-zcode-source` 已完全放弃 models.dev**，当前数据源是
`extract-zcode-presets.sh.ts` 从 ZCode `zcode-builtin.json` 静态提取的生成物
（20 模板 / 244 模型 / revision 30），语义对齐 zhumo 同名脚本。Owner 当时裁决原文
（见 `model-catalog.ts` 文件头）：「不再依赖 models.dev……请参考 shufa-server……
我们自己这套 models.dev 已经可以完全放弃。」

因此本轮的真实命题不是「从 models.dev 迁到 ZCode」，而是：

```text
现有：ZCode registry --(提取脚本, 6 个叶子字段)--> 静态预设 --> 目录投影
问题：提取面窄（丢能力字段）/ 含 disabled 模型 / 更新纯手工 / 无 provenance
```

---

## 1. ZCode Registry 架构（实际数据流）

```text
┌─ source ─────────────────────────────────────────────────────────────┐
│ repo: config/provider/zcode-builtin.json   (bundled 基线, rev 30)     │
│ remote: GET https://zcode.z.ai/api/v1/client/configs                  │
│           ?app_version=&platform=                                     │
│         → { data.configs.builtin_provider_config_json: <CDN URL> }    │
│         → GET CDN → 同格式 release JSON                               │
│ (控制面下发 CDN URL；下载 20s 超时 / 10MB 上限 / 禁重定向 / 无凭据)     │
└───────────────────────────────────────────────────────────────────────┘
                              ↓ zod 全量收窄 (decodeZCodeBuiltinRelease)
┌─ cache (provider-node) ──────────────────────────────────────────────┐
│ Active 文件 = endpoint 域隔离缓存 + 原子物化 + 文件锁 + LKG 回退       │
│ RefreshControl 文件 = 跨进程 lease + 小时级节流 + 指数退避            │
│ (EndpointScopedZCodeBuiltinSource：endpoint 切换只换 source 不读旧缓存)│
└───────────────────────────────────────────────────────────────────────┘
                              ↓ ProviderSource.read()
┌─ merge (packages/provider/src/resolver.ts) ──────────────────────────┐
│ 四层 Overlay（稀疏配置：undefined=继承 / null=清空 / 值=替换）：       │
│   ① builtin templates (20) + account providers (8, entitlement 投影)  │
│   ② template.config 为基座 ← provider rule 覆盖                       │
│   ③ builtin providers ← personal providers 覆盖                      │
│   ④ model 五层规则有序叠加：                                          │
│      modelRules → modelApiRules → providerSiteRules                   │
│      → templateModelRules → providerModelRules(+personal 精确规则)    │
└───────────────────────────────────────────────────────────────────────┘
                              ↓ 完整性校验 (complete schema)
┌─ registry (ProviderRegistry) ────────────────────────────────────────┐
│ 冻结 view{revision, providers[]}；只发布 complete+enabled+entitled    │
│ 的 provider/model；replace() 递增 revision 并广播 onDidChange         │
└───────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ runtime (bootstrap/app) ────────────────────────────────────────────┐
│ ApiProviderModelRuntime.modelFactory(selection)                       │
│   → registry.validateSelection（provider/model/reasoningLevel 三验）  │
│   → AiSdkModelAdapter.createModel({providerConfig, modelConfig,      │
│      options.reasoningLevel})                                         │
│   → 请求期由 Restricted CEL DSL 把 reasoningLevel/maxOutputTokens      │
│      映射成协议特定参数（thinking/effort/...）                         │
└───────────────────────────────────────────────────────────────────────┘
```

要点：

- **远端热更是 ZCode 自家控制面**（`zcode.z.ai`），客户端默认每小时刷一次；
  release 单调 revision，旧 revision 到达返回 `stale`。
- bundled 文件是兜底基线：Active 缓存损坏时回退 bundled，bundled 也坏才抛错。
- 已退役 provider（`builtin:zapi`）在解码层整份拒绝，防旧 release 复活。

---

## 2. 实际文件（谁干什么）

| 文件（zai-org/ZCode）                                                          | 作用                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `config/provider/zcode-builtin.json`                                           | **数据**：全部内置 provider/template/model 规则（180KB, rev 30）              |
| `packages/shared/src/model-config.ts`                                          | **Model schema 之 zod 源**：properties/optionSpecs 完整与稀疏双形态           |
| `packages/provider/src/config/provider-data-schema.ts`                         | **Provider schema 之 zod 源**：access/api/group/logo/visibility               |
| `packages/provider/src/config/rule-data-schema.ts`                             | **规则 schema 之 zod 源**：五层模型规则 + provider/template 规则 + 唯一性校验 |
| `packages/provider/src/config/schema.ts`                                       | **解析入口**：unknown → zod parse → 领域类（8 个 parse* 函数）                |
| `packages/provider/src/config/model-config.ts`                                 | ModelConfig 领域类 + `ModelConfigRules.resolve()`（有序 overlay 求值器）      |
| `packages/provider/src/resolver.ts`                                            | **合并核心**：四层 provider overlay + 每模型规则求值 + 完整性门               |
| `packages/provider/src/registry.ts`                                            | 运行时 registry（冻结 view/索引/校验/事件）                                   |
| `packages/provider/src/registry-service.ts`                                    | 组装 config+account 两个 source → resolver → registry（代次化刷新）           |
| `packages/provider-node/src/zcode-builtin-download.ts`                         | 控制面 + CDN 下载边界                                                         |
| `packages/provider-node/src/zcode-builtin-remote-synchronizer.ts`              | 小时级刷新/lease/退避                                                         |
| `packages/provider-node/src/endpoint-scoped-zcode-builtin-source.ts`           | endpoint 域隔离的 Active/LKG source                                           |
| `packages/provider-node/src/personal-provider-config-repository.ts`            | 用户自定义 provider 落盘（`provider_config.json`）                            |
| `packages/model-option-map/src/*`                                              | **Restricted CEL DSL**：tokenizer/parser/evaluator（option map 求值）         |
| `apps/zcode-cli/packages/bootstrap/src/app/provider-registry-model-runtime.ts` | **runtime 消费**：selection 校验 → AI SDK Model 创建                          |

---

## 3. Schema（按源码整理，非重设计）

### 3.1 Provider 配置（`providerConfigDataSchema`，strict）

```text
{
  group: "standard-personal" | "zai-family" | "bigmodel-family"   // personal 只能 standard-personal
  logo: { type: "builtin", key: string }          // 内置图标键，不是 URL
  access:                                          // discriminated union
    | { type: "api-key" | "zhipu-coding-plan-api-key",
        apiKey?: string|null, apiKeyManagementUrl?: url|null }
    | { type: "zhipu-account",                     // 订阅/账号型（8 个 account:* provider）
        accountType: "zai" | "bigmodel",
        mode: "start-plan" | "individual-coding-plan" | "team-coding-plan" | "off-peak",
        entitled: boolean }
  api: { type: "anthropic-messages" | "openai-chat-completions" | "openai-responses",
         baseUrl: url, headers?: Record<string,string> }   // 单 endpoint，非数组
  builtinModelIds?: string[]      // builtin 专用
  personalModelIds?: string[]     // personal 专用
  modelOrder?: string[]           // personal 排序
  visibility?: "visible" | "hidden"
}
```

### 3.2 Template 规则（`providerTemplateConfigRuleSchema`）

```text
{ templateId, templateNameMap: { "zh-CN"?, "en-US"? },
  config: { logo?, access?(无 apiKey), api?, builtinModelIds? } }
```

**多 endpoint 表达方式**：同一厂商的每个「产品 × 协议 × endpoint」各是一个 template。
Z.ai 实证：`zai-api`（Coding Plan / anthropic-messages / api.z.ai/api/anthropic）与
`zai-standard-api`（API / openai-chat-completions / api.z.ai/api/paas/v4）是两个模板；
OpenCode 同一 baseURL 按三种协议拆三个模板。

### 3.3 Model 配置（`modelConfigDataSchema`，稀疏可叠加）

```text
{
  enabled?: boolean
  properties?: {
    requiresMfjsToolSchema?: boolean       // 工具 schema 必须走 MFJS
    contextWindow?: int
    inputFormat?:  { supportsText?/Image?/Video?/Audio?/Pdf?: boolean }
    outputFormat?: { supportsText?: boolean }
    supportsToolCall?: boolean
    supportsJsonSchemaOutput?: boolean     // structured output
    supportsNativeWebSearch?: boolean
    supportsMidConversationSystem?: boolean
  }
  optionSpecs?: {
    reasoningLevel?:  { values?: string[], map?: CEL DSL }   // 语义档位 → 协议参数
    maxOutputTokens?: { max?: int,       map?: CEL DSL }
  }
}
```

`map` 是字符串形式的受限 CEL 表达式（编译期校验），例（anthropic-messages 通用规则）：
`reasoningLevel == "disabled" ? {thinking:{type:"disabled"}} : {thinking:{type:"adaptive"}, output_config:{effort: reasoningLevel == "enabled" ? "high" : reasoningLevel}}`。

### 3.4 Model 五层规则（匹配维度从严到松，后到覆盖先到）

```text
modelRules[]              { modelMatch: regex }                         // 84 条
modelApiRules[]           { modelMatch, apiTypeMatch: regex }           // 72 条（模型×协议）
providerSiteRules[]       { modelMatch, baseUrlMatch: regex, apiTypeMatch? } // 52 条（站点级，如同模型经 OpenCode 端点时 contextWindow/模态被降级）
templateModelRules[]      { templateId, modelId }                       // 244 条（精确）
builtinProviderModelRules[] { providerId, modelId }                     // 26 条（account:* 精确）
personal: providerModelRules + manualProviderModelRules（同 provider×model 互斥）
```

匹配 = 锚定全串正则（`^(?:pattern)$`，modelMatch 忽略大小写）；baseUrl 先规范化
（host 小写/默认端口/去尾斜杠）再匹配。**这就是 model × provider × protocol ×
endpoint 特殊规则的完整表达**。

### 3.5 发布门（registry 完整性）

complete schema 要求全叶子齐备：provider 需 group+完整 access+完整 api；model 需
全部 properties+optionSpecs（求值叠加后必须收齐）。`executable = provider enabled &&
entitled && 当前账号 && 无 issue && model enabled`；`selectable = executable &&
visibility != hidden`。**求值后仍不完整的模型不进 registry**（而非带洞发布）。

---

## 4. Provider 列表（rev 30 实解析）

### 4.1 Templates（20，全部 apiKey/coding-plan-key 型）

| templateId                             | 名称(zh)             | 协议                           | baseUrl                                                  | access                    | 模型数   |
| -------------------------------------- | -------------------- | ------------------------------ | -------------------------------------------------------- | ------------------------- | -------- |
| zai-api                                | Z.ai Coding Plan     | anthropic-messages             | `https://api.z.ai/api/anthropic`                         | zhipu-coding-plan-api-key | 3        |
| zai-standard-api                       | Z.ai API             | openai-chat-completions        | `https://api.z.ai/api/paas/v4`                           | api-key                   | 24       |
| bigmodel-api                           | BigModel Coding Plan | anthropic-messages             | `https://open.bigmodel.cn/api/anthropic`                 | zhipu-coding-plan-api-key | 2        |
| bigmodel-standard-api                  | BigModel API         | openai-chat-completions        | `https://open.bigmodel.cn/api/paas/v4`                   | api-key                   | 24       |
| moonshot-kimi                          | Kimi                 | anthropic-messages             | `https://api.moonshot.cn/anthropic`                      | api-key                   | 6        |
| minimax                                | MiniMax              | anthropic-messages             | `https://api.minimaxi.com/anthropic`                     | api-key                   | 8        |
| deepseek                               | DeepSeek             | anthropic-messages             | `https://api.deepseek.com/anthropic`                     | api-key                   | 2        |
| qwen-alibaba-model-studio-cn           | 阿里云百炼（中国）   | anthropic-messages             | `https://dashscope.aliyuncs.com/apps/anthropic`          | api-key                   | 13       |
| qwen-alibaba-model-studio-intl         | 阿里云百炼（国际）   | openai-chat-completions        | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | api-key                   | 14       |
| xiaomi-mimo                            | Xiaomi MiMo          | anthropic-messages             | `https://api.xiaomimimo.com/anthropic`                   | api-key                   | 2        |
| openai                                 | OpenAI               | openai-responses               | `https://api.openai.com/v1`                              | api-key                   | 10       |
| anthropic                              | Anthropic            | anthropic-messages             | `https://api.anthropic.com/v1`                           | api-key                   | 5        |
| xai                                    | xAI                  | openai-responses               | `https://api.x.ai/v1`                                    | api-key                   | 3        |
| openrouter                             | OpenRouter           | anthropic-messages             | `https://openrouter.ai/api`                              | api-key                   | 59       |
| opencode-go-chat/-messages/-responses  | OpenCode Go          | chat/messages/responses 三协议 | `https://opencode.ai/zen/go/v1`                          | api-key                   | 15/8/2   |
| opencode-zen-chat/-messages/-responses | OpenCode Zen         | chat/messages/responses 三协议 | `https://opencode.ai/zen/v1`                             | api-key                   | 14/15/14 |

### 4.2 Account providers（8，订阅型，builtin providerRules）

`account:zai-{individual,team}-coding-plan` / `account:zai-start-plan` /
`account:zai-offpeak-idle-plan`（hidden）及其 bigmodel 镜像。全部 anthropic-messages；
coding-plan 走 `api.z.ai/api/anthropic`，start/off-peak 走 `zcode.z.ai/api/v1/...`。
entitled 由账号服务运行时投影，不入磁盘配置。

用户提到的「Z.ai 官方 Anthropic API = api.z.ai/api/anthropic」在 registry 中即
`zai-api` 模板——**ZCode registry 已准确表达；models.dev 没有表达**（见 §6）。

---

## 5. Model 数据：定义、继承、匹配、覆盖

- **定义**：模型没有独立实体表。模型清单 = provider/template 的 `builtinModelIds`/
  `personalModelIds`；富字段完全靠五层规则求值叠加出来。同一个 modelId（如
  `GLM-5.3`）在 zai-api、zai-standard-api、openrouter、opencode-* 下是各自独立的
  求值上下文，能力可以不同。
- **继承**：稀疏 config overlay（undefined 继承 / null 清空 / 值替换），数组序即
  优先级序。如 `.*` × anthropic-messages 的通用规则给所有 anthropic 协议模型注入
  reasoningLevel map，再被模型级/站点级规则收窄。
- **匹配**：regex 全串锚定；site 级先规范化 URL。modelMatch 大小写不敏感（推荐规则
  放宽），真实请求里的 model ID 不改写。
- **覆盖**：personal 精确规则（provider×model）叠加在 builtin 之后即自然覆盖；
  `manual-provider-model` 要求全叶子齐备并清空智能基线（避免 UI 把旧隐藏配置复制
  进手动规则）。
- **示例**（providerSiteRules）：`glm-5.3` 经 `opencode.ai/zen/go/v1`（openai 协议）
  时 contextWindow=1M、支持 image+pdf；同一模型在 zai-standard-api 下 inputFormat
  仅 text——**同一模型在不同 provider/协议/endpoint 下能力分化，ZCode 有意建模**。

---

## 6. 与 models.dev 的差异（实测 api.json）

### 6.1 Provider 层

| 字段/能力          | ZCode                                                 | models.dev                                                 | 差异                                                                  |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| provider 标识      | templateId / providerId（`account:*` 命名空间）       | slug key（225 家）                                         | ZCode 按产品×协议拆条；models.dev 一厂商一条                          |
| 名称               | `templateNameMap{zh-CN,en-US}`                        | `name`（单语）                                             | ZCode 有中文官方名                                                    |
| logo               | `{type:"builtin",key}`（内置图标键）                  | `models.dev/logos/<slug>.svg` CDN                          | models.dev 是现成 URL；ZCode 键对我们无意义                           |
| baseUrl            | `api.baseUrl`（必有，complete 门）                    | `api` 字段（225 家仅 196 家有）                            | models.dev 允许缺失                                                   |
| 协议表达           | `api.type` 显式三值枚举                               | **无枚举**：由 `npm`（如 `@ai-sdk/openai-compatible`）暗示 | ZCode 是运行时可消费的显式协议                                        |
| 多 endpoint/多协议 | 每 endpoint 一 template；同模型可按 apiType/site 分化 | 一 provider 单 endpoint 单协议                             | **models.dev 无法表达 zai 的 anthropic 端点**（实测仅 `api/paas/v4`） |
| 订阅/账号型 access | `zhipu-account`（4 种 mode）+ coding-plan-key         | 无（仅 `env` 变量名暗示 api-key）                          | ZCode 独有                                                            |
| apiKey 管理入口    | `apiKeyManagementUrl`                                 | 无                                                         | ZCode 独有                                                            |
| 自定义 headers     | `api.headers`                                         | 无                                                         | ZCode 独有                                                            |

### 6.2 Model 层

| 字段/能力                      | ZCode                                                      | models.dev                                                             | 差异                                            |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| model id / display name        | id；**无 display name**（UI 显示原 id）                    | id + `name` + `description`                                            | models.dev 有人类可读名                         |
| context window                 | `properties.contextWindow`                                 | `limit.context`                                                        | 等价                                            |
| max output                     | `optionSpecs.maxOutputTokens.max`                          | `limit.output`                                                         | 等价（ZCode 还带 map DSL）                      |
| 输入模态                       | `inputFormat`（text/image/video/audio/pdf）                | `modalities.input[]`（text/image/audio/video/pdf）                     | 基本等价                                        |
| 输出模态                       | `outputFormat.supportsText`（仅 text）                     | `modalities.output[]`（可含 audio 等）                                 | models.dev 表达面宽（但 agent 场景 ZCode 够用） |
| reasoning                      | `reasoningLevel{values, map}`：语义档位 + 协议参数映射     | `reasoning: bool` + `reasoning_options`（toggle / budget_tokens{min}） | ZCode 是**可执行**档位语义；models.dev 是描述性 |
| tool call                      | `supportsToolCall`                                         | `tool_call`                                                            | 等价                                            |
| structured output              | `supportsJsonSchemaOutput`                                 | `structured_output`                                                    | 等价                                            |
| web search                     | `supportsNativeWebSearch`                                  | 无                                                                     | ZCode 独有                                      |
| 中途 system / MFJS 工具约束    | `supportsMidConversationSystem` / `requiresMfjsToolSchema` | 无                                                                     | ZCode 独有（agent 运行期坑位）                  |
| **定价**                       | **无任何价格字段**                                         | `cost{input,output,cache_read,cache_write}`                            | **models.dev 独有且完整**                       |
| 知识截止 / 发布日期 / 开放权重 | 无                                                         | `knowledge` / `release_date` / `open_weights`                          | models.dev 独有                                 |
| provider×model 特化            | 五层规则（含协议/站点维度）                                | 模型记录内嵌于 provider 条目（天然 per-provider，但无协议维度）        | 见 6.3                                          |

### 6.3 Provider × Protocol × Model 三维表达

```text
需求：同一模型 M
  ├─ Provider A / OpenAI API
  ├─ Provider A / Anthropic API
  └─ Provider B / OpenAI API

ZCode：A-openai 与 A-anthropic 是两个 template（各带 api.type+baseUrl）；
  M 在两 template 各自求值（modelApiRules/apiTypeMatch + providerSiteRules/
  baseUrlMatch 精确分化）→ 完整可表达，且有真实数据
  （GLM-5.3: zai-api=1M/image… vs opencode-go=1M/image+pdf vs zai-standard=text）。

models.dev：provider 条目只有单一 `api` endpoint，协议由 npm 暗示；
  无法为同一厂商登记第二协议端点 → 该三维无法表达。
  实证缺口：zai 无 anthropic 端点、无 Coding Plan 分离（用户投诉确认）。
```

---

## 7. 数据来源可靠性

1. **ZCode registry 是谁的数据**：zai/bigmodel 家族（8 个 account provider + 4 个
   template）是**智谱自家产品的一手配置**（ZCode 是智谱官方产品，registry 由其
   团队随版本维护，rev 30 @ v3.14.3）。这部分可视为官方 source of truth。
2. **第三方厂商条目**（OpenAI/Anthropic/xAI/OpenRouter/opencode/moonshot…）是
   ZCode 团队**策展快照**，与 models.dev 同属人工维护，同样会滞后——但它有产品级
   热更管道（客户端每小时拉 CDN），不依赖社区 PR 合并。
3. **ZCode 自己推导的数据**：`requiresMfjsToolSchema`、
   `supportsMidConversationSystem`、option map DSL、`modelOrder`、hidden
   visibility——这些是 ZCode **为其自身运行时行为**维护的工程事实，不是厂商公开
   声明。对我们仍是高价值（同样会遇到这些坑），但要明白其 provenance。
4. **会过期的字段**：contextWindow/maxOutputTokens（厂商调参）、第三方模型清单
   （rev 30 的 openrouter=59 条快照）、reasoning 档位。**绝不过期的是结构性事实**：
   协议枚举、endpoint 拆分方式、订阅模式语义。
5. **结论**：ZCode registry 不是「模型百科」式的 source of truth，它是**「一个
   生产级 coding agent 为正确调用模型而维护的运行时目录」**——恰好是我们需要的
   那一类数据，而不是 models.dev 那种营销/比价目录。价格、发布日期等我们本就不
   消费。

---

## 8. 对当前项目的接入建议

### 8.1 现状盘点（对照目标数据形状）

| 目标字段                         | 现状（zcode-presets 产物）                                          | 缺口                                                                      |
| -------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| provider id/name/logo            | templateId / zh-CN 名 / PROVIDER_ICONS→models.dev CDN 回退          | logo 回退链仍有外网依赖（已有本地内联优先生效，缺口小）                   |
| api / baseURL                    | 直传（协议名已映射本仓三值）                                        | 无                                                                        |
| authentication                   | 无（产品仅 apiKey，符合裁决）                                       | coding-plan-key 与 api-key 的**标注**可补（均填 API key，但产品语义不同） |
| model id/display name            | id；无 name                                                         | 契约有 optional `name`，可补 en-US 名                                     |
| contextWindow                    | 直传                                                                | 无                                                                        |
| maxOutputTokens                  | **已求值但被丢弃**（对齐 shufa 形状）                               | 契约已有 optional 字段，白丢                                              |
| input modalities                 | 仅 text/image 二值化                                                | video/pdf/audio 被压掉                                                    |
| output modalities                | 无                                                                  | 全缺（当前产品只产 text，可延后）                                         |
| tool calling / structured output | 无                                                                  | 全缺                                                                      |
| reasoning                        | values（含开关档直传，投影时剔除）                                  | 契约 effortTiers 已覆盖；档位语义可再映射 low/medium/high                 |
| **enabled 门**                   | **未提取**——`GLM-5-Turbo`（zai-api 下 `enabled:false`）出现在目录里 | 实质缺陷                                                                  |
| provenance                       | 生成物头注释有 revision/日期，runtime 不暴露                        | 可低成本补                                                                |

### 8.2 判断

1. **是否值得引入 ZCode registry**：已经在用。问题只是提取面太窄（历史原因：刻意
   对齐 shufa 的 6 字段形状）。**不需要引入 ZCode 的运行时**（registry/resolver/
   远端同步那套是为「ZCode 自己是 agent 客户端」设计的；我们是目录+路由预设场景，
   引入即复杂度灾难）。
2. **直接复用、转换还是多源合并**：**维持「构建期转换」**（现有脚本模式）。
   不做多源合并：ZCode 20 模板已覆盖产品域（CN 五家 + OpenAI/Anthropic/xAI/
   OpenRouter/OpenCode）；zhumo 保留 models.dev 双源是为长尾追加，我们 2026-09-25
   已裁决放弃，且 models.dev 的结构性缺陷（单 endpoint/无协议枚举）正是当初放弃
   的理由，无回退价值。
3. **哪些数据以官方为最终 source of truth**：zai/bigmodel 家族以 ZCode registry
   为准（它就是官方）；第三方厂商 endpoint/模型清单任何静态目录都会滞后——
   产品的「自定义端点手填」是最终逃生门，保持现状即可。
4. **ZCode 数据适合作为什么层**：**provider 接入预设层**（endpoint/协议/订阅语义/
   模型能力标注），不是运行时依赖层。CDN 控制面（zcode.z.ai）是 ZCode 自家产品
   接口，对我们是未承诺契约，**不要在运行时依赖它**。
5. **provenance**：需要但轻量——生成物导出 `ZCODE_PRESET_REVISION` +
   `ZCODE_PRESET_FETCHED_AT` 常量（源 URL 已有），contract 加 optional
   `sourceRevision` 即可；不需要逐条 source 标记（生成物整体换新，zhumo 同日裁决
   同理）。

### 8.3 实现方案（最小增量，均落在既有管道内）

1. **`scripts/extract-zcode-presets.sh.ts` 提取面扩展**（改动核心）：
   - 求值 `enabled`：规则叠加后 `enabled === false` 的模板模型不进清单（修
     GLM-5-Turbo 缺陷；builtinModelIds 默认视为未声明 enabled，仅显式 false 剔除）。
   - 采集 `maxOutputTokens.max` → 产物字段（脚本已求值，只是没写入）。
   - 采集 `supportsToolCall` / `supportsJsonSchemaOutput` → 产物字段。
   - `inputFormat` 全量（text/image/video/pdf；audio 过滤——产品输入域不含）。
   - `name: en-US ?? zh-CN` 模型显示名（模板维度已有 zh-CN，模型 id 原样兜底）。
   - `access.type`（api-key / zhipu-coding-plan-api-key）透传，供 UI 区分
     「Coding Plan 专用 key」。
   - 生成物导出 `ZCODE_PRESET_REVISION` / `ZCODE_PRESET_FETCHED_AT`。
2. **`src/shared/contracts/dsh-runtime.ts`**：`ModelProviderCatalogEntry` 模型条目
   加 optional `maxOutputTokens`（**已有**，无需改）、`toolCall`、
   `structuredOutput`、provider 条目加 optional `accessType`、
   `sourceRevision`（顶层目录响应字段）。全部 optional，零破坏。
3. **`src/daemon/model-catalog.ts`**：投影新字段；`image` 继续由 inputTypes 推导。
4. **测试**：`test/extract-zcode-presets.test.ts` 加 fixture 断言（disabled 剔除 /
   maxOutputTokens 透传 / toolCall 透传）；`test/model-catalog.test.ts` 投影断言。
5. **明确不做**：不接 zcode.z.ai 控制面、不做运行时刷新、不回 models.dev、不引入
   ZCode 包依赖（保持 GitHub raw 单文件依赖，升级 = 重跑脚本）。
6. **可选后续**（本轮不做）：logo 全量内联进 `provider-icons.generated.ts` 断外网
   回退；`DSH_ROUTE_API_PROTOCOLS` 中 ZCode 未覆盖的 6 协议（azure/bedrock/google×2/
   mistral/codex）继续走自定义端点手填。

---

## 附：zhumo 参考定位

zhumo（`shufa-server`）是这套「zcode 预设提取」的**源头**：其
`daemon/scripts/extract-zcode-presets.mjs`（2026-09-22）先行落地，本项目 09-25 依
Owner 裁决移植并删掉 models.dev。zhumo 自身保留双源（zcode 静态策展主体恒在 +
models.dev 手动刷新缓存追加长尾，SQLite settings 表缓存）；本项目由于产品域更聚焦
（coding agent 技能管家），单 zcode 源 + 自定义端点即可，无需跟随双源。
