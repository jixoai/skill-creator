// @vitest-environment jsdom
/**
 * FilePickerDialog 组件测试（R17-B 后端文件选择器）。
 *
 * 用户原始需求 [2026-09-13]：「文件选择器、图片选择器，不要基于 web，而是基于
 * 后端，这样能拿到真实的路径，前端也能更轻。」——弹层消费 agent.files.* RPC
 * 浏览后端文件系统并交回真实路径；图片选中即拉 daemon 缩略。
 *
 * 正交意图：
 *   [1] 列表渲染与导航：open 即 list(startDir)；目录行点击进入（join 后再
 *       list）；RPC 失败进错误条。
 *   [2] 守卫与选择：image 模式扩展名 + 4MiB 门（守卫文案沿用 composer）；
 *       file 模式 512KiB 门 + ≤2 数量上限；确认把真实路径（+缩略 dataURL）
 *       交回 onConfirm 并收起弹层。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  rpc: null as unknown,
}));
const toast = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock("../stores/connection.svelte", () => ({
  getRpc: () => connection.rpc ?? null,
}));
vi.mock("../toast.svelte", () => ({
  showToast: toast.showToast,
}));

// @lucide/svelte 图标 = node_modules 的 .svelte（管线不编译）——空壳替换。
vi.mock("@lucide/svelte/icons/folder", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file-text", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/image", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/chevron-right",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock(
  "@lucide/svelte/icons/chevron-up",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/x", async () => await import("./stubs/lucide-icon-mocks.js"));

// bits-ui dialog 不可编译——本地 stub（Root 以 bind:open 门控渲染）。
vi.mock("$lib/components/ui/dialog", async () => {
  const Root = (await import("./stubs/dialog-stub/Root.svelte")).default;
  const Content = (await import("./stubs/dialog-stub/Content.svelte")).default;
  const Header = (await import("./stubs/dialog-stub/Header.svelte")).default;
  const Title = (await import("./stubs/dialog-stub/Title.svelte")).default;
  const Description = (await import("./stubs/dialog-stub/Description.svelte")).default;
  const Footer = (await import("./stubs/dialog-stub/Footer.svelte")).default;
  return {
    Dialog: Root,
    Root,
    Content,
    Header,
    Title,
    Description,
    Footer,
    // FilePickerDialog 只消费以上六个导出；其余保持未定义即不被渲染。
  };
});

import FilePickerDialog from "../components/agent/FilePickerDialog.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

const listMock = vi.fn();
const previewMock = vi.fn();
const onConfirm = vi.fn();

const IMAGE_MODE_LIST = {
  dir: "/tmp/proj",
  parent: "/tmp",
  entries: [
    { name: "sub", kind: "dir" as const },
    { name: "a.png", kind: "file" as const, size: 2048 },
    { name: "notes.txt", kind: "file" as const, size: 128 },
    { name: "big.png", kind: "file" as const, size: 5 * 1024 * 1024 },
  ],
};

const IMAGE_PREVIEW = {
  kind: "image" as const,
  name: "a.png",
  size: 2048,
  mediaType: "image/png" as const,
  dataUrl: "data:image/png;base64,QUJD",
  width: 8,
  height: 8,
};

function mountDialog(props: Record<string, unknown> = {}) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(FilePickerDialog, {
    target,
    props: { mode: "image", open: true, onConfirm, ...props },
  });
  flushSync();
  return {
    row: (name: string) => document.querySelector<HTMLButtonElement>(`[data-entry-name='${name}']`),
    confirmButton: () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.startsWith("Add "),
      ),
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

beforeEach(() => {
  listMock.mockReset();
  previewMock.mockReset();
  onConfirm.mockReset();
  toast.showToast.mockReset();
  listMock.mockResolvedValue(IMAGE_MODE_LIST);
  previewMock.mockResolvedValue(IMAGE_PREVIEW);
  connection.rpc = { agent: { files: { list: listMock, preview: previewMock } } };
});

describe("FilePickerDialog list & navigation", () => {
  it("lists the start directory on open and renders entries with kind markers", async () => {
    const ctx = mountDialog({ startDir: "/tmp/proj" });
    await vi.waitFor(() => expect(ctx.row("sub")).not.toBeNull());
    expect(listMock).toHaveBeenCalledWith({ dir: "/tmp/proj" });
    expect(ctx.row("sub")?.dataset.entryKind).toBe("dir");
    expect(ctx.row("a.png")?.dataset.entryKind).toBe("file");
    // 目录优先的渲染顺序（服务端排序的直投）。
    const names = [...document.querySelectorAll("[data-entry-name]")].map(
      (node) => (node as HTMLElement).dataset.entryName,
    );
    expect(names).toEqual(["sub", "a.png", "notes.txt", "big.png"]);
    ctx.cleanup();
  });

  it("navigates into directories by joining the listed dir with the entry name", async () => {
    const ctx = mountDialog();
    await vi.waitFor(() => expect(ctx.row("sub")).not.toBeNull());
    ctx.row("sub")?.click();
    flushSync();
    expect(listMock).toHaveBeenLastCalledWith({ dir: "/tmp/proj/sub" });
    ctx.cleanup();
  });

  it("surfaces list failures as an inline alert", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    const ctx = mountDialog();
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("boom"),
    );
    ctx.cleanup();
  });
});

describe("FilePickerDialog image-mode guards & confirm", () => {
  it("blocks non-image and oversize rows with the composer guard copies", async () => {
    const ctx = mountDialog();
    await vi.waitFor(() => expect(ctx.row("notes.txt")).not.toBeNull());

    ctx.row("notes.txt")?.click();
    expect(toast.showToast).toHaveBeenCalledWith("Not an image file");

    ctx.row("big.png")?.click();
    expect(toast.showToast).toHaveBeenCalledWith('"big.png" exceeds the 4MiB limit.');
    expect(previewMock).not.toHaveBeenCalled();
    ctx.cleanup();
  });

  it("selects an image, loads its daemon thumbnail, and confirms with the real path", async () => {
    const ctx = mountDialog();
    await vi.waitFor(() => expect(ctx.row("a.png")).not.toBeNull());

    ctx.row("a.png")?.click();
    flushSync();
    expect(ctx.row("a.png")?.getAttribute("aria-pressed")).toBe("true");
    expect(previewMock).toHaveBeenCalledWith({ path: "/tmp/proj/a.png" });

    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Selected files"] img')).not.toBeNull(),
    );
    expect(
      (document.querySelector('[aria-label="Selected files"] img') as HTMLImageElement).src,
    ).toBe("data:image/png;base64,QUJD");

    ctx.confirmButton()?.click();
    flushSync();
    expect(onConfirm).toHaveBeenCalledWith([
      { path: "/tmp/proj/a.png", name: "a.png", preview: "data:image/png;base64,QUJD" },
    ]);
    // 确认后收起（Root stub 以 open 门控——内容从 DOM 消失）。
    expect(document.querySelector("[data-stub='dialog-root']")).toBeNull();
    ctx.cleanup();
  });
});

describe("FilePickerDialog file-mode caps", () => {
  it("caps selection at 2 files and forwards plain paths without previews", async () => {
    listMock.mockResolvedValue({
      dir: "/tmp/docs",
      parent: "/tmp",
      entries: [
        { name: "a.md", kind: "file" as const, size: 10 },
        { name: "b.md", kind: "file" as const, size: 20 },
        { name: "c.md", kind: "file" as const, size: 30 },
        { name: "huge.bin", kind: "file" as const, size: 600 * 1024 },
      ],
    });
    const ctx = mountDialog({ mode: "file" });
    await vi.waitFor(() => expect(ctx.row("c.md")).not.toBeNull());

    ctx.row("huge.bin")?.click();
    expect(toast.showToast).toHaveBeenCalledWith('"huge.bin" exceeds the 512KiB limit.');

    for (const name of ["a.md", "b.md", "c.md"]) {
      ctx.row(name)?.click();
      flushSync();
    }
    expect(toast.showToast).toHaveBeenCalledWith("At most 2 file attachments per message.");

    ctx.confirmButton()?.click();
    flushSync();
    expect(onConfirm).toHaveBeenCalledWith([
      { path: "/tmp/docs/a.md", name: "a.md" },
      { path: "/tmp/docs/b.md", name: "b.md" },
    ]);
    ctx.cleanup();
  });
});
