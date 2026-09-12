/**
 * user-text 附件 thumb 契约加界单测（2026-09-12 codex 阻塞 4）。
 *
 * 用户原始需求 [2026-09-12]（codex 评审）：「thumb 仅 z.string().min(1)——收紧为
 * dataURL 形状校验（png/jpeg/webp/gif + base64 前缀 + ≤256KiB），失败按领域
 * 投影为 undefined（条目存活，回退名字 chip），不炸、不写回」。
 *
 * 正交意图：
 *   [1] 合法值：四种 MIME 的 dataURL 原样保留。
 *   [2] 畸形值：错误 MIME / 超长 / 非字符串 → thumb 投影 undefined，kind/name
 *       不受牵连（safeParse 仍成功）。
 */
import { describe, expect, it } from "vitest";
import { DshUserTextAttachmentSchema } from "../src/shared/contracts/dsh-runtime.js";

const MAX_THUMB_CHARS = 256 * 1024;

describe("DshUserTextAttachmentSchema thumb boundary (codex 阻塞 4)", () => {
  it("keeps well-formed image dataURL thumbs", () => {
    for (const mime of ["png", "jpeg", "webp", "gif"]) {
      const parsed = DshUserTextAttachmentSchema.safeParse({
        kind: "image",
        name: "a",
        thumb: `data:image/${mime};base64,aGk=`,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.thumb).toBe(`data:image/${mime};base64,aGk=`);
        expect(parsed.data.kind).toBe("image");
      }
    }
  });

  it("projects wrong-MIME thumbs to undefined while the entry survives", () => {
    for (const thumb of [
      "data:image/svg+xml;base64,PHN2Zw==", // 危险 MIME（脚本承载面）
      "data:text/plain;base64,aGk=",
      "https://evil.example/pixel.png", // 非 dataURL
      "data:image/png;base64,", // 空 base64 载荷（前缀合法但无内容）
    ]) {
      const parsed = DshUserTextAttachmentSchema.safeParse({ kind: "image", name: "a", thumb });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.thumb).toBeUndefined();
        expect(parsed.data.name).toBe("a");
      }
    }
  });

  it("projects oversized thumbs (>256KiB) to undefined", () => {
    const thumb = `data:image/png;base64,${"A".repeat(MAX_THUMB_CHARS)}`;
    expect(thumb.length).toBeGreaterThan(MAX_THUMB_CHARS);
    const parsed = DshUserTextAttachmentSchema.safeParse({ kind: "image", name: "big", thumb });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.thumb).toBeUndefined();
    // 恰好在界内（≤256KiB）仍保留。
    const atLimit = `data:image/png;base64,${"A".repeat(MAX_THUMB_CHARS - "data:image/png;base64,".length)}`;
    expect(atLimit.length).toBe(MAX_THUMB_CHARS);
    const kept = DshUserTextAttachmentSchema.safeParse({
      kind: "image",
      name: "fit",
      thumb: atLimit,
    });
    expect(kept.success).toBe(true);
    if (kept.success) expect(kept.data.thumb).toBe(atLimit);
  });

  it("projects non-string thumbs to undefined and keeps file entries unaffected", () => {
    const malformed = DshUserTextAttachmentSchema.safeParse({
      kind: "image",
      name: "a",
      thumb: 42,
    });
    expect(malformed.success).toBe(true);
    if (malformed.success) expect(malformed.data.thumb).toBeUndefined();

    const file = DshUserTextAttachmentSchema.safeParse({ kind: "file", name: "b.txt" });
    expect(file.success).toBe(true);
    if (file.success) expect(file.data.thumb).toBeUndefined();
  });

  it("still rejects structurally invalid entries (bad kind)", () => {
    expect(DshUserTextAttachmentSchema.safeParse({ kind: "video", name: "a" }).success).toBe(false);
  });
});
