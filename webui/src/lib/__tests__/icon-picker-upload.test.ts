// @vitest-environment jsdom
/**
 * IconPicker 组件测试（R7 8.1 去重 + 8.2 三控制 + 8.3 上传修复）。
 * 用户原始需求 [2026-09-12]：「目录网格按 dataURL 去重，相同图标只显示一次，
 * hover/aria 可标注共享者」；「三个独立控制：图标（含无图标）、颜色（色板 +
 * hex）、Letter（1-2 字符可编辑）」；「svg 上传不工作（读取/校验/回填链路
 * bug）——支持 .svg（image/svg+xml dataURL），沿用 64KiB 上限与清晰提示」。
 * 正交意图：
 *   [1] 上传链路：svg 复现（空 MIME → octet-stream dataURL 的根因）+ 尺寸拒绝
 *       + input 复位。
 *   [2] 目录去重：相同 dataURL 的多 provider 合并一格，aria 标注共享者。
 *   [3] 三控制：No icon / Auto 色 / 色板 / hex 校验 / Letter 编辑与 Reset 的
 *       onPick/onColor/onLetter 提交面。
 */
import { describe, expect, it, vi } from "vitest";

const toasts: string[] = [];
vi.mock("$lib/toast.svelte", () => ({
  showToast: (message: string) => {
    toasts.push(message);
  },
}));

vi.mock("@lucide/svelte/icons/pencil", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/upload", async () => await import("./stubs/lucide-icon-mocks.js"));

import IconPicker from "$lib/components/settings/IconPicker.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

const SVG_SOURCE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/></svg>';
const OTHER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3"/></svg>';
const SHARED_DATAURL = `data:image/svg+xml;utf8,${encodeURIComponent(SVG_SOURCE)}`;
const OTHER_DATAURL = `data:image/svg+xml;utf8,${encodeURIComponent(OTHER_SVG)}`;

function mountPicker(
  props: Partial<{
    icon: string | null;
    letter: string;
    color: string;
    provider: string;
    label: string;
    catalogIcons: Array<{ provider: string; icon: string }>;
    onColor: (color: string | undefined) => void;
    onLetter: (letter: string | undefined) => void;
  }> = {},
) {
  const onPick = vi.fn<(icon: string | undefined) => void>();
  const onColor = props.onColor ?? vi.fn<(color: string | undefined) => void>();
  const onLetter = props.onLetter ?? vi.fn<(letter: string | undefined) => void>();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(IconPicker, {
    target,
    props: {
      icon: props.icon ?? null,
      letter: props.letter ?? "Z",
      color: props.color ?? "hsl(0 55% 45%)",
      provider: props.provider ?? "my-relay",
      label: props.label ?? "My Relay",
      catalogIcons: props.catalogIcons ?? [],
      onPick,
      onColor,
      onLetter,
    },
  });
  flushSync();
  const open = (): void => {
    target.querySelector<HTMLButtonElement>('button[aria-label="Change route icon"]')!.click();
    flushSync();
  };
  open();
  return {
    onPick,
    onColor,
    onLetter,
    target,
    open,
    gridButtons: () =>
      [...target.querySelectorAll('button[aria-label^="Use icon"]')] as HTMLButtonElement[],
    noIconButton: () =>
      target.querySelector<HTMLButtonElement>('button[aria-label="No icon (letter avatar)"]')!,
    fileInput: () =>
      target.querySelector<HTMLInputElement>('input[aria-label="Upload custom icon"]')!,
    letterInput: () => target.querySelector<HTMLInputElement>('input[aria-label="Avatar letter"]')!,
    hexInput: () => target.querySelector<HTMLInputElement>('input[aria-label="Avatar color hex"]')!,
    autoColorButton: () =>
      target.querySelector<HTMLButtonElement>('button[aria-label="Auto avatar color"]')!,
    paletteButtons: () =>
      [...target.querySelectorAll('button[aria-label^="Avatar color #"]')] as HTMLButtonElement[],
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

function setFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
}

async function settleReader(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  flushSync();
}

function typeValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function blur(input: HTMLInputElement): void {
  input.dispatchEvent(new Event("blur"));
  flushSync();
}

describe("IconPicker upload (R7 8.3)", () => {
  it("repro: .svg File with empty MIME still yields an image/svg+xml dataURL", async () => {
    // 真实浏览器常见路径：从 Figma/网页拖出的 svg 文件 File.type === ""，
    // readAsDataURL 产出 data:;base64（无 MIME）→ <img> 拒绝渲染 → 「上传不工作」。
    toasts.length = 0;
    const ctx = mountPicker();
    setFile(ctx.fileInput(), new File([SVG_SOURCE], "icon.svg", { type: "" }));
    await settleReader();

    const picked = ctx.onPick.mock.calls[0]?.[0];
    expect(picked).toBeDefined();
    expect(picked).toMatch(/^data:image\/svg\+xml/);
    expect(toasts).toEqual([]);
    ctx.cleanup();
  });

  it("reads an .svg upload into an image/svg+xml dataURL and calls onPick", async () => {
    toasts.length = 0;
    const ctx = mountPicker();
    setFile(ctx.fileInput(), new File([SVG_SOURCE], "icon.svg", { type: "image/svg+xml" }));
    await settleReader();

    expect(ctx.onPick).toHaveBeenCalledTimes(1);
    const picked = ctx.onPick.mock.calls[0]![0];
    expect(picked).toMatch(/^data:image\/svg\+xml/);
    expect((picked ?? "").length).toBeLessThanOrEqual(64 * 1024);
    expect(toasts).toEqual([]);
    ctx.cleanup();
  });

  it("rejects uploads above the 64KiB limit with a toast and no onPick", async () => {
    toasts.length = 0;
    const ctx = mountPicker();
    // base64 膨胀 4/3：>48KiB 原始字节即稳定越过 64KiB dataURL 预算。
    setFile(
      ctx.fileInput(),
      new File(["x".repeat(56 * 1024)], "big.svg", { type: "image/svg+xml" }),
    );
    await settleReader();

    expect(ctx.onPick).not.toHaveBeenCalled();
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toMatch(/64 ?KiB/i);
    ctx.cleanup();
  });

  it("rejects unsupported file types with a clear toast", async () => {
    toasts.length = 0;
    const ctx = mountPicker();
    setFile(ctx.fileInput(), new File([SVG_SOURCE], "icon.gif", { type: "image/gif" }));
    await settleReader();
    expect(ctx.onPick).not.toHaveBeenCalled();
    expect(toasts[0]).toMatch(/Unsupported icon type/i);
    ctx.cleanup();
  });

  it("resets the file input after reading so the same file can retrigger change", async () => {
    toasts.length = 0;
    const ctx = mountPicker();
    const input = ctx.fileInput();
    setFile(input, new File([SVG_SOURCE], "icon.svg", { type: "image/svg+xml" }));
    await settleReader();
    expect(input.value).toBe("");
    ctx.cleanup();
  });
});

describe("IconPicker catalog dedup (R7 8.1)", () => {
  it("merges duplicate dataURLs into one grid cell and lists sharing providers in aria", () => {
    const ctx = mountPicker({
      catalogIcons: [
        { provider: "zai", icon: SHARED_DATAURL },
        { provider: "zai-coding", icon: SHARED_DATAURL },
        { provider: "zai-coding-cn", icon: SHARED_DATAURL },
        { provider: "deepseek", icon: OTHER_DATAURL },
      ],
    });
    const buttons = ctx.gridButtons();
    expect(buttons.length).toBe(2);
    const shared = buttons.find((b) => b.getAttribute("aria-label")?.includes("zai-coding"))!;
    expect(shared.getAttribute("aria-label")).toBe(
      "Use icon shared by zai, zai-coding, zai-coding-cn",
    );
    expect(shared.getAttribute("title")).toBe("zai, zai-coding, zai-coding-cn");
    // 点击共享格提交的是同一 dataURL。
    shared.click();
    flushSync();
    expect(ctx.onPick).toHaveBeenCalledWith(SHARED_DATAURL);
    ctx.cleanup();
  });

  it("sorts the own provider's icon first", () => {
    const ctx = mountPicker({
      provider: "deepseek",
      catalogIcons: [
        { provider: "zai", icon: SHARED_DATAURL },
        { provider: "deepseek", icon: OTHER_DATAURL },
      ],
    });
    const first = ctx.gridButtons()[0]!;
    expect(first.getAttribute("aria-label")).toContain("deepseek");
    ctx.cleanup();
  });
});

describe("IconPicker three controls (R7 8.2)", () => {
  it("No icon clears the override via onPick(undefined)", () => {
    const ctx = mountPicker({ icon: SHARED_DATAURL });
    ctx.noIconButton().click();
    flushSync();
    expect(ctx.onPick).toHaveBeenCalledWith(undefined);
    ctx.cleanup();
  });

  it("Auto color clears iconColor; palette swatches commit hex", () => {
    const ctx = mountPicker({ color: "#3b82f6" });
    ctx.paletteButtons()[0]!.click();
    flushSync();
    expect(ctx.onColor).toHaveBeenCalledWith("#ef4444");

    ctx.autoColorButton().click();
    flushSync();
    expect(ctx.onColor).toHaveBeenCalledWith(undefined);
    ctx.cleanup();
  });

  it("commits valid hex on blur, rejects invalid with a red hint and no commit", () => {
    const ctx = mountPicker();
    typeValue(ctx.hexInput(), "#12gz89");
    blur(ctx.hexInput());
    expect(ctx.onColor).not.toHaveBeenCalled();
    expect(ctx.target.textContent).toContain("invalid hex");

    typeValue(ctx.hexInput(), "#10b981");
    blur(ctx.hexInput());
    expect(ctx.onColor).toHaveBeenCalledWith("#10b981");
    ctx.cleanup();
  });

  it("commits edited letters (up to 2 chars) and resets to the default", () => {
    const ctx = mountPicker({ letter: "Z" });
    typeValue(ctx.letterInput(), "AI");
    blur(ctx.letterInput());
    expect(ctx.onLetter).toHaveBeenCalledWith("AI");

    typeValue(ctx.letterInput(), "abc");
    blur(ctx.letterInput());
    expect(ctx.onLetter).toHaveBeenLastCalledWith("ab");

    ctx.target
      .querySelector<HTMLButtonElement>('button[title^="Reset to the first letter"]')!
      .click();
    flushSync();
    expect(ctx.onLetter).toHaveBeenLastCalledWith(undefined);
    ctx.cleanup();
  });
});
