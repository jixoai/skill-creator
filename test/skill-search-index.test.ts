/**
 * SkillSearchIndex 持久化与新鲜度测试。
 *
 * User input [2026-09-17]: "freshen 先做无内容读取的 stat 扫描；stat 键全等直接查询；
 * 增删改走增量；版本不符/损坏重建；IO 故障 hard error 保留原文件；并发 last-writer-wins。"
 *
 * Orthogonal intents:
 *   [1] stat 新鲜度（fresh 零重解析 / 单文件增量 / 保时保长 ino+ctimeMs 检出）。
 *   [2] 错误矩阵（版本不符、损坏 JSON、loadJSON 失败重建；EACCES hard error）。
 *   [3] 串行并发 last-writer-wins 与读回可用性。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalizeCandidates,
  type CanonicalSkillScan,
} from "../src/daemon/skill-search/canonicalize.js";
import {
  createSkillSearchIndex,
  ENGINE_CONFIG_DIGEST,
  minisearchRuntimeVersion,
  SkillSearchIndexError,
  type FreshenSummary,
} from "../src/daemon/skill-search/index.js";
import { readSkillSearchDocument } from "../src/daemon/skill-search/service.js";
import { scanSkillRoots, type SkillRoot } from "../src/daemon/skill-search/scanner.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../src/shared/contracts/workspaces.js";

let sandbox = "";
let home = "";
const previousHome = process.env.SKILL_CREATOR_HOME;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-index-test-"));
  home = path.join(sandbox, "state-home");
  process.env.SKILL_CREATOR_HOME = home;
  setHomeOverride(home);
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 每次调用基于当前 sandbox 解析 root（sandbox 在 beforeEach 中轮换）。 */
function root(): SkillRoot {
  return {
    rootPath: path.join(sandbox, "skills"),
    workspaceId: GLOBAL_WORKSPACE_ID,
    providerId: ProviderIdSchema.parse("claude-code"),
  };
}

function writeSkill(name: string, content: string): string {
  const directory = path.join(sandbox, "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), content);
  return directory;
}

const skillContent = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n${name} body text.\n`;

function scans(): CanonicalSkillScan[] {
  return canonicalizeCandidates(scanSkillRoots([root()]));
}

/** 统计真实解析次数的 readDocument 桩（透传给真实 reader）。 */
function countingReader(counter: { calls: string[] }) {
  return (scan: CanonicalSkillScan) => {
    counter.calls.push(scan.canonicalPath);
    return readSkillSearchDocument(scan);
  };
}

function readEnvelopeFile(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(home, ".skill-creator", "search-index.json"), "utf8"),
  ) as Record<string, unknown>;
}

function writeEnvelopeFile(value: unknown): void {
  const file = path.join(home, ".skill-creator", "search-index.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

describe("skill search index freshness", () => {
  const SIX_SKILLS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

  function writeSixSkills(): void {
    for (const name of SIX_SKILLS) writeSkill(name, skillContent(name, `${name} skill body`));
  }

  it("rebuilds on first run and performs zero reparses when stats are unchanged", () => {
    writeSixSkills();
    const index = createSkillSearchIndex();
    const counter = { calls: [] };

    const first = index.freshen(scans(), countingReader(counter));
    expect(first.mode).toBe("rebuilt");
    expect(first.parsed).toBe(6);
    expect(index.documentCount()).toBe(6);

    // 第二个实例从磁盘加载（模拟下一次 CLI 进程），stat 全等 → 零重解析。
    const nextProcess = createSkillSearchIndex();
    const secondCounter = { calls: [] };
    const second = nextProcess.freshen(scans(), countingReader(secondCounter));
    expect(second.mode).toBe("fresh");
    expect(secondCounter.calls).toEqual([]);
    expect(nextProcess.documentCount()).toBe(6);
    expect(nextProcess.search("alpha")).toHaveLength(1);
  });

  it("reparses only the changed file on an mtime-touching edit", () => {
    writeSixSkills();
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);

    // 修改 alpha（写入新内容，mtime/size 变化）；1/6 脏度低于 20% 重建阈值 → 增量。
    writeSkill("alpha", skillContent("alpha", "alpha skill body, edited"));
    const counter = { calls: [] };
    const summary = index.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("incremental");
    expect(counter.calls).toHaveLength(1);
    expect(counter.calls[0]).toContain("alpha");
    expect(index.documentCount()).toBe(6);
    expect(index.search("edited")).toHaveLength(1);
  });

  it("detects a same-mtime same-size replacement through ino/ctimeMs", () => {
    writeSixSkills();
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);
    const file = path.join(sandbox, "skills", "alpha", "SKILL.md");
    const statBefore = fs.statSync(file);

    // 篡改持久化 stats 的 ino/ctimeMs（模拟保时保长替换后 stat 四元组的 inode 侧差异）。
    const envelope = readEnvelopeFile();
    const stats = envelope.stats as Record<string, { ino: number; ctimeMs: number }>;
    const alphaKey = Object.keys(stats).find((id) => stats[id].canonicalPath.includes("alpha"));
    if (!alphaKey) throw new Error("alpha stat missing");
    stats[alphaKey].ino += 1;
    stats[alphaKey].ctimeMs += 1;
    writeEnvelopeFile(envelope);
    expect(fs.statSync(file).mtimeMs).toBe(statBefore.mtimeMs);

    const nextProcess = createSkillSearchIndex();
    const counter = { calls: [] };
    const summary = nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("incremental");
    expect(counter.calls).toHaveLength(1);
    expect(counter.calls[0]).toContain("alpha");
  });

  it("rebuilds fully when any envelope version or engine digest mismatches", () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);

    const envelope = readEnvelopeFile();
    (envelope as { tokenizerVersion: string }).tokenizerVersion = "segmenter-bigram-v0";
    writeEnvelopeFile(envelope);

    const nextProcess = createSkillSearchIndex();
    const counter = { calls: [] };
    const summary = nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("incompatible");
    expect(counter.calls).toHaveLength(1);
  });

  it("writes the five-version envelope with the runtime engine version", () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);
    const envelope = readEnvelopeFile();
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.tokenizerVersion).toBe("segmenter-bigram-v1");
    expect(envelope.parserVersion).toBe("matter-headings-12k-v1");
    expect(envelope.rankingVersion).toBe("rerank-2026-09-17-v1");
    expect(envelope.engine).toEqual({
      name: "minisearch",
      version: minisearchRuntimeVersion(),
      configDigest: ENGINE_CONFIG_DIGEST,
    });
    expect(Object.keys(envelope.stats as object)).toHaveLength(1);
  });
});

describe("skill search index error matrix", () => {
  it("rebuilds from corrupt JSON and still answers queries", () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);
    writeEnvelopeFile("{ this is not json");

    const nextProcess = createSkillSearchIndex();
    const counter = { calls: [] };
    const summary = nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    expect(nextProcess.search("alpha")).toHaveLength(1);
  });

  it("rebuilds when MiniSearch loadJSON fails on an incompatible index payload", () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);
    const envelope = readEnvelopeFile();
    // 信封 Zod 通过（index: unknown），但序列化版本缺失 → loadJSON 抛错 → 空索引重建。
    envelope.index = { bogus: true };
    writeEnvelopeFile(envelope);

    const nextProcess = createSkillSearchIndex();
    const counter = { calls: [] };
    const summary = nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    expect(counter.calls).toHaveLength(1);
  });

  it("hard-errors on EACCES during save and preserves the previous index file", () => {
    if (process.platform === "win32") return; // chmod 语义在 Windows 不可移植。
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);
    const file = path.join(home, ".skill-creator", "search-index.json");
    const before = fs.readFileSync(file, "utf8");
    fs.chmodSync(path.dirname(file), 0o500);

    try {
      writeSkill("beta", skillContent("beta", "second skill"));
      const nextProcess = createSkillSearchIndex();
      expect(() => nextProcess.freshen(scans(), readSkillSearchDocument)).toThrowError(
        SkillSearchIndexError,
      );
      // 保留原文件，不降级为空索引。
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    } finally {
      fs.chmodSync(path.dirname(file), 0o700);
    }
  });
});

describe("skill search index concurrency", () => {
  it("applies last-writer-wins across serial freshen writes and stays readable", () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const first = createSkillSearchIndex();
    const firstSummary: FreshenSummary = first.freshen(scans(), readSkillSearchDocument);
    expect(firstSummary.mode).toBe("rebuilt");

    // 第二个写者（后写胜）：移除 alpha、加入 beta 后落盘。
    fs.rmSync(path.join(sandbox, "skills", "alpha"), { recursive: true });
    writeSkill("beta", skillContent("beta", "second skill"));
    const second = createSkillSearchIndex();
    const secondSummary = second.freshen(scans(), readSkillSearchDocument);
    expect(secondSummary.mode).toBe("rebuilt");

    // 读者读回仍可用；stale stat 校验在下次 freshen 自愈。
    const reader = createSkillSearchIndex();
    reader.freshen(scans(), readSkillSearchDocument);
    expect(reader.documentCount()).toBe(1);
    expect(reader.search("beta")).toHaveLength(1);
    expect(reader.search("alpha")).toEqual([]);
  });
});
