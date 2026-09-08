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
      mode: "create",
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
    expect(metas[0]).toMatchObject({ sessionId: "agent-t", cwd: "/tmp/ws", mode: "create" });

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
      mode: "free",
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
      mode: "manage",
    });
    first.append("agent-a", frame(0, "user-text", "q"));

    const second = createSessionTranscripts(root);
    expect(second.listAll().map((meta) => meta.sessionId)).toEqual(["agent-a"]);
    expect(second.listAll()[0]?.mode).toBe("manage");
    expect(second.readFrames("agent-a")).toHaveLength(1);
  });

  it("updates mode and title atomically and reads missing/invalid mode as free", () => {
    const store = createSessionTranscripts(root);
    store.recordStart({
      sessionId: "agent-m",
      title: "",
      createdAt: "2026-09-08T11:00:00.000Z",
      cwd: "/tmp",
      mode: "create",
    });
    expect(store.updateMode("agent-m", "explore")).toBe(true);
    expect(store.listAll().find((meta) => meta.sessionId === "agent-m")?.mode).toBe("explore");
    // 未知会话与同模式 no-op。
    expect(store.updateMode("agent-unknown", "free")).toBe(false);
    expect(store.updateMode("agent-m", "explore")).toBe(true);
    expect(store.listAll().find((meta) => meta.sessionId === "agent-m")?.mode).toBe("explore");

    // 标题：内核 session/title 事件的持久面；空标题与同值 no-op。
    expect(store.updateTitle("agent-m", "Counting probe")).toBe(true);
    expect(store.updateTitle("agent-m", "  Counting probe  ")).toBe(true);
    expect(store.updateTitle("agent-m", "  ")).toBe(false);
    expect(store.updateTitle("agent-unknown", "x")).toBe(false);
    expect(store.listAll().find((meta) => meta.sessionId === "agent-m")?.title).toBe(
      "Counting probe",
    );

    // 旧会话无 mode 字段 → free（其创建时即全工具面的事实投影）；非法值同理。
    store.recordStart({
      sessionId: "agent-legacy",
      title: "",
      createdAt: "2026-09-08T12:00:00.000Z",
      cwd: "/tmp",
      mode: "free",
    });
    const legacyDir = path.join(root, "2026", "09", "08", "agent-legacy");
    fs.writeFileSync(
      path.join(legacyDir, "meta.json"),
      `${JSON.stringify({
        sessionId: "agent-legacy",
        title: "",
        createdAt: "2026-09-08T12:00:00.000Z",
        cwd: "/tmp",
      })}\n`,
    );
    const reread = createSessionTranscripts(root);
    expect(reread.listAll().find((meta) => meta.sessionId === "agent-legacy")?.mode).toBe("free");
  });
});
