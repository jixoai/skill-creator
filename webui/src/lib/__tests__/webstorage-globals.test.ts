// @vitest-environment jsdom
/**
 * webstorage 全局遮蔽回归钉（2026-09-25 Windows 测试债）：Node ≥25 的实验
 * webstorage 在 globalThis 上先占 `localStorage`/`sessionStorage`（无
 * --localstorage-file 恒 undefined），vitest 不覆盖既有键——jsdom 文件里裸
 * storage 全局必须经 webstorage-globals-setup 重绑为 jsdom 实现，store 代码
 * 与既有测试（agent-submission 等）的裸引用才可用。
 */
import { expect, it } from "vitest";

it("bare webstorage globals resolve to the jsdom implementation", () => {
  expect(typeof localStorage).toBe("object");
  expect(typeof sessionStorage).toBe("object");
  localStorage.setItem("sc.probe", "1");
  expect(localStorage.getItem("sc.probe")).toBe("1");
  localStorage.removeItem("sc.probe");
  sessionStorage.setItem("sc.probe", "2");
  expect(sessionStorage.getItem("sc.probe")).toBe("2");
  sessionStorage.clear();
});
