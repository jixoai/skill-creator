/**
 * 面板会话转录存储单测（产品持久层：sessions/YYYY/MM/DD/<sessionId>）。
 *
 * 用户原始需求 [2026-09-08]：「将会话存储到 ~/.skill-creator/sessions/ 目录，
 * 基于时间归类 YYYY/MM/DD/sessionid」。
 *
 * 正交意图：
 *   [1] write-through / 回放 round-trip：meta.json + frames.jsonl 逐行追加与
 *       safeParse 读回（seq 升序）。
 *   [2] 降级法则：损坏行丢弃；未知 sessionId 追加为 no-op；跨实例（同根目录）
 *       hydrate 可见。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionTranscripts } from "../src/daemon/kernel/session-transcripts.js";
import type { DshSessionStreamFrame } from "../src/shared/contracts/dsh-runtime.js";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "session-transcripts-test-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function frame(seq: number, kind: string, text?: string): DshSessionStreamFrame {
  return {
    at: "2026-09-08T00:00:00.000Z",
    runId: "agent-t",
    sessionId: "agent-t",
    seq,
    kind: kind as DshSessionStreamFrame["kind"],
    ...(text !== undefined ? { text } : {}),
  };
}

describe("session transcripts store", () => {
  it("round-trips frames through YYYY/MM/DD directories with seq ordering", () => {
    const store = createSessionTranscripts(root);
    store.recordStart({
      sessionId: "agent-t",
      title: "",
      createdAt: "2026-09-08T10:30:00.000Z",
      cwd: "/tmp/ws",
    });
    store.append("agent-t", frame(0, "user-text", "hello"));
    store.append("agent-t", frame(1, "turn-start"));
    store.append("agent-t", frame(2, "assistant-text", "hi"));

    // 日期归类：sessions/2026/09/08/agent-t。
    expect(fs.existsSync(path.join(root, "2026", "09", "08", "agent-t", "frames.jsonl"))).toBe(
      true,
    );

    const metas = store.listAll();
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ sessionId: "agent-t", cwd: "/tmp/ws" });

    const frames = store.readFrames("agent-t");
    expect(frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(frames[0]).toMatchObject({ kind: "user-text", text: "hello" });
  });

  it("drops corrupt lines and skips unknown session appends", () => {
    const store = createSessionTranscripts(root);
    store.recordStart({
      sessionId: "agent-t",
      title: "",
      createdAt: "2026-09-08T10:30:00.000Z",
      cwd: "/tmp",
    });
    store.append("agent-t", frame(0, "turn-start"));
    store.append("agent-unknown", frame(9, "turn-start")); // no-op：未 recordStart。
    const dir = path.join(root, "2026", "09", "08", "agent-t");
    fs.appendFileSync(path.join(dir, "frames.jsonl"), "{not json}\n");
    fs.appendFileSync(path.join(dir, "frames.jsonl"), JSON.stringify({ seq: 5 }) + "\n");

    const frames = store.readFrames("agent-t");
    expect(frames.map((f) => f.seq)).toEqual([0]);
  });

  it("hydrates an existing directory tree in a fresh store instance", () => {
    const first = createSessionTranscripts(root);
    first.recordStart({
      sessionId: "agent-a",
      title: "",
      createdAt: "2026-09-07T23:59:00.000Z",
      cwd: "/tmp",
    });
    first.append("agent-a", frame(0, "user-text", "q"));

    const second = createSessionTranscripts(root);
    expect(second.listAll().map((meta) => meta.sessionId)).toEqual(["agent-a"]);
    expect(second.readFrames("agent-a")).toHaveLength(1);
  });
});
