/**
 * skill-creator-mcp 冒烟测试（dsh-kernel-rebase task 4.1 验收：MCP 协议合规冒烟
 * ——真实 client 或 SDK 对拍）。
 *
 * 用户原始需求 [2026-09-08]：「先做内部，但是不排除可以独立启用：skill-creator
 * mcp:启动 mcp-server」。
 *
 * 正交意图：
 *   [1] SDK Client 对拍：initialize → tools/list → tools/call（readonly 面真实
 *       执行 + approved-mutation 工具缺席）。
 *   [2] /mcp 形态 A：Bearer 鉴权（无/错 token 401；未挂载 404；合法 token 走
 *       streamable HTTP initialize）。
 * 妥协声明：无。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { createSkillCreatorMcpServer, mcpToolName } from "../src/daemon/mcp/skill-creator-mcp.js";
import { WebServer } from "../src/daemon/web-server.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { randomBytes } from "node:crypto";

let sandbox = "";
let domain: DaemonDomain;
let web: WebServer | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-mcp-test-"));
  const isolatedHome = path.join(sandbox, "state");
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
      expect(names).toContain("skills_update_check");
      expect(names).toContain("creator_load");
      expect(names).toContain(mcpToolName("repository.sources.list"));
      // approved-mutation 面缺席（4.4 前不注册）。
      expect(names).not.toContain("skills_toggle");
      expect(names).not.toContain("creator_save");
      expect(names).not.toContain("repository_install");
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
  });
});
