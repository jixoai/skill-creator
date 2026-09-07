/**
 * skill-creator-mcp server（dsh-kernel-rebase task 4.1）。
 *
 * 用户原始需求 [2026-09-08]：「先做内部，但是不排除可以独立启用：skill-creator
 * mcp:启动 mcp-server」——同一实现双形态：形态 A 进程内 `/mcp`（loopback HTTP +
 * Bearer web token），形态 B `skill-creator mcp` CLI（stdio，不依赖 daemon 常驻）。
 *
 * 正交意图：
 *   [1] capability → MCP tools：capability-core 投影为 schema-faithful descriptors
 *       （Zod raw shape 直传 SDK；capability 名的 `.` 投影为 MCP 合法 `_`）。
 *   [2] authority 面：只注册 readonly（与 proposal 类）能力——mutation 仅经
 *       形态 A 的审批链（task 4.4 的 proposal 包装）；stdio 形态天生收窄。
 *   [3] resources 只读面：技能文档经 resource template 按需读取（opaque ID，
 *       server 解析 containment——外部 client 不拼路径）。
 * 妥协声明：dsh-mcp-client 只桥 tools（resources/prompts 不支持）——resource 面
 *   服务外部 client；内核会话的工具消费全部走 tools。
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { CapabilityRegistry } from "../capability/core.js";

/** 双形态的 authority 面选择。 */
export type McpFace = "in-process" | "stdio";

export interface SkillCreatorMcpDeps {
  capabilities: CapabilityRegistry;
  face: McpFace;
}

/** MCP 工具名：capability 名 `.` → `_`（MCP 名字字符集 [a-zA-Z0-9_-]）。 */
export function mcpToolName(capabilityName: string): string {
  return capabilityName.replace(/\./g, "_");
}

/** capability 调用主体：MCP 面的调用者是模型（readonly/proposal 面对 agent 开放）。 */
const MCP_PRINCIPAL = "agent" as const;

/** MCP 工具 handler 的结果投影（closed result → MCP content）。 */
function toToolResult(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const serialized = safeJson(result);
  if (
    typeof result === "object" &&
    result !== null &&
    "kind" in result &&
    (result as { kind: string }).kind !== "ok"
  ) {
    return { content: [{ type: "text", text: serialized }], isError: true };
  }
  return { content: [{ type: "text", text: serialized }] };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 构造 skill-creator MCP server（两种形态共用）。
 * 只注册 readonly + proposal 能力；approved-mutation 由 registry 的 principal
 * 边界拒绝（4.4 在形态 A 上追加 mutation→proposal 通道）。
 */
export function createSkillCreatorMcpServer(deps: SkillCreatorMcpDeps): McpServer {
  void deps.face;
  const server = new McpServer(
    { name: "skill-creator", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } },
  );

  for (const descriptor of deps.capabilities.describe()) {
    if (descriptor.authority === "approved-mutation") continue;
    const definition = deps.capabilities.definitionOf(descriptor.name);
    const input = definition?.input as z.ZodObject | undefined;
    const shape = input && typeof (input as unknown as { shape?: object }).shape === "object"
      ? input.shape
      : null;
    const toolName = mcpToolName(descriptor.name);
    if (shape) {
      server.tool(toolName, descriptor.description, shape, async (args) =>
        toToolResult(await deps.capabilities.call(descriptor.name, args, MCP_PRINCIPAL)),
      );
    } else {
      server.tool(toolName, descriptor.description, async () =>
        toToolResult(await deps.capabilities.call(descriptor.name, undefined, MCP_PRINCIPAL)),
      );
    }
  }

  // resources 只读面：技能文档 template（opaque ID；server 解析 containment）。
  server.registerResource(
    "skill",
    new ResourceTemplate("skill-creator://skill/{workspaceId}/{providerId}/{skillId}", {
      list: undefined,
    }),
    {
      description:
        "Read-only SKILL.md document for one skill (opaque IDs; the server resolves containment).",
      mimeType: "text/markdown",
    },
    async (uri: URL, variables: Record<string, string | string[] | undefined>) => {
      const { workspaceId, providerId, skillId } = variables as Record<string, string>;
      const result = await deps.capabilities.call(
        "skills.info",
        { workspaceId, providerId, skillId },
        MCP_PRINCIPAL,
      );
      if (result.kind !== "ok") {
        throw new Error(`skill not readable: ${safeJson(result)}`);
      }
      const info = result.value as {
        metadata?: { document?: { content?: string } };
        document?: { content?: string };
        content?: string;
      };
      const content =
        info.metadata?.document?.content ?? info.document?.content ?? info.content;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text:
              typeof content === "string" ? content : content ? safeJson(content) : safeJson(info),
          },
        ],
      };
    },
  );

  return server;
}
