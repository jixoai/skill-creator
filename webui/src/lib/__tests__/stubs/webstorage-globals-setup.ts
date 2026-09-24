/**
 * webstorage 全局遮蔽归一（2026-09-25 Windows 测试债根因）：Node ≥25 的实验
 * webstorage 在 globalThis 上预置 `localStorage` 惰性 getter（无
 * --localstorage-file 时恒 undefined）；vitest populateGlobal 跳过已存在键、
 * 且把 `window === globalThis`，真 jsdom storage 经任何全局桥都不可达——裸
 * `localStorage` 在此类 Node 上恒 undefined，store 与测试的裸引用全线失效。
 * 此处在全局求值为 undefined 时绑定进程内 Storage shim（每文件独立实例，
 * 隔离语义与 jsdom 一致）；旧 Node / 未遮蔽平台上零改动。
 */

/** jsdom Storage 的进程内等价实现（测试环境专用，非持久化）。 */
function createStorageShim(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

type StorageGlobal = "localStorage" | "sessionStorage";

// 只在 DOM 环境文件（@vitest-environment jsdom）里重绑；node 环境零影响。
if (typeof document !== "undefined") {
  for (const key of [
    "localStorage",
    "sessionStorage",
  ] as const satisfies readonly StorageGlobal[]) {
    if ((globalThis as Record<StorageGlobal, unknown>)[key] === undefined) {
      Object.defineProperty(globalThis, key, {
        value: createStorageShim(),
        configurable: true,
        writable: true,
        enumerable: true,
      });
    }
  }
}
