/**
 * Steward workflow store 单测（openspec steward-product-workflow task 4.1）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.1）：「scope/task/runtime config and run
 * projection survive reconnect with latest-request-wins semantics inside the DSH host。」
 *
 * 正交意图：
 *   [1] 选择语义：per-target 键控 + toggle 去重 + instructions 钳制 + 显式重置。
 *   [2] latest-request-wins：迟到的 startRun/settings 响应不得覆盖新状态；
 *       断线（owner generation 变化）后回落的旧响应不得提交。
 *   [3] 重连存活：选择与 run 投影在连接世代更替后保持；新连接可继续提交。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  generation: 0,
  rpc: null as unknown,
}));

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => connection.generation,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
}));

import {
  applyStewardRuntimeConfigPatch,
  clampInstructions,
  loadStewardRuntimeConfig,
  resetStewardWorkflowSelections,
  runtimeConfigState,
  selectionFor,
  startStewardWorkflowRun,
  toggleSelectedSkill,
  workflowRunState,
  workflowTargetKey,
  STEWARD_INSTRUCTIONS_MAX,
} from "../stores/steward-workflow.svelte";
import type { WorkspaceProviderTarget } from "$shared/contracts/workspaces.js";

const targetA: WorkspaceProviderTarget = {
  workspaceId: "ws_aaaaaaaaaaaaaaaa" as WorkspaceProviderTarget["workspaceId"],
  providerId: "openclaw" as WorkspaceProviderTarget["providerId"],
};
const targetB: WorkspaceProviderTarget = {
  workspaceId: "ws_bbbbbbbbbbbbbbbb" as WorkspaceProviderTarget["workspaceId"],
  providerId: "openclaw" as WorkspaceProviderTarget["providerId"],
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const runResult = (terminal: string) => ({
  snapshotId: "snap_test0000000000000000000",
  terminal,
  acceptedResponses: 1,
  droppedLateResponses: 0,
  toolCalls: 2,
  proposals: [],
});

const settingsView = {
  settings: {
    configVersion: 1,
    revision: 3,
    model: { provider: "deepseek", model: "v4" },
    preset: "deterministic",
    permissions: { approvalPolicy: "ask" },
    session: { streamRetention: 60, streamProjection: 40 },
  },
  providers: [],
};

beforeEach(() => {
  connection.generation = 0;
  connection.rpc = null;
  resetStewardWorkflowSelections();
  runtimeConfigState.view = null;
  runtimeConfigState.loading = false;
  runtimeConfigState.error = null;
  workflowRunState.run = null;
  workflowRunState.targetKey = null;
  workflowRunState.starting = false;
  workflowRunState.error = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("steward workflow selection (task 4.1 stores)", () => {
  it("keys selection per provider target and toggles skills without duplicates", () => {
    const a = selectionFor(targetA);
    const b = selectionFor(targetB);
    expect(a).not.toBe(b);

    toggleSelectedSkill(targetA, "sk_first" as never);
    toggleSelectedSkill(targetA, "sk_first" as never);
    expect(a.selectedSkillIds).toEqual([]);
    toggleSelectedSkill(targetA, "sk_first" as never);
    toggleSelectedSkill(targetA, "sk_second" as never);
    expect(a.selectedSkillIds).toEqual(["sk_first", "sk_second"]);
    expect(b.selectedSkillIds).toEqual([]);

    a.taskKind = "organize";
    expect(selectionFor(targetA).taskKind).toBe("organize");
    expect(selectionFor(targetB).taskKind).toBe("check");

    resetStewardWorkflowSelections();
    expect(selectionFor(targetA).selectedSkillIds).toEqual([]);
  });

  it("clamps instructions to the contract bound", () => {
    expect(clampInstructions("short")).toBe("short");
    const tooLong = "x".repeat(STEWARD_INSTRUCTIONS_MAX + 50);
    expect(clampInstructions(tooLong)).toHaveLength(STEWARD_INSTRUCTIONS_MAX);
  });
});

describe("latest-request-wins run projection", () => {
  it("a slow earlier start cannot overwrite a newer run", async () => {
    const slow = deferred<unknown>();
    const fastResult = runResult("fast terminal");
    connection.rpc = {
      skillSteward: {
        startRun: (input: { taskKind: string }) =>
          input.taskKind === "check" ? slow.promise : Promise.resolve(fastResult),
      },
    };
    const selection = selectionFor(targetA);
    selection.taskKind = "check";
    const first = startStewardWorkflowRun(targetA);
    selection.taskKind = "optimize";
    const second = startStewardWorkflowRun(targetA);
    expect(await second).toBe(fastResult);
    expect(workflowRunState.run).toBe(fastResult);

    slow.resolve(runResult("slow stale terminal"));
    expect(await first).toBeNull();
    expect(workflowRunState.run).toBe(fastResult);
    expect(workflowRunState.starting).toBe(false);
  });

  it("a response landing after reconnect (owner generation bump) never commits", async () => {
    const inFlight = deferred<unknown>();
    connection.rpc = {
      skillSteward: { startRun: () => inFlight.promise },
    };
    const pending = startStewardWorkflowRun(targetA);
    // 断线 + 重连：owner generation 变化，旧响应失去提交资格。
    connection.generation += 1;
    connection.rpc = {
      skillSteward: { startRun: () => Promise.resolve(runResult("after reconnect")) },
    };
    inFlight.resolve(runResult("stale across reconnect"));
    expect(await pending).toBeNull();
    expect(workflowRunState.run).toBeNull();

    // 选择在重连后原样存活，新连接的 run 正常提交。
    const selection = selectionFor(targetA);
    expect(selection.taskKind).toBe("check");
    const committed = await startStewardWorkflowRun(targetA);
    expect(committed?.terminal).toBe("after reconnect");
    expect(workflowRunState.targetKey).toBe(workflowTargetKey(targetA));
  });

  it("records the typed error when the connection is unavailable", async () => {
    connection.rpc = null;
    await startStewardWorkflowRun(targetA);
    expect(workflowRunState.error).toContain("not connected");
    expect(workflowRunState.run).toBeNull();
  });
});

describe("runtime config projection", () => {
  it("commits updated views, returns typed rejections untouched, and drops stale patches", async () => {
    connection.rpc = {
      dsh: {
        settings: {
          get: () => Promise.resolve(settingsView),
          update: () =>
            Promise.resolve({
              outcome: "rejected",
              code: "PRESET_REQUIRES_CREDENTIAL",
              detail: "live preset needs a configured provider",
            }),
        },
      },
    };
    await loadStewardRuntimeConfig();
    expect(runtimeConfigState.view).toBe(settingsView);
    expect(runtimeConfigState.error).toBeNull();

    const rejected = await applyStewardRuntimeConfigPatch({
      preset: "live",
    });
    expect(rejected).toEqual({
      outcome: "rejected",
      code: "PRESET_REQUIRES_CREDENTIAL",
      detail: "live preset needs a configured provider",
    });
    // rejected 不动已提交视图。
    expect(runtimeConfigState.view).toBe(settingsView);

    // 迟到补丁：新请求已覆盖旧补丁，旧响应不得提交。
    const stale = deferred<unknown>();
    const fresh = deferred<unknown>();
    let call = 0;
    connection.rpc = {
      dsh: {
        settings: {
          get: () => Promise.resolve(settingsView),
          update: () => {
            call += 1;
            return call === 1 ? stale.promise : fresh.promise;
          },
        },
      },
    };
    const stalePatch = applyStewardRuntimeConfigPatch({ preset: "live" });
    const freshPatch = applyStewardRuntimeConfigPatch({ preset: "deterministic" });
    stale.resolve({
      outcome: "updated",
      changed: true,
      previousRevision: 3,
      revision: 4,
      view: settingsView,
    });
    expect(await stalePatch).toBeNull();
    fresh.resolve({
      outcome: "updated",
      changed: true,
      previousRevision: 3,
      revision: 5,
      view: settingsView,
    });
    expect((await freshPatch) as { revision?: number }).toMatchObject({ revision: 5 });
  });
});
