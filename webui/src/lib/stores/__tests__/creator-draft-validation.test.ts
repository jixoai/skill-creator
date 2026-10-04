/**
 * new 模式草稿校验纯函数测试（creator-editor-polish Ch5 task 3）。
 *
 * 用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏……草稿存组件级 $state」
 * （2026-09-30 补齐：空值禁用理由必须字段级可见，不只 Save 禁用）。
 *
 * 正交意图：
 *   [1] validateNewDraft：directoryName 规则 + name/description 修剪后非空；
 *       edit 模式恒通过。
 *   [2] hasNewDraftErrors：任一字段未过即 true（Save 禁用联动）。
 */
import { describe, expect, it } from "vitest";
import { emptyDraft, editDraft, hasNewDraftErrors, validateNewDraft } from "../creator-draft";

const target = {
  workspaceId: "ws_0123456789abcdef01234567" as never,
  providerId: "claude-code" as never,
};

describe("validateNewDraft (creator-editor-polish)", () => {
  it("flags all empty new-mode fields with per-field error keys", () => {
    const errors = validateNewDraft(emptyDraft(target));
    expect(errors.directoryName).toBe("creatorEditor.directoryRule");
    expect(errors.name).toBe("creatorEditor.nameRequired");
    expect(errors.description).toBe("creatorEditor.descriptionRequired");
    expect(hasNewDraftErrors(errors)).toBe(true);
  });

  it("accepts a valid new draft and treats whitespace-only fields as empty", () => {
    const draft = emptyDraft(target, "my-skill");
    draft.name = "code-review";
    draft.description = "  ";
    const errors = validateNewDraft(draft);
    expect(errors.directoryName).toBeNull();
    expect(errors.description).toBe("creatorEditor.descriptionRequired");
    expect(hasNewDraftErrors(errors)).toBe(true);

    draft.description = "reviews code";
    expect(hasNewDraftErrors(validateNewDraft(draft))).toBe(false);
  });

  it("rejects invalid directory names while other fields pass", () => {
    const draft = emptyDraft(target, "My_Skill");
    draft.name = "a";
    draft.description = "b";
    const errors = validateNewDraft(draft);
    expect(errors.directoryName).toBe("creatorEditor.directoryRule");
    expect(errors.name).toBeNull();
    expect(errors.description).toBeNull();
    expect(hasNewDraftErrors(errors)).toBe(true);
  });

  it("always passes in edit mode regardless of field contents", () => {
    const draft = editDraft(target, "sk_0123456789abcdef01234567" as never);
    draft.directoryName = "Not_Even_Valid";
    draft.name = " ";
    expect(validateNewDraft(draft)).toEqual({
      directoryName: null,
      name: null,
      description: null,
    });
  });
});
