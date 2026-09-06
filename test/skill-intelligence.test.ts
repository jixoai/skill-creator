/**
 * Skill intelligence service + analyzer contract tests.
 *
 * User input [2026-09-06] (openspec skill-intelligence): "分析只读，不写 registry、
 * skill 文件或 enabled 状态。" "proposal 锁定分析时的 revision；任何 revision 变化
 * 都使 proposal stale，不能 apply。" "disable 是普通 Manager mutation，但 Agent
 * 只能提出建议；用户确认后才调用现有 toggle RPC。"
 *
 * Orthogonal intents:
 *   [1] Analyze is read-only and every finding carries evidence + observed revisions.
 *   [2] Proposals are drafts: no Provider mutation until explicit approve.
 *   [3] Approve re-checks revisions and routes through existing safe mutations.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { analyzeDocuments } from "../src/daemon/skill-intelligence/analyzer.js";
import { SkillIdSchema } from "../src/shared/contracts/skills.js";
import {
  ProposeInputSchema,
  type SkillSelection,
} from "../src/shared/contracts/skill-intelligence.js";
import {
  ProviderIdSchema,
  type ImportedWorkspace,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let domain: DaemonDomain;
const providerId = ProviderIdSchema.parse("openclaw");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-intel-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
});

afterEach(async () => {
  await domain.repository.dispose();
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function importWorkspace(name: string): ImportedWorkspace {
  const directory = path.join(sandbox, name);
  fs.mkdirSync(directory, { recursive: true });
  return domain.workspaces.import(directory, name);
}

function target(workspace: ImportedWorkspace): WorkspaceProviderTarget {
  return { workspaceId: workspace.id, providerId };
}

async function createSkill(
  workspace: ImportedWorkspace,
  directoryName: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<SkillSelection> {
  const saved = await domain.creator.save({
    mode: "create",
    workspaceId: workspace.id,
    providerId,
    directoryName,
    frontmatter: frontmatter as { name: string; description: string },
    body,
  });
  return {
    workspaceId: workspace.id,
    providerId,
    skillId: saved.document.skillId,
  };
}

const activeFile = (workspace: ImportedWorkspace, directoryName: string): string =>
  path.join(workspace.path, "skills", directoryName, "SKILL.md");

describe("skill intelligence analyze", () => {
  it("reports duplicate names and triggers with evidence without mutating files", async () => {
    const workspace = importWorkspace("report-root");
    const first = await createSkill(
      workspace,
      "deploy-a",
      {
        name: "deploy",
        description: "Deploy services to production.",
        "allowed-tools": "Bash, Read",
      },
      "# Deploy\n\nAlways use Bash to deploy.\nSee scripts/deploy.sh for details.\n",
    );
    const second = await createSkill(
      workspace,
      "deploy-b",
      { name: "deploy", description: "Deploy services to staging.", "allowed-tools": "Bash" },
      "# Deploy\n\nNever use Bash to deploy directly.\nSee scripts/deploy.sh for details.\n",
    );

    const before = [
      fs.readFileSync(activeFile(workspace, "deploy-a"), "utf8"),
      fs.readFileSync(activeFile(workspace, "deploy-b"), "utf8"),
    ];

    const { report, failures } = await domain.skillIntelligence.analyze({
      selections: [first, second],
    });

    expect(failures).toEqual([]);
    expect(report.snapshots).toHaveLength(2);
    const byKind = new Map(report.findings.map((finding) => [finding.kind, finding]));
    const duplicateName = byKind.get("duplicate-name");
    expect(duplicateName?.severity).toBe("error");
    expect(duplicateName?.skillIds).toHaveLength(2);
    expect(duplicateName?.evidence.length).toBeGreaterThanOrEqual(2);
    const duplicateTrigger = byKind.get("duplicate-trigger");
    expect(duplicateTrigger?.message).toContain("Bash");
    expect(duplicateTrigger?.observedRevisions[first.skillId]).toMatch(/^sha256:[a-f0-9]{64}$/);
    const mutex = byKind.get("mutually-exclusive-rules");
    expect(mutex?.severity).toBe("error");
    expect(mutex?.evidence.some((item) => /always/i.test(item.snippet))).toBe(true);
    expect(mutex?.evidence.some((item) => /never/i.test(item.snippet))).toBe(true);
    const shared = byKind.get("shared-resource-path");
    expect(shared?.message).toContain("scripts/deploy.sh");
    // 关系边从 findings 推导。
    expect(report.edges.some((edge) => edge.kind === "conflict")).toBe(true);
    expect(report.edges.some((edge) => edge.kind === "overlap")).toBe(true);

    // 只读保证：文件内容与启停状态都不变。
    expect(fs.readFileSync(activeFile(workspace, "deploy-a"), "utf8")).toBe(before[0]);
    expect(fs.readFileSync(activeFile(workspace, "deploy-b"), "utf8")).toBe(before[1]);
    expect(fs.existsSync(path.join(workspace.path, "skills", "deploy-a", ".SKILL.md"))).toBe(false);
  });

  it("returns per-skill typed failures and excludes them from the report", async () => {
    const workspace = importWorkspace("failure-root");
    const existing = await createSkill(
      workspace,
      "solo",
      { name: "solo", description: "A single skill." },
      "# Solo\n",
    );
    const missing: SkillSelection = {
      workspaceId: workspace.id,
      providerId,
      skillId: SkillIdSchema.parse("sk_ffffffffffffffffffffffff"),
    };
    const { report, failures } = await domain.skillIntelligence.analyze({
      selections: [existing, missing],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.code).toBe("NOT_FOUND");
    expect(report.snapshots.map((snapshot) => snapshot.skillId)).toEqual([existing.skillId]);
  });

  it("keeps overlapping descriptions as informational, never conflicts", () => {
    const result = analyzeDocuments([
      {
        workspaceId: "~",
        providerId: "claude-code",
        skillId: "sk_111111111111111111111111",
        name: "review",
        directoryName: "review",
        disabled: false,
        revision: `sha256:${"1".repeat(64)}`,
        content:
          "---\nname: review\ndescription: Review python code changes with careful static analysis\n---\n# Review\n",
      },
      {
        workspaceId: "~",
        providerId: "claude-code",
        skillId: "sk_222222222222222222222222",
        name: "audit",
        directoryName: "audit",
        disabled: false,
        revision: `sha256:${"2".repeat(64)}`,
        content:
          "---\nname: audit\ndescription: Review python code changes with careful static auditing\n---\n# Audit\n",
      },
    ]);
    const overlap = result.findings.find(
      (finding) => finding.kind === "overlapping-responsibility",
    );
    expect(overlap?.severity).toBe("info");
    expect(result.findings.some((finding) => finding.kind === "mutually-exclusive-rules")).toBe(
      false,
    );
  });
});

describe("skill intelligence proposals", () => {
  it("stores an edit draft without touching the skill and rejects stale approvals", async () => {
    const workspace = importWorkspace("stale-root");
    const selection = await createSkill(
      workspace,
      "editable",
      { name: "editable", description: "Original description." },
      "# Editable\n\nOriginal body.\n",
    );

    const { proposal } = await domain.skillIntelligence.propose({
      payload: {
        kind: "edit",
        edits: [
          {
            selection,
            frontmatter: { name: "editable", description: "Proposed description." },
            body: "# Editable\n\nProposed body.\n",
          },
        ],
      },
      findingIds: [],
      rationale: "Sharpen the description.",
    });

    // 草稿阶段文件不变。
    expect(fs.readFileSync(activeFile(workspace, "editable"), "utf8")).toContain("Original body.");

    // 外部修改使 revision 过期。
    fs.writeFileSync(
      activeFile(workspace, "editable"),
      "---\nname: editable\ndescription: Changed elsewhere.\n---\n# Editable\n\nChanged.\n",
      "utf8",
    );

    const approved = await domain.skillIntelligence.approve({ proposalId: proposal.id });
    expect(approved.applied).toBe(0);
    expect(approved.conflicts).toBe(1);
    expect(approved.results[0]!.error).toContain("re-analyze");
    // stale 审批不覆盖外部修改。
    expect(fs.readFileSync(activeFile(workspace, "editable"), "utf8")).toContain(
      "Changed elsewhere.",
    );
  });

  it("applies an edit proposal after revision re-check and consumes the draft", async () => {
    const workspace = importWorkspace("edit-root");
    const selection = await createSkill(
      workspace,
      "apply-edit",
      { name: "apply-edit", description: "Original." },
      "# Apply\n",
    );
    const { proposal } = await domain.skillIntelligence.propose({
      payload: {
        kind: "edit",
        edits: [
          {
            selection,
            frontmatter: { name: "apply-edit", description: "Improved." },
            body: "# Apply\n\nImproved.\n",
          },
        ],
      },
      findingIds: [],
      rationale: "Apply the reviewed edit.",
    });
    const approved = await domain.skillIntelligence.approve({ proposalId: proposal.id });
    expect(approved.applied).toBe(1);
    expect(fs.readFileSync(activeFile(workspace, "apply-edit"), "utf8")).toContain("Improved.");
    // 审批后草稿被消费。
    const remaining = domain.skillIntelligence.list();
    expect(remaining.proposals.find((draft) => draft.id === proposal.id)).toBeUndefined();
  });

  it("disable proposals never toggle before approve and apply through toggle after", async () => {
    const workspace = importWorkspace("disable-root");
    const selection = await createSkill(
      workspace,
      "noisy",
      { name: "noisy", description: "A noisy skill.", "allowed-tools": "*" },
      "# Noisy\n",
    );
    const { proposal } = await domain.skillIntelligence.propose({
      payload: {
        kind: "disable",
        selections: [selection],
        reason: "Wildcard trigger competes with every prompt.",
      },
      findingIds: [],
      rationale: "Disable after review.",
    });

    // 建议不等于执行：SKILL.md 仍处于激活命名。
    expect(fs.existsSync(activeFile(workspace, "noisy"))).toBe(true);
    expect(fs.existsSync(path.join(workspace.path, "skills", "noisy", ".SKILL.md"))).toBe(false);

    const approved = await domain.skillIntelligence.approve({ proposalId: proposal.id });
    expect(approved.applied).toBe(1);
    expect(fs.existsSync(path.join(workspace.path, "skills", "noisy", ".SKILL.md"))).toBe(true);
    expect(fs.existsSync(activeFile(workspace, "noisy"))).toBe(false);

    // 拒绝路径：新草稿直接删除，不产生任何文件变化。
    const second = await domain.skillIntelligence.propose({
      payload: { kind: "disable", selections: [selection], reason: "Again." },
      findingIds: [],
      rationale: "Reject me.",
    });
    domain.skillIntelligence.reject(second.proposal.id);
    expect(
      domain.skillIntelligence.list().proposals.find((draft) => draft.id === second.proposal.id),
    ).toBeUndefined();
  });

  it("rejects split and merge targets that escape the provider root at the schema boundary", () => {
    const traversal = ProposeInputSchema.safeParse({
      payload: {
        kind: "split",
        source: {
          workspaceId: "ws_abcdef0123456789abcdef01",
          providerId: "openclaw",
          skillId: "sk_111111111111111111111111",
        },
        targets: [
          { directoryName: "../escaped", frontmatter: { name: "x", description: "x" }, body: "x" },
          { directoryName: "safe-b", frontmatter: { name: "y", description: "y" }, body: "y" },
        ],
      },
      findingIds: [],
      rationale: "Unsafe split.",
    });
    expect(traversal.success).toBe(false);
    const merge = ProposeInputSchema.safeParse({
      payload: {
        kind: "merge",
        sources: [
          {
            workspaceId: "ws_abcdef0123456789abcdef01",
            providerId: "openclaw",
            skillId: "sk_111111111111111111111111",
          },
          {
            workspaceId: "ws_abcdef0123456789abcdef01",
            providerId: "openclaw",
            skillId: "sk_222222222222222222222222",
          },
        ],
        target: {
          directoryName: "../../merged",
          frontmatter: { name: "m", description: "m" },
          body: "m",
        },
      },
      findingIds: [],
      rationale: "Unsafe merge.",
    });
    expect(merge.success).toBe(false);
  });

  it("applies split through direct-child creation only", async () => {
    const workspace = importWorkspace("split-root");
    const source = await createSkill(
      workspace,
      "combined",
      { name: "combined", description: "Two duties in one skill." },
      "# Combined\n",
    );
    const { proposal } = await domain.skillIntelligence.propose({
      payload: {
        kind: "split",
        source,
        targets: [
          {
            directoryName: "combined-alpha",
            frontmatter: { name: "alpha", description: "First duty." },
            body: "# Alpha\n",
          },
          {
            directoryName: "combined-beta",
            frontmatter: { name: "beta", description: "Second duty." },
            body: "# Beta\n",
          },
        ],
      },
      findingIds: [],
      rationale: "Split the two duties.",
    });
    const approved = await domain.skillIntelligence.approve({ proposalId: proposal.id });
    expect(approved.applied).toBe(1);
    expect(fs.existsSync(activeFile(workspace, "combined-alpha"))).toBe(true);
    expect(fs.existsSync(activeFile(workspace, "combined-beta"))).toBe(true);
    // split 不删除源技能（拆分由用户确认后手动处理源）。
    expect(fs.existsSync(activeFile(workspace, "combined"))).toBe(true);
  });

  it("applies merge by creating the target and removing sources revision-safely", async () => {
    const workspace = importWorkspace("merge-root");
    const first = await createSkill(
      workspace,
      "merge-one",
      { name: "merge-one", description: "First half." },
      "# One\n",
    );
    const second = await createSkill(
      workspace,
      "merge-two",
      { name: "merge-two", description: "Second half." },
      "# Two\n",
    );
    const { proposal } = await domain.skillIntelligence.propose({
      payload: {
        kind: "merge",
        sources: [first, second],
        target: {
          directoryName: "merged",
          frontmatter: { name: "merged", description: "Both halves." },
          body: "# Merged\n\nOne and two.\n",
        },
      },
      findingIds: [],
      rationale: "Merge the halves.",
    });
    const approved = await domain.skillIntelligence.approve({ proposalId: proposal.id });
    expect(approved.applied).toBe(2);
    expect(fs.existsSync(activeFile(workspace, "merged"))).toBe(true);
    expect(fs.existsSync(activeFile(workspace, "merge-one"))).toBe(false);
    expect(fs.existsSync(activeFile(workspace, "merge-two"))).toBe(false);
  });
});
