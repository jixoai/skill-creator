/**
 * Agent composer 草稿态（redesign-model-tabs-and-agent-panel S3/S4 §4.3）。
 *
 * 用户原始需求 [2026-09-12]：「pen 点击 → composer 进入 editing 态：注记条 +
 * placeholder 变更；发送/取消均退出 editing 态」；「paste 图片 / drop 混合文件
 * （沿用）」——Edit 与转录行跨组件、drop 目标是整个面板，草稿与附件准入上移
 * module 状态（转录行 / seed 效应 / ComposerCard / 面板 drop 共用同一份真相）。
 *
 * 正交意图：
 *   [1] composer 草稿：文本/图片/文件附件 + editing 态（append-only 语义标注）。
 *   [2] 附件准入：类型/数量/大小守卫 + base64 读取（4×4MiB 图 + 2×512KiB 文件，
 *       守卫与 toast 文案沿用旧 footer 行为）。
 */
import { showToast } from "$lib/toast.svelte";

export interface ComposerImageAttachment {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
  name?: string;
  preview: string;
}

export interface ComposerFileAttachment {
  name: string;
  data: string;
}

export const agentComposer = $state({
  text: "",
  images: [] as ComposerImageAttachment[],
  files: [] as ComposerFileAttachment[],
  /** 编辑回填来源文本（非 null = editing 态：注记条 + 语义 placeholder）。 */
  editing: null as string | null,
});

/** 编辑回填（§4.3）：进入 editing 态；发送/取消退出。 */
export function beginComposerEdit(text: string): void {
  agentComposer.editing = text;
  agentComposer.text = text;
}

/** 退出 editing 态（保留当前草稿文本；取消编辑时由调用方决定是否清空）。 */
export function clearComposerEdit(): void {
  agentComposer.editing = null;
}

/** 面板挂载时重置（对齐旧组件态生命周期：面板关闭再开即空白草稿）。 */
export function resetComposer(): void {
  agentComposer.text = "";
  agentComposer.images = [];
  agentComposer.files = [];
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
