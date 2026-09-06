/**
 * 生成去标识化的 DSH steward transcript artifact（openspec dsh-runtime-integration task 3.4）。
 *
 * 用户原始需求 [2026-09-06]（tasks 3.4）：「使用真实锁定 DSH packages + deterministic
 * LLM adapter 跑 tool round/cancel/replay」，产物为
 * `openspec/changes/dsh-runtime-integration/artifacts/dsh-transcript.json`。
 * 执行：`bun scripts/dsh-transcript.sh.ts`（house law：新脚本 .sh.ts 由 Bun 直接执行；
 * Bun 与 cordis 组合不兼容时回退 `pnpm exec tsx scripts/dsh-transcript.sh.ts`）。
 *
 * 正交意图：
 *   [1] 真实组合证据：锁定包 handshake + 真实 cordis 组合上的 tool round / replay /
 *       cancel，确定性 LLM transport，全程经 Manager tool registry 审计。
 *   [2] 去标识化：隔离临时 home；artifact 只含合成 ID/fixture 内容与脱敏帧；
 *       写盘前断言无凭据形状键、无本机绝对路径。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-dsh-transcript-"));
const isolatedHome = path.join(sandbox, "state");
fs.mkdirSync(isolatedHome, { recursive: true });
process.env.SKILL_CREATOR_HOME = isolatedHome;
process.env.DSH_STEWARD_TRANSCRIPT = "1";

async function main(): Promise<void> {
  const { setHomeOverride } = await import("../src/shared/paths.js");
  setHomeOverride(isolatedHome);

  const steward = await import("../src/shared/contracts/skill-steward.js");
  const dshRuntime = await import("../src/shared/contracts/dsh-runtime.js");
  const { createStewardToolRegistry } = await import("../src/daemon/steward/tool-registry.js");
  const { createDshSettingsService } = await import("../src/daemon/steward/dsh-settings.js");
  const { runDshStewardToolRound } = await import("../src/daemon/steward/dsh-agent-runtime.js");
  const { createDshRuntimeAdapter } = await import("../src/daemon/steward/dsh-adapter.js");

  const handshake = createDshRuntimeAdapter().handshake();
  if (handshake.state !== "available") {
    throw new Error(`locked composition unavailable: ${JSON.stringify(handshake)}`);
  }

  const snapshot = steward.SkillStewardContextSnapshotSchema.parse(
    JSON.parse(
      fs.readFileSync(path.join(root, "test/fixtures/steward/snapshot.imported.json"), "utf8"),
    ),
  );

  function makeManager() {
    const calls: import("../src/shared/contracts/skill-steward.js").SkillToolCall[] = [];
    const registry = createStewardToolRegistry({
      runId: steward.StewardRunIdSchema.parse("sr_d5457da7b9c3f001e2a4b6c8"),
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
  }

  const settings = createDshSettingsService();
  const runId = "sr_d5457da7b9c3f001e2a4b6c8";
  const sessionId = "steward-transcript-primary";
  const collector = await settings.createStreamCollector(runId, sessionId);

  const primary = makeManager();
  const primaryRecord = await runDshStewardToolRound({
    sessionId,
    turnText: "Run the steward check task over the imported workspace snapshot.",
    snapshotId: snapshot.id,
    callTool: primary.callTool,
    onCall: (call) => collector.onToolCall(call),
    onStatus: (status) => collector.onStatus(status),
  });
  collector.onTurnStart("Run the steward check task over the imported workspace snapshot.");
  collector.onTurnEnd({
    adapterCalls: primaryRecord.adapterCalls,
    cancelled: primaryRecord.cancelled,
    toolDenied: primaryRecord.toolDenied,
  });
  const frames = await settings.listStreamFrames({});

  const replay = makeManager();
  const replayRecord = await runDshStewardToolRound({
    sessionId: "steward-transcript-replay",
    turnText: "Run the steward check task over the imported workspace snapshot.",
    snapshotId: snapshot.id,
    callTool: replay.callTool,
    onCall: () => undefined,
  });
  const replayIdentical =
    replayRecord.adapterCalls === primaryRecord.adapterCalls &&
    replay.calls.map((call) => call.tool).join(",") ===
      primary.calls.map((call) => call.tool).join(",");

  const cancelRecord = await runDshStewardToolRound({
    sessionId: "steward-transcript-cancel",
    turnText: "Run a long steward analysis.",
    snapshotId: snapshot.id,
    cancelImmediately: true,
    callTool: async () => ({ kind: "ok", value: {} }) as never,
    onCall: () => undefined,
  });

  // ---- 去标识化校验：凭据形状键 + 本机绝对路径都不得出现。 ----
  const artifact = {
    artifactVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    generator: "scripts/dsh-transcript.sh.ts",
    lockedPackages: dshRuntime.DSH_LOCKED_PACKAGES,
    auditedCommit: dshRuntime.DSH_AUDITED_COMMIT,
    handshake: {
      state: handshake.state,
      capabilities: handshake.capabilities,
      rows: handshake.rows.map((row) => ({
        packageName: row.packageName,
        resolvedVersion: row.resolvedVersion,
      })),
    },
    promptVersion: primaryRecord.promptVersion,
    toolVersion: primaryRecord.toolVersion,
    snapshotId: snapshot.id,
    primaryRound: primaryRecord,
    primaryRoundManagerCalls: primary.calls.map((call) => ({
      tool: call.tool,
      principal: call.principal,
      resultKind: (call.result as { kind?: unknown }).kind ?? null,
    })),
    frames,
    replayRound: replayRecord,
    replayIdentical,
    cancelRound: cancelRecord,
  };

  for (const [name, parsed] of [["primaryRound.frames", frames] as const]) {
    for (const frame of parsed) {
      if (!dshRuntime.DshSessionStreamFrameSchema.safeParse(frame).success) {
        throw new Error(`frame failed contract parse (${name})`);
      }
    }
  }
  const serialized = JSON.stringify(artifact, null, 2);
  for (const forbidden of [sandbox, isolatedHome, os.homedir(), os.tmpdir() + "/"]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`artifact leaks local path prefix: ${forbidden}`);
    }
  }
  if (/api[-_]?key|authorization|credential|passphrase|password|secret|token/i.test(serialized)) {
    throw new Error("artifact contains credential-shaped keys");
  }

  const target = path.join(
    root,
    "openspec/changes/dsh-runtime-integration/artifacts/dsh-transcript.json",
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${serialized}\n`, "utf8");
  console.log(`transcript written: ${path.relative(root, target)}`);
  console.log(
    `rounds: primary(adapterCalls=${primaryRecord.adapterCalls}, statuses=${primaryRecord.statuses.join(">")}) ` +
      `replay(identical=${replayIdentical}) cancel(cancelled=${cancelRecord.cancelled}, terminal=${cancelRecord.statuses.at(-1)})`,
  );

  setHomeOverride(null);
}

main()
  .then(() => fs.rmSync(sandbox, { recursive: true, force: true }))
  .catch((error: unknown) => {
    fs.rmSync(sandbox, { recursive: true, force: true });
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
