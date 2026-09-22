/**
 * wiki workspaceId → workspace 目录映射（目录映射标准 2026-09-22 Owner 裁决重写；
 * slug 登记表与旧根迁移测试随机制退役——迁移工具测试见 wiki-roots-migration.test.ts）。
 *
 * User ruling [2026-09-22]: "wiki 从中央根按名字分目录改为目录自身的属性——
 * <dir>/.agents/skill-wiki/；global 是 `~` 特例；registry workspace 的 wiki 与
 * workspace 目录同居。"
 * Orthogonal intents:
 *   [1] 解析与注册闸：`~` → globalWikiDirectory（SKILL_WIKI_HOME 覆盖）；ws_* →
 *       registry lookup 携带 path → <dir>/.agents/skill-wiki；未注册 typed
 *       NOT_FOUND。origin 足迹 = "~" 或 workspace 目录绝对路径。
 *   [2] 生命周期（新语义）：forget 后 wiki 数据留在 workspace 目录原地（wiki 是
 *       目录的属性，不是 registry 的）；同目录 re-import 直达同一份 patterns；
 *       同 label 的两个 workspace 目录天然不冲突（slug 名字空间问题从根上消失）。
 *   [3] 宿主与 CLI 同根：daemon 写入 <dir>/.agents/skill-wiki 后，CLI 以
 *       --workspace <dir> 读到同一物理目录。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import { createWikiService } from "../src/daemon/wiki-service.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { runCli } from "../packages/skill-wiki/src/cli.js";
import type { WorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import type { WorkspaceId } from "../src/shared/contracts/workspaces.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-mapping-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

const previousWikiHome = process.env.SKILL_WIKI_HOME;
let globalHome = "";
beforeEach(() => {
  globalHome = makeTempDir();
  process.env.SKILL_WIKI_HOME = globalHome;
});
afterEach(() => {
  if (previousWikiHome === undefined) delete process.env.SKILL_WIKI_HOME;
  else process.env.SKILL_WIKI_HOME = previousWikiHome;
});

/** workspace 目录桩 registry（目录注入构造；lookup/listImported 携带 path）。 */
function stubRegistry(
  entries: { id: WorkspaceId; label: string; path: string }[],
): Pick<WorkspaceRegistry, "lookup" | "listImported"> {
  return {
    lookup: (id) => entries.find((entry) => entry.id === id) ?? null,
    listImported: () => entries,
  };
}

describe("workspaceId → directory mapping", () => {
  it("co-locates the wiki with the workspace directory and stamps origin with its absolute path", () => {
    const workspaceA = makeTempDir();
    const workspaceB = makeTempDir();
    const service = createWikiService(
      stubRegistry([
        { id: "ws_" + "a".repeat(24), label: "dup workspace", path: workspaceA },
        { id: "ws_" + "b".repeat(24), label: "dup workspace", path: workspaceB },
      ]),
    );
    const first = service.append("ws_" + "a".repeat(24), { title: "In A", body: "a-body" });
    const second = service.append("ws_" + "b".repeat(24), { title: "In B", body: "b-body" });

    // 同 label 双注册天然两个不同物理 wiki——slug 消歧问题不存在。
    expect(
      fs.existsSync(path.join(workspaceA, ".agents", "skill-wiki", "patterns", "in-a.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceB, ".agents", "skill-wiki", "patterns", "in-b.md")),
    ).toBe(true);
    expect(first.item.origin).toBe(workspaceA);
    expect(second.item.origin).toBe(workspaceB);
    // global 与 workspace 互不重叠。
    expect(fs.existsSync(path.join(globalHome, "patterns"))).toBe(false);
  });

  it("resolves `~` through SKILL_WIKI_HOME", () => {
    const service = createWikiService(stubRegistry([]));
    service.append("~", { title: "Global insight", body: "g" });
    expect(fs.existsSync(path.join(globalHome, "patterns", "global-insight.md"))).toBe(true);
  });

  it("keeps the registry gate: an unregistered ws_* is typed NOT_FOUND", () => {
    const service = createWikiService(stubRegistry([]));
    try {
      service.list("ws_" + "9".repeat(24));
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("NOT_FOUND");
    }
  });
});

describe("wiki lifecycle across forget / re-import (directory-owned)", () => {
  const previousHome = process.env.SKILL_CREATOR_HOME;
  let sandbox = "";

  beforeEach(() => {
    sandbox = makeTempDir();
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
    setHomeOverride(path.join(sandbox, "state"));
  });
  afterEach(() => {
    setHomeOverride(null);
    if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
    else process.env.SKILL_CREATOR_HOME = previousHome;
  });

  it("keeps wiki data in the workspace directory after forget; re-import reaches the same pages", () => {
    const registry = createWorkspaceRegistry({ listSkills: () => Promise.resolve([]) });
    const projectDir = path.join(sandbox, "proj");
    fs.mkdirSync(projectDir, { recursive: true });
    const imported = registry.import(projectDir, "My Project");

    const withImport = createWikiService(registry);
    withImport.append(imported.id, { title: "Persisted", body: "p" });
    const wikiPage = path.join(projectDir, ".agents", "skill-wiki", "patterns", "persisted.md");
    expect(fs.existsSync(wikiPage)).toBe(true);

    // forget：registry 不再认识该 workspace（闸生效），但 wiki 数据是目录的属性，
    // 原样留在 workspace 目录——不存在登记表释放/顶替问题。
    registry.forget(imported.id);
    try {
      withImport.list(imported.id);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as DomainError).code).toBe("NOT_FOUND");
    }
    expect(fs.existsSync(wikiPage)).toBe(true);

    // 同目录 re-import：直达同一份 patterns（同一物理 wiki）。
    const reimported = registry.import(projectDir, "My Project (renamed)");
    expect(reimported.id).toBe(imported.id);
    expect(
      createWikiService(registry)
        .list(reimported.id)
        .patterns.map((item) => item.name),
    ).toEqual(["persisted"]);
  });

  it("enumerates imported {id,label,path} without triggering skill scans", () => {
    const registry = createWorkspaceRegistry({ listSkills: () => Promise.resolve([]) });
    expect(registry.listImported()).toEqual([]);
    const first = path.join(sandbox, "proj-one");
    const second = path.join(sandbox, "proj-two");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    registry.import(first, "My Project");
    registry.import(second, "My Project");
    const entries = registry.listImported();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.path)).toEqual(
      [fs.realpathSync(first), fs.realpathSync(second)].sort(),
    );

    // lookup 与 listImported 同源同口径（path 是持久身份）。
    const lookedUp = registry.lookup(entries[0]!.id);
    expect(lookedUp?.path).toBe(entries[0]!.path);
    expect(registry.lookup("~")).toBeNull();
  });
});

describe("host and CLI converge on one physical wiki (spec「宿主与 CLI 同根」)", () => {
  it("daemon-written pages are visible to the CLI via --workspace <dir>", async () => {
    const workspace = makeTempDir();
    const service = createWikiService(
      stubRegistry([{ id: "ws_" + "c".repeat(24), label: "proj", path: workspace }]),
    );
    service.append("ws_" + "c".repeat(24), {
      title: "Same root insight",
      body: "written by the daemon\n",
    });

    const out: string[] = [];
    const code = await runCli(["list", "--workspace", workspace], {
      readStdin: async () => "",
      stdout: (text) => out.push(text),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("same-root-insight — Same root insight");
    expect(
      fs.existsSync(
        path.join(workspace, ".agents", "skill-wiki", "patterns", "same-root-insight.md"),
      ),
    ).toBe(true);
  });

  it("daemon global writes are visible to the CLI via --workspace ~ (SKILL_WIKI_HOME)", async () => {
    const service = createWikiService(stubRegistry([]));
    service.append("~", { title: "Global convergence", body: "via env override\n" });

    const out: string[] = [];
    const code = await runCli(["list", "--workspace", "~"], {
      readStdin: async () => "",
      stdout: (text) => out.push(text),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("global-convergence — Global convergence");
  });
});
