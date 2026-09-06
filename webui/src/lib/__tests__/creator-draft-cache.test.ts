/**
 * Creator 草稿跨卸载缓存单测（openspec dsh-webui-composition task 3.1c）。
 *
 * 用户原始需求 [2026-09-07]（tasks 3.1c）：「与官方 session 往返不丢 draft」。
 *
 * 正交意图：
 *   [1] 缓存快照隔离：存取互为拷贝，调用方修改不影响缓存本体。
 *   [2] 身份键语义：edit 按 skillId 区分；new 不带 skillId；缺 target 为 null。
 */
import { describe, expect, it } from "vitest";
import {
  cacheCreatorDraft,
  creatorDraftKey,
  dropCachedCreatorDraft,
  isDraftHydrated,
  markDraftHydrated,
  resetDraftHydration,
  snapshotCreatorDraft,
  takeCachedCreatorDraft,
} from "../stores/creator-editor.svelte";
import { emptyDraft } from "../stores/creator-draft";
import type { WorkspaceProviderTarget } from "../types";

const target: WorkspaceProviderTarget = {
  workspaceId: "ws_0123456789abcdef" as WorkspaceProviderTarget["workspaceId"],
  providerId: "openclaw" as WorkspaceProviderTarget["providerId"],
};

describe("creator draft key", () => {
  it("distinguishes edit identities by skillId and omits it for new", () => {
    expect(creatorDraftKey(target, "edit", "sk_aaaa")).toBe(
      `edit:${target.workspaceId}/${target.providerId}/sk_aaaa`,
    );
    expect(creatorDraftKey(target, "new", null)).toBe(
      `new:${target.workspaceId}/${target.providerId}`,
    );
    expect(creatorDraftKey(null, "new", null)).toBeNull();
  });
});

describe("creator draft cache", () => {
  it("snapshots are isolated from the source draft and the cache", () => {
    const draft = emptyDraft(target, "draft-one");
    draft.name = "original";
    draft.extraFrontmatter.author = "gaubee";
    const first = snapshotCreatorDraft(draft);
    first.name = "mutated";
    first.extraFrontmatter.author = "someone-else";
    expect(draft.name).toBe("original");
    expect(draft.extraFrontmatter.author).toBe("gaubee");

    const key = creatorDraftKey(target, "new", null)!;
    cacheCreatorDraft(key, draft);
    draft.name = "changed-after-cache";
    const restored = takeCachedCreatorDraft(key)!;
    expect(restored.name).toBe("original");
    restored.name = "mutated-restored";
    expect(takeCachedCreatorDraft(key)!.name).toBe("original");

    dropCachedCreatorDraft(key);
    expect(takeCachedCreatorDraft(key)).toBeNull();
  });

  it("hydration markers are per identity and resettable", () => {
    const key = creatorDraftKey(target, "edit", "sk_bbbb")!;
    expect(isDraftHydrated(key)).toBe(false);
    markDraftHydrated(key);
    expect(isDraftHydrated(key)).toBe(true);
    resetDraftHydration(key);
    expect(isDraftHydrated(key)).toBe(false);
  });
});
