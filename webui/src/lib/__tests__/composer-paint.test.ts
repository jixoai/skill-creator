// @vitest-environment jsdom
/**
 * ChipPaintLayer 镜像绘制层测试（composer-references C1）。
 *
 * 正交意图：
 *   [1] 芯片 span 契约：文本逐字一致（镜像 1:1）、data-composer-chip 分型、
 *       aria-hidden 纯装饰。
 *   [2] 文本透明：层内文本本体不可见（textarea 绘制），只有底色成芯片。
 */
import { describe, expect, it } from "vitest";
import ChipPaintLayer from "$lib/components/agent/ChipPaintLayer.svelte";
import {
  resolveChipOccurrences,
  type ComposerReference,
} from "$lib/components/agent/composer-chips";
import { flushSync, mount, unmount } from "./svelte-client";

const refs: ComposerReference[] = [
  { uid: 1, kind: "file", token: "@spec.md", target: "/a/spec.md", label: "spec.md" },
];

function mountLayer(text: string) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ChipPaintLayer, {
    target,
    props: { text, occurrences: resolveChipOccurrences(text, refs), heightPx: 44 },
  });
  flushSync();
  return {
    layer: () => document.querySelector<HTMLElement>("[data-composer-chip]")?.parentElement ?? null,
    chip: () => document.querySelector<HTMLElement>("[data-composer-chip]"),
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

describe("ChipPaintLayer (C1)", () => {
  it("paints chip spans with identical text and kind data attributes", () => {
    const ctx = mountLayer("see @spec.md now");
    const chip = ctx.chip();
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-composer-chip")).toBe("file");
    expect(chip?.textContent).toBe("@spec.md");
    expect(chip?.getAttribute("title")).toBe("/a/spec.md");
    ctx.cleanup();
  });

  it("renders the layer transparent and decorative", () => {
    const ctx = mountLayer("@spec.md");
    const layer = ctx.layer();
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    // 透明文本契约（jsdom 无 Tailwind → 工具类断言）。
    expect(layer?.classList.contains("text-transparent")).toBe(true);
    ctx.cleanup();
  });

  it("renders no chip spans for plain text", () => {
    const ctx = mountLayer("no references here");
    expect(ctx.chip()).toBeNull();
    ctx.cleanup();
  });
});
