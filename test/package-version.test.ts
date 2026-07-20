/**
 * Package-version external metadata tests.
 *
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decision [2026-07-21]: an incompatible runtime package snapshot
 * is absent metadata, never an unsafe version assertion.
 *
 * Orthogonal intents:
 *   [1] Verify malformed or incompatible package metadata is skipped.
 *   [2] Verify missing compatible metadata projects to `unknown`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readNearestPackageVersion } from "../src/shared/package-version.js";

const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) fs.rmSync(sandbox, { recursive: true, force: true });
});

function moduleUrl(
  packageSource: string,
  parentPackageSource = "not-json",
  rootPackageSource = "not-json",
): string {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-package-version-test-"));
  sandboxes.push(sandbox);
  const parent = path.join(sandbox, "parent");
  const nested = path.join(parent, "nested");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "package.json"), packageSource, "utf8");
  fs.writeFileSync(path.join(parent, "package.json"), parentPackageSource, "utf8");
  fs.writeFileSync(path.join(sandbox, "package.json"), rootPackageSource, "utf8");
  return pathToFileURL(path.join(nested, "entry.mjs")).href;
}

describe("readNearestPackageVersion", () => {
  it("skips incompatible package metadata and uses the next compatible package", () => {
    const version = readNearestPackageVersion(moduleUrl('{"version":42}', '{"version":"2.4.6"}'));

    expect(version).toBe("2.4.6");
  });

  it("projects only incompatible package metadata as unknown", () => {
    const version = readNearestPackageVersion(moduleUrl("not-json"));

    expect(version).toBe("unknown");
  });
});
