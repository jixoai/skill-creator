/**
 * Agent composer 草稿态（redesign-model-tabs-and-agent-panel S3/S4 §4.3）。
 *
 * 用户原始需求 [2026-09-12]：「pen 点击 → composer 进入 editing 态：注记条 +
 * placeholder 变更；发送/取消均退出 editing 态」；「paste 图片 / drop 混合文件
 * （沿用）」——Edit 与转录行跨组件、drop 目标是整个面板，草稿与附件准入上移
 * module 状态（转录行 / seed 效应 / ComposerCard / 面板 drop 共用同一份真相）。
 * 修订 [2026-09-13]（R17-A）：「Agent Chat 的输入面板的数据（输入的文字、附加
 * 的图片、文件），跟着 Session 走，而不是共享。」——草稿按 sessionId 分轨
 * （Map<sessionId, Draft>），无会话（New Session 态）共享 "__new__" 桶；换轨
 * 双向暂存/恢复，切换不丢任何一轨；清轨点收窄为显式新建（beginNewAgentSession）
 * 与发送成功（sendAgentPrompt），面板开合不再重置（R17-C 面板常驻挂载同语义）。
 * 修订 [2026-09-13]（R17-B）：附件新增「后端真实路径」通道（FilePickerDialog
 * 选定）——本地 File 通道（粘贴/drop，base64 wire）原样保留；path 通道大小守卫
 * 在 daemon 读盘时执行（同文案），数量守卫沿用本模块。
 *
 * 正交意图：
 *   [1] composer 草稿：文本/图片/文件附件 + editing 态（append-only 语义标注）
 *       + 按 sessionId 分轨（活动轨真相只在 facade，非活动轨存 Map 暂存）。
 *   [2] 附件准入：类型/数量/大小守卫 + base64 读取（4×4MiB 图 + 2×512KiB 文件，
 *       守卫与 toast 文案沿用旧 footer 行为）；path 通道同数量守卫。
 */
import { showToast } from "$lib/toast.svelte";

/**
 * 图片附件（双通道，R17-B）：本地 File（mediaType+data+preview 原图 dataURL）
 * 或后端真实路径（path + daemon 缩略 dataURL；webp/gif 无缩略 → preview 缺省）。
 */
export interface ComposerImageAttachment {
  /** 本地通道 mediaType；path 通道缺省（daemon magic 字节嗅探）。 */
  mediaType?: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** 本地通道 base64；path 通道缺省（daemon 读盘）。 */
  data?: string;
  /** 后端真实路径通道（与 data 互斥）。 */
  path?: string;
  name?: string;
  /** 缩略/原图预览 dataURL（path 通道的 webp/gif 无缩略时缺省）。 */
  preview?: string;
}

/** 文件附件（双通道，R17-B）：本地 File（name+data）或后端真实路径（name+path）。 */
export interface ComposerFileAttachment {
  name: string;
  /** 本地通道 base64；path 通道缺省（daemon 读盘）。 */
  data?: string;
  /** 后端真实路径通道（与 data 互斥）。 */
  path?: string;
}

/** 一轨草稿的完整快照（分轨隔离的最小单位）。 */
interface ComposerDraft {
  text: string;
  images: ComposerImageAttachment[];
  files: ComposerFileAttachment[];
  editing: string | null;
}

/** New Session 态（无会话）共享草稿桶的保留键——真实 sessionId 之外的名字空间。 */
export const NEW_SESSION_COMPOSER_TRACK = "__new__";

/**
 * 活动轨草稿（消费面唯一读写点：bind:value / 附件条 / editing 态）。换轨的
 * 暂存与恢复由本模块的 switch/reset/migrate 原语完成，消费者不感知 Map。
 */
export const agentComposer = $state({
  text: "",
  images: [] as ComposerImageAttachment[],
  files: [] as ComposerFileAttachment[],
  /** 编辑回填来源文本（非 null = editing 态：注记条 + 语义 placeholder）。 */
  editing: null as string | null,
});

/** 非活动轨的暂存（不变量：Map 中不存在活动轨的条目——活动轨真相只在 facade）。 */
const draftTracks = new Map<string, ComposerDraft>();
let activeTrackKey = NEW_SESSION_COMPOSER_TRACK;

function emptyDraft(): ComposerDraft {
  return { text: "", images: [], files: [], editing: null };
}

function snapshotFacade(): ComposerDraft {
  return {
    text: agentComposer.text,
    images: [...agentComposer.images],
    files: [...agentComposer.files],
    editing: agentComposer.editing,
  };
}

function applyDraft(draft: ComposerDraft): void {
  agentComposer.text = draft.text;
  agentComposer.images = draft.images;
  agentComposer.files = draft.files;
  agentComposer.editing = draft.editing;
}

/**
 * 换轨（sessionId 或 "__new__"）：暂存当前轨 → 载入目标轨（无则空白）——
 * 任一轨的草稿都不丢。同键 no-op。sessionId 变化的三个向量
 * （selectAgentSession / beginNewAgentSession / 惰性 create）都经此换轨。
 */
export function switchComposerTrack(trackKey: string): void {
  if (trackKey === activeTrackKey) return;
  draftTracks.set(activeTrackKey, snapshotFacade());
  const next = draftTracks.get(trackKey) ?? emptyDraft();
  draftTracks.delete(trackKey);
  activeTrackKey = trackKey;
  applyDraft(next);
}

/**
 * 清轨（R17-A 语义收窄后的 resetComposer）：调用点仅两个——显式新建
 * （beginNewAgentSession 后清 "__new__" 桶）与发送成功（sendAgentPrompt 清
 * 发送轨）。面板开合不调用；非活动轨不受影响。
 */
export function resetComposerTrack(trackKey: string): void {
  draftTracks.delete(trackKey);
  if (trackKey === activeTrackKey) applyDraft(emptyDraft());
}

/**
 * 轨间迁移（惰性建会话向量）：New Session 桶的在途草稿挪到新会话轨——草稿在
 * 发送期间继续可见；成功清该轨，失败留在当前会话轨可重试。
 */
export function migrateComposerDraft(fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  const draft = draftTracks.get(fromKey);
  if (draft === undefined) return;
  draftTracks.delete(fromKey);
  if (activeTrackKey === toKey) {
    applyDraft(draft);
  } else if (!draftTracks.has(toKey)) {
    draftTracks.set(toKey, draft);
  }
}

/**
 * 测试隔离入口：清空所有轨并回到 New Session 桶。生产生命周期不调用——
 * 生产清轨只经 resetComposerTrack 的两个收窄调用点。
 */
export function resetAllComposerTracks(): void {
  draftTracks.clear();
  activeTrackKey = NEW_SESSION_COMPOSER_TRACK;
  applyDraft(emptyDraft());
}

/** 编辑回填（§4.3）：进入 editing 态；发送/取消退出。 */
export function beginComposerEdit(text: string): void {
  agentComposer.editing = text;
  agentComposer.text = text;
}

/** 退出 editing 态（保留当前草稿文本；取消编辑时由调用方决定是否清空）。 */
export function clearComposerEdit(): void {
  agentComposer.editing = null;
}

const IMAGE_MEDIA_TYPES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
  "image/gif": true,
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 读入任意文件为附件（≤2 个、各 ≤512KiB；图片走图片通道）。 */
export async function addComposerDocs(list: FileList | File[]): Promise<void> {
  for (const file of list) {
    if (file.type.startsWith("image/")) continue;
    if (agentComposer.files.length >= 2) {
      showToast("At most 2 file attachments per message.");
      return;
    }
    if (file.size > 512 * 1024) {
      showToast(`"${file.name}" exceeds the 512KiB limit.`);
      continue;
    }
    const data = await fileToBase64(file);
    agentComposer.files = [...agentComposer.files, { name: file.name, data }];
  }
}

/** 读入图片文件（类型/数量/大小守卫；base64 + 预览 dataURL）。 */
export async function addComposerImages(files: FileList | File[]): Promise<void> {
  for (const file of files) {
    if (agentComposer.images.length >= 4) {
      showToast("At most 4 images per message.");
      return;
    }
    if (!(file.type in IMAGE_MEDIA_TYPES)) {
      showToast(`Unsupported image type: ${file.type || "unknown"}.`);
      continue;
    }
    if (file.size > 4 * 1024 * 1024) {
      showToast(`"${file.name}" exceeds the 4MiB limit.`);
      continue;
    }
    const data = await fileToBase64(file);
    agentComposer.images = [
      ...agentComposer.images,
      {
        mediaType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data,
        ...(file.name ? { name: file.name } : {}),
        preview: `data:${file.type};base64,${data}`,
      },
    ];
  }
}

/** 面板级 drop 分流：图片进图片通道，其余进文件通道（守卫沿用）。 */
export function handleComposerDrop(event: DragEvent): void {
  const all = [...(event.dataTransfer?.files ?? [])];
  const images = all.filter((file) => file.type.startsWith("image/"));
  const docs = all.filter((file) => !file.type.startsWith("image/"));
  if (all.length > 0) event.preventDefault();
  if (images.length > 0) void addComposerImages(images);
  if (docs.length > 0) void addComposerDocs(docs);
}

/**
 * 后端选择器产物（R17-B path 通道）：真实路径图片入草稿（数量守卫沿用；大小
 * 守卫在 daemon 读盘时执行同文案）。preview 为 daemon 缩略 dataURL（可缺省）。
 */
export function addPickedComposerImages(
  picks: Array<{ path: string; name: string; preview?: string }>,
): void {
  for (const pick of picks) {
    if (agentComposer.images.length >= 4) {
      showToast("At most 4 images per message.");
      return;
    }
    agentComposer.images = [
      ...agentComposer.images,
      {
        path: pick.path,
        name: pick.name,
        ...(pick.preview !== undefined ? { preview: pick.preview } : {}),
      },
    ];
  }
}

/** 后端选择器产物（R17-B path 通道）：真实路径文件入草稿（数量守卫沿用）。 */
export function addPickedComposerDocs(picks: Array<{ path: string; name: string }>): void {
  for (const pick of picks) {
    if (agentComposer.files.length >= 2) {
      showToast("At most 2 file attachments per message.");
      return;
    }
    agentComposer.files = [...agentComposer.files, { name: pick.name, path: pick.path }];
  }
}
