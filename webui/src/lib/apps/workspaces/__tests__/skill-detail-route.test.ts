/**
 * skill-detail-route 列表态 codec 单元测试（skills-tabs-redesign 批 2，Δ3 定稿 +
 * MainAgent 复核裁决：p = provider chip 筛选，分页段数改 page 键承载）。
 * 用户原始需求 [2026-10-06]：「?from= 白名单 {tab,q,p,dup,scroll,sel,file}，
 * 编码后 ≤512 字符，未知/重复键静默丢弃，枚举校验，回程经状态对象重组 route」。
 * 正交意图：
 *   [1] 编码器契约：默认值省略键位、白名单精确、≤512 超限整键丢弃。
 *   [2] 解码器 total 性：未知/重复/枚举外/形状非法键一律静默落默认或丢弃
 *       （永不 throw）；首现即决。
 *   [3] 回程重组：listStateToDashboardSearch 只产 URL 筛选语义（tab/q/dup/
 *       provider——provider 即 chip 激活真相源），scroll/sel/page 归 handoff
 *       内存面（不进 URL）。
 */
import { describe, expect, it } from "vitest";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { ProviderIdSchema } from "$shared/contracts/workspaces.js";
import {
  DEFAULT_LIST_STATE,
  encodeListStateParam,
  listStateToDashboardSearch,
  parseListStateParam,
} from "../skill-detail-route.js";

const SK = SkillIdSchema.parse(`sk_0123456789abcdef01234567`);
const ZCODE = ProviderIdSchema.parse("zcode");

describe("encodeListStateParam", () => {
  it("omits default values and emits only whitelisted keys", () => {
    expect(encodeListStateParam(DEFAULT_LIST_STATE)).toBeUndefined();
    const encoded = encodeListStateParam({
      tab: "skills",
      q: "vue helpers",
      provider: ZCODE,
      dup: true,
      page: 3,
      scroll: 1500,
      sel: SK,
      file: "",
    });
    const params = new URLSearchParams(encoded!);
    expect([...params.keys()].sort()).toEqual(["dup", "p", "page", "q", "scroll", "sel"]);
    expect(params.get("q")).toBe("vue helpers");
    // p = provider 筛选（MainAgent 裁决），分页段数走 page 键。
    expect(params.get("p")).toBe("zcode");
    expect(params.get("page")).toBe("3");
    expect(params.get("dup")).toBe("1");
    expect(params.get("scroll")).toBe("1500");
    expect(params.get("sel")).toBe(SK);
  });

  it("drops the whole param when the encoding exceeds 512 chars (no truncation)", () => {
    const longQ = "x".repeat(600);
    expect(encodeListStateParam({ ...DEFAULT_LIST_STATE, q: longQ })).toBeUndefined();
  });
});

describe("parseListStateParam", () => {
  it("round-trips an encoded state including the provider filter", () => {
    const state = {
      tab: "skills" as const,
      q: "vue",
      provider: ZCODE,
      dup: true,
      page: 2,
      scroll: 320,
      sel: SK,
      file: "scripts/run.sh",
    };
    const parsed = parseListStateParam(encodeListStateParam(state));
    expect(parsed).toEqual(state);
  });

  it("silently drops unknown keys, duplicate keys, and enum/shape violations", () => {
    const raw = new URLSearchParams({
      tab: "agents",
      q: "keep",
      evil: "injected",
      p: "zcode",
      page: "2",
      dup: "1",
      sel: SK,
      scroll: "8",
      file: "a.md",
    });
    // 重复键：首现即决（q/scroll/p 的第二现丢弃）。
    raw.append("q", "dropped");
    raw.append("scroll", "999");
    // 枚举外 tab / 非法 sel / 非法 provider / 负 scroll：该键落默认。
    raw.set("tab", "bogus");
    raw.delete("p");
    raw.append("p", "INVALID_PROVIDER");
    raw.delete("sel");
    raw.append("sel", "sk_bad");
    raw.delete("scroll");
    raw.append("scroll", "-4");

    const state = parseListStateParam(raw.toString());
    expect(state.tab).toBe("skills"); // 枚举外 → 默认
    expect(state.q).toBe("keep"); // 首现即决
    expect(state.provider).toBeNull(); // 形状非法 → 默认（All）
    expect(state.page).toBe(2);
    expect(state.dup).toBe(true);
    expect(state.scroll).toBe(0); // 非法 → 默认
    expect(state.sel).toBeNull(); // 形状非法 → 默认
    expect(state.file).toBe("a.md");
    expect(Object.hasOwn(state, "evil")).toBe(false); // 未知键不入状态
  });

  it("is total: overlong and garbage inputs fall back to defaults", () => {
    expect(parseListStateParam(null)).toEqual(DEFAULT_LIST_STATE);
    expect(parseListStateParam(undefined)).toEqual(DEFAULT_LIST_STATE);
    expect(parseListStateParam("")).toEqual(DEFAULT_LIST_STATE);
    expect(parseListStateParam("x".repeat(513))).toEqual(DEFAULT_LIST_STATE);
    expect(parseListStateParam("%%%not-a-query%ZZ")).toEqual(DEFAULT_LIST_STATE);
  });
});

describe("listStateToDashboardSearch（回程状态对象重组）", () => {
  it("projects only the URL-borne filter semantics", () => {
    expect(listStateToDashboardSearch(DEFAULT_LIST_STATE)).toEqual({});
    expect(
      listStateToDashboardSearch({
        ...DEFAULT_LIST_STATE,
        tab: "agents",
        q: "vue",
        provider: ZCODE,
        dup: true,
      }),
    ).toEqual({ tab: "agents", q: "vue", provider: ZCODE, duplicates: "1" });
    // scroll/sel/page 永不进 URL search（handoff 面还原）。
    const projected = listStateToDashboardSearch({
      ...DEFAULT_LIST_STATE,
      scroll: 900,
      page: 4,
      sel: SK,
    });
    expect(Object.keys(projected)).toEqual([]);
  });
});
