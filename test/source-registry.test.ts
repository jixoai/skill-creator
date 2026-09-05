/**
 * User source registry persistence tests.
 *
 * User input [2026-07-27]: "用户可向 Discover feed 追加自己的 Git URL，跨重启保留。"
 * Architecture decision [2026-07-27]: user sources persist daemon-side in sources.json;
 * unknown/incompatible state loads as empty; built-in ids cannot be removed; https-only URLs.
 *
 * Orthogonal intents:
 *   [1] Add/list/remove roundtrip persists across a fresh registry instance.
 *   [2] Incompatible persisted state degrades to empty.
 *   [3] Built-in ids are protected and invalid URLs are rejected.
 *   [4] User source ids use the user_ namespace prefix.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURATED_SOURCES } from "../src/shared/curated-sources.js";
import { UserSourceIdSchema } from "../src/shared/contracts/repository.js";
import { createSourceRegistry } from "../src/daemon/source-registry.js";
import { appDir, setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-source-registry-"));
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

describe("source registry persistence", () => {
  it("lists curated built-in sources by default", () => {
    const registry = createSourceRegistry();
    const listing = registry.list();
    expect(listing.builtIn.map((entry) => entry.id)).toEqual(
      CURATED_SOURCES.map((entry) => entry.id),
    );
    expect(listing.user).toEqual([]);
  });

  it("adds and lists a user source", () => {
    const registry = createSourceRegistry();
    const added = registry.add({
      label: "My repo",
      gitUrl: "https://github.com/me/skills.git",
      description: "custom",
    });
    expect(UserSourceIdSchema.safeParse(added.id).success).toBe(true);
    expect(added.id.startsWith("user_")).toBe(true);
    const listing = registry.list();
    expect(listing.user).toHaveLength(1);
    expect(listing.user[0]?.gitUrl).toBe("https://github.com/me/skills.git");
  });

  it("persists across a fresh registry instance", () => {
    const first = createSourceRegistry();
    first.add({ label: "Persisted", gitUrl: "https://github.com/me/persisted.git" });
    const second = createSourceRegistry();
    expect(second.list().user).toHaveLength(1);
    expect(second.list().user[0]?.label).toBe("Persisted");
  });

  it("removes a user source", () => {
    const registry = createSourceRegistry();
    const added = registry.add({
      label: "To remove",
      gitUrl: "https://github.com/me/remove.git",
    });
    expect(registry.remove(added.id)).toEqual({ removed: true });
    expect(registry.list().user).toEqual([]);
  });

  it("writes sources.json inside appDir (server-owned, not localStorage)", () => {
    const registry = createSourceRegistry();
    registry.add({ label: "On disk", gitUrl: "https://github.com/me/ondisk.git" });
    const file = path.join(appDir(), "sources.json");
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { version: number };
    expect(parsed.version).toBe(1);
  });

  it("rejects non-https URLs without writing", () => {
    const registry = createSourceRegistry();
    expect(() => registry.add({ label: "Bad", gitUrl: "git@github.com:me/skills.git" })).toThrow(
      /Invalid user source/,
    );
    expect(() => registry.add({ label: "Bad", gitUrl: "http://github.com/me/skills.git" })).toThrow(
      /Invalid user source/,
    );
    expect(registry.list().user).toEqual([]);
    expect(fs.existsSync(path.join(appDir(), "sources.json"))).toBe(false);
  });

  it("rejects duplicate git URLs", () => {
    const registry = createSourceRegistry();
    registry.add({ label: "First", gitUrl: "https://github.com/me/dup.git" });
    expect(() =>
      registry.add({ label: "Second", gitUrl: "https://github.com/me/dup.git" }),
    ).toThrow(/already in your sources/);
  });

  it("degrades incompatible persisted state to empty", () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      path.join(appDir(), "sources.json"),
      JSON.stringify({ version: 99, sources: [{ id: "bogus" }] }),
      "utf8",
    );
    const registry = createSourceRegistry();
    expect(registry.list().user).toEqual([]);
    expect(registry.list().builtIn.length).toBeGreaterThan(0);
  });

  it("degrades malformed JSON to empty", () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(path.join(appDir(), "sources.json"), "{not json", "utf8");
    const registry = createSourceRegistry();
    expect(registry.list().user).toEqual([]);
  });

  it("rejects removal of a user_ id that is not present", () => {
    const registry = createSourceRegistry();
    const phantomId = UserSourceIdSchema.parse("user_deadbeefcafe00");
    expect(() => registry.remove(phantomId)).toThrow(/User source not found/);
  });

  it("namespace-isolates user ids from curated ids (built-in protection)", () => {
    const registry = createSourceRegistry();
    const builtInId = CURATED_SOURCES[0]?.id;
    if (!builtInId) throw new Error("expected at least one curated source");
    // Curated ids do not start with user_, so UserSourceIdSchema rejects them
    // at the type boundary before any built-in source can be removed.
    expect(UserSourceIdSchema.safeParse(builtInId).success).toBe(false);
    // Removing a real user source leaves curated built-ins untouched.
    const added = registry.add({ label: "Custom", gitUrl: "https://github.com/me/x.git" });
    registry.remove(added.id);
    expect(registry.list().builtIn.map((entry) => entry.id)).toContain(builtInId);
  });
});
