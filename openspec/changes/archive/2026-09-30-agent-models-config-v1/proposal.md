# Proposal: agent-models-config-v1

## Why

Owner（2026-09-30）裁决：模型目录「主打的不是价格名称等信息，而是完整的 Agent
运行时能力标注」，以调查报告（docs/research/2026-09-30-zcode-provider-registry.md）
为基础，将 ZCode Registry 标准固化为 `agent-models-config` 配置标准
（docs/standards/agent-models-config.md，v1 已定稿），并按标准重做本仓数据管道。

现状缺口（6 字段预设提取 → 标准 v1）：

- 提取丢失运行时能力：maxOutputTokens（已求值被丢）、toolCall、
  structuredOutput、video/pdf 输入、outputFormat
- `enabled:false` 模型未被识别，混入目录（GLM-5-Turbo 实证）
- reasoning 档位只有 id 表，无逐档线映射参数（ZCode CEL map 未求值）
- 无 provenance 出口（revision/fetchedAt 只在生成物注释里）

## What Changes

- **标准 schema 落地**：`src/shared/contracts/agent-models.ts` —— 标准 v1 的
  Zod schema（信封/Provider/Model/tier/paramName/覆盖层），生成物类型源
- **生成器重做**：`scripts/extract-zcode-presets.sh.ts` 退役，新
  `scripts/extract-agent-models.sh.ts`：
  - 五层规则完整求值（modelRules → modelApiRules → providerSiteRules →
    templateModelRules → builtinProviderModelRules；ZCode overlay 精确语义：
    undefined 继承 / null 清空子对象 / 值替换；modelMatch 忽略大小写、
    apiTypeMatch 大小写敏感、baseUrl 规范化后全串匹配）
  - Restricted CEL map 静态逐档求值 → `tiers[].params`（vendor
    Apache-2.0 署名，scripts/lib/restricted-cel.ts）；maxOutput map →
    paramName（哨兵值求值 + 单键恒等校验，不确定则省略）
  - enabled 求值：`enabled === false` 保留条目并标注（标准 L2/§9）
  - access 类型映射（api-key / plan-api-key / account+plan）；account:*
    provider 按 visibility 进生成物（产品投影层再过滤 apiKey 面）
  - 生成物 `src/daemon/agent-models.generated.ts` 导出
    `agentModelsConfig`（类型 = 标准 schema 推导）+ 溯源常量
    （SOURCE_URL / UPSTREAM_REVISION / GENERATED_AT）
- **投影层重做**：`model-catalog.ts` 消费标准生成物 → 既有
  `ModelProviderCatalogEntry`（+ optional `toolCall` / `structuredOutput`）；
  enabled:false 与 account 型 provider 不进产品目录（产品路由 apiKey-only）
- **契约扩展（零破坏）**：dsh-runtime 模型条目 + optional
  `toolCall?`/`structuredOutput?`；catalog RPC 响应 + 必填 `sourceRevision`
  （spec MUST；B8 修复后非 optional）
- **测试**：CEL 求值 / 五层求值 / overlay 语义 / 投影 / 生成物 safeParse
  （生成物以标准 schema runtime 校验，type-safe = runtime-safe）

## Non-Goals

- 不接 zcode.z.ai 控制面、不做运行时远端更新（生成物整体换新，重跑脚本）
- 不回 models.dev（其结构性缺陷是 2026-09-25 换源裁决的理由；logo 静态资产
  角色维持现状）
- 不做 WebUI 新增能力徽标渲染（toolCall/structuredOutput 字段先通到契约，
  UI 展示另行变更）；不改 Settings 页面结构
- 不实现标准覆盖层（overlay 文件）的消费——schema 已定义，产品按需后启

## Impact

- 安全不变量：无新攻击面（生成物为仓内静态数据；无网络运行时依赖）
- 契约层：dsh-runtime 扩展 optional 字段；新增 contracts/agent-models.ts
- 依赖方向：scripts → (src/shared/contracts 只作类型源)；daemon 生成物 →
  shared contracts 类型；WebUI 不变
