/**
 * Curated source catalog snapshot tests.
 *
 * User input [2026-07-27]: "Repository 用来浏览远程 skills 仓库。"
 * Architecture decision [2026-07-27]: the curated catalog is a static browser-safe
 * snapshot shipped with the release; every entry must remain https-stable and unique.
 *
 * Orthogonal intents:
 *   [1] Every catalog entry has non-empty stable fields.
 *   [2] Catalog ids are unique and git URLs are https.
 */
import { describe, expect, it } from "vitest";
import { CURATED_SOURCES, curatedSourceEntry } from "../src/shared/curated-sources.js";

describe("CURATED_SOURCES", () => {
  it("is non-empty and ships the two required entries", () => {
    expect(CURATED_SOURCES.length).toBeGreaterThan(0);
    const ids = CURATED_SOURCES.map((source) => source.id);
    expect(ids).toContain("anthropics-skills");
    expect(ids).toContain("vercel-labs-skills");
  });

  it("has non-empty label, gitUrl, description on every entry", () => {
    for (const source of CURATED_SOURCES) {
      expect(source.id.length).toBeGreaterThan(0);
      expect(source.label.length).toBeGreaterThan(0);
      expect(source.gitUrl.length).toBeGreaterThan(0);
      expect(source.description.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = CURATED_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has only https git URLs", () => {
    for (const source of CURATED_SOURCES) {
      expect(source.gitUrl.startsWith("https://")).toBe(true);
    }
  });

  it("resolves known ids through curatedSourceEntry", () => {
    expect(curatedSourceEntry("anthropics-skills")?.label).toBe("Anthropic Skills");
    expect(curatedSourceEntry("missing")).toBeUndefined();
  });
});
