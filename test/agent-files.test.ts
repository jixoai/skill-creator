// @vitest-environment node
/**
 * 后端文件选择器服务测试（R17-B）。
 *
 * 用户原始需求 [2026-09-13]：「文件选择器、图片选择器，不要基于 web，而是基于
 * 后端，这样能拿到真实的路径，前端也能更轻。后端也需要提供前端所需的预览视图
 * 处理，使用 jSquash 这个库。」
 *
 * 正交意图：
 *   [1] 目录浏览：默认起始目录/相对路径拒绝/排序（目录优先）/parent 链/缺失与
 *       非目录 typed 错误/截断标记。
 *   [2] 预览管线：png/jpeg（jSquash 解码→≤256 缩略→按源类型回编）真实 wasm 走
 *       通；文本 4KiB 头 + 截断；NUL/超大/webp 降级 binary；目录/缺失 typed 错误。
 *   [3] prompt path 通道：读盘 + magic 嗅探 + 大小守卫（4MiB/512KiB 同文案）；
 *       base64 通道原样透传；畸形输入 typed 拒绝。
 *   [4] 契约收窄：AgentSessionPromptInputSchema 双通道 strict（互斥、越限拒绝）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encode as encodeJpeg } from "@jsquash/jpeg";
import encodePng from "@jsquash/png/encode.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentFilesService } from "../src/daemon/agent-files.js";
import { ensureImageCodecs } from "../src/daemon/image-codec.js";
import { DomainError } from "../src/daemon/domain-error.js";
import {
  AgentSessionPromptInputSchema,
  AgentFilesListResultSchema,
  AgentFilesPreviewResultSchema,
} from "../src/shared/contracts/agent.js";

let sandbox = "";
let service: ReturnType<typeof createAgentFilesService>;
const defaultDir = () => sandbox;

function rgba(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { data, width, height };
}

let fixturePng: Uint8Array;
let fixtureJpeg: Uint8Array;

beforeEach(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-agent-files-"));
  service = createAgentFilesService({ defaultDir });
  // Node 下 jsquash 默认 init 走 fetch 必败（见 image-codec 模块头）——fixture
  // 生成前先显式注入 wasm（与被测服务共享同一模块级缓存）。
  await ensureImageCodecs();
  // 真实 codec 产出 fixture（png 300x200 → 缩略路径必经 resize；jpeg 120x90）。
  if (fixturePng === undefined) {
    fixturePng = new Uint8Array(await encodePng(rgba(300, 200, [220, 30, 60, 255])));
  }
  if (fixtureJpeg === undefined) {
    fixtureJpeg = new Uint8Array(await encodeJpeg(rgba(120, 90, [30, 60, 220, 255])));
  }
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function expectDomainError(run: () => Promise<unknown>, code: string, message: RegExp) {
  return expect(run).rejects.toSatisfy((error: unknown) => {
    expect(error).toBeInstanceOf(DomainError);
    const domainError = error as DomainError;
    expect(domainError.code).toBe(code);
    expect(domainError.message).toMatch(message);
    return true;
  });
}

describe("agent files browsing (list)", () => {
  it("starts at the injected default directory and sorts dirs first", async () => {
    fs.mkdirSync(path.join(sandbox, "zed-dir"));
    fs.writeFileSync(path.join(sandbox, "alpha.txt"), "hello world");
    fs.writeFileSync(path.join(sandbox, "beta.bin"), Buffer.from([0, 1, 2]));
    const result = await service.list({});
    expect(AgentFilesListResultSchema.parse(result)).toEqual(result);
    // macOS 临时目录 realpath 带 /private 前缀——canonical 真相以 realpath 为准。
    const canonicalSandbox = fs.realpathSync(sandbox);
    expect(result.dir).toBe(canonicalSandbox);
    expect(result.parent).toBe(path.dirname(canonicalSandbox));
    expect(result.entries.map((entry) => entry.name)).toEqual(["zed-dir", "alpha.txt", "beta.bin"]);
    expect(result.entries[0]).toEqual({ name: "zed-dir", kind: "dir" });
    expect(result.entries[1]?.kind).toBe("file");
    expect(result.entries[1]?.size).toBe(11);
  });

  it("accepts an explicit absolute dir and rejects relative paths", async () => {
    const nested = path.join(sandbox, "nested");
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, "only.md"), "# doc");
    const result = await service.list({ dir: nested });
    expect(result.dir).toBe(fs.realpathSync(nested));
    expect(result.entries).toEqual([{ name: "only.md", kind: "file", size: 5 }]);

    await expectDomainError(
      () => service.list({ dir: "relative/path" }),
      "INVALID_OPERATION",
      /absolute directory path required/,
    );
  });

  it("maps missing dirs and files-as-dirs to typed NOT_FOUND", async () => {
    await expectDomainError(
      () => service.list({ dir: path.join(sandbox, "missing") }),
      "NOT_FOUND",
      /directory not found/,
    );
    const file = path.join(sandbox, "file.txt");
    fs.writeFileSync(file, "x");
    await expectDomainError(() => service.list({ dir: file }), "NOT_FOUND", /not a directory/);
  });

  it("marks oversized listings as truncated at the 2000-entry bound", async () => {
    const big = path.join(sandbox, "big");
    fs.mkdirSync(big);
    for (let i = 0; i < 2050; i += 1) {
      fs.writeFileSync(path.join(big, `f${String(i).padStart(4, "0")}.txt`), "x");
    }
    const result = await service.list({ dir: big });
    expect(result.entries).toHaveLength(2000);
    expect(result.truncated).toBe(true);
  });
});

describe("agent files preview (jSquash pipeline)", () => {
  it("decodes, shrinks to ≤256px long edge, and re-encodes png sources as png", async () => {
    const target = path.join(sandbox, "photo.png");
    fs.writeFileSync(target, fixturePng);
    const result = await service.preview({ path: target });
    const parsed = AgentFilesPreviewResultSchema.parse(result);
    expect(parsed.kind).toBe("image");
    if (parsed.kind !== "image") return;
    expect(parsed.name).toBe("photo.png");
    expect(parsed.mediaType).toBe("image/png");
    expect(parsed.size).toBe(fixturePng.byteLength);
    expect(parsed.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    // 300x200 → 长边 256：等比 256x171（round(200*256/300)=171）。
    expect(parsed.width).toBe(256);
    expect(parsed.height).toBe(171);
  });

  it("keeps jpeg sources as jpeg and skips resize when already within 256px", async () => {
    const target = path.join(sandbox, "shot.jpeg");
    fs.writeFileSync(target, fixtureJpeg);
    const result = await service.preview({ path: target });
    expect(result.kind).toBe("image");
    if (result.kind !== "image") return;
    expect(result.mediaType).toBe("image/jpeg");
    expect(result.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(result.width).toBe(120);
    expect(result.height).toBe(90);
  });

  it("returns a text head (≤4KiB) with an explicit truncated flag", async () => {
    const target = path.join(sandbox, "notes.md");
    fs.writeFileSync(target, "a".repeat(5000));
    const result = await service.preview({ path: target });
    expect(result).toMatchObject({
      kind: "text",
      name: "notes.md",
      size: 5000,
      truncated: true,
    });
    if (result.kind !== "text") return;
    expect(result.text).toBe("a".repeat(4096));
  });

  it("degrades NUL-containing, oversized, and codec-less inputs to binary", async () => {
    const nulFile = path.join(sandbox, "blob.bin");
    fs.writeFileSync(nulFile, Buffer.from([0x68, 0x00, 0x69]));
    expect(await service.preview({ path: nulFile })).toEqual({
      kind: "binary",
      name: "blob.bin",
      size: 3,
    });

    // 超过 8MiB 预览守卫（png magic 但跳过图片通道 → 文本通道 NUL → binary）。
    const huge = path.join(sandbox, "huge.png");
    const hugeBuffer = Buffer.alloc(8 * 1024 * 1024 + 1, 0);
    hugeBuffer.set(fixturePng.subarray(0, 8), 0);
    fs.writeFileSync(huge, hugeBuffer);
    expect(await service.preview({ path: huge })).toMatchObject({ kind: "binary" });

    // gif：magic 是图片但无 codec——binary 投影（不伪装成功预览）。
    const gif = path.join(sandbox, "anim.gif");
    fs.writeFileSync(gif, Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]));
    expect(await service.preview({ path: gif })).toMatchObject({ kind: "binary" });
  });

  it("maps relative paths, directories, and missing files to typed errors", async () => {
    await expectDomainError(
      () => service.preview({ path: "rel.png" }),
      "INVALID_OPERATION",
      /absolute preview path required/,
    );
    await expectDomainError(
      () => service.preview({ path: sandbox }),
      "INVALID_OPERATION",
      /not a regular preview file/,
    );
    await expectDomainError(
      () => service.preview({ path: path.join(sandbox, "nope.png") }),
      "NOT_FOUND",
      /preview not found/,
    );
  });
});

describe("prompt attachment path channel (resolvePromptAttachments)", () => {
  it("passes base64 attachments through untouched", async () => {
    const resolved = await service.resolvePromptAttachments({
      images: [{ mediaType: "image/png", data: "aGk=", name: "pasted.png" }],
      files: [{ name: "notes.txt", data: "aGk=" }],
    });
    expect(resolved.images).toEqual([{ mediaType: "image/png", data: "aGk=", name: "pasted.png" }]);
    expect(resolved.files).toEqual([{ name: "notes.txt", data: "aGk=" }]);
  });

  it("reads path images from disk with magic-byte mediaType sniffing", async () => {
    const target = path.join(sandbox, "cam-photo.dat"); // 扩展名故意无意义。
    fs.writeFileSync(target, fixtureJpeg);
    const resolved = await service.resolvePromptAttachments({
      images: [{ path: target }],
      files: [],
    });
    expect(resolved.images).toHaveLength(1);
    expect(resolved.images[0]?.mediaType).toBe("image/jpeg");
    expect(resolved.images[0]?.name).toBe("cam-photo.dat");
    expect(resolved.images[0]?.data).toBe(Buffer.from(fixtureJpeg).toString("base64"));
  });

  it("reads path files from disk (name = basename, base64 payload)", async () => {
    const target = path.join(sandbox, "spec.md");
    fs.writeFileSync(target, "# spec");
    const resolved = await service.resolvePromptAttachments({
      images: [],
      files: [{ path: target }],
    });
    expect(resolved.files).toEqual([
      { name: "spec.md", data: Buffer.from("# spec").toString("base64") },
    ]);
  });

  it("enforces the 4MiB image / 512KiB file limits with composer-guard copies", async () => {
    const bigImage = path.join(sandbox, "big.png");
    fs.writeFileSync(bigImage, fixturePng);
    // 直接绕过 stat 的捷径不存在——写一个真实超过 4MiB 的 png（padding 进 IDAT
    // 之外的尾部不影响 magic 嗅探，但大小守卫在读盘前触发）。
    fs.appendFileSync(bigImage, Buffer.alloc(4 * 1024 * 1024, 0));
    await expectDomainError(
      () => service.resolvePromptAttachments({ images: [{ path: bigImage }], files: [] }),
      "INVALID_OPERATION",
      /"big.png" exceeds the 4MiB limit\./,
    );

    const bigFile = path.join(sandbox, "big.txt");
    fs.writeFileSync(bigFile, "x".repeat(512 * 1024 + 1));
    await expectDomainError(
      () => service.resolvePromptAttachments({ images: [], files: [{ path: bigFile }] }),
      "INVALID_OPERATION",
      /"big.txt" exceeds the 512KiB limit\./,
    );
  });

  it("rejects non-image path attachments and malformed union members", async () => {
    const textFile = path.join(sandbox, "plain.txt");
    fs.writeFileSync(textFile, "words");
    await expectDomainError(
      () => service.resolvePromptAttachments({ images: [{ path: textFile }], files: [] }),
      "INVALID_OPERATION",
      /Unsupported image type: plain\.txt\./,
    );
    await expectDomainError(
      () => service.resolvePromptAttachments({ images: [{ name: "x" }], files: [] }),
      "INVALID_OPERATION",
      /image attachment needs either path or mediaType\+data/,
    );
    await expectDomainError(
      () => service.resolvePromptAttachments({ images: [], files: [{ name: "x" }] }),
      "INVALID_OPERATION",
      /file attachment needs either path or name\+data/,
    );
    await expectDomainError(
      () =>
        service.resolvePromptAttachments({
          images: [{ path: path.join(sandbox, "ghost.png") }],
          files: [],
        }),
      "NOT_FOUND",
      /image not found/,
    );
  });
});

describe("prompt contract dual-channel narrowing (R17-B)", () => {
  const base = { sessionId: "s1", text: "hi" } as const;

  it("accepts base64 and path channels and keeps them mutually exclusive (strict)", () => {
    expect(
      AgentSessionPromptInputSchema.parse({
        ...base,
        images: [
          { mediaType: "image/png", data: "aGk=" },
          { path: "/tmp/shot.png", name: "shot.png" },
        ],
        files: [{ name: "a.txt", data: "aGk=" }, { path: "/tmp/b.md" }],
      }),
    ).toMatchObject({ sessionId: "s1", text: "hi" });

    // strict：混通道（data+path）与未知键直接 parse 失败。
    expect(
      AgentSessionPromptInputSchema.safeParse({
        ...base,
        images: [{ path: "/x.png", data: "aGk=" }],
      }).success,
    ).toBe(false);
    expect(
      AgentSessionPromptInputSchema.safeParse({
        ...base,
        images: [{ mediaType: "image/png", data: "aGk=", path: "/x.png" }],
      }).success,
    ).toBe(false);
  });

  it("keeps the 4MiB base64 bound on the data channel only", () => {
    const oversized = "a".repeat(5_592_407);
    expect(
      AgentSessionPromptInputSchema.safeParse({
        ...base,
        images: [{ mediaType: "image/png", data: oversized }],
      }).success,
    ).toBe(false);
    // path 通道不受 base64 长度限（daemon 读盘按字节校验）。
    expect(
      AgentSessionPromptInputSchema.safeParse({ ...base, images: [{ path: "/big/raw.png" }] })
        .success,
    ).toBe(true);
  });
});

describe("files-only prompt is a valid contract shape (R17 codex P1)", () => {
  it("accepts a prompt with only file path attachments and no text or images", async () => {
    const { AgentSessionPromptInputSchema } = await import("../src/shared/contracts/agent.js");
    const parsed = AgentSessionPromptInputSchema.safeParse({
      sessionId: "agent-s1",
      text: "",
      images: [],
      files: [{ path: "/tmp/report.md" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("still rejects a fully empty prompt", async () => {
    const { AgentSessionPromptInputSchema } = await import("../src/shared/contracts/agent.js");
    const parsed = AgentSessionPromptInputSchema.safeParse({
      sessionId: "agent-s1",
      text: "   ",
      images: [],
      files: [],
    });
    expect(parsed.success).toBe(false);
  });
});

// rfd mock：模块级单一可配置（vi.mock 提升，同文件多次声明互相覆盖）。
const rfdState = { handles: null as Array<{ path: () => string }> | null };
vi.mock("@xmorse/rfd", () => ({
  AsyncFileDialog: class {
    setTitle() {
      return this;
    }
    addFilter() {
      return this;
    }
    pickFiles() {
      return Promise.resolve(rfdState.handles);
    }
  },
}));

describe("pickFiles native picker (R18 @xmorse/rfd)", () => {
  it("returns real paths from the native dialog and empty on cancel", async () => {
    vi.resetModules();
    const { createAgentFilesService } = await import("../src/daemon/agent-files.js");
    const service = createAgentFilesService();
    rfdState.handles = [{ path: () => "/Users/x/a.png" }, { path: () => "/Users/x/b.jpg" }];
    await expect(service.pickFiles({ mode: "image" })).resolves.toEqual({
      paths: ["/Users/x/a.png", "/Users/x/b.jpg"],
    });
    rfdState.handles = null;
    await expect(service.pickFiles({ mode: "file" })).resolves.toEqual({ paths: [] });
  });

  it("skips dead handles without failing the batch", async () => {
    vi.resetModules();
    const { createAgentFilesService } = await import("../src/daemon/agent-files.js");
    const service = createAgentFilesService();
    rfdState.handles = [
      { path: () => "/Users/x/ok.txt" },
      {
        path: () => {
          throw new Error("gone");
        },
      },
    ];
    await expect(service.pickFiles({ mode: "file" })).resolves.toEqual({
      paths: ["/Users/x/ok.txt"],
    });
    rfdState.handles = null;
  });
});
