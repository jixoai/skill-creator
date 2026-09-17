/**
 * search-robustness 集成测试（RPC 面：额外 md 检索/排除目录/重复组/配置打开/
 * 新技能立即可搜）。
 *
 * User input [2026-09-18]: 「索引 md 文件但排除特殊目录；配置文件可从界面打开；
 * 安装后立即可搜；中期方向 duplicates 面一并做掉。」
 *
 * Orthogonal intents:
 *   [1] 内容范围：额外 md 可检索、排除目录不进正文（search-config.toml 生效）。
 *   [2] duplicates RPC：同内容成组、唯一内容不出组。
 *   [3] searchConfig.open：stub opener 收到 server-owned 路径。
 *   [4] 新技能写入 provider root 后立即可搜（freshen 增量发现，无需重建服务）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { createRouterClient } from "@orpc/server";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { searchConfigPath } from "../src/daemon/skill-search/config.js";
import { setHomeOverride } from "../src/shared/paths.js";

/** provider catalog 的 Global root env overrides（照 rpc-search.test.ts 的隔离集）。 */
const PROVIDER_HOME_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
] as const;

let sandbox = "";
let domain: DaemonDomain | null = null;
const previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-search-robustness-"));
  const home = path.join(sandbox, "home");
  const isolatedState = path.join(sandbox, "state");
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    previousEnv[name] = process.env[name];
  }
  for (const name of PROVIDER_HOME_OVERRIDES) delete process.env[name];
  process.env.HOME = home;
  // os.homedir() 在 win32 读 USERPROFILE：隔离集必须同时覆盖，否则沙箱泄漏到真实用户目录。
  process.env.USERPROFILE = home;
  process.env.SKILL_CREATOR_HOME = isolatedState;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  setHomeOverride(isolatedState);
});

afterEach(() => {
  setHomeOverride(null);
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    const previous = previousEnv[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
    delete previousEnv[name];
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
  domain = null;
});

function writeGlobalSkill(
  name: string,
  skillBody: string,
  extras: Record<string, string> = {},
): string {
  const directory = path.join(sandbox, "home", ".claude", "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), skillBody);
  for (const [relative, content] of Object.entries(extras)) {
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return directory;
}

function makeClient(opener: (file: string) => Promise<void>) {
  domain = createDaemonDomain(undefined, {
    skillsCliProbe: deterministicSkillsCliProbe(),
    searchConfigOpener: opener,
  });
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
      domain,
    }),
  );
}

describe("search robustness RPC surface", () => {
  it("indexes extra markdown bodies and keeps excluded directories out (R1+R2)", async () => {
    writeGlobalSkill(
      "glass-design",
      "---\nname: glass-design\ndescription: Glass effect guidance.\n---\n# glass\n",
      {
        "reference/guide.md": "The frosted bezel uses progressive blur layers.",
        "node_modules/lib.md": "zephyr-unique-marker",
        ".hidden/notes.md": "dotdir-marker",
      },
    );
    const client = makeClient(async () => {});
    // 额外 md 独有关键词可检索（frosted bezel 只存在于 reference/guide.md）。
    const hits = await client.skills.search({ query: "frosted bezel" });
    expect(hits.results.map((result) => result.name)).toContain("glass-design");
    // 排除目录与 dot 目录的关键词不可检索。
    const excluded = await client.skills.search({ query: "zephyr-unique-marker" });
    expect(excluded.results).toHaveLength(0);
    const dot = await client.skills.search({ query: "dotdir-marker" });
    expect(dot.results).toHaveLength(0);
  });

  it("reindexes when an excluded directory is appended via search-config.toml", async () => {
    const directory = writeGlobalSkill(
      "vendor-docs",
      "---\nname: vendor-docs\ndescription: Vendor docs skill.\n---\n# vendor\n",
      { "vendor/asset.md": "quokka-marker" },
    );
    const client = makeClient(async () => {});
    expect((await client.skills.search({ query: "quokka-marker" })).results).toHaveLength(1);
    // 追加排除 vendor → 摘要变化触发全量重建，正文不再可见。
    fs.writeFileSync(searchConfigPath(), 'excludeDirs = ["vendor"]\n', "utf8");
    expect(fs.existsSync(directory)).toBe(true);
    const after = await client.skills.search({ query: "quokka-marker" });
    expect(after.results).toHaveLength(0);
  });

  it("returns content-duplicate groups without a query (search-duplicates P1)", async () => {
    const sameBody = "---\nname: twin-a\ndescription: Same content twins.\n---\n# twin\n";
    writeGlobalSkill("twin-a", sameBody);
    writeGlobalSkill("twin-b", sameBody);
    writeGlobalSkill(
      "unique-one",
      "---\nname: unique-one\ndescription: Unique skill.\n---\n# unique\n",
    );
    const client = makeClient(async () => {});
    const { groups } = await client.skills.duplicates({});
    expect(groups).toHaveLength(1);
    const group = groups[0];
    // contentHash 是「被索引文件集字节」——字节级克隆的 frontmatter name 相同是
    // 契约语义；成员以 canonicalPath 区分。
    expect(group?.members).toHaveLength(2);
    expect(group?.members.every((member) => member.name === "twin-a")).toBe(true);
    expect(new Set(group?.members.map((member) => member.canonicalPath)).size).toBe(2);
    for (const member of group?.members ?? []) {
      expect(member.installations.length).toBeGreaterThanOrEqual(1);
      expect(member.installations[0]?.workspaceId).toBe("~");
    }
  });

  it("opens the server-owned config path via the injected opener (R3)", async () => {
    const opener = vi.fn(async () => {});
    const client = makeClient(opener);
    const result = await client.skills.searchConfig.open({});
    expect(result).toEqual({ opened: true });
    expect(opener).toHaveBeenCalledTimes(1);
    const opened = opener.mock.calls[0]?.[0] ?? "";
    expect(opened.endsWith("search-config.toml")).toBe(true);
    expect(opened.startsWith(sandbox)).toBe(true);
  });

  it("finds a newly written skill immediately without recreating the service (R6)", async () => {
    makeClient(async () => {});
    writeGlobalSkill(
      "late-arrival",
      "---\nname: late-arrival\ndescription: Arrives after boot.\n---\n# late\n",
    );
    const first = await domain!.skillSearch.search("late arrival");
    expect(first.map((result) => result.name)).toContain("late-arrival");
    // 二次查询（watcher clean 路径或再扫描）仍然命中。
    const second = await domain!.skillSearch.search("Arrives");
    expect(second.map((result) => result.name)).toContain("late-arrival");
  });
});
