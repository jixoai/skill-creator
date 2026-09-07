/**
 * 用户原始需求 [2026-09-08]（dsh-kernel-rebase tasks 1.1/1.2）：「capability 清单与
 * 既有工具面一一对应（差异表落 artifacts）」「每项能力有 focused test 且 authority
 * class 逐项标注」。
 * 正交意图：
 *   [1] capability-core 分发语义：闭合面、principal 边界、异常兜底、清单投影。
 *   [2] steward 迁移一一对应：capability 清单 == SKILL_DOMAIN_TOOLS；
 *       agent 面 == AGENT_ALLOWED_TOOLS；authority class 逐项钉死。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createCapabilityRegistry,
  type CapabilityDefinition,
} from "../src/daemon/capability/core.js";
import { createStewardCapabilities } from "../src/daemon/steward/capabilities.js";
import {
  AGENT_ALLOWED_TOOLS,
  SKILL_DOMAIN_TOOLS,
  type SkillStewardContextSnapshot,
} from "../src/shared/contracts/skill-steward.js";

function minimalSnapshot(): SkillStewardContextSnapshot {
  return {
    id: "snap_test0000000000000000000000000000000",
    scopeKind: "workspace-provider",
    target: { workspaceId: "ws_test", providerId: "cc" },
    createdAt: new Date().toISOString(),
    skills: [],
    resources: [],
  } as unknown as SkillStewardContextSnapshot;
}

const registry = createCapabilityRegistry(
  createStewardCapabilities({
    snapshot: minimalSnapshot(),
    proposals: {
      store: () => {
        throw new Error("not exercised in this suite");
      },
      get: () => null,
    },
    validate: () => ({ overall: "invalid", checks: [] }),
  }),
);

/** tasks 1.1/1.2 的 authority class 标注表（差异表见 artifacts/capability-map.md）。 */
const STEWARD_AUTHORITY: Record<string, string> = {
  "skills.list_context": "readonly",
  "skills.inspect": "readonly",
  "skills.relations": "readonly",
  "skills.validate_proposal": "readonly",
  "skills.propose": "proposal",
  "skills.apply_proposal": "approved-mutation",
  "skills.rollback": "approved-mutation",
};

describe("capability-core registry", () => {
  it("denies unregistered operations with unsupported-capability", async () => {
    const result = await registry.call("skills.read_file", {}, "agent");
    expect(result).toEqual({
      kind: "denied",
      reason: "unsupported-capability",
      requestedOperation: "skills.read_file",
    });
  });

  it("denies approved-mutation capabilities for the agent principal only", async () => {
    const agentDenied = await registry.call("skills.apply_proposal", { proposalId: "prop_x" }, "agent");
    expect(agentDenied).toEqual({
      kind: "denied",
      reason: "principal-forbidden",
      requestedOperation: "skills.apply_proposal",
    });
    // human-ui / manager-recovery 到达 handler（apply 未注入 → UNAVAILABLE，而非 denied）。
    const humanUi = await registry.call("skills.apply_proposal", { proposalId: "prop_x" }, "human-ui");
    expect(humanUi).toMatchObject({ kind: "failed", code: "UNAVAILABLE" });
  });

  it("converts thrown handler errors into typed UNAVAILABLE failures", async () => {
    const throwing: CapabilityDefinition[] = [
      {
        name: "test.boom",
        description: "throws",
        authority: "readonly",
        input: z.unknown(),
        handler: () => {
          throw new Error("boom");
        },
      },
    ];
    const result = await createCapabilityRegistry(throwing).call("test.boom", {}, "agent");
    expect(result).toEqual({ kind: "failed", code: "UNAVAILABLE", message: "boom" });
  });

  it("rejects duplicate registrations at construction time", () => {
    const definition: CapabilityDefinition = {
      name: "test.dup",
      description: "",
      authority: "readonly",
      input: z.unknown(),
      handler: () => ({ kind: "ok", value: null }),
    };
    expect(() => createCapabilityRegistry([definition, definition])).toThrow(
      "duplicate capability registration: test.dup",
    );
  });

  it("projects agent-visible tool names from authority classes", () => {
    expect(registry.agentToolNames()).toEqual([...AGENT_ALLOWED_TOOLS]);
  });
});

describe("steward capability migration is one-to-one (tasks 1.1)", () => {
  it("capability list matches SKILL_DOMAIN_TOOLS exactly", () => {
    expect(registry.names()).toEqual([...SKILL_DOMAIN_TOOLS]);
  });

  it("annotates every steward capability with its authority class", () => {
    for (const descriptor of registry.describe()) {
      expect(STEWARD_AUTHORITY[descriptor.name]).toBeDefined();
      expect(descriptor.authority).toBe(STEWARD_AUTHORITY[descriptor.name]);
    }
    expect(registry.describe()).toHaveLength(Object.keys(STEWARD_AUTHORITY).length);
  });

  it("keeps snapshot-scoped lookups typed (inspect unknown skill)", async () => {
    // 合法 SkillId 形状但不在快照内 → NOT_FOUND（非法形状则 INVALID_OPERATION）。
    const result = await registry.call("skills.inspect", { skillId: "sk_deadbeefdeadbeefdeadbeef" }, "agent");
    expect(result).toMatchObject({ kind: "failed", code: "NOT_FOUND" });
  });
});
