/**
 * 存量 wiki 根一次性迁移（wiki-directory-standard tasks 1.2，2026-09-22 Owner 裁决）。
 *
 * User input [2026-09-22]: "存量 ~/.skill-wiki/~ 与 ~/.skill-creator/wiki/~ → 新 global；
 * slug 存量经旧登记表 + registry 映射搬入 workspace 目录；冲突保守拒绝；孤儿列出。"
 * Orthogonal intents:
 *   [1] 三源 × 目标占用 × dry-run/apply 的纯函数面（migrateWikiRoots 注入根路径）：
 *       中央根 `~`/slug/ws_*、侧车 `~`/ws_*；dry-run 零写入；apply 同卷 rename 落位。
 *   [2] 保守语义：目标非空 = conflict 拒绝（不覆盖任何一边）；无映射 slug = orphan
 *       列出；未注册 ws = unknown-workspace；空源 = empty-source；登记表不兼容降级
 *       为孤儿列出；幂等（目标已有数据 = no-op 报告）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateWikiRoots, type MigrationWorkspace } from "../scripts/migrate-wiki-roots.sh.ts";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-roots-migration-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

const WS_A = "ws_" + "a".repeat(24);
const WS_B = "ws_" + "b".repeat(24);

/** 造一个有内容的 wiki scope 目录（返回目录路径）。 */
function seedWikiScope(parent: string, scope: string, pageName: string): string {
  const dir = path.join(parent, scope);
  fs.mkdirSync(path.join(dir, "patterns"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "patterns", `${pageName}.md`),
    [
      "---",
      `title: ${pageName}`,
      "created: 2026-09-22T00:00:00.000Z",
      "updated: 2026-09-22T00:00:00.000Z",
      "origin: ~",
      "promotedFrom:",
      "---",
      "",
      `body of ${pageName}`,
    ].join("\n"),
    "utf8",
  );
  return dir;
}

function seedWorkspaces(
  sandbox: string,
  entries: { id: string; name: string }[],
): {
  workspaces: MigrationWorkspace[];
  byId: Record<string, string>;
} {
  const workspaces: MigrationWorkspace[] = [];
  const byId: Record<string, string> = {};
  for (const entry of entries) {
    const dir = path.join(sandbox, entry.name);
    fs.mkdirSync(dir, { recursive: true });
    workspaces.push({ id: entry.id, path: dir });
    byId[entry.id] = dir;
  }
  return { workspaces, byId };
}

/** 标准装配：sandbox 内三根 + registry。 */
function fixture(entries: { id: string; name: string }[]) {
  const sandbox = makeTempDir();
  const centralRoot = path.join(sandbox, "central");
  const sidecarRoot = path.join(sandbox, "sidecar-wiki");
  const globalTarget = path.join(sandbox, "home", ".agents", "skill-wiki");
  const { workspaces, byId } = seedWorkspaces(sandbox, entries);
  return { sandbox, centralRoot, sidecarRoot, globalTarget, workspaces, byId };
}

describe("central-root sources (~, slug via legacy table, ws_* digest)", () => {
  it("plans the global scope and slug workspaces, writing nothing in dry-run", () => {
    const fx = fixture([
      { id: WS_A, name: "proj-a" },
      { id: WS_B, name: "proj-b" },
    ]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    const globalSource = seedWikiScope(fx.centralRoot, "~", "global-insight");
    fs.writeFileSync(
      path.join(fx.centralRoot, "scopes.json"),
      JSON.stringify({ schemaVersion: 1, assignments: { [WS_A]: "proj-a", [WS_B]: "proj-b" } }),
      "utf8",
    );
    const slugSource = seedWikiScope(fx.centralRoot, "proj-a", "a-insight");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: false,
    });

    expect(report.applied).toBe(false);
    expect(report.moved).toBe(0);
    expect(report.actions).toHaveLength(2);
    expect(report.actions.map((action) => action.source).sort()).toEqual(
      [globalSource, slugSource].sort(),
    );
    const globalAction = report.actions.find((action) => action.scope === "~");
    const slugAction = report.actions.find((action) => action.scope === "proj-a");
    expect(globalAction?.target).toBe(fx.globalTarget);
    expect(globalAction?.workspaceId).toBeUndefined();
    expect(slugAction?.target).toBe(path.join(fx.byId[WS_A], ".agents", "skill-wiki"));
    expect(slugAction?.workspaceId).toBe(WS_A);
    expect(slugAction?.sourceLayout).toBe("central-root");
    // dry-run 零写入：源与目标都原样。
    expect(fs.existsSync(globalSource)).toBe(true);
    expect(fs.existsSync(fx.globalTarget)).toBe(false);
  });

  it("applies the plan: data lands at the new global address and inside workspace directories", () => {
    const fx = fixture([{ id: WS_A, name: "proj-a" }]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    seedWikiScope(fx.centralRoot, "~", "global-insight");
    fs.writeFileSync(
      path.join(fx.centralRoot, "scopes.json"),
      JSON.stringify({ schemaVersion: 1, assignments: { [WS_A]: "proj-a" } }),
      "utf8",
    );
    seedWikiScope(fx.centralRoot, "proj-a", "a-insight");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(2);
    expect(fs.existsSync(path.join(fx.globalTarget, "patterns", "global-insight.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(fx.byId[WS_A], ".agents", "skill-wiki", "patterns", "a-insight.md")),
    ).toBe(true);
    // 源被搬走（rename 语义）；scopes.json 留在原处（退役档案，人工清理）。
    expect(fs.existsSync(path.join(fx.centralRoot, "~"))).toBe(false);
    expect(fs.existsSync(path.join(fx.centralRoot, "proj-a"))).toBe(false);
    expect(fs.existsSync(path.join(fx.centralRoot, "scopes.json"))).toBe(true);
  });

  it("accepts ws_* digest scope directories directly (pre-slug era leftovers)", () => {
    const fx = fixture([{ id: WS_A, name: "proj-a" }]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    seedWikiScope(fx.centralRoot, WS_A, "digest-insight");
    // 无登记表也必须迁：ws_* 直连 registry id。

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(1);
    expect(
      fs.existsSync(
        path.join(fx.byId[WS_A], ".agents", "skill-wiki", "patterns", "digest-insight.md"),
      ),
    ).toBe(true);
  });
});

describe("sidecar source (~/.skill-creator/wiki, slice-2 layout)", () => {
  it("migrates sidecar ~ and ws_* directories through the registry", () => {
    const fx = fixture([{ id: WS_A, name: "proj-a" }]);
    fs.mkdirSync(fx.sidecarRoot, { recursive: true });
    seedWikiScope(fx.sidecarRoot, "~", "sidecar-global");
    seedWikiScope(fx.sidecarRoot, WS_A, "sidecar-ws");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(2);
    expect(fs.existsSync(path.join(fx.globalTarget, "patterns", "sidecar-global.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(fx.byId[WS_A], ".agents", "skill-wiki", "patterns", "sidecar-ws.md")),
    ).toBe(true);
    expect(report.actions.every((action) => action.sourceLayout === "sidecar")).toBe(true);
  });

  it("central root wins the shared target; the sidecar copy is refused as a conflict", () => {
    const fx = fixture([{ id: WS_A, name: "proj-a" }]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    fs.mkdirSync(fx.sidecarRoot, { recursive: true });
    seedWikiScope(fx.centralRoot, "~", "fresh-global");
    seedWikiScope(fx.sidecarRoot, "~", "stale-global");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(1);
    expect(fs.existsSync(path.join(fx.globalTarget, "patterns", "fresh-global.md"))).toBe(true);
    const conflict = report.notices.find((notice) => notice.kind === "conflict");
    expect(conflict?.source).toBe(path.join(fx.sidecarRoot, "~"));
    // 冲突双方原样保留（不覆盖、不删除）。
    expect(fs.existsSync(path.join(fx.sidecarRoot, "~", "patterns", "stale-global.md"))).toBe(true);
  });

  it("reports the unified-root compat symlink as a no-op source", () => {
    const fx = fixture([]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    fs.mkdirSync(path.dirname(fx.sidecarRoot), { recursive: true });
    fs.symlinkSync(fx.centralRoot, fx.sidecarRoot, "dir");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.actions).toHaveLength(0);
    expect(report.notices.map((notice) => notice.kind)).toContain("symlink-source");
    expect(fs.lstatSync(fx.sidecarRoot).isSymbolicLink()).toBe(true);
  });
});

describe("conservative refusals and idempotency", () => {
  it("refuses a non-empty target and keeps both sides untouched", () => {
    const fx = fixture([{ id: WS_A, name: "proj-a" }]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    const source = seedWikiScope(fx.centralRoot, "~", "migrating-global");
    // 目标已有数据（已迁移/手工新建）。
    fs.mkdirSync(path.join(fx.globalTarget, "patterns"), { recursive: true });
    fs.writeFileSync(path.join(fx.globalTarget, "patterns", "existing.md"), "x\n", "utf8");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(0);
    expect(report.actions).toHaveLength(0);
    expect(report.notices.map((notice) => notice.kind)).toContain("conflict");
    expect(fs.existsSync(path.join(source, "patterns", "migrating-global.md"))).toBe(true);
    expect(fs.existsSync(path.join(fx.globalTarget, "patterns", "existing.md"))).toBe(true);
  });

  it("merges into an existing but empty target directory", () => {
    const fx = fixture([]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    seedWikiScope(fx.centralRoot, "~", "fill-me");
    fs.mkdirSync(fx.globalTarget, { recursive: true }); // 空目标占位。

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(1);
    expect(fs.existsSync(path.join(fx.globalTarget, "patterns", "fill-me.md"))).toBe(true);
  });

  it("is idempotent: a second run after apply is a no-op report", () => {
    const fx = fixture([]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    seedWikiScope(fx.centralRoot, "~", "once");

    const options = {
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    } as const;
    const first = migrateWikiRoots(options);
    expect(first.moved).toBe(1);

    const second = migrateWikiRoots(options);
    expect(second.moved).toBe(0);
    expect(second.actions).toHaveLength(0);
    expect(fs.existsSync(path.join(fx.globalTarget, "patterns", "once.md"))).toBe(true);
  });

  it("lists orphan slug directories and unknown workspaces without moving them", () => {
    const fx = fixture([{ id: WS_A, name: "proj-a" }]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    fs.writeFileSync(
      path.join(fx.centralRoot, "scopes.json"),
      JSON.stringify({ schemaVersion: 1, assignments: { [WS_A]: "proj-a", [WS_B]: "forgotten" } }),
      "utf8",
    );
    const orphan = seedWikiScope(fx.centralRoot, "mystery-slug", "orphan-page");
    const forgotten = seedWikiScope(fx.centralRoot, "forgotten", "gone-page"); // WS_B 未注册。

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(0);
    const kinds = report.notices.map((notice) => notice.kind);
    expect(kinds).toContain("orphan");
    expect(kinds).toContain("unknown-workspace");
    expect(fs.existsSync(path.join(orphan, "patterns", "orphan-page.md"))).toBe(true);
    expect(fs.existsSync(path.join(forgotten, "patterns", "gone-page.md"))).toBe(true);
  });

  it("degrades an incompatible scopes.json to orphans instead of guessing", () => {
    const fx = fixture([{ id: WS_A, name: "proj-a" }]);
    fs.mkdirSync(fx.centralRoot, { recursive: true });
    fs.writeFileSync(path.join(fx.centralRoot, "scopes.json"), "{ not json", "utf8");
    seedWikiScope(fx.centralRoot, "proj-a", "unmappable");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(0);
    expect(report.notices.map((notice) => notice.kind)).toContain("incompatible-input");
    expect(report.notices.map((notice) => notice.kind)).toContain("orphan");
    expect(fs.existsSync(path.join(fx.centralRoot, "proj-a", "patterns", "unmappable.md"))).toBe(
      true,
    );
  });

  it("skips empty source directories and reports the derived search-index leftover", () => {
    const fx = fixture([]);
    fs.mkdirSync(path.join(fx.centralRoot, "~"), { recursive: true }); // 空 global 源。
    fs.mkdirSync(path.join(fx.centralRoot, "search-index", "~"), { recursive: true });
    fs.writeFileSync(path.join(fx.centralRoot, "search-index", "envelope.json"), "{}", "utf8");

    const report = migrateWikiRoots({
      centralRoot: fx.centralRoot,
      sidecarRoot: fx.sidecarRoot,
      globalTarget: fx.globalTarget,
      workspaces: fx.workspaces,
      apply: true,
    });

    expect(report.moved).toBe(0);
    const kinds = report.notices.map((notice) => notice.kind);
    expect(kinds).toContain("empty-source");
    expect(kinds).toContain("derived-leftover");
    // 派生物不删不动。
    expect(fs.existsSync(path.join(fx.centralRoot, "search-index", "envelope.json"))).toBe(true);
  });
});
