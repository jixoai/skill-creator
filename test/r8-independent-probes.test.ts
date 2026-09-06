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
        detail: { kind: "content", directoryName: "merged-skill" },
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
    ).rejects.toThrow(/never created|manifest|mutationCount|affected set/i);
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
    ).rejects.toThrow(/manifest|move step/i);
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
