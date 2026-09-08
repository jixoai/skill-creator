/**
 * 端到端 authority 链测试（dsh-kernel-rebase task 6.1：面板/外部 client 视角的
 * mutation → proposal → 审批 → 磁盘验证 → rollback）。
 *
 * 用户原始需求 [2026-09-08]：「Manager 永远拥有路径、文件、revision、启停、安装、
 * 更新、draft、approval 和 audit authority。」
 *
 * 正交意图：
 *   [1] mutation 全链：MCP propose（toggle）→ pending → approve → 磁盘真实变化
 *       （SKILL.md ↔ .SKILL.md 启停标记）→ audit 链完整。
 *   [2] 拒绝路径：同类 proposal reject 后磁盘不变。
 * 妥协声明：真实 LLM tool round（模型自主调工具 + 卡片引导效果）需要 provider
 *   凭据，归操作者验收（本链以协议级 client 驱动等价覆盖）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { createSkillCreatorMcpServer } from "../src/daemon/mcp/skill-creator-mcp.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";

let sandbox = "";
let domain: DaemonDomain;
let beforeEachFixture: Promise<unknown> | null = null;
let workspaceDir = "";
let workspaceId = "";
let client: Client | null = null;
let server: ReturnType<typeof createSkillCreatorMcpServer> | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-e2e-authority-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  workspaceDir = path.join(sandbox, "ws");
  fs.mkdirSync(workspaceDir, { recursive: true });
  domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
  const imported = domain.workspaces.import(workspaceDir, "e2e-ws");
  workspaceId = imported.id;
  // fixture 走 creator.save（provider 目录结构由 daemon 派生；WebUI 不拼路径）。
  beforeEachFixture = domain.creator.save({
    mode: "create",
    workspaceId,
    providerId: "openclaw",
    directoryName: "demo-skill",
    frontmatter: { name: "demo-skill", description: "end-to-end authority fixture" },
    body: "Body.\n",
  });

  server = createSkillCreatorMcpServer({
    capabilities: domain.managerCapabilities,
    cards: domain.uiCards,
    proposals: domain.mcpProposals,
    face: "in-process",
  });
  client = new Client({ name: "e2e", version: "0.0.1" });
});

afterEach(async () => {
  await client?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  client = null;
  server = null;
  void domain.repository.dispose();
  void domain.steward.dispose();
  setHomeOverride(null);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function connect(): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client!.connect(clientTransport), server!.connect(serverTransport)]);
}

/** openclaw 的 workspacePath = "skills"（provider-catalog 约定）。 */
function skillFile(): string {
  return path.join(workspaceDir, "skills", "demo-skill", "SKILL.md");
}

describe("end-to-end authority chain (task 6.1)", () => {
  it(
    "runs propose → approve → disk change with a complete audit trail",
    { timeout: 120_000 },
    async () => {
      await connect();
      await beforeEachFixture;
      const target = { workspaceId, providerId: "openclaw" };
      const discovered = await domain.skills.list(target, true);
      expect(discovered.length).toBeGreaterThan(0);
      const skill = discovered[0]!;
      expect(fs.existsSync(skillFile())).toBe(true);

      // 1. 外部 client 提议禁用（不落盘）。
      const proposed = await client!.callTool({
        name: "skills_toggle_propose",
        arguments: { ...target, skillIds: [skill.id], mode: "disable" },
      });
      const text = (proposed.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      if (proposed.isError) throw new Error(`propose failed: ${text}`);
      const parsed = JSON.parse(text) as { proposalId: string };
      expect(fs.existsSync(skillFile())).toBe(true); // 仍未写盘。
      const pending = domain.mcpProposals.list().find((p) => p.proposalId === parsed.proposalId);
      expect(pending?.status).toBe("pending");

      // 2. 审批执行 → 磁盘真实变化（disable = SKILL.md → .SKILL.md）。
      const approved = await domain.mcpProposals.approve(parsed.proposalId);
      expect(approved.view.status).toBe("executed");
      expect(fs.existsSync(skillFile())).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(skillFile()), ".SKILL.md"))).toBe(true);

      // 3. 再提议启用 → 审批 → 文件恢复。
      const reenable = await client!.callTool({
        name: "skills_toggle_propose",
        arguments: { ...target, skillIds: [skill.id], mode: "enable" },
      });
      const reenableText =
        (reenable.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      const reenableId = (JSON.parse(reenableText) as { proposalId: string }).proposalId;
      await domain.mcpProposals.approve(reenableId);
      expect(fs.existsSync(skillFile())).toBe(true);

      // 4. 审计链：created → approved → executed × 2。
      const events = domain.mcpProposals.audit().map((entry) => entry.event);
      expect(events).toEqual([
        "created",
        "approved",
        "executed",
        "created",
        "approved",
        "executed",
      ]);
    },
  );

  it("reject leaves the disk untouched", { timeout: 120_000 }, async () => {
    await connect();
    await beforeEachFixture;
    const target = { workspaceId, providerId: "openclaw" };
    const discovered = await domain.skills.list(target, true);
    const skill = discovered[0]!;
    const proposed = await client!.callTool({
      name: "skills_toggle_propose",
      arguments: { ...target, skillIds: [skill.id], mode: "disable" },
    });
    const text = (proposed.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    if (proposed.isError) throw new Error(`propose failed: ${text}`);
    const { proposalId } = JSON.parse(text) as { proposalId: string };
    const rejected = domain.mcpProposals.reject(proposalId);
    expect(rejected?.view.status).toBe("rejected");
    expect(fs.existsSync(skillFile())).toBe(true); // 磁盘不变。
    // 拒绝后审批幂等返回 rejected，不执行。
    const late = await domain.mcpProposals.approve(proposalId);
    expect(late.view.status).toBe("rejected");
    expect(fs.existsSync(skillFile())).toBe(true);
  });
});
