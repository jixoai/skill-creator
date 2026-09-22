/**
 * SkillSearchService 默认装配测试（server-owned roots 的生产路径）。
 *
 * User input [2026-09-17]: "roots 只来自 provider catalog 与 workspace registry 持久态的
 * server 侧解析，不接受调用方传入的任意路径。" —— 本套件走默认构造（零参数），
 * 以 HOME + SKILL_CREATOR_HOME 沙箱驱动 catalog globalPath 与 imported workspaces
 * 两条真实解析路径，证明生产 root seam 无注入面。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillSearchService,
  createSkillSearchServiceWithRoots,
} from "../src/daemon/skill-search/service.js";
import { FLUSH_DEBOUNCE_MS, type WatchFactory } from "../src/daemon/skill-search/watcher.js";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

let sandbox = "";
let previousHome: string | undefined;
let previousUserProfile: string | undefined;
let previousAppHome: string | undefined;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-service-test-"));
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  previousAppHome = process.env.SKILL_CREATOR_HOME;
  process.env.HOME = path.join(sandbox, "home");
  // os.homedir() 在 win32 读 USERPROFILE：隔离集必须同时覆盖。
  process.env.USERPROFILE = process.env.HOME;
  process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
  setHomeOverride(path.join(sandbox, "state"));
});

/** 创建即登记：afterEach 统一 dispose（watcher + 引擎句柄；Windows 删除 EPERM 防线）。 */
function makeDefaultService() {
  const service = createSkillSearchService();
  openServices.push(service);
  return service;
}
function makeSeamService(...args: Parameters<typeof createSkillSearchServiceWithRoots>) {
  const service = createSkillSearchServiceWithRoots(...args);
  openServices.push(service);
  return service;
}
const openServices: Array<ReturnType<typeof createSkillSearchServiceWithRoots>> = [];

afterEach(async () => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  if (previousAppHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousAppHome;
  // dispose 已是 async（引擎 close 落定屏障）：await 后句柄确定已释放。
  for (const service of openServices) await service.dispose();
  openServices.length = 0;
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function writeSkill(root: string, name: string, description: string): string {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody of ${name}\n`,
  );
  return directory;
}

describe("skill search service default assembly", () => {
  it("discovers catalog global roots and imported workspaces without caller paths", async () => {
    // Global 路径：HOME 沙箱下的 ~/.claude/skills 与 ~/.agents/skills（catalog 解析）。
    writeSkill(
      path.join(sandbox, "home", ".claude", "skills"),
      "global-claude",
      "claude global skill",
    );
    const agentsRoot = path.join(sandbox, "home", ".agents", "skills");
    writeSkill(agentsRoot, "global-agents", "agents global skill");
    // Imported Workspace：workspaces.json 持久态 + provider workspacePath 派生根。
    const workspaceRoot = path.join(sandbox, "ws");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const stateDir = path.join(sandbox, "state", ".skill-creator");
    fs.mkdirSync(stateDir, { recursive: true });
    const canonical = fs.realpathSync(workspaceRoot);
    const crypto = await import("node:crypto");
    const digest = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 24);
    fs.writeFileSync(
      path.join(stateDir, "workspaces.json"),
      JSON.stringify({
        schemaVersion: 2,
        activeId: "~",
        workspaces: [{ id: `ws_${digest}`, label: "test-ws", path: canonical }],
      }),
    );
    writeSkill(
      path.join(workspaceRoot, ".agents", "skills"),
      "imported-codex",
      "imported workspace skill",
    );

    const service = makeDefaultService();
    const results = await service.search("global skill", { limit: 10 });
    const names = new Set(results.map((result) => result.name));
    expect(names.has("global-claude")).toBe(true);
    expect(names.has("global-agents")).toBe(true);

    const imported = await service.search("imported workspace skill", { limit: 10 });
    const hit = imported.find((result) => result.name === "imported-codex");
    expect(hit).toBeDefined();
    // 多个 catalog provider 共享 .agents/skills workspacePath：同一物理入口按
    // provider 逐一生成 installation（语义正确的多观察），断言包含 codex 三元组。
    expect(
      hit?.installations.some(
        (installation) =>
          installation.path === path.join(canonical, ".agents", "skills", "imported-codex") &&
          installation.workspaceId === `ws_${digest}` &&
          installation.providerId === "codex",
      ),
    ).toBe(true);
    expect(
      hit?.installations.every((installation) => installation.workspaceId === `ws_${digest}`),
    ).toBe(true);

    // global-claude 的 installation 绑定 Global 作用域。
    const claudeHit = results.find((result) => result.name === "global-claude");
    expect(
      claudeHit?.installations.some(
        (installation) =>
          installation.workspaceId === "~" && installation.providerId === "claude-code",
      ),
    ).toBe(true);
  });
});

describe("background flush failure vs concurrent search (final review P2-2)", () => {
  it("a search interleaved with a failing watcher flush heals or throws, never silently resolves stale/empty", async () => {
    vi.useFakeTimers();
    const skillRoot = path.join(sandbox, "skills");
    writeSkill(skillRoot, "base-skill", "base skill body");
    const eventCallbacks: Array<() => void> = [];
    const watch: WatchFactory = () => ({
      close: () => {},
      onEvent: (callback) => {
        eventCallbacks.push(callback);
      },
      onError: () => {},
    });
    const service = makeSeamService(
      () => [
        {
          rootPath: skillRoot,
          workspaceId: GLOBAL_WORKSPACE_ID,
          providerId: ProviderIdSchema.parse("claude-code"),
        },
      ],
      { watch },
    );

    // 首查建索引并 reconcile（fake watch 建立在 canonical 目录上）。
    const base = await service.search("base skill", { limit: 10 });
    expect(base.map((result) => result.name)).toContain("base-skill");

    // 破坏 meta 落盘路径 + 语料变更 → 后台 flush 的 maintain 必失败。
    // chmod 对 Windows 目录 ACL 无效（mode 位不映射，注入静默失效）；改用
    // 跨平台机制：meta.json 换成同名目录，原子 rename 落盘必失败
    // （POSIX EISDIR / Windows EPERM），失败语义同为 typed 拒绝。
    const metaFile = path.join(sandbox, "state", ".skill-creator", "search", "meta.json");
    fs.rmSync(metaFile, { force: true });
    fs.mkdirSync(metaFile);
    writeSkill(skillRoot, "extra-skill", "extra skill body");
    try {
      expect(eventCallbacks.length).toBeGreaterThan(0);
      for (const trigger of eventCallbacks) trigger(); // → dirty → 去抖（fake timer）
      // onFlush 同步返回（watcher 清 dirty）；maintain 排入微任务、尚未落定。
      vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS);
      // 与失败中的后台维护交错：旧实现在吞错链上等待后静默返回空结果；
      // 修复后必须观察到真实失败并自愈重跑——写路径仍破坏 → typed 拒绝。
      const search = service.search("extra skill", { limit: 10 });
      await expect(search).rejects.toMatchObject({ code: "UNAVAILABLE" });
    } finally {
      fs.rmSync(metaFile, { recursive: true, force: true });
      vi.useRealTimers();
      service.dispose();
    }
  });
});
