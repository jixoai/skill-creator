/**
 * agent-models-config v1 生成物（生成文件，勿手改）——由 scripts/extract-agent-models.sh.ts
 * 从 zai-org/ZCode 的 zcode-builtin.json 五层规则求值产出（标准
 * docs/standards/agent-models-config.md；替换旧 zcode-presets 6 字段提取）。
 * 重跑：bun scripts/extract-agent-models.sh.ts [本地 json 路径]（缺省拉 GitHub raw
 * main）；生成后执行 pnpm exec vp fmt --write src/daemon/agent-models.generated.ts。
 * 上游 Apache-2.0；canonical 数据源：https://raw.githubusercontent.com/zai-org/ZCode/main/config/provider/zcode-builtin.json
 * 上游 revision 30；28 provider / 262 模型；生成于 2026-09-30。
 * 语义备注：enabled:false 条目保留（产品投影层过滤）；account:* 订阅型 provider 在列
 * （产品 apiKey 路由面过滤，entitled 是运行时事实不落盘）；reasoning tiers[].params =
 * CEL map 逐档静态求值（求值失败的档省略 params）；paramName 哨兵恒等提取（不确定则
 * 省略）；logoUrl 为 models.dev 静态 logo 资产（图标回退序：本仓 PROVIDER_ICONS →
 * logoUrl → 字母头像）。
 */

import type { AgentModelsConfig } from "../shared/contracts/agent-models.js";

export const AGENT_MODELS_SOURCE_URL =
  "https://raw.githubusercontent.com/zai-org/ZCode/main/config/provider/zcode-builtin.json";

export const AGENT_MODELS_UPSTREAM_REVISION = 30;

export const AGENT_MODELS_GENERATED_AT = "2026-09-30";

export const agentModelsConfig: AgentModelsConfig = {
  schemaVersion: 1,
  revision: 30,
  generatedAt: "2026-09-30T10:52:24.831Z",
  sources: [
    {
      id: "zcode-registry",
      url: "https://raw.githubusercontent.com/zai-org/ZCode/main/config/provider/zcode-builtin.json",
      upstreamRevision: 30,
      fetchedAt: "2026-09-30T10:52:24.831Z",
      license: "Apache-2.0",
    },
    {
      id: "models-dev",
      url: "https://models.dev/logos/",
    },
  ],
  providers: [
    {
      id: "zai-api",
      vendor: "zai",
      names: {
        "zh-CN": "Z.ai Coding Plan",
        "en-US": "Z.ai Coding Plan",
      },
      logoUrl: "https://models.dev/logos/zai.svg",
      access: {
        type: "plan-api-key",
        apiKeyManagementUrl: "https://z.ai/manage-apikey/apikey-list",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.z.ai/api/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5-Turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "zai-standard-api",
      vendor: "zai",
      names: {
        "zh-CN": "Z.ai API",
        "en-US": "Z.ai API",
      },
      logoUrl: "https://models.dev/logos/zai.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://z.ai/manage-apikey/apikey-list",
      },
      api: {
        protocol: "openai-chat-completions",
        baseUrl: "https://api.z.ai/api/paas/v4",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "low",
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "max",
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "low",
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "max",
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5V-Turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5.1",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5.1-Highspeed",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5-Turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.7",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.7-FlashX",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.7-Flash",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.5-Air",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.5",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6V",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6V-Flash",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6V-FlashX",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.1V-Thinking-FlashX",
          enabled: false,
          properties: {
            contextWindow: 65536,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.1V-Thinking-Flash",
          enabled: false,
          properties: {
            contextWindow: 65536,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4-FlashX-250414",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 16384,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4-Flash-250414",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 16384,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4V-Flash",
          enabled: false,
          properties: {
            contextWindow: 16384,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 1024,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "codegeex-4",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "charglm-4",
          enabled: false,
          properties: {
            contextWindow: 8192,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 4096,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "emohaa",
          enabled: false,
          properties: {
            contextWindow: 8192,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 4096,
              paramName: "max_completion_tokens",
            },
          },
        },
      ],
    },
    {
      id: "bigmodel-api",
      vendor: "bigmodel",
      names: {
        "zh-CN": "BigModel Coding Plan",
        "en-US": "BigModel Coding Plan",
      },
      logoUrl: "https://models.dev/logos/zhipuai.svg",
      access: {
        type: "plan-api-key",
        apiKeyManagementUrl: "https://bigmodel.cn/coding-plan/personal/overview",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5-Turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "bigmodel-standard-api",
      vendor: "bigmodel",
      names: {
        "zh-CN": "BigModel API",
        "en-US": "BigModel API",
      },
      logoUrl: "https://models.dev/logos/zhipuai.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
      },
      api: {
        protocol: "openai-chat-completions",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "low",
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "max",
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "low",
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "max",
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5V-Turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5.1",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5.1-Highspeed",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-5-Turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.7",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.7-FlashX",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.7-Flash",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.5-Air",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.5",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6V",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6V-Flash",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.6V-FlashX",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.1V-Thinking-FlashX",
          enabled: false,
          properties: {
            contextWindow: 65536,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4.1V-Thinking-Flash",
          enabled: false,
          properties: {
            contextWindow: 65536,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4-FlashX-250414",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 16384,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4-Flash-250414",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 16384,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "GLM-4V-Flash",
          enabled: false,
          properties: {
            contextWindow: 16384,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 1024,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "codegeex-4",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "charglm-4",
          enabled: false,
          properties: {
            contextWindow: 8192,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 4096,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "emohaa",
          enabled: false,
          properties: {
            contextWindow: 8192,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 4096,
              paramName: "max_completion_tokens",
            },
          },
        },
      ],
    },
    {
      id: "moonshot-kimi",
      names: {
        "zh-CN": "Kimi",
        "en-US": "Kimi",
      },
      logoUrl: "https://models.dev/logos/moonshotai.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://platform.kimi.com/console/api-keys",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.moonshot.cn/anthropic",
      },
      models: [
        {
          id: "kimi-k3",
          properties: {
            contextWindow: 1048576,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: true,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "kimi-k2.7-code",
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "kimi-k2.6",
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "kimi-k2.7-code-highspeed",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "k3",
          enabled: false,
          properties: {
            contextWindow: 1048576,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: true,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "k3-256k",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: true,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "minimax",
      names: {
        "zh-CN": "MiniMax",
        "en-US": "MiniMax",
      },
      logoUrl: "https://models.dev/logos/minimax.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://platform.minimaxi.com/console/access?tab=api-keys",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.minimaxi.com/anthropic",
      },
      models: [
        {
          id: "MiniMax-M3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "MiniMax-M2.7",
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "MiniMax-M2.7-highspeed",
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "MiniMax-M2.5",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "MiniMax-M2.5-highspeed",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "MiniMax-M2.1",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "MiniMax-M2.1-highspeed",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "MiniMax-M2",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "deepseek",
      names: {
        "zh-CN": "DeepSeek",
        "en-US": "DeepSeek",
      },
      logoUrl: "https://models.dev/logos/deepseek.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://platform.deepseek.com/api_keys",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.deepseek.com/anthropic",
      },
      models: [
        {
          id: "deepseek-flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek-v4-pro",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "qwen-alibaba-model-studio-cn",
      names: {
        "zh-CN": "阿里云百炼（中国）",
        "en-US": "Alibaba Cloud (China)",
      },
      logoUrl: "https://models.dev/logos/alibaba-cn.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://bailian.console.aliyun.com/cn-beijing?tab=model",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      },
      models: [
        {
          id: "qwen3.8-max",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.8-flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.7-max",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.7-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.7-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.6-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.6-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.5-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.5-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3-max",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3-vl-plus",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "qwen-alibaba-model-studio-intl",
      names: {
        "zh-CN": "阿里云百炼（国际）",
        "en-US": "Alibaba Cloud (Global)",
      },
      logoUrl: "https://models.dev/logos/alibaba.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://modelstudio.console.aliyun.com/ap-southeast-1?tab=dashboard",
      },
      api: {
        protocol: "openai-chat-completions",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      },
      models: [
        {
          id: "qwen3.8-max",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning_effort: "medium",
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning_effort: "xhigh",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.8-flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning_effort: "medium",
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning_effort: "xhigh",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.8-omni-flash",
          enabled: false,
          properties: {
            contextWindow: 65536,
            input: {
              text: true,
              image: true,
              video: true,
              audio: true,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning_effort: "none",
                  },
                },
                {
                  id: "minimal",
                  kind: "effort",
                  params: {
                    reasoning_effort: "minimal",
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning_effort: "medium",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning_effort: "xhigh",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 16384,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.7-max",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.7-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.7-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.6-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.6-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.5-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3.5-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3-max",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "qwen3-vl-plus",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: false,
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    enable_thinking: true,
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_completion_tokens",
            },
          },
        },
      ],
    },
    {
      id: "xiaomi-mimo",
      names: {
        "zh-CN": "Xiaomi MiMo",
        "en-US": "Xiaomi MiMo",
      },
      logoUrl: "https://models.dev/logos/xiaomi.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://platform.xiaomimimo.com/",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.xiaomimimo.com/anthropic",
      },
      models: [
        {
          id: "mimo-v2.5-pro",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "mimo-v2.5",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: true,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "openai",
      names: {
        "zh-CN": "OpenAI",
        "en-US": "OpenAI",
      },
      logoUrl: "https://models.dev/logos/openai.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://platform.openai.com/api-keys",
      },
      api: {
        protocol: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
      },
      models: [
        {
          id: "gpt-6-astra",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.6-sol",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.6-terra",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.6-luna",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.6",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4-pro",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4-mini",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4-nano",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.3-codex",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
      ],
    },
    {
      id: "anthropic",
      names: {
        "zh-CN": "Anthropic",
        "en-US": "Anthropic",
      },
      logoUrl: "https://models.dev/logos/anthropic.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://console.anthropic.com/settings/keys",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.anthropic.com/v1",
      },
      models: [
        {
          id: "claude-fable-5-1",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-fable-5",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-opus-5",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-sonnet-5",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-haiku-4-5-20251001",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "xai",
      names: {
        "zh-CN": "xAI",
        "en-US": "xAI",
      },
      logoUrl: "https://models.dev/logos/xai.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://console.x.ai",
      },
      api: {
        protocol: "openai-responses",
        baseUrl: "https://api.x.ai/v1",
      },
      models: [
        {
          id: "grok-4.6",
          properties: {
            contextWindow: 500000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "grok-build-0.1",
          properties: {
            contextWindow: 256000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "grok-4.3",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
      ],
    },
    {
      id: "openrouter",
      names: {
        "zh-CN": "OpenRouter",
        "en-US": "OpenRouter",
      },
      logoUrl: "https://models.dev/logos/openrouter.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://openrouter.ai/keys",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://openrouter.ai/api",
      },
      models: [
        {
          id: "anthropic/claude-fable-5.1",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-6-astra",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.6-sol",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-opus-5",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek/deepseek-v4-pro",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "moonshotai/kimi-k3",
          properties: {
            contextWindow: 1048576,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.8-max",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "minimax/minimax-m3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "xiaomi/mimo-v2.5-pro",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "x-ai/grok-4.6",
          properties: {
            contextWindow: 500000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek/deepseek-v4.1-flash",
          enabled: false,
          properties: {
            contextWindow: 1048576,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.8-max-0902",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "minimal",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "minimal",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.6-terra",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.6-luna",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.6",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.4",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.4-pro",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.4-mini",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.4-nano",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "openai/gpt-5.3-codex",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-sonnet-5",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-haiku-4.5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-opus-4.8",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-opus-4.7",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-opus-4.6",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-opus-4.5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-sonnet-4.6",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "anthropic/claude-sonnet-4.5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek/deepseek-v4-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "moonshotai/kimi-k2.7-code",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "moonshotai/kimi-k2.6",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "moonshotai/kimi-k2.5",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-5.3-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-5.2",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-5.1",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-5v-turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-5-turbo",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-4.7",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-4.7-flash",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-4.6",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-4.6v",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-4.5-air",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "z-ai/glm-4.5",
          enabled: false,
          properties: {
            contextWindow: 131072,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 98304,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.8-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.7-max",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.7-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.7-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.6-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.6-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3.5-plus-20260420",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3-vl-plus",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen/qwen3-vl-flash",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "minimax/minimax-m2.7",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "minimax/minimax-m2.5",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "xiaomi/mimo-v2.5",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: true,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "x-ai/grok-build-0.1",
          enabled: false,
          properties: {
            contextWindow: 256000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "x-ai/grok-4.3",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "opencode-go-chat",
      names: {
        "zh-CN": "OpenCode Go (Chat)",
        "en-US": "OpenCode Go (Chat)",
      },
      logoUrl: "https://models.dev/logos/opencode-go.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://opencode.ai/auth",
      },
      api: {
        protocol: "openai-chat-completions",
        baseUrl: "https://opencode.ai/zen/go/v1",
      },
      models: [
        {
          id: "glm-5.3-flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "glm-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "kimi-k3",
          properties: {
            contextWindow: 1048576,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "kimi-k2.7-code",
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {},
                },
              ],
            },
            maxOutputTokens: {
              max: 262144,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek-v4.1-flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek-v4-pro",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "mimo-v2.5",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: true,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {},
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "mimo-v2.5-pro",
          properties: {
            contextWindow: 1048576,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {},
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "glm-5.2",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "glm-5.1",
          enabled: false,
          properties: {
            contextWindow: 202752,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {},
                },
              ],
            },
            maxOutputTokens: {
              max: 32768,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "kimi-k2.6",
          enabled: false,
          properties: {
            contextWindow: 262144,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {},
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek-v4-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "deepseek-v4-flash-vision-exp",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "hy4-preview",
          enabled: false,
          properties: {
            contextWindow: 1024000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning_effort: "none",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "hy3",
          enabled: false,
          properties: {
            contextWindow: 256000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning_effort: "none",
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "opencode-go-messages",
      names: {
        "zh-CN": "OpenCode Go (Anthropic)",
        "en-US": "OpenCode Go (Anthropic)",
      },
      logoUrl: "https://models.dev/logos/opencode-go.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://opencode.ai/auth",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://opencode.ai/zen/go/v1",
      },
      models: [
        {
          id: "minimax-m3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.8-max",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.8-flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "minimax-m2.7",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {},
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "minimax-m2.5",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {},
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.7-max",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.7-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.6-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "opencode-go-responses",
      names: {
        "zh-CN": "OpenCode Go (Responses)",
        "en-US": "OpenCode Go (Responses)",
      },
      logoUrl: "https://models.dev/logos/opencode-go.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://opencode.ai/auth",
      },
      api: {
        protocol: "openai-responses",
        baseUrl: "https://opencode.ai/zen/go/v1",
      },
      models: [
        {
          id: "gpt-5.6-luna",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "grok-4.6",
          properties: {
            contextWindow: 500000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 500000,
              paramName: "max_output_tokens",
            },
          },
        },
      ],
    },
    {
      id: "opencode-zen-responses",
      names: {
        "zh-CN": "OpenCode Zen (Responses)",
        "en-US": "OpenCode Zen (Responses)",
      },
      logoUrl: "https://models.dev/logos/opencode.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://opencode.ai/auth",
      },
      api: {
        protocol: "openai-responses",
        baseUrl: "https://opencode.ai/zen/v1",
      },
      models: [
        {
          id: "gpt-6-astra",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.6-sol",
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.6-terra",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.6-luna",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.5-pro",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4-pro",
          enabled: false,
          properties: {
            contextWindow: 1050000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4-mini",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.4-nano",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "none",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.3-codex",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.3-codex-spark",
          enabled: false,
          properties: {
            contextWindow: 400000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    reasoning: {
                      effort: "xhigh",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.2",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_output_tokens",
            },
          },
        },
        {
          id: "gpt-5.1",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_output_tokens",
            },
          },
        },
      ],
    },
    {
      id: "opencode-zen-messages",
      names: {
        "zh-CN": "OpenCode Zen (Anthropic)",
        "en-US": "OpenCode Zen (Anthropic)",
      },
      logoUrl: "https://models.dev/logos/opencode.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://opencode.ai/auth",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://opencode.ai/zen/v1",
      },
      models: [
        {
          id: "claude-fable-5-1",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-fable-5",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.7-max",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.6-plus",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.5-plus",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 65536,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-opus-5",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-sonnet-5",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "medium",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "medium",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "xhigh",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "xhigh",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-haiku-4-5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: false,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-opus-4-8",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-opus-4-7",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-opus-4-6",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-opus-4-5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-sonnet-4-6",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "claude-sonnet-4-5",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "adaptive",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "qwen3.7-plus",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: true,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "opencode-zen-chat",
      names: {
        "zh-CN": "OpenCode Zen (Chat)",
        "en-US": "OpenCode Zen (Chat)",
      },
      logoUrl: "https://models.dev/logos/opencode.svg",
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://opencode.ai/auth",
      },
      api: {
        protocol: "openai-chat-completions",
        baseUrl: "https://opencode.ai/zen/v1",
      },
      models: [
        {
          id: "kimi-k3",
          properties: {
            contextWindow: 1048576,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "minimax-m3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "deepseek-v4-pro",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "glm-5.2",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "max",
                    reasoning: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "big-pickle",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "mimo-v2.5-free",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: true,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 131072,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "hy3-free",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "ling-3.0-flash-fin-free",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "nemotron-3-ultra-free",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "muse-spark-1.2-contributor-free",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "minimax-m2.7",
          enabled: false,
          properties: {
            contextWindow: 204800,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "deepseek-v4-flash",
          enabled: false,
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    reasoning_effort: "low",
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    reasoning_effort: "high",
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    reasoning_effort: "max",
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 384000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "glm-5.1",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_completion_tokens",
            },
          },
        },
        {
          id: "nemotron-3.5-lightning-free",
          enabled: false,
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: false,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                    enable_thinking: false,
                    reasoning_effort: "none",
                    reasoning: {
                      effort: "none",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    enable_thinking: true,
                    reasoning_effort: "high",
                    reasoning: {
                      effort: "high",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 32000,
              paramName: "max_completion_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:zai-individual-coding-plan",
      vendor: "zai",
      names: {
        "en-US": "Z.AI Individual Coding Plan",
      },
      logoUrl: "https://models.dev/logos/zai.svg",
      access: {
        type: "account",
        vendor: "zai",
        plan: "individual-coding-plan",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.z.ai/api/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:zai-team-coding-plan",
      vendor: "zai",
      names: {
        "en-US": "Z.AI Team Coding Plan",
      },
      logoUrl: "https://models.dev/logos/zai.svg",
      access: {
        type: "account",
        vendor: "zai",
        plan: "team-coding-plan",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://api.z.ai/api/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:zai-start-plan",
      vendor: "zai",
      names: {
        "en-US": "Start Plan",
      },
      logoUrl: "https://models.dev/logos/zai.svg",
      access: {
        type: "account",
        vendor: "zai",
        plan: "start-plan",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://zcode.z.ai/api/v1/zcode-plan/anthropic",
      },
      models: [
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.2",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5-Turbo",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:bigmodel-individual-coding-plan",
      vendor: "bigmodel",
      names: {
        "en-US": "BigModel Individual Coding Plan",
      },
      logoUrl: "https://models.dev/logos/zhipuai.svg",
      access: {
        type: "account",
        vendor: "bigmodel",
        plan: "individual-coding-plan",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:bigmodel-team-coding-plan",
      vendor: "bigmodel",
      names: {
        "en-US": "BigModel Team Coding Plan",
      },
      logoUrl: "https://models.dev/logos/zhipuai.svg",
      access: {
        type: "account",
        vendor: "bigmodel",
        plan: "team-coding-plan",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:bigmodel-start-plan",
      vendor: "bigmodel",
      names: {
        "en-US": "Start Plan",
      },
      logoUrl: "https://models.dev/logos/zhipuai.svg",
      access: {
        type: "account",
        vendor: "bigmodel",
        plan: "start-plan",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://zcode.z.ai/api/v1/zcode-plan/anthropic",
      },
      models: [
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.2",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5-Turbo",
          properties: {
            contextWindow: 200000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: true,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "disabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "disabled",
                    },
                  },
                },
                {
                  id: "enabled",
                  kind: "toggle",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 64000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:zai-offpeak-idle-plan",
      vendor: "zai",
      names: {
        "en-US": "Z.AI Idle plan",
      },
      logoUrl: "https://models.dev/logos/zai.svg",
      visibility: "hidden",
      access: {
        type: "account",
        vendor: "zai",
        plan: "off-peak",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://zcode.z.ai/api/v1/off-peak/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
    {
      id: "account:bigmodel-offpeak-idle-plan",
      vendor: "bigmodel",
      names: {
        "en-US": "BigModel Idle plan",
      },
      logoUrl: "https://models.dev/logos/zhipuai.svg",
      visibility: "hidden",
      access: {
        type: "account",
        vendor: "bigmodel",
        plan: "off-peak",
      },
      api: {
        protocol: "anthropic-messages",
        baseUrl: "https://zcode.z.ai/api/v1/off-peak/anthropic",
      },
      models: [
        {
          id: "GLM-5.3",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: false,
              video: false,
              audio: false,
              pdf: false,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
        {
          id: "GLM-5.3-Flash",
          properties: {
            contextWindow: 1000000,
            input: {
              text: true,
              image: true,
              video: true,
              audio: false,
              pdf: true,
            },
            output: {
              text: true,
            },
            supportsToolCall: true,
            supportsJsonSchemaOutput: false,
            supportsNativeWebSearch: false,
            supportsMidConversationSystem: true,
            requiresMfjsToolSchema: false,
          },
          options: {
            reasoning: {
              tiers: [
                {
                  id: "low",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "low",
                    },
                  },
                },
                {
                  id: "high",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "high",
                    },
                  },
                },
                {
                  id: "max",
                  kind: "effort",
                  params: {
                    thinking: {
                      type: "enabled",
                    },
                    output_config: {
                      effort: "max",
                    },
                  },
                },
              ],
            },
            maxOutputTokens: {
              max: 128000,
              paramName: "max_tokens",
            },
          },
        },
      ],
    },
  ],
};
