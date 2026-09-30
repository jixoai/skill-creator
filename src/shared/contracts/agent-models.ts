/**
 * agent-models-config v1 —— Agent 模型运行时配置标准 schema（normative）。
 *
 * 用户原始需求 [2026-09-30]：「将 zcode 标准作为 agent-models-config 配置标准。」
 * 规范源：docs/standards/agent-models-config.md（语义唯一事实源；本文件是其
 * runtime 落地，修改必须先改标准文档）。
 *
 * 正交意图：
 *   [1] 标准 v1 目录 schema：信封（schemaVersion/revision/sources 溯源）+
 *       Provider（产品×协议×endpoint 单元）+ Model（能力标注 + 请求选项规约）。
 *   [2] 覆盖层（overlay）schema：稀疏补丁形态（标准 §7 法则；产品消费后启，
 *       类型面先落地）。
 * 妥协声明：无。
 */
import { z } from "zod";

/**
 * 协议注册表（标准 §4：开放枚举）。注册值之外允许消费方自行理解的扩展；
 * 消费方遇到未知协议必须原样保留，不得重构成已知值。
 */
export const REGISTERED_API_PROTOCOLS = [
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
  "azure-openai-responses",
  "mistral-conversations",
  "openai-codex-responses",
] as const;

export const ApiProtocolSchema = z.string().min(1);
export type ApiProtocol = z.infer<typeof ApiProtocolSchema>;

/** 模态旗标表：registered keys = input{text,image,video,audio,pdf} / output{text,audio}。 */
export const ModalityFlagsSchema = z.record(z.string().min(1), z.boolean());
export type ModalityFlags = z.infer<typeof ModalityFlagsSchema>;

export const AccessSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("api-key"),
      apiKeyManagementUrl: z.string().url().nullable().optional(),
    })
    .strict(),
  /** 订阅产品专用 key（如 Coding Plan 购买的 key；鉴权机制同 api-key，产品语义不同）。 */
  z
    .object({
      type: z.literal("plan-api-key"),
      apiKeyManagementUrl: z.string().url().nullable().optional(),
    })
    .strict(),
  /** 账号登录型（订阅会话）；entitled 是运行时事实，目录生成方必须省略。 */
  z
    .object({
      type: z.literal("account"),
      vendor: z.string().min(1),
      plan: z.string().min(1),
      entitled: z.boolean().optional(),
    })
    .strict(),
]);
export type AgentModelAccess = z.infer<typeof AccessSchema>;

export const ProviderApiSchema = z
  .object({
    protocol: ApiProtocolSchema,
    baseUrl: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type ProviderApi = z.infer<typeof ProviderApiSchema>;

export const ModelPropertiesSchema = z
  .object({
    contextWindow: z.number().int().positive().optional(),
    input: ModalityFlagsSchema.optional(),
    output: ModalityFlagsSchema.optional(),
    supportsToolCall: z.boolean().optional(),
    supportsJsonSchemaOutput: z.boolean().optional(),
    supportsNativeWebSearch: z.boolean().optional(),
    supportsMidConversationSystem: z.boolean().optional(),
    requiresMfjsToolSchema: z.boolean().optional(),
  })
  .strict();
export type AgentModelProperties = z.infer<typeof ModelPropertiesSchema>;

/**
 * reasoning 档位（标准 §6.1）：tiers 按语义强度升序；params = 该档注入请求体
 * 的参数对象（JSON Merge Patch 语义合并，null 删键），未知则省略绝不伪造。
 */
export const ReasoningTierSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    kind: z.enum(["effort", "toggle"]).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ReasoningTier = z.infer<typeof ReasoningTierSchema>;

export const ReasoningSpecSchema = z
  .object({
    tiers: z.array(ReasoningTierSchema).min(1),
  })
  .strict();
export type ReasoningSpec = z.infer<typeof ReasoningSpecSchema>;

/**
 * maxOutputTokens（标准 §6.2）：max 是能力事实；paramName 是线映射事实
 * （请求参数名），未知必须省略——同协议不同厂商参数名不同，无安全默认。
 */
export const MaxOutputSpecSchema = z
  .object({
    max: z.number().int().positive(),
    paramName: z.string().min(1).optional(),
    min: z.number().int().positive().optional(),
    step: z.number().int().positive().optional(),
    default: z.number().int().positive().optional(),
  })
  .strict();
export type MaxOutputSpec = z.infer<typeof MaxOutputSpecSchema>;

export const ModelOptionsSchema = z
  .object({
    reasoning: ReasoningSpecSchema.optional(),
    maxOutputTokens: MaxOutputSpecSchema.optional(),
  })
  .strict();
export type AgentModelOptions = z.infer<typeof ModelOptionsSchema>;

export const ModelEntrySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    properties: ModelPropertiesSchema.optional(),
    options: ModelOptionsSchema.optional(),
  })
  .strict();
export type AgentModelEntry = z.infer<typeof ModelEntrySchema>;

export const ProviderEntrySchema = z
  .object({
    id: z.string().min(1),
    vendor: z.string().min(1).optional(),
    names: z.record(z.string().min(1), z.string().min(1)).optional(),
    logoUrl: z.string().url().optional(),
    visibility: z.enum(["visible", "hidden"]).optional(),
    access: AccessSchema,
    api: ProviderApiSchema,
    models: z.array(ModelEntrySchema).min(1),
  })
  .strict();
export type AgentModelProviderEntry = z.infer<typeof ProviderEntrySchema>;

export const SourceSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().optional(),
    upstreamRevision: z.union([z.string(), z.number()]).optional(),
    fetchedAt: z.string().optional(),
    license: z.string().optional(),
  })
  .strict();
export type AgentModelsSource = z.infer<typeof SourceSchema>;

/** 标准目录信封（标准 §3/§8）。provider/model id 全局（含 provider 内）唯一。 */
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
  .superRefine((config, context) => {
    const seenProviders = new Set<string>();
    config.providers.forEach((provider, providerIndex) => {
      if (seenProviders.has(provider.id)) {
        context.addIssue({
          code: "custom",
          path: ["providers", providerIndex, "id"],
          message: `重复 provider id: ${provider.id}`,
        });
      }
      seenProviders.add(provider.id);
      const seenModels = new Set<string>();
      provider.models.forEach((model, modelIndex) => {
        if (seenModels.has(model.id)) {
          context.addIssue({
            code: "custom",
            path: ["providers", providerIndex, "models", modelIndex, "id"],
            message: `重复 model id: ${provider.id}/${model.id}`,
          });
        }
        seenModels.add(model.id);
      });
    });
  });
export type AgentModelsConfig = z.infer<typeof AgentModelsConfigSchema>;

/**
 * 覆盖层的属性叶子可空形态（标准 §7）：null = 清空该能力为显式未知；
 * 目录本体（ModelPropertiesSchema）不接受 null（能力只可缺省或为值）。
 */
const OverlayModelPropertiesSchema = z
  .object({
    contextWindow: z.number().int().positive().nullable().optional(),
    input: ModalityFlagsSchema.nullable().optional(),
    output: ModalityFlagsSchema.nullable().optional(),
    supportsToolCall: z.boolean().nullable().optional(),
    supportsJsonSchemaOutput: z.boolean().nullable().optional(),
    supportsNativeWebSearch: z.boolean().nullable().optional(),
    supportsMidConversationSystem: z.boolean().nullable().optional(),
    requiresMfjsToolSchema: z.boolean().nullable().optional(),
  })
  .strict();

const OverlayModelOptionsSchema = z
  .object({
    reasoning: ReasoningSpecSchema.nullable().optional(),
    maxOutputTokens: MaxOutputSpecSchema.nullable().optional(),
  })
  .strict();

/** 用户覆盖文件（标准 §4/§7：稀疏补丁；undefined 继承 / null 清空 / 值替换）。 */
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
            api: ProviderApiSchema.partial().nullable().optional(),
            access: AccessSchema.nullable().optional(),
            models: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    enabled: z.boolean().nullable().optional(),
                    properties: OverlayModelPropertiesSchema.nullable().optional(),
                    options: OverlayModelOptionsSchema.nullable().optional(),
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
export type AgentModelsOverlay = z.infer<typeof AgentModelsOverlaySchema>;
