/**
 * 用户原始需求 [2026-07-21]：「link 本地的 opentray；确保每次 pnpm dev 之前的所有准备工作。」
 * 正交意图：证明准备钩子只识别真实 OpenTray 源码工作区，不影响 registry 安装。
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLinkedOpenTrayWorkspace } from "../scripts/prepare-linked-opentray.sh.js";

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("linked OpenTray preparation", () => {
  it("finds a linked source workspace and ignores a registry-shaped package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "skill-creator-linked-opentray-"));
    sandboxes.push(root);
    const workspace = path.join(root, "opentray");
    const linkedConsumer = path.join(root, "linked-consumer");
    const registryConsumer = path.join(root, "registry-consumer");

    await mkdir(path.join(workspace, "packages/cli"), { recursive: true });
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "opentray-workspace",
        scripts: { "prepare:linked-consumer": "prepare" },
      }),
    );
    await mkdir(path.join(linkedConsumer, "node_modules"), { recursive: true });
    await symlink(
      path.join(workspace, "packages/cli"),
      path.join(linkedConsumer, "node_modules/opentray"),
    );

    await mkdir(path.join(registryConsumer, "node_modules/opentray"), { recursive: true });
    await writeFile(
      path.join(registryConsumer, "node_modules/opentray/package.json"),
      JSON.stringify({ name: "opentray", version: "1.0.0" }),
    );

    await expect(resolveLinkedOpenTrayWorkspace(linkedConsumer)).resolves.toBe(
      await realpath(workspace),
    );
    await expect(resolveLinkedOpenTrayWorkspace(registryConsumer)).resolves.toBeNull();
  });
});
