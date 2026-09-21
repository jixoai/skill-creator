/**
 * tantivy mutation 失败三态（jixoai-search-core Phase 1 codex 复核 P2-4）。
 *
 * User input [2026-09-21]：「给 writer/index 操作注入可失败 seam，覆盖 partial
 * batch / commit 失败 / reload 失败，断言进程内状态与 close+reopen 后结果的
 * 一致性——commit 成功后 reload 失败不得回滚磁盘（已提交内容与镜像分裂即 bug）。」
 *
 * Orthogonal intents:
 *   [1] partial batch / commit 失败：SEARCH_IO + 引擎 rollback + 镜像回放——
 *       失败批零残留（进程内与 reopen 后一致，后续成功 mutation 不泄漏失败批）。
 *   [2] reload 失败（commit 已成功）：SEARCH_IO 但盘面保留已提交内容、镜像
 *       不撤销——后续成功 reload 后进程内分数与 reopen 重放逐字节一致。
 *   [3] remove 路径同构：commit 失败的删除不生效。
 *   [4] stale reader 门（codex r2 R2-1）：reload 失败后重试同 id upsert/remove，
 *       mutation 前强制刷新 reader——旧 reader 查不到已提交版本会漏发 delete
 *       （upsert 同 id 双版本）或跳过删除（remove 旧内容跨 reopen 存活）；
 *       门内刷新仍失败 → SEARCH_IO 不带病继续。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTantivyIndex, type TantivyMutationSeam } from "../src/backends/tantivy.js";
import type { SearchIndex } from "../src/index.js";

const FIELDS = { name: { weight: 5 }, body: { weight: 1 } };
const SCORING = { fuzzy: 0.2, prefix: true } as const;

let sandbox = "";
let index: SearchIndex | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jixoai-search-tantivy-fail-"));
});

afterEach(async () => {
  await index?.close();
  index = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 可编程 seam：在 write/commit/reload 的第 N 次调用上一次性注入失败（后续恢复）；
 * failReloadFrom 从第 N 次起持续失败（覆盖门内强制 reload 也失败的场景）。 */
function failingSeam(failures: {
  failWriteAt?: number;
  failCommitAt?: number;
  failReloadAt?: number;
  failReloadFrom?: number;
}): TantivyMutationSeam & { state: { writes: number; commits: number; reloads: number } } {
  const state = { writes: 0, commits: 0, reloads: 0 };
  return {
    state,
    write: (operation) => {
      state.writes += 1;
      if (failures.failWriteAt === state.writes) {
        throw new Error(`injected write failure #${state.writes}`);
      }
      operation();
    },
    commit: (operation) => {
      state.commits += 1;
      if (failures.failCommitAt === state.commits) {
        throw new Error(`injected commit failure #${state.commits}`);
      }
      operation();
    },
    reload: (operation) => {
      state.reloads += 1;
      const persistent =
        failures.failReloadFrom !== undefined && state.reloads >= failures.failReloadFrom;
      if (failures.failReloadAt === state.reloads || persistent) {
        throw new Error(`injected reload failure #${state.reloads}`);
      }
      operation();
    },
  };
}

async function open(
  seam?: TantivyMutationSeam,
  directory = path.join(sandbox, "idx"),
): Promise<SearchIndex> {
  fs.mkdirSync(directory, { recursive: true });
  index = await openTantivyIndex({
    directory,
    fields: FIELDS,
    scoring: SCORING,
    mutationSeam: seam,
  });
  return index;
}

/** 进程内 vs reopen 的逐字节一致性（45-query 式缩样：每词单查 + 组合查）。 */
async function assertReplayConsistency(
  current: SearchIndex,
  directory: string,
): Promise<SearchIndex> {
  const queries = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "alpha beta"];
  const inProcess = queries.map(() => "");
  for (const [i, query] of queries.entries()) {
    inProcess[i] = JSON.stringify(await current.search(query));
  }
  await current.close();
  const reopened = await open(undefined, directory);
  for (const [i, query] of queries.entries()) {
    expect(
      JSON.stringify(await reopened.search(query)),
      `reopen replay mismatch for query "${query}"`,
    ).toBe(inProcess[i]);
  }
  return reopened;
}

describe("tantivy mutation failure states (injected seam)", () => {
  it("rolls back a partial batch: zero residue in-process, on disk, and across later commits", async () => {
    // failWriteAt = 3：write 调用序 = addDocument(a)=1, addDocument(b)=2,
    // addDocument(c)=3 → c 上注入失败（真 mid-batch），后续 write 恢复。
    const seam = failingSeam({ failWriteAt: 3 });
    const search = await open(seam);
    await search.upsert([{ id: "a", fields: { name: "alpha beta", body: "" } }]);

    await expect(
      search.upsert([
        { id: "b", fields: { name: "gamma delta", body: "" } },
        { id: "c", fields: { name: "epsilon zeta", body: "" } },
      ]),
    ).rejects.toMatchObject({ code: "SEARCH_IO" });
    // 进程内：失败批零残留、既有文档完好。
    expect((await search.search("gamma")).total).toBe(0);
    expect((await search.search("alpha")).total).toBe(1);
    // 后续成功 mutation 不得把 rollback 掉的 pending 操作泄漏进新 commit。
    await search.upsert([{ id: "d", fields: { name: "theta iota", body: "" } }]);
    expect((await search.search("gamma")).total).toBe(0);
    expect((await search.search("epsilon")).total).toBe(0);
    expect((await search.search("theta")).total).toBe(1);
    const reopened = await assertReplayConsistency(search, path.join(sandbox, "idx"));
    expect((await reopened.search("gamma")).total).toBe(0);
    expect((await reopened.search("theta")).total).toBe(1);
  });

  it("rolls back an uncommitted batch on commit failure", async () => {
    const seam = failingSeam({ failCommitAt: 2 });
    const search = await open(seam);
    await search.upsert([{ id: "a", fields: { name: "alpha beta", body: "" } }]);
    // 第二次 commit 注入失败（writer.commit 未执行 → 未发布）。
    await expect(
      search.upsert([{ id: "b", fields: { name: "gamma delta", body: "" } }]),
    ).rejects.toMatchObject({ code: "SEARCH_IO" });
    expect((await search.search("gamma")).total).toBe(0);
    expect((await search.search("alpha")).total).toBe(1);
    const reopened = await assertReplayConsistency(search, path.join(sandbox, "idx"));
    expect((await reopened.search("gamma")).total).toBe(0);
  });

  it("keeps committed disk content and mirror when reload fails after a successful commit", async () => {
    const seam = failingSeam({ failReloadAt: 2 });
    const search = await open(seam);
    await search.upsert([{ id: "a", fields: { name: "alpha beta", body: "" } }]);
    // 第二次 reload 注入失败：writer.commit 已成功返回（binding 契约＝已发布
    // 且持久化），盘面必须保留 b，镜像不得回退。
    await expect(
      search.upsert([{ id: "b", fields: { name: "gamma delta", body: "" } }]),
    ).rejects.toMatchObject({ code: "SEARCH_IO" });

    // 后续成功 mutation（commit+reload 正常）后：b 必须在盘上且恰好一份；
    // 镜像若被错误回退，docCount/df 会偏离盘面 → 与 reopen 重放的分数不一致。
    await search.upsert([{ id: "c", fields: { name: "epsilon zeta", body: "" } }]);
    expect((await search.search("gamma")).total).toBe(1);
    const reopened = await assertReplayConsistency(search, path.join(sandbox, "idx"));
    expect((await reopened.search("gamma")).total).toBe(1);
    expect((await reopened.search("alpha")).total).toBe(1);
    expect((await reopened.search("epsilon")).total).toBe(1);
  });

  it("keeps a document when a remove fails at commit", async () => {
    const seam = failingSeam({ failCommitAt: 2 });
    const search = await open(seam);
    await search.upsert([{ id: "a", fields: { name: "alpha beta", body: "" } }]);
    await expect(search.remove(["a"])).rejects.toMatchObject({ code: "SEARCH_IO" });
    expect((await search.search("alpha")).total).toBe(1);
    const reopened = await assertReplayConsistency(search, path.join(sandbox, "idx"));
    expect((await reopened.search("alpha")).total).toBe(1);
  });

  it("forces a reader refresh before retrying a same-id upsert after a failed reload", async () => {
    const seam = failingSeam({ failReloadAt: 2 });
    const search = await open(seam);
    await search.upsert([{ id: "a", fields: { name: "alpha beta", body: "" } }]);
    // b 的 commit 成功、reload（#2）注入失败 → SEARCH_IO，盘面已有 b:gamma。
    await expect(
      search.upsert([{ id: "b", fields: { name: "gamma theta", body: "" } }]),
    ).rejects.toMatchObject({ code: "SEARCH_IO" });

    // codex r2 复现序列：立即重试同一 id 的新内容（词表与旧版本不相交）。
    // stale 门先强制 reload（#3 成功）→ fetchFieldTokens 在新 reader 上找到
    // 已提交的 gamma 版本 → delete 先于 add 发出 → 同 id 恰一份。
    await search.upsert([{ id: "b", fields: { name: "delta epsilon", body: "" } }]);
    expect((await search.search("gamma")).total).toBe(0);
    expect((await search.search("theta")).total).toBe(0);
    expect((await search.search("delta")).total).toBe(1);

    // codex 复现断言：close/reopen 后旧版本（gamma）不得存活（双版本即 bug）。
    const reopened = await assertReplayConsistency(search, path.join(sandbox, "idx"));
    expect((await reopened.search("gamma")).total).toBe(0);
    expect((await reopened.search("delta")).total).toBe(1);
    expect((await reopened.search("alpha")).total).toBe(1);
  });

  it("surfaces SEARCH_IO when the forced refresh before a retry also fails", async () => {
    // failReloadFrom：从第 2 次起持续失败——commit 后 reload（#2）与门内强制
    // reload（#3）双双失败。
    const seam = failingSeam({ failReloadFrom: 2 });
    const search = await open(seam);
    await search.upsert([{ id: "a", fields: { name: "alpha beta", body: "" } }]);
    await expect(
      search.upsert([{ id: "b", fields: { name: "gamma theta", body: "" } }]),
    ).rejects.toMatchObject({ code: "SEARCH_IO" });

    // 门内刷新失败 → SEARCH_IO，不让带病状态继续累积。
    await expect(
      search.upsert([{ id: "b", fields: { name: "delta epsilon", body: "" } }]),
    ).rejects.toMatchObject({ code: "SEARCH_IO" });

    // 调用方恢复路径：close 重开自盘面重建——已提交的 gamma 版本完好、delta
    // 未写入（两次尝试都停在 SEARCH_IO）。
    await search.close();
    index = null;
    const reopened = await open(undefined, path.join(sandbox, "idx"));
    expect((await reopened.search("gamma")).total).toBe(1);
    expect((await reopened.search("delta")).total).toBe(0);
  });

  it("forces a reader refresh before a remove that follows a failed reload", async () => {
    const seam = failingSeam({ failReloadAt: 2 });
    const search = await open(seam);
    await search.upsert([{ id: "a", fields: { name: "alpha beta", body: "" } }]);
    // b 已提交（commit 成功）但 reload 失败 → SEARCH_IO、盘面保留 b:gamma。
    await expect(
      search.upsert([{ id: "b", fields: { name: "gamma theta", body: "" } }]),
    ).rejects.toMatchObject({ code: "SEARCH_IO" });

    // 无门时 remove 在旧 reader 上查不到已提交的 b → existing=null 跳过删除
    // → gamma 跨 reopen 存活（remove 路径同构残余）。门先强制 reload（#3
    // 成功）→ b 可见 → delete 生效。
    await search.remove(["b"]);
    expect((await search.search("gamma")).total).toBe(0);
    const reopened = await assertReplayConsistency(search, path.join(sandbox, "idx"));
    expect((await reopened.search("gamma")).total).toBe(0);
    expect((await reopened.search("alpha")).total).toBe(1);
  });
});
