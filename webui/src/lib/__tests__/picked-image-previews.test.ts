// @vitest-environment jsdom
/**
 * 选中图片缩略回填验收测试（2026-09-15 修复）。
 *
 * 用户原始需求 [2026-09-15]：「缩略图的生成有 BUG，你自己检查一下。」——
 * 根因：R18 换原生文件选择器时只把 {path,name} 写进草稿，preview 字段成了
 * 死通道，composer chip 永远渲染图标占位（daemon 的 agent.files.preview +
 * jSquash 缩略管线从 composer 视角变成不可达代码）。
 *
 * 正交意图：
 *   [1] previewAgentImage：image 投影 → dataUrl；text/binary/无连接/RPC 失败
 *       → null（不伪装成功）。
 *   [2] hydratePickedImagePreviews：缩略到达即回填对应附件；用户已移除的
 *       条目不复活；已带 preview 的条目不覆盖；部分失败不影响其他回填。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  rpc: null as unknown,
}));

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => 0,
  getRpc: () => connection.rpc ?? null,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
}));
vi.mock("../toast.svelte", () => ({ showToast: vi.fn() }));

const previewMock = vi.hoisted(() => vi.fn());

const { previewAgentImage, hydratePickedImagePreviews } = await import("../stores/agent.svelte");
const { agentComposer, resetAllComposerTracks, addPickedComposerImages } =
  await import("../stores/agent-composer.svelte");

function rpcReturning(previewImpl: (input: { path: string }) => Promise<unknown>) {
  previewMock.mockImplementation(previewImpl);
  connection.rpc = { agent: { files: { preview: previewMock } } };
}

beforeEach(() => {
  previewMock.mockReset();
  connection.rpc = null;
  resetAllComposerTracks();
  agentComposer.images = [];
  agentComposer.files = [];
  agentComposer.text = "";
});

describe("previewAgentImage (R17-B 管线重新接回)", () => {
  it("maps the daemon image projection to its dataUrl", async () => {
    rpcReturning(async () => ({
      kind: "image",
      name: "a.png",
      size: 1,
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,AAA",
      width: 64,
      height: 64,
    }));
    await expect(previewAgentImage("/tmp/a.png")).resolves.toBe("data:image/png;base64,AAA");
    expect(previewMock).toHaveBeenCalledWith({ path: "/tmp/a.png" });
  });

  it("maps text/binary projections, failures, and no-connection to null", async () => {
    rpcReturning(async () => ({ kind: "text", name: "a.txt", size: 1, text: "hi" }));
    await expect(previewAgentImage("/tmp/a.txt")).resolves.toBeNull();

    rpcReturning(async () => ({ kind: "binary", name: "b.bin", size: 2 }));
    await expect(previewAgentImage("/tmp/b.bin")).resolves.toBeNull();

    rpcReturning(async () => {
      throw new Error("boom");
    });
    await expect(previewAgentImage("/tmp/x.png")).resolves.toBeNull();

    connection.rpc = null;
    await expect(previewAgentImage("/tmp/y.png")).resolves.toBeNull();
  });
});

describe("hydratePickedImagePreviews (chip 缩略升级)", () => {
  it("fills the matching attachment once the daemon thumbnail arrives", async () => {
    addPickedComposerImages([{ path: "/tmp/one.png", name: "one.png" }]);
    rpcReturning(async (input: { path: string }) =>
      input.path === "/tmp/one.png"
        ? {
            kind: "image",
            name: "one.png",
            size: 9,
            mediaType: "image/png",
            dataUrl: "data:image/png;base4,BBB",
            width: 256,
            height: 256,
          }
        : { kind: "binary", name: "x", size: 0 },
    );
    await hydratePickedImagePreviews([{ path: "/tmp/one.png", name: "one.png" }]);
    expect(agentComposer.images[0]?.preview).toBe("data:image/png;base4,BBB");
  });

  it("does not resurrect attachments the user removed while previews were in flight", async () => {
    // holder 对象：闭包内赋值 + 调用点之间隔函数调用，本地 let 会被 CFA 收窄。
    const gate: { release: ((value: unknown) => void) | null } = { release: null };
    rpcReturning(
      (input: { path: string }) =>
        new Promise((resolve) => {
          gate.release = () =>
            resolve({
              kind: "image",
              name: "z",
              size: 1,
              mediaType: "image/png",
              dataUrl: `data:x;${input.path}`,
              width: 8,
              height: 8,
            });
        }),
    );
    addPickedComposerImages([{ path: "/tmp/z.png", name: "z.png" }]);
    const pending = hydratePickedImagePreviews([{ path: "/tmp/z.png", name: "z.png" }]);
    // 预览在途时用户移除了附件。
    agentComposer.images = [];
    gate.release?.(undefined);
    await pending;
    expect(agentComposer.images).toHaveLength(0);
  });

  it("leaves entries that already carry a preview untouched and tolerates partial failures", async () => {
    addPickedComposerImages([
      { path: "/tmp/a.png", name: "a.png", preview: "data:image/png;base64,KEEP" },
      { path: "/tmp/b.png", name: "b.png" },
    ]);
    rpcReturning(async (input: { path: string }) => {
      if (input.path === "/tmp/b.png") throw new Error("offline");
      return {
        kind: "image",
        name: "a",
        size: 1,
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,NEW",
        width: 8,
        height: 8,
      };
    });
    await hydratePickedImagePreviews([
      { path: "/tmp/a.png", name: "a.png" },
      { path: "/tmp/b.png", name: "b.png" },
    ]);
    expect(agentComposer.images[0]?.preview).toBe("data:image/png;base64,KEEP");
    expect(agentComposer.images[1]?.preview).toBeUndefined();
  });
});
