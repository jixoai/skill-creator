/**
 * DSH runtime integration focused tests（openspec dsh-runtime-integration tasks 3.1-3.4）。
 *
 * 用户原始需求 [2026-09-06]：「missing packages, version mismatch and missing plugin
 * rows return typed unavailable; no implicit fallback. 使用实际 package composition。」
 * task 3.4 追加：「另测 missing packages、invalid config、permission-denied」与
 * handshake recovery（失败不粘滞）。
 *
 * 正交意图：
 *   [1] 真实锁定组合 handshake：本机安装的 @deepseek-ai/* 0.1.2-rc.1 全部解析可用。
 *   [2] 注入式负例：缺包 / 版本漂移 / 组合行缺失 → typed unavailable，零 fallback。
 *   [3] 恢复与边界：handshake 失败后可恢复；human-only 工具在 Manager 层与 DSH 层
 *       都被 permission-denied / fail-closed；invalid config 投影默认值。
 */
import { describe, expect, it } from "vitest";
import {
  DSH_AUDITED_COMMIT,
  DSH_LOCKED_PACKAGES,
  DSH_MCP_BRIDGE_PACKAGES,
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
  it("resolves the mcp bridge packages at the locked versions (task 4.1b)", async () => {
    for (const [packageName, lockedVersion] of Object.entries(DSH_MCP_BRIDGE_PACKAGES)) {
      const resolved = await import(`${packageName}/package.json`, { with: { type: "json" } })
        .then((mod) => (mod.default as { version: string }).version)
        .catch(() => null);
      expect(resolved, packageName).toBe(lockedVersion);
    }
  });

  it("resolves the real locked composition with full capability matrix", () => {
    const adapter = createDshRuntimeAdapter({ loader: realLoader });
    const status = adapter.handshake();
    expect(status.state).toBe("available");
    if (status.state !== "available") return;
    expect(status.auditedCommit).toBe(DSH_AUDITED_COMMIT);
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

  it(
    "reports typed unavailable when a composition row export disappears",
    { timeout: 20_000 },
    () => {
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
    },
  );

  it("recovers once the failing package resolves again (no sticky failure)", () => {
    let sessionMissing = true;
    const loader: DshPackageLoader = (packageName) => {
      if (packageName === "@deepseek-ai/dsh-session" && sessionMissing) {
        throw new Error("MODULE_NOT_FOUND");
      }
      return realLoader(packageName);
    };
    const adapter = createDshRuntimeAdapter({ loader });
    expect(adapter.handshake()).toMatchObject({ state: "unavailable", code: "MISSING_PACKAGE" });
    sessionMissing = false;
    const recovered = adapter.handshake();
    expect(recovered.state).toBe("available");
    if (recovered.state === "available") {
      expect(recovered.capabilities.sessionStore).toBe(true);
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
        snapshotId: first.snapshot.id,
        callTool: first.callTool,
        onCall: () => undefined,
      });
      const r2 = await runDshStewardToolRound({
        sessionId: `steward-replay-b-${Date.now()}`,
        turnText: "Run the steward check task.",
        snapshotId: second.snapshot.id,
        callTool: second.callTool,
        onCall: () => undefined,
      });
      expect(r2.adapterCalls).toBe(r1.adapterCalls);
      expect(second.calls.map((call) => call.tool)).toEqual(first.calls.map((call) => call.tool));
    },
  );
});

describe("dsh steward runtime safety (task 3.2 acceptance)", () => {
  it(
    "fails closed when the model requests an unregistered generic tool",
    { timeout: 20_000 },
    async () => {
      const { runDshStewardToolRound } = await import("../src/daemon/steward/dsh-agent-runtime.js");
      const calls: import("../src/shared/contracts/skill-steward.js").SkillToolCall[] = [];
      const snapshot = (
        await import("../src/shared/contracts/skill-steward.js")
      ).SkillStewardContextSnapshotSchema.parse(
        JSON.parse(
          (await import("node:fs")).readFileSync(
            (await import("node:path")).join(
              __dirname,
              "fixtures",
              "steward",
              "snapshot.imported.json",
            ),
            "utf8",
          ),
        ),
      );
      const result = await runDshStewardToolRound({
        sessionId: `steward-generic-${Date.now()}`,
        turnText: "Write a file.",
        snapshotId: snapshot.id,
        requestTool: "write_file",
        callTool: async (tool, input) => {
          throw new Error(`Manager bridge must not see ${tool}`);
        },
        onCall: (call) => calls.push(call),
      });
      // 未注册工具在 DSH registry 层被拒（fail closed）：Manager 桥零调用。
      expect(calls).toHaveLength(0);
      expect(result.toolDenied).toBe(true);
      expect(result.statuses.at(-1)).toBe("idle");
    },
  );

  it(
    "cancels an in-flight round and drains to a bounded idle terminal",
    { timeout: 20_000 },
    async () => {
      const { runDshStewardToolRound } = await import("../src/daemon/steward/dsh-agent-runtime.js");
      const snapshot = (
        await import("../src/shared/contracts/skill-steward.js")
      ).SkillStewardContextSnapshotSchema.parse(
        JSON.parse(
          (await import("node:fs")).readFileSync(
            (await import("node:path")).join(
              __dirname,
              "fixtures",
              "steward",
              "snapshot.imported.json",
            ),
            "utf8",
          ),
        ),
      );
      const result = await runDshStewardToolRound({
        sessionId: `steward-cancel-${Date.now()}`,
        turnText: "Run a long steward analysis.",
        snapshotId: snapshot.id,
        cancelImmediately: true,
        callTool: async () => ({ kind: "ok", value: {} }),
        onCall: () => undefined,
      });
      expect(result.cancelled).toBe(true);
      expect(result.statuses.at(-1)).toBe("idle");
    },
  );

  it(
    "force-releases an abort-ignoring adapter after the explicit idle deadline (2.4a)",
    { timeout: 20_000 },
    async () => {
      const mod = await import("../src/daemon/steward/dsh-agent-runtime.js");
      // 挂起 adapter：进入 stream 后永不 yield、永不返回、不响应任何取消信号。
      class HangingAdapter extends mod.ScriptedStewardLlmAdapter {
        override async *stream(
          _options: Parameters<mod.ScriptedStewardLlmAdapter["stream"]>[0],
        ): AsyncGenerator<never, void, unknown> {
          this.calls += 1;
          await new Promise<never>(() => {});
        }
      }
      const snapshot = (
        await import("../src/shared/contracts/skill-steward.js")
      ).SkillStewardContextSnapshotSchema.parse(
        JSON.parse(
          (await import("node:fs")).readFileSync(
            (await import("node:path")).join(
              __dirname,
              "fixtures",
              "steward",
              "snapshot.imported.json",
            ),
            "utf8",
          ),
        ),
      );
      const startedAt = Date.now();
      const result = await mod.runDshStewardToolRound({
        sessionId: `steward-hang-${Date.now()}`,
        turnText: "Run a steward round that never settles.",
        snapshotId: snapshot.id,
        callTool: async () => ({ kind: "ok", value: {} }),
        onCall: () => undefined,
        adapter: new HangingAdapter(),
        idleDeadlineMs: 150,
        idleGraceMs: 150,
      });
      // run 有界：deadline + grace + 余量内返回，且携带 typed 强制释放事实。
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      expect(result.forcedRelease).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(result.adapterCalls).toBeGreaterThanOrEqual(1);
      // 清理失败可见：record 总是携带 cleanupErrors（此路径允许非空）。
      expect(Array.isArray(result.cleanupErrors)).toBe(true);
    },
  );

  it(
    "a responsive round reports a clean session dispose (2.4a cleanup visibility)",
    { timeout: 20_000 },
    async () => {
      const { runDshStewardToolRound } = await import("../src/daemon/steward/dsh-agent-runtime.js");
      const snapshot = (
        await import("../src/shared/contracts/skill-steward.js")
      ).SkillStewardContextSnapshotSchema.parse(
        JSON.parse(
          (await import("node:fs")).readFileSync(
            (await import("node:path")).join(
              __dirname,
              "fixtures",
              "steward",
              "snapshot.imported.json",
            ),
            "utf8",
          ),
        ),
      );
      const result = await runDshStewardToolRound({
        sessionId: `steward-clean-${Date.now()}`,
        turnText: "Run the steward check task.",
        snapshotId: snapshot.id,
        callTool: async () => ({ kind: "ok", value: {} }),
        onCall: () => undefined,
      });
      expect(result.forcedRelease).toBe(false);
      expect(result.cleanupErrors).toEqual([]);
    },
  );
});

describe("dsh unavailable/recovery boundaries (task 3.4)", () => {
  it(
    "permission-denied: human-only apply/rollback are refused for the agent principal at both layers",
    { timeout: 20_000 },
    async () => {
      const { runDshStewardToolRound } = await import("../src/daemon/steward/dsh-agent-runtime.js");
      const manager = await (async () => {
        const { createStewardToolRegistry } =
          await import("../src/daemon/steward/tool-registry.js");
        const steward = await import("../src/shared/contracts/skill-steward.js");
        const fs = await import("node:fs");
        const path = await import("node:path");
        const snapshot = steward.SkillStewardContextSnapshotSchema.parse(
          JSON.parse(
            fs.readFileSync(
              path.join(__dirname, "fixtures", "steward", "snapshot.imported.json"),
              "utf8",
            ),
          ),
        );
        const calls: import("../src/shared/contracts/skill-steward.js").SkillToolCall[] = [];
        const registry = createStewardToolRegistry({
          runId: steward.StewardRunIdSchema.parse("sr_0123456789abcdef01234567"),
          snapshot,
          proposals: {
            store: () => {
              throw new Error("not used");
            },
            get: () => null,
          },
          validate: () => ({ overall: "valid", checks: [] }),
          onCall: (call) => calls.push(call),
        });
        return {
          calls,
          callTool: (tool: string, input: unknown) => registry.call(tool, input, "agent"),
        };
      })();

      // 层 1：Manager tool registry 对 agent principal 直接 permission-denied。
      const denied = (await manager.callTool("skills.apply_proposal", {
        proposalId: "sp_0123456789abcdef01234567",
      })) as { kind: string; reason?: string };
      expect(denied.kind).toBe("denied");
      expect(denied.reason).toBe("principal-forbidden");
      const deniedCall = manager.calls.at(-1);
      expect(deniedCall?.result).toMatchObject({ kind: "denied", reason: "principal-forbidden" });

      // 层 2：agent scope 未注册 apply/rollback；模型请求它在 DSH registry fail-closed。
      const result = await runDshStewardToolRound({
        sessionId: `steward-apply-denied-${Date.now()}`,
        turnText: "Apply the proposal now.",
        snapshotId: "snap_denied_round",
        requestTool: "skills.apply_proposal",
        callTool: async (tool) => {
          throw new Error(`Manager bridge must not see ${tool}`);
        },
        onCall: () => undefined,
      });
      expect(result.toolDenied).toBe(true);
      expect(result.statuses.at(-1)).toBe("idle");
      // Manager 侧唯一审计是层 1 的显式 denied 记录；DSH 层零新调用。
      expect(manager.calls.filter((call) => call.tool === "skills.apply_proposal")).toHaveLength(1);
    },
  );

  it("invalid config: corrupted dsh-settings.json projects defaults and keeps deterministic preset resolvable", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { setHomeOverride } = await import("../src/shared/paths.js");
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-dsh-invalid-"));
    const isolatedHome = path.join(sandbox, "state");
    process.env.SKILL_CREATOR_HOME = isolatedHome;
    setHomeOverride(isolatedHome);
    try {
      const storeDir = path.join(isolatedHome, "steward-store");
      fs.mkdirSync(storeDir, { recursive: true });
      fs.writeFileSync(
        path.join(storeDir, "dsh-settings.json"),
        JSON.stringify({ configVersion: 42, preset: "live", garbage: [1, 2, 3] }),
        "utf8",
      );
      const { createDshSettingsService } = await import("../src/daemon/steward/dsh-settings.js");
      const service = createDshSettingsService();
      const view = await service.getView();
      expect(view.settings.preset).toBe("deterministic");
      expect(view.settings.revision).toBe(0);
      const resolved = await service.resolveRuntimePreset();
      expect(resolved.outcome).toBe("deterministic");
    } finally {
      setHomeOverride(null);
      delete process.env.SKILL_CREATOR_HOME;
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
