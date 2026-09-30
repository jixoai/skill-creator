## MODIFIED Requirements

### Requirement: 模型 provider 目录以 agent-models-config 标准生成物为源

模型 provider 目录数据源 MUST 为 `agent-models-config` v1 标准生成物
（标准：docs/standards/agent-models-config.md；生成器
`scripts/extract-agent-models.sh.ts` 从 zai-org/ZCode 的
`config/provider/zcode-builtin.json` 五层规则求值产出
`src/daemon/agent-models.generated.ts`，信封携带 revision/sources 溯源）。
目录数据零 models.dev 依赖（models.dev 仅保留静态 logo 资产角色）。

投影到 ModelProviderCatalogEntry 的映射：协议名经 API_NAME_MAP 单点映射、
contextWindow/maxOutputTokens/toolCall/structuredOutput 直传、inputTypes 由
标准 input 旗标派生、effortTiers = reasoning tiers 剔 toggle 档（空则
supportsReasoningEffort=false）、image = input 含 image；provider 图标本仓
PROVIDER_ICONS 优先（dataURL，运行时零网络），缺失回退生成物 logoUrl
（models.dev 静态资产）/ 字母头像。产品目录 MUST 过滤 `enabled === false`
模型与 `access.type === "account"` 的 provider（订阅登录型不在 apiKey 路由
面）；标准生成物本身保留这两类条目（数据保全）。catalog RPC 响应 MUST 携带
`sourceRevision`（生成物上游 revision）。

#### Scenario: 目录来自标准生成物

- **WHEN** 打开 Settings → Model 分区
- **THEN** provider 画廊来自 agent-models.generated.ts（重跑生成器即可整体
  换新），界面零 models.dev 目录依赖，目录不含 enabled:false 模型与
  account 型 provider

#### Scenario: 能力标注完整

- **WHEN** 目录命中带完整运行时标注的模型（如 zai-api/GLM-5.3）
- **THEN** 模型条目携带 contextWindow、maxOutputTokens、inputTypes（含
  video 等）、effortTiers（剔 toggle 档）、toolCall、structuredOutput，
  且 reasoning 档位与上游 values 一致

#### Scenario: 上游结构漂移

- **WHEN** 重跑生成器且上游 zcode-builtin.json 结构不符合 zod 收窄
- **THEN** 生成器失败退出，不产出残缺生成物
