/**
 * Skill Steward 发布 smoke（openspec steward-product-workflow task 4.4；
 * 取代 agent-steward 1.9 的 fixture-only smoke——旧版证据归档于
 * openspec/changes/archive/2026-09-06-agent-steward/）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.4）：「clean-directory start/stop/restart,
 * workspace mutation, stale conflict, approval, rollback and DSH unavailable
 * are evidenced.」
 *
 * 正交意图：
 *   [1] 真实 daemon 生命周期：干净目录 start → HTTP 健康 → stop → endpoint
 *       释放 → 同 home restart（registry 持久化 + 技能重发现）→ stop。
 *   [2] 管家全链路（domain 真实服务面，与 RPC router 同一对象）：workspace
 *       mutation（import + create 落盘）→ optimize run 出提案 → 外部编辑制造
 *       revision 漂移 → validate=stale + approve typed 拒绝（stale conflict）→
 *       重跑 → validate=valid → approve 铸 grant（approval）→ apply 落盘 →
 *       prepareRollback + applyRollback 字节恢复（rollback）。
 *   [3] DSH unavailable：DSH_HOME 指向普通文件的第二 daemon → status.dsh
 *       mounted:false + typed reason + SPA 恢复面可达且不注入 __DSH_BOOT__。
 * 妥协声明：tray 走 headless（原生窗口路径由 dsh-webui-composition 4.1 浏览器
 *   证据持有）；HTTP 探针直连 loopback，不经浏览器。
 *
 * 执行：`pnpm exec tsx scripts/steward-smoke.sh.ts`
 * 产物：openspec/changes/steward-product-workflow/artifacts/steward-smoke.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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
  script: "scripts/steward-smoke.sh.ts",
  generatedAt: new Date().toISOString(),
  node: process.version,
};

function fail(message: string): never {
  evidence.failure = message;
  flush();
  console.error(`steward-smoke: FAIL: ${message}`);
  process.exit(1);
}

function flush(): void {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "steward-smoke.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 真实 SPA build 目录（源码态默认解析到 webui/static——无 index.html，恢复面会 404）。 */
const webuiDir = path.join(root, "webui", "build");
if (!fs.existsSync(path.join(webuiDir, "index.html"))) {
  fail(`SPA build missing at ${webuiDir}; run: pnpm --dir webui build`);
}

/** bootDaemon 的 null 通道（IPC 被占用）在 smoke 里一律视为失败。 */
async function startDaemon(webToken: string) {
  const { bootDaemon } = await import("../src/daemon/index.js");
  const handles = await bootDaemon({
    cliVersion: pkgVersion,
    webuiDir,
    withTray: false,
    withDshHost: true,
    webToken,
  });
  if (!handles) fail("bootDaemon returned null (IPC lock held by another daemon)");
  return handles;
}

// —— 隔离环境（IPC sun_path 限制：sandbox 用 /tmp 短前缀）——
const sandbox = fs.mkdtempSync("/tmp/steward-smoke-");
process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
process.env.DSH_HOME = path.join(sandbox, "dsh-home");
process.env.OPENTRAY_HOME = path.join(sandbox, "opentray");
process.env.SKILL_CREATOR_DISABLE_TRAY = "1";

const { setHomeOverride } = await import("../src/shared/paths.ts");
setHomeOverride(process.env.SKILL_CREATOR_HOME!);

const { ProviderIdSchema } = await import("../src/shared/contracts/workspaces.ts");
const pkgVersion = (
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }
).version;
const providerId = ProviderIdSchema.parse("openclaw");

async function healthOk(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    return response.status === 200 && ((await response.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

async function endpointRefused(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`);
    return false;
  } catch {
    return true;
  }
}

try {
  // —— 场景 1/2：干净目录 start + workspace mutation ——
  const workspaceDir = path.join(sandbox, "ws");
  fs.mkdirSync(path.join(workspaceDir, "skills"), { recursive: true });
  const daemon = await startDaemon("steward-smoke");
  if (!(await healthOk(daemon.port))) fail("clean-directory start: /api/health not ok");
  if (daemon.status.dsh?.mounted !== true) {
    fail(`clean-directory start: DSH host not mounted: ${daemon.status.dsh?.reason}`);
  }
  evidence.cleanStart = {
    port: daemon.port,
    healthOk: true,
    dshMounted: true,
    dshEntries: daemon.status.dsh?.entries?.length ?? 0,
  };
  console.log(
    `clean start: port=${daemon.port} dsh entries=${daemon.status.dsh?.entries?.length ?? 0}`,
  );

  const workspace = daemon.domain.workspaces.import(workspaceDir, "smoke-ws");
  await daemon.domain.creator.save({
    mode: "create",
    workspaceId: workspace.id,
    providerId,
    directoryName: "smoke-skill",
    frontmatter: { name: "smoke-skill", description: "steward smoke skill." },
    body: "# smoke-skill\n\nSteward smoke baseline.\n",
  });
  const skillFile = path.join(workspaceDir, "skills", "smoke-skill", "SKILL.md");
  if (!fs.existsSync(skillFile)) fail("workspace mutation: creator.save did not write SKILL.md");
  const baselineSha = sha256(skillFile);
  evidence.workspaceMutation = {
    workspaceId: workspace.id,
    skillFile: "skills/smoke-skill/SKILL.md",
    sha256: baselineSha,
  };
  console.log(`workspace mutation: skills/smoke-skill/SKILL.md (${baselineSha.slice(0, 12)}…)`);

  const target = { workspaceId: workspace.id, providerId };
  const skillSteward = daemon.domain.skillSteward;

  // —— 场景 3/4：stale conflict（外部编辑制造 revision 漂移）——
  const driftRun = await skillSteward.startRun({ target, taskKind: "optimize" });
  if (driftRun.proposals.length !== 1) {
    fail(`optimize run produced ${driftRun.proposals.length} proposals`);
  }
  const driftedId = driftRun.proposals[0]!.proposalId;
  fs.appendFileSync(skillFile, "\n<!-- external edit during smoke -->\n", "utf8");
  // 回滚恢复的是快照字节（含此后这次外部编辑）——预 apply 基线以此为准。
  const driftedSha = sha256(skillFile);
  const driftValidation = await skillSteward.validate(driftedId);
  if (driftValidation.overall !== "stale") {
    fail(`stale conflict: expected stale validation, got ${driftValidation.overall}`);
  }
  let approveRejected: string;
  try {
    await skillSteward.approve(driftedId);
    fail("stale conflict: approve unexpectedly succeeded on a stale proposal");
  } catch (error) {
    approveRejected = error instanceof Error ? error.message : String(error);
  }
  if (!/stale/i.test(approveRejected)) {
    fail(`stale conflict: unexpected rejection: ${approveRejected}`);
  }
  evidence.staleConflict = {
    proposalId: driftedId,
    validation: driftValidation.overall,
    approveRejected,
  };
  console.log(
    `stale conflict: validation=${driftValidation.overall} approve rejected (${approveRejected.slice(0, 60)}…)`,
  );

  // —— 场景 5/6：approval + apply（重跑后干净链路）——
  const run = await skillSteward.startRun({ target, taskKind: "optimize" });
  if (run.proposals.length !== 1)
    fail(`second optimize run produced ${run.proposals.length} proposals`);
  const proposalId = run.proposals[0]!.proposalId;
  const validation = await skillSteward.validate(proposalId);
  if (validation.overall !== "valid") {
    const failed = validation.checks.filter((check) => check.status === "failed");
    fail(`approval: validation ${validation.overall} (${failed.map((c) => c.name).join(",")})`);
  }
  const grant = await skillSteward.approve(proposalId);
  const applied = await skillSteward.apply(proposalId);
  if (applied.outcomeStatus !== "applied") {
    fail(
      `apply: outcome ${applied.outcomeStatus}${applied.failure ? ` — ${applied.failure}` : ""}`,
    );
  }
  const appliedSha = sha256(skillFile);
  if (appliedSha === baselineSha) fail("apply: skill bytes unchanged after applied edit");
  evidence.approvalAndApply = {
    proposalId,
    validation: validation.overall,
    checksPassed: `${validation.checks.filter((c) => c.status === "passed").length}/${validation.checks.length}`,
    grantId: grant.grantId,
    fingerprint: grant.fingerprint.slice(0, 16),
    auditId: applied.auditId,
    outcome: applied.outcomeStatus,
    mutations: applied.mutations.map((mutation) => ({
      relPath: mutation.relPath,
      semantic: mutation.semantic,
      before: mutation.beforeRevision?.slice(0, 8) ?? "∅",
      after: mutation.afterRevision?.slice(0, 8) ?? "∅",
    })),
    sha256Before: baselineSha,
    sha256After: appliedSha,
  };
  console.log(
    `approval+apply: grant=${grant.grantId} outcome=${applied.outcomeStatus} mutations=${applied.mutations.length}`,
  );

  // —— 场景 7：rollback（edit 类 = reverse proposal 独立审批后 apply；字节恢复）——
  const rollbackPrep = await skillSteward.prepareRollback(applied.auditId);
  if (!rollbackPrep.reverseProposalId)
    fail("rollback: no reverse proposal prepared for an edit audit");
  const reverseId = rollbackPrep.reverseProposalId;
  const reverseValidation = await skillSteward.validate(reverseId);
  if (reverseValidation.overall !== "valid") {
    fail(`rollback: reverse validation ${reverseValidation.overall}`);
  }
  await skillSteward.approve(reverseId);
  const reverseApply = await skillSteward.apply(reverseId);
  if (reverseApply.outcomeStatus !== "applied") {
    fail(
      `rollback: reverse apply ${reverseApply.outcomeStatus}${reverseApply.failure ? ` — ${reverseApply.failure}` : ""}`,
    );
  }
  const restoredSha = sha256(skillFile);
  if (restoredSha !== driftedSha)
    fail("rollback: bytes not restored to the pre-apply snapshot bytes");
  evidence.rollback = {
    auditId: applied.auditId,
    form: "reverse-proposal (edit)",
    preparedNote: rollbackPrep.note,
    reverseProposalId: reverseId,
    outcome: reverseApply.outcomeStatus,
    mutations: reverseApply.mutations.map((mutation) => mutation.relPath),
    sha256Restored: restoredSha,
    bytesRestored: true,
  };
  console.log(`rollback: reverse proposal applied, bytes restored`);

  // —— 场景 8/9：stop → endpoint 释放 → 同 home restart（registry 持久化）——
  const firstPort = daemon.port;
  await daemon.stop();
  if (!(await endpointRefused(firstPort))) fail("stop: endpoint still accepting connections");
  const reboot = await startDaemon("steward-smoke-restart");
  if (!(await healthOk(reboot.port))) fail("restart: /api/health not ok after same-home restart");
  const persisted = await reboot.domain.workspaces.list();
  const workspacePersisted = persisted.some(
    (entry) => entry.id === workspace.id && entry.kind === "directory",
  );
  if (!workspacePersisted) fail("restart: imported workspace not persisted across restart");
  const skillsAfterRestart = await reboot.domain.skills.list(target);
  if (!skillsAfterRestart.some((skill) => skill.name === "smoke-skill")) {
    fail("restart: smoke-skill not rediscovered after restart");
  }
  evidence.stopAndRestart = {
    firstPort,
    endpointReleased: true,
    restartPort: reboot.port,
    healthOk: true,
    workspacePersisted,
    skillRediscovered: true,
  };
  console.log(
    `stop+restart: endpoint released; port ${firstPort} -> ${reboot.port}; registry persisted`,
  );
  await reboot.stop();

  // —— 场景 10：DSH unavailable（第二 home，DSH_HOME 指向普通文件）——
  const degradedSandbox = fs.mkdtempSync("/tmp/steward-smoke-dsh-");
  process.env.SKILL_CREATOR_HOME = path.join(degradedSandbox, "state");
  process.env.DSH_HOME = path.join(degradedSandbox, "not-a-dir");
  fs.writeFileSync(process.env.DSH_HOME, "x", "utf8");
  setHomeOverride(process.env.SKILL_CREATOR_HOME);
  const degraded = await startDaemon("steward-smoke-dsh-unavailable");
  if (degraded.status.dsh?.mounted !== false || !degraded.status.dsh?.reason) {
    fail("DSH unavailable: expected mounted:false with a typed reason");
  }
  const spa = await fetch(`http://127.0.0.1:${degraded.port}/`);
  const spaBody = await spa.text();
  if (spa.status !== 200 || spaBody.includes("__DSH_BOOT__")) {
    fail("DSH unavailable: SPA recovery not reachable or DSH boot injected");
  }
  evidence.dshUnavailable = {
    mounted: false,
    reason: degraded.status.dsh?.reason,
    spaStatus: spa.status,
    dshBootAbsent: !spaBody.includes("__DSH_BOOT__"),
    daemonAlive: await healthOk(degraded.port),
  };
  console.log(
    `DSH unavailable: reason="${degraded.status.dsh?.reason}" SPA=${spa.status} daemon alive`,
  );
  await degraded.stop();
  fs.rmSync(degradedSandbox, { recursive: true, force: true });

  flush();
  console.log("steward-smoke: all scenarios passed");
  console.log("evidence: openspec/changes/steward-product-workflow/artifacts/steward-smoke.json");
} catch (error) {
  // 未捕获异常必须显式失败（裸 try/finally + process.exit(0) 会把错误吞成成功）。
  evidence.failure =
    error instanceof Error
      ? `${error.message}\n${(error.stack ?? "").split("\n").slice(1, 4).join("\n")}`
      : String(error);
  flush();
  console.error(`steward-smoke: FAIL: ${evidence.failure}`);
  process.exit(1);
} finally {
  setHomeOverride(null);
  fs.rmSync(sandbox, { recursive: true, force: true });
}
