# Tasks: agent-models-config-v1

## 1. 标准与 schema

- [x] 1.1 `src/shared/contracts/agent-models.ts`：标准 v1 Zod schema（信封/
      Provider/Model/ReasoningTier/MaxOutput/Overlay）+ 推导类型导出；标准文档
      §6.1 补 params 合并语义（JSON Merge Patch，RFC 7396）
- [x] 1.2 `scripts/lib/restricted-cel.ts`：vendor ZCode DSL 求值器
      （tokenizer/parser/evaluator 语义，Apache-2.0 署名）；可导入纯函数面

## 2. 生成器

- [x] 2.1 `scripts/extract-agent-models.sh.ts`：上游 zod 收窄（含 providerRules/
      access/headers/visibility/enabled 全字段）+ 五层规则求值（overlay 精确
      语义 + 三种匹配规则）+ CEL 逐档求值（tiers[].params + kind）+ paramName
      哨兵提取 + enabled/access/vendor/names/visibility 求值；fixture 可测
      纯函数暴露（判主执行）
- [x] 2.2 生成 `src/daemon/agent-models.generated.ts`（类型 = 标准推导；
      溯源常量 SOURCE_URL/UPSTREAM_REVISION/GENERATED_AT）；rev 30 实跑通过
- [x] 2.3 删除旧链：scripts/extract-zcode-presets.sh.ts、
      src/daemon/zcode-presets.ts、test/extract-zcode-presets.test.ts

## 3. 投影与契约

- [x] 3.1 dsh-runtime：模型条目 + optional `toolCall`/`structuredOutput`；
      catalog 响应 + 必填 `sourceRevision`（rpc-router 透传生成物
      UPSTREAM_REVISION；spec MUST）
- [x] 3.2 model-catalog.ts 重投影：标准条目 → ModelProviderCatalogEntry
      （协议名映射维持；inputTypes 由 input 旗标派生；effortTiers 剔 toggle
      档；maxOutputTokens/toolCall/structuredOutput 透传；enabled:false 与
      account 型过滤；KNOWN_PROVIDER_ORDER 置顶逻辑保留）

## 4. 验证

- [x] 4.1 test/restricted-cel.test.ts：真实 rev 30 map 形态断言（ternary
      分派/参数名直传/布尔开关/空对象）+ 非法输入拒绝
- [x] 4.2 test/extract-agent-models.test.ts：fixture 断言（五层顺序/overlay
      null 清空/enabled:false 保留/tier params 求值/paramName 恒等提取/
      account provider 映射/上游结构漂移抛错）
- [x] 4.3 test/agent-models-generated.test.ts：生成物 safeParse 标准schema +
      溯源常量存在；test/model-catalog.test.ts 重写断言
- [x] 4.4 `pnpm check`（test + typecheck + webui check + fmt）+ `pnpm build`
      全绿；无 UI 行为变化（仅数据字段扩展）
- [x] 4.5 生成物体积核查（<400KB 源码量级）与 bundle 构建通过
