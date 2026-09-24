/**
 * Codex R8 独立探针 → 回归化负例（openspec skill-steward-contracts R8 整改收尾）。
 *
 * 来源：复核者在主工作树留下的 5 个对抗性探针（原始断言是「演示漏洞可被触发」），
 * 本文件把每个探针改写为「整改后必须 typed 拒绝且外部路径零字节落地」的回归断言：
 *   [1] manifest.jsonl 预置 symlink → O_NOFOLLOW 追加失败，外部文件不被写入。
 *   [2] 调用方传入 symlink root → assertRealRoot 拒绝（realpath 恒等攻击面关闭）。
 *   [3] journal leaf 预置 symlink → O_NOFOLLOW 追加失败，事务 typed 终态且零外部字节。
 *   [4] 删除 resource 行后整体重编号的部分 journal → manifest 双射拒绝（以及
 *       proposal 目标绑定拒绝）；manifest 多于 journal move 步骤同样拒绝。
 *   [5] 重复 commit 记录 → assertCommittedJournal 拒绝（终态索引唯一性）。
 */
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SkillProposalSchema,
  SkillStewardContextSnapshotSchema,
  type SkillProposal,
  type SkillStewardContextSnapshot,
} from "../src/shared/contracts/skill-steward.js";
import {
  applyProposalTransaction,
  assertCommittedJournal,
  undoJournalSteps,
} from "../src/daemon/steward/apply-transaction.js";
import {
  prepareBackupRoot,
  writeBackupWithManifest,
  writeFileExclusiveVerified,
} from "../src/daemon/steward/fs-authority.js";
import { readJournal, type JournalEntry } from "../src/daemon/steward/journal-schema.js";

const fixtureDir = path.join(process.cwd(), "test", "fixtures", "steward");

function fixtureSnapshot(): SkillStewardContextSnapshot {
  return SkillStewardContextSnapshotSchema.parse(
    JSON.parse(fsSync.readFileSync(path.join(fixtureDir, "snapshot.imported.json"), "utf8")),
  );
}

function fixtureDisableProposal(): SkillProposal {
  return SkillProposalSchema.parse(
    JSON.parse(fsSync.readFileSync(path.join(fixtureDir, "proposal-disable.valid.json"), "utf8")),
  );
}

function tmp(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), "steward-r8-independent-"));
}

describe("Codex R8 independent probes (regression-ized)", () => {
  it("[1] a symlinked manifest.jsonl leaf rejects the backup write; external file untouched", async () => {
    const root = tmp();
    const journalPath = path.join(root, "journal", "op.jsonl");
    fsSync.mkdirSync(path.dirname(journalPath), { recursive: true });
    const backupRoot = await prepareBackupRoot(journalPath);
    const outsideManifest = path.join(root, "outside-manifest.jsonl");
    fsSync.writeFileSync(outsideManifest, "EXTERNAL\n", "utf8");
    fsSync.symlinkSync(outsideManifest, path.join(backupRoot, "manifest.jsonl"));

    await expect(
      writeBackupWithManifest({
        journalPath,
        ref: "1-aaaaaaaaaaaa.bin",
        seq: 1,
        from: "source/notes.md",
        bytes: Buffer.from("manager-secret\n", "utf8"),
      }),
    ).rejects.toThrow();
    // 外部 manifest 文件保持原样：manager 字节零落地。
    expect(fsSync.readFileSync(outsideManifest, "utf8")).toBe("EXTERNAL\n");
  });

  it("[2] a symlinked manager root is rejected before any write lands outside", async () => {
    const root = tmp();
    const outside = path.join(root, "outside");
    const rootLink = path.join(root, "manager-root");
    fsSync.mkdirSync(outside, { recursive: true });
    fsSync.symlinkSync(outside, rootLink);

    await expect(
      writeFileExclusiveVerified(
        path.join(rootLink, "escaped.bin"),
        rootLink,
        Buffer.from("outside-bytes", "utf8"),
        "root-symlink-probe",
      ),
    ).rejects.toThrow(/not a real directory|symlink/i);
    expect(fsSync.existsSync(path.join(outside, "escaped.bin"))).toBe(false);
  });

  it("[3] a symlinked journal leaf fails closed; no manager bytes reach the external file", async () => {
    const root = tmp();
    const snapshot = fixtureSnapshot();
    const proposal = fixtureDisableProposal();
    const journalPath = path.join(root, "journal", "op.jsonl");
    fsSync.mkdirSync(path.dirname(journalPath), { recursive: true });
    const outsideJournal = path.join(root, "outside-journal.jsonl");
    fsSync.writeFileSync(outsideJournal, "EXTERNAL\n", "utf8");
    fsSync.symlinkSync(outsideJournal, journalPath);

    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: {
        resolveWritable: () => ({ directory: root }),
      } as never,
      skills: {
        info: async (_target: unknown, skillId: string) => ({
          skillId,
          revision: snapshot.skills.find((skill) => skill.skillId === skillId)!.revision,
          disabled: false,
        }),
        toggle: async () => ({ results: [] }),
        invalidateDiscovery: () => undefined,
      } as never,
      creator: {} as never,
      store: {} as never,
      journalPath,
    });

    // O_NOFOLLOW 打开失败 → 记账失败 → typed 终态（绝不是 applied）。
    expect(outcome.status).not.toBe("applied");
    // 外部 journal 文件内容不变。
    expect(fsSync.readFileSync(outsideJournal, "utf8")).toBe("EXTERNAL\n");
  });

  it("[4] a re-numbered journal missing the resource step is rejected before replay", async () => {
    const journalPath = path.join(tmp(), "op.jsonl");
    const entries: JournalEntry[] = [
      { seq: 1, step: "precheck", detail: { kind: "precheck", targets: ["merged-skill"] } },
      {
        seq: 2,
        step: "create-target",
        detail: {
          kind: "content",
          directoryName: "merged-skill",
          revision: `sha256:${"a".repeat(64)}`,
        },
      },
      {
        seq: 3,
        step: "disable",
        detail: {
          kind: "enablement",
          skillId: "sk_a1b2c3d4e5f6a7b8c9d0e1f2",
          wasDisabled: false,
          revision: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        },
      },
      {
        seq: 4,
        step: "commit",
        detail: {
          kind: "commit",
          proposalId: "spp_0123456789abcdef",
          status: "applied",
          mutationCount: 3,
        },
      },
    ];
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await fs.writeFile(
      journalPath,
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    const parsed = await readJournal(journalPath);
    expect(parsed).toHaveLength(4);
    // R9 整改：commit 的 mutationCount(3) 与磁盘 mutation 步骤数(2) 失配——删除
    // resource 行后重编号（seq 仍连续）在终态闸即被拒绝。
    expect(() => assertCommittedJournal(parsed, { proposalId: "spp_0123456789abcdef" })).toThrow(
      /mutationCount .* does not match/i,
    );

    // 双保险：即便计数被一并伪造成匹配，proposal 目标绑定仍拒绝该 journal。
    const checked = entries.map((entry) => JSON.parse(JSON.stringify(entry)) as JournalEntry);
    await expect(
      undoJournalSteps(checked, {
        proposal: fixtureDisableProposal(),
        snapshot: fixtureSnapshot(),
        deps: {
          workspaces: {} as never,
          skills: { toggle: async () => ({ results: [] }) } as never,
          creator: {} as never,
          store: {} as never,
          journalPath,
        },
        root: path.dirname(journalPath),
        mutations: [],
      }),
    ).rejects.toThrow(
      /never created|manifest|mutationCount|affected set|commit record|terminal commit/i,
    );
  });

  it("[4b] a manifest recording a backup the journal no longer references is rejected (bijection)", async () => {
    const root = tmp();
    const journalPath = path.join(root, "op.jsonl");
    // 先真实写一份备份 + manifest（Manager 事实落盘）……
    await writeBackupWithManifest({
      journalPath,
      ref: "2-aaaaaaaaaaaa.bin",
      seq: 2,
      from: "merge-right/shared/notes.md",
      bytes: Buffer.from("right-origin\n", "utf8"),
    });
    // ……再回放一条删除了该 resource 行、整体重编号的 journal：manifest 多出一条
    // 无主备份 → 双射拒绝（seq 连续性无法发现的篡改面）。
    const entries: JournalEntry[] = [
      { seq: 1, step: "precheck", detail: { kind: "precheck", targets: ["merged-skill"] } },
      {
        seq: 2,
        step: "commit",
        detail: {
          kind: "commit",
          proposalId: "spp_0123456789abcdef",
          status: "applied",
          mutationCount: 1,
        },
      },
    ];
    await expect(
      undoJournalSteps(entries, {
        proposal: fixtureDisableProposal(),
        snapshot: fixtureSnapshot(),
        deps: {
          workspaces: {} as never,
          skills: { toggle: async () => ({ results: [] }) } as never,
          creator: {} as never,
          store: {} as never,
          journalPath,
        },
        root: path.dirname(journalPath),
        mutations: [],
      }),
    ).rejects.toThrow(/manifest|move step|commit record|terminal commit/i);
  });

  it("[R9-1] a symlinked journal parent directory fails closed; no bytes reach outside", async () => {
    const root = tmp();
    const outside = path.join(root, "outside");
    fsSync.mkdirSync(outside, { recursive: true });
    const journalLink = path.join(root, "journal-link");
    fsSync.symlinkSync(outside, journalLink);
    const snapshot = fixtureSnapshot();
    const proposal = fixtureDisableProposal();
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: { resolveWritable: () => ({ directory: root }) } as never,
      skills: {
        info: async (_t: unknown, skillId: string) => ({
          skillId,
          revision: snapshot.skills.find((s) => s.skillId === skillId)!.revision,
          disabled: false,
        }),
        toggle: async () => ({ results: [] }),
        invalidateDiscovery: () => undefined,
      } as never,
      creator: {} as never,
      store: {} as never,
      journalPath: path.join(journalLink, "op.jsonl"),
    });
    expect(outcome.status).not.toBe("applied");
    expect(fsSync.readdirSync(outside).length).toBe(0);
  });

  it("[R9-2] a symlinked backup parent directory is rejected before creating any backup", async () => {
    const root = tmp();
    const outside = path.join(root, "outside");
    fsSync.mkdirSync(outside, { recursive: true });
    const journalLink = path.join(root, "journal-link");
    fsSync.symlinkSync(outside, journalLink);
    await expect(
      writeBackupWithManifest({
        journalPath: path.join(journalLink, "op.jsonl"),
        ref: "1-aaaaaaaaaaaa.bin",
        seq: 1,
        from: "source/notes.md",
        bytes: Buffer.from("manager-secret\n", "utf8"),
      }),
    ).rejects.toThrow();
    expect(fsSync.readdirSync(outside).length).toBe(0);
  });

  it("[R9-3] a hardlinked manifest leaf is refused; external inode receives no bytes", async () => {
    const root = tmp();
    const journalPath = path.join(root, "journal", "op.jsonl");
    fsSync.mkdirSync(path.dirname(journalPath), { recursive: true });
    const { prepareBackupRoot } = await import("../src/daemon/steward/fs-authority.js");
    const backupRoot = await prepareBackupRoot(journalPath);
    const outsideManifest = path.join(root, "outside-manifest.jsonl");
    fsSync.writeFileSync(outsideManifest, "EXTERNAL\n", "utf8");
    fsSync.linkSync(outsideManifest, path.join(backupRoot, "manifest.jsonl"));
    await expect(
      writeBackupWithManifest({
        journalPath,
        ref: "1-aaaaaaaaaaaa.bin",
        seq: 1,
        from: "source/notes.md",
        bytes: Buffer.from("manager-secret\n", "utf8"),
      }),
    ).rejects.toThrow(/hardlink/i);
    expect(fsSync.readFileSync(outsideManifest, "utf8")).toBe("EXTERNAL\n");
  });

  it("[R9-4] a symlinked journal leaf is rejected as a truth source on read", async () => {
    const root = tmp();
    const outside = path.join(root, "outside-journal.jsonl");
    fsSync.writeFileSync(
      outside,
      JSON.stringify({
        seq: 1,
        step: "commit",
        detail: {
          kind: "commit",
          proposalId: "spp_0123456789abcdef",
          status: "applied",
          mutationCount: 0,
        },
      }) + "\n",
      "utf8",
    );
    const journalPath = path.join(root, "op.jsonl");
    fsSync.symlinkSync(outside, journalPath);
    const { readJournal } = await import("../src/daemon/steward/journal-schema.js");
    // Windows 的 O_NOFOLLOW 语义是打开 reparse point 本身（不抛 ELOOP）——拒绝形态
    // 落在「读取侧身份漂移」typed 终态；不变量是「symlink leaf 不成为事实源」。
    await expect(readJournal(journalPath)).rejects.toThrow(
      /unreadable|ELOOP|regular file|identity drifted/i,
    );
  });

  it("[R9-5] a symlinked restore root is rejected before reading any existing leaf", async () => {
    const root = tmp();
    const outside = path.join(root, "outside");
    fsSync.mkdirSync(outside, { recursive: true });
    fsSync.writeFileSync(path.join(outside, "x.txt"), "same-bytes\n", "utf8");
    const rootLink = path.join(root, "provider");
    fsSync.symlinkSync(outside, rootLink);
    const { restoreResourceBytesStrict } = await import("../src/daemon/steward/fs-authority.js");
    await expect(
      restoreResourceBytesStrict(
        path.join(rootLink, "x.txt"),
        rootLink,
        Buffer.from("same-bytes\n", "utf8"),
        "restore-root-probe",
      ),
    ).rejects.toThrow(/not a real directory|not canonical/i);
  });

  it("[R9-6] directory identity drift (same lexical path, replacement dir) is detected", async () => {
    const root = tmp();
    const dirA = path.join(root, "managed");
    const dirB = path.join(root, "replacement");
    fsSync.mkdirSync(dirA, { recursive: true });
    fsSync.mkdirSync(dirB, { recursive: true });
    const { assertRealRoot, verifyDirIdentity } =
      await import("../src/daemon/steward/fs-authority.js");
    const identity = await assertRealRoot(dirA);
    // 同 lexical 路径换体：原目录移走、外部真实目录顶替。
    fsSync.renameSync(dirA, path.join(root, "moved-away"));
    fsSync.renameSync(dirB, dirA);
    await expect(verifyDirIdentity(dirA, identity)).rejects.toThrow(/identity drifted/i);
  });

  it("[R10-4] a symlinked journal parent is rejected as a truth source on read", async () => {
    const root = tmp();
    const outside = path.join(root, "outside");
    fsSync.mkdirSync(outside, { recursive: true });
    fsSync.writeFileSync(
      path.join(outside, "op.jsonl"),
      JSON.stringify({
        seq: 1,
        step: "commit",
        detail: {
          kind: "commit",
          proposalId: "spp_0123456789abcdef",
          status: "applied",
          mutationCount: 0,
        },
      }) + "\n",
      "utf8",
    );
    const journalLink = path.join(root, "journal-link");
    fsSync.symlinkSync(outside, journalLink);
    const { readJournal } = await import("../src/daemon/steward/journal-schema.js");
    await expect(readJournal(path.join(journalLink, "op.jsonl"))).rejects.toThrow(
      /not a real directory|not canonical/i,
    );
  });

  it("[R10-5] fs authority primitives refuse paths outside the root", async () => {
    const root = tmp();
    const outside = path.join(root, "outside");
    fsSync.mkdirSync(outside, { recursive: true });
    const leaf = path.join(outside, "x.bin");
    fsSync.writeFileSync(leaf, "payload\n", "utf8");
    const rootDir = path.join(root, "managed");
    fsSync.mkdirSync(rootDir, { recursive: true });
    const {
      writeFileExclusiveVerified,
      readResourceBytesStrict,
      restoreResourceBytesStrict,
      unlinkFileVerified,
    } = await import("../src/daemon/steward/fs-authority.js");
    const bytes = Buffer.from("payload\n", "utf8");
    await expect(writeFileExclusiveVerified(leaf, rootDir, bytes, "probe")).rejects.toThrow(
      /escapes its allowed root/i,
    );
    await expect(readResourceBytesStrict(leaf, rootDir, 8, "probe")).rejects.toThrow(
      /escapes its allowed root/i,
    );
    await expect(restoreResourceBytesStrict(leaf, rootDir, bytes, "probe")).rejects.toThrow(
      /escapes its allowed root/i,
    );
    await expect(
      unlinkFileVerified(leaf, rootDir, "probe", path.join(root, "journal", "op.jsonl")),
    ).rejects.toThrow(/escapes its allowed root/i);
    expect(fsSync.readFileSync(leaf, "utf8")).toBe("payload\n");
  });

  it("[2.3e] a backup root replaced between calls is rejected by the process-lifetime anchor", async () => {
    const root = tmp();
    const journalPath = path.join(root, "journal", "op.jsonl");
    const bytes = Buffer.from("manager-secret\n", "utf8");
    // 首次调用：首见锚定 journal 目录与 backup root，正常成功。
    await writeBackupWithManifest({
      journalPath,
      ref: "1-aaaaaaaaaaaa.bin",
      seq: 1,
      from: "source/notes.md",
      bytes,
    });
    // 跨调用换体：backup root 整目录被移走、外部真实目录顶替。
    const backupRoot = `${journalPath}.backups`;
    const replacement = path.join(root, "replacement");
    fsSync.mkdirSync(replacement, { recursive: true });
    fsSync.renameSync(backupRoot, path.join(root, "original-backups"));
    fsSync.renameSync(replacement, backupRoot);
    const { readBackupManifest } = await import("../src/daemon/steward/fs-authority.js");
    await expect(readBackupManifest(journalPath)).rejects.toThrow(
      /replaced during this daemon lifetime|not a canonical/i,
    );
    await expect(
      writeBackupWithManifest({
        journalPath,
        ref: "2-bbbbbbbbbbbb.bin",
        seq: 2,
        from: "source/more.md",
        bytes,
      }),
    ).rejects.toThrow(/replaced during this daemon lifetime|not a canonical/i);
    // 替换目录未收到任何 manager 字节。
    expect(fsSync.readdirSync(backupRoot).length).toBe(0);
  });

  it("[2.3e] a replaced journal directory is rejected as a truth source (anchor drift)", async () => {
    const root = tmp();
    const journalDir = path.join(root, "journal");
    fsSync.mkdirSync(journalDir, { recursive: true });
    const journalPath = path.join(journalDir, "op.jsonl");
    fsSync.writeFileSync(
      journalPath,
      JSON.stringify({
        seq: 1,
        step: "commit",
        detail: {
          kind: "commit",
          proposalId: "spp_0123456789abcdef",
          status: "applied",
          mutationCount: 0,
        },
      }) + "\n",
      "utf8",
    );
    const { readJournal } = await import("../src/daemon/steward/journal-schema.js");
    await expect(readJournal(journalPath)).resolves.toHaveLength(1);
    // 换体后：进程内锚失配 → 拒绝（替换目录不能成为事实源）。
    // Windows：向刚被 rename 顶替的目录内 copyfile 会被 AV/索引器短暂拒绝
    // （EPERM）——先在原位组装替换目录再整目录换体，两平台同序。
    const replacement = path.join(root, "replacement");
    fsSync.mkdirSync(replacement, { recursive: true });
    fsSync.copyFileSync(journalPath, path.join(replacement, "op.jsonl"));
    fsSync.renameSync(journalDir, path.join(root, "original-journal"));
    fsSync.renameSync(replacement, journalDir);
    await expect(readJournal(journalPath)).rejects.toThrow(
      /replaced during this daemon lifetime|not a real directory|not canonical/i,
    );
  });

  it("[2.3e] resetting anchors models a daemon restart (first-seen re-anchors)", async () => {
    const root = tmp();
    const journalPath = path.join(root, "journal", "op.jsonl");
    await writeBackupWithManifest({
      journalPath,
      ref: "1-aaaaaaaaaaaa.bin",
      seq: 1,
      from: "source/notes.md",
      bytes: Buffer.from("manager-secret\n", "utf8"),
    });
    const backupRoot = `${journalPath}.backups`;
    const replacement = path.join(root, "replacement");
    fsSync.mkdirSync(replacement, { recursive: true });
    fsSync.renameSync(backupRoot, path.join(root, "original-backups"));
    fsSync.renameSync(replacement, backupRoot);
    const { resetStoreAnchors, anchorManagerDirectory } =
      await import("../src/daemon/steward/store-anchor.js");
    // 重启等价：清空锚表后重新首见锚定（换体成为新真相——人工恢复决策面）。
    resetStoreAnchors();
    await expect(anchorManagerDirectory(backupRoot)).resolves.toBeTruthy();
  });

  it("[2.3e] manifest lines with unknown fields, traversal paths, or bad hashes are rejected", async () => {
    const root = tmp();
    const journalPath = path.join(root, "journal", "op.jsonl");
    await writeBackupWithManifest({
      journalPath,
      ref: "1-aaaaaaaaaaaa.bin",
      seq: 1,
      from: "source/notes.md",
      bytes: Buffer.from("manager-secret\n", "utf8"),
    });
    const manifestPath = path.join(`${journalPath}.backups`, "manifest.jsonl");
    const good = fsSync.readFileSync(manifestPath, "utf8");
    const { readBackupManifest } = await import("../src/daemon/steward/fs-authority.js");
    const { resetStoreAnchors } = await import("../src/daemon/steward/store-anchor.js");

    const cases: Array<[string, string]> = [
      ["unknown-field", `${good.trimEnd().slice(0, -1)}, "evil": true}\n`],
      [
        "traversal-from",
        `${JSON.stringify({
          ref: "2-bbbbbbbbbbbb.bin",
          seq: 2,
          from: "../../outside/notes.md",
          sha256: "a".repeat(64),
          byteSize: 8,
        })}\n`,
      ],
      [
        "bad-sha",
        `${JSON.stringify({
          ref: "3-cccccccccccc.bin",
          seq: 3,
          from: "source/x.md",
          sha256: "NOT-A-HASH",
          byteSize: 8,
        })}\n`,
      ],
      [
        "bad-byteSize",
        `${JSON.stringify({
          ref: "4-dddddddddddd.bin",
          seq: 4,
          from: "source/y.md",
          sha256: "b".repeat(64),
          byteSize: -1,
        })}\n`,
      ],
    ];
    for (const [name, content] of cases) {
      fsSync.writeFileSync(manifestPath, content, "utf8");
      // 每例独立：换体会被锚拒绝，这里保持同一目录，仅内容不同。
      resetStoreAnchors();
      await expect(readBackupManifest(journalPath)).rejects.toThrow(
        /failed validation|recovery required/i,
      );
      void name;
    }
  });

  it("[5] duplicate commit records are rejected by the replay gate", () => {
    const commit = {
      kind: "commit" as const,
      proposalId: "spp_0123456789abcdef" as const,
      status: "applied" as const,
      mutationCount: 0,
    };
    const entries: JournalEntry[] = [
      { seq: 1, step: "commit", detail: commit },
      { seq: 2, step: "commit", detail: commit },
    ];
    expect(() => assertCommittedJournal(entries, { proposalId: commit.proposalId })).toThrow(
      /exactly one terminal commit/i,
    );
  });
});

describe("darwin system symlink roots (4.2 /tmp sandbox finding)", () => {
  // `/tmp` → `/private/tmp` 归一是 darwin 系统事实；Windows 上 `\tmp` 无该语义
  // （realpath 带 卷号 前缀，天然不等），本例只在 darwin 上有意义。
  it.runIf(process.platform === "darwin")(
    "accepts /tmp-based roots whose realpath is /private/tmp (IPC-short-path sandboxes)",
    async () => {
      const { assertCanonicalDirectory } = await import("../src/daemon/steward/dir-identity.js");
      const dir = fsSync.mkdtempSync("/tmp/steward-canonical-");
      try {
        const identity = await assertCanonicalDirectory(dir);
        expect(identity.ino).toBeGreaterThan(0);
        // 归一事实源仍是 realpath 的 inode：/private/tmp 视角读取同一身份。
        const viaPrivate = await assertCanonicalDirectory(
          fsSync.realpathSync(dir).replace(/^\/private/, ""),
        );
        expect(viaPrivate.ino).toBe(identity.ino);
      } finally {
        fsSync.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("still rejects a root whose realpath is an unrelated location", async () => {
    const { assertCanonicalDirectory } = await import("../src/daemon/steward/dir-identity.js");
    const real = fsSync.mkdtempSync(path.join(os.tmpdir(), "steward-canonical-real-"));
    const aliased = fsSync.mkdtempSync(path.join(os.tmpdir(), "steward-canonical-alias-"));
    const link = path.join(aliased, "linked");
    fsSync.symlinkSync(real, link, "dir");
    try {
      await expect(assertCanonicalDirectory(link)).rejects.toThrow(
        /not a real directory|not canonical/i,
      );
    } finally {
      fsSync.rmSync(aliased, { recursive: true, force: true });
      fsSync.rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("windows directory-fsync platform ceiling (syncDir root cause, 2026-09-25)", () => {
  // Windows 测试债主根因回归钉：libuv 的 O_DIRECTORY 句柄只读，FlushFileBuffers
  // 要求写句柄 → win32 目录 fsync 恒 EPERM。该错误必须归一化为平台上限吸收
  // （否则 move 备份/隔离的 durability barrier 在 Windows 全线击穿，事务集体
  // 落 recovery-required）；任何其它平台/错误码保持 fail-closed。
  it("absorbs EPERM fsync on win32 only; every other platform/error stays fail-closed", async () => {
    const { isDirSyncPlatformCeiling, syncDir } =
      await import("../src/daemon/steward/fs-authority.js");
    const errnoError = (code: string, message: string) =>
      Object.assign(new Error(message), { code });
    const eperm = errnoError("EPERM", "EPERM: operation not permitted, fsync");
    const eio = errnoError("EIO", "EIO: i/o error, fsync");
    const originalPlatform = process.platform;
    const setPlatform = (value: string) => {
      Object.defineProperty(process, "platform", { value, configurable: true });
    };
    try {
      setPlatform("win32");
      expect(isDirSyncPlatformCeiling(eperm)).toBe(true);
      expect(isDirSyncPlatformCeiling(eio)).toBe(false);
      expect(isDirSyncPlatformCeiling(new Error("no errno"))).toBe(false);
      setPlatform("darwin");
      expect(isDirSyncPlatformCeiling(eperm)).toBe(false);
      setPlatform("linux");
      expect(isDirSyncPlatformCeiling(eperm)).toBe(false);
    } finally {
      setPlatform(originalPlatform);
    }
    // 本平台真实目录上 syncDir 必须仍然成功（非平台上限路径不吞错误）。
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "steward-syncdir-ceiling-"));
    try {
      await expect(syncDir(dir)).resolves.toBeUndefined();
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });
});
