/**
 * tantivy 后端不可用路径（jixoai-search-core tasks 1.8）。
 *
 * User input [2026-09-21]：「dynamic import 加载 binding（静态 import 会让
 * sqlite-only 环境直接崩；加载失败/平台缺失 → typed SEARCH_BACKEND_UNAVAILABLE，
 * 消息含原因）。」
 *
 * Orthogonal intents:
 *   [1] typed 拒绝：binding 加载失败时 openIndex(backend: "tantivy") 以
 *       SEARCH_BACKEND_UNAVAILABLE 拒绝，消息含原因与回落提示。
 *   [2] 无副作用：不可用后端在触碰目录前拒绝——既有目录（含坏信封）原样保留，
 *       不发生删除/重建。
 *
 * 独立文件：vi.mock 拦截本文件模块图内的 binding dynamic import，不污染其它测试。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openIndex } from "../src/index.js";

vi.mock("@oxdev03/node-tantivy-binding", () => {
  throw new Error("Cannot find module '@oxdev03/node-tantivy-binding' (mocked native absence)");
});

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jixoai-search-unavailable-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("tantivy backend unavailability", () => {
  it("rejects with SEARCH_BACKEND_UNAVAILABLE carrying the load failure reason", async () => {
    const error = await openIndex({
      directory: path.join(sandbox, "idx"),
      fields: { name: { weight: 1 } },
      backend: "tantivy",
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SEARCH_BACKEND_UNAVAILABLE" });
    expect((error as Error).message).toContain("@oxdev03/node-tantivy-binding");
    expect((error as Error).message).toContain("sqlite");
  });

  it("leaves an existing directory untouched when the backend is unavailable", async () => {
    // 目录带坏信封 + 哨兵文件：若不可用后端走到了信封比对，目录会被删除重建。
    const directory = path.join(sandbox, "idx");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "envelope.json"), "{ not an envelope", "utf8");
    fs.writeFileSync(path.join(directory, "sentinel.txt"), "keep me", "utf8");

    await expect(
      openIndex({ directory, fields: { name: { weight: 1 } }, backend: "tantivy" }),
    ).rejects.toMatchObject({ code: "SEARCH_BACKEND_UNAVAILABLE" });

    expect(fs.existsSync(path.join(directory, "sentinel.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(directory, "envelope.json"), "utf8")).toBe(
      "{ not an envelope",
    );
  });
});
