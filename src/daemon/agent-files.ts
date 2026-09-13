/**
 * 后端文件选择器服务（R17-B）。
 *
 * 用户原始需求 [2026-09-13]：「文件选择器、图片选择器，不要基于 web，而是基于
 * 后端，这样能拿到真实的路径，前端也能更轻。」——OpenTray 0.24.0 无原生
 * open-file dialog API（JS 导出面 + darwin 二进制符号双重实证），「基于后端的
 * 选择器」= 前端弹层消费本服务的 fs 读 RPC 浏览并选定真实路径。
 *
 * 正交意图：
 *   [1] 目录浏览投影：list（canonical realpath + 目录优先字典序 + 有界截断）。
 *   [2] 单文件预览：图片走 jSquash 缩略管线、文本取 4KiB UTF-8 头、其余二进制
 *       仅名/大小——守卫外的输入一律降级 binary 投影，不伪装成功预览。
 *   [3] prompt 附件路径解析：path 通道图片/文件在 daemon 读盘（大小守卫与
 *       base64 通道同限：图 4MiB / 文件 512KiB）→ base64 交给既有内核准入链。
 * 妥协声明：三个意图共享同一批 fs/stat/守卫 helper，且同属「浏览 → 预览 → 选定」
 *   一条选择器流程；评估过拆 folder（intent 警报 3），因拆分只会复制 helper 而
 *   不产生独立变化轴而保留单模块。
 */
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentFilesEntry,
  AgentFilesListInput,
  AgentFilesListResult,
  AgentFilesPreviewInput,
  AgentFilesPreviewResult,
} from "../shared/contracts/agent.js";
import { DomainError } from "./domain-error.js";
import { renderImageThumbnail, sniffImageMediaType } from "./image-codec.js";

/** 目录条目数上限（超出截断 + truncated 标记——node_modules 级目录的有界投影）。 */
const LIST_ENTRY_LIMIT = 2000;
/** 图片预览源文件上限（>8MiB 降级 binary 投影）。 */
const PREVIEW_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** 文本预览源文件上限（>2MiB 降级 binary 投影）。 */
const PREVIEW_TEXT_MAX_BYTES = 2 * 1024 * 1024;
/** 文本预览内容上限（UTF-8 解码后的前 4KiB）。 */
const PREVIEW_TEXT_HEAD_BYTES = 4096;
/** prompt 图片附件源文件上限（与 base64 通道 4MiB 同限）。 */
const PROMPT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** prompt 文件附件源文件上限（与 base64 通道 512KiB 同限）。 */
const PROMPT_FILE_MAX_BYTES = 512 * 1024;

/** path 通道解析产物：base64 形状（agentSessions.prompt 既有签名不变）。 */
export interface ResolvedPromptAttachments {
  images: Array<{ mediaType: string; data: string; name?: string }>;
  files: Array<{ name: string; data: string }>;
}

export interface AgentFilesService {
  list(input: AgentFilesListInput): Promise<AgentFilesListResult>;
  preview(input: AgentFilesPreviewInput): Promise<AgentFilesPreviewResult>;
  /**
   * 原生文件选择（R18 用户裁决：后端唤醒 native file-picker，@xmorse/rfd）。
   * filter 按 image/file 模式预置；返回真实路径列表（空 = 用户取消）。
   */
  pickFiles(input: { mode: "image" | "file" }): Promise<{ paths: string[] }>;
  /** path 通道附件读盘为 base64 形状（agentSessions.prompt 既有签名不变）。 */
  resolvePromptAttachments(input: {
    images: Array<{ mediaType?: string; data?: string; name?: string; path?: string }>;
    files: Array<{ name?: string; data?: string; path?: string }>;
  }): Promise<ResolvedPromptAttachments>;
}

export interface AgentFilesDeps {
  /** 默认起始目录（缺省 home）。 */
  defaultDir?: () => string;
}

/** Node fs 错误码 → 有限业务错误（未知码归 UNAVAILABLE，消息有界）。 */
function toDomainError(error: unknown, what: string, target: string): DomainError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new DomainError("NOT_FOUND", `${what} not found: ${target}`);
  }
  if (code === "EACCES" || code === "EPERM") {
    return new DomainError("UNAVAILABLE", `${what} not accessible: ${target}`);
  }
  return new DomainError("UNAVAILABLE", `${what} unavailable: ${target}`);
}

/** 相对路径统一拒绝（浏览器传来的路径必须已是浏览面产出的绝对路径）。 */
function requireAbsolutePath(value: string, what: string): string {
  if (!path.isAbsolute(value)) {
    throw new DomainError("INVALID_OPERATION", `absolute ${what} path required: ${value}`);
  }
  return value;
}

/** realpath + regular-file 断言：目录/缺失/权限分别给 typed 错误。 */
async function canonicalRegularFile(
  value: string,
  what: string,
): Promise<{ real: string; size: number }> {
  requireAbsolutePath(value, what);
  let real: string;
  try {
    real = await realpath(value);
  } catch (error) {
    throw toDomainError(error, what, value);
  }
  try {
    const info = await stat(real);
    if (!info.isFile()) {
      throw new DomainError("INVALID_OPERATION", `not a regular ${what} file: ${value}`);
    }
    return { real, size: info.size };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw toDomainError(error, what, value);
  }
}

/** 目录优先 + 大小写不敏感字典序（稳定浏览序）。 */
function compareEntries(a: AgentFilesEntry, b: AgentFilesEntry): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
}

export function createAgentFilesService(deps: AgentFilesDeps = {}): AgentFilesService {
  const defaultDir = deps.defaultDir ?? (() => os.homedir());

  async function pickFiles(input: { mode: "image" | "file" }): Promise<{ paths: string[] }> {
    const { AsyncFileDialog } = await import("@xmorse/rfd");
    let builder = new AsyncFileDialog();
    builder = builder.setTitle(input.mode === "image" ? "Select images" : "Select files");
    if (input.mode === "image") {
      builder = builder.addFilter("Images", ["png", "jpg", "jpeg", "webp", "gif"]);
    }
    const handles = await builder.pickFiles();
    if (handles === null) return { paths: [] };
    const paths: string[] = [];
    for (const handle of handles) {
      try {
        paths.push(handle.path());
      } catch {
        // 句柄失效（选后即删等）：跳过，不炸整次选择。
      }
    }
    return { paths };
  }

  async function list(input: AgentFilesListInput): Promise<AgentFilesListResult> {
    const target = input.dir === undefined ? defaultDir() : input.dir;
    requireAbsolutePath(target, "directory");
    let real: string;
    try {
      real = await realpath(target);
    } catch (error) {
      throw toDomainError(error, "directory", target);
    }
    let dirents;
    try {
      const info = await stat(real);
      if (!info.isDirectory()) {
        throw new DomainError("NOT_FOUND", `not a directory: ${target}`);
      }
      dirents = await readdir(real, { withFileTypes: true });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw toDomainError(error, "directory", target);
    }
    const entries: AgentFilesEntry[] = [];
    for (const dirent of dirents) {
      const absolute = path.join(real, dirent.name);
      let kind: "file" | "dir";
      let size: number | undefined;
      if (dirent.isDirectory()) {
        kind = "dir";
      } else if (dirent.isFile()) {
        kind = "file";
        size = (await stat(absolute).catch(() => null))?.size;
      } else {
        // 符号链接等：按目标实体分类；悬空链接跳过（浏览面不呈现死路）。
        const followed = await stat(absolute).catch(() => null);
        if (followed === null) continue;
        if (followed.isDirectory()) {
          kind = "dir";
        } else if (followed.isFile()) {
          kind = "file";
          size = followed.size;
        } else {
          continue;
        }
      }
      entries.push({ name: dirent.name, kind, ...(size !== undefined ? { size } : {}) });
    }
    entries.sort(compareEntries);
    const truncated = entries.length > LIST_ENTRY_LIMIT;
    const parent = path.dirname(real);
    return {
      dir: real,
      parent: parent === real ? null : parent,
      entries: truncated ? entries.slice(0, LIST_ENTRY_LIMIT) : entries,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  async function preview(input: AgentFilesPreviewInput): Promise<AgentFilesPreviewResult> {
    const { real, size } = await canonicalRegularFile(input.path, "preview");
    const name = path.basename(real);
    // >8MiB：图片/文本守卫双双越限——直接 binary（不读字节）。
    if (size > PREVIEW_IMAGE_MAX_BYTES) {
      return { kind: "binary", name, size };
    }
    const bytes = new Uint8Array(await readFile(real));
    const sniffed = sniffImageMediaType(bytes);
    if (sniffed === "image/png" || sniffed === "image/jpeg") {
      // 有 codec 的图片：缩略管线；解码失败 → binary（不伪装成功预览）。
      const thumbnail = await renderImageThumbnail(bytes, sniffed).catch(() => null);
      if (thumbnail === null) {
        return { kind: "binary", name, size };
      }
      return {
        kind: "image",
        name,
        size,
        mediaType: sniffed,
        dataUrl: thumbnail.dataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
      };
    }
    if (sniffed !== null) {
      // magic 判定是图片但无 codec（webp/gif）——binary 投影，不走文本分支。
      return { kind: "binary", name, size };
    }
    // 文本通道：≤2MiB + 首 4KiB 无 NUL（git 同款二进制启发）；截 4KiB 头。
    if (size <= PREVIEW_TEXT_MAX_BYTES && !bytes.subarray(0, PREVIEW_TEXT_HEAD_BYTES).includes(0)) {
      const text = Buffer.from(bytes).toString("utf8");
      return {
        kind: "text",
        name,
        size,
        text: text.slice(0, PREVIEW_TEXT_HEAD_BYTES),
        truncated: text.length > PREVIEW_TEXT_HEAD_BYTES,
      };
    }
    return { kind: "binary", name, size };
  }

  async function resolvePromptAttachments(input: {
    images: Array<{ mediaType?: string; data?: string; name?: string; path?: string }>;
    files: Array<{ name?: string; data?: string; path?: string }>;
  }): Promise<ResolvedPromptAttachments> {
    const images: Array<{ mediaType: string; data: string; name?: string }> = [];
    for (const image of input.images) {
      if (image.path === undefined) {
        if (image.mediaType === undefined || image.data === undefined) {
          throw new DomainError(
            "INVALID_OPERATION",
            "image attachment needs either path or mediaType+data",
          );
        }
        images.push({
          mediaType: image.mediaType,
          data: image.data,
          ...(image.name !== undefined ? { name: image.name } : {}),
        });
        continue;
      }
      const { real, size } = await canonicalRegularFile(image.path, "image");
      const name = image.name ?? path.basename(real);
      if (size > PROMPT_IMAGE_MAX_BYTES) {
        throw new DomainError("INVALID_OPERATION", `"${name}" exceeds the 4MiB limit.`);
      }
      const bytes = new Uint8Array(await readFile(real));
      const sniffed = sniffImageMediaType(bytes);
      if (sniffed === null) {
        throw new DomainError("INVALID_OPERATION", `Unsupported image type: ${name}.`);
      }
      images.push({
        mediaType: sniffed,
        data: Buffer.from(bytes).toString("base64"),
        name,
      });
    }
    const files: Array<{ name: string; data: string }> = [];
    for (const file of input.files) {
      if (file.path === undefined) {
        if (file.name === undefined || file.data === undefined) {
          throw new DomainError(
            "INVALID_OPERATION",
            "file attachment needs either path or name+data",
          );
        }
        files.push({ name: file.name, data: file.data });
        continue;
      }
      const { real, size } = await canonicalRegularFile(file.path, "file");
      const name = path.basename(real);
      if (size > PROMPT_FILE_MAX_BYTES) {
        throw new DomainError("INVALID_OPERATION", `"${name}" exceeds the 512KiB limit.`);
      }
      files.push({ name, data: Buffer.from(await readFile(real)).toString("base64") });
    }
    return { images, files };
  }

  return { pickFiles, list, preview, resolvePromptAttachments };
}
