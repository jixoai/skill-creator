/**
 * Skill Steward 三任务四 action 端到端验收（openspec steward-product-workflow 4.6）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.6）：「check 单 skill；check 多 skill 关系；
 * optimize edit；organize disable/split/merge；分别记录 DSH session/tool-call id、
 * Manager run/snapshot/proposal/audit id 和 Provider 内容/启停/资源树。fixture 覆盖
 * 全部 action 和故障；真实锁定 DSH packages + 真实模型至少完成一次分析到方案、
 * 批准、apply、rollback。凭证缺失只记录 blocker。」
 *
 * 正交意图：
 *   [1] 任务矩阵：check（单/多 skill，含 relations 工具证据）→ optimize（edit 全链
 *       含 rollback）→ organize 三形态（disable/split/merge；后两者覆盖 grant-replay
 *       回滚，disable 覆盖 reverse-proposal 回滚），全部记录 id 链与 Provider 树。
 *   [2] 故障矩阵：malformed（零提案终态）、approval-replay（grant 一次性）、
 *       stale（4.4 smoke 已有，此处引用）；live 模型 blocker 类型化记录。
 *   [3] 证据：artifacts/steward-acceptance.json（每 case 的 run/snapshot/session/
 *       tool-call/audit id 与前后文件树）。
 * 妥协声明：真实模型链路需 provider 凭据——本机无凭据，按验收条款记录类型化
 *   blocker（PRESET_REQUIRES_CREDENTIAL），不以 unavailable 冒充通过。
 *
 * 执行：`pnpm exec tsx scripts/steward-acceptance.sh.ts`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const artifactsDir = path.join(
  root,
  "openspec",
  "changes",
  "steward-product-workflow",
  "artifacts",
);

const evidence: Record<string, unknown> = {
  script: "scripts/steward-acceptance.sh.ts",
  generatedAt: new Date().toISOString(),
  node: process.version,
  cases: {},
};

function fail(message: string): never {
  evidence.failure = message;
  flush();
  console.error(`steward-acceptance: FAIL: ${message}`);
  process.exit(1);
}

function flush(): void {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "steward-acceptance.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

/** Provider 内容/启停/资源树快照（相对路径 + 文件/禁用标记）。 */
function providerTree(workspaceDir: string): Record<string, string> {
  const providerRoot = path.join(workspaceDir, "skills");
  const tree: Record<string, string> = {};
  if (!fs.existsSync(providerRoot)) return tree;
  const walk = (dir: string): void => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        tree[path.relative(providerRoot, full)] =
          entry.name === ".SKILL.md" ? "disabled-doc" : "file";
    }
  };
  walk(providerRoot);
  return tree;
}

// —— 隔离环境（/tmp 短前缀 + headless tray；DSH host 真实挂载提供 session 绑定）——
const sandbox = fs.mkdtempSync("/tmp/steward-acceptance-");
process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
process.env.DSH_HOME = path.join(sandbox, "dsh-home");
process.env.OPENTRAY_HOME = path.join(sandbox, "opentray");
process.env.SKILL_CREATOR_DISABLE_TRAY = "1";

const { setHomeOverride } = await import("../src/shared/paths.ts");
setHomeOverride(process.env.SKILL_CREATOR_HOME!);

const webuiDir = path.join(root, "webui", "build");
if (!fs.existsSync(path.join(webuiDir, "index.html"))) {
  fail(`SPA build missing at ${webuiDir}; run: pnpm --dir webui build`);
}
const { bootDaemon } = await import("../src/daemon/index.js");
const { ProviderIdSchema } = await import("../src/shared/contracts/workspaces.ts");
const pkgVersion = (
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }
).version;
const providerId = ProviderIdSchema.parse("openclaw");

try {
  const daemon = await bootDaemon({
    cliVersion: pkgVersion,
    webuiDir,
    withTray: false,
    withDshHost: true,
    webToken: "steward-acceptance",
  });
  if (!daemon) fail("bootDaemon returned null");
  if (daemon.status.dsh?.mounted !== true) {
    fail(`DSH host not mounted: ${daemon.status.dsh?.reason}`);
  }
  const skillSteward = daemon.domain.skillSteward;
  const cases = evidence.cases as Record<string, unknown>;

  // —— 种子：三个技能（含资源文件，供 merge 复制）——
  const workspaceDir = path.join(sandbox, "ws");
  const skillsRoot = path.join(workspaceDir, "skills");
  fs.mkdirSync(skillsRoot, { recursive: true });
  const workspace = daemon.domain.workspaces.import(workspaceDir, "acceptance-ws");
  const seed: Array<[string, string]> = [
    ["deploy-web", "Deploy the web app."],
    ["deploy-api", "Deploy the api app."],
    ["audit-logs", "Audit log exports."],
  ];
  for (const [name, description] of seed) {
    await daemon.domain.creator.save({
      mode: "create",
      workspaceId: workspace.id,
      providerId,
      directoryName: name,
      frontmatter: { name, description },
      body: `# ${name}\n\n${description}\n`,
    });
    fs.mkdirSync(path.join(skillsRoot, name, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(skillsRoot, name, "scripts", `${name}.sh`),
      `#!/bin/sh\necho ${name}\n`,
      "utf8",
    );
  }
  const target = { workspaceId: workspace.id, providerId };
  const listed = await daemon.domain.skills.list(target);
  const skillIds = seed.map(([name]) => listed.find((skill) => skill.name === name)!.id);

  /** run + 提案链 + 记录；返回本次 run 的记录对象。 */
  async function recordRun(caseName: string, input: Parameters<typeof skillSteward.startRun>[0]) {
    const run = await skillSteward.startRun(input);
    const record = {
      snapshotId: run.snapshotId,
      dshSessionId: run.dshSessionId ?? null,
      toolCalls: run.toolCalls,
      terminal: run.terminal,
      proposals: run.proposals,
    };
    cases[caseName] = { run: record };
    return { run, record };
  }

  // —— case 1：check 单 skill ——
  {
    const { record } = await recordRun("check-single", {
      target,
      skillIds: [skillIds[0]!],
      taskKind: "check",
    });
    if (record.proposals.length !== 0)
      fail("check-single: unexpected proposals from a read-only check");
    if (!record.dshSessionId) fail("check-single: run not bound to a DSH session");
    console.log(
      `check-single: session=${record.dshSessionId} toolCalls=${record.toolCalls} proposals=0`,
    );
  }

  // —— case 2：check 多 skill 关系（skills.relations 工具面）——
  {
    const { record } = await recordRun("check-multi", {
      target,
      skillIds: [...skillIds],
      taskKind: "check",
    });
    const frames = await daemon.domain.dshSettings.listStreamFrames({ limit: 200 });
    const sessionFrames = frames.filter((frame) => frame.sessionId === record.dshSessionId);
    const toolNames = [...new Set(sessionFrames.map((frame) => frame.toolName).filter(Boolean))];
    (cases["check-multi"] as Record<string, unknown>).toolNames = toolNames;
    if (!toolNames.includes("skills.relations")) {
      fail(`check-multi: skills.relations not exercised (tools: ${toolNames.join(",")})`);
    }
    console.log(`check-multi: session=${record.dshSessionId} tools=[${toolNames.join(", ")}]`);
  }

  /** optimize/organize 全链：validate → approve → apply →（记录）→ rollback → 断言恢复。 */
  async function fullChain(
    caseName: string,
    input: Parameters<typeof skillSteward.startRun>[0],
    expectations: {
      action: string;
      rollbackForm: "reverse-proposal" | "grant-replay";
      treeAfter: (tree: Record<string, string>) => boolean;
      treeRestored: (before: Record<string, string>, after: Record<string, string>) => boolean;
    },
  ): Promise<void> {
    const treeBefore = providerTree(workspaceDir);
    const { run } = await recordRun(caseName, input);
    if (run.proposals.length !== 1)
      fail(`${caseName}: expected 1 proposal, got ${run.proposals.length}`);
    const proposal = run.proposals[0]!;
    if (proposal.action !== expectations.action) {
      fail(`${caseName}: expected ${expectations.action} proposal, got ${proposal.action}`);
    }
    const validation = await skillSteward.validate(proposal.proposalId);
    if (validation.overall !== "valid") fail(`${caseName}: validation ${validation.overall}`);
    const grant = await skillSteward.approve(proposal.proposalId);
    const applied = await skillSteward.apply(proposal.proposalId);
    if (applied.outcomeStatus !== "applied") {
      fail(
        `${caseName}: apply ${applied.outcomeStatus}${applied.failure ? ` — ${applied.failure}` : ""}`,
      );
    }
    const treeApplied = providerTree(workspaceDir);
    if (!expectations.treeAfter(treeApplied)) {
      fail(`${caseName}: provider tree after apply unexpected: ${JSON.stringify(treeApplied)}`);
    }
    const prep = await skillSteward.prepareRollback(applied.auditId);
    let rollbackOutcome: string;
    if (expectations.rollbackForm === "reverse-proposal") {
      if (!prep.reverseProposalId) fail(`${caseName}: no reverse proposal prepared`);
      const reverseValidation = await skillSteward.validate(prep.reverseProposalId);
      if (reverseValidation.overall !== "valid") {
        fail(`${caseName}: reverse validation ${reverseValidation.overall}`);
      }
      await skillSteward.approve(prep.reverseProposalId);
      const reverseApply = await skillSteward.apply(prep.reverseProposalId);
      rollbackOutcome = reverseApply.outcomeStatus;
    } else {
      const replay = await skillSteward.applyRollback(applied.auditId);
      rollbackOutcome = replay.outcomeStatus;
    }
    if (rollbackOutcome !== "applied") fail(`${caseName}: rollback ${rollbackOutcome}`);
    const treeRestored = providerTree(workspaceDir);
    if (!expectations.treeRestored(treeBefore, treeRestored)) {
      fail(`${caseName}: provider tree not restored: ${JSON.stringify(treeRestored)}`);
    }
    cases[caseName] = {
      ...(cases[caseName] as object),
      proposalId: proposal.proposalId,
      validation: `${validation.overall} (${validation.checks.filter((c) => c.status === "passed").length}/${validation.checks.length})`,
      grantId: grant.grantId,
      auditId: applied.auditId,
      outcome: applied.outcomeStatus,
      rollbackForm: expectations.rollbackForm,
      rollbackOutcome,
      treeApplied,
      treeRestored,
    };
    console.log(
      `${caseName}: proposal=${proposal.proposalId} audit=${applied.auditId} rollback=${expectations.rollbackForm} → tree restored`,
    );
  }

  // —— case 3：optimize edit（全链 + reverse-proposal 回滚）——
  await fullChain(
    "optimize-edit",
    { target, skillIds: [skillIds[0]!], taskKind: "optimize" },
    {
      action: "edit",
      rollbackForm: "reverse-proposal",
      treeAfter: (tree) => Object.keys(tree).includes("deploy-web/SKILL.md"),
      treeRestored: (before, after) => JSON.stringify(before) === JSON.stringify(after),
    },
  );

  // —— case 4：organize disable（全链 + reverse enable 回滚）——
  await fullChain(
    "organize-disable",
    { target, skillIds: [skillIds[2]!], taskKind: "organize", scenario: "organize-disable" },
    {
      action: "disable",
      rollbackForm: "reverse-proposal",
      treeAfter: (tree) => Object.keys(tree).includes("audit-logs/.SKILL.md"),
      treeRestored: (before, after) => JSON.stringify(before) === JSON.stringify(after),
    },
  );

  // —— case 5：organize split（全链 + grant replay 回滚）——
  await fullChain(
    "organize-split",
    { target, skillIds: [skillIds[0]!], taskKind: "organize" },
    {
      action: "split",
      rollbackForm: "grant-replay",
      treeAfter: (tree) =>
        Object.keys(tree).some((rel) => rel.startsWith("deploy-web-plan/")) &&
        Object.keys(tree).includes("deploy-web/.SKILL.md"),
      treeRestored: (before, after) => JSON.stringify(before) === JSON.stringify(after),
    },
  );

  // —— case 6：organize merge（资源复制 + 双源禁用 + grant replay 回滚）——
  await fullChain(
    "organize-merge",
    {
      target,
      skillIds: [skillIds[0]!, skillIds[1]!],
      taskKind: "organize",
      scenario: "organize-merge",
    },
    {
      action: "merge",
      rollbackForm: "grant-replay",
      treeAfter: (tree) => {
        const keys = Object.keys(tree);
        const merged = keys.find((rel) => rel.includes("-and-") && rel.endsWith("/SKILL.md"));
        return (
          merged !== undefined &&
          keys.some((rel) => rel.includes("-and-") && !rel.endsWith("/SKILL.md")) &&
          keys.includes("deploy-web/.SKILL.md") &&
          keys.includes("deploy-api/.SKILL.md")
        );
      },
      treeRestored: (before, after) => JSON.stringify(before) === JSON.stringify(after),
    },
  );

  // —— 故障矩阵 ——
  {
    const malformed = await skillSteward.startRun({
      target,
      taskKind: "check",
      scenario: "malformed",
    });
    cases.malformed = { terminal: malformed.terminal, proposals: malformed.proposals.length };
    if (malformed.proposals.length !== 0) fail("malformed: expected zero proposals");
    console.log(`malformed: terminal="${malformed.terminal}" proposals=0`);

    const replayRun = await skillSteward.startRun({
      target,
      skillIds: [skillIds[0]!],
      taskKind: "optimize",
    });
    const replayProposal = replayRun.proposals[0]!;
    await skillSteward.validate(replayProposal.proposalId);
    const firstGrant = await skillSteward.approve(replayProposal.proposalId);
    await skillSteward.apply(replayProposal.proposalId);
    let replayRejected: string;
    try {
      await skillSteward.approve(replayProposal.proposalId);
      fail("approval-replay: second approve unexpectedly succeeded");
    } catch (error) {
      replayRejected = error instanceof Error ? error.message : String(error);
    }
    cases.approvalReplay = {
      proposalId: replayProposal.proposalId,
      grantId: firstGrant.grantId,
      secondApproveRejected: replayRejected,
    };
    console.log(`approval-replay: second approve rejected (${replayRejected.slice(0, 50)}…)`);

    // live 模型 blocker（类型化记录，不冒充通过）。
    const liveAttempt = await daemon.domain.dshSettings.update({ preset: "live" });
    cases.liveModelBlocker =
      liveAttempt.outcome === "rejected"
        ? { outcome: "rejected", code: liveAttempt.code, detail: liveAttempt.detail }
        : { outcome: "updated", note: "credentials present — live chain still to be evidenced" };
    console.log(
      `live-model: ${cases.liveModelBlocker instanceof Object && "code" in cases.liveModelBlocker ? (cases.liveModelBlocker as { code: string }).code : "updated"}`,
    );
  }

  await daemon.stop();
  setHomeOverride(null);
  fs.rmSync(sandbox, { recursive: true, force: true });
  flush();
  console.log("steward-acceptance: all cases passed");
  console.log(
    "evidence: openspec/changes/steward-product-workflow/artifacts/steward-acceptance.json",
  );
} catch (error) {
  evidence.failure =
    error instanceof Error
      ? `${error.message}\n${(error.stack ?? "").split("\n").slice(1, 4).join("\n")}`
      : String(error);
  flush();
  console.error(`steward-acceptance: FAIL: ${evidence.failure}`);
  process.exit(1);
} finally {
  setHomeOverride(null);
  fs.rmSync(sandbox, { recursive: true, force: true });
}
