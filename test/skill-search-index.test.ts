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
import { blockFileAccess, restoreFileAccess } from "./helpers/fault-injection.js";
import crypto from "node:crypto";
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
  payloadDigest,
  SkillSearchIndexError,
  type FreshenSummary,
} from "../src/daemon/skill-search/index.js";
import {
  readSkillSearchDocument,
  SkillSearchDocumentReadError,
} from "../src/daemon/skill-search/service.js";
import { scanSkillRoots, type SkillRoot } from "../src/daemon/skill-search/scanner.js";
import type { SkillSearchDocument } from "../src/shared/contracts/search.js";
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

/** appDataDir → search-index.json 路径（故障注入助手的目标文件）。 */
function indexFileFor(appDataDir: string): string {
  return path.join(appDataDir, "search-index.json");
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

/** 篡改后重算载荷摘要（生产 payloadDigest 镜像），使测试穿透摘要层验证更深处的校验。 */
function refreshEnvelopeDigest(envelope: Record<string, unknown>): void {
  envelope.payloadDigest = payloadDigest(envelope.index, envelope.stats);
}

function refreshedEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  refreshEnvelopeDigest(envelope);
  return envelope;
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
    const stats = envelope.stats as Record<
      string,
      { canonicalPath: string; files: Array<{ ino: number; ctimeMs: number }> }
    >;
    const alphaKey = Object.keys(stats).find((id) => stats[id].canonicalPath.includes("alpha"));
    if (!alphaKey || !stats[alphaKey].files[0]) throw new Error("alpha stat missing");
    stats[alphaKey].files[0].ino += 1;
    stats[alphaKey].files[0].ctimeMs += 1;
    refreshEnvelopeDigest(envelope);
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
    expect(envelope.schemaVersion).toBe(3);
    expect(envelope.tokenizerVersion).toBe("segmenter-bigram-v1");
    expect(envelope.parserVersion).toBe("matter-mdset-v2");
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

  it("hard-errors on a blocked save and preserves the previous index file", () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = createSkillSearchIndex();
    index.freshen(scans(), readSkillSearchDocument);
    const file = path.join(home, ".skill-creator", "search-index.json");
    const before = fs.readFileSync(file, "utf8");
    blockFileAccess(file);

    try {
      writeSkill("beta", skillContent("beta", "second skill"));
      const nextProcess = createSkillSearchIndex();
      expect(() => nextProcess.freshen(scans(), readSkillSearchDocument)).toThrowError(
        SkillSearchIndexError,
      );
      // 保留原文件，不降级为空索引。
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    } finally {
      restoreFileAccess(file);
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

describe("skill search index load validation (external input boundary)", () => {
  it("rejects tampered stored projections and rebuilds with real metadata", () => {
    writeSkill("target", "---\nname: target\ndescription: real skill\n---\nbody");
    const first = createSkillSearchIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    first.freshen(scans, readSkillSearchDocument);
    const id = scans[0]!.id as string;

    const file = path.join(home, ".skill-creator", "search-index.json");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as {
      index: {
        documentIds: Record<string, string>;
        storedFields: Record<string, { canonicalPath: string; contentHash: string }>;
      };
    };
    const shortIdEntry = Object.entries(envelope.index.documentIds).find(
      ([, docId]) => docId === id,
    );
    const shortId = shortIdEntry?.[0]!;
    envelope.index.storedFields[shortId]!.canonicalPath = "/etc/passwd";
    envelope.index.storedFields[shortId]!.contentHash = "not-a-sha256";
    fs.writeFileSync(file, JSON.stringify(envelope));

    const second = createSkillSearchIndex();
    const summary = second.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    const hit = second.search("real skill").find((candidate) => candidate.id === id);
    expect(hit?.canonicalPath).not.toBe("/etc/passwd");
    expect(hit?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rebuilds instead of crashing when a stats entry was removed from the envelope", () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const first = createSkillSearchIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    first.freshen(scans, readSkillSearchDocument);

    const file = path.join(home, ".skill-creator", "search-index.json");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as {
      stats: Record<string, unknown>;
    };
    delete envelope.stats[scans[0]!.id as string];
    fs.writeFileSync(file, JSON.stringify(envelope));

    const second = createSkillSearchIndex();
    const summary = second.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    // 空/被裁剪 stats 经由 dirty-ratio 路径全量重建；关键断言是不崩溃且结果正确。
    expect(["corrupt", "dirty-ratio"]).toContain(summary.rebuildReason);
    expect(second.search("alpha skill")).toHaveLength(1);
  });

  it("invalidates in-memory state after a save failure and self-heals on the next call", () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const index = createSkillSearchIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    index.freshen(scans, readSkillSearchDocument);

    // 引入第二个 skill 后把 appDir 置为只读：save 失败必须抛错并作废内存状态。
    writeSkill("beta", "---\nname: beta\ndescription: beta skill\n---\nbody");
    const scansWithBeta = canonicalizeCandidates(scanSkillRoots([root()]));
    const appDataDir = path.join(home, ".skill-creator");
    blockFileAccess(indexFileFor(appDataDir));
    try {
      expect(() => index.freshen(scansWithBeta, readSkillSearchDocument)).toThrow(
        SkillSearchIndexError,
      );
    } finally {
      restoreFileAccess(indexFileFor(appDataDir));
    }

    // 下一次调用从磁盘重新加载并自愈（磁盘索引缺 beta → 增量补齐）。
    const summary = index.freshen(scansWithBeta, readSkillSearchDocument);
    expect(["incremental", "rebuilt"]).toContain(summary.mode);
    expect(index.search("beta").map((candidate) => candidate.name)).toEqual(["beta"]);
  });
});

describe("skill search index adversarial envelopes", () => {
  it("rechecks canonical path before accepting a jointly tampered fresh stat", () => {
    for (const name of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]) {
      writeSkill(name, skillContent(name, `${name} skill body`));
    }
    const first = createSkillSearchIndex();
    const allScans = scans();
    first.freshen(allScans, readSkillSearchDocument);
    const alphaScan = allScans.find((scan) => scan.canonicalPath.endsWith("alpha"));
    if (!alphaScan) throw new Error("alpha scan missing");
    const alphaId = alphaScan.id as string;

    const envelope = readEnvelopeFile();
    const index = envelope.index as {
      documentIds: Record<string, string>;
      storedFields: Record<string, { canonicalPath: string; contentHash: string }>;
    };
    const alphaShortId = Object.entries(index.documentIds).find(
      ([, documentId]) => documentId === alphaId,
    )?.[0];
    if (!alphaShortId) throw new Error("alpha short id missing");
    const stats = envelope.stats as Record<string, { canonicalPath: string; contentHash: string }>;
    // 两份外部元数据同步篡改为合法格式，旧实现会把这次 freshen 错判为 fresh。
    stats[alphaId]!.canonicalPath = "/etc/passwd";
    stats[alphaId]!.contentHash = "b".repeat(64);
    index.storedFields[alphaShortId]!.canonicalPath = "/etc/passwd";
    index.storedFields[alphaShortId]!.contentHash = "b".repeat(64);
    refreshEnvelopeDigest(envelope);
    writeEnvelopeFile(envelope);

    const second = createSkillSearchIndex();
    const counter = { calls: [] as string[] };
    const summary = second.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("incremental");
    expect(counter.calls).toEqual([alphaScan.canonicalPath]);
    const expected = readSkillSearchDocument(alphaScan);
    const hit = second.search("alpha skill").find((candidate) => candidate.id === alphaId);
    expect(hit?.canonicalPath).toBe(alphaScan.canonicalPath);
    expect(hit?.contentHash).toBe(expected.contentHash);
  });

  it("rejects format-valid tampering that contradicts stats metadata", () => {
    writeSkill("target", "---\nname: target\ndescription: real skill\n---\nbody");
    const first = createSkillSearchIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    first.freshen(scans, readSkillSearchDocument);
    const id = scans[0]!.id as string;

    const file = path.join(home, ".skill-creator", "search-index.json");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as {
      index: {
        documentIds: Record<string, string>;
        storedFields: Record<string, Record<string, unknown>>;
      };
    };
    // 全部通过 schema 的合法格式：64-hex hash + 非空路径，但与 stats 矛盾。
    const shortId = Object.entries(envelope.index.documentIds).find(
      ([, docId]) => docId === id,
    )?.[0]!;
    envelope.index.storedFields[shortId]!.canonicalPath = "/etc/passwd";
    envelope.index.storedFields[shortId]!.contentHash = "a".repeat(64);
    fs.writeFileSync(file, JSON.stringify(refreshedEnvelope(envelope)));

    const second = createSkillSearchIndex();
    const summary = second.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    const hit = second.search("real skill").find((candidate) => candidate.id === id);
    expect(hit?.canonicalPath).not.toBe("/etc/passwd");
    expect(hit?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("purges ghost documents whose stats entries were pruned with the skill deleted", () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    writeSkill("beta", "---\nname: beta\ndescription: beta skill\n---\nbody");
    const first = createSkillSearchIndex();
    const allScans = canonicalizeCandidates(scanSkillRoots([root()]));
    first.freshen(allScans, readSkillSearchDocument);
    const betaId = allScans.find(
      (scan) => (scan.id as string).length > 0 && scan.canonicalPath.endsWith("beta"),
    )!.id as string;

    // 磁盘删 beta，同时从信封裁剪其 stats：MiniSearch 里的 active 文档成为幽灵。
    fs.rmSync(path.join(sandbox, "skills", "beta"), { recursive: true, force: true });
    const file = path.join(home, ".skill-creator", "search-index.json");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as {
      stats: Record<string, unknown>;
    };
    delete envelope.stats[betaId];
    fs.writeFileSync(file, JSON.stringify(envelope));

    const second = createSkillSearchIndex();
    const alphaScans = allScans.filter((scan) => scan.canonicalPath.endsWith("alpha"));
    const summary = second.freshen(alphaScans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(second.search("beta")).toHaveLength(0);
    expect(second.search("alpha")).toHaveLength(1);
  });

  it("rejects duplicate active ids and their forged inverted projection", () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nalpha body");
    writeSkill("beta", "---\nname: beta\ndescription: beta skill\n---\nbeta body");
    const first = createSkillSearchIndex();
    const allScans = scans();
    first.freshen(allScans, readSkillSearchDocument);
    const alphaScan = allScans.find((scan) => scan.canonicalPath.endsWith("alpha"));
    const betaScan = allScans.find((scan) => scan.canonicalPath.endsWith("beta"));
    if (!alphaScan || !betaScan) throw new Error("alpha/beta scan missing");
    const alphaId = alphaScan.id as string;
    const betaId = betaScan.id as string;

    const envelope = readEnvelopeFile();
    const index = envelope.index as {
      documentIds: Record<string, string>;
      storedFields: Record<string, Record<string, unknown>>;
    };
    const alphaShortId = Object.entries(index.documentIds).find(
      ([, documentId]) => documentId === alphaId,
    )?.[0];
    const betaShortId = Object.entries(index.documentIds).find(
      ([, documentId]) => documentId === betaId,
    )?.[0];
    if (!alphaShortId || !betaShortId) throw new Error("alpha/beta short id missing");
    // beta 的短 id 复用 alpha，stored projection 也复制 alpha，同时裁剪 beta stats；
    // 其 beta 倒排词仍留在 MiniSearch payload 中，正是重复值 Set 的绕过向量。
    index.documentIds[betaShortId] = alphaId;
    index.storedFields[betaShortId] = index.storedFields[alphaShortId]!;
    delete (envelope.stats as Record<string, unknown>)[betaId];
    writeEnvelopeFile(envelope);

    const second = createSkillSearchIndex();
    const summary = second.freshen([alphaScan], readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    expect(second.documentCount()).toBe(1);
    expect(second.search("beta")).toEqual([]);
    expect(second.search("alpha")).toHaveLength(1);
  });

  it("rejects a SKILL.md replaced by an external symlink after the scan snapshot", () => {
    if (process.platform === "win32") return;
    writeSkill("target", "---\nname: target\ndescription: real skill\n---\nbody");
    const scan = scans()[0];
    if (!scan) throw new Error("target scan missing");
    const outside = path.join(sandbox, "outside.md");
    fs.writeFileSync(outside, "---\nname: outside\ndescription: secret marker\n---\noutside body");
    fs.rmSync(scan.sourcePath);
    fs.symlinkSync(outside, scan.sourcePath);

    expect(() => readSkillSearchDocument(scan)).toThrow(SkillSearchDocumentReadError);
  });

  it("does not fake freshness after a failed first rebuild persist", () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const index = createSkillSearchIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    const appDataDir = path.join(home, ".skill-creator");
    fs.mkdirSync(appDataDir, { recursive: true });
    blockFileAccess(indexFileFor(appDataDir));
    try {
      expect(() => index.freshen(scans, readSkillSearchDocument)).toThrow(SkillSearchIndexError);
    } finally {
      restoreFileAccess(indexFileFor(appDataDir));
    }
    expect(fs.existsSync(path.join(appDataDir, "search-index.json"))).toBe(false);

    // 恢复后：必须重建并真正落盘，而不是用未持久化的内存状态伪装 fresh。
    const summary = index.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(fs.existsSync(path.join(appDataDir, "search-index.json"))).toBe(true);
  });
});

describe("skill search index payload digest", () => {
  it("rejects control-plane tampering that keeps every other field intact", () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const first = createSkillSearchIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    first.freshen(scans, readSkillSearchDocument);

    // R4 复现向量：仅改 documentCount = -1（合法 JSON、其余不变、不重算摘要）。
    const envelope = readEnvelopeFile() as { index: { documentCount: number } };
    envelope.index.documentCount = -1;
    writeEnvelopeFile(envelope);

    const second = createSkillSearchIndex();
    const summary = second.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    const hits = second.search("alpha skill");
    expect(hits).toHaveLength(1);
    expect(Number.isFinite(hits[0]!.bm25)).toBe(true);
  });
});

describe("skill search index incremental atomicity", () => {
  it("leaves no partial state when a changed document fails identity verification", () => {
    for (const name of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
      writeSkill(name, skillContent(name, `${name} skill body`));
    }
    const index = createSkillSearchIndex();
    const firstScans = canonicalizeCandidates(scanSkillRoots([root()]));
    index.freshen(firstScans, readSkillSearchDocument);
    expect(index.documentCount()).toBe(6);

    // 低脏度（1/6）变更 + 读取失败：touch alpha 使其进入 changed，reader 对 alpha
    // 抛 typed 身份错误（等价于 TOCTOU 替换在读取瞬间被 fstat 拒绝）。
    const alphaScan = firstScans.find((scan) => scan.canonicalPath.includes("alpha"));
    if (!alphaScan) throw new Error("alpha scan missing");
    const now = new Date();
    fs.utimesSync(alphaScan.sourcePath, now, now);
    const failingReader = (scan: CanonicalSkillScan): SkillSearchDocument => {
      if (scan.canonicalPath.includes("alpha")) {
        throw new SkillSearchDocumentReadError("identity verification failed (simulated)");
      }
      return readSkillSearchDocument(scan);
    };

    expect(() =>
      index.freshen(canonicalizeCandidates(scanSkillRoots([root()])), failingReader),
    ).toThrow(SkillSearchDocumentReadError);

    // 原子一致性：失败后成员保持本轮开始前的完整状态（无 discard 残留、无半更新）。
    expect(index.documentCount()).toBe(6);
    expect(index.search("alpha").length).toBeGreaterThanOrEqual(1);
  });
});
