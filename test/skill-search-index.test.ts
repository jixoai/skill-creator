/**
 * SkillSearchIndex 持久化与新鲜度测试（@jixoai/search 两层信封：包索引目录 +
 * meta.json 登记表；2026-09-21 Phase 2 迁移自 MiniSearch 单文件信封）。
 *
 * User input [2026-09-17]: "freshen 先做无内容读取的 stat 扫描；stat 键全等直接查询；
 * 增删改走增量；版本不符/损坏重建；IO 故障 hard error 保留原文件；并发 last-writer-wins。"
 *
 * Orthogonal intents:
 *   [1] stat 新鲜度（fresh 零重解析 / 单文件增量 / 保时保长 ino+ctimeMs 检出）。
 *   [2] 错误矩阵（configDigest 不符、损坏 JSON、登记表条目 schema 违例、引擎被
 *       静默清空（金丝雀）重建；EACCES hard error）。
 *   [3] 串行并发 last-writer-wins 与读回可用性。
 */
import {
  blockFileAccess,
  holdFileForBlockedWrite,
  releaseHeldFile,
  restoreFileAccess,
} from "./helpers/fault-injection.js";
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
  payloadDigest,
  resolveSkillSearchBackend,
  skillSearchConfigDigest,
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

/** 创建即登记：afterEach 统一关闭引擎句柄（Windows 上未释放句柄让删除 EPERM）。 */
function makeIndex() {
  const index = createSkillSearchIndex();
  openIndexes.push(index);
  return index;
}
const openIndexes: Array<ReturnType<typeof createSkillSearchIndex>> = [];

afterEach(async () => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  await Promise.all(openIndexes.map((index) => index.close().catch(() => undefined)));
  openIndexes.length = 0;
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

/** 登记表路径 <home>/.skill-creator/search/meta.json（故障注入助手的目标文件）。 */
function metaFile(): string {
  return path.join(home, ".skill-creator", "search", "meta.json");
}

/** 包索引目录 <home>/.skill-creator/search/index/。 */
function engineDirectory(): string {
  return path.join(home, ".skill-creator", "search", "index");
}

function readEnvelopeFile(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(metaFile(), "utf8")) as Record<string, unknown>;
}

function writeEnvelopeFile(value: unknown): void {
  fs.mkdirSync(path.dirname(metaFile()), { recursive: true });
  fs.writeFileSync(metaFile(), typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

/** 篡改后重算载荷摘要（生产 payloadDigest 镜像），使测试穿透摘要层验证更深处的校验。 */
function refreshEnvelopeDigest(envelope: Record<string, unknown>): void {
  envelope.payloadDigest = payloadDigest(envelope.documents);
}

describe("skill search index freshness", () => {
  const SIX_SKILLS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

  function writeSixSkills(): void {
    for (const name of SIX_SKILLS) writeSkill(name, skillContent(name, `${name} skill body`));
  }

  it("rebuilds on first run and performs zero reparses when stats are unchanged", async () => {
    writeSixSkills();
    const index = makeIndex();
    const counter = { calls: [] };

    const first = await index.freshen(scans(), countingReader(counter));
    expect(first.mode).toBe("rebuilt");
    expect(first.parsed).toBe(6);
    expect(index.documentCount()).toBe(6);

    // 第二个实例从磁盘加载（模拟下一次 CLI 进程），stat 全等 → 零重解析。
    const nextProcess = makeIndex();
    const secondCounter = { calls: [] };
    const second = await nextProcess.freshen(scans(), countingReader(secondCounter));
    expect(second.mode).toBe("fresh");
    expect(secondCounter.calls).toEqual([]);
    expect(nextProcess.documentCount()).toBe(6);
    expect(await nextProcess.search("alpha")).toHaveLength(1);
  });

  it("reparses only the changed file on an mtime-touching edit", async () => {
    writeSixSkills();
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);

    // 修改 alpha（写入新内容，mtime/size 变化）；1/6 脏度低于 20% 重建阈值 → 增量。
    writeSkill("alpha", skillContent("alpha", "alpha skill body, edited"));
    const counter = { calls: [] };
    const summary = await index.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("incremental");
    expect(counter.calls).toHaveLength(1);
    expect(counter.calls[0]).toContain("alpha");
    expect(index.documentCount()).toBe(6);
    expect(await index.search("edited")).toHaveLength(1);
  });

  it("detects a same-mtime same-size replacement through ino/ctimeMs", async () => {
    writeSixSkills();
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);
    const file = path.join(sandbox, "skills", "alpha", "SKILL.md");
    const statBefore = fs.statSync(file);

    // 篡改登记表的 ino/ctimeMs（模拟保时保长替换后 stat 四元组的 inode 侧差异）。
    const envelope = readEnvelopeFile();
    const documents = envelope.documents as Record<
      string,
      { canonicalPath: string; files: Array<{ ino: number; ctimeMs: number }> }
    >;
    const alphaKey = Object.keys(documents).find((id) =>
      documents[id].canonicalPath.includes("alpha"),
    );
    if (!alphaKey || !documents[alphaKey].files[0]) throw new Error("alpha stat missing");
    documents[alphaKey].files[0].ino += 1;
    documents[alphaKey].files[0].ctimeMs += 1;
    refreshEnvelopeDigest(envelope);
    writeEnvelopeFile(envelope);
    expect(fs.statSync(file).mtimeMs).toBe(statBefore.mtimeMs);

    const nextProcess = makeIndex();
    const counter = { calls: [] };
    const summary = await nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("incremental");
    expect(counter.calls).toHaveLength(1);
    expect(counter.calls[0]).toContain("alpha");
  });

  it("rebuilds fully when the config digest mismatches", async () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);

    const envelope = readEnvelopeFile();
    (envelope as { configDigest: string }).configDigest = `${"d".repeat(64)}`;
    writeEnvelopeFile(envelope);

    // 前一进程退出（句柄释放）后才存在后继进程：Windows 上打开的 sqlite
    // 句柄会阻塞 rebuild 的目录删除（macOS 的 unlink 宽容掩盖了进程边界）。
    await index.close();
    const nextProcess = makeIndex();
    const counter = { calls: [] };
    const summary = await nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("incompatible");
    expect(counter.calls).toHaveLength(1);
  });

  it("writes the v4 registry envelope with the frozen config digest", async () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);
    const envelope = readEnvelopeFile();
    expect(envelope.schemaVersion).toBe(4);
    // createSkillSearchIndex() 缺省摘要源为空串；backend 走当前解析值。
    expect(envelope.configDigest).toBe(skillSearchConfigDigest("", resolveSkillSearchBackend()));
    expect(Object.keys(envelope.documents as object)).toHaveLength(1);
    // 两层信封：包索引目录与登记表同在 <appDir>/search/ 下。
    expect(fs.existsSync(path.join(engineDirectory(), "envelope.json"))).toBe(true);
  });
});

describe("skill search index error matrix", () => {
  it("rebuilds from corrupt JSON and still answers queries", async () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);
    writeEnvelopeFile("{ this is not json");

    // 进程边界：前身退出后再起后继（见 config digest 用例注）。
    await index.close();
    const nextProcess = makeIndex();
    const counter = { calls: [] };
    const summary = await nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    expect(await nextProcess.search("alpha")).toHaveLength(1);
  });

  it("rebuilds when a registry entry violates the entry schema", async () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);
    const envelope = readEnvelopeFile();
    const documents = envelope.documents as Record<string, { contentHash: string }>;
    documents[Object.keys(documents)[0]!]!.contentHash = "not-a-sha256";
    refreshEnvelopeDigest(envelope);
    writeEnvelopeFile(envelope);

    // 进程边界：前身退出后再起后继（见 config digest 用例注）。
    await index.close();
    const nextProcess = makeIndex();
    const counter = { calls: [] };
    const summary = await nextProcess.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    expect(counter.calls).toHaveLength(1);
  });

  it("hard-errors on a blocked save and preserves the previous registry file", async () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);
    const before = fs.readFileSync(metaFile(), "utf8");
    holdFileForBlockedWrite(metaFile());

    try {
      writeSkill("beta", skillContent("beta", "second skill"));
      const nextProcess = makeIndex();
      await expect(nextProcess.freshen(scans(), readSkillSearchDocument)).rejects.toThrowError(
        SkillSearchIndexError,
      );
      // 保留原文件，不降级为空索引。
      expect(fs.readFileSync(metaFile(), "utf8")).toBe(before);
    } finally {
      releaseHeldFile(metaFile());
    }
  });
});

describe("skill search index concurrency", () => {
  it("applies last-writer-wins across serial freshen writes and stays readable", async () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const first = makeIndex();
    const firstSummary: FreshenSummary = await first.freshen(scans(), readSkillSearchDocument);
    expect(firstSummary.mode).toBe("rebuilt");

    // 第二个写者（后写胜）：移除 alpha、加入 beta 后落盘。写者交替按进程
    // 边界串行（前身先退出；见 config digest 用例注）。
    fs.rmSync(path.join(sandbox, "skills", "alpha"), { recursive: true });
    writeSkill("beta", skillContent("beta", "second skill"));
    await first.close();
    const second = makeIndex();
    const secondSummary: FreshenSummary = await second.freshen(scans(), readSkillSearchDocument);
    expect(secondSummary.mode).toBe("rebuilt");

    // 读者读回仍可用；stale stat 校验在下次 freshen 自愈。
    await second.close();
    const reader = makeIndex();
    await reader.freshen(scans(), readSkillSearchDocument);
    expect(reader.documentCount()).toBe(1);
    expect(await reader.search("beta")).toHaveLength(1);
    expect(await reader.search("alpha")).toEqual([]);
  });
});

describe("skill search index load validation (external input boundary)", () => {
  it("rebuilds when the engine index was silently wiped under an intact registry", async () => {
    writeSkill("target", "---\nname: target\ndescription: real skill\n---\nbody");
    const first = makeIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    await first.freshen(scans, readSkillSearchDocument);
    const id = scans[0]!.id as string;

    // 包信封不匹配（tokenizerVersion 篡改）→ openIndex 静默删除重建空索引；登记
    // 表完好。金丝雀必须检出「登记表有文档而引擎召回不了」并全量重建。
    const packageEnvelopeFile = path.join(engineDirectory(), "envelope.json");
    const packageEnvelope = JSON.parse(fs.readFileSync(packageEnvelopeFile, "utf8")) as {
      tokenizerVersion: string;
    };
    packageEnvelope.tokenizerVersion = "tampered";
    fs.writeFileSync(packageEnvelopeFile, JSON.stringify(packageEnvelope));

    // 进程边界：前身退出后再起后继（见 config digest 用例注）。
    await first.close();
    const second = makeIndex();
    const summary = await second.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    const hit = (await second.search("real skill")).find((candidate) => candidate.id === id);
    expect(hit?.canonicalPath).not.toBe("/etc/passwd");
    expect(hit?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rebuilds instead of crashing when a registry entry was removed from the envelope", async () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const first = makeIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    await first.freshen(scans, readSkillSearchDocument);

    const envelope = readEnvelopeFile() as { documents: Record<string, unknown> };
    delete envelope.documents[scans[0]!.id as string];
    writeEnvelopeFile(envelope);

    // 进程边界：前身退出后再起后继（见 config digest 用例注）。
    await first.close();
    const second = makeIndex();
    const summary = await second.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    // 被裁剪的登记表经载荷摘要或脏度路径全量重建；关键断言是不崩溃且结果正确。
    expect(["corrupt", "dirty-ratio"]).toContain(summary.rebuildReason);
    expect(await second.search("alpha skill")).toHaveLength(1);
  });

  it("invalidates in-memory state after a save failure and self-heals on the next call", async () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const index = makeIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    await index.freshen(scans, readSkillSearchDocument);

    // 引入第二个 skill 后把登记表置为只读：save 失败必须抛错并作废内存状态。
    writeSkill("beta", "---\nname: beta\ndescription: beta skill\n---\nbody");
    const scansWithBeta = canonicalizeCandidates(scanSkillRoots([root()]));
    blockFileAccess(metaFile());
    try {
      await expect(index.freshen(scansWithBeta, readSkillSearchDocument)).rejects.toThrow(
        SkillSearchIndexError,
      );
    } finally {
      restoreFileAccess(metaFile());
    }

    // 下一次调用从磁盘重新加载并自愈（磁盘登记表缺 beta → 增量补齐）。
    const summary = await index.freshen(scansWithBeta, readSkillSearchDocument);
    expect(["incremental", "rebuilt"]).toContain(summary.mode);
    expect((await index.search("beta")).map((candidate) => candidate.name)).toEqual(["beta"]);
  });
});

describe("skill search index adversarial envelopes", () => {
  it("rechecks canonical path before accepting a jointly tampered fresh stat", async () => {
    for (const name of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]) {
      writeSkill(name, skillContent(name, `${name} skill body`));
    }
    const first = makeIndex();
    const allScans = scans();
    await first.freshen(allScans, readSkillSearchDocument);
    const alphaScan = allScans.find((scan) => scan.canonicalPath.endsWith("alpha"));
    if (!alphaScan) throw new Error("alpha scan missing");
    const alphaId = alphaScan.id as string;

    const envelope = readEnvelopeFile();
    const documents = envelope.documents as Record<
      string,
      { canonicalPath: string; contentHash: string }
    >;
    // 两份外部元数据同步篡改为合法格式并重算摘要，旧实现会把这次 freshen 错判为 fresh。
    documents[alphaId]!.canonicalPath = "/etc/passwd";
    documents[alphaId]!.contentHash = "b".repeat(64);
    refreshEnvelopeDigest(envelope);
    writeEnvelopeFile(envelope);

    const second = makeIndex();
    const counter = { calls: [] as string[] };
    const summary = await second.freshen(scans(), countingReader(counter));
    expect(summary.mode).toBe("incremental");
    expect(counter.calls).toEqual([alphaScan.canonicalPath]);
    const expected = readSkillSearchDocument(alphaScan);
    const hit = (await second.search("alpha skill")).find((candidate) => candidate.id === alphaId);
    expect(hit?.canonicalPath).toBe(alphaScan.canonicalPath);
    expect(hit?.contentHash).toBe(expected.contentHash);
  });

  it("purges ghost documents whose registry entries were pruned with the skill deleted", async () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    writeSkill("beta", "---\nname: beta\ndescription: beta skill\n---\nbody");
    const first = makeIndex();
    const allScans = scans();
    await first.freshen(allScans, readSkillSearchDocument);
    const betaId = allScans.find(
      (scan) => (scan.id as string).length > 0 && scan.canonicalPath.endsWith("beta"),
    )!.id as string;

    // 磁盘删 beta，同时从登记表裁剪其条目（摘要不重算）：载荷摘要失配 → 全量重建，
    // 引擎中的 beta 幽灵文档随重建清除（旧 MiniSearch 活跃 id 镜像校验的等价物）。
    fs.rmSync(path.join(sandbox, "skills", "beta"), { recursive: true, force: true });
    const envelope = readEnvelopeFile() as { documents: Record<string, unknown> };
    delete envelope.documents[betaId];
    writeEnvelopeFile(envelope);

    // 进程边界：前身退出后再起后继（见 config digest 用例注）。
    await first.close();
    const second = makeIndex();
    const alphaScans = allScans.filter((scan) => scan.canonicalPath.endsWith("alpha"));
    const summary = await second.freshen(alphaScans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(await second.search("beta")).toHaveLength(0);
    expect(await second.search("alpha")).toHaveLength(1);
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

  it("does not fake freshness after a failed first rebuild persist", async () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const index = makeIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    fs.mkdirSync(path.dirname(metaFile()), { recursive: true });
    blockFileAccess(metaFile());
    try {
      await expect(index.freshen(scans, readSkillSearchDocument)).rejects.toThrow(
        SkillSearchIndexError,
      );
    } finally {
      restoreFileAccess(metaFile());
    }
    expect(fs.existsSync(metaFile())).toBe(false);

    // 恢复后：必须重建并真正落盘，而不是用未持久化的内存状态伪装 fresh。
    const summary = await index.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(fs.existsSync(metaFile())).toBe(true);
  });
});

describe("skill search index backend selection", () => {
  it("resolves the env override with invalid values falling back to sqlite", () => {
    const previous = process.env.SKILL_CREATOR_SEARCH_BACKEND;
    try {
      delete process.env.SKILL_CREATOR_SEARCH_BACKEND;
      expect(resolveSkillSearchBackend()).toBe("sqlite");
      process.env.SKILL_CREATOR_SEARCH_BACKEND = "tantivy";
      expect(resolveSkillSearchBackend()).toBe("tantivy");
      process.env.SKILL_CREATOR_SEARCH_BACKEND = "sqlite";
      expect(resolveSkillSearchBackend()).toBe("sqlite");
      // 非法取值回落默认（外部输入收窄：不因拼错的 env 静默改变行为面）。
      process.env.SKILL_CREATOR_SEARCH_BACKEND = "sqllite-typo";
      expect(resolveSkillSearchBackend()).toBe("sqlite");
    } finally {
      if (previous === undefined) delete process.env.SKILL_CREATOR_SEARCH_BACKEND;
      else process.env.SKILL_CREATOR_SEARCH_BACKEND = previous;
    }
  });

  it("rebuilds when the backend changes under an intact registry", async () => {
    writeSkill("alpha", skillContent("alpha", "first skill"));
    const index = makeIndex();
    await index.freshen(scans(), readSkillSearchDocument);

    // 模拟 env 切换 backend：backend 是 configDigest 成员——以另一 backend 的
    // 摘要落盘后，当前解析摘要不符 → incompatible 全量重建（索引内容随之重灌）。
    const envelope = readEnvelopeFile();
    (envelope as { configDigest: string }).configDigest = skillSearchConfigDigest(
      "",
      resolveSkillSearchBackend() === "sqlite" ? "tantivy" : "sqlite",
    );
    writeEnvelopeFile(envelope);

    // 进程边界：前身退出后再起后继（见 config digest 用例注）。
    await index.close();
    const nextProcess = makeIndex();
    const summary = await nextProcess.freshen(scans(), readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("incompatible");
    expect(await nextProcess.search("alpha")).toHaveLength(1);
  });
});

describe("skill search index payload digest", () => {
  it("rejects control-plane tampering that keeps every other field intact", async () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: alpha skill\n---\nbody");
    const first = makeIndex();
    const scans = canonicalizeCandidates(scanSkillRoots([root()]));
    await first.freshen(scans, readSkillSearchDocument);

    // 复现向量：仅改一个 stat 四元组字段（合法 JSON、其余不变、不重算摘要）。
    const envelope = readEnvelopeFile() as {
      documents: Record<string, { files: Array<{ size: number }> }>;
    };
    const entry = Object.values(envelope.documents)[0]!;
    entry.files[0]!.size += 1;
    writeEnvelopeFile(envelope);

    // 进程边界：前身退出后再起后继（见 config digest 用例注）。
    await first.close();
    const second = makeIndex();
    const summary = await second.freshen(scans, readSkillSearchDocument);
    expect(summary.mode).toBe("rebuilt");
    expect(summary.rebuildReason).toBe("corrupt");
    const hits = await second.search("alpha skill");
    expect(hits).toHaveLength(1);
    expect(Number.isFinite(hits[0]!.bm25)).toBe(true);
  });
});

describe("skill search index incremental atomicity", () => {
  it("leaves no partial state when a changed document fails identity verification", async () => {
    for (const name of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
      writeSkill(name, skillContent(name, `${name} skill body`));
    }
    const index = makeIndex();
    const firstScans = canonicalizeCandidates(scanSkillRoots([root()]));
    await index.freshen(firstScans, readSkillSearchDocument);
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

    await expect(
      index.freshen(canonicalizeCandidates(scanSkillRoots([root()])), failingReader),
    ).rejects.toThrow(SkillSearchDocumentReadError);

    // 原子一致性：失败后成员保持本轮开始前的完整状态（无 remove 残留、无半更新）。
    expect(index.documentCount()).toBe(6);
    expect((await index.search("alpha")).length).toBeGreaterThanOrEqual(1);
  });
});
