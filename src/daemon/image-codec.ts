/**
 * jSquash 图像 codec 宿主（R17-B 后端预览管线）。
 *
 * 用户原始需求 [2026-09-13]：「后端也需要提供前端所需的预览视图处理，使用
 * jSquash 这个库。」——daemon 侧用 @jsquash 纯 wasm 家族（png/jpeg 解码 +
 * resize）产出 ≤256px 长边缩略图，浏览器不再解码原图。
 *
 * 正交意图：
 *   [1] wasm 生命周期：Node ESM 下各 codec 的默认 init 走 fetch(file://) 必败
 *       （实测 2026-09-13），改为显式读盘 .wasm 构造 WebAssembly.Module 注入；
 *       模块级 promise 缓存，daemon 生命周期内只 init 一次。
 *   [2] 缩略管线：magic 字节嗅探 mediaType → 解码 → 长边 >256 才缩 → 按源类型
 *       回编（png 源回编 png 保 alpha，jpeg 源回编 jpeg）→ dataURL。
 * 妥协声明：@jsquash/jpeg 的 init d.ts 只声明 ModuleOpts 形参，但运行时首参
 *   接受 WebAssembly.Module（codec/utils.js initEmscriptenModule 契约）；以精确
 *   结构签名收窄注入点，不引入 any。
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { init as initPngDecode, decode as decodePng } from "@jsquash/png/decode.js";
import encodePng, { init as initPngEncode } from "@jsquash/png/encode.js";
import decodeJpeg, { init as initJpegDecodeRaw } from "@jsquash/jpeg/decode.js";
import encodeJpeg, { init as initJpegEncodeRaw } from "@jsquash/jpeg/encode.js";
import resize, { initResize } from "@jsquash/resize";

/**
 * Node 运行时内置 WebAssembly（本仓 lib=ES2022 无 DOM/WebAssembly 类型面）：
 * 按最小结构签名从 globalThis 收窄构造器——不引 DOM lib，不做 any 断言。
 */
type WasmModuleLike = object;
const WasmCompiler = (
  globalThis as unknown as {
    WebAssembly: { Module: new (bytes: Uint8Array) => WasmModuleLike };
  }
).WebAssembly;

/** 运行时真签名：init(WebAssembly.Module)（codec/utils.js 的 wasmModule 分支）。 */
type WasmModuleInit = (module: WasmModuleLike) => Promise<void>;
const initJpegDecode = initJpegDecodeRaw as unknown as WasmModuleInit;
const initJpegEncode = initJpegEncodeRaw as unknown as WasmModuleInit;

/** 解码/缩略/编码链路上的 RGBA 帧结构（jsquash 家族的鸭子形状；skipLibCheck
 * 下包内 ImageData 类型不解析，以本结构类型显式化）。 */
export interface RgbaImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** prompt/预览统一的图片 mediaType 词汇（与 AgentPromptImageSchema 的枚举一致）。 */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** wasm 一次性初始化 promise（并发调用共享；失败后允许重试——置回 null）。 */
let codecInit: Promise<void> | null = null;

/** require.resolve 的 wasm 解析器（bundled daemon 经 createRequire(import.meta.url)
 * 从产物位置向上解析 node_modules；dev/test 从源码位置同理）。 */
function resolveWasmPath(specifier: string): string {
  return createRequire(import.meta.url).resolve(specifier);
}

async function compileWasm(specifier: string): Promise<WasmModuleLike> {
  const bytes = await readFile(resolveWasmPath(specifier));
  return new WasmCompiler.Module(new Uint8Array(bytes));
}

/** 初始化全部 codec（幂等；任一失败清缓存让下次重试；测试 fixture 生成共用）。 */
export function ensureImageCodecs(): Promise<void> {
  if (codecInit === null) {
    codecInit = (async () => {
      const pngWasm = await compileWasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm");
      await Promise.all([
        initPngDecode(pngWasm),
        initPngEncode(pngWasm),
        initJpegDecode(await compileWasm("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm")),
        initJpegEncode(await compileWasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm")),
        initResize(await compileWasm("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm")),
      ]);
    })().catch((error: unknown) => {
      codecInit = null;
      throw error;
    });
  }
  return codecInit;
}

/**
 * magic 字节嗅探图片类型（不信任扩展名）：PNG/JPEG/WebP/GIF 四类，非图片 null。
 * 任何失败（含 wasm init）由调用方决定降级——本函数不抛。
 */
export function sniffImageMediaType(bytes: Uint8Array): ImageMediaType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // GIF87a / GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  return null;
}

/** 缩略图长边上限（R17-B 规格）。 */
export const THUMBNAIL_MAX_EDGE = 256;

/**
 * 完整缩略管线：解码（仅 png/jpeg——webp/gif 无对应 codec，调用方先嗅探分流）
 * → 长边 >256 才 resize（等比）→ 按源类型回编 → dataURL。
 * 任何一步失败抛出（调用方降级为 binary 投影，不伪装成功）。
 */
export async function renderImageThumbnail(
  bytes: Uint8Array,
  mediaType: "image/png" | "image/jpeg",
): Promise<{ dataUrl: string; width: number; height: number }> {
  await ensureImageCodecs();
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const decoded: RgbaImage =
    mediaType === "image/png" ? await decodePng(source) : await decodeJpeg(source);
  let frame: RgbaImage = decoded;
  const longEdge = Math.max(decoded.width, decoded.height);
  if (longEdge > THUMBNAIL_MAX_EDGE) {
    const scale = THUMBNAIL_MAX_EDGE / longEdge;
    frame = await resize(decoded, {
      width: Math.max(1, Math.round(decoded.width * scale)),
      height: Math.max(1, Math.round(decoded.height * scale)),
    });
  }
  const encoded = mediaType === "image/png" ? await encodePng(frame) : await encodeJpeg(frame);
  const base64 = Buffer.from(encoded).toString("base64");
  return {
    dataUrl: `data:${mediaType};base64,${base64}`,
    width: frame.width,
    height: frame.height,
  };
}
