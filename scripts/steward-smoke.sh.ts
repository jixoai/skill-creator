/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward task 1.9）：「验收：fixture tests、
 * 启用 backend 的 smoke test、pnpm check、pnpm build，并保存去敏 protocol transcript。」
 * 正交意图：
 *   [1] 以真实 daemon domain（fixture backend）跑一遍完整 steward 生命周期。
 *   [2] 把 run 投影 + 事件时间线去敏（抹掉本机路径）后写入 openspec artifacts。
 * 妥协声明：fixture 是确定性 backend（Manager 管线全真实）；DSH/Codex smoke 由
 *   test/agent-steward.test.ts 的协议映射与 typed-unavailable 用例覆盖。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDaemonDomain } from "../src/daemon/domain.js";
import { createFixtureHarnessAdapter } from "../src/daemon/steward/fixture-adapter.js";
import { ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const providerId = ProviderIdSchema.parse("openclaw");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-steward-smoke-"));
const isolatedHome = path.join(sandbox, "state");
process.env.SKILL_CREATOR_HOME = isolatedHome;
setHomeOverride(isolatedHome);

const domain = createDaemonDomain(undefined, {
  stewardAdapters: [createFixtureHarnessAdapter()],
});

async function waitFor(probe: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`smoke: timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

try {
  const workspaceDir = path.join(sandbox, "smoke-root");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const workspace = domain.workspaces.import(workspaceDir, "smoke");
  const target = { workspaceId: workspace.id, providerId };

  const skills: Array<[string, string, string]> = [
    ["deploy-web", "Deploy the web app.", "Bash, Read"],
    ["deploy-api", "Deploy the api app.", "Bash, Read"],
    ["audit-logs", "Audit log exports.", "Grep"],
  ];
  for (const [directoryName, description, tools] of skills) {
    await domain.creator.save({
      mode: "create",
      workspaceId: workspace.id,
      providerId,
      directoryName,
      frontmatter: { name: directoryName, description, "allowed-tools": tools },
      body: `# ${directoryName}\\n\nRuns \`scripts/${directoryName}.sh\` and reads ./assets/config.yaml.\n`,
    });
  }

  const started = await domain.steward.start({
    backendId: "fixture",
    target,
    objective: "Smoke run: analyze and propose safe maintenance recommendations.",
  });
  const runId = started.run.runId;

  await waitFor(
    () =>
      domain.steward.events({ runId }).events.some((event) => event.kind === "permission-request"),
    "permission request",
  );
  const permissionEvent = domain.steward
    .events({ runId })
    .events.find((event) => event.kind === "permission-request")!;
  await domain.steward.decidePermission({
    runId,
    requestId: permissionEvent.permissionRequestId!,
    decision: "granted",
  });

  await waitFor(() => {
    const probe = domain.steward.events({ runId });
    return probe.status !== "running" || probe.phase === "awaiting-approval";
  }, "approval gate");
  const gate = domain.steward.events({ runId });
  if (gate.status !== "running") throw new Error(`smoke: run terminated early (${gate.status})`);

  const gateRun = domain.steward.list().runs.find((run) => run.runId === runId)!;
  const approved = await domain.steward.approveProposal({
    runId,
    proposalId: gateRun.proposalIds[0]!,
  });
  const settledRun = await domain.steward.settled(runId);
  if (settledRun.status !== "completed") {
    throw new Error(`smoke: run did not complete (${settledRun.status}: ${settledRun.error})`);
  }

  const sanitize = (text: string): string => text.split(sandbox).join("<sandbox>");
  const transcript = {
    generatedAt: new Date().toISOString(),
    backend: "fixture",
    note: "Sanitized steward smoke transcript: real daemon domain, fixture harness backend.",
    applied: approved.result,
    run: JSON.parse(sanitize(JSON.stringify(settledRun))),
    events: domain.steward
      .events({ runId })
      .events.map((event) => JSON.parse(sanitize(JSON.stringify(event)))),
  };

  const outDir = path.join(process.cwd(), "openspec", "changes", "agent-steward", "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "fixture-run-transcript.json");
  fs.writeFileSync(outFile, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  console.log(`steward smoke transcript written: ${outFile}`);
  console.log(
    `run=${settledRun.runId} status=${settledRun.status} events=${transcript.events.length} applied=${approved.result.applied}`,
  );
} finally {
  await domain.steward.dispose();
  await domain.repository.dispose();
  setHomeOverride(null);
  fs.rmSync(sandbox, { recursive: true, force: true });
}
