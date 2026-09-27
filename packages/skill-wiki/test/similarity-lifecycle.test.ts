/**
 * 用户原始需求 [2026-09-28]（Windows 实机轮）：「distill corpus 构建打开的
 * 查重索引从未 close，sqlite 句柄在 Windows 锁住 wiki 目录 unlink（EBUSY）；
 * POSIX 对打开中文件的 unlink 宽容只是假象」。
 * 正交意图：
 *   [1] withWikiSearchIndex 会话契约：action 成功与异常路径都必须 close
 *       （关闭后使用 = SEARCH_IO "search index is closed"，平台无关观测面）。
 *   [2] 会话结束后 wiki 目录可整体删除——Windows 上句柄未关时 rm 抛 EBUSY
 *       （本测试在 Windows 实机上有真实拦截力；POSIX 上恒绿但保留文档钉）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchIndex } from "@jixoai/search";
import { withWikiSearchIndex } from "../src/index.js";

const temporaryDirectories: string[] = [];

function makeWikiDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sc-wiki-similarity-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const sources = [
  {
    name: "retry-on-conflict",
    title: "Retry on conflict",
    body: "retry the write when the store reports a conflict\n",
  },
  { name: "log-rotation", title: "Log rotation", body: "rotate logs by size\n" },
];

async function searchShouldRejectClosed(index: SearchIndex): Promise<void> {
  await expect(index.search("retry", { limit: 1 })).rejects.toMatchObject({
    name: "SearchError",
    code: "SEARCH_IO",
    message: expect.stringContaining("search index is closed"),
  });
}

describe("withWikiSearchIndex (index lifecycle session)", () => {
  it("closes the index after the action resolves (closed use rejects with SEARCH_IO)", async () => {
    const directory = makeWikiDirectory();
    let captured: SearchIndex | null = null;
    const value = await withWikiSearchIndex(
      directory,
      () => sources,
      async (index) => {
        captured = index;
        const result = await index.search("retry conflict", { limit: 2 });
        expect(result.hits.map((hit) => hit.id)).toContain("retry-on-conflict");
        return "session-value";
      },
    );
    expect(value).toBe("session-value");
    await searchShouldRejectClosed(captured as SearchIndex);
  });

  it("closes the index even when the action throws, propagating the original error", async () => {
    const directory = makeWikiDirectory();
    let captured: SearchIndex | null = null;
    await expect(
      withWikiSearchIndex(
        directory,
        () => sources,
        async (index) => {
          captured = index;
          throw new Error("action exploded");
        },
      ),
    ).rejects.toThrow("action exploded");
    await searchShouldRejectClosed(captured as SearchIndex);
  });

  it("releases the sqlite file so the wiki directory is removable after the session", async () => {
    const directory = makeWikiDirectory();
    await withWikiSearchIndex(
      directory,
      () => sources,
      async (index) => {
        // 首开全量重灌后 corpus 可检索（确保句柄真实持有过 sqlite 文件）。
        const result = await index.search("rotation", { limit: 1 });
        expect(result.hits.length).toBe(1);
      },
    );
    expect(fs.existsSync(path.join(directory, "search-index", "index.sqlite3"))).toBe(true);
    // Windows EBUSY 回归钉：句柄未关时这里抛 EBUSY；POSIX 恒绿。
    expect(() => fs.rmSync(directory, { recursive: true, force: true })).not.toThrow();
  });
});
