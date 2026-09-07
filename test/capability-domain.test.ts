/**
 * 用户原始需求 [2026-09-08]（dsh-kernel-rebase tasks 1.2 验收）：「每项能力有
 * focused test 且 authority class 逐项标注；class 清单与 manager-contract-map 的
 * authority 列一致（差异表入 artifacts）。」
 * 正交意图：
 *   [1] authority 逐项标注钉死（19 项领域能力）。
 *   [2] 与 manager-contract-map 的 procedure 一一对应（skills/workspace/creator/
 *       repository 四域；daemon/dsh/acp/steward 面不在 MCP 供给范围，见差异表）。
 *   [3] DomainError 归一与真实 handler 冒烟（stub domain，不触文件系统）。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { createManagerCapabilityRegistry } from "../src/daemon/capability/index.js";
import type { DaemonDomain } from "../src/daemon/domain.js";
import { DomainError } from "../src/daemon/domain-error.js";

function stubDomain(): DaemonDomain {
  return {
    workspaces: {
      list: async () => [],
      import: () => {
        throw new DomainError("INVALID_OPERATION", "bad path");
      },
      forget: () => {
        throw new Error("not exercised");
      },
      activate: () => {
        throw new Error("not exercised");
      },
    },
    skills: {
      list: async () => [],
      info: () => {
        throw new Error("not exercised");
      },
      toggle: () => {
        throw new Error("not exercised");
      },
      validate: () => {
        throw new Error("not exercised");
      },
    },
    skillsUpdate: {
      checkUpdates: () => {
        throw new Error("not exercised");
      },
      applyUpdates: () => {
        throw new Error("not exercised");
      },
    },
    creator: {
      save: () => {
        throw new Error("not exercised");
      },
      load: () => {
        throw new Error("not exercised");
      },
      remove: () => {
        throw new Error("not exercised");
      },
      revisions: () => {
        throw new Error("not exercised");
      },
    },
    repository: {
      scan: () => {
        throw new Error("not exercised");
      },
      preview: () => {
        throw new Error("not exercised");
      },
      install: () => {
        throw new Error("not exercised");
      },
    },
    sourceRegistry: {
      list: () => ({ builtIn: [], user: [] }),
      add: () => {
        throw new Error("not exercised");
      },
      remove: () => {
        throw new Error("not exercised");
      },
    },
  } as unknown as DaemonDomain;
}

const registry = createManagerCapabilityRegistry(stubDomain());

/** tasks 1.2 + manager-contract-map authority 列的逐项标注表。 */
const DOMAIN_AUTHORITY: Record<string, string> = {
  "workspace.list": "readonly",
  "workspace.add": "approved-mutation",
  "workspace.remove": "approved-mutation",
  "workspace.setActive": "approved-mutation",
  "skills.list": "readonly",
  "skills.info": "readonly",
  "skills.toggle": "approved-mutation",
  "skills.validate": "readonly",
  "skills.update.check": "readonly",
  "skills.update.apply": "approved-mutation",
  "creator.load": "readonly",
  "creator.save": "approved-mutation",
  "creator.remove": "approved-mutation",
  "creator.revisions": "readonly",
  "repository.scan": "readonly",
  "repository.preview": "approved-mutation",
  "repository.install": "approved-mutation",
  "repository.sources.list": "readonly",
  "repository.sources.add": "approved-mutation",
  "repository.sources.remove": "approved-mutation",
};

describe("manager domain capability registration (tasks 1.2)", () => {
  it("annotates every domain capability with its authority class", () => {
    expect(registry.names()).toEqual(Object.keys(DOMAIN_AUTHORITY));
    for (const descriptor of registry.describe()) {
      expect(DOMAIN_AUTHORITY[descriptor.name]).toBeDefined();
      expect(descriptor.authority).toBe(DOMAIN_AUTHORITY[descriptor.name]);
      expect(descriptor.description.length).toBeGreaterThan(0);
    }
  });

  it("covers the manager-contract-map procedure list for skills/workspace/creator/repository", () => {
    // manager-contract-map.md 四域 procedure 全集（daemon.*/acp.*/steward 面不在
    // MCP 供给范围；skillSteward/skillIntelligence 由 steward 协议面另行拥有）。
    const mapProcedures = [
      "skills.list",
      "skills.info",
      "skills.toggle",
      "skills.validate",
      "skills.update.check",
      "skills.update.apply",
      "workspace.list",
      "workspace.add",
      "workspace.remove",
      "workspace.setActive",
      "creator.save",
      "creator.load",
      "creator.remove",
      "creator.revisions",
      "repository.scan",
      "repository.preview",
      "repository.install",
      "repository.sources.list",
      "repository.sources.add",
      "repository.sources.remove",
    ];
    expect([...registry.names()].sort()).toEqual([...mapProcedures].sort());
  });

  it("executes a readonly capability end to end (workspace.list)", async () => {
    const result = await registry.call("workspace.list", {}, "agent");
    expect(result).toEqual({ kind: "ok", value: { workspaces: [] } });
  });

  it("normalizes DomainError into typed failed results", async () => {
    const result = await registry.call(
      "workspace.add",
      { path: "/nonexistent", label: "x" },
      "human-ui",
    );
    expect(result).toEqual({
      kind: "failed",
      code: "INVALID_OPERATION",
      message: "bad path",
    });
  });

  it("still denies approved-mutation capabilities for the agent principal", async () => {
    const result = await registry.call(
      "skills.toggle",
      {
        workspaceId: "ws_x",
        providerId: "cc",
        skillIds: ["sk_deadbeefdeadbeefdeadbeef"],
        mode: "disable",
      },
      "agent",
    );
    expect(result).toEqual({
      kind: "denied",
      reason: "principal-forbidden",
      requestedOperation: "skills.toggle",
    });
  });
});
