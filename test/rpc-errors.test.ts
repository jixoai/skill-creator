/**
 * RPC domain-error boundary tests.
 *
 * User input [2026-07-15]: "type-safe 就是 runtime-safe 的核心，从类型安全上杜绝线上运行程序的安全性"
 * Architecture decision [2026-07-14]: expected domain failures cross RPC as
 * typed business errors while unknown infrastructure failures remain masked.
 *
 * Orthogonal intents:
 *   [1] Observe defined business errors through the public router client.
 *   [2] Prove unknown infrastructure failures are not promoted to DomainError.
 *   [3] Keep repository clone diagnostics out of public error messages.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORPCError, createActionableClient, createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
const openClawProviderId = ProviderIdSchema.parse("openclaw");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-rpc-error-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function createClient(
  domain: DaemonDomain = createDaemonDomain(undefined, {
    skillsCliProbe: deterministicSkillsCliProbe(),
  }),
) {
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
      domain,
    }),
  );
}

describe("RPC domain-error boundary", () => {
  it("exposes a Creator revision conflict as a defined CONFLICT error", async () => {
    const client = createClient();
    const workspaceDirectory = path.join(sandbox, "workspace");
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    const { workspace } = await client.workspace.add({
      path: workspaceDirectory,
      label: "Revision workspace",
    });
    if (workspace.kind !== "directory") throw new Error("Expected an imported workspace.");

    const created = await client.creator.save({
      mode: "create",
      workspaceId: workspace.id,
      providerId: openClawProviderId,
      directoryName: "revision-safe",
      frontmatter: {
        name: "revision-safe",
        description: "Detect concurrent edits.",
      },
      body: "# Revision safe\n",
    });
    fs.appendFileSync(
      path.join(workspaceDirectory, "skills", "revision-safe", "SKILL.md"),
      "\nExternal edit.\n",
      "utf8",
    );

    try {
      await client.creator.save({
        mode: "update",
        workspaceId: workspace.id,
        providerId: openClawProviderId,
        skillId: created.document.skillId,
        expectedRevision: created.document.revision,
        frontmatter: created.document.frontmatter,
        body: "# Stale update\n",
      });
      expect.fail("Expected a revision conflict.");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.defined).toBe(true);
      expect(error.code).toBe("CONFLICT");
      expect(error.status).toBe(409);
      expect(error.message).toBe("This skill changed on disk. Reload it before saving your edits.");
    }
  });

  it("does not promote an unknown projection failure to DomainError", async () => {
    // 密闭性（issue #1）：Global roots 解析自测试宿主的真实 $HOME——CI runner 上
    // 没有任何 Agent root 时，always-reject 的 countSkills 桩根本不会被调用，
    // list 反而成功。导入一个真实沙箱 workspace，保证 snapshot 至少有一个
    // available provider root，桩必然被触发，与宿主环境完全解耦。
    const workspaceDirectory = path.join(sandbox, "projection-workspace");
    fs.mkdirSync(path.join(workspaceDirectory, "skills"), { recursive: true });
    const workspaces = createWorkspaceRegistry({
      countSkills: () => Promise.reject(new Error("count adapter failed")),
    });
    const client = createClient(
      createDaemonDomain(workspaces, { skillsCliProbe: deterministicSkillsCliProbe() }),
    );
    const { workspace } = await client.workspace.add({ path: workspaceDirectory });
    if (workspace.kind !== "directory") throw new Error("Expected an imported workspace.");

    let projectionError: unknown;
    try {
      await client.workspace.list({});
      projectionError = new Error("workspace.list resolved despite the failing projection adapter");
    } catch (error) {
      projectionError = error;
    }
    // 断言错误本体（而非依赖 expect.fail 抛出的 Error 巧合满足 instanceof）：
    // 假若桩未被触发、list 正常返回，这里会以真实原因失败，不再静默假绿。
    expect(projectionError).toBeInstanceOf(Error);
    expect(projectionError).not.toBeInstanceOf(DomainError);
    expect(projectionError).not.toBeInstanceOf(ORPCError);
    expect((projectionError as Error).message).toContain("count adapter failed");

    const [maskedError] = await createActionableClient(client.workspace.list)({});
    expect(maskedError).toMatchObject({
      defined: false,
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
      message: "Internal server error",
    });
  });

  it("exposes repository clone failure without leaking the source or Git diagnostics", async () => {
    const client = createClient();
    const credentialMarker = "credential-marker-must-stay-private";
    const source = path.join(sandbox, credentialMarker);

    try {
      await client.repository.scan({ source });
      expect.fail("Expected repository clone to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.defined).toBe(true);
      expect(error.code).toBe("UNAVAILABLE");
      expect(error.status).toBe(503);
      expect(error.message).toBe(
        "Repository could not be cloned. Verify the source and reference, then try again.",
      );
      expect(error.message).not.toContain(credentialMarker);
    }
  });

  it("reports a workspace replaced by a file as unavailable", async () => {
    const client = createClient();
    const workspaceDirectory = path.join(sandbox, "replaced-workspace");
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    const { workspace } = await client.workspace.add({ path: workspaceDirectory });
    if (workspace.kind !== "directory") throw new Error("Expected an imported workspace.");
    fs.rmSync(workspaceDirectory, { recursive: true });
    fs.writeFileSync(workspaceDirectory, "not a directory", "utf8");

    try {
      await client.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId: openClawProviderId,
        directoryName: "blocked",
        frontmatter: { name: "blocked", description: "Must not write through a file." },
        body: "# Blocked\n",
      });
      expect.fail("Expected the replaced workspace to be unavailable.");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.defined).toBe(true);
      expect(error.code).toBe("UNAVAILABLE");
      expect(error.status).toBe(503);
    }
  });

  it("projects an unknown Provider as the defined NOT_FOUND RPC error", async () => {
    const client = createClient();
    try {
      await client.skills.list({
        workspaceId: GLOBAL_WORKSPACE_ID,
        providerId: ProviderIdSchema.parse("unknown-agent"),
      });
      expect.fail("Expected unknown Provider to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.defined).toBe(true);
      expect(error.code).toBe("NOT_FOUND");
      expect(error.status).toBe(404);
      expect(error.message).toBe("Provider not found: unknown-agent");
    }
  });
});
