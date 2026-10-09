/**
 * creator-store-service 契约测试（creator-skill-store 批 1）。
 *
 * 用户原始需求 [2026-10-09]：「我们得有一个专门管理我们创建出来的这些 skills……
 * 然后再通过 ccski-sdk 将这些 skill 安装到本地 agent skills 目录……直接把技能
 * 放在 .agents/skills 目录，这属于我们可以自动化做到事情。」
 * Architecture decisions [2026-10-09]（design.md D1-D3）：
 * - store = 唯一根源；应用 = ccski 两阶段（entity-local / symlink 双形态）。
 * - sync = updateEntity + 逐 root 收据（GUARD_PROJECTION 保留物化副本；degraded
 *   fail-closed）；uninstall = 末投影 GC 全清；delete-origin 与卸载正交。
 *
 * Orthogonal intents:
 *   [1] create→auto-apply 的 entity-local 事实（实体在场、无 symlink、state 记账）。
 *   [2] 多 root 应用（global symlink + workspace provider 投影）与 edit→sync 收敛。
 *   [3] 收据裁决与失败面（GUARD_PROJECTION / STATE_DEGRADED / 末投影 GC /
 *       delete-origin 列出应用面 / 创建面零 provider-root 直写 / 枚举跳过）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectEntity as ccskiProjectEntity } from "ccski";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { ProviderIdSchema, type ImportedWorkspace } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let home = "";
let domain: DaemonDomain;
const openClawProviderId = ProviderIdSchema.parse("openclaw");
const codexProviderId = ProviderIdSchema.parse("codex");
const clineProviderId = ProviderIdSchema.parse("cline");
const cursorProviderId = ProviderIdSchema.parse("cursor");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-store-test-"));
  home = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = home;
  setHomeOverride(home);
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

const storeSkillFile = (directoryName: string): string =>
  path.join(home, "creator-skills", directoryName, "SKILL.md");

const globalEntityDirectory = (directoryName: string): string =>
  path.join(home, ".agents", "skills", directoryName);

const codexProjection = (directoryName: string): string =>
  path.join(home, ".codex", "skills", directoryName);

const cursorProjection = (directoryName: string): string =>
  path.join(home, ".cursor", "skills", directoryName);

function readGlobalState(): {
  entities: Record<string, Record<string, unknown>>;
  projections: Record<string, Record<string, unknown>>;
} {
  return JSON.parse(fs.readFileSync(path.join(home, ".agents", ".ccski-state.json"), "utf8"));
}

async function createSkill(directoryName: string, description = "A store skill.") {
  return domain.creatorStore.create({
    directoryName,
    frontmatter: { name: directoryName, description },
    body: `# ${directoryName}\n\nInitial body.\n`,
  });
}

describe("creator store service", () => {
  it("creates into the store and auto-applies the global canonical root entity-locally", async () => {
    const created = await createSkill("my-skill");

    // store 唯一根源。
    expect(fs.existsSync(storeSkillFile("my-skill"))).toBe(true);

    // auto-apply：~/.agents/skills 实体在场、无 symlink、state 记账。
    const entityStat = fs.lstatSync(globalEntityDirectory("my-skill"));
    expect(entityStat.isDirectory()).toBe(true);
    expect(entityStat.isSymbolicLink()).toBe(false);
    const state = readGlobalState();
    expect(Object.keys(state.entities)).toContain("my-skill");
    const entity = state.entities["my-skill"]!;
    expect(entity.provenance).toMatchObject({
      sourceType: "creator-store",
      source: path.join(home, "creator-skills", "my-skill"),
    });

    // auto-apply 收据如实并入（entity-local + created）。
    expect(created.autoApply.results).toHaveLength(1);
    expect(created.autoApply.results[0]).toMatchObject({
      status: "unchanged",
      mode: "entity-local",
      entity: "created",
    });
    expect(created.validation.success).toBe(true);
  });

  it("applies to multiple roots with symlink projections across global and workspace scopes", async () => {
    await createSkill("multi-root");
    const workspace = importWorkspace("multi-root-ws");

    const result = await domain.creatorStore.apply({
      directoryName: "multi-root",
      targets: [
        { workspaceId: "~", providerId: codexProviderId },
        { workspaceId: workspace.id, providerId: openClawProviderId },
      ],
    });

    expect(result.failed).toBe(0);
    // global codex root：symlink 投影指向实体。
    const codexStat = fs.lstatSync(codexProjection("multi-root"));
    expect(codexStat.isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(codexProjection("multi-root"))).toBe(
      fs.realpathSync(globalEntityDirectory("multi-root")),
    );
    // workspace provider root：project scope 实体 + symlink 投影。
    const workspaceEntity = path.join(workspace.path, ".agents", "skills", "multi-root");
    const workspaceProjection = path.join(workspace.path, "skills", "multi-root");
    expect(fs.lstatSync(workspaceEntity).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(workspaceProjection).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(workspaceProjection)).toBe(workspaceEntity);

    // 状态：已应用 roots 覆盖 global 与 project 两面。
    const status = await domain.creatorStore.status({ directoryName: "multi-root" });
    expect(status.skill.outdated).toBe(false);
    const scopes = status.skill.appliedRoots?.map((application) => application.scope).sort();
    expect(scopes).toEqual(["global", "project"]);
    const globalRoots = status.skill.appliedRoots?.find((a) => a.scope === "global")?.roots ?? [];
    expect(globalRoots).toContain(path.join(home, ".agents", "skills"));
    expect(globalRoots).toContain(path.join(home, ".codex", "skills"));
  });

  it("converges applied roots after a store edit through sync with matching hashes", async () => {
    const created = await createSkill("sync-skill");
    await domain.creatorStore.apply({
      directoryName: "sync-skill",
      targets: [{ workspaceId: "~", providerId: codexProviderId }],
    });

    // store 编辑 → 已应用面过期。
    const saved = await domain.creatorStore.save({
      directoryName: "sync-skill",
      expectedRevision: created.document.revision,
      frontmatter: { name: "sync-skill", description: "Edited description." },
      body: "# sync-skill\n\nEdited body.\n",
    });
    let status = await domain.creatorStore.status({ directoryName: "sync-skill" });
    expect(status.skill.outdated).toBe(true);

    const synced = await domain.creatorStore.sync({ directoryName: "sync-skill" });
    expect(synced.failed).toBe(0);
    expect(synced.degradedProjectionState).toBe(false);

    status = await domain.creatorStore.status({ directoryName: "sync-skill" });
    expect(status.skill.outdated).toBe(false);
    // hash 一致：store hash = entity revision；实体内容更新；symlink 自然解析。
    const entityRevision = status.skill.appliedRoots?.find(
      (a) => a.scope === "global",
    )?.entityRevision;
    expect(entityRevision).toBe(status.storeHash);
    expect(
      fs.readFileSync(path.join(globalEntityDirectory("sync-skill"), "SKILL.md"), "utf8"),
    ).toContain("Edited body.");
    expect(fs.readFileSync(codexProjection("sync-skill") + "/SKILL.md", "utf8")).toContain(
      "Edited body.",
    );
    expect(saved.document.frontmatter.description).toBe("Edited description.");
  });

  it("keeps a user-modified materialized copy untouched on sync (GUARD_PROJECTION)", async () => {
    await createSkill("guard-skill");
    // 追加一个 link root（同步结果不受物化副本失败影响）。
    await domain.creatorStore.apply({
      directoryName: "guard-skill",
      targets: [{ workspaceId: "~", providerId: cursorProviderId }],
    });
    // 用真实内核在全新 codex root 上建物化副本（user-request 显式物化；对既有
    // link 记录换 mode 会 MODE_CONFLICT，故不与 link apply 同 root）。
    const materialized = await ccskiProjectEntity({
      scope: "global",
      userDir: home,
      name: "guard-skill",
      roots: [path.join(home, ".codex", "skills")],
      mode: "materialized",
      reason: "user-request",
    });
    expect(materialized.kind).toBe("ok");
    expect(materialized.results[0]).toMatchObject({ status: "projected", mode: "materialized" });

    // 用户改动物化副本 → sync 时 guard 拒绝换新，副本字节原样。
    const copyFile = path.join(codexProjection("guard-skill"), "SKILL.md");
    const userModified = `${fs.readFileSync(copyFile, "utf8")}\nuser modification\n`;
    fs.writeFileSync(copyFile, userModified, "utf8");

    const created = await domain.creatorStore.status({ directoryName: "guard-skill" });
    await domain.creatorStore.save({
      directoryName: "guard-skill",
      expectedRevision: created.skill.revision,
      frontmatter: { name: "guard-skill", description: "A store skill." },
      body: "# guard-skill\n\nPost-guard body.\n",
    });
    const synced = await domain.creatorStore.sync({ directoryName: "guard-skill" });

    const guardEntry = synced.results.find(
      (entry) => entry.root === path.join(home, ".codex", "skills"),
    );
    expect(guardEntry).toMatchObject({ status: "failed", code: "GUARD_PROJECTION" });
    expect(guardEntry?.detail).toContain("GUARD_PROJECTION");
    // 副本字节原样（未被重物化）。
    expect(fs.readFileSync(copyFile, "utf8")).toBe(userModified);
    // 其余 root 不受影响：canonical entity-local 与 cursor link 均收敛。
    const canonicalEntry = synced.results.find(
      (entry) => entry.root === path.join(home, ".agents", "skills"),
    );
    expect(canonicalEntry?.status).toBe("updated");
    expect(
      fs.readFileSync(path.join(globalEntityDirectory("guard-skill"), "SKILL.md"), "utf8"),
    ).toContain("Post-guard body.");
    expect(
      fs.readFileSync(path.join(cursorProjection("guard-skill"), "SKILL.md"), "utf8"),
    ).toContain("Post-guard body.");
  });

  it("fails closed on degraded projection records during sync", async () => {
    await createSkill("degraded-skill");
    await domain.creatorStore.apply({
      directoryName: "degraded-skill",
      targets: [{ workspaceId: "~", providerId: codexProviderId }],
    });

    // 破坏 codex 投影记录（mode 非法 → 内核 parseProjectionTable 丢弃）。
    const statePath = path.join(home, ".agents", ".ccski-state.json");
    const state = readGlobalState();
    const corrupted = Object.fromEntries(
      Object.entries(state.projections).map(([key, record]) => [
        key,
        String(record.rootPath).includes(".codex") ? { ...record, mode: 123 } : record,
      ]),
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify({ ...state, projections: corrupted }, null, 2),
      "utf8",
    );

    const status = await domain.creatorStore.status({ directoryName: "degraded-skill" });
    await domain.creatorStore.save({
      directoryName: "degraded-skill",
      expectedRevision: status.skill.revision,
      frontmatter: { name: "degraded-skill", description: "A store skill." },
      body: "# degraded-skill\n\nDegraded body.\n",
    });
    const synced = await domain.creatorStore.sync({ directoryName: "degraded-skill" });

    expect(synced.degradedProjectionState).toBe(true);
    // 无收据 ≠ 未登记：损坏 root 不得被宣称为 updated；显式 STATE_DEGRADED 失败。
    const degradedEntries = synced.results.filter((entry) => entry.code === "STATE_DEGRADED");
    expect(degradedEntries).toHaveLength(1);
    expect(degradedEntries[0]?.status).toBe("failed");
    expect(degradedEntries[0]?.detail).toContain("ccski state repair");
    const codexClaim = synced.results.find(
      (entry) => entry.root === path.join(home, ".codex", "skills"),
    );
    expect(codexClaim?.status).not.toBe("updated");
    // 实体本身仍按 updateEntity 语义换新（canonical root 收据如实）。
    const canonicalEntry = synced.results.find(
      (entry) => entry.root === path.join(home, ".agents", "skills"),
    );
    expect(canonicalEntry?.status).toBe("updated");
  });

  it("uninstalls the last projection through kernel GC and keeps the store intact", async () => {
    await createSkill("uninstall-skill");
    await domain.creatorStore.apply({
      directoryName: "uninstall-skill",
      targets: [{ workspaceId: "~", providerId: codexProviderId }],
    });

    const result = await domain.creatorStore.uninstall({ directoryName: "uninstall-skill" });

    expect(result.failed).toBe(0);
    expect(result.removed).toBe(1);
    expect(result.results[0]).toMatchObject({
      scope: "global",
      status: "removed",
      entityRemoved: true,
    });
    // 实体与投影全清；store 目录与文档原样。
    expect(fs.existsSync(codexProjection("uninstall-skill"))).toBe(false);
    expect(fs.existsSync(globalEntityDirectory("uninstall-skill"))).toBe(false);
    const state = readGlobalState();
    expect(Object.keys(state.entities)).not.toContain("uninstall-skill");
    expect(Object.keys(state.projections)).toHaveLength(0);
    expect(fs.existsSync(storeSkillFile("uninstall-skill"))).toBe(true);

    // 重新应用可完整恢复（store 仍在唯一根源位）。
    const reapplied = await domain.creatorStore.apply({
      directoryName: "uninstall-skill",
      targets: [{ workspaceId: "~", providerId: codexProviderId }],
    });
    expect(reapplied.failed).toBe(0);
    expect(fs.lstatSync(codexProjection("uninstall-skill")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(globalEntityDirectory("uninstall-skill"))).toBe(true);
  });

  it("uninstalls an entity-local-only application through deleteEntity", async () => {
    await createSkill("local-only");

    const result = await domain.creatorStore.uninstall({ directoryName: "local-only" });

    expect(result.removed).toBe(1);
    expect(result.results[0]).toMatchObject({ status: "removed", entityRemoved: true });
    expect(fs.existsSync(globalEntityDirectory("local-only"))).toBe(false);
    expect(fs.existsSync(storeSkillFile("local-only"))).toBe(true);
  });

  it("delete-origin removes the store directory and lists remaining applications", async () => {
    await createSkill("origin-skill");
    await domain.creatorStore.apply({
      directoryName: "origin-skill",
      targets: [{ workspaceId: "~", providerId: codexProviderId }],
    });
    const status = await domain.creatorStore.status({ directoryName: "origin-skill" });

    const result = domain.creatorStore.remove({
      directoryName: "origin-skill",
      expectedRevision: status.skill.revision,
    });

    // 有应用面时如实列出，不阻止删除。
    expect(result.removed).toBe(true);
    expect(result.remainingApplications).toHaveLength(1);
    expect(result.remainingApplications[0]?.scope).toBe("global");
    expect(result.remainingApplications[0]?.roots).toContain(path.join(home, ".codex", "skills"));
    expect(fs.existsSync(path.join(home, "creator-skills", "origin-skill"))).toBe(false);
    // 应用面（实体 + 投影）原样——删除根源不等于卸载。
    expect(fs.existsSync(globalEntityDirectory("origin-skill"))).toBe(true);
    expect(fs.existsSync(codexProjection("origin-skill"))).toBe(true);
  });

  it("never resolves a writable provider scope from the creation face", async () => {
    const workspace = importWorkspace("negative-ws");
    const resolveWritableSpy = vi.spyOn(domain.workspaces, "resolveWritable");

    const created = await domain.creator.save({
      mode: "create",
      directoryName: "neg-skill",
      frontmatter: { name: "neg-skill", description: "Creation-face negative." },
      body: "# Negative\n",
    });
    expect(created.created).toBe(true);

    // new 模式调用链零 resolveWritable；落盘路径全部解析进 creator store。
    expect(resolveWritableSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(storeSkillFile("neg-skill"))).toBe(true);
    // provider root 与 Imported 实体库根上没有任何宿主直写痕迹。
    expect(fs.existsSync(path.join(workspace.path, "skills", "neg-skill"))).toBe(false);
    expect(fs.existsSync(path.join(workspace.path, ".agents"))).toBe(false);
    resolveWritableSpy.mockRestore();
  });

  it("skips incompatible store entries while listing compatible ones", async () => {
    await createSkill("good-skill");
    // 不安全目录名（schema 拒绝）。
    fs.mkdirSync(path.join(home, "creator-skills", "not_a_skill"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "creator-skills", "not_a_skill", "SKILL.md"),
      "---\nname: not-a-skill\ndescription: x\n---\nbody\n",
      "utf8",
    );
    // 目录名安全但 frontmatter 不兼容。
    fs.mkdirSync(path.join(home, "creator-skills", "bad-frontmatter"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "creator-skills", "bad-frontmatter", "SKILL.md"),
      "---\nname: 42\n---\nbody\n",
      "utf8",
    );
    // 无 SKILL.md 的目录。
    fs.mkdirSync(path.join(home, "creator-skills", "empty-entry"), { recursive: true });

    const listed = domain.creatorStore.list();

    expect(listed.skills.map((skill) => skill.directoryName)).toEqual(["good-skill"]);
    expect(listed.skipped).toBe(3);
  });
});
