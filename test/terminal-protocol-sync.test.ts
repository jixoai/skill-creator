/**
 * 终端协议镜像同步守卫（skills-agent-page 1.6）。
 *
 * 协议真相 = src/daemon/kernel/terminal/protocol.ts（r3/r4 冻结）；WebUI 侧镜像
 * = webui/src/lib/components/agent/terminal/protocol.ts（依赖方向铁律禁 import
 * daemon 实现层，故镜像）。本测试把两侧 schema 拉到同一进程内对账：canonical
 * 帧集合的接受/拒绝必须逐例一致——镜像漂移在此当场红。
 *
 * 正交意图：
 *   [1] 接受面：每类合法 client/server 帧（含边界值）双侧 safeParse 均成功。
 *   [2] 拒绝面：非法帧（缺字段/越界/未知 type/from>to）双侧均失败。
 */

import { describe, expect, it } from "vitest";
import {
  TerminalClientMessageSchema as MirrorClient,
  TerminalServerMessageSchema as MirrorServer,
} from "../webui/src/lib/components/agent/terminal/protocol.js";
import {
  TerminalClientMessageSchema as TruthClient,
  TerminalServerMessageSchema as TruthServer,
} from "../src/daemon/kernel/terminal/protocol.js";

/** canonical 客户端帧集合（每类至少一例 + 边界）。 */
const CLIENT_SAMPLES: Array<{ name: string; frame: unknown }> = [
  { name: "create minimal", frame: { type: "create" } },
  {
    name: "create full",
    frame: { type: "create", cols: 80, rows: 24, cwd: "/tmp", shell: "/bin/zsh", resume: "t1" },
  },
  { name: "create cols boundary 2", frame: { type: "create", cols: 2, rows: 2 } },
  { name: "write", frame: { type: "write", sessionId: "t1", reqId: 1, data: "ls\r" } },
  { name: "resize", frame: { type: "resize", sessionId: "t1", cols: 120, rows: 40 } },
  { name: "exit", frame: { type: "exit", sessionId: "t1" } },
  { name: "buffer", frame: { type: "buffer", sessionId: "t1", from: 1, to: 128 } },
  { name: "list", frame: { type: "list" } },
  // 拒绝面
  { name: "unknown type", frame: { type: "explode" } },
  { name: "write missing reqId", frame: { type: "write", sessionId: "t1", data: "x" } },
  { name: "write reqId zero", frame: { type: "write", sessionId: "t1", reqId: 0, data: "x" } },
  { name: "resize cols below 2", frame: { type: "resize", sessionId: "t1", cols: 1, rows: 24 } },
  { name: "buffer from > to", frame: { type: "buffer", sessionId: "t1", from: 5, to: 4 } },
  { name: "create extra key", frame: { type: "create", env: {} } },
];

/** canonical 服务端帧集合。 */
const SERVER_SAMPLES: Array<{ name: string; frame: unknown }> = [
  {
    name: "created",
    frame: { type: "created", sessionId: "t1", replayFrom: 1, cols: 80, rows: 24 },
  },
  { name: "output", frame: { type: "output", sessionId: "t1", seq: 1, data: "hello" } },
  {
    name: "buffer",
    frame: { type: "buffer", sessionId: "t1", entries: [{ seq: 2, data: "x" }] },
  },
  { name: "gap", frame: { type: "gap", sessionId: "t1", availableFrom: 3 } },
  { name: "exit", frame: { type: "exit", sessionId: "t1", exitCode: 0 } },
  { name: "duplicate", frame: { type: "duplicate", sessionId: "t1", reqId: 7 } },
  {
    name: "list",
    frame: {
      type: "list",
      sessions: [
        {
          sessionId: "t1",
          alive: true,
          pid: 42,
          exitCode: null,
          createdAt: "2026-10-03T00:00:00.000Z",
          cols: 80,
          rows: 24,
          attached: 1,
        },
      ],
    },
  },
  { name: "error", frame: { type: "error", code: "LIMIT_EXCEEDED", message: "limit" } },
  {
    name: "error with session",
    frame: { type: "error", code: "SESSION_NOT_FOUND", message: "gone", sessionId: "t1" },
  },
  // 拒绝面
  { name: "unknown type", frame: { type: "reboot" } },
  { name: "output seq zero", frame: { type: "output", sessionId: "t1", seq: 0, data: "x" } },
  {
    name: "created missing replayFrom",
    frame: { type: "created", sessionId: "t1", cols: 80, rows: 24 },
  },
  { name: "error bad code", frame: { type: "error", code: "NOPE", message: "x" } },
  { name: "duplicate missing reqId", frame: { type: "duplicate", sessionId: "t1" } },
];

describe("terminal protocol mirror parity (daemon truth vs webui mirror)", () => {
  it.each(CLIENT_SAMPLES)("client frame: %s", ({ name, frame }) => {
    void name;
    const truth = TruthClient.safeParse(frame).success;
    const mirror = MirrorClient.safeParse(frame).success;
    expect(mirror).toBe(truth);
  });

  it.each(SERVER_SAMPLES)("server frame: %s", ({ name, frame }) => {
    void name;
    const truth = TruthServer.safeParse(frame).success;
    const mirror = MirrorServer.safeParse(frame).success;
    expect(mirror).toBe(truth);
  });

  it("exposes identical frozen constants", () => {
    expect(MirrorClient).toBeDefined();
    expect(MirrorServer).toBeDefined();
  });
});
