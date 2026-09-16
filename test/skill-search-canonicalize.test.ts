/**
 * CanonicalSkillScan 归并测试。
 *
 * User input [2026-09-17]: "同一 canonicalPath 的多个入口 MUST 合并为一个索引文档，
 * installations 为 {path, workspaceId, providerId}[]；双文件冲突 SKILL.md 优先；
 * contentHash 恒为实际被索引文件字节。"
 *
 * Orthogonal intents:
 *   [1] realpath 去重与 installations 三入口合并（stable sk_ id）。
 *   [2] 双文件规则（conflict / disabled / 内容源选择）。
 *   [3] same-content 不同路径不合并（contentHash 仅在解析层计算，分组键是 canonicalPath）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalizeCandidates } from "../src/daemon/skill-search/canonicalize.js";
import { parseSkillDocument } from "../src/daemon/skill-search/parser.js";
import { scanSkillRoots, type SkillRoot } from "../src/daemon/skill-search/scanner.js";
import { opaquePathId } from "../src/daemon/path-safety.js";
import {
  GLOBAL_WORKSPACE_ID,
  ProviderIdSchema,
  type ProviderId,
} from "../src/shared/contracts/workspaces.js";

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-canonicalize-test-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const SKILL_CONTENT =
  "---\nname: shared-skill\ndescription: installed in many places\n---\n# shared\n";

function writeSkillFile(directory: string, content = SKILL_CONTENT, filename = "SKILL.md"): string {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, filename), content);
  return directory;
}

function root(rootPath: string, providerId: string): SkillRoot {
  return {
    rootPath,
    workspaceId: GLOBAL_WORKSPACE_ID,
    providerId: ProviderIdSchema.parse(providerId),
  };
}

describe("skill search canonicalize", () => {
  it("merges same-realpath entries from three installations into one canonical document", () => {
    const target = writeSkillFile(path.join(sandbox, "repo", "foo"));
    const claudeRoot = path.join(sandbox, "home", ".claude", "skills");
    const codexRoot = path.join(sandbox, "home", ".codex", "skills");
    const agentsRoot = path.join(sandbox, "home", ".agents", "skills");
    for (const providerRoot of [claudeRoot, codexRoot, agentsRoot]) {
      fs.mkdirSync(providerRoot, { recursive: true });
      fs.symlinkSync(target, path.join(providerRoot, "foo"));
    }
    const scans = canonicalizeCandidates(
      scanSkillRoots([
        root(claudeRoot, "claude-code"),
        root(codexRoot, "codex"),
        root(agentsRoot, "amp"),
      ]),
    );
    expect(scans).toHaveLength(1);
    const scan = scans[0];
    if (!scan) throw new Error("expected the merged canonical scan");
    expect(scan.canonicalPath).toBe(fs.realpathSync(target));
    // id 等于按 canonical 目录计算的 sk_ id（与 skills.list 一致）。
    expect(scan.id).toBe(opaquePathId("sk", fs.realpathSync(target)));
    expect(scan.installations).toHaveLength(3);
    const installationProviders = new Set<ProviderId>(scan.installations.map((i) => i.providerId));
    expect(installationProviders).toEqual(
      new Set([
        ProviderIdSchema.parse("claude-code"),
        ProviderIdSchema.parse("codex"),
        ProviderIdSchema.parse("amp"),
      ]),
    );
    for (const installation of scan.installations) {
      expect(installation.workspaceId).toBe(GLOBAL_WORKSPACE_ID);
      expect(fs.realpathSync(installation.path)).toBe(scan.canonicalPath);
    }
    expect(scan.disabled).toBe(false);
    expect(scan.conflict).toBe(false);
    expect(scan.sourceFile).toBe("SKILL.md");
  });

  it("keeps same-content different-path skills as separate groups with equal contentHash", () => {
    writeSkillFile(path.join(sandbox, "root", "copy-one"));
    writeSkillFile(path.join(sandbox, "root", "copy-two"));
    const scans = canonicalizeCandidates(
      scanSkillRoots([root(path.join(sandbox, "root"), "claude-code")]),
    );
    expect(scans).toHaveLength(2);
    const hashes = scans.map(
      (scan) =>
        parseSkillDocument(fs.readFileSync(scan.sourcePath), path.basename(scan.canonicalPath))
          .contentHash,
    );
    expect(hashes[0]).toBe(hashes[1]);
    expect(scans[0]?.canonicalPath).not.toBe(scans[1]?.canonicalPath);
  });

  it("keeps different-content skills in separate groups with different hashes", () => {
    writeSkillFile(path.join(sandbox, "root", "alpha"), SKILL_CONTENT);
    writeSkillFile(
      path.join(sandbox, "root", "beta"),
      SKILL_CONTENT.replace("shared-skill", "beta-skill"),
    );
    const scans = canonicalizeCandidates(
      scanSkillRoots([root(path.join(sandbox, "root"), "claude-code")]),
    );
    expect(scans).toHaveLength(2);
    const hashes = scans.map(
      (scan) =>
        parseSkillDocument(fs.readFileSync(scan.sourcePath), path.basename(scan.canonicalPath))
          .contentHash,
    );
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it("marks conflict when both SKILL.md and .SKILL.md exist and indexes SKILL.md", () => {
    const directory = path.join(sandbox, "root", "conflicted");
    writeSkillFile(directory, SKILL_CONTENT, "SKILL.md");
    writeSkillFile(directory, SKILL_CONTENT.replace("shared", "disabled"), ".SKILL.md");
    const scans = canonicalizeCandidates(
      scanSkillRoots([root(path.join(sandbox, "root"), "claude-code")]),
    );
    expect(scans).toHaveLength(1);
    const scan = scans[0];
    if (!scan) throw new Error("expected the conflicted scan");
    expect(scan.conflict).toBe(true);
    expect(scan.disabled).toBe(false);
    expect(scan.sourceFile).toBe("SKILL.md");
    const parsed = parseSkillDocument(fs.readFileSync(scan.sourcePath), "conflicted");
    expect(parsed.name).toBe("shared-skill");
  });

  it("marks disabled when only .SKILL.md exists and indexes .SKILL.md bytes", () => {
    const disabledContent = SKILL_CONTENT.replace("shared", "hidden");
    const directory = path.join(sandbox, "root", "turned-off");
    writeSkillFile(directory, disabledContent, ".SKILL.md");
    const scans = canonicalizeCandidates(
      scanSkillRoots([root(path.join(sandbox, "root"), "claude-code")]),
    );
    expect(scans).toHaveLength(1);
    const scan = scans[0];
    if (!scan) throw new Error("expected the disabled scan");
    expect(scan.disabled).toBe(true);
    expect(scan.conflict).toBe(false);
    expect(scan.sourceFile).toBe(".SKILL.md");
    // contentHash 契约：实际被索引文件字节（disabled 参与内容源但不参与 hash 语义差异）。
    const raw = fs.readFileSync(scan.sourcePath);
    expect(parseSkillDocument(raw, "turned-off").contentHash).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
  });

  it("deduplicates identical installations from the same root listed twice", () => {
    writeSkillFile(path.join(sandbox, "root", "single"));
    const sameRoot = root(path.join(sandbox, "root"), "claude-code");
    const scans = canonicalizeCandidates(scanSkillRoots([sameRoot, sameRoot]));
    expect(scans).toHaveLength(1);
    expect(scans[0]?.installations).toHaveLength(1);
  });
});
