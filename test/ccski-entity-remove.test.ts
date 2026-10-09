/**
 * ccski-entity-remove contract tests（ccski-3-host-migration 批 5，走查 F-3 补）。
 *
 * User input [2026-10-08]（MainAgent 工单）:「单 face 删除 = removeEntityProjections；
 * 末投影删除 = 升级全清零残留；非 ccski 保留直删；guard 冲突映射；revision 契约保留」。
 *
 * Orthogonal intents:
 *   [1] 真实内核物理契约：单 face 摘除 / 末投影全清 / 实体 face 全清（W8 复现）
 *       的磁盘 + state 零残留断言。
 *   [2] 双路由边界：非 ccski 直删回归、宿主 revision 契约、保守路径（state
 *       缺失/不兼容/实体记录缺席 → typed 拒绝不动盘）。
 *   [3] 内核 typed error 有限词表映射（不透传内核 message）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureEntity, projectEntity } from "ccski";
import {
  createCcskiEntityRemover,
  observeCcskiEntityRevision,
  removeCcskiEntity,
} from "../src/daemon/ccski-entity-remove.js";
import { createCreatorService } from "../src/daemon/creator-service.js";
import { createCreatorStoreService } from "../src/daemon/creator-store-service.js";
import { createSkillService } from "../src/daemon/skill-service.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import {
  ProviderIdSchema,
  type ImportedWorkspace,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
const openClawProviderId = ProviderIdSchema.parse("openclaw");
const claudeCodeProviderId = ProviderIdSchema.parse("claude-code");
const ampProviderId = ProviderIdSchema.parse("amp");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-entity-remove-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 实体 + 可选多投影的真实内核 fixture（全部 canonical 路径与生产链路同源）。 */
async function kernelFixture(options: {
  name: string;
  projectTo: Array<"openclaw" | "claude-code">;
}): Promise<{
  workspace: ImportedWorkspace;
  workspaces: ReturnType<typeof createWorkspaceRegistry>;
  skills: ReturnType<typeof createSkillService>;
  creator: ReturnType<typeof createCreatorService>;
  targets: Record<"openclaw" | "claude-code" | "amp", WorkspaceProviderTarget>;
  providerRoots: Record<"openclaw" | "claude-code" | "amp", string>;
  canonicalWorkspace: string;
  entityDir: string;
  statePath: string;
}> {
  const workspaceRoot = path.join(sandbox, `ws-${options.name}`);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const source = path.join(sandbox, "src", options.name);
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, "SKILL.md"),
    `---\nname: ${JSON.stringify(options.name)}\ndescription: "Kernel-managed."\n---\n# ${options.name}\n`,
    "utf8",
  );
  const workspaces = createWorkspaceRegistry();
  const workspace = workspaces.import(workspaceRoot, options.name);
  const targets = {
    openclaw: { workspaceId: workspace.id, providerId: openClawProviderId },
    "claude-code": { workspaceId: workspace.id, providerId: claudeCodeProviderId },
    amp: { workspaceId: workspace.id, providerId: ampProviderId },
  } as Record<"openclaw" | "claude-code" | "amp", WorkspaceProviderTarget>;
  const scope = workspaces.resolve(targets.openclaw, true);
  const canonicalWorkspace = scope.workspaceDirectory ?? workspaceRoot;
  const providerRoots = {
    openclaw: path.join(canonicalWorkspace, "skills"),
    "claude-code": path.join(canonicalWorkspace, ".claude", "skills"),
    amp: path.join(canonicalWorkspace, ".agents", "skills"),
  };
  for (const key of options.projectTo) fs.mkdirSync(providerRoots[key], { recursive: true });

  const ensured = await ensureEntity({
    scope: "project",
    workspaceDir: canonicalWorkspace,
    source: { dir: source },
  });
  if (ensured.kind !== "ok") throw new Error(`ensureEntity failed: ${JSON.stringify(ensured)}`);
  if (options.projectTo.length > 0) {
    const projected = await projectEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      name: options.name,
      roots: options.projectTo.map((key) => providerRoots[key]),
    });
    if (projected.kind !== "ok")
      throw new Error(`projectEntity failed: ${JSON.stringify(projected)}`);
  }
  const skills = createSkillService(workspaces);
  const creator = createCreatorService(workspaces, skills, {
    store: createCreatorStoreService(workspaces),
  });
  return {
    workspace,
    workspaces,
    skills,
    creator,
    targets,
    providerRoots,
    canonicalWorkspace,
    entityDir: path.join(canonicalWorkspace, ".agents", "skills", options.name),
    statePath: path.join(canonicalWorkspace, ".agents", ".ccski-state.json"),
  };
}

/** state 文件原始记录读取（测试断言用）。 */
function readStateRecords(statePath: string): {
  entities: Record<string, unknown>;
  projections: Record<string, unknown>;
} {
  const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
    entities?: Record<string, unknown>;
    projections?: Record<string, unknown>;
  };
  return { entities: parsed.entities ?? {}, projections: parsed.projections ?? {} };
}

/** state 内某 folderName 的残留投影记录数（零残留断言）。 */
function projectionRecordsFor(statePath: string, folderName: string): number {
  return Object.values(readStateRecords(statePath).projections).filter(
    (record) => (record as { folderName?: string }).folderName === folderName,
  ).length;
}

function entityRecordExists(statePath: string, folderName: string): boolean {
  return folderName in readStateRecords(statePath).entities;
}

describe("creator remove dual routing (ccski-3-host-migration 批 5)", () => {
  it("removes a single ccski face through the kernel while other faces, the entity, and their state records survive", async () => {
    const fixture = await kernelFixture({
      name: "shared-skill",
      projectTo: ["openclaw", "claude-code"],
    });
    const skill = (await fixture.skills.list(fixture.targets.openclaw, true)).find(
      (row) => row.name === "shared-skill",
    );
    if (!skill) throw new Error("Expected the projected skill through the openclaw face.");
    expect(skill).toMatchObject({ ownership: "ccski", entryKind: "symlink" });
    // revision 经 skills.info 取（与 load 同一 contentRevision 语义）；creator.load
    // 的 provider-root containment 对投影 face 是编辑面既有缺口（W8 记录），不属本批。
    const document = await fixture.skills.info(fixture.targets.openclaw, skill.id);

    await fixture.creator.remove(fixture.targets.openclaw, skill.id, document.revision);

    // 该 face 的投影彻底消失（无悬空链：lstat 直接 ENOENT）。
    expect(fs.existsSync(path.join(fixture.providerRoots.openclaw, "shared-skill"))).toBe(false);
    expect(() => fs.lstatSync(path.join(fixture.providerRoots.openclaw, "shared-skill"))).toThrow();
    // 其余 face 投影存活且仍指向实体。
    const survivingLink = path.join(fixture.providerRoots["claude-code"], "shared-skill");
    expect(fs.lstatSync(survivingLink).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(survivingLink)).toBe(fs.realpathSync(fixture.entityDir));
    // 实体保留、内容未动。
    expect(fs.lstatSync(path.join(fixture.entityDir, "SKILL.md")).isFile()).toBe(true);
    // state：该投影记录退役，其余投影 + 实体记录在场（无 stale 记录）。
    expect(projectionRecordsFor(fixture.statePath, "shared-skill")).toBe(1);
    expect(entityRecordExists(fixture.statePath, "shared-skill")).toBe(true);
    // 发现面：openclaw face 不再列出；claude-code face 仍列出（同 ownership）。
    expect(
      (await fixture.skills.list(fixture.targets.openclaw, true)).find(
        (row) => row.name === "shared-skill",
      ),
    ).toBeUndefined();
    const survivor = (await fixture.skills.list(fixture.targets["claude-code"], true)).find(
      (row) => row.name === "shared-skill",
    );
    expect(survivor).toMatchObject({ ownership: "ccski" });
  });

  it("upgrades the last-face removal to a full clear: entity, projection, and state records leave zero residue", async () => {
    const fixture = await kernelFixture({ name: "lonely-skill", projectTo: ["openclaw"] });
    const skill = (await fixture.skills.list(fixture.targets.openclaw, true)).find(
      (row) => row.name === "lonely-skill",
    );
    if (!skill) throw new Error("Expected the projected skill through the openclaw face.");
    const document = await fixture.skills.info(fixture.targets.openclaw, skill.id);

    await fixture.creator.remove(fixture.targets.openclaw, skill.id, document.revision);

    // 实体目录消失；实体根清空。
    expect(fs.existsSync(fixture.entityDir)).toBe(false);
    expect(fs.readdirSync(fixture.providerRoots.amp)).toEqual([]);
    // 投影消失且无悬空链。
    expect(fs.existsSync(path.join(fixture.providerRoots.openclaw, "lonely-skill"))).toBe(false);
    expect(() => fs.lstatSync(path.join(fixture.providerRoots.openclaw, "lonely-skill"))).toThrow();
    // state 零残留：实体记录退役 + 该 folder 的投影记录为零。
    expect(entityRecordExists(fixture.statePath, "lonely-skill")).toBe(false);
    expect(projectionRecordsFor(fixture.statePath, "lonely-skill")).toBe(0);
  });

  it("clears every projection and the entity when deleting through the entity face (W8 F-3 reproduction)", async () => {
    // W8 现场：经 amp（实体根）face 删除，旧直删留下 .claude/skills 悬空链 +
    // stale state 记录；本批 = 全清零残留。
    const fixture = await kernelFixture({ name: "w8-skill", projectTo: ["claude-code"] });
    const skill = (await fixture.skills.list(fixture.targets.amp, true)).find(
      (row) => row.name === "w8-skill",
    );
    if (!skill) throw new Error("Expected the entity through the amp (entity-root) face.");
    expect(skill).toMatchObject({ ownership: "ccski", entryKind: "directory" });
    const document = await fixture.skills.info(fixture.targets.amp, skill.id);

    await fixture.creator.remove(fixture.targets.amp, skill.id, document.revision);

    // 实体与全部投影消失；provider root 无悬空 symlink；state 无 stale 记录。
    expect(fs.existsSync(fixture.entityDir)).toBe(false);
    expect(fs.existsSync(path.join(fixture.providerRoots["claude-code"], "w8-skill"))).toBe(false);
    expect(() =>
      fs.lstatSync(path.join(fixture.providerRoots["claude-code"], "w8-skill")),
    ).toThrow();
    expect(entityRecordExists(fixture.statePath, "w8-skill")).toBe(false);
    expect(projectionRecordsFor(fixture.statePath, "w8-skill")).toBe(0);
    expect(
      (await fixture.skills.list(fixture.targets["claude-code"], true)).find(
        (row) => row.name === "w8-skill",
      ),
    ).toBeUndefined();
  });

  it("retires a disabled (unlinked) projection record through the kernel when deleting the disabled face", async () => {
    const fixture = await kernelFixture({ name: "asleep-skill", projectTo: ["openclaw"] });
    const skill = (await fixture.skills.list(fixture.targets.openclaw, true)).find(
      (row) => row.name === "asleep-skill",
    );
    if (!skill) throw new Error("Expected the projected skill.");
    // 物理摘链禁用（批 2.3）：链不在、state 记录 disabled 保留。
    await fixture.skills.toggle(fixture.targets.openclaw, [skill.id], "disable");
    expect(fs.existsSync(path.join(fixture.providerRoots.openclaw, "asleep-skill"))).toBe(false);
    const disabledRow = (await fixture.skills.list(fixture.targets.openclaw, true)).find(
      (row) => row.name === "asleep-skill",
    );
    if (!disabledRow) throw new Error("Expected the state-backed disabled row.");
    const document = await fixture.skills.info(fixture.targets.openclaw, disabledRow.id);

    await fixture.creator.remove(fixture.targets.openclaw, disabledRow.id, document.revision);

    // disabled 记录随事实退役 + 末投影全清（内核语义：记录在、链接不在 → 记录退役）。
    expect(entityRecordExists(fixture.statePath, "asleep-skill")).toBe(false);
    expect(projectionRecordsFor(fixture.statePath, "asleep-skill")).toBe(0);
    expect(fs.existsSync(fixture.entityDir)).toBe(false);
    expect(
      (await fixture.skills.list(fixture.targets.openclaw, true)).find(
        (row) => row.name === "asleep-skill",
      ),
    ).toBeUndefined();
  });

  it("keeps the legacy direct delete for non-ccski plain directory skills", async () => {
    const workspaceRoot = path.join(sandbox, "ws-plain");
    const skillDirectory = path.join(workspaceRoot, "skills", "plain-skill");
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(skillDirectory, "SKILL.md"),
      '---\nname: "plain-skill"\ndescription: "Plain."\n---\n# plain-skill\n',
      "utf8",
    );
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "plain");
    const target = { workspaceId: workspace.id, providerId: openClawProviderId };
    const skills = createSkillService(workspaces);
    const creator = createCreatorService(workspaces, skills, {
      store: createCreatorStoreService(workspaces),
    });
    const skill = (await skills.list(target, true)).find((row) => row.name === "plain-skill");
    if (!skill) throw new Error("Expected the plain directory skill.");
    expect(skill.ownership === undefined || skill.ownership === "unknown").toBe(true);
    const document = await creator.load(target, skill.id);

    await creator.remove(target, skill.id, document.revision);

    expect(fs.existsSync(skillDirectory)).toBe(false);
  });

  it("rejects the deletion with a typed conflict when the host revision no longer matches", async () => {
    const fixture = await kernelFixture({ name: "racy-skill", projectTo: ["openclaw"] });
    const skill = (await fixture.skills.list(fixture.targets.openclaw, true)).find(
      (row) => row.name === "racy-skill",
    );
    if (!skill) throw new Error("Expected the projected skill.");
    const document = await fixture.skills.info(fixture.targets.openclaw, skill.id);
    // 并发编辑：实体文档在取得 revision 之后被改写。
    fs.writeFileSync(
      path.join(fixture.entityDir, "SKILL.md"),
      '---\nname: "racy-skill"\ndescription: "Concurrently edited."\n---\n# racy-skill\n',
      "utf8",
    );

    await expect(
      fixture.creator.remove(fixture.targets.openclaw, skill.id, document.revision),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This skill changed on disk. Reload it before deleting.",
    });

    // 拒绝后零副作用：实体 + 投影 + state 记录原样在场。
    expect(fs.existsSync(fixture.entityDir)).toBe(true);
    expect(fs.existsSync(path.join(fixture.providerRoots.openclaw, "racy-skill"))).toBe(true);
    expect(entityRecordExists(fixture.statePath, "racy-skill")).toBe(true);
    expect(projectionRecordsFor(fixture.statePath, "racy-skill")).toBe(1);
  });

  it("maps kernel entity guards to typed conflicts without leaking kernel messages (GUARD_ENTITY via deleteEntity)", async () => {
    const setup = await kernelFixture({ name: "guarded-skill", projectTo: [] });
    const skill = (await setup.skills.list(setup.targets.amp, true)).find(
      (row) => row.name === "guarded-skill",
    );
    if (!skill) throw new Error("Expected the entity through the amp face.");
    const document = await setup.skills.info(setup.targets.amp, skill.id);
    const creator = createCreatorService(setup.workspaces, setup.skills, {
      store: createCreatorStoreService(setup.workspaces),
      entityRemoveKernel: {
        removeEntityProjections: async () => {
          throw new Error("unexpected removeEntityProjections call");
        },
        deleteEntity: async () => ({
          kind: "error" as const,
          code: "GUARD_ENTITY" as const,
          message: "RAW KERNEL INTERNAL DETAIL must not leak",
        }),
      },
    });

    try {
      await creator.remove(setup.targets.amp, skill.id, document.revision);
      throw new Error("Expected the guarded removal to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFLICT" });
      expect((error as Error).message).toContain("ccski code: GUARD_ENTITY");
      expect((error as Error).message).not.toContain("RAW KERNEL INTERNAL DETAIL");
    }
    // 实体原样未动（guard 拒绝 = 路径不动）。
    expect(fs.existsSync(setup.entityDir)).toBe(true);
    expect(entityRecordExists(setup.statePath, "guarded-skill")).toBe(true);
  });

  it("maps kernel projection guards to typed conflicts without leaking kernel messages (GUARD_PROJECTION via removeEntityProjections)", async () => {
    const setup = await kernelFixture({ name: "guarded-face", projectTo: ["openclaw"] });
    const skill = (await setup.skills.list(setup.targets.openclaw, true)).find(
      (row) => row.name === "guarded-face",
    );
    if (!skill) throw new Error("Expected the projected skill.");
    const document = await setup.skills.info(setup.targets.openclaw, skill.id);
    const creator = createCreatorService(setup.workspaces, setup.skills, {
      store: createCreatorStoreService(setup.workspaces),
      entityRemoveKernel: {
        removeEntityProjections: async () => ({
          kind: "ok" as const,
          entityRemoved: false,
          results: [
            {
              root: setup.providerRoots.openclaw,
              rootId: "root",
              path: path.join(setup.providerRoots.openclaw, "guarded-face"),
              status: "failed" as const,
              errorCode: "GUARD_PROJECTION" as const,
              error: "RAW KERNEL INTERNAL DETAIL must not leak",
            },
          ],
          removed: 0,
          skipped: 0,
          failed: 1,
          gc: { attempted: false, entityDeleted: false, warnings: [] },
          generation: 1,
        }),
        deleteEntity: async () => {
          throw new Error("unexpected deleteEntity call");
        },
      },
    });

    try {
      await creator.remove(setup.targets.openclaw, skill.id, document.revision);
      throw new Error("Expected the guarded removal to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFLICT" });
      expect((error as Error).message).toContain("ccski code: GUARD_PROJECTION");
      expect((error as Error).message).not.toContain("RAW KERNEL INTERNAL DETAIL");
    }
    // face 投影与实体原样未动。
    expect(fs.existsSync(path.join(setup.providerRoots.openclaw, "guarded-face"))).toBe(true);
    expect(fs.existsSync(setup.entityDir)).toBe(true);
  });

  it("refuses conservatively when the kernel state is missing, incompatible, or no longer tracks the entity", async () => {
    const fixture = await kernelFixture({ name: "torn-skill", projectTo: ["openclaw"] });

    // state 不兼容（坏 JSON）：typed 拒绝、零磁盘副作用。
    fs.writeFileSync(fixture.statePath, "{ not json", "utf8");
    await expect(
      removeCcskiEntity({
        workspaceDirectory: fixture.canonicalWorkspace,
        providerRoot: fixture.providerRoots.openclaw,
        skillName: "torn-skill",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    expect(fs.existsSync(fixture.entityDir)).toBe(true);

    // state 缺失：typed 拒绝、零磁盘副作用。
    fs.rmSync(fixture.statePath);
    await expect(
      removeCcskiEntity({
        workspaceDirectory: fixture.canonicalWorkspace,
        providerRoot: fixture.providerRoots.openclaw,
        skillName: "torn-skill",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    expect(fs.existsSync(fixture.entityDir)).toBe(true);
    expect(fs.existsSync(path.join(fixture.providerRoots.openclaw, "torn-skill"))).toBe(true);

    // 实体记录被并发移除（state 完好但不跟踪该实体）：typed 拒绝。
    const setup = await kernelFixture({ name: "untracked-skill", projectTo: ["openclaw"] });
    const raw = JSON.parse(fs.readFileSync(setup.statePath, "utf8")) as {
      entities: Record<string, unknown>;
    };
    delete raw.entities["untracked-skill"];
    fs.writeFileSync(setup.statePath, JSON.stringify(raw));
    await expect(
      removeCcskiEntity({
        workspaceDirectory: setup.canonicalWorkspace,
        providerRoot: setup.providerRoots.openclaw,
        skillName: "untracked-skill",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    expect(fs.existsSync(setup.entityDir)).toBe(true);
  });

  it("never falls back to a direct delete on the entity-library face when the state is degraded (P0-2 回归：损坏 state)", async () => {
    // 终审 P0-2 现场：state 损坏 → 发现层把实体本地目录标 unknown → 旧 else
    // 分支 rmSync 直删实体 → 另一 provider 投影悬空 + stale state。修复后实体根
    // face 上的非 ccski 删除一律保守拒绝并指路 state repair。
    const fixture = await kernelFixture({ name: "guardless-skill", projectTo: ["claude-code"] });
    fs.writeFileSync(fixture.statePath, "{ not json", "utf8");
    const degraded = (await fixture.skills.list(fixture.targets.amp, true)).find(
      (row) => row.name === "guardless-skill",
    );
    if (!degraded) throw new Error("Expected the entity through the amp (entity-root) face.");
    // 降级语义钉住：损坏 state 下发现层标 unknown（正是旧直删分支的入口条件）。
    expect(degraded.ownership).toBe("unknown");
    const document = await fixture.skills.info(fixture.targets.amp, degraded.id);

    await expect(
      fixture.creator.remove(fixture.targets.amp, degraded.id, document.revision),
    ).rejects.toMatchObject({
      code: "INVALID_OPERATION",
      message: expect.stringContaining("ccski state repair"),
    });

    // 实体与全部投影保持原样（零磁盘副作用）。
    expect(fs.existsSync(fixture.entityDir)).toBe(true);
    const projection = path.join(fixture.providerRoots["claude-code"], "guardless-skill");
    expect(fs.lstatSync(projection).isSymbolicLink()).toBe(true);
    // 投影不悬空（realpath 仍解析到实体）。
    expect(fs.realpathSync(projection)).toBe(fs.realpathSync(fixture.entityDir));
  });

  it("never falls back to a direct delete on the entity-library face when the state file is missing (P0-2 回归：缺失 state)", async () => {
    const fixture = await kernelFixture({ name: "lost-state-skill", projectTo: ["claude-code"] });
    fs.rmSync(fixture.statePath);
    const degraded = (await fixture.skills.list(fixture.targets.amp, true)).find(
      (row) => row.name === "lost-state-skill",
    );
    if (!degraded) throw new Error("Expected the entity through the amp (entity-root) face.");
    expect(degraded.ownership).toBe("unknown");
    const document = await fixture.skills.info(fixture.targets.amp, degraded.id);

    await expect(
      fixture.creator.remove(fixture.targets.amp, degraded.id, document.revision),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });

    expect(fs.existsSync(fixture.entityDir)).toBe(true);
    expect(fs.existsSync(path.join(fixture.providerRoots["claude-code"], "lost-state-skill"))).toBe(
      true,
    );
  });

  it("still direct-deletes plain directories on ordinary provider roots under a degraded state (P0-2 防线不外溢)", async () => {
    // 防线只针对实体库根 face：普通 provider root 上的 legacy 目录在 state 损坏
    // 时仍走既有直删（该目录无投影协议要守）。
    const fixture = await kernelFixture({ name: "bystander-skill", projectTo: [] });
    fs.writeFileSync(fixture.statePath, "{ not json", "utf8");
    const plainDir = path.join(fixture.providerRoots.openclaw, "plain-bystander");
    fs.mkdirSync(plainDir, { recursive: true });
    fs.writeFileSync(
      path.join(plainDir, "SKILL.md"),
      '---\nname: "plain-bystander"\ndescription: "Plain."\n---\n# plain\n',
      "utf8",
    );
    const skill = (await fixture.skills.list(fixture.targets.openclaw, true)).find(
      (row) => row.name === "plain-bystander",
    );
    if (!skill) throw new Error("Expected the plain directory skill.");
    const document = await fixture.skills.info(fixture.targets.openclaw, skill.id);

    await fixture.creator.remove(fixture.targets.openclaw, skill.id, document.revision);

    expect(fs.existsSync(plainDir)).toBe(false);
  });

  it("refuses the deletion when a forged state envelope points the entity record outside the entity library (P1-4 删除路由)", async () => {
    const fixture = await kernelFixture({ name: "forged-skill", projectTo: ["openclaw"] });
    // 伪造合法信封：实体记录 path 指向 workspace 外的目录。
    const outside = path.join(sandbox, "outside-forged");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(
      path.join(outside, "SKILL.md"),
      '---\nname: "forged-skill"\ndescription: "Forged."\n---\n# forged\n',
      "utf8",
    );
    const raw = JSON.parse(fs.readFileSync(fixture.statePath, "utf8")) as {
      entities: Record<string, unknown>;
    };
    const record = raw.entities["forged-skill"] as { path: string };
    record.path = outside;
    fs.writeFileSync(fixture.statePath, JSON.stringify(raw));

    await expect(
      removeCcskiEntity({
        workspaceDirectory: fixture.canonicalWorkspace,
        providerRoot: fixture.providerRoots.openclaw,
        skillName: "forged-skill",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    // 实体与投影原样未动。
    expect(fs.existsSync(fixture.entityDir)).toBe(true);
    expect(fs.existsSync(path.join(fixture.providerRoots.openclaw, "forged-skill"))).toBe(true);
  });

  it("treats a projection record with an unbound path as absent from the face (P1-4 删除路由)", async () => {
    const fixture = await kernelFixture({ name: "offpath-skill", projectTo: ["openclaw"] });
    // 伪造投影记录 path：不等于 rootPath/folderName（词法越界）。
    const raw = JSON.parse(fs.readFileSync(fixture.statePath, "utf8")) as {
      projections: Record<string, unknown>;
    };
    for (const value of Object.values(raw.projections)) {
      const record = value as { folderName?: string; path?: string };
      if (record.folderName === "offpath-skill") record.path = path.join(sandbox, "elsewhere");
    }
    fs.writeFileSync(fixture.statePath, JSON.stringify(raw));

    await expect(
      removeCcskiEntity({
        workspaceDirectory: fixture.canonicalWorkspace,
        providerRoot: fixture.providerRoots.openclaw,
        skillName: "offpath-skill",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fs.existsSync(fixture.entityDir)).toBe(true);
    expect(fs.existsSync(path.join(fixture.providerRoots.openclaw, "offpath-skill"))).toBe(true);
  });

  it("conflicts when the entity was concurrently updated after the delete request passed its revision check (P1-D 竞态 seam)", async () => {
    // 终审 P1-D 现场：creator 只在调用 remover 前验 UI revision；末投影
    // removeEntityProjections 不携带版本 → 校验通过后实体被并发换新，旧删除
    // 请求仍可删新实体。修复后（内核新契约 expectedEntityRevision，seam 注入）：
    // 宿主把观察时点 revision 传入内核 GC 退役，CAS 不一致 → GUARD_ENTITY →
    // conflict 有限词表，实体/投影原样。
    const fixture = await kernelFixture({ name: "racy-gc-skill", projectTo: ["openclaw"] });
    const skill = (await fixture.skills.list(fixture.targets.openclaw, true)).find(
      (row) => row.name === "racy-gc-skill",
    );
    if (!skill) throw new Error("Expected the projected skill.");
    const document = await fixture.skills.info(fixture.targets.openclaw, skill.id);
    // 观察时点基准 = creator 删除路径将读到的 state 实体 revision（P1-D 币种）。
    const observedRevision = observeCcskiEntityRevision({
      workspaceDirectory: fixture.canonicalWorkspace,
      skillName: "racy-gc-skill",
    });
    expect(observedRevision).toMatch(/^[0-9a-f]{16,}$/);

    const creator = createCreatorService(fixture.workspaces, fixture.skills, {
      store: createCreatorStoreService(fixture.workspaces),
      entityRemoveKernel: {
        // 模拟内核末投影 GC 退役 CAS：调用时点并发更新已换新 state 实体
        // revision；expectedEntityRevision（观察时点旧值）≠ 当前 state → GUARD_ENTITY。
        removeEntityProjections: async (options) => {
          const raw = JSON.parse(fs.readFileSync(fixture.statePath, "utf8")) as {
            entities: Record<string, { revision?: string }>;
          };
          raw.entities["racy-gc-skill"]!.revision = "concurrent-new-revision";
          fs.writeFileSync(fixture.statePath, JSON.stringify(raw));
          if (options.expectedEntityRevision !== observedRevision) {
            throw new Error(
              `host must pass the revision observed at delete-request time, got ${String(options.expectedEntityRevision)}`,
            );
          }
          return {
            kind: "error" as const,
            code: "GUARD_ENTITY" as const,
            message: "RAW KERNEL INTERNAL DETAIL must not leak",
          };
        },
        deleteEntity: async () => {
          throw new Error("unexpected deleteEntity call on a projected face");
        },
      },
    });

    await expect(
      creator.remove(fixture.targets.openclaw, skill.id, document.revision),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("ccski code: GUARD_ENTITY"),
    });
    // 实体/投影/state 记录原样（除模拟并发换新的 revision 字段），零磁盘副作用。
    expect(fs.existsSync(fixture.entityDir)).toBe(true);
    expect(
      fs.lstatSync(path.join(fixture.providerRoots.openclaw, "racy-gc-skill")).isSymbolicLink(),
    ).toBe(true);
    expect(entityRecordExists(fixture.statePath, "racy-gc-skill")).toBe(true);
    expect(projectionRecordsFor(fixture.statePath, "racy-gc-skill")).toBe(1);
  });

  it("prefers the delete-transaction observed revision over the routing mirror on the zero-projection deleteEntity path (P1-D seam 贯穿)", async () => {
    const fixture = await kernelFixture({ name: "observed-skill", projectTo: [] });
    let deleteReceived: string | undefined;
    const remover = createCcskiEntityRemover({
      deleteEntity: async (options) => {
        deleteReceived = options.expectedRevision;
        return { kind: "ok" as const, directoryDeleted: true };
      },
      removeEntityProjections: async () => {
        throw new Error("unexpected removeEntityProjections call");
      },
    });

    // 观察值 ≠ state 当前 revision（模拟：观察后 state 已被并发换新，路由镜像
    // 读到新值）——恒用观察值 = 更严的 CAS 基准，绝不放大窗口。
    await remover({
      workspaceDirectory: fixture.canonicalWorkspace,
      providerRoot: fixture.providerRoots.amp,
      skillName: "observed-skill",
      expectedEntityRevision: "observed-old-revision",
    });

    expect(deleteReceived).toBe("observed-old-revision");
    expect(deleteReceived).not.toBe(
      observeCcskiEntityRevision({
        workspaceDirectory: fixture.canonicalWorkspace,
        skillName: "observed-skill",
      }),
    );
  });

  it("prefers the delete-transaction observed revision on the entity-face GC retirement path (P1-D seam 贯穿)", async () => {
    const fixture = await kernelFixture({ name: "observed-gc-skill", projectTo: ["claude-code"] });
    let received: string | undefined;
    const remover = createCcskiEntityRemover({
      removeEntityProjections: async (options) => {
        received = options.expectedEntityRevision;
        return {
          kind: "ok" as const,
          entityRemoved: true,
          results: [
            {
              root: fixture.providerRoots["claude-code"],
              rootId: "root",
              path: path.join(fixture.providerRoots["claude-code"], "observed-gc-skill"),
              status: "removed" as const,
            },
          ],
          removed: 1,
          skipped: 0,
          failed: 0,
          gc: { attempted: true, entityDeleted: true, warnings: [] },
          generation: 2,
        };
      },
      deleteEntity: async () => {
        throw new Error("unexpected deleteEntity call with projections present");
      },
    });

    await remover({
      workspaceDirectory: fixture.canonicalWorkspace,
      providerRoot: fixture.providerRoots.amp,
      skillName: "observed-gc-skill",
      expectedEntityRevision: "observed-old-revision",
    });

    expect(received).toBe("observed-old-revision");
  });

  it("observes the state entity revision before the first-layer content check and returns null on degraded state (P1-D 观察面)", async () => {
    const setup = await kernelFixture({ name: "observe-skill", projectTo: [] });
    const revision = observeCcskiEntityRevision({
      workspaceDirectory: setup.canonicalWorkspace,
      skillName: "observe-skill",
    });
    // 与 state 实体记录同币种（folder hash hex）。
    expect(revision).toMatch(/^[0-9a-f]{16,}$/);
    const raw = JSON.parse(fs.readFileSync(setup.statePath, "utf8")) as {
      entities: Record<string, { revision?: string }>;
    };
    expect(revision).toBe(raw.entities["observe-skill"]!.revision);

    // 降级/缺失 state → null（不抛错；后续删除路由按同源镜像保守拒绝）。
    fs.writeFileSync(setup.statePath, "{ not json", "utf8");
    expect(
      observeCcskiEntityRevision({
        workspaceDirectory: setup.canonicalWorkspace,
        skillName: "observe-skill",
      }),
    ).toBeNull();
    fs.rmSync(setup.statePath);
    expect(
      observeCcskiEntityRevision({
        workspaceDirectory: setup.canonicalWorkspace,
        skillName: "observe-skill",
      }),
    ).toBeNull();
    // 实体记录缺席（未跟踪逻辑名）→ null。
    expect(
      observeCcskiEntityRevision({
        workspaceDirectory: setup.canonicalWorkspace,
        skillName: "never-registered-skill",
      }),
    ).toBeNull();
  });
});
