/**
 * Manager 工具轮 → 官方 transcript 的常驻实证（openspec dsh-webui-composition task 2.2
 * 浏览器验收用 dev 工具）。
 *
 * 执行：`pnpm exec tsx scripts/dsh-tool-round-live.sh.ts`。流程：干净临时 home 启动
 * 官方 web profile → 建 daemon Workspace + 一个技能 → 带 binder 跑一次真实
 * pipeline.startRun（域工具轮 + 提案）→ 打印带 token URL 与 DSH session id 后常驻；
 * SIGINT/SIGTERM 清理。证据截图由内置浏览器验证流程产出。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-toolround-live-"));
process.env.DSH_HOME = path.join(home, "dsh-home");
process.env.SKILL_CREATOR_HOME = path.join(home, "state");
fs.writeFileSync(path.join(root, "dsh-toolround-live.url"), "", "utf8");

const { bootOfficialWebProfile } = await import("../src/daemon/steward/dsh-official-profile.ts");
const { createDshSessionBinder } = await import("../src/daemon/steward/dsh-session-binder.ts");
const { createSkillStewardPipelineService } =
  await import("../src/daemon/steward/pipeline-service.ts");
const { createDaemonDomain } = await import("../src/daemon/domain.js");
const { deterministicSkillsCliProbe } = await import("../test/helpers/deterministic-probe.js");
const { ProviderIdSchema } = await import("../src/shared/contracts/workspaces.js");
const { setHomeOverride } = await import("../src/shared/paths.js");

setHomeOverride(process.env.SKILL_CREATOR_HOME!);
const host = await bootOfficialWebProfile({ home: process.env.DSH_HOME! });
const binder = createDshSessionBinder({ host: () => host });

const domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
const workspaceDir = path.join(home, "ws");
fs.mkdirSync(workspaceDir, { recursive: true });
const workspace = domain.workspaces.import(workspaceDir, "toolround-ws");
await domain.creator.save({
  mode: "create",
  workspaceId: workspace.id,
  providerId: ProviderIdSchema.parse("openclaw"),
  directoryName: "probe-skill",
  frontmatter: { name: "probe-skill", description: "toolround probe skill." },
  body: "# probe-skill\n",
});

const pipeline = createSkillStewardPipelineService({
  workspaces: domain.workspaces,
  skills: domain.skills,
  creator: domain.creator,
  dshSessionBinder: binder,
});
const result = await pipeline.startRun({
  target: { workspaceId: workspace.id, providerId: ProviderIdSchema.parse("openclaw") },
  taskKind: "check",
});

fs.writeFileSync(
  path.join(root, "dsh-toolround-live.url"),
  `${host.record.authenticatedUrl}\n`,
  "utf8",
);
console.log(`dsh toolround live: ${host.record.authenticatedUrl}`);
console.log(`dsh session: ${result.dshSessionId ?? "(unbound)"}`);
console.log(
  `terminal: ${result.terminal}; toolCalls: ${result.toolCalls}; proposals: ${result.proposals.length}`,
);
console.log(`home: ${home}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  console.log("shutting down...");
  try {
    await domain.steward.dispose();
    await domain.repository.dispose();
    await host.dispose();
  } finally {
    setHomeOverride(null);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(path.join(root, "dsh-toolround-live.url"), { force: true });
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
setInterval(() => undefined, 60_000);
