/**
 * 路由 slug 编号规则测试（codex R8 B5：稀疏编号回归）。
 *
 * 用户原始需求 [2026-09-12]：「这种同名的我们自动加上 `(1)`，去累加最后一个
 * `(\d)` 里面的数字就行」——编号取现有最大值 +1，不回填空洞。
 *
 * 正交意图：
 *   [1] slug 累加：连续与稀疏编号序列都按 max+1 递增。
 *   [2] 展示名：编号 slug 投影 `目录label (n-1)`；基础/未知回退。
 */
import { describe, expect, it } from "vitest";
import {
  nextRouteSlug,
  numberedSlugParts,
  routeDisplayLabel,
} from "../components/settings/route-naming.js";

const routes = (...providers: string[]) => providers.map((provider) => ({ provider }));

describe("nextRouteSlug（累加最后一个数字，codex R8 B5）", () => {
  it("returns the provider unchanged when unclaimed", () => {
    expect(nextRouteSlug("zai", routes("deepseek"))).toBe("zai");
  });

  it("numbers from 2 on the first duplicate", () => {
    expect(nextRouteSlug("zai", routes("zai"))).toBe("zai-2");
  });

  it("increments the max suffix on contiguous sequences", () => {
    expect(nextRouteSlug("zai", routes("zai", "zai-2", "zai-3"))).toBe("zai-4");
  });

  it("increments past the max on sparse numbering (no hole backfill)", () => {
    expect(nextRouteSlug("zai", routes("zai", "zai-2", "zai-4"))).toBe("zai-5");
    expect(nextRouteSlug("zai", routes("zai", "zai-7"))).toBe("zai-8");
  });

  it("ignores suffixes of other providers", () => {
    expect(nextRouteSlug("zai", routes("zai", "deepseek-9", "xai-99"))).toBe("zai-2");
  });
});

describe("numberedSlugParts / routeDisplayLabel", () => {
  it("parses numbered slugs and rejects n<2 or unnumbered", () => {
    expect(numberedSlugParts("zai-2")).toEqual({ base: "zai", n: 2 });
    expect(numberedSlugParts("zai-1")).toBeNull();
    expect(numberedSlugParts("zai")).toBeNull();
  });

  it("projects numbered slugs to catalog label (n-1) and falls back otherwise", () => {
    const catalog = {
      providers: [
        {
          provider: "zai",
          label: "Z.ai",
          api: "x",
          baseURL: "y",
          icon: null,
          models: [{ id: "m", image: false }],
        },
      ],
    };
    expect(routeDisplayLabel({ provider: "zai-5" }, catalog)).toBe("Z.ai (4)");
    expect(routeDisplayLabel({ provider: "zai" }, catalog)).toBe("Z.ai");
    expect(routeDisplayLabel({ provider: "unknown-x" }, catalog)).toBe("unknown-x");
  });
});
