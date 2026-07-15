/**
 * Request-generation gate behavior tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: stale Workspace list/detail responses
 * must never replace the state produced by a newer request.
 *
 * Orthogonal intents:
 *   [1] Prove a newer request rejects an older late completion.
 *   [2] Prove explicit or owner-generation invalidation rejects outstanding completions.
 */
import { describe, expect, it } from "vitest";
import { createRequestGenerationGate } from "../webui/src/lib/stores/request-generation.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function commitWhenCurrent(
  gate: ReturnType<typeof createRequestGenerationGate>,
  response: Promise<string>,
  commits: string[],
): Promise<void> {
  const request = gate.issue();
  const value = await response;
  if (request.isCurrent()) commits.push(value);
}

describe("request generation gate", () => {
  it("commits only the latest response when requests finish out of order", async () => {
    const gate = createRequestGenerationGate();
    const first = deferred<string>();
    const second = deferred<string>();
    const commits: string[] = [];

    const firstRequest = commitWhenCurrent(gate, first.promise, commits);
    const secondRequest = commitWhenCurrent(gate, second.promise, commits);
    second.resolve("workspace-b");
    await secondRequest;
    first.resolve("workspace-a");
    await firstRequest;

    expect(commits).toEqual(["workspace-b"]);
  });

  it("rejects an outstanding response after its owner invalidates the gate", async () => {
    const gate = createRequestGenerationGate();
    const pending = deferred<string>();
    const commits: string[] = [];

    const request = commitWhenCurrent(gate, pending.promise, commits);
    gate.invalidate();
    pending.resolve("stale-selection");
    await request;

    expect(commits).toEqual([]);
  });

  it("rejects an outstanding response after its external owner changes", async () => {
    let ownerGeneration = 1;
    const gate = createRequestGenerationGate(() => ownerGeneration);
    const ownerRequest = gate.issue();
    ownerGeneration += 1;
    expect(ownerRequest.isLatest()).toBe(true);
    expect(ownerRequest.isCurrent()).toBe(false);

    const pending = deferred<string>();
    const commits: string[] = [];
    const request = commitWhenCurrent(gate, pending.promise, commits);
    ownerGeneration += 1;
    pending.resolve("response-from-disconnected-client");
    await request;

    expect(commits).toEqual([]);
  });
});
