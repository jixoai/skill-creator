/**
 * DSH settings/credentials/session-stream 测试（openspec dsh-runtime-integration task 3.3）。
 *
 * User input [2026-09-06] (tasks 3.3): "runtime settings/config revision and session
 * streams are available to the later DSH client plugin; credentials are redacted
 * from run/audit payloads."
 *
 * Orthogonal intents:
 *   [1] Settings lifecycle: defaults, revision increments, persisted reload,
 *       typed rejections for cross-field violations.
 *   [2] Credential safety: 0600 private storage; settings view echoes the key
 *       per user decree (R16) while run/audit payloads keep structural
 *       redaction; no-fallback preset resolution.
 *   [3] Session stream projection through the public RPC router: redacted,
 *       bounded, retention/projection honored.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain } from "../src/daemon/domain.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { createStewardAuditStore } from "../src/daemon/steward/audit-store.js";
import {
  createDshSettingsService,
  dshBridgeModelEntry,
} from "../src/daemon/steward/dsh-settings.js";
import { runDshStewardToolRound } from "../src/daemon/steward/dsh-agent-runtime.js";
import type { DshModelRoute } from "../src/shared/contracts/dsh-runtime.js";
import { DSH_REDACTED, redactDshPayload } from "../src/shared/contracts/dsh-runtime.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
const previousDshHome = process.env.DSH_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-dsh-settings-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  // 凭据桥写 $DSH_HOME/.credentials.yaml：必须沙箱隔离，否则测试会污染真实
  // ~/.dsh（内核严格校验下顶层平铺键会打挂下一次 boot）。
  process.env.DSH_HOME = path.join(sandbox, "dsh");
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function createClient() {
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
      domain: createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() }),
    }),
  );
}

describe("redactDshPayload", () => {
  it("redacts credential-shaped keys at any depth, preserves other values", () => {
    const input = {
      provider: "deepseek",
      apiKey: "sk-live-1",
      nested: { authorization: "Bearer x", model: "m", list: [{ token: "t" }, { ok: 2 }] },
    };
    const output = redactDshPayload(input) as Record<string, unknown>;
    expect(output.provider).toBe("deepseek");
    expect(output.apiKey).toBe(DSH_REDACTED);
    const nested = output.nested as Record<string, unknown>;
    expect(nested.authorization).toBe(DSH_REDACTED);
    expect(nested.model).toBe("m");
    expect((nested.list as Array<Record<string, unknown>>)[0]!.token).toBe(DSH_REDACTED);
    expect((nested.list as Array<Record<string, unknown>>)[1]!.ok).toBe(2);
  });
});

describe("DshSettingsService", () => {
  it("starts from defaults with revision 0 and no providers", async () => {
    const service = createDshSettingsService();
    const view = await service.getView();
    expect(view.settings.revision).toBe(0);
    expect(view.settings.preset).toBe("deterministic");
    expect(view.settings.permissions.approvalPolicy).toBe("ask");
    expect(view.settings.session).toEqual({
      streamRetention: 100,
      streamProjection: "enabled",
      sessionCleanupDays: 30,
    });
    expect(view.settings.defaultMode).toBe("free");
    expect(view.providers).toEqual([]);
  });

  it("applies a defaultMode patch and counts it as a real change", async () => {
    const service = createDshSettingsService();
    const result = await service.update({ defaultMode: "explore" });
    expect(result.outcome).toBe("updated");
    if (result.outcome === "updated") {
      expect(result.changed).toBe(true);
      expect(result.revision).toBe(1);
    }
    // 同值补丁是 no-op；旧持久化文件（无 defaultMode）读为 create。
    const noOp = await service.update({ defaultMode: "explore" });
    if (noOp.outcome === "updated") expect(noOp.changed).toBe(false);
    else throw new Error("expected updated");
    const reloaded = await createDshSettingsService().getView();
    expect(reloaded.settings.defaultMode).toBe("explore");
  });

  it("applies a patch, bumps revision once, and reloads from disk", async () => {
    const service = createDshSettingsService();
    const result = await service.update({
      model: { provider: "deepseek", model: "deepseek-chat" },
      permissions: { approvalPolicy: "never" },
    });
    expect(result.outcome).toBe("updated");
    if (result.outcome === "updated") {
      expect(result.changed).toBe(true);
      expect(result.revision).toBe(1);
    }
    const noOp = await service.update({});
    if (noOp.outcome === "updated") {
      expect(noOp.changed).toBe(false);
      expect(noOp.revision).toBe(1);
    } else throw new Error("expected updated");
    // 新实例从盘读取：持久化生效。
    const reloaded = await createDshSettingsService().getView();
    expect(reloaded.settings.revision).toBe(1);
    expect(reloaded.settings.model).toEqual({ provider: "deepseek", model: "deepseek-chat" });
    expect(reloaded.settings.permissions.approvalPolicy).toBe("never");
  });

  it("rejects live preset without a credential and applies nothing", async () => {
    const service = createDshSettingsService();
    const rejected = await service.update({
      model: { provider: "deepseek", model: "x" },
      preset: "live",
    });
    expect(rejected).toMatchObject({ outcome: "rejected", code: "PRESET_REQUIRES_CREDENTIAL" });
    // 补丁是原子的：preset 校验失败时 model 变更也不落盘。
    const view = await service.getView();
    expect(view.settings.preset).toBe("deterministic");
    expect(view.settings.model.provider).toBe("steward-deterministic");
    expect(view.settings.revision).toBe(0);
  });

  it("accepts live preset after storing a credential and bumps revision for it", async () => {
    const service = createDshSettingsService();
    await service.update({ model: { provider: "deepseek", model: "deepseek-chat" } });
    const stored = await service.setCredential({ provider: "deepseek", apiKey: "  sk-secret-1  " });
    expect(stored.outcome).toBe("stored");
    if (stored.outcome === "stored") {
      // R16 用户裁决：视图客观回显 apiKey（password 掩码展示）。
      expect(stored.view.providers).toEqual([
        { provider: "deepseek", configured: true, apiKey: "sk-secret-1" },
      ]);
      expect(JSON.stringify(stored.view)).toContain("sk-secret-1"); // R16 客观回显
    }
    const live = await service.update({ preset: "live" });
    expect(live.outcome).toBe("updated");
  });

  it("rejects invalid API keys via the DSH normalizeApiKey contract", async () => {
    const service = createDshSettingsService();
    const rejected = await service.setCredential({ provider: "deepseek", apiKey: "   " });
    expect(rejected).toMatchObject({ outcome: "rejected", code: "INVALID_API_KEY" });
  });

  it("stores credentials in a 0600 private file and echoes the key per user decree (R16)", async () => {
    const service = createDshSettingsService();
    await service.setCredential({ provider: "deepseek", apiKey: "sk-secret-2" });
    const file = path.join(sandbox, "state", "steward-store", "dsh-credentials.json");
    const stat = fs.statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
    const view = await service.getView();
    // R16 用户裁决：key 客观回显（password 掩码展示）。
    expect(JSON.stringify(view)).toContain("sk-secret-2");
  });

  it("resolves deterministic preset; live without credential fails with no fallback", async () => {
    const service = createDshSettingsService();
    const deterministic = await service.resolveRuntimePreset();
    expect(deterministic).toMatchObject({
      outcome: "deterministic",
      model: { provider: "steward-deterministic", model: "steward-echo" },
    });
    // 清掉 live 依赖的凭据是允许的；resolve 必须类型化失败而不是回退。
    await service.setCredential({ provider: "deepseek", apiKey: "sk-secret-3" });
    await service.update({
      model: { provider: "deepseek", model: "deepseek-chat" },
      preset: "live",
    });
    await service.clearCredential({ provider: "deepseek" });
    const failed = await service.resolveRuntimePreset();
    expect(failed).toMatchObject({ outcome: "failed", code: "CREDENTIAL_MISSING" });
  });

  it("projects incompatible persisted settings to defaults without writing", async () => {
    const dir = path.join(sandbox, "state", "steward-store");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "dsh-settings.json");
    fs.writeFileSync(file, JSON.stringify({ configVersion: 99, nonsense: true }), "utf8");
    const view = await createDshSettingsService().getView();
    expect(view.settings.revision).toBe(0);
    expect(view.settings.preset).toBe("deterministic");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ configVersion: 99 });
  });

  it("surfaces filesystem read failures as typed UNAVAILABLE", async () => {
    const dir = path.join(sandbox, "state", "steward-store");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "dsh-settings.json");
    fs.writeFileSync(file, "{}", "utf8");
    fs.chmodSync(file, 0o000);
    try {
      await expect(createDshSettingsService().getView()).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
    } finally {
      fs.chmodSync(file, 0o600);
    }
  });
});

describe("session stream projection", () => {
  it("collects frames through a real DSH tool round", async () => {
    const service = createDshSettingsService();
    const collector = await service.createStreamCollector("sr_dsh_round_0001", "sess-stream-1");
    const record = await runDshStewardToolRound({
      sessionId: "sess-stream-1",
      turnText: "stream round",
      snapshotId: "snap-stream-1",
      callTool: async () => ({ status: "ok", summary: { totalSkills: 2 } }) as never,
      onCall: (call) => collector.onToolCall(call),
      onStatus: (status) => collector.onStatus(status),
    });
    collector.onTurnStart("stream round");
    collector.onTurnEnd({ adapterCalls: record.adapterCalls, cancelled: false, toolDenied: false });
    const frames = await service.listStreamFrames({});
    const kinds = frames.map((frame) => frame.kind);
    expect(kinds).toContain("turn-start");
    expect(kinds).toContain("status");
    expect(kinds).toContain("tool-call");
    expect(kinds).toContain("tool-result");
    expect(kinds).toContain("turn-end");
    expect(frames.every((frame) => frame.seq >= 1)).toBe(true);
    // runId 过滤命中本轮帧。
    const scoped = await service.listStreamFrames({ runId: "sr_dsh_round_0001" });
    expect(scoped.length).toBe(frames.length);
  });

  it("redacts credential-shaped payload values in stream frames", async () => {
    const service = createDshSettingsService();
    await service.appendStreamFrame({
      at: new Date().toISOString(),
      runId: "sr_redact",
      sessionId: "sess-redact",
      kind: "tool-result",
      toolName: "skills.propose",
      payload: { apiKey: "sk-direct-leak", nested: { accessToken: "t" } },
    });
    const frames = await service.listStreamFrames({});
    const serialized = JSON.stringify(frames);
    expect(serialized).not.toContain("sk-direct-leak");
    expect(serialized).toContain(DSH_REDACTED);
  });

  it("honors retention bounds and runId filtering", async () => {
    const service = createDshSettingsService();
    await service.update({ session: { streamRetention: 10, streamProjection: "enabled" } });
    const collector = await service.createStreamCollector("sr_a", "sess-a");
    for (let index = 0; index < 40; index += 1) {
      collector.onStatus(`status-${index}`);
    }
    const all = await service.listStreamFrames({});
    expect(all.length).toBeLessThanOrEqual(10);
    const other = await service.createStreamCollector("sr_b", "sess-b");
    other.onStatus("other");
    const onlyA = await service.listStreamFrames({ runId: "sr_a" });
    expect(onlyA.every((frame) => frame.runId === "sr_a")).toBe(true);
    const limited = await service.listStreamFrames({ limit: 2 });
    expect(limited.length).toBe(2);
    expect(limited[0]!.text).toBe("status-39");
  });

  it("drops frames when stream projection is disabled", async () => {
    const service = createDshSettingsService();
    await service.update({ session: { streamRetention: 10, streamProjection: "disabled" } });
    const collector = await service.createStreamCollector("sr_off", "sess-off");
    collector.onTurnStart("nope");
    const frames = await service.listStreamFrames({});
    expect(frames).toEqual([]);
    await service.appendStreamFrame({
      at: new Date().toISOString(),
      runId: "sr_off",
      sessionId: "sess-off",
      kind: "status",
      text: "direct",
    });
    const after = await service.listStreamFrames({});
    expect(after).toEqual([]);
  });
});

describe("steward audit-store redaction", () => {
  it("redacts credential-shaped keys from run and audit payloads at rest", async () => {
    const store = createStewardAuditStore();
    await store.appendRun({
      runId: "sr_leak",
      snapshotId: "snap",
      terminal: "completed",
      endedAt: "2026-09-06T00:00:00.000Z",
      apiKey: "sk-run-leak",
    } as never);
    const runsFile = path.join(sandbox, "state", "steward-store", "runs.jsonl");
    const line = fs.readFileSync(runsFile, "utf8").trim();
    expect(line).not.toContain("sk-run-leak");
    expect(JSON.parse(line)).toMatchObject({ apiKey: DSH_REDACTED, runId: "sr_leak" });
  });
});

describe("dsh RPC surface", () => {
  it("exposes settings/credentials/sessions through the public router", async () => {
    const client = createClient();
    const initial = await client.agent.settings.get({});
    expect(initial.settings.preset).toBe("deterministic");
    const rejected = await client.agent.settings.update({ preset: "live" });
    expect(rejected).toMatchObject({ outcome: "rejected", code: "PRESET_REQUIRES_CREDENTIAL" });
    await client.agent.credentials.set({ provider: "deepseek", apiKey: "sk-rpc-1" });
    const updated = await client.agent.settings.update({
      model: { provider: "deepseek", model: "deepseek-chat" },
      preset: "live",
    });
    expect(updated.outcome).toBe("updated");
    const view = await client.agent.settings.get({});
    expect(view.settings.preset).toBe("live");
    expect(view.providers).toEqual([
      { provider: "deepseek", configured: true, apiKey: "sk-rpc-1" },
    ]);
    expect(JSON.stringify(view)).toContain("sk-rpc-1"); // R16 客观回显
    const { frames } = await client.agent.sessions.streams({});
    expect(Array.isArray(frames)).toBe(true);
    await client.agent.credentials.clear({ provider: "deepseek" });
    const cleared = await client.agent.settings.get({});
    expect(cleared.providers).toEqual([]);
  });
});

describe("DSH credentials bridge writes the kernel version-1 layout", () => {
  // 内核 credentials-local（0.1.5-rc.2）严格校验：顶层仅 version/refs/records；
  // 平铺键打挂下一次 boot（2026-09-12 R2 实测回归）。
  it("nests route keys under refs and stamps version: 1", async () => {
    const service = createDshSettingsService();
    const stored = await service.setCredential({ provider: "zai", apiKey: "sk-shape-1" });
    expect(stored.outcome).toBe("stored");
    const file = path.join(process.env.DSH_HOME ?? "", ".credentials.yaml");
    const doc = parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(doc.version).toBe(1);
    const refs = doc.refs as Record<string, unknown>;
    expect(refs.ZAI_API_KEY).toBe("sk-shape-1");
    expect(Object.keys(doc).filter((k) => !["version", "refs", "records"].includes(k))).toEqual([]);
  });

  it("migrates legacy flat top-level keys into refs on the next write", async () => {
    const dsh = process.env.DSH_HOME ?? "";
    fs.mkdirSync(dsh, { recursive: true });
    fs.writeFileSync(
      path.join(dsh, ".credentials.yaml"),
      [
        "version: 1",
        "refs:",
        "  OPENAI_API_KEY: sk-keep",
        "records: {}",
        "DEEPSEEK_API_KEY: sk-flat",
        "SKILL_CREATOR_ROUTE_KEY_zai: sk-old",
        "",
      ].join("\n"),
    );
    const service = createDshSettingsService();
    await service.setCredential({ provider: "zai", apiKey: "sk-shape-2" });
    const doc = parse(fs.readFileSync(path.join(dsh, ".credentials.yaml"), "utf8")) as {
      [k: string]: unknown;
      refs?: Record<string, unknown>;
    };
    expect(doc.DEEPSEEK_API_KEY).toBeUndefined();
    expect(doc.SKILL_CREATOR_ROUTE_KEY_zai).toBeUndefined();
    expect(doc.refs?.ZAI_API_KEY).toBe("sk-shape-2");
    expect(doc.refs?.DEEPSEEK_API_KEY).toBe("sk-flat");
    expect(doc.refs?.OPENAI_API_KEY).toBe("sk-keep");
  });

  it("clear removes the ref and keeps the version-1 layout", async () => {
    const service = createDshSettingsService();
    await service.setCredential({ provider: "zai", apiKey: "sk-shape-3" });
    const cleared = await service.clearCredential({ provider: "zai" });
    expect(cleared.providers).toEqual([]);
    const file = path.join(process.env.DSH_HOME ?? "", ".credentials.yaml");
    const doc = parse(fs.readFileSync(file, "utf8")) as {
      version?: unknown;
      refs?: Record<string, unknown>;
    };
    expect(doc.refs?.ZAI_API_KEY).toBeUndefined();
    expect(doc.version).toBe(1);
  });
});

describe("model route rich-field round-trip (R7)", () => {
  /** 富字段路由 fixture：覆盖全部产品级字段（models 五新键 + 路由级三 UI 键）。 */
  const richRoute: DshModelRoute = {
    provider: "local-gateway",
    api: "anthropic-messages",
    baseURL: "http://localhost:20002/anthropic",
    icon: "data:image/png;base64,AAAA",
    iconLetter: "G",
    iconColor: "#7c3aed",
    models: [
      {
        id: "glm-5.3",
        name: "GLM 5.3",
        efforts: ["low", "medium", "high"],
        contextWindow: 131072,
        maxOutputTokens: 16384,
        inputTypes: ["text", "image"],
        outputTypes: ["text"],
      },
      { id: "glm-5.3-air", name: "GLM 5.3 Air" },
    ],
  };

  it("dshBridgeModelEntry extracts only id + contextWindow (explicit whitelist)", () => {
    expect(
      dshBridgeModelEntry({
        id: "m1",
        name: "Model",
        efforts: ["high"],
        contextWindow: 1000,
        maxOutputTokens: 512,
        inputTypes: ["text"],
        outputTypes: ["text"],
      }),
    ).toEqual({ id: "m1", contextWindow: 1000 });
    expect(dshBridgeModelEntry({ id: "m2", name: "Bare" })).toEqual({ id: "m2" });
  });

  it("persists the full rich route in steward-store and reloads it intact", async () => {
    const service = createDshSettingsService();
    const result = await service.update({ modelRoutes: [richRoute] });
    expect(result.outcome).toBe("updated");
    if (result.outcome !== "updated") throw new Error("expected updated");
    expect(result.changed).toBe(true);
    // 新服务实例从盘读取：富字段经 DshStewardSettingsSchema safeParse 完整保留
    //（持久化真源是 steward-store JSON，不是 DSH yaml）。
    const reloaded = await createDshSettingsService().getView();
    expect(reloaded.settings.modelRoutes).toEqual([richRoute]);
    expect(reloaded.settings.modelRoutes[0]?.models[0]?.efforts).toEqual(["low", "medium", "high"]);
    expect(reloaded.settings.modelRoutes[0]?.models[0]?.maxOutputTokens).toBe(16384);
    expect(reloaded.settings.modelRoutes[0]?.models[0]?.inputTypes).toEqual(["text", "image"]);
    expect(reloaded.settings.modelRoutes[0]?.iconLetter).toBe("G");
    expect(reloaded.settings.modelRoutes[0]?.iconColor).toBe("#7c3aed");
    // no-op：同路由整表替换不动 revision。
    const noOp = await createDshSettingsService().update({ modelRoutes: [richRoute] });
    if (noOp.outcome === "updated") expect(noOp.changed).toBe(false);
    else throw new Error("expected updated");
  });

  it("writes only id/contextWindow model keys and no UI fields into the DSH yaml", async () => {
    const service = createDshSettingsService();
    await service.update({ modelRoutes: [richRoute] });
    const file = path.join(process.env.DSH_HOME ?? "", "settings.yaml");
    const raw = fs.readFileSync(file, "utf8");
    const doc = parse(raw) as {
      "llm-pi-ai"?: { providers?: Record<string, Record<string, unknown>> };
    };
    const provider = doc["llm-pi-ai"]?.providers?.["local-gateway"];
    expect(provider).toBeDefined();
    // 路由级：仅 apiKeyEnv/api/baseURL/models 四键；icon 一族不进 DSH profile。
    expect(Object.keys(provider ?? {}).sort()).toEqual(
      ["api", "apiKeyEnv", "baseURL", "models"].sort(),
    );
    // 模型级：keys ⊆ {id, contextWindow}（产品级富字段桥接层剥离）。
    const models = (provider?.models ?? []) as Array<Record<string, unknown>>;
    expect(models.length).toBe(2);
    for (const model of models) {
      expect(Object.keys(model).every((key) => key === "id" || key === "contextWindow")).toBe(true);
    }
    expect(models[0]).toEqual({ id: "glm-5.3", contextWindow: 131072 });
    expect(models[1]).toEqual({ id: "glm-5.3-air" });
    // yaml 全文不含任何产品级新键（pi-ai profile 未知键会被内核拒收）。
    for (const banned of [
      "iconLetter",
      "iconColor",
      "icon",
      "name:",
      "efforts",
      "maxOutputTokens",
      "inputTypes",
      "outputTypes",
      "GLM 5.3",
      "#7c3aed",
    ]) {
      expect(raw).not.toContain(banned);
    }
  });

  it("keeps legacy persisted routes (id-only models) loadable via safeParse", async () => {
    // R7 之前的持久形状：models 只有 {id}（或 {id, contextWindow}）——新字段全部
    // optional，旧数据必须原样通过（破坏性更新不迁移、不拒绝）。
    const dir = path.join(sandbox, "state", "steward-store");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dsh-settings.json"),
      JSON.stringify({
        configVersion: 1,
        revision: 7,
        model: { provider: "deepseek", model: "deepseek-chat" },
        preset: "deterministic",
        permissions: { approvalPolicy: "ask" },
        session: { streamRetention: 100, streamProjection: "enabled" },
        defaultMode: "free",
        modelRoutes: [
          {
            provider: "zai",
            api: "anthropic-messages",
            baseURL: "https://api.z.ai/api/anthropic",
            models: [{ id: "glm-4.7" }, { id: "glm-4.7-flash", contextWindow: 131072 }],
          },
        ],
      }),
      "utf8",
    );
    const view = await createDshSettingsService().getView();
    expect(view.settings.revision).toBe(7);
    expect(view.settings.modelRoutes[0]?.models).toEqual([
      { id: "glm-4.7" },
      { id: "glm-4.7-flash", contextWindow: 131072 },
    ]);
  });
});
