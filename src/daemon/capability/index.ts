/**
 * capability-core 组合入口（dsh-kernel-rebase tasks 1.1/1.2）。
 *
 * 用户原始需求 [2026-09-08]：「在现有 skill creator 的基础上……把我们整个 skill
 * creator 的各种能力内置成 MCP 和 MCP-apps，给到这个聊天对话框。」
 * 正交意图：
 *   [1] daemon 级 Manager 能力 registry：领域能力（workspace/skills/creator/
 *       repository）一次登记，MCP server（task 4.1）与内核工具面消费同一投影。
 * 妥协声明：无——本入口不引入新语义，只是组合点。
 */
import type { CapabilityRegistry } from "./core.js";
import { createCapabilityRegistry } from "./core.js";
import { createDomainCapabilities } from "./domain-capabilities.js";
import type { DaemonDomain } from "../domain.js";

export { createCapabilityRegistry } from "./core.js";
export type {
  CapabilityAuthority,
  CapabilityCallResult,
  CapabilityDefinition,
  CapabilityDescriptor,
  CapabilityPrincipal,
  CapabilityRegistry,
} from "./core.js";
export { createDomainCapabilities } from "./domain-capabilities.js";

/** daemon 域模块的 Manager 能力面（形态 A /mcp 与提示词投影共用）。 */
export function createManagerCapabilityRegistry(domain: DaemonDomain): CapabilityRegistry {
  return createCapabilityRegistry(createDomainCapabilities(domain));
}
