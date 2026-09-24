/**
 * skill-creator-mcp 冒烟测试（dsh-kernel-rebase task 4.1 验收：MCP 协议合规冒烟
 * ——真实 client 或 SDK 对拍）。
 *
 * 用户原始需求 [2026-09-08]：「先做内部，但是不排除可以独立启用：skill-creator
 * mcp:启动 mcp-server」。
 * 修订 [2026-09-16]（skill-refs-and-platform-fixes C3）：SDK 迁 v2 线——对拍
 * client 换 @modelcontextprotocol/client@2；新增 modern 纪元（2026-07-28
 * server/discover 协商）回归测试（handoff 遗留 1：v1 端点曾以 400 拒绝
 * MCP-Protocol-Version: 2026-07-28，内核 mcp__skill-creator__* 工具面不可用）。
 *
 * 正交意图：
 *   [1] v2 Client 对拍（legacy 纪元 in-memory）：initialize → tools/list →
 *       tools/call（readonly 面真实执行 + approved-mutation 工具缺席）。
 *   [2] /mcp 形态 A：Bearer 鉴权（无/错 token 401；未挂载 404；合法 token 走
 *       streamable HTTP initialize）。
 *   [3] modern 纪元回归：v2 client versionNegotiation auto（dsh-mcp-client 同
 *       线）经真实 HTTP 协商 2026-07-28 并调用工具——协议协商修复的钉子。
 * 妥协声明：无。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { createSkillCreatorMcpServer, mcpToolName } from "../src/daemon/mcp/skill-creator-mcp.js";
import { WebServer } from "../src/daemon/web-server.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { randomBytes } from "node:crypto";

let sandbox = "";
let domain: DaemonDomain;
let web: WebServer | null = null;

/** provider catalog 的 Global root env overrides（skills_search 往返需要 HOME 沙箱）。 */
const PROVIDER_HOME_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
] as const;
const previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-mcp-test-"));
  const isolatedHome = path.join(sandbox, "state");
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    previousEnv[name] = process.env[name];
  }
  for (const name of PROVIDER_HOME_OVERRIDES) delete process.env[name];
  delete process.env.XDG_CONFIG_HOME;
  process.env.HOME = path.join(sandbox, "home");
  // os.homedir() 在 win32 读 USERPROFILE：子进程继承的隔离集必须同时覆盖。
  process.env.USERPROFILE = process.env.HOME;
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain();
});

afterEach(async () => {
  await web?.stop({ graceMs: 0 });
  web = null;
  await domain.repository.dispose();
  await domain.steward.dispose();
  setHomeOverride(null);
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    const previous = previousEnv[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
    delete previousEnv[name];
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function connectedClient() {
  const server = createSkillCreatorMcpServer({
    capabilities: domain.managerCapabilities,
    face: "stdio",
  });
  const client = new Client({ name: "smoke", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe("skill-creator mcp server (task 4.1)", () => {
  it("exposes the readonly capability face over the MCP protocol", async () => {
    const { client, server } = await connectedClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      // readonly 面在场（capability 名 . → _）。
      expect(names).toContain("workspace_list");
      expect(names).toContain("skills_list");
      expect(names).toContain("skills_search");
      expect(names).toContain("skills_update_check");
      expect(names).toContain("creator_load");
      expect(names).toContain(mcpToolName("repository.sources.list"));
      // approved-mutation 面缺席（4.4 前不注册）。
      expect(names).not.toContain("skills_toggle");
      expect(names).not.toContain("creator_save");
      expect(names).not.toContain("repository_install");
      // readonly 检索无 propose 变体（skill-search-integration C2 不扩张 mutation 面）。
      expect(names).not.toContain("skills_search_propose");
      // schema-faithful：workspace_list 描述符携带输入 schema。
      const listTool = tools.tools.find((tool) => tool.name === "workspace_list");
      expect(listTool?.description).toBeTruthy();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("executes a real capability call through tools/call", async () => {
    const { client, server } = await connectedClient();
    try {
      const result = await client.callTool({ name: "workspace_list", arguments: {} });
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      const parsed = JSON.parse(text) as { kind: string; value?: { workspaces?: unknown[] } };
      expect(parsed.kind).toBe("ok");
      expect(Array.isArray(parsed.value?.workspaces)).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("searches sandboxed local skills through the stdio face (skill-search-integration)", async () => {
    const skillDirectory = path.join(
      sandbox,
      "home",
      ".claude",
      "skills",
      "react-component-design",
    );
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(skillDirectory, "SKILL.md"),
      "---\nname: react-component-design\ndescription: Design React components with care.\n---\n# React component design\n\nComposition over inheritance.\n",
    );

    const { client, server } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "skills_search",
        arguments: { query: "react" },
      });
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      const parsed = JSON.parse(text) as {
        kind: string;
        value?: {
          results?: Array<{
            id?: string;
            installations?: Array<{ path?: string; workspaceId?: string; providerId?: string }>;
          }>;
        };
      };
      expect(parsed.kind).toBe("ok");
      const hit = parsed.value?.results?.[0];
      expect(hit?.id).toMatch(/^sk_[a-f0-9]{24}$/);
      expect(hit?.installations).toEqual([
        { path: skillDirectory, workspaceId: "~", providerId: "claude-code" },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("projects typed failures as MCP tool errors", async () => {
    const { client, server } = await connectedClient();
    try {
      const result = await client.callTool({
        name: "skills_info",
        arguments: {
          workspaceId: "ws_missing",
          providerId: "cc",
          skillId: "sk_deadbeefdeadbeefdeadbeef",
        },
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves the /mcp face behind Bearer auth on the manager origin", async () => {
    const webuiDir = path.join(sandbox, "webui");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>M</title>");
    const token = randomBytes(24).toString("base64url");
    web = new WebServer({
      webToken: token,
      webuiDir,
      domain,
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: Date.now(),
        tray: "headless",
      }),
    });
    const port = await web.start(0);

    // 未挂载 → 404。
    const notMounted = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" });
    expect(notMounted.status).toBe(404);

    web.mountMcp(() =>
      createSkillCreatorMcpServer({ capabilities: domain.managerCapabilities, face: "in-process" }),
    );

    // 无/错 token → 401（不进入 transport）。
    const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(unauth.status).toBe(401);
    const badToken = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(badToken.status).toBe(401);

    // 合法 token → streamable HTTP initialize 成功（SDK 对拍协议握手）。
    const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0.0.1" },
        },
      }),
    });
    expect(init.status).toBe(200);
    const body = await init.text();
    expect(body).toContain("skill-creator");

    // tools/list 走通 streamable HTTP。
    const tools = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(tools.status).toBe(200);
    const toolsBody = await tools.text();
    expect(toolsBody).toContain("workspace_list");

    // C3 modern 纪元回归：v2 client auto 协商（dsh-mcp-client 同线）——probe
    // server/discover → 2026-07-28；后续请求头携带 modern 版本不得再被 400 拒。
    const modernClient = new Client(
      { name: "modern-smoke", version: "0.0.1" },
      { versionNegotiation: { mode: "auto" } },
    );
    const modernTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        authProvider: { token: async () => token },
      },
    );
    await modernClient.connect(modernTransport);
    try {
      expect(modernClient.getProtocolEra?.()).not.toBe("legacy");
      const modernTools = await modernClient.listTools();
      expect(modernTools.tools.map((tool) => tool.name)).toContain("workspace_list");
      const call = await modernClient.callTool({ name: "workspace_list", arguments: {} });
      const callText = (call.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      expect(JSON.parse(callText)).toMatchObject({ kind: "ok" });
    } finally {
      await modernClient.close().catch(() => undefined);
    }
  });
});

describe("wiki capability face (wiki-mcp-surface)", () => {
  const previousWikiHome = process.env.SKILL_WIKI_HOME;

  function sandboxWikiHome(): string {
    const wikiHome = path.join(sandbox, "wiki-home");
    process.env.SKILL_WIKI_HOME = wikiHome;
    return wikiHome;
  }

  afterEach(() => {
    if (previousWikiHome === undefined) delete process.env.SKILL_WIKI_HOME;
    else process.env.SKILL_WIKI_HOME = previousWikiHome;
  });

  it("projects wiki readonly tools on stdio and keeps append propose-only", async () => {
    const { client, server } = await connectedClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("wiki_scopes");
      expect(names).toContain("wiki_list");
      expect(names).toContain("wiki_read");
      // append 是 approved-mutation：stdio 无任何形态。
      expect(names).not.toContain("wiki_append");
      expect(names).not.toContain("wiki_append_propose");
    } finally {
      await client.close();
      await server.close();
    }
  });

  /** 工具结果 → 解析 JSON 文本（capability 面 toToolResult 约定）。 */
  async function callJson(
    client: Awaited<ReturnType<typeof connectedClient>>["client"],
    name: string,
    args: unknown,
  ) {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    return JSON.parse(text) as { kind: string; value?: unknown };
  }

  it("round-trips scopes/list/read against the daemon wiki data face", async () => {
    sandboxWikiHome();
    await domain.wiki.append("~", { title: "MCP round trip", body: "read via tools/call" });

    const { client, server } = await connectedClient();
    try {
      const scopes = await callJson(client, "wiki_scopes", {});
      expect(scopes.kind).toBe("ok");
      const globalScope = (
        (scopes.value as { scopes: Array<{ id: string; patternCount: number }> }).scopes ?? []
      ).find((scope) => scope.id === "~");
      expect(globalScope?.patternCount).toBe(1);

      const list = await callJson(client, "wiki_list", { scope: "~" });
      expect(list.kind).toBe("ok");
      expect(
        (list.value as { patterns: Array<{ name: string }> }).patterns.map((item) => item.name),
      ).toEqual(["mcp-round-trip"]);

      const read = await callJson(client, "wiki_read", { scope: "~", name: "mcp-round-trip" });
      expect(read.kind).toBe("ok");
      expect((read.value as { body: string }).body.trim()).toBe("read via tools/call");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("runs wiki append through the propose → approve execution chain", async () => {
    sandboxWikiHome();
    // in-process 面 + proposal 链：append 仅以 propose 变体出现。
    const server = createSkillCreatorMcpServer({
      capabilities: domain.managerCapabilities,
      face: "in-process",
      proposals: domain.mcpProposals,
    });
    const client = new Client({ name: "smoke", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("wiki_append_propose");
      expect(names).not.toContain("wiki_append");

      const proposed = await callJson(client, "wiki_append_propose", {
        scope: "~",
        title: "Proposed insight",
        body: "written only after human approval",
      });
      expect(proposed.kind).toBe("proposed");
      const proposalId = (proposed as unknown as { proposalId: string }).proposalId;

      // 提案未决：磁盘零写。
      expect((await domain.wiki.list("~")).patterns).toHaveLength(0);

      const decision = await domain.mcpProposals.approve(proposalId);
      expect(decision.view.status).toBe("executed");
      const patterns = (await domain.wiki.list("~")).patterns;
      expect(patterns.map((item) => item.name)).toEqual(["proposed-insight"]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
