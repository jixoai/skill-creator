/**
 * 信封错误三态与重建删除收紧（jixoai-search-core Phase 1 codex 复核 P1-1）。
 *
 * User input [2026-09-21]：「信封读取三态：missing/invalid/io-error；重建路径
 * 收紧：删除前检查目录内容是否全部属于 backend 已知产物，发现未知文件 →
 * SEARCH_IO（消息列未知文件），不删任何东西；mismatch 同样走收紧后的删除。」
 *
 * Orthogonal intents:
 *   [1] 三态语义：missing/invalid + 纯已知产物 → 重建成功；invalid/missing +
 *       未知内容（sentinel）→ SEARCH_IO 拒删、字节原样保留；EACCES（chmod 000）
 *       → SEARCH_IO、目录零改动。
 *   [2] mismatch 收紧：合法信封指纹不符时同样受产物审计约束（sentinel 拒删；
 *       纯产物正常重建——与 api.test.ts 的重建用例互补）。
 *   [3] tantivy 临时文件白名单精度（codex r2 R2-2）：`.tmp*` 不整体放行——
 *       用户文件 `.tmp-user-data` 按未知内容拒删；仅探针实证的合并瞬态命名
 *       `.tmp` + 6 位 [A-Za-z0-9]（tantivy 0.25.0 tempfile crate，
 *       /tmp/tantivy-tmpfile-probe.ts 三轮共 158 个瞬态名零偏离）放行重建。
 *   [4] 审计类型绑定（codex r3 R2-2 P1）：白名单只认普通文件——合法命名的
 *       目录（`.tmpwuMelD/secret`、`meta.json/secret`）与符号链接即使名字
 *       命中 backend 产物模式也按未知内容拒删，目录内字节/外部目标原样保留
 *       （重建删除是递归 rmSync，类型盲区会把子目录连同未知内容整目录删除）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openIndex, SearchError, type SearchBackend } from "../src/index.js";

const FIELDS = { name: { weight: 5 } };

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jixoai-search-envelope-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function directory(): string {
  return path.join(sandbox, "idx");
}

/** 造一个「合法信封但指纹不符」的目录：先真开一次让 backend 产物落盘，再篡改。 */
async function seedMismatchedEnvelope(backend: SearchBackend): Promise<void> {
  const index = await openIndex({ directory: directory(), fields: FIELDS, backend });
  await index.upsert([{ id: "a", fields: { name: "webpack bundler" } }]);
  await index.close();
  const envelopePath = path.join(directory(), "envelope.json");
  const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8")) as Record<string, unknown>;
  envelope.tokenizerVersion = "segmenter-bigram-v9";
  fs.writeFileSync(envelopePath, JSON.stringify(envelope), "utf8");
}

/** 造一个 invalid 信封目录（坏 JSON）+ 可选 backend 产物。 */
function seedInvalidEnvelope(backendArtifact: string | null): void {
  fs.mkdirSync(directory(), { recursive: true });
  fs.writeFileSync(path.join(directory(), "envelope.json"), "{ not an envelope", "utf8");
  if (backendArtifact !== null) {
    fs.writeFileSync(path.join(directory(), backendArtifact), "backend artifact bytes", "utf8");
  }
}

function snapshotListing(): string {
  return fs
    .readdirSync(directory())
    .sort()
    .map(
      (name) =>
        `${name}:${fs.statSync(path.join(directory(), name)).isDirectory() ? "dir" : fs.readFileSync(path.join(directory(), name), "utf8")}`,
    )
    .join("|");
}

describe("envelope three-state read and tightened rebuild", () => {
  for (const backend of ["sqlite", "tantivy"] as const) {
    describe(`(${backend} backend)`, () => {
      it("rebuilds when the envelope is invalid but the directory holds only backend artifacts", async () => {
        const artifact = backend === "sqlite" ? "index.sqlite3" : "meta.json";
        seedInvalidEnvelope(artifact);
        const index = await openIndex({ directory: directory(), fields: FIELDS, backend });
        expect((await index.search("webpack")).total).toBe(0);
        await index.upsert([{ id: "b", fields: { name: "webpack bundler" } }]);
        expect((await index.search("webpack")).total).toBe(1);
        await index.close();
      });

      it("refuses to delete unknown content alongside an invalid envelope", async () => {
        seedInvalidEnvelope("index.sqlite3");
        fs.writeFileSync(path.join(directory(), "sentinel.txt"), "keep me", "utf8");
        const before = snapshotListing();

        const error = await openIndex({ directory: directory(), fields: FIELDS, backend }).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(SearchError);
        expect(error).toMatchObject({ code: "SEARCH_IO" });
        expect((error as Error).message).toContain("sentinel.txt");
        expect(snapshotListing()).toBe(before);
      });

      it("refuses to delete unknown content when the envelope is missing", async () => {
        fs.mkdirSync(directory(), { recursive: true });
        fs.writeFileSync(path.join(directory(), "sentinel.txt"), "keep me", "utf8");
        const before = snapshotListing();

        await expect(
          openIndex({ directory: directory(), fields: FIELDS, backend }),
        ).rejects.toMatchObject({ code: "SEARCH_IO" });
        expect(snapshotListing()).toBe(before);
      });

      it("treats an EACCES envelope read as hard io-error leaving the directory untouched", async () => {
        seedInvalidEnvelope("index.sqlite3");
        fs.writeFileSync(path.join(directory(), "sentinel.txt"), "keep me", "utf8");
        const before = snapshotListing();
        fs.chmodSync(directory(), 0o000);
        try {
          const error = await openIndex({
            directory: directory(),
            fields: FIELDS,
            backend,
          }).catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(SearchError);
          expect(error).toMatchObject({ code: "SEARCH_IO" });
        } finally {
          fs.chmodSync(directory(), 0o755);
        }
        expect(snapshotListing()).toBe(before);
      });

      it("refuses a mismatch rebuild when unknown content is present, rebuilds without it", async () => {
        await seedMismatchedEnvelope(backend);
        fs.writeFileSync(path.join(directory(), "sentinel.txt"), "keep me", "utf8");
        const before = snapshotListing();

        await expect(
          openIndex({ directory: directory(), fields: FIELDS, backend }),
        ).rejects.toMatchObject({ code: "SEARCH_IO" });
        expect(snapshotListing()).toBe(before);

        // 移除哨兵后同一 mismatch 目录正常重建（信封 + backend 产物均在 allowlist）。
        fs.rmSync(path.join(directory(), "sentinel.txt"));
        const index = await openIndex({ directory: directory(), fields: FIELDS, backend });
        expect((await index.search("webpack")).total).toBe(0);
        await index.close();
      });
    });
  }

  describe("(tantivy merge temp-file allowlist precision)", () => {
    it("refuses to delete a user file named .tmp-user-data and preserves its bytes", async () => {
      seedInvalidEnvelope("meta.json");
      fs.writeFileSync(path.join(directory(), ".tmp-user-data"), "user data bytes", "utf8");
      const before = snapshotListing();

      // `.tmp` 前缀不再是整体白名单：非引擎瞬态命名（带连字符的用户文件）
      // 按未知内容拒删、字节保留。
      const error = await openIndex({
        directory: directory(),
        fields: FIELDS,
        backend: "tantivy",
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SearchError);
      expect(error).toMatchObject({ code: "SEARCH_IO" });
      expect((error as Error).message).toContain(".tmp-user-data");
      expect(snapshotListing()).toBe(before);
    });

    it("rebuilds over a leftover tantivy merge temp file (.tmp + 6 alnum)", async () => {
      seedInvalidEnvelope("meta.json");
      // 探针捕捉的真实瞬态命名（崩溃残留的合并临时文件）：必须视为 backend
      // 产物放行重建，否则一次中断的 merge 会把目录永久变成不可重建。
      const tempName = ".tmpwuMelD";
      fs.writeFileSync(path.join(directory(), tempName), "merge residue", "utf8");

      const index = await openIndex({ directory: directory(), fields: FIELDS, backend: "tantivy" });
      expect((await index.search("webpack")).total).toBe(0);
      await index.upsert([{ id: "b", fields: { name: "webpack bundler" } }]);
      expect((await index.search("webpack")).total).toBe(1);
      await index.close();
      // 重建是目录级删除重建：残留临时文件必须随之消失。
      expect(fs.existsSync(path.join(directory(), tempName))).toBe(false);
    });
  });

  describe("(ownership audit binds allowlist to plain files)", () => {
    it("refuses to rebuild over a directory named like a tantivy merge temp file", async () => {
      // codex r3 复现：`.tmpwuMelD` 名字命中瞬态白名单，但作为目录携带未知
      // 内容（secret）——类型盲区的名字匹配会把它连同内容整目录递归删除。
      seedInvalidEnvelope("meta.json");
      const secretPath = path.join(directory(), ".tmpwuMelD", "secret");
      fs.mkdirSync(path.dirname(secretPath));
      fs.writeFileSync(secretPath, "directory secret bytes", "utf8");
      const before = snapshotListing();

      const error = await openIndex({
        directory: directory(),
        fields: FIELDS,
        backend: "tantivy",
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SearchError);
      expect(error).toMatchObject({ code: "SEARCH_IO" });
      expect((error as Error).message).toContain(".tmpwuMelD");
      expect(snapshotListing()).toBe(before);
      // 目录内部字节原样保留（不是只留下空壳目录）。
      expect(fs.readFileSync(secretPath, "utf8")).toBe("directory secret bytes");
    });

    it("refuses to rebuild over a directory named meta.json (backend artifact name as a directory)", async () => {
      // meta.json 是 tantivy 的元数据产物名（invalid 信封按两后端并集审计）；
      // 同名目录同样必须按未知内容拒删，不能因名字合法而放行递归删除。
      seedInvalidEnvelope(null);
      const secretPath = path.join(directory(), "meta.json", "secret");
      fs.mkdirSync(path.dirname(secretPath));
      fs.writeFileSync(secretPath, "sqlite-shape secret bytes", "utf8");
      const before = snapshotListing();

      const error = await openIndex({
        directory: directory(),
        fields: FIELDS,
        backend: "sqlite",
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SearchError);
      expect(error).toMatchObject({ code: "SEARCH_IO" });
      expect((error as Error).message).toContain("meta.json");
      expect(snapshotListing()).toBe(before);
      expect(fs.readFileSync(secretPath, "utf8")).toBe("sqlite-shape secret bytes");
    });

    it("refuses a mismatch rebuild over a directory named like a tantivy merge temp file", async () => {
      // mismatch 路径（合法信封、指纹不符）：owners 按 envelope.backend 收窄为
      // tantivy——`.tmpwuMelD` 仍在白名单内，类型绑定是它被拒删的唯一理由。
      await seedMismatchedEnvelope("tantivy");
      const secretPath = path.join(directory(), ".tmpwuMelD", "secret");
      fs.mkdirSync(path.dirname(secretPath));
      fs.writeFileSync(secretPath, "mismatch secret bytes", "utf8");
      const before = snapshotListing();

      await expect(
        openIndex({ directory: directory(), fields: FIELDS, backend: "tantivy" }),
      ).rejects.toMatchObject({ code: "SEARCH_IO" });
      expect(snapshotListing()).toBe(before);
      expect(fs.readFileSync(secretPath, "utf8")).toBe("mismatch secret bytes");
    });

    it("refuses a symlink with an allowlisted name and leaves the external target untouched", async () => {
      // 符号链接按非普通文件拒删（lstat 口径）：即使名字命中瞬态白名单也不得
      // 进入重建删除集合；外部目标字节不因链接的存在而被波及。
      seedInvalidEnvelope("meta.json");
      const targetPath = path.join(sandbox, "outside-target.bin");
      fs.writeFileSync(targetPath, "external payload bytes", "utf8");
      fs.symlinkSync(targetPath, path.join(directory(), ".tmpwuMelD"));
      const before = snapshotListing();

      const error = await openIndex({
        directory: directory(),
        fields: FIELDS,
        backend: "tantivy",
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SearchError);
      expect(error).toMatchObject({ code: "SEARCH_IO" });
      expect((error as Error).message).toContain(".tmpwuMelD");
      expect(snapshotListing()).toBe(before);
      expect(fs.readFileSync(targetPath, "utf8")).toBe("external payload bytes");
    });
  });
});
