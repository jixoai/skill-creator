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
 * 修订 [2026-09-14]（R18）：附件真实路径通道改由 **native** pickFiles 提供（@xmorse/rfd；原 web 弹层（FilePickerDialog
 * 选定）——本地 File 通道（粘贴/drop，base64 wire）原样保留；path 通道大小守卫
 * 在 daemon 读盘时执行（同文案），数量守卫沿用本模块。
 *
 * 正交意图：
 *   [1] composer 草稿：文本/图片/文件附件 + editing 态（append-only 语义标注）
 *       + 按 sessionId 分轨（活动轨真相只在 facade，非活动轨存 Map 暂存）。
 *   [2] 附件准入（W2 整批语义，官方 imageLimits 同法）：类型/数量/大小对整批
 *       预检，任一违反整批拒绝（单条 reason 通知，零项入场）；path 通道同数量
 *       守卫；读入计数（attachmentReads）供发送门控。
 */
import { showToast } from "$lib/toast.svelte";
import { loadPersistedDraftText, persistDraftText } from "./agent-submission.svelte";

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
 * W4：换轨时文本面同步 localStorage 持久化；目标轨内存为空时回灌持久文本
 * （附件不落盘——base64 体积与生命周期不属于浏览器存储）。
 */
export function switchComposerTrack(trackKey: string): void {
  if (trackKey === activeTrackKey) return;
  persistDraftText(activeTrackKey, snapshotFacade().text);
  draftTracks.set(activeTrackKey, snapshotFacade());
  const next = draftTracks.get(trackKey) ?? emptyDraft();
  draftTracks.delete(trackKey);
  activeTrackKey = trackKey;
  if (next.text.length === 0) next.text = loadPersistedDraftText(trackKey);
  applyDraft(next);
}

/**
 * 清轨（R17-A 语义收窄后的 resetComposer）：调用点仅两个——显式新建
 * （beginNewAgentSession 后清 "__new__" 桶）与发送成功（sendAgentPrompt 清
 * 发送轨）。面板开合不调用；非活动轨不受影响。W4：清轨同步清持久文本。
 */
export function resetComposerTrack(trackKey: string): void {
  draftTracks.delete(trackKey);
  persistDraftText(trackKey, "");
  if (trackKey === activeTrackKey) applyDraft(emptyDraft());
}

/**
 * 轨间迁移（惰性建会话向量）：New Session 桶的在途草稿挪到新会话轨——草稿在
 * 发送期间继续可见；成功清该轨，失败留在当前会话轨可重试。W4：持久文本随
 * 所有权迁移（源轨清键、目标轨写键）——成功发送后切回源轨不得复活已发草稿。
 */
export function migrateComposerDraft(fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  const draft = draftTracks.get(fromKey);
  if (draft === undefined) return;
  draftTracks.delete(fromKey);
  persistDraftText(fromKey, "");
  persistDraftText(toKey, draft.text);
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

/** 图片通道限额（W2：服务端限额投影的常量形态——产品是 daemon fs 面，
 *  限额由本模块持有；整批违反 = 整批拒绝，部分不入场）。 */
export const IMAGE_INTAKE_LIMITS = {
  maxCount: 4,
  maxSizeBytes: 4 * 1024 * 1024,
} as const;

/** 文件通道限额（同上）。 */
export const DOC_INTAKE_LIMITS = {
  maxCount: 2,
  maxSizeBytes: 512 * 1024,
} as const;

/** 整批拒绝的 reason key（官方 imageLimits 拒绝语义的适配面）。 */
export type IntakeRefusalReason = "tooMany" | "fileTooLarge" | "unsupportedType";

function refuseBatch(reason: IntakeRefusalReason, detail: string): void {
  const copy: Record<IntakeRefusalReason, string> = {
    tooMany: `Too many attachments: ${detail}. Nothing was added.`,
    fileTooLarge: `"${detail}" exceeds its size limit. Nothing was added.`,
    unsupportedType: `Unsupported attachment type: ${detail}. Nothing was added.`,
  };
  showToast(copy[reason]);
}

/** 读入中的附件通道数（W2 发送门控）：>0 时 Enter 保持（still-reading 通知）。 */
export const attachmentReads = $state({ pending: 0 });

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

/**
 * 读入文件附件（W2 整批语义）：先对整批做数量/大小预检——任一违反则整批
 * 拒绝（单条 reason 通知，零项入场，官方 imageLimits 同语义）；全过再逐个
 * base64 读入并原子追加。图片由调用方分流（本函数跳过 image/*）。
 */
export async function addComposerDocs(list: FileList | File[]): Promise<void> {
  const docs = [...list].filter((file) => !file.type.startsWith("image/"));
  if (docs.length === 0) return;
  if (agentComposer.files.length + docs.length > DOC_INTAKE_LIMITS.maxCount) {
    refuseBatch("tooMany", `at most ${DOC_INTAKE_LIMITS.maxCount} file attachments`);
    return;
  }
  const oversized = docs.find((file) => file.size > DOC_INTAKE_LIMITS.maxSizeBytes);
  if (oversized) {
    refuseBatch("fileTooLarge", oversized.name);
    return;
  }
  attachmentReads.pending += 1;
  try {
    const entries = await Promise.all(
      docs.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })),
    );
    agentComposer.files = [...agentComposer.files, ...entries];
  } finally {
    attachmentReads.pending -= 1;
  }
}

/** 读入图片附件（W2 整批语义：类型/数量/大小全批预检，违反整批拒绝）。 */
export async function addComposerImages(files: FileList | File[]): Promise<void> {
  const images = [...files];
  if (images.length === 0) return;
  const unsupported = images.find((file) => !(file.type in IMAGE_MEDIA_TYPES));
  if (unsupported) {
    refuseBatch("unsupportedType", unsupported.type || "unknown");
    return;
  }
  if (agentComposer.images.length + images.length > IMAGE_INTAKE_LIMITS.maxCount) {
    refuseBatch("tooMany", `at most ${IMAGE_INTAKE_LIMITS.maxCount} images`);
    return;
  }
  const oversized = images.find((file) => file.size > IMAGE_INTAKE_LIMITS.maxSizeBytes);
  if (oversized) {
    refuseBatch("fileTooLarge", oversized.name);
    return;
  }
  attachmentReads.pending += 1;
  try {
    const entries = await Promise.all(
      images.map(async (file) => {
        const data = await fileToBase64(file);
        return {
          mediaType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data,
          ...(file.name ? { name: file.name } : {}),
          preview: `data:${file.type};base64,${data}`,
        };
      }),
    );
    agentComposer.images = [...agentComposer.images, ...entries];
  } finally {
    attachmentReads.pending -= 1;
  }
}

/**
 * 面板级 drop 分流（W2：图片/文件分道后各走整批预检）。document 级拖放
 * （DropOverlay）与面板级 drop 都汇入此处。
 */
export function handleComposerDrop(event: DragEvent): void {
  const all = [...(event.dataTransfer?.files ?? [])];
  const images = all.filter((file) => file.type.startsWith("image/"));
  const docs = all.filter((file) => !file.type.startsWith("image/"));
  if (all.length > 0) event.preventDefault();
  if (images.length > 0) void addComposerImages(images);
  if (docs.length > 0) void addComposerDocs(docs);
}

/**
 * 后端选择器产物（R17-B path 通道；W2 整批语义）：真实路径图片整批预检后
 * 入草稿（大小守卫在 daemon 读盘时执行同文案）。preview 为 daemon 缩略
 * dataURL（可缺省）。
 */
export function addPickedComposerImages(
  picks: Array<{ path: string; name: string; preview?: string }>,
): void {
  if (picks.length === 0) return;
  if (agentComposer.images.length + picks.length > IMAGE_INTAKE_LIMITS.maxCount) {
    refuseBatch("tooMany", `at most ${IMAGE_INTAKE_LIMITS.maxCount} images`);
    return;
  }
  agentComposer.images = [
    ...agentComposer.images,
    ...picks.map((pick) => ({
      path: pick.path,
      name: pick.name,
      ...(pick.preview !== undefined ? { preview: pick.preview } : {}),
    })),
  ];
}

/** 后端选择器产物（R18 path 通道；W2 整批语义）：真实路径文件整批入草稿。 */
export function addPickedComposerDocs(picks: Array<{ path: string; name: string }>): void {
  if (picks.length === 0) return;
  if (agentComposer.files.length + picks.length > DOC_INTAKE_LIMITS.maxCount) {
    refuseBatch("tooMany", `at most ${DOC_INTAKE_LIMITS.maxCount} file attachments`);
    return;
  }
  agentComposer.files = [
    ...agentComposer.files,
    ...picks.map((pick) => ({ name: pick.name, path: pick.path })),
  ];
}
