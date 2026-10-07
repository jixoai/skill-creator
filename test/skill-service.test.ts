/**
 * Skill service external-adapter tests.
 *
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decision [2026-07-21]: incompatible ccski responses never enter
 * a Workspace projection or masquerade as a successful validation.
 *
 * Orthogonal intents:
 *   [1] Discard incompatible third-party discovery entries.
 *   [2] Project an incompatible third-party validation result as a safe failure.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureEntity, projectEntity } from "ccski";
import { readStateDisabledRows } from "../src/daemon/ccski-state-disabled.js";
import { createSkillService } from "../src/daemon/skill-service.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import {
  GLOBAL_WORKSPACE_ID,
  ProviderIdSchema,
  type ImportedWorkspace,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
const codexTarget: WorkspaceProviderTarget = {
  workspaceId: GLOBAL_WORKSPACE_ID,
  providerId: ProviderIdSchema.parse("codex"),
};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-skill-service-test-"));
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

function discoveredSkill(directory: string): unknown {
  return {
    name: "valid-skill",
    description: "A valid third-party skill.",
    provider: "codex",
    location: "user",
    path: directory,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
  };
}

describe("skill service", () => {
  it("rejects toggling a symlinked entry with a typed conflict (self-skill-symlink)", async () => {
    // P1-3 守卫：rename 穿透 symlink 会改写 root 之外的链接目标（产品技能源/
    // 用户自有目录）；别名链（条目名 ≠ 目标名）也必须命中。
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(sandbox, "codex-home");
    try {
      const root = path.join(sandbox, "codex-home", "skills");
      const owned = path.join(sandbox, "owned-skill");
      fs.mkdirSync(path.join(owned, "references"), { recursive: true });
      fs.writeFileSync(
        path.join(owned, "SKILL.md"),
        "---\nname: linked-skill\ndescription: d\n---\nx\n",
      );
      fs.mkdirSync(root, { recursive: true });
      fs.symlinkSync(owned, path.join(root, "alias-entry"), "dir");
      const workspaces = createWorkspaceRegistry();
      const skills = createSkillService(workspaces, {
        discoverSkills: async () => [discoveredSkill(owned)],
      });
      const [skill] = await skills.list(codexTarget);
      if (!skill) throw new Error("Expected the linked discovery fixture.");

      const summary = await skills.toggle(codexTarget, [skill.id], "disable");
      expect(summary.results[0]!.status).toBe("conflict");
      expect(summary.conflicts).toBe(1);
      // 链接目标未被改写。
      expect(fs.existsSync(path.join(owned, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(owned, ".SKILL.md"))).toBe(false);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("discards incompatible ccski discovery entries", async () => {
    const validDirectory = path.join(sandbox, "valid-skill");
    fs.mkdirSync(validDirectory);
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => [discoveredSkill(validDirectory), { name: 42 }],
    });

    await expect(skills.list(codexTarget)).resolves.toMatchObject([
      { name: "valid-skill", path: fs.realpathSync(validDirectory) },
    ]);
  });

  it("projects an incompatible ccski validation result as a failed validation", async () => {
    const validDirectory = path.join(sandbox, "valid-skill");
    fs.mkdirSync(validDirectory);
    fs.writeFileSync(path.join(validDirectory, "SKILL.md"), "# Valid skill\n", "utf8");
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => [discoveredSkill(validDirectory)],
      validateSkill: async () => ({ success: "yes" }),
    });
    const [skill] = await skills.list(codexTarget);
    if (!skill) throw new Error("Expected the valid discovery fixture.");

    await expect(skills.validate(codexTarget, skill.id)).resolves.toEqual({
      skillId: skill.id,
      name: skill.name,
      success: false,
      errors: ["ccski returned an incompatible validation result."],
      warnings: [],
    });
  });
});

describe("skill service toggle dual routing (ccski-3-host-migration 批 2.3)", () => {
  const openClawProviderId = ProviderIdSchema.parse("openclaw");

  function writeSkillDocument(directory: string, name: string): string {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "SKILL.md"),
      `---\nname: ${JSON.stringify(name)}\ndescription: "Managed."\n---\n# ${name}\n`,
      "utf8",
    );
    return directory;
  }

  /** Imported Workspace + 内核实体 +（默认 link）投影；返回真实发现链的 service。 */
  async function workspaceWithKernelProjection(options: {
    mode: "link" | "materialized";
    name?: string;
  }): Promise<{
    skills: ReturnType<typeof createSkillService>;
    target: WorkspaceProviderTarget;
    workspace: ImportedWorkspace;
    providerRoot: string;
    entityDir: string;
    statePath: string;
  }> {
    const name = options.name ?? "managed-skill";
    const workspaceRoot = path.join(sandbox, "ws-managed");
    const providerRoot = path.join(workspaceRoot, "skills");
    fs.mkdirSync(providerRoot, { recursive: true });
    const source = writeSkillDocument(path.join(sandbox, "src", name), name);
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "managed");
    // 与生产链路同源：registry 解析出的 scope 恒为 canonical 路径（macOS
    // /private/var 前缀）；内核 rootId 按 resolve(root) 文本哈希，非 canonical
    // 输入会让 projection 记录与 toggle 的 rootId 失配（PROJECTION_NOT_FOUND）。
    const scope = workspaces.resolve(
      { workspaceId: workspace.id, providerId: openClawProviderId },
      true,
    );
    const canonicalWorkspace = scope.workspaceDirectory ?? workspaceRoot;
    const canonicalProviderRoot = scope.directory;
    const ensured = await ensureEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      source: { dir: source },
    });
    if (ensured.kind !== "ok") throw new Error(`ensureEntity failed: ${JSON.stringify(ensured)}`);
    const projected = await projectEntity(
      options.mode === "materialized"
        ? {
            scope: "project",
            workspaceDir: canonicalWorkspace,
            name,
            roots: [canonicalProviderRoot],
            mode: "materialized",
            reason: "user-request",
          }
        : {
            scope: "project",
            workspaceDir: canonicalWorkspace,
            name,
            roots: [canonicalProviderRoot],
          },
    );
    if (projected.kind !== "ok")
      throw new Error(`projectEntity failed: ${JSON.stringify(projected)}`);
    return {
      skills: createSkillService(workspaces),
      target: { workspaceId: workspace.id, providerId: openClawProviderId },
      workspace,
      // canonical provider root（= scope.directory；内核投影与发现面同源路径形态）。
      providerRoot: canonicalProviderRoot,
      entityDir: path.join(canonicalWorkspace, ".agents", "skills", name),
      // 内核 project scope 的 state 文件（批 3.2 补充面读取处）。
      statePath: path.join(canonicalWorkspace, ".agents", ".ccski-state.json"),
    };
  }

  it("disables a ccski link projection by unlinking (物理摘链) and keeps the entity intact", async () => {
    const { skills, target, providerRoot, entityDir } = await workspaceWithKernelProjection({
      mode: "link",
    });
    const [skill] = await skills.list(target, true);
    if (!skill) throw new Error("Expected the projected skill in discovery.");
    expect(skill).toMatchObject({ ownership: "ccski", entryKind: "symlink" });
    // 批 3.3 四名区分：path = canonical 实体路径；projectionPath = provider root
    // 下的投影（链接）路径。批 3.1 退役 wrapper 的形状保证在此钉住（provider/
    // location/sourceKind/sourcePriority 与发现面 customDir 形状一致）。
    expect(skill.path).toBe(fs.realpathSync(entityDir));
    expect(skill.projectionPath).toBe(path.join(providerRoot, "managed-skill"));
    expect(skill).toMatchObject({
      provider: "openclaw",
      location: "user",
      sourceKind: "custom",
      sourcePriority: 500,
    });

    const summary = await skills.toggle(target, [skill.id], "disable");
    expect(summary.succeeded).toBe(1);
    // 物理禁用：链不在了（该 root 的文件系发现面消失——由批 3.2 state 补充面接回）。
    expect(fs.existsSync(path.join(providerRoot, "managed-skill"))).toBe(false);
    // 共享实体永不换名、原样在场。
    expect(fs.existsSync(path.join(entityDir, "SKILL.md"))).toBe(true);

    // 批 3.2：禁用后列表仍见 disabled 补充行（state 记录 + 实体内容源；同一 id）。
    const [disabledRow] = await skills.list(target, true);
    expect(disabledRow).toBeDefined();
    expect(disabledRow).toMatchObject({
      id: skill.id,
      name: "managed-skill",
      disabled: true,
      ownership: "ccski",
      path: fs.realpathSync(entityDir),
      projectionPath: path.join(providerRoot, "managed-skill"),
    });
    // 补充行详情可读（实体恒保持 enabled 形态 SKILL.md；skillFile 对侧回退）。
    const info = await skills.info(target, disabledRow!.id);
    expect(info.content).toContain("managed-skill");

    // 补充面只在 disabled 请求面出现（includeDisabled=false 不补）。
    const enabledOnly = await skills.list(target, false);
    expect(enabledOnly.find((row) => row.id === skill.id)).toBeUndefined();

    // 同一 RPC 面上 re-enable 经补充行闭合（批 2 遗留边界解除）。
    const enableAgain = await skills.toggle(target, [disabledRow!.id], "enable");
    expect(enableAgain.succeeded).toBe(1);
    expect(fs.existsSync(path.join(providerRoot, "managed-skill", "SKILL.md"))).toBe(true);
    const [reEnabled] = await skills.list(target, true);
    expect(reEnabled).toMatchObject({ id: skill.id, disabled: false, entryKind: "symlink" });
  });

  it("degrades a corrupt ccski state file to zero supplementation without failing the list", async () => {
    const { skills, target, providerRoot, statePath } = await workspaceWithKernelProjection({
      mode: "link",
    });
    const [skill] = await skills.list(target, true);
    if (!skill) throw new Error("Expected the projected skill in discovery.");
    await skills.toggle(target, [skill.id], "disable");

    // 数据不兼容（坏 JSON）→ 零补充降级不计错：列表成功、补充行缺席。
    fs.writeFileSync(statePath, "{ not json", "utf8");
    const rows = await skills.list(target, true);
    expect(rows.find((row) => row.id === skill.id)).toBeUndefined();
    expect(fs.existsSync(path.join(providerRoot, "managed-skill"))).toBe(false);
  });

  it("disables and re-enables a ccski materialized projection through the kernel", async () => {
    const { skills, target, providerRoot, entityDir } = await workspaceWithKernelProjection({
      mode: "materialized",
    });
    const [skill] = await skills.list(target, true);
    if (!skill) throw new Error("Expected the materialized projection in discovery.");
    expect(skill).toMatchObject({ ownership: "ccski", entryKind: "directory" });

    const disabled = await skills.toggle(target, [skill.id], "disable");
    expect(disabled.succeeded).toBe(1);
    expect(fs.existsSync(path.join(providerRoot, "managed-skill", ".SKILL.md"))).toBe(true);
    // 实体保持 enabled 形态（link 面 SKILL.md 永不换名；物化摘名只发生在副本上）。
    expect(fs.existsSync(path.join(entityDir, "SKILL.md"))).toBe(true);

    const [listedDisabled] = await skills.list(target, true);
    expect(listedDisabled?.disabled).toBe(true);

    const enabled = await skills.toggle(target, [skill.id], "enable");
    expect(enabled.succeeded).toBe(1);
    expect(fs.existsSync(path.join(providerRoot, "managed-skill", "SKILL.md"))).toBe(true);
  });

  it("keeps the legacy file-rename path for non-ccski plain directory skills", async () => {
    const workspaceRoot = path.join(sandbox, "ws-plain");
    const skillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "plain-skill"),
      "plain-skill",
    );
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "plain");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openClawProviderId,
    };
    const skills = createSkillService(workspaces);
    const [skill] = await skills.list(target, true);
    if (!skill) throw new Error("Expected the plain skill in discovery.");
    expect(skill.ownership === undefined || skill.ownership === "unknown").toBe(true);

    const summary = await skills.toggle(target, [skill.id], "disable");
    expect(summary.succeeded).toBe(1);
    expect(fs.existsSync(path.join(skillDir, ".SKILL.md"))).toBe(true);
  });

  it("maps kernel typed errors to conflict outcomes without leaking kernel messages (enable conflict)", async () => {
    const skillDir = writeSkillDocument(path.join(sandbox, "entry"), "mapped-skill");
    const cases: Array<{
      code: "GUARD_PROJECTION" | "ENTITY_REVISED" | "FOREIGN_OWNERSHIP";
      expected: string;
    }> = [
      { code: "GUARD_PROJECTION", expected: "conflict" },
      { code: "ENTITY_REVISED", expected: "conflict" },
      { code: "FOREIGN_OWNERSHIP", expected: "conflict" },
    ];
    for (const testCase of cases) {
      const workspaces = createWorkspaceRegistry();
      const skills = createSkillService(workspaces, {
        discoverSkills: async () => [
          {
            ...discoveredSkill(skillDir),
            ownership: "ccski" as const,
            entryKind: "symlink" as const,
          },
        ],
        entityToggle: async () => ({
          kind: "error" as const,
          code: testCase.code,
          message: "RAW KERNEL INTERNAL DETAIL must not leak",
        }),
      });
      const [skill] = await skills.list(codexTarget);
      if (!skill) throw new Error("Expected the mapped skill fixture.");
      const summary = await skills.toggle(codexTarget, [skill.id], "enable");
      expect(summary.results[0]).toMatchObject({ status: testCase.expected });
      expect(summary.results[0]?.error).toContain(`ccski code: ${testCase.code}`);
      expect(summary.results[0]?.error).not.toContain("RAW KERNEL INTERNAL DETAIL");
      expect(summary.conflicts).toBe(1);
    }
  });

  it("routes entity-local kernel skips to the skipped outcome", async () => {
    const skillDir = writeSkillDocument(path.join(sandbox, "entry"), "local-skill");
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => [
        {
          ...discoveredSkill(skillDir),
          ownership: "ccski" as const,
          entryKind: "directory" as const,
        },
      ],
      entityToggle: async () => ({
        kind: "ok" as const,
        action: "disable" as const,
        status: "skipped" as const,
        mode: "entity-local" as const,
        path: skillDir,
        disabled: false,
        targetKind: "entity" as const,
        reason: "canonical-root" as const,
        generation: 1,
        warnings: [],
      }),
    });
    const [skill] = await skills.list(codexTarget);
    if (!skill) throw new Error("Expected the local skill fixture.");
    const summary = await skills.toggle(codexTarget, [skill.id], "disable");
    expect(summary.results[0]).toMatchObject({ status: "skipped" });
    expect(summary.succeeded).toBe(0);
  });
});

describe("skill service discovery cache (perf-firstscreen B-6)", () => {
  /**
   * 用户原始需求 [2026-09-18]：「性能很差，经常 loading」——同 target 的
   * list/resolve/info/toggle/validate 原本各自重跑整 root discovery；读链路
   * 复用短 TTL 结果，toggle 成功后必须失效。
   */
  it("shares one in-flight discovery across concurrent reads of the same target", async () => {
    const validDirectory = path.join(sandbox, "cached-skill");
    fs.mkdirSync(validDirectory);
    fs.writeFileSync(path.join(validDirectory, "SKILL.md"), "# cached\n", "utf8");
    let discoveries = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => {
        discoveries += 1;
        await gate;
        return [discoveredSkill(validDirectory)];
      },
    });
    const pending = [
      skills.list(codexTarget),
      skills.list(codexTarget),
      skills.resolve(codexTarget, "pending" as unknown as never),
    ];
    release();
    const [first, second] = await Promise.allSettled(pending);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    expect(discoveries).toBe(1);
  });

  it("invalidates the cache after a successful toggle", async () => {
    const skillDir = path.join(sandbox, "toggle-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# toggle\n", "utf8");
    let disabled = false;
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => [{ ...discoveredSkill(skillDir), disabled }],
    });
    const [first] = await skills.list(codexTarget);
    if (!first) throw new Error("Expected the toggle fixture.");
    expect(first.disabled).toBe(false);

    // toggle 读到旧态（disabled=false）→ rename 记账 succeeded；随后桩重放
    // rename 后的新磁盘态，toggle 完成后的读必须看到它（invalidate 生效）。
    const summary = await skills.toggle(codexTarget, [first.id], "disable");
    expect(summary.succeeded).toBe(1);
    disabled = true;

    const [after] = await skills.list(codexTarget);
    if (!after) throw new Error("Expected the post-toggle fixture.");
    expect(after.disabled).toBe(true);
  });
});

describe("skill service discovery invalidation (codex perf-review P1-1 core)", () => {
  it("a read after invalidateDiscovery rescans even while an older discovery is still in flight", async () => {
    const skillDir = path.join(sandbox, "invalidated-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# inv\n", "utf8");
    const seen: boolean[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      // 每次调用记录当时磁盘上是否有新文档；第一次调用被 gate 住（在途）。
      discoverSkills: async () => {
        seen.push(fs.existsSync(path.join(skillDir, "SKILL.md")));
        await gate;
        return [discoveredSkill(skillDir)];
      },
    });

    const stale = skills.list(codexTarget); // 在途（安装前的旧快照语境）
    fs.writeFileSync(path.join(skillDir, "extra.md"), "installed\n", "utf8");
    skills.invalidateDiscovery(codexTarget); // repository install 落盘后
    const fresh = skills.list(codexTarget); // 必须重新 discovery
    release();
    await Promise.all([stale, fresh]);
    expect(seen.length).toBe(2); // 两次独立扫描，无跨请求复用
  });
});

describe("state-backed disabled supplementation path binding (宿主修复批 6 P1-4)", () => {
  const openClawProviderId = ProviderIdSchema.parse("openclaw");

  /** 伪造 state 信封 + 实体库 fixture；返回可改写的信封对象与路径锚点。 */
  function forgedStateFixture(options: { entityPath?: string; projectionPath?: string }) {
    const workspaceRoot = path.join(sandbox, "ws-forged");
    const stateBase = path.join(workspaceRoot, ".agents");
    const providerRoot = path.join(workspaceRoot, "skills");
    const entityLibrary = path.join(stateBase, "skills");
    const folder = "forged-skill";
    // 实体库内合法目录（默认实体路径锚点）。
    const entityDir = path.join(entityLibrary, folder);
    fs.mkdirSync(entityDir, { recursive: true });
    fs.writeFileSync(
      path.join(entityDir, "SKILL.md"),
      `---\nname: "forged-skill"\ndescription: "Real entity."\n---\n# forged\n`,
      "utf8",
    );
    const envelope = {
      schemaVersion: 1,
      generation: 1,
      entities: {
        [folder]: {
          kind: "entity",
          scope: "project",
          logicalName: "forged-skill",
          folderName: folder,
          path: options.entityPath ?? entityDir,
          revision: "0".repeat(64),
        },
      },
      projections: {
        root0: {
          kind: "projection",
          scope: "project",
          rootId: "root0",
          rootPath: providerRoot,
          folderName: folder,
          logicalName: "forged-skill",
          path: options.projectionPath ?? path.join(providerRoot, folder),
          mode: "link",
          entityRevision: "0".repeat(64),
          disabled: true,
          ownership: "ccski",
        },
      },
    };
    fs.mkdirSync(stateBase, { recursive: true });
    fs.writeFileSync(path.join(stateBase, ".ccski-state.json"), JSON.stringify(envelope), "utf8");
    return { stateBase, providerRoot, entityLibrary, entityDir, folder, envelope };
  }

  it("drops the row when a forged entity record points outside the entity library", async () => {
    // 伪造合法信封把实体路径指到 workspace 外 → 不得产出 disabled 补充行
    // （否则 skills.list 出伪造行、skills.info 读任意 SKILL.md）。
    const outside = path.join(sandbox, "outside-entity");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(
      path.join(outside, "SKILL.md"),
      `---\nname: "forged-skill"\ndescription: "Outside."\n---\n# outside\n`,
      "utf8",
    );
    const fixture = forgedStateFixture({ entityPath: outside });
    const rows = readStateDisabledRows({
      providerRoot: fixture.providerRoot,
      stateBase: fixture.stateBase,
      providerId: openClawProviderId,
      seenCanonicalPaths: new Set(),
    });
    expect(rows).toEqual([]);
  });

  it("drops the row when the entity directory is an in-library symlink to an outside directory", async () => {
    // 词法合法（<stateBase>/skills/<folderName>）但 realpath 逃逸 → 拒绝。
    const fixture = forgedStateFixture({});
    const outside = path.join(sandbox, "symlink-target");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(
      path.join(outside, "SKILL.md"),
      `---\nname: "forged-skill"\ndescription: "Linked out."\n---\n# out\n`,
      "utf8",
    );
    fs.rmSync(fixture.entityDir, { recursive: true, force: true });
    fs.symlinkSync(outside, fixture.entityDir);
    const rows = readStateDisabledRows({
      providerRoot: fixture.providerRoot,
      stateBase: fixture.stateBase,
      providerId: openClawProviderId,
      seenCanonicalPaths: new Set(),
    });
    expect(rows).toEqual([]);
  });

  it("drops the row when the entity SKILL.md is a symbolic link to an outside file", async () => {
    const fixture = forgedStateFixture({});
    const outsideDoc = path.join(sandbox, "outside-SKILL.md");
    fs.writeFileSync(
      outsideDoc,
      `---\nname: "forged-skill"\ndescription: "Linked doc."\n---\n# out\n`,
      "utf8",
    );
    fs.rmSync(path.join(fixture.entityDir, "SKILL.md"));
    fs.symlinkSync(outsideDoc, path.join(fixture.entityDir, "SKILL.md"));
    const rows = readStateDisabledRows({
      providerRoot: fixture.providerRoot,
      stateBase: fixture.stateBase,
      providerId: openClawProviderId,
      seenCanonicalPaths: new Set(),
    });
    expect(rows).toEqual([]);
  });

  it("drops the row when the recorded projection path is not the registered root's direct child", async () => {
    const fixture = forgedStateFixture({
      projectionPath: path.join(sandbox, "elsewhere-projection"),
    });
    const rows = readStateDisabledRows({
      providerRoot: fixture.providerRoot,
      stateBase: fixture.stateBase,
      providerId: openClawProviderId,
      seenCanonicalPaths: new Set(),
    });
    expect(rows).toEqual([]);
  });

  it("keeps supplementing a bound record (对照：合法信封仍产出行)", async () => {
    const fixture = forgedStateFixture({});
    const rows = readStateDisabledRows({
      providerRoot: fixture.providerRoot,
      stateBase: fixture.stateBase,
      providerId: openClawProviderId,
      seenCanonicalPaths: new Set(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "forged-skill",
      disabled: true,
      ownership: "ccski",
      path: fs.realpathSync(fixture.entityDir),
    });
  });
});
