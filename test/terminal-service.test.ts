/**
 * 人类终端域测试（skills-agent-page task 1.6 daemon 侧；spec delta
 * human-terminal 的全部 Scenario）。
 *
 * 用户原始需求 [2026-10-03]（design §4）：「专用 /ws/terminal 单端点 + typed
 * JSON 协议 + 并发 ≤4 + 10k 行环形缓冲 + stop/idle 有界回收 + 输出 batcher +
 * write reqId 去重 + seq 缺口重放。」
 *
 * 正交意图：
 *   [1] 生命周期与资源界：create/write/resize/exit、第 5 个 create typed 拒绝、
 *       idle 超时回收、dispose SIGHUP→SIGKILL 有界回收（pid 级零孤儿证据）。
 *   [2] 可靠性语义：output seq 单调、write reqId 高水位去重（stdin 恰一次）、
 *       缺口 buffer 重放 / 已裁剪 gap 回执。
 *   [3] 协议与公平：非法帧 typed error 不杀终端、输出有界批次（洪泛不饿死
 *       事件循环——批间 setImmediate 让渡可观测）、/ws/terminal 401 门禁。
 * 妥协声明：PTY 用真实 /bin/sh（确定性：先 stty -echo 消输入回显）；测试退出
 *   显式 dispose + pid ESRCH 证据（子代理常驻进程回收铁律）。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTerminalService,
  TerminalServiceError,
  type TerminalService,
} from "../src/daemon/kernel/terminal/service.js";
import { TerminalOutputBatcher } from "../src/daemon/kernel/terminal/output-batcher.js";
import type {
  TerminalBufferEntry,
  TerminalServerMessage,
  TerminalSessionSubscriber,
} from "../src/daemon/kernel/terminal/protocol.js";

let sandbox = "";
let service: TerminalService | null = null;
/** 本套件 spawn 过的 pty pid（afterEach 兜底回收断言）。 */
const spawnedPids: number[] = [];

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-service-test-"));
});

afterEach(async () => {
  await service?.dispose({ graceMs: 500 }).catch(() => undefined);
  service = null;
  // 兜底证据：本套件 spawn 的 pty 必须全部退出（ESRCH = 进程不存在）。
  const survivors: number[] = [];
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, 0);
      survivors.push(pid);
    } catch {
      // 已退出（期望路径）。
    }
  }
  expect(survivors).toEqual([]);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function makeService(options: Parameters<typeof createTerminalService>[0] = {}): TerminalService {
  service = createTerminalService({ defaultCwd: sandbox, ...options });
  return service;
}

/** 等待谓词为真（有界轮询；终端输出时序天然异步）。 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor: condition not met in time");
}

/** 收集型订阅（直接消费 output 面——不经 socket）。 */
function collector(): TerminalSessionSubscriber & {
  entries: TerminalBufferEntry[];
  notifications: TerminalServerMessage[];
} {
  const entries: TerminalBufferEntry[] = [];
  const notifications: TerminalServerMessage[] = [];
  return {
    entries,
    notifications,
    output(entry) {
      entries.push(entry);
    },
    notify(message) {
      notifications.push(message);
    },
    close() {},
  };
}

/** 新会话 + 禁用终端输入回显（确定性断言基础；reqId 1 归 stty——后续写用 ≥2）。 */
async function bootEcholessSh(target: TerminalService): Promise<string> {
  const created = target.createSession({ shell: "/bin/sh", cwd: sandbox });
  expect(created.replayFrom).toBe(1);
  target.write(created.sessionId, 1, "stty -echo\n");
  await waitFor(() => {
    const info = target.listSessions().find((item) => item.sessionId === created.sessionId);
    return info?.pid !== null && info?.pid !== undefined;
  });
  const pid = target.listSessions().find((item) => item.sessionId === created.sessionId)?.pid;
  if (pid !== null && pid !== undefined) spawnedPids.push(pid);
  // 等 stty 生效（shell 就绪回显一段提示/提示符后静默）。
  await new Promise((resolve) => setTimeout(resolve, 200));
  return created.sessionId;
}

describe("终端生命周期与资源界", () => {
  it("create → write → exit with monotonic seq, then typed errors on the dead session", async () => {
    const target = makeService();
    const sessionId = await bootEcholessSh(target);
    const sub = collector();
    target.attachSubscriber(sessionId, sub);
    expect(target.write(sessionId, 2, "echo MARK_A\n")).toBe("injected");
    await waitFor(() => sub.entries.some((entry) => entry.data.includes("MARK_A")));
    // per-session 单调无缺口（订阅附着前的启动输出不在此流——以首见 seq 为基）。
    const firstSeq = sub.entries[0]?.seq ?? 1;
    for (const [index, entry] of sub.entries.entries()) {
      expect(entry.seq).toBe(firstSeq + index);
    }
    // resize 幂等（终值语义）：同值两次不抛。
    expect(() => target.resize(sessionId, 120, 40)).not.toThrow();
    expect(() => target.resize(sessionId, 120, 40)).not.toThrow();
    expect(target.listSessions().find((item) => item.sessionId === sessionId)?.cols).toBe(120);
    // exit → 进程退出 → exit 通知；此后 write/exit 都是 typed SESSION_EXITED。
    target.exitSession(sessionId);
    await waitFor(
      () => target.listSessions().find((item) => item.sessionId === sessionId)?.alive === false,
    );
    await waitFor(() =>
      sub.notifications.some(
        (message) => message.type === "exit" && message.sessionId === sessionId,
      ),
    );
    expect(() => target.write(sessionId, 9, "x")).toThrowError(TerminalServiceError);
    expect(() => target.write(sessionId, 9, "x")).toThrowError(/already exited/);
    expect(() => target.exitSession(sessionId)).toThrowError(/already exited/);
  });

  it("rejects the 5th concurrent terminal while the first four keep working", async () => {
    const target = makeService();
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push(await bootEcholessSh(target));
    }
    expect(() => target.createSession({ shell: "/bin/sh", cwd: sandbox })).toThrowError(
      /terminal live session limit reached \(4\)/,
    );
    // 既有 4 个不受影响。
    expect(target.write(ids[3]!, 2, "echo STILL_ALIVE\n")).toBe("injected");
  });

  it("reaps an unattached idle session and keeps attached ones alive", async () => {
    const target = makeService({ idleMs: 250 });
    const idleSession = await bootEcholessSh(target);
    const attachedSession = await bootEcholessSh(target);
    const sub = collector();
    target.attachSubscriber(attachedSession, sub);
    await waitFor(
      () => !target.listSessions().some((item) => item.sessionId === idleSession),
      3_000,
    );
    // 附着会话不回收。
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(target.listSessions().some((item) => item.sessionId === attachedSession)).toBe(true);
  });

  it("dispose reaps every PTY within a bounded window (SIGHUP → grace → SIGKILL)", async () => {
    const target = makeService();
    const ids = [await bootEcholessSh(target), await bootEcholessSh(target)];
    const pids = target
      .listSessions()
      .filter((item) => ids.includes(item.sessionId))
      .map((item) => item.pid);
    expect(pids.every((pid) => pid !== null)).toBe(true);
    await target.dispose({ graceMs: 800 });
    expect(target.listSessions()).toEqual([]);
    for (const pid of pids) {
      if (pid === null) continue;
      let gone = false;
      try {
        process.kill(pid, 0);
      } catch {
        gone = true;
      }
      // SIGHUP 后 sh 退出有竞态——有界等待 ESRCH（SIGKILL 升级保底）。
      const deadline = Date.now() + 2_000;
      while (!gone && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        try {
          process.kill(pid, 0);
        } catch {
          gone = true;
        }
      }
      expect(gone).toBe(true);
    }
  });
});

describe("可靠性语义（r4 冻结）", () => {
  it("dedups retried writes by reqId high-water: stdin receives the keystrokes exactly once", async () => {
    const target = makeService();
    const sessionId = await bootEcholessSh(target);
    const sub = collector();
    target.attachSubscriber(sessionId, sub);
    expect(target.write(sessionId, 2, "echo DEDUP\n")).toBe("injected");
    expect(target.write(sessionId, 2, "echo DEDUP\n")).toBe("duplicate");
    expect(target.write(sessionId, 2, "echo DEDUP\n")).toBe("duplicate");
    expect(target.write(sessionId, 3, "echo DEDUP\n")).toBe("injected");
    await waitFor(() => {
      const text = sub.entries.map((entry) => entry.data).join("");
      return (text.match(/DEDUP/g) ?? []).length >= 2;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const text = sub.entries.map((entry) => entry.data).join("");
    // 三次发送（两次重复）→ stdin 恰两次注入 → 输出恰两行 DEDUP。
    expect((text.match(/DEDUP/g) ?? []).length).toBe(2);
  });

  it("replays a seq gap from the ring buffer and reports trimmed ranges as gap", async () => {
    const target = makeService({ maxBufferLines: 3 });
    const sessionId = await bootEcholessSh(target);
    const sub = collector();
    target.attachSubscriber(sessionId, sub);
    for (let index = 0; index < 8; index += 1) {
      target.write(sessionId, index + 2, `echo LINE_${index}\n`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await waitFor(() => sub.entries.some((entry) => entry.data.includes("LINE_7")));
    const replay = target.bufferRange(sessionId, 1, 3);
    expect("gap" in replay).toBe(true);
    if ("gap" in replay) expect(replay.gap).toBeGreaterThan(1);
    // 现存区间可整段回放（seq 与缓冲一致）。
    const firstAvailable = replay.gap;
    const inBuffer = target.bufferRange(sessionId, firstAvailable, firstAvailable + 100);
    expect("entries" in inBuffer).toBe(true);
    if ("entries" in inBuffer) {
      expect(inBuffer.entries.length).toBeGreaterThan(0);
      expect(inBuffer.entries[0]!.seq).toBe(firstAvailable);
      let expected = firstAvailable;
      for (const entry of inBuffer.entries) {
        expect(entry.seq).toBe(expected);
        expected += 1;
      }
    }
  });

  it("delivers contiguous seq across a flood (no gaps between buffer and delivery)", async () => {
    const target = makeService();
    const sessionId = await bootEcholessSh(target);
    const sub = collector();
    target.attachSubscriber(sessionId, sub);
    target.write(sessionId, 2, "head -c 65536 /dev/zero | tr '\\0' 'x'; echo FLOOD_END\n");
    await waitFor(() => sub.entries.some((entry) => entry.data.includes("FLOOD_END")), 15_000);
    let expected = sub.entries[0]?.seq ?? 1;
    for (const entry of sub.entries) {
      expect(entry.seq).toBe(expected);
      expected += 1;
    }
    // 64KiB 洪泛确实经多块投递（环形缓冲行/字节双闸下的整段可达）。
    const total = sub.entries.map((entry) => entry.data).join("");
    expect(total.includes("FLOOD_END")).toBe(true);
  });
});

describe("协议面（非法帧不杀终端 + 401 门禁）", () => {
  /** 最小 fake WS（EventEmitter 结构面 + OPEN/readyState/send/terminate）。 */
  function fakeSocket() {
    const socket = new EventEmitter() as EventEmitter & {
      OPEN: number;
      readyState: number;
      sent: string[];
      send(payload: string): void;
      terminate(): void;
    };
    socket.OPEN = 1;
    socket.readyState = 1;
    const sent: string[] = [];
    socket.sent = sent;
    socket.send = (payload: string): void => {
      sent.push(payload);
    };
    socket.terminate = (): void => {
      socket.readyState = 3;
      socket.emit("close");
    };
    return socket;
  }

  function sentMessages(socket: ReturnType<typeof fakeSocket>): TerminalServerMessage[] {
    return socket.sent.map((payload) => JSON.parse(payload) as TerminalServerMessage);
  }

  it("answers invalid frames with typed errors while the terminal keeps running", async () => {
    const target = makeService();
    const socket = fakeSocket();
    target.attachSocket(socket as never);
    socket.emit("message", "{not json");
    expect(sentMessages(socket).at(-1)).toMatchObject({ type: "error", code: "INVALID_JSON" });
    socket.emit("message", JSON.stringify({ type: "write", sessionId: "x" }));
    expect(sentMessages(socket).at(-1)).toMatchObject({ type: "error", code: "INVALID_MESSAGE" });
    // 合法 create → created ack（replayFrom = 1）。
    socket.emit("message", JSON.stringify({ type: "create", shell: "/bin/sh", cwd: sandbox }));
    const created = sentMessages(socket).find((message) => message.type === "created");
    expect(created).toMatchObject({ type: "created", replayFrom: 1 });
    const sessionId = created?.type === "created" ? created.sessionId : "";
    const info = target.listSessions().find((item) => item.sessionId === sessionId);
    if (info?.pid) spawnedPids.push(info.pid);
    // 非法帧之后终端仍在：合法 write 注入成功，输出回流。
    await new Promise((resolve) => setTimeout(resolve, 150));
    socket.emit("message", JSON.stringify({ type: "write", sessionId, reqId: 2, data: "\n" }));
    await waitFor(() =>
      sentMessages(socket).some(
        (message) => message.type === "output" && message.sessionId === sessionId,
      ),
    );
    // list 控制消息投影（pid 非空 = 进程回收证据面）。
    socket.emit("message", JSON.stringify({ type: "list" }));
    const list = sentMessages(socket).find((message) => message.type === "list");
    expect(list).toBeDefined();
    socket.emit("close");
  });

  it("rejects the /ws/terminal upgrade without the web token (401)", async () => {
    const { createDaemonDomain } = await import("../src/daemon/domain.js");
    const { WebServer } = await import("../src/daemon/web-server.js");
    const { setHomeOverride } = await import("../src/shared/paths.js");
    const previousHome = process.env.SKILL_CREATOR_HOME;
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
    setHomeOverride(path.join(sandbox, "state"));
    const domain = createDaemonDomain(undefined, { probeWarmup: false });
    try {
      const webuiDir = path.join(sandbox, "webui");
      fs.mkdirSync(webuiDir, { recursive: true });
      fs.writeFileSync(webuiDir + "/index.html", "<!doctype html><title>t</title>");
      const web = new WebServer({
        webToken: "terminal-token",
        webuiDir,
        domain,
        status: () => ({
          active: true,
          pid: process.pid,
          version: "test",
          port: 0,
          startedAt: 0,
          tray: "headless",
        }),
      });
      const port = await web.start(0);
      const response = await rawUpgrade(port, "/ws/terminal?token=wrong", "127.0.0.1");
      expect(response).toMatch(/^HTTP\/1\.1 401/);
      // 正确 token 走向 upgrade（101）——鉴权先行的分层证明。
      const accepted = await rawUpgrade(port, "/ws/terminal?token=terminal-token", "127.0.0.1");
      expect(accepted).toMatch(/^HTTP\/1\.1 101/);
      await web.stop({ graceMs: 100 });
    } finally {
      await domain.terminal.dispose({ graceMs: 300 }).catch(() => undefined);
      await domain.repository.dispose().catch(() => undefined);
      setHomeOverride(null);
      if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
      else process.env.SKILL_CREATOR_HOME = previousHome;
    }
  });
});

describe("Scenario: agent 触达不了终端（工具面排除）", () => {
  it("exposes no terminal/pty capability on the Manager agent tool face", async () => {
    const { createDaemonDomain } = await import("../src/daemon/domain.js");
    const { setHomeOverride } = await import("../src/shared/paths.js");
    const previousHome = process.env.SKILL_CREATOR_HOME;
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
    setHomeOverride(path.join(sandbox, "state"));
    const domain = createDaemonDomain(undefined, { probeWarmup: false });
    try {
      // agent 可见能力面（readonly + proposal）不含任何终端工具；终端域也不在
      // capability registry 注册（与内核收窄面正交——人类专用，非 agent 工具）。
      const names = domain.managerCapabilities.names();
      expect(names.some((name) => /terminal|pty/i.test(name))).toBe(false);
      expect(Object.keys(domain).filter((key) => key === "terminal")).toEqual(["terminal"]);
      expect(typeof domain.terminal.attachSocket).toBe("function");
      expect(typeof domain.terminal.createSession).toBe("function");
    } finally {
      await domain.terminal.dispose({ graceMs: 300 }).catch(() => undefined);
      await domain.repository.dispose().catch(() => undefined);
      setHomeOverride(null);
      if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
      else process.env.SKILL_CREATOR_HOME = previousHome;
    }
  });
});

describe("输出 batcher 公平性（openspecui 2026-07-21 饿死修复的复刻验证）", () => {
  it("delivers bounded batches and yields between them (unrelated work keeps running)", async () => {
    const batches: TerminalBufferEntry[][] = [];
    let overflowed = false;
    const batcher = new TerminalOutputBatcher(
      (entries) => {
        batches.push(entries);
      },
      () => {
        overflowed = true;
      },
    );
    let yields = 0;
    const yieldCounter = setInterval(() => {
      yields += 1;
    }, 0);
    // 512KiB 洪泛（512 块 × 1KiB）：批次必须有界（≤16KiB）且分多轮 setImmediate。
    for (let index = 0; index < 512; index += 1) {
      batcher.enqueue({ seq: index + 1, data: "x".repeat(1024) });
    }
    await waitFor(() => batches.length > 0 && !overflowed);
    await new Promise((resolve) => setTimeout(resolve, 300));
    clearInterval(yieldCounter);
    expect(overflowed).toBe(false);
    const totalEntries = batches.reduce((sum, entries) => sum + entries.length, 0);
    expect(totalEntries).toBe(512);
    for (const entries of batches) {
      const bytes = entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.data), 0);
      expect(bytes).toBeLessThanOrEqual(16 * 1024);
    }
    expect(batches.length).toBeGreaterThan(1);
    // 批间让渡可观测：0ms 定时器（与 setImmediate 同轮转深度）持续被服务。
    expect(yields).toBeGreaterThan(0);
  });

  it("queues lifecycle notifications after already-accepted output (afterFlush)", async () => {
    const events: string[] = [];
    const batcher = new TerminalOutputBatcher(
      (entries) => {
        events.push(`batch:${entries.length}`);
      },
      () => undefined,
    );
    batcher.enqueue({ seq: 1, data: "hello" });
    batcher.afterFlush(() => events.push("exit"));
    expect(events).toEqual([]);
    await waitFor(() => events.includes("exit"));
    expect(events[0]).toBe("batch:1");
    expect(events.at(-1)).toBe("exit");
  });
});

/** 裸 HTTP upgrade 探针（返回首行响应状态）。 */
function rawUpgrade(port: number, requestTarget: string, host: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => finish(new Error("upgrade timed out")), 2_000);
    let response = "";
    const finish = (result: string | Error): void => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", finish);
      socket.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      response += chunk.toString("latin1");
      if (!response.includes("\r\n\r\n")) return;
      finish(response.split("\r\n")[0] ?? "");
    };
    socket.on("data", onData);
    socket.on("error", finish);
    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write(
        `GET ${requestTarget} HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n\r\n`,
      );
    });
  });
}
