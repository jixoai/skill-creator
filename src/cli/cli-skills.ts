/**
 * 用户原始需求 [2026-09-30]：「skill-creator 自身也需要暴露更多的 cli 能力，来实现
 * webui 的能力暴露出来使用，比如技能的维护、清理和升级 等等」（cli-surface-parity D1/D3）。
 *
 * 正交意图：
 *   [1] `skill-creator skills` 子命令族的 argv 解析与终端投影（list/info/
 *       validate/toggle/duplicates/update check|apply）。
 *   [2] 同源边界：进程内组装 createDaemonDomain，只消费 domain 服务——业务规则
 *       （symlink guard、update 状态投影）不在此复制。
 */
import type { DaemonDomain } from "../daemon/domain.js";
import type { WorkspaceProviderTarget } from "../shared/contracts/workspaces.js";
import {
  CliRefUsageError,
  resolveProviderRef,
  resolveSkillRefs,
  resolveWorkspaceRef,
} from "./cli-refs.js";

const USAGE = `Usage:
  skill-creator skills list [<workspace>] [--provider <p>] [--all] [--json]
  skill-creator skills info <workspace> <provider> <skill> [--json]
  skill-creator skills validate <workspace> <provider> <skill>
  skill-creator skills toggle <workspace> <provider> <skill>... (--enable | --disable)
  skill-creator skills duplicates [--json]
  skill-creator skills update check <workspace> <provider> [--json]
  skill-creator skills update apply <workspace> <provider> <skillName>... [--json]

References: workspace = "~" | path | ws_* id | label prefix; provider = id | label
prefix; skill = name | directoryName | sk_ id.`;

/** 用法错误（exit 2）。 */
export class SkillsCliUsageError extends Error {}

/** 简单 flag 解析：`--k v` / 布尔 flag；位置参数按序收集。 */
function parseArgs(
  argv: string[],
  valueFlags: readonly string[],
  boolFlags: readonly string[],
): { positionals: string[]; values: Map<string, string>; bools: Set<string> } {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 2) {
        const key = token.slice(2, eq);
        if (!valueFlags.includes(key)) throw new SkillsCliUsageError(USAGE);
        values.set(key, token.slice(eq + 1));
        continue;
      }
      const key = token.slice(2);
      if (valueFlags.includes(key)) {
        i += 1;
        const value = argv[i];
        if (value === undefined)
          throw new SkillsCliUsageError(`missing value for --${key}\n${USAGE}`);
        values.set(key, value);
      } else if (boolFlags.includes(key)) {
        bools.add(key);
      } else {
        throw new SkillsCliUsageError(`unknown flag --${key}\n${USAGE}`);
      }
      continue;
    }
    positionals.push(token);
  }
  return { positionals, values, bools };
}

async function targetFromRefs(
  domain: DaemonDomain,
  wsRef: string,
  pRef: string,
): Promise<WorkspaceProviderTarget> {
  const workspace = await resolveWorkspaceRef(domain, wsRef);
  const provider = resolveProviderRef(workspace, pRef);
  return { workspaceId: workspace.id, providerId: provider.id };
}

async function listCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals, values, bools } = parseArgs(argv, ["provider"], ["all", "json"]);
  if (positionals.length > 1) throw new SkillsCliUsageError(USAGE);
  const includeDisabled = bools.has("all");
  const workspaces =
    positionals.length === 1
      ? [await resolveWorkspaceRef(domain, positionals[0])]
      : await domain.workspaces.list();
  let providerFilter: string | null = null;
  if (values.has("provider")) {
    if (positionals.length === 0) {
      throw new SkillsCliUsageError("--provider requires an explicit workspace argument");
    }
    providerFilter = resolveProviderRef(workspaces[0], values.get("provider")!).id;
  }
  interface SkillRow {
    workspace: string;
    provider: string;
    name: string;
    directory: string;
    state: string;
    installedVia: string;
    updatable: boolean;
    id: string;
  }
  const rows: SkillRow[] = [];
  for (const workspace of workspaces) {
    for (const provider of workspace.providers) {
      if (providerFilter !== null && provider.id !== providerFilter) continue;
      const skills = await domain.skills.list(
        { workspaceId: workspace.id, providerId: provider.id },
        includeDisabled,
      );
      for (const skill of skills) {
        rows.push({
          workspace: workspace.label,
          provider: provider.id,
          name: skill.name,
          directory: skill.directoryName,
          state: skill.disabled ? "disabled" : "enabled",
          installedVia: skill.installedVia ?? "unknown",
          updatable: skill.updatable ?? false,
          id: skill.id,
        });
      }
    }
  }
  if (bools.has("json")) {
    console.log(JSON.stringify({ skills: rows }, null, 2));
    return 0;
  }
  for (const row of rows) {
    console.log(
      `${row.workspace}/${row.provider}  ${row.name}${row.state === "disabled" ? " (disabled)" : ""}` +
        `${row.updatable ? "  [updatable]" : ""}  ${row.id}`,
    );
  }
  return 0;
}

async function infoCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals, bools } = parseArgs(argv, [], ["json"]);
  if (positionals.length !== 3) throw new SkillsCliUsageError(USAGE);
  const target = await targetFromRefs(domain, positionals[0], positionals[1]);
  const discovered = await domain.skills.list(target, true);
  const [skill] = resolveSkillRefs(discovered, [positionals[2]]);
  const info = await domain.skills.info(target, skill.id);
  if (bools.has("json")) {
    console.log(JSON.stringify(info, null, 2));
    return 0;
  }
  console.log(`${info.name}  (${info.id})`);
  console.log(`provider: ${info.provider}  state: ${info.disabled ? "disabled" : "enabled"}`);
  console.log(`path: ${info.path}`);
  console.log(`size: ${info.size}B  revision: ${info.revision}`);
  console.log(
    `references: ${info.hasReferences}  scripts: ${info.hasScripts}  assets: ${info.hasAssets}`,
  );
  console.log(`---`);
  console.log(info.content);
  return 0;
}

async function validateCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals } = parseArgs(argv, [], []);
  if (positionals.length !== 3) throw new SkillsCliUsageError(USAGE);
  const target = await targetFromRefs(domain, positionals[0], positionals[1]);
  const discovered = await domain.skills.list(target, true);
  const [skill] = resolveSkillRefs(discovered, [positionals[2]]);
  const result = await domain.skills.validate(target, skill.id);
  for (const error of result.errors) console.error(`error: ${error}`);
  for (const warning of result.warnings) console.error(`warning: ${warning}`);
  console.log(`${result.name}: ${result.success ? "valid" : "invalid"}`);
  return result.success ? 0 : 1;
}

async function toggleCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals, bools } = parseArgs(argv, [], ["enable", "disable"]);
  if (positionals.length < 3) throw new SkillsCliUsageError(USAGE);
  if (bools.has("enable") === bools.has("disable")) {
    throw new SkillsCliUsageError("toggle requires exactly one of --enable or --disable");
  }
  const mode = bools.has("enable") ? ("enable" as const) : ("disable" as const);
  const target = await targetFromRefs(domain, positionals[0], positionals[1]);
  const discovered = await domain.skills.list(target, true);
  const skills = resolveSkillRefs(discovered, positionals.slice(2));
  const summary = await domain.skills.toggle(
    target,
    skills.map((s) => s.id),
    mode,
  );
  let bad = 0;
  for (const entry of summary.results) {
    if (entry.status === "enabled" || entry.status === "disabled") {
      console.log(`${entry.name}: ${entry.status}`);
      continue;
    }
    bad += 1;
    console.error(`${entry.name}: ${entry.status}${entry.error ? ` — ${entry.error}` : ""}`);
  }
  return bad === 0 ? 0 : 1;
}

async function duplicatesCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const { positionals, bools } = parseArgs(argv, [], ["json"]);
  if (positionals.length > 0) throw new SkillsCliUsageError(USAGE);
  const groups = await domain.skillSearch.duplicates();
  if (bools.has("json")) {
    console.log(JSON.stringify({ groups }, null, 2));
    return 0;
  }
  if (groups.length === 0) {
    console.log("no content-duplicate groups.");
    return 0;
  }
  for (const group of groups) {
    console.log(`duplicate group ${group.contentHash.slice(0, 12)}:`);
    for (const member of group.members) {
      const scopes = member.installations.map((i) => `${i.workspaceId}/${i.providerId}`).join(" ");
      console.log(`  ${member.name}  ${scopes}  ${member.canonicalPath}`);
    }
  }
  return 0;
}

async function updateCommand(domain: DaemonDomain, argv: string[]): Promise<number> {
  const action = argv[0];
  if (action === "check") {
    const { positionals, bools } = parseArgs(argv.slice(1), [], ["json"]);
    if (positionals.length !== 2) throw new SkillsCliUsageError(USAGE);
    const target = await targetFromRefs(domain, positionals[0], positionals[1]);
    const discovered = await domain.skills.list(target, true);
    const result = await domain.skillsUpdate.checkUpdates(target, discovered, target);
    if (bools.has("json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const entry of result.results) {
        const detail = entry.error ? ` — ${entry.error}` : "";
        console.log(`${entry.name}: ${entry.status}${detail}`);
      }
    }
    return 0;
  }
  if (action === "apply") {
    const { positionals, bools } = parseArgs(argv.slice(1), [], ["json"]);
    if (positionals.length < 3) throw new SkillsCliUsageError(USAGE);
    const target = await targetFromRefs(domain, positionals[0], positionals[1]);
    const discovered = await domain.skills.list(target, true);
    const skills = resolveSkillRefs(discovered, positionals.slice(2));
    const skillIds = skills.map((s) => s.id);
    const input = { ...target, skillIds };
    const result = await domain.skillsUpdate.applyUpdates(input, skillIds, input);
    let failed = 0;
    for (const entry of result.results) {
      if (entry.status === "failed") failed += 1;
      const detail = entry.error ? ` — ${entry.error}` : "";
      console.log(`${entry.name}: ${entry.status}${detail}`);
    }
    if (bools.has("json")) console.log(JSON.stringify(result, null, 2));
    return failed === 0 ? 0 : 1;
  }
  throw new SkillsCliUsageError(USAGE);
}

/** `skill-creator skills <子命令>` 入口：进程内组装 domain（与 mcp stdio 同一先例）。 */
export async function runSkillsCli(): Promise<number> {
  const argv = process.argv.slice(process.argv.indexOf("skills") + 1);
  const sub = argv[0];
  try {
    const { createDaemonDomain } = await import("../daemon/domain.js");
    const domain = createDaemonDomain(undefined, { probeWarmup: false });
    if (sub === "list") return await listCommand(domain, argv.slice(1));
    if (sub === "info") return await infoCommand(domain, argv.slice(1));
    if (sub === "validate") return await validateCommand(domain, argv.slice(1));
    if (sub === "toggle") return await toggleCommand(domain, argv.slice(1));
    if (sub === "duplicates") return await duplicatesCommand(domain, argv.slice(1));
    if (sub === "update") return await updateCommand(domain, argv.slice(1));
  } catch (error) {
    if (error instanceof CliRefUsageError || error instanceof SkillsCliUsageError) {
      console.error(error.message);
      return 2;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.error(USAGE);
  return 2;
}
