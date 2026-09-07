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
import { uiCardForCapability, type UiCardRegistry } from "./cards.js";
import type { McpProposalStore } from "./proposals.js";

/** 双形态的 authority 面选择。 */
export type McpFace = "in-process" | "stdio";

export interface SkillCreatorMcpDeps {
  capabilities: CapabilityRegistry;
  face: McpFace;
  /** ui:// 卡片注册表（daemon 级；ok 结果按能力面附卡）。 */
  cards: UiCardRegistry;
  /** mutation proposal 存储（形态 A；stdio 形态忽略——mutation 不注册）。 */
  proposals?: McpProposalStore;
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

/**
 * ok 结果附卡（task 4.2）：匹配能力面生成卡片 → 注册 ui:// 资源 → 结果值内嵌
 * `uiCard.resourceUri`（text JSON 随 dsh-mcp-client 必然透传）+ SEP-1865 的
 * `_meta.ui.resourceUri` 标准位置（标准 MCP Apps host 消费）。
 */
function withCard(
  capabilityName: string,
  result: unknown,
  cards: UiCardRegistry,
): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: { ui: { resourceUri: string } };
} {
  const base = toToolResult(result);
  const card = uiCardForCapability(capabilityName, result);
  if (!card) return base;
  const resourceUri = cards.register(card);
  // 值内嵌引用（面板流经 tool-result text 解析）。
  const enriched = safeJson({
    ...(typeof result === "object" && result !== null ? result : {}),
    uiCard: { resourceUri, type: card.type, title: card.title },
  });
  return {
    content: [{ type: "text", text: enriched }],
    _meta: { ui: { resourceUri } },
  };
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
    if (descriptor.authority === "approved-mutation") {
      // 4.4 authority：mutation 一律产 proposal 待审批（不直接写盘）。stdio 形态
      // 收窄为 readonly + propose-only（client 自持结果，不入 Manager 存储）——
      // 只在形态 A 注册 propose 变体。
      if (deps.face !== "in-process" || !deps.proposals) continue;
      const definition = deps.capabilities.definitionOf(descriptor.name);
      const input = definition?.input as z.ZodObject | undefined;
      const shape =
        input && typeof (input as unknown as { shape?: object }).shape === "object"
          ? input.shape
          : null;
      const proposeName = `${mcpToolName(descriptor.name)}_propose`;
      const proposeResult = (view: {
        proposalId: string;
        capability: string;
        status: string;
      }) => ({
        content: [
          {
            type: "text" as const,
            text: safeJson({
              kind: "proposed",
              proposalId: view.proposalId,
              capability: view.capability,
              status: view.status,
              note: "Awaiting human approval in the Skill Creator UI.",
            }),
          },
        ],
      });
      if (shape) {
        server.tool(
          proposeName,
          `Propose: ${descriptor.description} A human approves it in the Skill Creator UI before execution.`,
          shape,
          async (args) => proposeResult(deps.proposals!.create(descriptor.name, args)),
        );
      } else {
        server.tool(
          proposeName,
          `Propose: ${descriptor.description} A human approves it in the Skill Creator UI before execution.`,
          async () => proposeResult(deps.proposals!.create(descriptor.name, undefined)),
        );
      }
      continue;
    }
    const definition = deps.capabilities.definitionOf(descriptor.name);
    const input = definition?.input as z.ZodObject | undefined;
    const shape = input && typeof (input as unknown as { shape?: object }).shape === "object"
      ? input.shape
      : null;
    const toolName = mcpToolName(descriptor.name);
    if (shape) {
      server.tool(toolName, descriptor.description, shape, async (args) =>
        withCard(
          descriptor.name,
          await deps.capabilities.call(descriptor.name, args, MCP_PRINCIPAL),
          deps.cards,
        ),
      );
    } else {
      server.tool(toolName, descriptor.description, async () =>
        withCard(
          descriptor.name,
          await deps.capabilities.call(descriptor.name, undefined, MCP_PRINCIPAL),
          deps.cards,
        ),
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
