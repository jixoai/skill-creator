/**
 * wiki.* RPC 面测试（skill-wiki-incubation 切片②，2026-09-21；目录映射标准重写
 * 2026-09-22；wiki.scopes 扩展 2026-09-22 wiki-directory-standard task 3.1）。
 *
 * User input [2026-09-21]: "P1 本质上是在收集一些碎片的认知……是 skill-wiki 输入的一部分"
 * User ruling [2026-09-22]: "registry workspace 的 wiki 与 workspace 目录同居
 * （<dir>/.agents/skill-wiki）；global 走 SKILL_WIKI_HOME > ~/.agents/skill-wiki。"
 * Orthogonal intents:
 *   [1] 双级 scope 解析经真实 router 投影（global → globalWikiDirectory / 注册
 *       ws_* → <workspace>/.agents/skill-wiki / 未注册 ws_* typed NOT_FOUND）。
 *   [2] 追加幂等（deduplicated）、origin 足迹（"~" 或 workspace 目录绝对路径）与
 *       read round-trip 走完 oRPC 契约边界。
 *   [3] wiki.scopes 索引：global 恒列 + 多 workspace（有 wiki/无 wiki/计数正确），
 *       且读面零写副作用（未初始化 scope 不被惰性建目录）。
 */
import { ORPCError, createRouterClient } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { createWikiService } from "../src/daemon/wiki-service.js";
import type { WorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import { openWikiWorkspace, workspaceWikiDirectory } from "skill-wiki";

const REGISTERED_WS = "ws_" + "1".repeat(24);
const SEEDED_WS = "ws_" + "3".repeat(24);
const UNKNOWN_WS = "ws_" + "2".repeat(24);

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-rpc-"));
  tempDirs.push(dir);
  return dir;
}

const previousWikiHome = process.env.SKILL_WIKI_HOME;
let workspaceDir = "";
let seededDir = "";
let globalHome = "";

beforeEach(() => {
  workspaceDir = makeTempDir();
  seededDir = makeTempDir();
  // global 解析按请求读 env（wiki-service 语义）；测试隔离注入。指向不存在的
  // 子路径——生产语义里 global root 首次写入前本就不存在（exists=false 投影）。
  globalHome = path.join(makeTempDir(), "wiki-home");
  process.env.SKILL_WIKI_HOME = globalHome;
});
afterEach(() => {
  if (previousWikiHome === undefined) delete process.env.SKILL_WIKI_HOME;
  else process.env.SKILL_WIKI_HOME = previousWikiHome;
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

/** stub registry：REGISTERED_WS 无 wiki、SEEDED_WS 预置 2 条 pattern。 */
function stubRegistry(): Pick<WorkspaceRegistry, "lookup" | "listImported"> {
  return {
    lookup: (id) =>
      id === REGISTERED_WS
        ? { id: REGISTERED_WS, label: "registered", path: workspaceDir }
        : id === SEEDED_WS
          ? { id: SEEDED_WS, label: "seeded", path: seededDir }
          : null,
    listImported: () => [
      { id: REGISTERED_WS, label: "registered", path: workspaceDir },
      { id: SEEDED_WS, label: "seeded", path: seededDir },
    ],
  };
}

function wikiClient(): {
  client: ReturnType<typeof makeClient>;
} {
  const client = makeClient();
  return { client };
}

function makeClient() {
  const domain = createDaemonDomain(undefined, {});
  const withWiki: DaemonDomain = {
    ...domain,
    wiki: createWikiService(stubRegistry()),
  } as DaemonDomain;
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "mounted",
      }),
      domain: withWiki,
    }),
  );
}

describe("wiki RPC surface", () => {
  it("lists an empty global scope", async () => {
    const { client } = wikiClient();
    await expect(client.wiki.list({ scope: "~" })).resolves.toEqual({ patterns: [] });
  });

  it("appends a fragment to global, reads it back, and dedups identical bodies", async () => {
    const { client } = wikiClient();
    const appended = await client.wiki.append({
      scope: "~",
      title: "Pin exit codes",
      body: "Branch on exit code, never on piped stdout.",
    });
    expect(appended.deduplicated).toBe(false);
    expect(appended.item.name).toBe("pin-exit-codes");
    expect(appended.item.origin).toBe("~");
    // global 落在 SKILL_WIKI_HOME 覆盖的新址（globalWikiDirectory）。
    expect(fs.existsSync(path.join(globalHome, "patterns", "pin-exit-codes.md"))).toBe(true);

    const again = await client.wiki.append({
      scope: "~",
      title: "Different title same body",
      body: "Branch on exit code, never on piped stdout.",
    });
    expect(again.deduplicated).toBe(true);
    expect(again.item.name).toBe(appended.item.name);

    const list = await client.wiki.list({ scope: "~" });
    expect(list.patterns).toHaveLength(1);

    const read = await client.wiki.read({ scope: "~", name: appended.item.name });
    expect(read.title).toBe("Pin exit codes");
    expect(read.body).toContain("Branch on exit code");
    expect(read.promotedFrom).toBeNull();
  });

  it("co-locates a registered ws_* wiki with the workspace directory (origin footprint)", async () => {
    const { client } = wikiClient();
    const appended = await client.wiki.append({
      scope: REGISTERED_WS,
      title: "Workspace-local insight",
      body: "only in this workspace",
    });
    // origin 足迹 = workspace 目录绝对路径（目录映射标准 2026-09-22）。
    expect(appended.item.origin).toBe(workspaceDir);
    // RPC 侧仍是 WorkspaceId；wiki 与 workspace 目录同居。
    const wikiDir = path.join(workspaceDir, ".agents", "skill-wiki");
    expect(fs.existsSync(path.join(wikiDir, "patterns", "workspace-local-insight.md"))).toBe(true);
    // global 不受 ws 追加影响（双级互不重叠——list 仅惰性建了空结构）。
    const globalList = await client.wiki.list({ scope: "~" });
    expect(globalList.patterns).toEqual([]);
    expect(fs.existsSync(path.join(globalHome, "patterns", "workspace-local-insight.md"))).toBe(
      false,
    );
  });

  it("rejects an unregistered ws_* scope with typed NOT_FOUND", async () => {
    const { client } = wikiClient();
    const failure = client.wiki.list({ scope: UNKNOWN_WS });
    await expect(failure).rejects.toBeInstanceOf(ORPCError);
    await expect(failure).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a whitespace-only title as INVALID_OPERATION (trim rule in skill-wiki)", async () => {
    const { client } = wikiClient();
    const failure = client.wiki.append({ scope: "~", title: "   ", body: "b" });
    await expect(failure).rejects.toBeInstanceOf(ORPCError);
    await expect(failure).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it("rejects reading an unknown pattern with typed NOT_FOUND", async () => {
    const { client } = wikiClient();
    const failure = client.wiki.read({ scope: "~", name: "does-not-exist" });
    await expect(failure).rejects.toBeInstanceOf(ORPCError);
    await expect(failure).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces contract bounds on inputs at the oRPC schema boundary", async () => {
    const { client } = wikiClient();
    await expect(client.wiki.append({ scope: "~", title: "", body: "b" })).rejects.toBeInstanceOf(
      ORPCError,
    );
    await expect(
      client.wiki.append({ scope: "~", title: "x".repeat(121), body: "b" }),
    ).rejects.toBeInstanceOf(ORPCError);
    await expect(client.wiki.read({ scope: "~", name: "Bad_Name" })).rejects.toBeInstanceOf(
      ORPCError,
    );
  });
});

describe("wiki.scopes RPC surface", () => {
  it("lists global first plus every imported workspace with label/count/exists", async () => {
    // SEEDED_WS 预置两条 pattern（库直写，模拟 CLI/宿主已同居初始化的 wiki）。
    const seeded = openWikiWorkspace(workspaceWikiDirectory(seededDir));
    seeded.appendPattern({ title: "Seeded one", body: "seed body 1" });
    seeded.appendPattern({ title: "Seeded two", body: "seed body 2" });

    const { client } = wikiClient();
    const { scopes } = await client.wiki.scopes({});

    // global 恒列且在首位（SKILL_WIKI_HOME 指向的目录首次写入前不存在 → 空态）。
    expect(scopes[0]).toEqual({ id: "~", label: "Global", patternCount: 0, exists: false });
    const byId = new Map(scopes.map((scope) => [scope.id, scope]));
    // 无 wiki 的 workspace：exists=false、计数 0（显示空态而非隐藏）。
    expect(byId.get(REGISTERED_WS)).toEqual({
      id: REGISTERED_WS,
      label: "registered",
      patternCount: 0,
      exists: false,
    });
    // 有 wiki 的 workspace：目录映射解析 + listPatterns 计数正确。
    expect(byId.get(SEEDED_WS)).toEqual({
      id: SEEDED_WS,
      label: "seeded",
      patternCount: 2,
      exists: true,
    });
    expect(scopes).toHaveLength(3);
  });

  it("does not lazily create wiki directories for uninitialized scopes (read face)", async () => {
    const { client } = wikiClient();
    await client.wiki.scopes({});

    // listPatterns 会惰性 mkdir patterns；scopes 不得让未初始化 scope 被动建目录。
    expect(fs.existsSync(path.join(workspaceDir, ".agents"))).toBe(false);
    expect(fs.existsSync(path.join(globalHome, "patterns"))).toBe(false);
  });

  it("does not create patterns/ under a partially initialized wiki root (codex r1 P1)", async () => {
    // 独立复现向量：wiki 根目录已存在（例如手工建过或只写过 index.md）、
    // patterns/ 缺失——openWikiWorkspace().listPatterns() 会补建目录，
    // scopes 必须保持零写。
    fs.mkdirSync(path.join(workspaceDir, ".agents", "skill-wiki"), { recursive: true });
    const { client } = wikiClient();
    const { scopes } = await client.wiki.scopes({});
    const registered = scopes.find((scope) => scope.id === REGISTERED_WS);
    expect(registered?.exists).toBe(true);
    expect(registered?.patternCount).toBe(0);
    expect(fs.existsSync(path.join(workspaceDir, ".agents", "skill-wiki", "patterns"))).toBe(false);
  });

  it("reflects appended fragments in counts after GUI writes (same physical directory)", async () => {
    const { client } = wikiClient();
    await client.wiki.append({ scope: REGISTERED_WS, title: "Count me", body: "body 1" });
    await client.wiki.append({ scope: REGISTERED_WS, title: "Count me too", body: "body 2" });

    const { scopes } = await client.wiki.scopes({});
    const registered = scopes.find((scope) => scope.id === REGISTERED_WS);
    expect(registered).toEqual({
      id: REGISTERED_WS,
      label: "registered",
      patternCount: 2,
      exists: true,
    });
  });
});
