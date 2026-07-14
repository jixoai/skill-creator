/**
 * RPC domain-error boundary tests.
 *
 * Original request [2026-07-14]: "safe, strongly typed WebUI business errors;
 * Creator revision conflicts must not degrade to Internal server error."
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
import { DomainError } from "../src/daemon/domain-error.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { appDir, setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

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

function createClient() {
  return createRouterClient(
    createRpcRouter(() => ({
      active: true,
      pid: process.pid,
      version: "test",
      port: 0,
      startedAt: 0,
      tray: "headless",
    })),
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
      directoryName: "revision-safe",
      frontmatter: {
        name: "revision-safe",
        description: "Detect concurrent edits.",
      },
      body: "# Revision safe\n",
    });
    fs.appendFileSync(
      path.join(workspaceDirectory, "revision-safe", "SKILL.md"),
      "\nExternal edit.\n",
      "utf8",
    );

    try {
      await client.creator.save({
        mode: "update",
        workspaceId: workspace.id,
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

  it("does not promote an unknown registry-corruption failure to DomainError", async () => {
    const client = createClient();
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(path.join(appDir(), "workspaces.json"), "not-json", "utf8");

    try {
      await client.workspace.list({});
      expect.fail("Expected registry corruption to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error).not.toBeInstanceOf(ORPCError);
    }

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
});
