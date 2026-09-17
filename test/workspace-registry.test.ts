/**
 * Workspace Registry module contract tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: concurrent projections and mutations must
 * preserve every authoritative imported Workspace transition.
 * User input [2026-07-22]: "home 目录定义为特殊的 GlobalWorkspace；一个 Workspace 下可以包含多个 providers。"
 *
 * Orthogonal intents:
 *   [1] Prove Global and Imported Workspace Provider scopes stay isolated.
 *   [2] Prove non-destructive persistence and recovery from incompatible stale state.
 *   [3] Prove asynchronous projections cannot overwrite or hide newer mutations.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ListOptions } from "ccski";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import {
  GLOBAL_WORKSPACE_ID,
  ImportedWorkspaceIdSchema,
  ProviderIdSchema,
  type WorkspaceId,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { appDir, setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
const previousCodexHome = process.env.CODEX_HOME;
let sandbox = "";
const openClawProviderId = ProviderIdSchema.parse("openclaw");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-workspace-registry-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  process.env.CODEX_HOME = path.join(sandbox, "codex");
  setHomeOverride(isolatedHome);
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function directory(...segments: string[]): string {
  const result = path.join(sandbox, ...segments);
  fs.mkdirSync(result, { recursive: true });
  return result;
}

/** 零技能 lister 桩（合一后计数与去重键都来自它）。 */
function zeroList(): Promise<readonly { directoryName: string }[]> {
  return Promise.resolve([]);
}

function target(workspaceId: WorkspaceId): WorkspaceProviderTarget {
  return { workspaceId, providerId: openClawProviderId };
}

function activeId(
  workspaces: Awaited<ReturnType<ReturnType<typeof createWorkspaceRegistry>["list"]>>,
) {
  return workspaces.find((workspace) => workspace.active)?.id;
}

function deferredCounter(): {
  count: (options: ListOptions) => Promise<number>;
  started: Promise<void>;
  release: () => void;
} {
  let signalStarted: () => void = () => {};
  let signalRelease: () => void = () => {};
  let shouldPause = true;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    signalRelease = resolve;
  });

  return {
    started,
    release: signalRelease,
    list: async (options) => {
      if (shouldPause && options.customDirs?.[0]) {
        shouldPause = false;
        signalStarted();
        await released;
      }
      const size = options.customDirs?.[0]?.length ?? 7;
      return Array.from({ length: size }, (_, index) => ({ directoryName: `skill-${index}` }));
    },
  };
}

function deferredRejectingCounter(directory: string): {
  count: (options: ListOptions) => Promise<number>;
  started: Promise<void>;
  reject: () => void;
} {
  let signalStarted: () => void = () => {};
  let rejectCount: (error: Error) => void = () => {};
  let shouldReject = true;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const rejected = new Promise<never>((_resolve, reject) => {
    rejectCount = reject;
  });

  return {
    started,
    reject: () => rejectCount(new Error("Forgotten Workspace is unavailable.")),
    list: async (options) => {
      if (shouldReject && options.customDirs?.[0] === directory) {
        shouldReject = false;
        signalStarted();
        return rejected;
      }
      return [];
    },
  };
}

describe("Workspace Registry", () => {
  it("assigns unique IDs and resolves Global/Imported Provider scopes", async () => {
    const registry = createWorkspaceRegistry({ listSkills: zeroList });
    const commonRoot = ["organizations", "engineering", "skills"];
    const firstPath = directory(...commonRoot, "frontend");
    const secondPath = directory(...commonRoot, "backend");

    const first = registry.import(firstPath);
    const second = registry.import(secondPath);

    const global = (await registry.list())[0];
    if (!global || global.kind !== "global") throw new Error("Expected Global Workspace.");

    expect(first.id).toMatch(/^ws_[a-f0-9]{24}$/);
    expect(second.id).toMatch(/^ws_[a-f0-9]{24}$/);
    expect(first.id).not.toBe(second.id);
    expect((await registry.list()).map((workspace) => workspace.id)).toEqual([
      GLOBAL_WORKSPACE_ID,
      first.id,
      second.id,
    ]);
    expect(global.providers).toContainEqual(
      expect.objectContaining({ id: ProviderIdSchema.parse("codex"), writable: false }),
    );
    expect(registry.resolve(target(first.id)).options).toEqual({
      customDirs: [path.join(fs.realpathSync(firstPath), "skills")],
      customProvider: openClawProviderId,
      scanDefaultDirs: false,
      all: true,
    });
    expect(() => registry.resolveWritable(target(GLOBAL_WORKSPACE_ID))).toThrow(
      "Global Workspace providers are not writable installation targets.",
    );
  });

  it("persists active state across restart and forgets without deleting files", async () => {
    const firstRegistry = createWorkspaceRegistry({ listSkills: zeroList });
    const firstPath = directory("first");
    const secondPath = directory("second");
    const marker = path.join(firstPath, "keep.txt");
    fs.writeFileSync(marker, "preserve", "utf8");
    const first = firstRegistry.import(firstPath, "First");
    const second = firstRegistry.import(secondPath, "Second");
    firstRegistry.activate(first.id);

    const restarted = createWorkspaceRegistry({ listSkills: zeroList });
    expect(activeId(await restarted.list())).toBe(first.id);
    expect(restarted.resolve(target(second.id)).directory).toBe(
      path.join(fs.realpathSync(secondPath), "skills"),
    );

    restarted.forget(first.id);
    expect(fs.readFileSync(marker, "utf8")).toBe("preserve");
    expect(activeId(await restarted.list())).toBe(GLOBAL_WORKSPACE_ID);

    const persisted = fs.readFileSync(path.join(appDir(), "workspaces.json"), "utf8");
    expect(persisted).not.toContain("skillCount");
    expect(persisted).toContain('"schemaVersion": 2');
  });

  it("treats an incompatible persisted Registry as empty until a mutation commits v2", async () => {
    const legacySource = JSON.stringify({ schemaVersion: 1, activeId: "~", workspaces: [] });
    fs.mkdirSync(appDir(), { recursive: true });
    const registryFile = path.join(appDir(), "workspaces.json");
    fs.writeFileSync(registryFile, legacySource, "utf8");

    const registry = createWorkspaceRegistry({ listSkills: zeroList });
    expect((await registry.list()).map((workspace) => workspace.id)).toEqual([GLOBAL_WORKSPACE_ID]);
    expect(fs.readFileSync(registryFile, "utf8")).toBe(legacySource);

    const imported = registry.import(directory("current"));
    expect(JSON.parse(fs.readFileSync(registryFile, "utf8"))).toMatchObject({
      schemaVersion: 2,
      activeId: imported.id,
      workspaces: [expect.objectContaining({ id: imported.id })],
    });
  });

  it("treats a Registry file that is not valid JSON as empty state", async () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(path.join(appDir(), "workspaces.json"), "{", "utf8");

    const registry = createWorkspaceRegistry({ listSkills: zeroList });
    expect((await registry.list()).map((workspace) => workspace.id)).toEqual([GLOBAL_WORKSPACE_ID]);
  });

  it("surfaces an unreadable Registry file as a hard error, not an empty Registry", async () => {
    if (
      process.platform === "win32" ||
      (typeof process.getuid === "function" && process.getuid() === 0)
    ) {
      return; // chmod cannot deny reads for root; the EACCES vector is untestable there
    }
    fs.mkdirSync(appDir(), { recursive: true });
    const registryFile = path.join(appDir(), "workspaces.json");
    fs.writeFileSync(registryFile, JSON.stringify({ schemaVersion: 2, workspaces: [] }), "utf8");
    fs.chmodSync(registryFile, 0o000);

    try {
      expect(() => createWorkspaceRegistry({ listSkills: zeroList })).toThrow(
        /Cannot read workspace registry/,
      );
      // 原文件必须原样保留：数据不兼容才会投影为空 Registry，I/O 故障不能伪装。
      fs.chmodSync(registryFile, 0o644);
      expect(fs.existsSync(registryFile)).toBe(true);
    } finally {
      fs.chmodSync(registryFile, 0o644);
    }
  });

  it("rejects unknown IDs without changing the active Workspace", async () => {
    const registry = createWorkspaceRegistry({ listSkills: zeroList });
    const known = registry.import(directory("known"));
    const unknownId = ImportedWorkspaceIdSchema.parse("ws_000000000000000000000000");

    expect(() => registry.resolve(target(unknownId))).toThrow(`Workspace not found: ${unknownId}`);
    expect(() => registry.activate(unknownId)).toThrow(`Workspace not found: ${unknownId}`);
    expect(() => registry.forget(unknownId)).toThrow(`Workspace not found: ${unknownId}`);
    expect(activeId(await registry.list())).toBe(known.id);
  });

  it("discards a persisted Workspace ID that does not belong to its path", async () => {
    const registry = createWorkspaceRegistry({ listSkills: zeroList });
    const known = registry.import(directory("known"));
    const forgedId = ImportedWorkspaceIdSchema.parse("ws_000000000000000000000000");
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({
        schemaVersion: 2,
        activeId: forgedId,
        workspaces: [{ id: forgedId, label: known.label, path: known.path }],
      }),
      "utf8",
    );

    const recovered = createWorkspaceRegistry({ listSkills: zeroList });
    expect((await recovered.list()).map((workspace) => workspace.id)).toEqual([
      GLOBAL_WORKSPACE_ID,
    ]);
  });

  it("discards a relative persisted Workspace path", async () => {
    const relativeId = ImportedWorkspaceIdSchema.parse("ws_2cf26298d998c2a65f9bc237");
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({
        schemaVersion: 2,
        activeId: relativeId,
        workspaces: [{ id: relativeId, label: "Relative", path: "relative/workspace" }],
      }),
      "utf8",
    );

    const recovered = createWorkspaceRegistry({ listSkills: zeroList });
    expect((await recovered.list()).map((workspace) => workspace.id)).toEqual([
      GLOBAL_WORKSPACE_ID,
    ]);
  });

  it("discards a non-normalized persisted Workspace path", async () => {
    const canonicalPath = directory("normalized");
    const storedPath = `${canonicalPath}${path.sep}..${path.sep}${path.basename(canonicalPath)}`;
    const storedId = ImportedWorkspaceIdSchema.parse(
      `ws_${createHash("sha256").update(storedPath).digest("hex").slice(0, 24)}`,
    );
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({
        schemaVersion: 2,
        activeId: storedId,
        workspaces: [{ id: storedId, label: "Normalized", path: storedPath }],
      }),
      "utf8",
    );

    const recovered = createWorkspaceRegistry({ listSkills: zeroList });
    expect((await recovered.list()).map((workspace) => workspace.id)).toEqual([
      GLOBAL_WORKSPACE_ID,
    ]);
  });

  it("restarts a projection when a Workspace is imported while counts are pending", async () => {
    const counter = deferredCounter();
    const registry = createWorkspaceRegistry({ listSkills: counter.list });
    const firstPath = directory("first");
    fs.mkdirSync(path.join(firstPath, "skills"));
    const first = registry.import(firstPath);

    const pendingList = registry.list();
    await counter.started;
    const second = registry.import(directory("second"));
    counter.release();

    const projected = await pendingList;
    expect(projected.map((workspace) => workspace.id)).toEqual([
      GLOBAL_WORKSPACE_ID,
      first.id,
      second.id,
    ]);
    expect(activeId(projected)).toBe(second.id);

    const restarted = createWorkspaceRegistry({ listSkills: zeroList });
    expect((await restarted.list()).map((workspace) => workspace.id)).toContain(second.id);
  });

  it("projects the latest forget and activation while counts are pending", async () => {
    const counter = deferredCounter();
    const registry = createWorkspaceRegistry({ listSkills: counter.list });
    const firstPath = directory("first");
    fs.mkdirSync(path.join(firstPath, "skills"));
    const first = registry.import(firstPath);
    const second = registry.import(directory("second"));
    registry.activate(first.id);

    const pendingList = registry.list();
    await counter.started;
    registry.forget(first.id);
    registry.activate(second.id);
    counter.release();

    const projected = await pendingList;
    expect(projected.map((workspace) => workspace.id)).toEqual([GLOBAL_WORKSPACE_ID, second.id]);
    expect(activeId(projected)).toBe(second.id);
    expect(fs.existsSync(firstPath)).toBe(true);
  });

  it("discards a stale count failure after its Workspace is forgotten", async () => {
    const firstPath = directory("first");
    const firstSkillsPath = path.join(firstPath, "skills");
    fs.mkdirSync(firstSkillsPath);
    const counter = deferredRejectingCounter(fs.realpathSync(firstSkillsPath));
    const registry = createWorkspaceRegistry({ listSkills: counter.list });
    const first = registry.import(firstPath);
    const second = registry.import(directory("second"));

    const pendingList = registry.list();
    await counter.started;
    registry.forget(first.id);
    counter.reject();

    const projected = await pendingList;
    expect(projected.map((workspace) => workspace.id)).toEqual([GLOBAL_WORKSPACE_ID, second.id]);
    expect(activeId(projected)).toBe(second.id);
  });
});

describe("Workspace Registry de-duplicated skill counts", () => {
  /**
   * 构造按 customDirs[0] 返回固定技能目录列表的 lister。
   * 同一根目录被多次查询时返回同一份列表（模拟两个 Provider 共享同一物理根）。
   */
  function listerReturning(
    skillsByRoot: Record<string, string[]>,
  ): (options: ListOptions) => Promise<readonly { directoryName: string }[]> {
    return async (options) => {
      const root = options.customDirs?.[0] ?? "";
      // 列表查询对根目录存在性不敏感（测试桩），直接按 key 返回。
      const normalizedKey = Object.keys(skillsByRoot).find(
        (key) => path.resolve(key) === path.resolve(root),
      );
      return (normalizedKey ? skillsByRoot[normalizedKey] : []).map((directoryName) => ({
        directoryName,
      }));
    };
  }

  /** 单遍合一后计数的旧行为等价性由 listerReturning 直接覆盖（entries.length）。 */

  it("counts a shared-root skill once at Workspace level but in each Provider", async () => {
    // cline 与 codex 都把 workspacePath 解析到 .agents/skills —— 共享同一物理根。
    const workspacePath = directory("shared-root");
    fs.mkdirSync(path.join(workspacePath, ".agents", "skills"), { recursive: true });
    // 根键用 realpath：importedProviderRoot 基于 canonical(realpath) 派生，需与之一致。
    const sharedRoot = fs.realpathSync(path.join(workspacePath, ".agents", "skills"));

    const skillsByRoot: Record<string, string[]> = {
      [sharedRoot]: ["my-skill", "other-skill"],
    };

    const registry = createWorkspaceRegistry({
      listSkills: listerReturning(skillsByRoot),
    });
    registry.import(workspacePath, "Shared");

    const projected = await registry.list();
    const imported = projected.find((ws) => ws.kind === "directory");
    if (!imported || imported.kind !== "directory") throw new Error("Expected imported Workspace.");

    // cline 与 codex 各自仍报告 2 个技能（Provider 级不去重）。
    const cline = imported.providers.find((p) => p.id === "cline");
    const codex = imported.providers.find((p) => p.id === "codex");
    expect(cline?.skillCount).toBe(2);
    expect(codex?.skillCount).toBe(2);

    // Workspace 级按 canonical root 去重：两个 Provider 共享同一根，技能只计 2 次（不是 4）。
    expect(imported.skillCount).toBe(2);
  });

  it("counts same-named skills separately when they live under different roots", async () => {
    const workspacePath = directory("distinct-roots");
    fs.mkdirSync(path.join(workspacePath, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, ".claude", "skills"), { recursive: true });
    const agentsRoot = fs.realpathSync(path.join(workspacePath, ".agents", "skills"));
    const claudeRoot = fs.realpathSync(path.join(workspacePath, ".claude", "skills"));

    const skillsByRoot: Record<string, string[]> = {
      [agentsRoot]: ["shared-tool"],
      [claudeRoot]: ["shared-tool"],
    };

    const registry = createWorkspaceRegistry({
      listSkills: listerReturning(skillsByRoot),
    });
    registry.import(workspacePath, "Distinct");

    const projected = await registry.list();
    const imported = projected.find((ws) => ws.kind === "directory");
    if (!imported || imported.kind !== "directory") throw new Error("Expected imported Workspace.");

    // 不同 canonical 根下的同名技能不去重：Workspace 级计为 2。
    expect(imported.skillCount).toBe(2);
  });

  // （perf-firstscreen 合一后「仅 counter 无 lister → 回退不去重 sum」的路径
  // 退役：单一 lister 总是同时产出计数与去重键，去重语义恒定。）
});

describe("Workspace Registry single-pass scan (perf-firstscreen B-3)", () => {
  /**
   * 用户原始需求 [2026-09-18]：「性能很差，经常 loading」——此前 counter 与
   * lister 各跑一遍 ccski 全量扫描；合一后每个存在的 root 只允许一次
   * discovery，计数与去重键来自同一份结果。
   */
  it("scans each root exactly once per list()", async () => {
    const workspacePath = directory("single-pass");
    fs.mkdirSync(path.join(workspacePath, ".agents", "skills"), { recursive: true });
    const agentsRoot = fs.realpathSync(path.join(workspacePath, ".agents", "skills"));
    // 键含 provider：多 provider 共享同一物理根是 per-provider 扫描（customProvider
    // 参与投影语义）；合一消除的是「count 遍 + lister 遍」的双遍，不是合并 provider。
    const callsByProviderRoot = new Map<string, number>();
    const registry = createWorkspaceRegistry({
      listSkills: async (options) => {
        const key = `${options.customProvider ?? "?"}:${path.resolve(options.customDirs?.[0] ?? "")}`;
        callsByProviderRoot.set(key, (callsByProviderRoot.get(key) ?? 0) + 1);
        return [{ directoryName: "only-skill" }];
      },
    });
    registry.import(workspacePath, "SinglePass");

    const projected = await registry.list();
    const imported = projected.find((ws) => ws.kind === "directory");
    if (!imported || imported.kind !== "directory") throw new Error("Expected imported.");

    // 每个 (provider, root) 组合恰好一次（v1 会是两次：counter 遍 + lister 遍）。
    for (const calls of callsByProviderRoot.values()) {
      expect(calls).toBe(1);
    }
    expect(callsByProviderRoot.size).toBeGreaterThan(0);
    // shared root（.agents/skills 同时映射 cline 与 codex）按 provider 各一次。
    expect(callsByProviderRoot.get(`cline:${path.resolve(agentsRoot)}`)).toBe(1);
    expect(callsByProviderRoot.get(`codex:${path.resolve(agentsRoot)}`)).toBe(1);
  });
});
