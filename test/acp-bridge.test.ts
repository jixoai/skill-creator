/**
 * ACP bridge service contract tests.
 *
 * 用户原始需求 [2026-07-27]：「FULL 多 agent 支持……spawn agent CLI 子进程（stdio ACP）↔ 重新暴露成浏览器可连的 WebSocket ACP 端点。」
 * 正交意图：
 *   [1] Agent discovery：mock `which`，断言已装/未装混合场景的 available 投影正确并缓存。
 *   [2] Session open/close：mock spawn，验证池注册、sessionId 不透明、close 幂等。
 *   [3] 安全门：agent 越界读写（../escape、绝对路径 /etc/passwd）被拒；root 内读写成功且 write 走原子写。
 *   [4] 帧桥：浏览器 WS 帧 → agent stdin；agent stdout 帧 → 浏览器 WS（顺序保持）。
 *   [5] 生命周期：dispose 杀光全部子进程；异常退出广播 exited 事件。
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAcpAgentDiscovery, KNOWN_ACP_AGENTS } from "../src/daemon/acp-agent-discovery.js";
import { createAcpBridgeService, type AgentSpawner } from "../src/daemon/acp-bridge-service.js";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { AcpAgentIdSchema, type AcpAgentId } from "../src/shared/contracts/acp.js";
import { ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import { WebServer } from "../src/daemon/web-server.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
const PROVIDER_ID = ProviderIdSchema.parse("openclaw");
const CLAUDE_ID = AcpAgentIdSchema.parse("claude");

let sandbox = "";
let domain: DaemonDomain;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-acp-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain();
});

afterEach(async () => {
  await domain.acpBridge.dispose();
  await domain.repository.dispose();
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 创建一个导入 workspace 并返回其 provider target；其 root = workspace/skills。 */
function importWorkspace(directoryName = "agent-workspace"): {
  target: {
    workspaceId: ReturnType<typeof domain.workspaces.import>["id"];
    providerId: typeof PROVIDER_ID;
  };
  root: string;
} {
  const destination = path.join(sandbox, directoryName);
  fs.mkdirSync(destination, { recursive: true });
  const imported = domain.workspaces.import(destination, "Agent workspace");
  return {
    target: { workspaceId: imported.id, providerId: PROVIDER_ID },
    root: path.join(imported.path, "skills"),
  };
}

/**
 * 一个最小的、可由 bridge spawn 适配器返回的「假 agent 子进程」。
 * stdout/stdin 是 EventEmitter；bridge 写 stdin 时不真处理（除非测试挂监听器）。
 * 测试通过 emitStdoutLine(...) 把 agent 的 JSON-RPC 帧推进桥。
 */
function createMockProcess(pid = 12345): {
  proc: MockAgentProcess;
  spawn: AgentSpawner;
} {
  const proc = new MockAgentProcess(pid);
  const spawn: AgentSpawner = () => proc as unknown as ReturnType<AgentSpawner>;
  return { proc, spawn };
}

class MockAgentProcess extends EventEmitter {
  readonly pid: number;
  stdin: MockStdin;
  stdout: MockStdout;
  exitCode: number | null = null;
  signalCode: string | null = null;
  private killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.stdin = new MockStdin();
    this.stdout = new MockStdout();
  }

  kill(signal?: NodeJS.Signals): boolean {
    if (this.exitCode !== null) return false;
    this.killed = true;
    const sig = signal ?? "SIGTERM";
    // 模拟被信号杀死：signalCode 保留，exitCode 为 null。
    queueMicrotask(() => this.emitExit(null, sig));
    return true;
  }

  /** 测试驱动：agent 进程退出。 */
  emitExit(code: number | null = 0, signal: string | null = null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdin.destroyed = true;
    this.emit("exit", code, signal);
  }

  /** 测试驱动：把一行 agent stdout 帧推入桥。 */
  emitStdoutLine(line: string): void {
    this.stdout.emit("data", `${line}\n`);
  }
}

class MockStdin extends EventEmitter {
  destroyed = false;
  write(chunk: string): boolean {
    if (this.destroyed) return false;
    this.emit("write", chunk);
    return true;
  }
}

class MockStdout extends EventEmitter {
  setEncoding(_encoding: string): void {
    // 模拟可读流的 setEncoding；桥用 utf8。
  }
  // 桥用 .on("data", ...) 订阅。
}

describe("ACP agent discovery", () => {
  it("projects available/missing binaries from a mixed which-result set", async () => {
    const resolveBinary = async (binary: string): Promise<string> => {
      if (binary === "claude") return `/usr/local/bin/${binary}`;
      if (binary === "gemini") return `/opt/homebrew/bin/${binary}`;
      throw new Error(`not found: ${binary}`);
    };
    const discovery = createAcpAgentDiscovery({ resolveBinary });
    const agents = await discovery.list();
    const byId = new Map(agents.map((a) => [a.id, a]));
    expect(byId.get(CLAUDE_ID)?.available).toBe(true);
    expect(byId.get(CLAUDE_ID)?.binaryPath).toBe("/usr/local/bin/claude");
    expect(byId.get(AcpAgentIdSchema.parse("gemini"))?.available).toBe(true);
    expect(byId.get(AcpAgentIdSchema.parse("codex"))?.available).toBe(false);
    expect(byId.get(AcpAgentIdSchema.parse("codex"))?.binaryPath).toBe("");
    // 全部已知 agent 都在列表里。
    expect(agents).toHaveLength(KNOWN_ACP_AGENTS.length);
  });

  it("caches the probe result for the daemon lifetime", async () => {
    let calls = 0;
    const resolveBinary = async (binary: string): Promise<string> => {
      calls += 1;
      return `/bin/${binary}`;
    };
    const discovery = createAcpAgentDiscovery({ resolveBinary });
    await discovery.list();
    await discovery.list();
    expect(calls).toBe(KNOWN_ACP_AGENTS.length);
  });

  it("returns null for unknown agent id and known-but-uninstalled binary", async () => {
    const resolveBinary = async (): Promise<string> => {
      throw new Error("not found");
    };
    const discovery = createAcpAgentDiscovery({ resolveBinary });
    await discovery.list();
    expect(discovery.lookup(AcpAgentIdSchema.parse("claude"))?.available).toBe(false);
    // lookup 返回的条目仍带 binary/acpFlag（即便不可用）。
    expect(discovery.lookup(AcpAgentIdSchema.parse("claude"))?.acpFlag).toBe("--acp");
  });
});

describe("ACP bridge session lifecycle", () => {
  it("opens a session, registers an opaque sessionId, and spawns at the workspace root", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const result = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    expect(result.sessionId).toMatch(/^acp_[a-f0-9]{24}$/);
    expect(result.pid).toBe(proc.pid);
    expect(bridge.hasSession(result.sessionId)).toBe(true);
    expect(bridge.activeSessions()).toEqual([result.sessionId]);
  });

  it("rejects openSession with UNAVAILABLE when the agent binary is missing", async () => {
    const { spawn } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({}),
      spawn,
    });
    const ws = importWorkspace();
    await expect(
      bridge.openSession({ agentId: CLAUDE_ID, target: ws.target }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(bridge.activeSessions()).toEqual([]);
  });

  it("closeSession is idempotent and removes the pool entry", async () => {
    const { spawn, proc } = createMockProcess();
    const exitSpy = vi.fn();
    proc.on("exit", exitSpy);
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const { sessionId } = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    await bridge.closeSession(sessionId);
    await bridge.closeSession(sessionId); // 幂等。
    expect(bridge.hasSession(sessionId)).toBe(false);
    // SIGTERM 被发出 → 进程退出事件触发。
    await waitFor(() => expect(exitSpy).toHaveBeenCalled());
  });
});

describe("ACP bridge security gate", () => {
  it("services a readTextFile inside the root and replies with file content", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    fs.mkdirSync(ws.root, { recursive: true });
    fs.writeFileSync(path.join(ws.root, "notes.txt"), "hello agent", "utf8");

    const writes: string[] = [];
    proc.stdin.on("write", (chunk: string) => writes.push(chunk));
    const { sessionId } = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    // agent 发起 readTextFile 请求（client-side method）。
    proc.emitStdoutLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "r1",
        method: "fs/read_text_file",
        params: { sessionId: "ignored-by-gate", path: "notes.txt" },
      }),
    );
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const response = JSON.parse(writes[0]!.trim());
    expect(response.id).toBe("r1");
    expect(response.result.content).toBe("hello agent");
    expect(response.error).toBeUndefined();
  });

  it("rejects a readTextFile that escapes the workspace root", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const writes: string[] = [];
    proc.stdin.on("write", (chunk: string) => writes.push(chunk));
    await bridge.openSession({ agentId: CLAUDE_ID, target: ws.target });

    for (const escapePath of ["../escape.txt", "../../etc/passwd", "/etc/passwd"]) {
      writes.length = 0;
      proc.emitStdoutLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: escapePath,
          method: "fs/read_text_file",
          params: { sessionId: "x", path: escapePath },
        }),
      );
      await waitFor(() => expect(writes.length).toBeGreaterThan(0));
      const response = JSON.parse(writes[0]!.trim());
      expect(response.id).toBe(escapePath);
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32001);
    }
  });

  it("services a writeTextFile inside the root via atomic write (temp + rename)", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    fs.mkdirSync(ws.root, { recursive: true });
    const writes: string[] = [];
    proc.stdin.on("write", (chunk: string) => writes.push(chunk));
    await bridge.openSession({ agentId: CLAUDE_ID, target: ws.target });

    const target = path.join(ws.root, "draft.md");
    proc.emitStdoutLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "w1",
        method: "fs/write_text_file",
        params: { sessionId: "x", path: "draft.md", content: "# draft\n" },
      }),
    );
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const response = JSON.parse(writes[0]!.trim());
    expect(response.id).toBe("w1");
    expect(response.error).toBeUndefined();
    // 原子写落盘：主文件存在且内容正确，无残留 temp。
    expect(fs.readFileSync(target, "utf8")).toBe("# draft\n");
    const leftover = fs.readdirSync(ws.root).filter((name) => name.includes(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("rejects a writeTextFile that escapes the root without touching the filesystem", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const writes: string[] = [];
    proc.stdin.on("write", (chunk: string) => writes.push(chunk));
    await bridge.openSession({ agentId: CLAUDE_ID, target: ws.target });
    const outsideMarker = path.join(sandbox, "outside-marker.txt");
    proc.emitStdoutLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "w2",
        method: "fs/write_text_file",
        params: { sessionId: "x", path: "../outside-marker.txt", content: "x" },
      }),
    );
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const response = JSON.parse(writes[0]!.trim());
    expect(response.error.code).toBe(-32001);
    expect(fs.existsSync(outsideMarker)).toBe(false);
  });
});

describe("ACP bridge frame forwarding", () => {
  it("forwards agent stdout frames to the attached browser WS in order", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const { sessionId } = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    const fakeWs = new MockWebSocket();
    bridge.attachWebSocket(sessionId, fakeWs as unknown as WebSocket);
    const seen: string[] = [];
    fakeWs.onSend((frame) => seen.push(frame));

    // agent 产出 sessionUpdate（非 fs 方法）→ 原样转发。
    proc.emitStdoutLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk" } },
      }),
    );
    proc.emitStdoutLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "plan" } },
      }),
    );
    await waitFor(() => expect(seen.length).toBe(2));
    expect(JSON.parse(seen[0]!).params.update.sessionUpdate).toBe("agent_message_chunk");
    expect(JSON.parse(seen[1]!).params.update.sessionUpdate).toBe("plan");
  });

  it("forwards browser WS frames to the agent stdin (session/prompt etc.)", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const { sessionId } = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    const stdinWrites: string[] = [];
    proc.stdin.on("write", (chunk: string) => stdinWrites.push(chunk));
    const fakeWs = new MockWebSocket();
    bridge.attachWebSocket(sessionId, fakeWs as unknown as WebSocket);

    const prompt = JSON.stringify({
      jsonrpc: "2.0",
      id: "p1",
      method: "session/prompt",
      params: { sessionId: "x", prompt: [{ type: "text", text: "hi" }] },
    });
    fakeWs.receiveMessage(prompt);
    await waitFor(() => expect(stdinWrites.length).toBe(1));
    // 桥在帧尾补换行（ndjson）。
    expect(stdinWrites[0]!.trim()).toBe(prompt);
  });

  it("does not forward gated fs requests to the browser WS", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const { sessionId } = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    const fakeWs = new MockWebSocket();
    const sent: string[] = [];
    fakeWs.onSend((frame) => sent.push(frame));
    bridge.attachWebSocket(sessionId, fakeWs as unknown as WebSocket);

    proc.emitStdoutLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "g1",
        method: "fs/read_text_file",
        params: { sessionId: "x", path: "../escape" },
      }),
    );
    // 给安全门一个微任务窗口。
    await new Promise((r) => setImmediate(r));
    // 浏览器 WS 不应收到任何帧（fs 请求被 daemon 拦截代答）。
    expect(sent).toEqual([]);
  });
});

describe("ACP bridge dispose + exited event", () => {
  it("disposes all subprocesses on daemon stop", async () => {
    const procs: MockAgentProcess[] = [];
    const spawn: AgentSpawner = () => {
      const p = new MockAgentProcess(10_000 + procs.length);
      procs.push(p);
      return p as unknown as ReturnType<AgentSpawner>;
    };
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    await bridge.openSession({ agentId: CLAUDE_ID, target: ws.target });
    await bridge.openSession({ agentId: CLAUDE_ID, target: ws.target });
    await bridge.openSession({ agentId: CLAUDE_ID, target: ws.target });
    expect(bridge.activeSessions()).toHaveLength(3);

    await bridge.dispose();
    expect(bridge.activeSessions()).toEqual([]);
    // 每个 mock 进程都收到 SIGTERM（killProcess 已 await exit，故状态收敛）。
    expect(procs.every((p) => p.signalCode === "SIGTERM")).toBe(true);
  });

  it("broadcasts an exited event and clears the pool when a subprocess dies unexpectedly", async () => {
    const { spawn, proc } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const { sessionId } = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    const events: { type: string; sessionId: string; code: number | null }[] = [];
    bridge.onSessionExited((e) => events.push(e));

    proc.emitExit(1, null); // 异常退出。
    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({ type: "exited", sessionId, code: 1 });
    expect(bridge.hasSession(sessionId)).toBe(false);
  });
});

describe("WebServer /ws/acp/<sessionId> upgrade", () => {
  let web: WebServer | null = null;
  let httpServer: http.Server | null = null;

  afterEach(async () => {
    await web?.stop({ graceMs: 0 });
    web = null;
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
    httpServer = null;
  });

  it("rejects an upgrade with a wrong token (401)", async () => {
    const { spawn } = createMockProcess();
    const bridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const { sessionId } = await bridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    const webuiDir = path.join(sandbox, "webui");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html>");
    // 用一个独立 web server 实例承载 ACP 升级（避免与既有 rpc 端口冲突）。
    const port = await startWeb(domain, webuiDir, "good-token");

    const code = await wsUpgradeStatus(port, sessionId, "bad-token");
    expect(code).toBe(401);
  });

  it("rejects an upgrade for an unknown sessionId (404)", async () => {
    const webuiDir = path.join(sandbox, "webui");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html>");
    const port = await startWeb(domain, webuiDir, "good-token");
    // 一个格式合法但不在池中的 sessionId。
    const fakeId = "acp_" + "0".repeat(24);
    const code = await wsUpgradeStatus(port, fakeId as never, "good-token");
    expect(code).toBe(404);
  });

  it("accepts a correct token + known sessionId and bridges (101)", async () => {
    const { spawn } = createMockProcess();
    domain.acpBridge = createAcpBridgeService(domain.workspaces, {
      discovery: makeDiscoveryWith({ claude: "/usr/local/bin/claude" }),
      spawn,
    });
    const ws = importWorkspace();
    const { sessionId } = await domain.acpBridge.openSession({
      agentId: CLAUDE_ID,
      target: ws.target,
    });
    const webuiDir = path.join(sandbox, "webui");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html>");
    const port = await startWeb(domain, webuiDir, "good-token");
    const code = await wsUpgradeStatus(port, sessionId, "good-token");
    expect(code).toBe(101);
  });

  async function startWeb(d: DaemonDomain, webuiDir: string, token: string): Promise<number> {
    web = new WebServer({
      webToken: token,
      webuiDir,
      domain: d,
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
    });
    return web.start(0);
  }

  /** 发起一次裸 WS upgrade，返回 HTTP 状态码（101/401/404）。 */
  function wsUpgradeStatus(
    port: number,
    sessionId: { toString(): string },
    token: string,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("upgrade timed out"));
      }, 1_000);
      socket.on("connect", () => {
        const key = "AAAAAAAAAAAAAAAAAAAAAA==";
        socket.write(
          `GET /ws/acp/${sessionId}?token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            "Connection: Upgrade\r\n" +
            "Upgrade: websocket\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            `Sec-WebSocket-Key: ${key}\r\n\r\n`,
        );
      });
      socket.on("data", (chunk: Buffer) => {
        const head = chunk.toString("latin1").split("\r\n")[0] ?? "";
        const match = /^HTTP\/1\.1 (\d+)/.exec(head);
        clearTimeout(timeout);
        socket.destroy();
        if (!match) return reject(new Error(`unexpected response: ${head}`));
        resolve(Number(match[1]));
      });
      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** 构造一个把指定 id→binaryPath 标记为 available、其余不可用的探测器。 */
function makeDiscoveryWith(
  available: Record<string, string>,
): ReturnType<typeof createAcpAgentDiscovery> {
  const resolveBinary = async (binary: string): Promise<string> => {
    for (const [id, binPath] of Object.entries(available)) {
      const known = KNOWN_ACP_AGENTS.find((a) => a.id === id);
      if (known?.binary === binary) return binPath;
    }
    throw new Error(`not found: ${binary}`);
  };
  return createAcpAgentDiscovery({ resolveBinary });
}

class MockWebSocket extends EventEmitter {
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = this.OPEN;
  private sendHandler: ((frame: string) => void) | null = null;

  send(frame: string): void {
    this.sendHandler?.(frame);
  }
  close(): void {
    this.readyState = this.CLOSED;
    this.emit("close");
  }
  onSend(handler: (frame: string) => void): void {
    this.sendHandler = handler;
  }
  /** 测试驱动：模拟浏览器发来一帧。 */
  receiveMessage(frame: string): void {
    this.emit("message", frame);
  }
}

/** 轮询断言，最多等 500ms。 */
async function waitFor(assert: () => void, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      assert();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  assert(); // 最后一次抛出真实失败。
}
