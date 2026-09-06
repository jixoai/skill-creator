/**
 * DSH runtime integration focused tests（openspec dsh-runtime-integration task 3.1+）。
 *
 * 用户原始需求 [2026-09-06]：「missing packages, version mismatch and missing plugin
 * rows return typed unavailable; no implicit fallback. 使用实际 package composition。」
 *
 * 正交意图：
 *   [1] 真实锁定组合 handshake：本机安装的 @deepseek-ai/* 0.1.2-rc.1 全部解析可用。
 *   [2] 注入式负例：缺包 / 版本漂移 / 组合行缺失 → typed unavailable，零 fallback。
 */
import { describe, expect, it } from "vitest";
import {
  DSH_LOCKED_PACKAGES,
  DshRuntimeStatusSchema,
} from "../src/shared/contracts/dsh-runtime.js";
import {
  createDshRuntimeAdapter,
  type DshPackageLoader,
} from "../src/daemon/steward/dsh-adapter.js";

import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

/** 真实 loader（与 adapter 默认一致，显式注入便于断言语义）。 */
const realLoader: DshPackageLoader = (packageName) => {
  const pkgJson = nodeRequire(`${packageName}/package.json`) as { version: string };
  const mod = nodeRequire(packageName) as Record<string, unknown>;
  return { version: pkgJson.version, hasExport: (name) => name in mod };
};

describe("dsh runtime handshake (task 3.1)", () => {
  it("resolves the real locked composition with full capability matrix", () => {
    const adapter = createDshRuntimeAdapter({ loader: realLoader });
    const status = adapter.handshake();
    expect(status.state).toBe("available");
    if (status.state !== "available") return;
    expect(status.auditedCommit).toBe("d347e703908d0406b7a7ef80e3a0e594d86b2215");
    expect(status.rows).toHaveLength(Object.keys(DSH_LOCKED_PACKAGES).length);
    for (const row of status.rows) {
      expect(row.resolvedVersion).toBe(row.lockedVersion);
    }
    expect(status.capabilities).toEqual({
      agentRegistry: true,
      agentLoop: true,
      toolRuntime: true,
      systemPrompt: true,
      sessionStore: true,
    });
    // 状态通过契约 schema runtime 校验。
    expect(DshRuntimeStatusSchema.safeParse(status).success).toBe(true);
  });

  it("reports typed unavailable for a missing package without fallback", () => {
    const loader: DshPackageLoader = (packageName) => {
      if (packageName === "@deepseek-ai/dsh-session") {
        throw new Error("MODULE_NOT_FOUND");
      }
      return realLoader(packageName);
    };
    const status = createDshRuntimeAdapter({ loader }).handshake();
    expect(status).toMatchObject({
      state: "unavailable",
      code: "MISSING_PACKAGE",
      packageName: "@deepseek-ai/dsh-session",
    });
    expect(DshRuntimeStatusSchema.safeParse(status).success).toBe(true);
  });

  it("reports typed unavailable on version drift", () => {
    const loader: DshPackageLoader = (packageName) => {
      const base = realLoader(packageName);
      if (packageName === "@deepseek-ai/dsh-agent") {
        return { ...base, version: "0.1.3-alpha.1" };
      }
      return base;
    };
    const status = createDshRuntimeAdapter({ loader }).handshake();
    expect(status).toMatchObject({
      state: "unavailable",
      code: "VERSION_MISMATCH",
      packageName: "@deepseek-ai/dsh-agent",
    });
  });

  it("reports typed unavailable when a composition row export disappears", () => {
    const loader: DshPackageLoader = (packageName) => {
      const base = realLoader(packageName);
      if (packageName === "@deepseek-ai/dsh-tools") {
        return { ...base, hasExport: () => false };
      }
      return base;
    };
    const status = createDshRuntimeAdapter({ loader }).handshake();
    expect(status).toMatchObject({
      state: "unavailable",
      code: "COMPOSITION_ROW_MISSING",
      packageName: "@deepseek-ai/dsh-tools",
    });
    if (status.state === "unavailable") {
      expect(status.detail).toContain("ToolRuntime");
    }
  });
});

describe("dsh composition boot (task 3.2 step 1)", () => {
  it("boots the real cordis composition with all steward-required services", async () => {
    const { Context } = await import("@deepseek-ai/cordis");
    const { SessionProjectionRegistry } = await import("@deepseek-ai/dsh-session-projection");
    const { SessionStore } = await import("@deepseek-ai/dsh-session");
    const { LlmRuntime } = await import("@deepseek-ai/dsh-llm");
    const { SystemPrompt } = await import("@deepseek-ai/dsh-system-prompt");
    const { ToolRuntime } = await import("@deepseek-ai/dsh-tools");
    const { AgentRegistry } = await import("@deepseek-ai/dsh-agent");
    const { AgentLoop } = await import("@deepseek-ai/dsh-agent-loop");
    const ctx = new Context();
    for (const service of [
      SessionProjectionRegistry,
      SessionStore,
      LlmRuntime,
      SystemPrompt,
      ToolRuntime,
      AgentRegistry,
    ]) {
      ctx.plugin(service);
    }
    ctx.plugin(AgentLoop, {});
    // cordis 以 fiber 调度 init；短settling 等待服务就绪。
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(typeof ctx.tools).toBe("object");
    expect(typeof ctx.tools.register).toBe("function");
    expect(typeof ctx.tools.restrict).toBe("function");
    expect(typeof ctx.agents).toBe("object");
    expect(typeof ctx.llm).toBe("object");
    expect(typeof ctx.systemPrompt).toBe("object");
    expect(typeof ctx.sessions).toBe("object");
    expect(typeof ctx.sessionProjections).toBe("object");
  });

  it("enforces typed tool output schemas at registration (fail-closed)", async () => {
    const { Context } = await import("@deepseek-ai/cordis");
    const { SessionProjectionRegistry } = await import("@deepseek-ai/dsh-session-projection");
    const { SessionStore } = await import("@deepseek-ai/dsh-session");
    const { LlmRuntime } = await import("@deepseek-ai/dsh-llm");
    const { SystemPrompt } = await import("@deepseek-ai/dsh-system-prompt");
    const { ToolRuntime } = await import("@deepseek-ai/dsh-tools");
    const { AgentRegistry } = await import("@deepseek-ai/dsh-agent");
    const ctx = new Context();
    for (const service of [
      SessionProjectionRegistry,
      SessionStore,
      LlmRuntime,
      SystemPrompt,
      ToolRuntime,
      AgentRegistry,
    ]) {
      ctx.plugin(service);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 无 output 声明的工具必须被拒绝（typed tool contract，实测发现）。
    expect(() =>
      ctx.tools.register({
        name: "skills.list_context",
        description: "must fail without output schema",
        input: { type: "object", properties: {} },
        execute: async () => ({ ok: true }),
      }),
    ).toThrow(/output/);
  });
});

describe("dsh steward agent runtime (task 3.2)", () => {
  /** 构造真实 Manager tool registry 桥（快照 fixture + 内存 sink）。 */
  async function makeManagerBridge() {
    const { createStewardToolRegistry } = await import("../src/daemon/steward/tool-registry.js");
    const snapshotP = (await import("../src/shared/contracts/skill-steward.js"))
      .SkillStewardContextSnapshotSchema;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const snapshot = snapshotP.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "fixtures", "steward", "snapshot.imported.json"),
          "utf8",
        ),
      ),
    );
    const calls: import("../src/shared/contracts/skill-steward.js").SkillToolCall[] = [];
    const registry = createStewardToolRegistry({
      runId: (await import("../src/shared/contracts/skill-steward.js")).StewardRunIdSchema.parse(
        "sr_0123456789abcdef01234567",
      ),
      snapshot,
      proposals: {
        store: () => {
          throw new Error("not used in this round");
        },
        get: () => null,
      },
      validate: () => ({ overall: "valid", checks: [{ name: "bind", status: "passed" }] }),
      onCall: (call) => calls.push(call),
    });
    return {
      snapshot,
      calls,
      callTool: (tool: string, input: unknown) => registry.call(tool, input, "agent"),
    };
  }

  it("runs a real tool round through the Manager registry", { timeout: 20_000 }, async () => {
    const { runDshStewardToolRound } = await import("../src/daemon/steward/dsh-agent-runtime.js");
    const manager = await makeManagerBridge();
    const result = await runDshStewardToolRound({
      sessionId: `steward-round-${Date.now()}`,
      turnText: "Run the steward check task.",
      callTool: manager.callTool,
      onCall: () => undefined,
    });
    // 真实链路：deterministic LLM 发起 tool-call → 域工具执行回到 Manager registry
    // → 第二轮收尾 → idle。
    expect(result.adapterCalls).toBe(2);
    expect(result.statuses).toContain("running");
    expect(result.statuses.at(-1)).toBe("idle");
    expect(manager.calls.length).toBeGreaterThanOrEqual(1);
    const listCall = manager.calls.find((call) => call.tool === "skills.list_context");
    expect(listCall).toBeDefined();
    expect(listCall!.principal).toBe("agent");
    expect(listCall!.result.kind).toBe("ok");
  });

  it(
    "replays identically: a second round re-executes the same scripted tool sequence",
    { timeout: 20_000 },
    async () => {
      const { runDshStewardToolRound } = await import("../src/daemon/steward/dsh-agent-runtime.js");
      const first = await makeManagerBridge();
      const second = await makeManagerBridge();
      const r1 = await runDshStewardToolRound({
        sessionId: `steward-replay-a-${Date.now()}`,
        turnText: "Run the steward check task.",
        callTool: first.callTool,
        onCall: () => undefined,
      });
      const r2 = await runDshStewardToolRound({
        sessionId: `steward-replay-b-${Date.now()}`,
        turnText: "Run the steward check task.",
        callTool: second.callTool,
        onCall: () => undefined,
      });
      expect(r2.adapterCalls).toBe(r1.adapterCalls);
      expect(second.calls.map((call) => call.tool)).toEqual(first.calls.map((call) => call.tool));
    },
  );
});
