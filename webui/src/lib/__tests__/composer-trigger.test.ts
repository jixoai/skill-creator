/**
 * Composer 触发检测内核单测（openspec composer-capability-parity W3）。
 *
 * 正交意图：
 *   [1] URL 剔除文法（`//` 协议相对、`://` scheme）。
 *   [2] claim 机：Space/Enter 落 claim、前缀存活、提交剥离、压制判定。
 */
import { describe, expect, it } from "vitest";
import {
  claimOnEnter,
  claimOnSpace,
  claimSurvives,
  slashQuery,
  slashSuppressedByClaim,
  stripClaimedToken,
} from "$lib/components/agent/composer-trigger.js";

describe("slashQuery URL carve-outs (W3)", () => {
  it("returns the line for a plain slash query", () => {
    expect(slashQuery("/compact")).toBe("/compact");
    expect(slashQuery("/rev some args")).toBe("/rev some args");
  });

  it("carves out protocol-relative URLs", () => {
    expect(slashQuery("//example.com/path")).toBe("");
  });

  it("carves out scheme URLs at the trigger position, not in later args", () => {
    // 触发位紧跟 scheme（"/"+URL 形态）→ 剔除。
    expect(slashQuery("/https://x")).toBe("");
    expect(slashQuery("https://example.com")).toBe("");
    // args 里的 URL 不影响触发位——命令/技能补全照常。
    expect(slashQuery("/see https://example.com docs")).toBe("/see https://example.com docs");
  });

  it("returns empty for non-slash lines", () => {
    expect(slashQuery("hello")).toBe("");
    expect(slashQuery("")).toBe("");
  });
});

describe("claim machine (W3)", () => {
  const tokens = ["/role ", "/plan "] as const;

  it("claims on a complete leading token followed by a space (matchSpace)", () => {
    expect(claimOnSpace("/role ", tokens)).toEqual({ token: "/role " });
    expect(claimOnSpace("/role review the library", tokens)).toEqual({ token: "/role " });
  });

  it("does not claim incomplete tokens or non-commands", () => {
    expect(claimOnSpace("/rol", tokens)).toBeNull();
    expect(claimOnSpace("/compact ", tokens)).toBeNull();
    expect(claimOnSpace("plain text", tokens)).toBeNull();
  });

  it("claim survives while the draft keeps the token prefix (backspace exits)", () => {
    const claim = { token: "/role " };
    expect(claimSurvives(claim, "/role do the thing")).toEqual(claim);
    expect(claimSurvives(claim, "/role")).toBeNull();
    expect(claimSurvives(claim, "rewritten draft")).toBeNull();
    expect(claimSurvives(null, "/role x")).toBeNull();
  });

  it("strips the claimed token at submit time leaving only args", () => {
    expect(stripClaimedToken("/role review it", { token: "/role " })).toBe("review it");
    expect(stripClaimedToken("/role ", { token: "/role " })).toBe("");
    // claim 不再前缀匹配时 passthrough（防御）。
    expect(stripClaimedToken("other text", { token: "/role " })).toBe("other text");
    expect(stripClaimedToken("any text", null)).toBe("any text");
  });

  it("claimed state suppresses the slash trigger; null does not", () => {
    expect(slashSuppressedByClaim({ token: "/role " })).toBe(true);
    expect(slashSuppressedByClaim(null)).toBe(false);
  });

  it("matchEnter mirrors matchSpace for the sync projection", () => {
    expect(claimOnEnter("/plan make tea", tokens)).toEqual({ token: "/plan " });
    expect(claimOnEnter("/nope args", tokens)).toBeNull();
  });
});
