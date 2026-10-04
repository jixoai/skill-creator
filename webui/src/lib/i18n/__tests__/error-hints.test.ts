// @vitest-environment jsdom
/**
 * 错误分类器矩阵测试（webui-i18n-bilingual task 4.5 δ 线）。
 *
 * 用户原始需求 [2026-10-05]（Owner 裁决）：「客观留存这个错误，是调试的关键，
 * 但是可以辅助一些 i18n 的比较宽泛的翻译」。
 *
 * 正交意图：
 *   [1] 分类矩阵：典型真实信源输入（Node errno / oRPC 契约消息 / git stderr /
 *       undici fetch / connection store 固定文案）→ 家族 key。
 *   [2] 优先级：家族重叠取 specific（fatal:not found → git；ENOENT/ENOTFOUND
 *       互不吞）。
 *   [3] 零降级：未匹配返回 null（展示层只渲染原文）；原文永不改写。
 *   [4] 域齐全性：errorHints en/zh 键集合相等 + 值非空；t() 双语解析。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { classifyErrorHint } from "../error-hints.js";
import { errorHintsEn, errorHintsZh } from "../catalogs/domains/error-hints.js";
import { __resetLocaleForTests, setLocale, t } from "../locale.svelte.js";

beforeEach(() => {
  localStorage.clear();
  __resetLocaleForTests();
});

describe("classifyErrorHint matrix（模式 → 家族）", () => {
  it.each([
    // 权限家族（errno + 短语）。
    [
      "EACCES: permission denied, open '/Users/me/.agents/skills/foo/SKILL.md'",
      "errorHints.permission",
    ],
    ["EPERM: operation not permitted, symlink '/a' -> '/b'", "errorHints.permission"],
    ["Access denied for user", "errorHints.permission"],
    // Git 家族（fatal: 前缀 + 鉴权 + clone；优先于 notFound）。
    ["fatal: repository 'https://github.com/x/y.git/' not found", "errorHints.git"],
    ["fatal: Authentication failed for 'https://github.com/x/y.git/'", "errorHints.git"],
    ["Unable to access 'https://github.com/x/y.git/': Failed to connect", "errorHints.git"],
    ["could not clone repository", "errorHints.git"],
    // 连接断开家族（connection store 三条固定文案 + 通用短语）。
    ["The Skill Creator daemon is not connected.", "errorHints.disconnected"],
    ["The local daemon connection closed.", "errorHints.disconnected"],
    [
      "Cannot authenticate with the local daemon. Open Skill Creator from its tray icon.",
      "errorHints.disconnected",
    ],
    // 网络家族（errno + undici + DNS；ENOTFOUND 不被 ENOENT 家族吞掉）。
    ["connect ETIMEDOUT 20.205.243.166:443", "errorHints.network"],
    ["fetch failed", "errorHints.network"],
    ["getaddrinfo ENOTFOUND github.com", "errorHints.network"],
    ["connect ECONNREFUSED 127.0.0.1:5173", "errorHints.network"],
    ["WebSocket connection to 'ws://127.0.0.1:4173/ws/rpc' failed", "errorHints.network"],
    // 状态冲突家族（creator revision / 重复目录 / 契约 CONFLICT / proposal stale）。
    ["This skill changed on disk. Reload it before saving your edits.", "errorHints.conflict"],
    ["A non-empty directory already exists: my-skill", "errorHints.conflict"],
    ["The operation conflicts with current state.", "errorHints.conflict"],
    [
      "The proposal already entered execution; the decision cannot overtake it.",
      "errorHints.conflict",
    ],
    // 解析/校验家族（JSON / frontmatter / invalid）。
    ["Unexpected end of JSON input", "errorHints.invalidData"],
    ["Unexpected token 'h', \"hmm\" is not valid JSON", "errorHints.invalidData"],
    [
      "Installed skill frontmatter is invalid: name must match skill directory",
      "errorHints.invalidData",
    ],
    // 不存在家族（ENOENT / not found / does not exist）。
    ["ENOENT: no such file or directory, open '/tmp/x/SKILL.md'", "errorHints.notFound"],
    ["Remote skill not found in scan session: rsk_1", "errorHints.notFound"],
    ["The requested resource was not found.", "errorHints.notFound"],
    // 磁盘 IO 家族。
    ["ENOSPC: no space left on device, write", "errorHints.io"],
    ["EROFS: read-only file system, open '/tmp/x'", "errorHints.io"],
    ["ENOTDIR: not a directory, open '/tmp/x/SKILL.md'", "errorHints.io"],
    // 非法操作 / 不可用 / 取消（契约短句）。
    ["The requested operation is not valid.", "errorHints.invalidOperation"],
    ["The requested resource is unavailable.", "errorHints.unavailable"],
    ["Repository session expired. Scan the repository again.", "errorHints.unavailable"],
    ["Repository service is shutting down.", "errorHints.unavailable"],
    ["The operation was aborted.", "errorHints.cancelled"],
  ] as const)("classifies %j", (raw, expected) => {
    expect(classifyErrorHint(raw)).toBe(expected);
  });

  it("ENOENT 与 ENOTFOUND 互不吞（整词边界）", () => {
    expect(classifyErrorHint("ENOENT: no such file or directory")).toBe("errorHints.notFound");
    expect(classifyErrorHint("getaddrinfo ENOTFOUND host")).toBe("errorHints.network");
  });

  it("returns null for unmatched input（零降级：原文原样展示）", () => {
    expect(classifyErrorHint("Installer returned an unexpected skill path.")).toBeNull();
    expect(classifyErrorHint("Something completely different happened.")).toBeNull();
    expect(classifyErrorHint("")).toBeNull();
  });

  it("every domain key carries a non-empty en value（规则 key 与词典类型联动）", () => {
    for (const [key, value] of Object.entries(errorHintsEn)) {
      expect(value.length, key).toBeGreaterThan(0);
    }
  });
});

describe("errorHints 域齐全性 + t() 双语解析", () => {
  it("keeps en and zh key sets identical with non-empty values", () => {
    expect(Object.keys(errorHintsZh).sort()).toEqual(Object.keys(errorHintsEn).sort());
    for (const value of Object.values(errorHintsZh)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("t() resolves the hint key in en and zh", () => {
    const key = classifyErrorHint("EACCES: permission denied, open '/x'");
    expect(key).toBe("errorHints.permission");
    expect(t(key!)).toBe(errorHintsEn["errorHints.permission"]);
    setLocale("zh");
    expect(t(key!)).toBe(errorHintsZh["errorHints.permission"]);
  });
});
