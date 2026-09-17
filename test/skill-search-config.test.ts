/**
 * search-config.toml 生命周期与解析矩阵测试（search-robustness R2）。
 *
 * User input [2026-09-18]: 「专门的配置文件……可以选择可以注释的配置格式，比如
 * jsonc 或者 toml」；语法/结构失败按领域空值，IO 硬错误 typed 失败。
 *
 * Orthogonal intents:
 *   [1] 缺失 → 原子写注释模板并按模板默认生效；模板自身可被解析路径接受。
 *   [2] 合法/注释/畸形/未知键/追加语义矩阵与 configDigest 稳定性。
 *   [3] 读/写 IO 硬错误 → SkillSearchIndexError（不伪装空配置）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadSkillSearchConfig,
  searchConfigPath,
  searchConfigTemplate,
  templateParsesSelf,
} from "../src/daemon/skill-search/config.js";
import { SkillSearchIndexError } from "../src/daemon/skill-search/index.js";
import { setHomeOverride } from "../src/shared/paths.js";

let sandbox = "";
const previousHome = process.env.SKILL_CREATOR_HOME;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-config-test-"));
  process.env.SKILL_CREATOR_HOME = sandbox;
  setHomeOverride(sandbox);
  fs.mkdirSync(path.join(sandbox, ".skill-creator"), { recursive: true });
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("skill search config (search-robustness R2)", () => {
  it("writes the commented template on first load and applies template defaults", () => {
    const config = loadSkillSearchConfig();
    const file = searchConfigPath();
    expect(fs.existsSync(file)).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    expect(written).toContain("#");
    expect(written).toContain("excludeDirs");
    // 内置清单 ∪ 模板默认（dot 目录清单显式写出）。
    for (const name of ["node_modules", "build", "dist", "target", "__pycache__", "tmp", "logs"]) {
      expect(config.excludedDirs).toContain(name);
    }
    for (const name of [".cargo", ".cache", ".npm", ".pnpm-store", ".bun", ".rustup", ".local"]) {
      expect(config.excludedDirs).toContain(name);
    }
  });

  it("parses user additions and appends them over the builtin list", () => {
    fs.writeFileSync(
      searchConfigPath(),
      '# user comment\nexcludeDirs = ["vendor", "node_modules"]\n',
      "utf8",
    );
    const config = loadSkillSearchConfig();
    expect(config.excludedDirs).toContain("vendor");
    // 追加语义：用户重复列出内置项不改变集合（去重排序）。
    expect(config.excludedDirs.filter((name) => name === "node_modules")).toHaveLength(1);
    expect([...config.excludedDirs]).toEqual([...config.excludedDirs].sort());
  });

  it("falls back to builtin-only defaults on malformed TOML or unknown keys without touching the file", () => {
    for (const content of ["excludeDirs = [", "unknownKey = 1\n", 'excludeDirs = "not-a-list"\n']) {
      fs.writeFileSync(searchConfigPath(), content, "utf8");
      const before = fs.readFileSync(searchConfigPath(), "utf8");
      const config = loadSkillSearchConfig();
      expect(config.excludedDirs).not.toContain("vendor");
      expect(fs.readFileSync(searchConfigPath(), "utf8")).toBe(before);
    }
  });

  it("derives a stable digest that changes only with the effective set", () => {
    fs.writeFileSync(searchConfigPath(), 'excludeDirs = ["vendor"]\n', "utf8");
    const first = loadSkillSearchConfig();
    const second = loadSkillSearchConfig();
    expect(first.configDigest).toBe(second.configDigest);
    fs.writeFileSync(searchConfigPath(), 'excludeDirs = ["vendor", "other"]\n', "utf8");
    expect(loadSkillSearchConfig().configDigest).not.toBe(first.configDigest);
    // 追加语义的摘要等价：用户重复内置项 == 不写。
    fs.writeFileSync(searchConfigPath(), 'excludeDirs = ["vendor", "node_modules"]\n', "utf8");
    expect(loadSkillSearchConfig().configDigest).toBe(first.configDigest);
  });

  it("hard-errors on unreadable config instead of faking empty defaults", () => {
    const file = searchConfigPath();
    fs.writeFileSync(file, "excludeDirs = []\n", "utf8");
    // 文件级读阻断（与持久化写阻断不同）：POSIX chmod 文件 0o000；Windows
    // chmod 不生效，替换为同名目录 → readFileSync EISDIR。
    if (process.platform === "win32") {
      fs.rmSync(file, { force: true });
      fs.mkdirSync(file);
      try {
        expect(() => loadSkillSearchConfig()).toThrow(SkillSearchIndexError);
      } finally {
        fs.rmSync(file, { recursive: true, force: true });
      }
    } else {
      fs.chmodSync(file, 0o000);
      try {
        expect(() => loadSkillSearchConfig()).toThrow(SkillSearchIndexError);
      } finally {
        fs.chmodSync(file, 0o644);
      }
    }
  });

  it("keeps the template parseable by the same path (template drift guard)", () => {
    expect(templateParsesSelf()).toBe(true);
    expect(searchConfigTemplate()).not.toContain("undefined");
  });
});
