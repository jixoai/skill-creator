/**
 * ui:// MCP Apps 卡片测试（dsh-kernel-rebase task 4.2）。
 *
 * 用户原始需求 [2026-09-08]：「如果你能通过 MCP-apps 提供一些交互卡片，这样你
 * 就可以去做一些应用内的跳转或者信息的卡片化。」
 *
 * 正交意图：
 *   [1] HTML escape 强制：不可信文本（frontmatter/finding）进模板不产生可执行
 *       标记。
 *   [2] 四类卡片投影：skills.info/validate、update.check、repository.install 的
 *       ok 结果各得其卡；failed/denied 不附卡。
 *   [3] 端到端：SDK client tools/call → result text 内嵌 uiCard + `_meta.ui
 *       .resourceUri`（SEP-1865 位置）→ 注册表经 uri 可取回渲染 HTML。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createCapabilityRegistry } from "../src/daemon/capability/core.js";
import { createSkillCreatorMcpServer } from "../src/daemon/mcp/skill-creator-mcp.js";
import {
  UiCardRegistry,
  buildCardHtml,
  escapeHtml,
  uiCardForCapability,
} from "../src/daemon/mcp/cards.js";

const hostile = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;

describe("card templating (task 4.2)", () => {
  it("escapes untrusted text in every field and the title", () => {
    const html = buildCardHtml({
      type: "skill-info",
      title: hostile,
      fields: [
        { label: "Description", value: hostile },
        { label: "Dir", value: `"><svg onload=alert(3)>` },
      ],
      nav: { label: "Go", path: "/workspaces\" onmouseover=\"alert(4)" },
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<svg");
    expect(html).toContain("&lt;img src=x onerror=");
    // 模板自身的合法结构仍在。
    expect(html).toContain('data-card-type="skill-info"');
    expect(html).toContain("ui/navigate");
  });

  it("escapes the full entity set round-trip", () => {
    expect(escapeHtml(`a&<>"'`)).toBe("a&amp;&lt;&gt;&quot;&#39;");
  });

  it("projects the four card types from matching capability results", () => {
    expect(
      uiCardForCapability("skills.info", {
        kind: "ok",
        value: {
          skillId: "sk_deadbeefdeadbeefdeadbeef",
          name: "demo",
          directoryName: "demo",
          revision: "sha256:abcd",
          disabled: false,
        },
      })?.type,
    ).toBe("skill-info");

    expect(
      uiCardForCapability("skills.validate", {
        kind: "ok",
        value: { success: false, name: "demo", errors: ["bad frontmatter"], warnings: [] },
      })?.type,
    ).toBe("finding");

    expect(
      uiCardForCapability("skills.update.check", {
        kind: "ok",
        value: { results: [{ name: "demo", status: "outdated" }] },
      })?.type,
    ).toBe("install-result");

    expect(
      uiCardForCapability("repository.install", {
        kind: "ok",
        value: { kind: "result", installed: 2, overwritten: 0, skipped: 0, failed: 0 },
      })?.type,
    ).toBe("install-result");

    // 失败/拒绝/未知能力不附卡。
    expect(uiCardForCapability("skills.info", { kind: "failed", code: "NOT_FOUND" })).toBeNull();
    expect(uiCardForCapability("workspace.list", { kind: "ok", value: {} })).toBeNull();
  });

  it("bounds the registry (FIFO eviction)", () => {
    const registry = new UiCardRegistry(2);
    const first = registry.register({ type: "skill-info", title: "a", fields: [] });
    registry.register({ type: "finding", title: "b", fields: [] });
    registry.register({ type: "proposal", title: "c", fields: [] });
    expect(registry.get(first)).toBeNull();
    expect(registry.get("ui://card/unknown/none")).toBeNull();
  });
});

describe("cards over the mcp protocol (task 4.2)", () => {
  it("attaches uiCard + _meta.ui.resourceUri to ok results and serves the resource", async () => {
    const registry = createCapabilityRegistry([
      {
        name: "skills.info",
        description: "stub",
        authority: "readonly",
        input: z.object({
          workspaceId: z.string(),
          providerId: z.string(),
          skillId: z.string(),
        }),
        handler: () => ({
          kind: "ok",
          value: {
            skillId: "sk_deadbeefdeadbeefdeadbeef",
            name: hostile,
            directoryName: "demo",
            revision: "sha256:abcd",
            description: hostile,
          },
        }),
      },
    ]);
    const cards = new UiCardRegistry();
    const server = createSkillCreatorMcpServer({ capabilities: registry, face: "stdio", cards });
    const client = new Client({ name: "card-smoke", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = await client.callTool({
        name: "skills_info",
        arguments: { workspaceId: "ws_x", providerId: "cc", skillId: "sk_deadbeefdeadbeefdeadbeef" },
      });
      // SEP-1865 标准位置 + text 内嵌引用（dsh-mcp-client 透传面）。
      const resourceUri = (result as { _meta?: { ui?: { resourceUri?: string } } })._meta?.ui
        ?.resourceUri;
      expect(typeof resourceUri).toBe("string");
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      expect(text).toContain('"uiCard"');

      // 代理读取（agent.card.get 的数据源）：HTML 可取回且不可信文本已转义。
      const html = cards.get(resourceUri!);
      expect(html).toBeTruthy();
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img src=x onerror=");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
