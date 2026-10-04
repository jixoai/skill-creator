// @vitest-environment jsdom
/**
 * 错误 toast 分层渲染测试（webui-i18n-bilingual task 4.5 δ 线）。
 *
 * 用户原始需求 [2026-10-05]（Owner 裁决）：「客观留存这个错误，是调试的关键，
 * 但是可以辅助一些 i18n 的比较宽泛的翻译」。
 *
 * 正交意图：
 *   [1] showErrorToast 语义：error 变体标记 + 保留 lifecycle key 取代语义；
 *       showToast 行为不变（信息 toast 不进分类器）。
 *   [2] toast-container 分层渲染：宽泛提示主显 + 原文次行/title（永不丢弃）；
 *       未命中家族 = 原文原样（零降级）。
 *   [3] ErrorHint 公共组件：命中 = 提示 + 原文两行；未命中 = 原文单行。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import ToastContainer from "$lib/components/toast-container.svelte";
import ErrorHint from "$lib/components/error-hint.svelte";
import { dismissToast, showErrorToast, showToast, toasts } from "$lib/toast.svelte";
import { __resetLocaleForTests, setLocale, t } from "$lib/i18n";
import { errorHintsEn, errorHintsZh } from "$lib/i18n/catalogs/domains/error-hints.js";

const EACCES_RAW = "EACCES: permission denied, open '/Users/me/.agents/skills/foo/SKILL.md'";

function mountContainer() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ToastContainer, { target });
  flushSync();
  const cleanup = () => {
    unmount(instance);
    target.remove();
  };
  return { target, cleanup };
}

function mountHint(props: { error: string }) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ErrorHint, { target, props });
  flushSync();
  const cleanup = () => {
    unmount(instance);
    target.remove();
  };
  return { target, cleanup };
}

beforeEach(() => {
  localStorage.clear();
  __resetLocaleForTests();
  for (const toast of [...toasts]) dismissToast(toast.id);
  expect(toasts).toHaveLength(0);
});

afterEach(() => {
  for (const toast of [...toasts]) dismissToast(toast.id);
});

describe("showErrorToast 语义（store 层）", () => {
  it("marks the toast as the error variant", () => {
    showErrorToast(EACCES_RAW);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.error).toBe(true);
    expect(toasts[0]?.message).toBe(EACCES_RAW); // 原文原样入队，永不改写
  });

  it("keeps showToast untouched (info toast never enters the classifier)", () => {
    showToast(EACCES_RAW);
    expect(toasts[0]?.error).toBeUndefined();
  });

  it("preserves lifecycle-key replacement for error toasts", () => {
    showErrorToast("Run failed: fatal: could not clone", undefined, "eval-run-r1");
    showErrorToast("Repository service is shutting down.", undefined, "eval-run-r1");
    expect(toasts).toHaveLength(1); // 同 key 取代：终态帧唯一
    expect(toasts[0]?.message).toBe("Repository service is shutting down.");
  });
});

describe("toast-container 分层渲染（DOM 层）", () => {
  it("renders hint as the main line and keeps the raw text as secondary + title", () => {
    const { target, cleanup } = mountContainer();
    showErrorToast(EACCES_RAW);
    flushSync();

    const toastEl = target.querySelector("[data-toast-error]");
    expect(toastEl).not.toBeNull();
    expect(toastEl?.getAttribute("title")).toBe(EACCES_RAW);
    expect(toastEl?.querySelector("[data-error-hint]")?.textContent).toBe(
      errorHintsEn["errorHints.permission"],
    );
    expect(toastEl?.querySelector("[data-error-raw]")?.textContent).toBe(EACCES_RAW);
    cleanup();
  });

  it("renders the raw text alone when no family matches（零降级）", () => {
    const { target, cleanup } = mountContainer();
    showErrorToast("Installer returned an unexpected skill path.");
    flushSync();

    expect(target.querySelector("[data-error-hint]")).toBeNull();
    expect(target.querySelector("[data-error-raw]")?.textContent).toBe(
      "Installer returned an unexpected skill path.",
    );
    cleanup();
  });

  it("does not classify non-error toasts even with classifiable text", () => {
    const { target, cleanup } = mountContainer();
    showToast(EACCES_RAW); // 信息 toast 带可分类文本：不叠加提示
    flushSync();

    expect(target.querySelector("[data-toast-error]")).toBeNull();
    expect(target.querySelector("[data-error-hint]")).toBeNull();
    expect(target.textContent).toContain(EACCES_RAW);
    cleanup();
  });

  it("flips the hint language with the locale（zh 宽泛文案）", () => {
    const { target, cleanup } = mountContainer();
    setLocale("zh");
    showErrorToast(EACCES_RAW);
    flushSync();

    expect(target.querySelector("[data-error-hint]")?.textContent).toBe(
      errorHintsZh["errorHints.permission"],
    );
    expect(target.querySelector("[data-error-raw]")?.textContent).toBe(EACCES_RAW);
    cleanup();
  });
});

describe("ErrorHint 公共组件（error state 渲染面）", () => {
  it("renders hint + raw pair when a family matches", () => {
    const { target, cleanup } = mountHint({ error: EACCES_RAW });
    expect(target.querySelector("[data-error-hint]")?.textContent).toBe(t("errorHints.permission"));
    expect(target.querySelector("[data-error-raw]")?.textContent).toBe(EACCES_RAW);
    cleanup();
  });

  it("renders the raw text as a single line when unmatched（零降级）", () => {
    const { target, cleanup } = mountHint({ error: "Something unrelated." });
    expect(target.querySelector("[data-error-hint]")).toBeNull();
    expect(target.querySelectorAll("p")).toHaveLength(1);
    expect(target.querySelector("[data-error-raw]")?.textContent).toBe("Something unrelated.");
    cleanup();
  });
});
