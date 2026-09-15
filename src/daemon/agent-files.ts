/**
 * 后端文件选择器服务（R17-B → R18 → 2.0.1 修订）。
 *
 * 用户原始需求 [2026-09-13]：「文件选择器、图片选择器，不要基于 web，而是基于
 * 后端，这样能拿到真实的路径，前端也能更轻。」
 * 修订 [2026-09-14]（R18 用户裁决）：「不是让你用 Web 做，而是在后端（nodejs）
 * 这边，唤醒 native 级别的 file-picker」——经 @xmorse/rfd 打开真原生对话框
 * （OpenTray 本身无 dialog API 的结论不变，rfd 提供跨平台 native 层）。
 * 修订 [2026-09-15]（2.0.0 回归修复，用户实测「选择器不能用」+ 探针实证）：
 *   rfd 的 **Async**FileDialog 在非 GUI 宿主进程里会 panic（macOS 回退 sync
 *   必须在主线程，却被调度到 tokio 工作线程），JS Promise 永久挂起——按钮死、
 *   无错误、无对话框。修复：spawn 独立 node 子进程，在子进程主线程上跑 **sync**
 *   FileDialog（探针 + 用户亲测可用）：panic 崩溃被隔离在子进程（退出码 →
 *   类型化 UNAVAILABLE），daemon 事件循环全程不受模态阻塞。
 *
 * 正交意图：
 *   [1] 原生文件选择：pickFiles 子进程协议（mode 预置标题/filter；取消=空数组；
 *       忙碌互斥；超时击杀；失败类型化）。
 *   [2] 单文件预览：图片走 jSquash 缩略管线、文本取 4KiB UTF-8 头、其余二进制
 *       仅名/大小——守卫外的输入一律降级 binary 投影，不伪装成功预览（list 的
 *       目录浏览投影同归本意图：预览的入口面）。
 *   [3] prompt 附件路径解析：path 通道图片/文件在 daemon 读盘（大小守卫与
 *       base64 通道同限：图 4MiB / 文件 512KiB）→ base64 交给既有内核准入链。
 * 妥协声明：三个意图共享同一批 fs/stat/守卫 helper，且同属「浏览 → 预览 → 选定」
 *   一条选择器流程；评估过拆 folder（intent 警报 3），因拆分只会复制 helper 而
 *   不产生独立变化轴而保留单模块。
 */
import { spawn } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
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

/**
 * 文本类文件判定（按扩展名；mime 未知时的内联/引用准入面）。agent-sessions 的
 * prompt 内联与 `@` file 引用共用这一份清单（单一事实源）。
 */
export function isTextualFileName(name: string): boolean {
  return /\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|log|patch|diff|ts|tsx|js|jsx|py|rs|go|java|c|h|cpp|sh|css|html|xml|ini|env)$/i.test(
    name,
  );
}

/** path 通道解析产物：base64 形状（agentSessions.prompt 既有签名不变）。 */
export interface ResolvedPromptAttachments {
  images: Array<{ mediaType: string; data: string; name?: string }>;
  files: Array<{ name: string; data: string }>;
}

export interface AgentFilesService {
  list(input: AgentFilesListInput): Promise<AgentFilesListResult>;
  preview(input: AgentFilesPreviewInput): Promise<AgentFilesPreviewResult>;
  /**
   * 原生文件选择（R18 用户裁决 + 2.0.1 修复）：独立子进程主线程上跑 @xmorse/rfd
   * sync FileDialog。filter 按 image/file 模式预置；返回真实路径列表（空 = 用户
   * 取消）；失败抛类型化 UNAVAILABLE。
   */
  pickFiles(input: { mode: "image" | "file" }): Promise<{ paths: string[] }>;
  /** path 通道附件读盘为 base64 形状（agentSessions.prompt 既有签名不变）。 */
  resolvePromptAttachments(input: {
    images: Array<{ mediaType?: string; data?: string; name?: string; path?: string }>;
    files: Array<{ name?: string; data?: string; path?: string }>;
  }): Promise<ResolvedPromptAttachments>;
  /**
   * `@` file 引用展开（composer-references C1）：绝对路径 + realpath + regular
   * file + ≤512KiB + 文本扩展名（与 path 附件同守卫族）→ `[reference: …]` 文本块。
   * 二进制/超限/非文本 typed 拒绝（引用面只承载文本；二进制走附件通道）。
   */
  resolvePromptReferences(input: {
    references: Array<{ kind: "file"; path: string }>;
  }): Promise<string[]>;
}

/** 子进程对话框请求（mode → 标题/过滤器的映射真相留在 daemon 侧）。 */
export interface PickerRequest {
  title: string;
  filters: Array<{ name: string; exts: string[] }>;
}

/** 子进程运行结果：picked / canceled / failed（三态互斥，映射真相单一）。 */
export interface PickerOutcome {
  status: "picked" | "canceled" | "failed";
  paths?: string[];
  message?: string;
}

export interface AgentFilesDeps {
  /** 默认起始目录（缺省 home）。 */
  defaultDir?: () => string;
  /**
   * 原生选择运行器（测试注入点）。真实实现 spawn `node -e` 子进程跑 sync
   * FileDialog——AppKit/GTK 要求对话框在进程主线程上运行，独立子进程天然满足
   * 且 panic 隔离；@xmorse/rfd 的 async 形态在非 GUI 宿主会 panic 并使 Promise
   * 永久挂起（2026-09-15 探针实证），不可用。
   */
  runNativePicker?: (request: PickerRequest) => Promise<PickerOutcome>;
  /** 子进程看门狗（测试可缩短；缺省 10 分钟——对话框合法地长时间停留）。 */
  pickerTimeoutMs?: number;
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

/**
 * 子进程选择器代码（CJS `-e`；`-e` 模式下用户参数从 argv[1] 起——argv[1]=请求
 * JSON，argv[2]=rfd 入口绝对路径）。只用 sync FileDialog：子进程主 JS 线程即
 * 进程主线程，满足 AppKit/GTK 的主线程法则。stdout 单行 JSON 是唯一类型化出口
 * （panic/崩溃走非零退出码由父进程兜底）。
 */
const PICKER_CHILD_CODE = `"use strict";
const write = (payload) => process.stdout.write(JSON.stringify(payload));
try {
  const spec = JSON.parse(process.argv[1]);
  const rfd = require(process.argv[2]);
  let dialog = new rfd.FileDialog();
  if (spec.title) dialog = dialog.setTitle(spec.title);
  for (const filter of spec.filters) dialog = dialog.addFilter(filter.name, filter.exts);
  const paths = dialog.pickFiles();
  write({ ok: true, paths: Array.isArray(paths) ? paths : [] });
} catch (error) {
  write({ ok: false, message: String((error && error.message) || error).slice(0, 300) });
}`;

/** 子进程看门狗缺省：对话框可能被用户合法地长时间留着，超时只兜僵尸/无显示器。 */
const PICKER_TIMEOUT_MS = 10 * 60 * 1000;
/** stdout 聚积上限（协议是单行小 JSON，超限即异常输入）。 */
const PICKER_STDOUT_LIMIT = 64 * 1024;

let cachedRfdEntry: string | null = null;

/** rfd 入口解析（daemon bundle 内 external，路径经 createRequire 从本文件定位）。 */
function resolveRfdEntry(): string {
  if (cachedRfdEntry !== null) return cachedRfdEntry;
  try {
    cachedRfdEntry = createRequire(import.meta.url).resolve("@xmorse/rfd");
  } catch {
    throw new DomainError("UNAVAILABLE", "native file picker runtime is not installed");
  }
  return cachedRfdEntry;
}

/**
 * 真实运行器：spawn 子进程跑 sync 对话框（导出供子进程协议契约测试直连）。
 * `entry`/`timeoutMs` 供测试注入替身入口与缩短看门狗；生产路径走缺省。
 */
export function runPickerChild(
  request: PickerRequest,
  options: { entry?: string; timeoutMs?: number } = {},
): Promise<PickerOutcome> {
  const entry = options.entry ?? resolveRfdEntry();
  const timeoutMs = options.timeoutMs ?? PICKER_TIMEOUT_MS;
  const child = spawn(process.execPath, ["-e", PICKER_CHILD_CODE, JSON.stringify(request), entry], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return new Promise((resolve) => {
    let stdout = "";
    let stderrTail = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: "failed", message: `picker timed out after ${String(timeoutMs)}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < PICKER_STDOUT_LIMIT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-300);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "failed", message: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // 子进程自身的类型化出口优先；解析失败落到退出码 + stderr 兜底。
      try {
        const parsed = JSON.parse(stdout) as { ok?: unknown; paths?: unknown; message?: unknown };
        if (parsed.ok === true && Array.isArray(parsed.paths)) {
          const paths = parsed.paths.filter((value): value is string => typeof value === "string");
          resolve(paths.length === 0 ? { status: "canceled" } : { status: "picked", paths });
          return;
        }
        if (parsed.ok === false && typeof parsed.message === "string") {
          resolve({ status: "failed", message: parsed.message });
          return;
        }
      } catch {
        // 非法 stdout：继续走兜底。
      }
      const detail = stderrTail.trim();
      resolve({
        status: "failed",
        message: `picker exited with code ${String(code)}${detail.length > 0 ? `: ${detail}` : ""}`,
      });
    });
  });
}

export function createAgentFilesService(deps: AgentFilesDeps = {}): AgentFilesService {
  const defaultDir = deps.defaultDir ?? (() => os.homedir());
  const runNativePicker = deps.runNativePicker ?? runPickerChild;
  let pickerInFlight: Promise<PickerOutcome> | null = null;

  async function pickFiles(input: { mode: "image" | "file" }): Promise<{ paths: string[] }> {
    // 模态互斥：第二个客户端并发请求时对话框已开，直接类型化拒绝。
    if (pickerInFlight !== null) {
      throw new DomainError("INVALID_OPERATION", "file picker dialog is already open");
    }
    const request: PickerRequest =
      input.mode === "image"
        ? {
            title: "Select images",
            filters: [{ name: "Images", exts: ["png", "jpg", "jpeg", "webp", "gif"] }],
          }
        : { title: "Select files", filters: [] };
    const inFlight = runNativePicker(request);
    pickerInFlight = inFlight;
    try {
      const outcome = await inFlight;
      if (outcome.status === "picked") return { paths: outcome.paths ?? [] };
      if (outcome.status === "canceled") return { paths: [] };
      throw new DomainError(
        "UNAVAILABLE",
        `native file picker failed: ${outcome.message ?? "unknown error"}`,
      );
    } finally {
      if (pickerInFlight === inFlight) pickerInFlight = null;
    }
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

  /**
   * `@` file 引用展开（C1）：守卫链与 path 附件同族——绝对路径/realpath/regular
   * file/≤512KiB；文本判定按扩展名（与 prompt 内联文件同一 isTextual 面，这里以
   * basename 判定）。产出 `[reference: <path>]` 文本块；引用面不承载二进制。
   */
  async function resolvePromptReferences(input: {
    references: Array<{ kind: "file"; path: string }>;
  }): Promise<string[]> {
    const blocks: string[] = [];
    for (const reference of input.references) {
      const { real, size } = await canonicalRegularFile(reference.path, "reference");
      if (size > PROMPT_FILE_MAX_BYTES) {
        throw new DomainError(
          "INVALID_OPERATION",
          `"${path.basename(real)}" exceeds the 512KiB limit.`,
        );
      }
      if (!isTextualFileName(path.basename(real))) {
        throw new DomainError(
          "INVALID_OPERATION",
          `"${path.basename(real)}" is not a textual file; attach it instead.`,
        );
      }
      const text = await readFile(real, "utf8");
      blocks.push(`[reference: ${real}]\n${text.slice(0, 200_000)}`);
    }
    return blocks;
  }

  return { pickFiles, list, preview, resolvePromptAttachments, resolvePromptReferences };
}
