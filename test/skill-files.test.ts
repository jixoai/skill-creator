/**
 * skills.files / skills.fileRead RPC 契约测试（skills-tabs-redesign 批 3，Δ2 定稿）。
 *
 * 用户原始需求 [2026-10-06]：「每次调用重解析（不信任先前列表）；lstat 拒文档
 * symlink + O_NOFOLLOW + fstat 身份校验；相对路径校验（拒绝对/`..`/NUL/反斜杠）；
 * 预算 4 深/300 项/树 64KB/单文件 256KiB 超限截断；二进制 typed 拒读；conflict
 * 双文件展示；typed errors 客户端不解析字符串」。
 *
 * 正交意图：
 *   [1] 真实 domain（oRPC client 端到端）：树排序冻结（目录优先组内字典序）/
 *       conflict 双身份文件（非激活份 disabled）/ symlink 三层（顶层入口跟进、
 *       子目录与文件链省略+拒读、broken 链同口径）/ 深度与条目与字节预算截断
 *       （带内 TOO_LARGE）/ 256KiB 内容截断（不拒读）/ 二进制 BINARY / 路径
 *       闭包负例（INVALID_PATH）/ 未知目标与路径（NOT_FOUND）。
 *   [2] TOCTOU 防线单元（readVerifiedBounded 确定性注入）：fstat 身份漂移
 *       （UNAVAILABLE）与 O_NOFOLLOW open 拒绝（NOT_FOUND）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { readVerifiedBounded } from "../src/daemon/skill-files.js";
import type { SkillId } from "../src/shared/contracts/skills.js";

/** provider catalog 的 Global root env overrides（照 rpc-skills-list-canonical 的隔离集）。 */
const PROVIDER_HOME_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
] as const;

let sandbox = "";
const previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-skill-files-"));
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
  process.env.USERPROFILE = home;
  process.env.SKILL_CREATOR_HOME = isolatedState;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  setHomeOverride(isolatedState);
});

afterEach(async () => {
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
  // skillSearch 持有 sqlite 引擎句柄：dispose 是 async 完成屏障（Windows EPERM 防线）。
  for (const domain of createdDomains) await domain.skillSearch.dispose();
  createdDomains.length = 0;
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10 });
});

const createdDomains: DaemonDomain[] = [];

function createClient() {
  const domain = createDaemonDomain(undefined, {
    skillsCliProbe: deterministicSkillsCliProbe(),
  });
  createdDomains.push(domain);
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

function writeSkill(
  root: ".claude" | ".codex",
  name: string,
  options: { files?: Record<string, string>; alsoDisabledDocument?: boolean } = {},
): string {
  const directory = path.join(sandbox, "home", root, "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} desc\n---\n# ${name}\n\nBody\n`,
  );
  if (options.alsoDisabledDocument) {
    fs.writeFileSync(
      path.join(directory, ".SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} desc\n---\n# ${name}\n\nBody\n`,
    );
  }
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return directory;
}

async function firstSkillId(
  client: ReturnType<typeof createClient>,
  providerId: "claude-code" | "codex",
): Promise<SkillId> {
  const { skills } = await client.skills.list({
    workspaceId: "~",
    providerId,
    includeDisabled: true,
  });
  const skill = skills[0];
  if (!skill) throw new Error("fixture skill missing from discovery");
  return skill.id;
}

describe("skills.files（Δ2 有界文件树）", () => {
  it("enumerates a nested tree with frozen ordering (dirs first, lexicographic) and byte sizes", async () => {
    const client = createClient();
    writeSkill(".claude", "tree-skill", {
      files: {
        "references/anchors.md": "anchors\n",
        "references/deep/guide.md": "guide\n",
        "scripts/run.py": "print(1)\n",
        "notes.md": "notes\n",
      },
    });
    const skillId = await firstSkillId(client, "claude-code");

    const output = await client.skills.files({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
    });
    // 前序 DFS：父目录先于子条目、递归完一目录再进下一兄弟；每层目录优先、
    // 组内字典序（大写 S 先于小写 n）。
    expect(output.entries.map((entry) => entry.path)).toEqual([
      "references",
      "references/deep",
      "references/deep/guide.md",
      "references/anchors.md",
      "scripts",
      "scripts/run.py",
      "SKILL.md",
      "notes.md",
    ]);
    const references = output.entries.find((entry) => entry.path === "references");
    expect(references).toMatchObject({ kind: "dir", size: 0 });
    const script = output.entries.find((entry) => entry.path === "scripts/run.py");
    expect(script).toMatchObject({ kind: "file", size: "print(1)\n".length });
    expect(output.truncationReason).toBeUndefined();
  });

  it("stops at depth 4: directories at depth 4 are listed but not descended", async () => {
    const client = createClient();
    writeSkill(".claude", "deep-skill", {
      files: {
        "a/b/c/d/e/leaf.txt": "beyond budget\n",
        "a/b/c/d/cap.txt": "at cap\n",
      },
    });
    const skillId = await firstSkillId(client, "claude-code");

    const output = await client.skills.files({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
    });
    // 遍历 ≤4 深：深度 4 的目录列出但不下降——其子项（深度 5 的 cap.txt）不入树。
    expect(output.entries.map((entry) => entry.path)).toEqual([
      "a",
      "a/b",
      "a/b/c",
      "a/b/c/d",
      "SKILL.md",
    ]);
    expect(output.entries.some((entry) => entry.path === "a/b/c/d/cap.txt")).toBe(false);
  });

  it("lists both identity documents on conflict and marks the non-active one disabled", async () => {
    const client = createClient();
    writeSkill(".claude", "conflicted", { alsoDisabledDocument: true });
    const skillId = await firstSkillId(client, "claude-code");

    const output = await client.skills.files({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
    });
    const active = output.entries.find((entry) => entry.path === "SKILL.md");
    const inactive = output.entries.find((entry) => entry.path === ".SKILL.md");
    // 两份都展示，不静默择一；非激活份（enabled 技能的 .SKILL.md）标 disabled。
    expect(active).toBeDefined();
    expect(active?.disabled).toBeUndefined();
    expect(inactive).toMatchObject({ disabled: true });
  });

  it("omits subdirectory, file, and broken symlinks from the tree and refuses symlink reads", async () => {
    const client = createClient();
    const directory = writeSkill(".claude", "linked-skill", {
      files: { "real.txt": "real\n", "sub/inside.txt": "inside\n" },
    });
    // 文件级 symlink + 子目录 symlink + broken symlink（三层策略的省略面）。
    fs.symlinkSync(path.join(directory, "real.txt"), path.join(directory, "alias.txt"));
    fs.symlinkSync(path.join(directory, "sub"), path.join(directory, "alias-dir"));
    fs.symlinkSync(path.join(directory, "gone"), path.join(directory, "broken.txt"));
    const skillId = await firstSkillId(client, "claude-code");

    const output = await client.skills.files({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
    });
    expect(output.entries.map((entry) => entry.path).sort()).toEqual([
      "SKILL.md",
      "real.txt",
      "sub",
      "sub/inside.txt",
    ]);

    for (const refused of ["alias.txt", "alias-dir", "alias-dir/inside.txt", "broken.txt"]) {
      await expect(
        client.skills.fileRead({
          workspaceId: "~",
          providerId: "claude-code",
          skillId,
          path: refused,
        }),
      ).rejects.toMatchObject({ code: "INVALID_PATH" });
    }
  });

  it("follows a top-level symlinked skill entry once (ccski-symlink-entries parity)", async () => {
    const client = createClient();
    const realDirectory = path.join(sandbox, "real-skill-dir");
    fs.mkdirSync(realDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(realDirectory, "SKILL.md"),
      "---\nname: linked-entry\ndescription: linked desc\n---\nBody\n",
    );
    fs.writeFileSync(path.join(realDirectory, "doc.md"), "linked doc\n");
    fs.mkdirSync(path.join(sandbox, "home", ".claude", "skills"), { recursive: true });
    fs.symlinkSync(realDirectory, path.join(sandbox, "home", ".claude", "skills", "linked-entry"));
    const skillId = await firstSkillId(client, "claude-code");

    // 入口层跟进一次：树与读取都落在解析后的真实目录上。
    const output = await client.skills.files({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
    });
    expect(output.entries.map((entry) => entry.path).sort()).toEqual(["SKILL.md", "doc.md"]);
    const read = await client.skills.fileRead({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
      path: "doc.md",
    });
    expect(read.content).toBe("linked doc\n");
  });

  it("truncates enumeration with a typed TOO_LARGE reason at the 300-entry budget", async () => {
    const client = createClient();
    const files: Record<string, string> = {};
    for (let index = 0; index < 310; index += 1) {
      files[`bulk-${String(index).padStart(3, "0")}.txt`] = "x\n";
    }
    writeSkill(".claude", "wide-skill", { files });
    const skillId = await firstSkillId(client, "claude-code");

    const output = await client.skills.files({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
    });
    expect(output.entries).toHaveLength(300);
    expect(output.truncationReason).toBe("TOO_LARGE");
  });

  it("truncates enumeration at the 64KB response budget before the entry cap", async () => {
    const client = createClient();
    const files: Record<string, string> = {};
    for (let index = 0; index < 320; index += 1) {
      // 文件名 ≤255 字节上限内的长名：条目 JSON ≈222B，300 条 ≈66KB > 64KB
      // ——字节预算先于 300 项预算截断（entries < 300 即字节预算命中的证据）。
      files[`${"l".repeat(180)}-${String(index).padStart(3, "0")}.txt`] = "x\n";
    }
    writeSkill(".claude", "longnames-skill", { files });
    const skillId = await firstSkillId(client, "claude-code");

    const output = await client.skills.files({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
    });
    expect(output.entries.length).toBeLessThan(300);
    expect(output.truncationReason).toBe("TOO_LARGE");
    expect(JSON.stringify({ entries: output.entries }).length).toBeLessThanOrEqual(64 * 1024);
  });
});

describe("skills.fileRead（Δ2 有界文件读）", () => {
  it("returns full content with size for a text file", async () => {
    const client = createClient();
    writeSkill(".claude", "read-skill", { files: { "guide.md": "hello guide\n" } });
    const skillId = await firstSkillId(client, "claude-code");

    const read = await client.skills.fileRead({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
      path: "guide.md",
    });
    expect(read).toEqual({
      content: "hello guide\n",
      size: "hello guide\n".length,
      truncated: false,
    });
  });

  it("returns the first 256KiB with truncated:true for oversized files (no refusal)", async () => {
    const client = createClient();
    const body = `${"a".repeat(300 * 1024)}\n`;
    writeSkill(".claude", "big-skill", { files: { "big.txt": body } });
    const skillId = await firstSkillId(client, "claude-code");

    const read = await client.skills.fileRead({
      workspaceId: "~",
      providerId: "claude-code",
      skillId,
      path: "big.txt",
    });
    expect(read.truncated).toBe(true);
    expect(read.size).toBe(Buffer.byteLength(body));
    expect(Buffer.byteLength(read.content)).toBe(256 * 1024);
    expect(read.content.startsWith("a")).toBe(true);
  });

  it("refuses binary content with a typed BINARY error (detection inside the bounded read)", async () => {
    const client = createClient();
    const binary = Buffer.concat([Buffer.from([0x89, 0x00, 0x00]), Buffer.alloc(300 * 1024, 7)]);
    const directory = writeSkill(".claude", "binary-skill", {});
    fs.writeFileSync(path.join(directory, "logo.bin"), binary);
    const skillId = await firstSkillId(client, "claude-code");

    await expect(
      client.skills.fileRead({
        workspaceId: "~",
        providerId: "claude-code",
        skillId,
        path: "logo.bin",
      }),
    ).rejects.toMatchObject({ code: "BINARY" });
  });

  it("rejects traversal, absolute, NUL, backslash, and normalization-ambiguous paths as INVALID_PATH", async () => {
    const client = createClient();
    writeSkill(".claude", "traversal-skill", {
      files: { "ok.txt": "ok\n", "sub/nested.txt": "n\n" },
    });
    const skillId = await firstSkillId(client, "claude-code");
    const read = (filePath: string) =>
      client.skills.fileRead({
        workspaceId: "~",
        providerId: "claude-code",
        skillId,
        path: filePath,
      });

    for (const refused of [
      "../outside.txt",
      "a/../ok.txt",
      "a/../../outside.txt",
      "/etc/passwd",
      "C:/windows",
      "\\\\server\\share",
      "back\\slash.txt",
      "nul\0byte.txt",
      "double//slash.txt",
      "./ok.txt",
      "ok.txt/",
      ".",
      "..",
    ]) {
      await expect(read(refused)).rejects.toMatchObject({ code: "INVALID_PATH" });
    }
    // 目录目标与不存在的叶：目录 = INVALID_PATH（读目标必须是 regular file），
    // 缺失 = NOT_FOUND。
    await expect(read("sub")).rejects.toMatchObject({ code: "INVALID_PATH" });
    await expect(read("missing.txt")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects unknown skills as typed NOT_FOUND (re-resolved on every call)", async () => {
    const client = createClient();
    writeSkill(".claude", "any-skill", {});
    await expect(
      client.skills.files({
        workspaceId: "~",
        providerId: "claude-code",
        skillId: `sk_${"f".repeat(24)}` as SkillId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      client.skills.fileRead({
        workspaceId: "~",
        providerId: "claude-code",
        skillId: `sk_${"f".repeat(24)}` as SkillId,
        path: "SKILL.md",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("TOCTOU 防线单元（readVerifiedBounded 确定性注入）", () => {
  it("refuses with UNAVAILABLE when the file identity drifted between validation and open", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sc-skill-files-race-"));
    try {
      const leaf = path.join(directory, "target.txt");
      fs.writeFileSync(leaf, "original\n");
      const identity = fs.lstatSync(leaf);
      // 换体：rename 换入不同 inode 的同名文件（lstat↔open 竞态的确定性复现）。
      const replacement = path.join(directory, "replacement.txt");
      fs.writeFileSync(replacement, "swapped\n");
      fs.renameSync(replacement, leaf);

      expect(() =>
        readVerifiedBounded(leaf, { dev: identity.dev, ino: identity.ino }, "target.txt"),
      ).toThrowError(/path race/);
      try {
        readVerifiedBounded(leaf, { dev: identity.dev, ino: identity.ino }, "target.txt");
        expect.fail("Expected the identity drift to be refused.");
      } catch (error) {
        expect((error as { code?: string }).code).toBe("UNAVAILABLE");
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it("refuses with NOT_FOUND when the final component became a symlink (O_NOFOLLOW open)", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sc-skill-files-nofollow-"));
    try {
      const leaf = path.join(directory, "target.txt");
      fs.writeFileSync(leaf, "original\n");
      const identity = fs.lstatSync(leaf);
      const evil = path.join(directory, "evil.txt");
      fs.writeFileSync(evil, "evil\n");
      fs.unlinkSync(leaf);
      fs.symlinkSync(evil, leaf);

      try {
        readVerifiedBounded(leaf, { dev: identity.dev, ino: identity.ino }, "target.txt");
        expect.fail("Expected the symlinked leaf to be refused.");
      } catch (error) {
        expect((error as { code?: string }).code).toBe("NOT_FOUND");
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10 });
    }
  });
});
