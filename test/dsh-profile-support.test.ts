/**
 * 用户原始需求 [2026-10-04]：「页面上有 agent kernel is not mounted 这种提示？」
 * （生产连续降级事故：heal 写锁孤儿 + 镜像 symlink 目标内容漂移——守护函数
 * 的事故复现场景必须钉死。）
 * 正交意图：
 *   [1] 孤儿锁恢复的判定矩阵（死 PID/活 PID/空新锁/空老锁）。
 *   [2] 镜像宿主源重锚的来源判定（漂移重链/宿主缺失保留/已锚不动/断链跳过）。
 * 妥协声明：无——纯文件系统行为，全部临时目录隔离。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  reanchorMirrorToHost,
  recoverProfilesOrphanLocks,
} from "../src/daemon/dsh-profile-support.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-profile-support-"));
}

function makePackage(
  tree: string,
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
): string {
  // 标准 node_modules 布局（createRequire 的 resolve 逐级查 <anchor>/node_modules；
  // 无此层的裸目录 resolve 不到，会回落到 NODE_PATH 污染断言）。
  const pkgDir = path.join(tree, "node_modules", "@deepseek-ai", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: `@deepseek-ai/${name}`, version, dependencies }),
  );
  return pkgDir;
}

describe("dsh-profile-support 守护（2026-10-04 事故）", () => {
  it("recoverProfilesOrphanLocks removes a lock whose owner PID is dead", () => {
    const home = tempHome();
    const lock = path.join(home, "profiles", "node_modules.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, "999999999\n"); // 不可能存活的 PID。
    const removed = recoverProfilesOrphanLocks(home);
    assert.deepEqual(removed, ["node_modules.lock"]);
    assert.equal(fs.existsSync(lock), false);
  });

  it("recoverProfilesOrphanLocks keeps a lock owned by a live process", () => {
    const home = tempHome();
    const lock = path.join(home, "profiles", "node_modules.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, `${process.pid}\n`);
    assert.deepEqual(recoverProfilesOrphanLocks(home), []);
    assert.equal(fs.existsSync(lock), true);
  });

  it("recoverProfilesOrphanLocks keeps a fresh empty lock and clears an aged one", () => {
    const home = tempHome();
    const lock = path.join(home, "profiles", "node_modules.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, ""); // 写 PID 前被杀的形态（2026-10-04 事故现场）。
    const now = Date.now();
    assert.deepEqual(recoverProfilesOrphanLocks(home, now), []); // 新锁：创建窗口内。
    fs.utimesSync(lock, new Date(now - 120_000), new Date(now - 120_000));
    assert.deepEqual(recoverProfilesOrphanLocks(home, now), ["node_modules.lock"]);
  });

  it("recoverProfilesOrphanLocks tolerates a missing profiles directory", () => {
    assert.deepEqual(recoverProfilesOrphanLocks(tempHome()), []);
  });

  it("reanchorMirrorToHost hot-rebuilds the mirror when a family package drifted", () => {
    const home = tempHome();
    const hostTree = tempHome();
    const cacheTree = tempHome();
    // 宿主闭包：dsh-base 声明家族依赖（重建种子的闭包展开源）。
    const hostBase = makePackage(hostTree, "dsh-base", "0.1.6-alpha.1", {
      "@deepseek-ai/dsh-typert-loader": "0.1.6-alpha.1",
    });
    makePackage(hostTree, "dsh-typert-loader", "0.1.6-alpha.1");
    // 漂移现场：镜像 typert 指向缓存 alpha.2（npx warmup 刷新后），家族其余 alpha.1。
    const driftedPkg = makePackage(cacheTree, "dsh-typert-loader", "0.1.6-alpha.2");
    const scope = path.join(home, "profiles", "node_modules", "@deepseek-ai");
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(driftedPkg, path.join(scope, "dsh-typert-loader"));
    fs.symlinkSync(hostBase, path.join(scope, "dsh-base"));

    const report = reanchorMirrorToHost(home, path.join(hostTree, "package.json"));
    assert.deepEqual(report.trigger, ["dsh-typert-loader"]); // 漂移检测命中。
    // 热重建：镜像换血为宿主闭包（种子 dsh-base + 传递闭包），漂移包回落宿主源。
    assert.ok(report.rebuilt.includes("@deepseek-ai/dsh-base"));
    const relinkedTypert = fs.readlinkSync(path.join(scope, "dsh-typert-loader"));
    // resolve 返回 realpath 形式（macOS /var→/private/var）：宿主基准同规范化。
    assert.ok(
      relinkedTypert.startsWith(path.join(fs.realpathSync(hostTree), "node_modules")),
      "typert 应回到宿主树实例",
    );
    assert.equal(manifestVersionOf(path.join(scope, "dsh-typert-loader")), "0.1.6-alpha.1");
  });

  it("reanchorMirrorToHost is a no-op when the mirror is consistent with the host pin", () => {
    const home = tempHome();
    const hostTree = tempHome();
    const cacheTree = tempHome();
    const hostBase = makePackage(hostTree, "dsh-base", "0.1.6-alpha.1");
    const cachePkg = makePackage(cacheTree, "dsh-typert-loader", "0.1.6-alpha.1"); // 版本一致：自洽缓存树。
    const scope = path.join(home, "profiles", "node_modules", "@deepseek-ai");
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(cachePkg, path.join(scope, "dsh-typert-loader"));
    fs.symlinkSync(hostBase, path.join(scope, "dsh-base"));
    const before = fs.readlinkSync(path.join(scope, "dsh-typert-loader"));

    const report = reanchorMirrorToHost(home, path.join(hostTree, "package.json"));
    assert.deepEqual(report.trigger, []);
    assert.deepEqual(report.rebuilt, []);
    assert.equal(fs.readlinkSync(path.join(scope, "dsh-typert-loader")), before); // 未动。
  });

  it("reanchorMirrorToHost ignores non-dsh packages and tolerates a missing host dsh-base", () => {
    const home = tempHome();
    const hostTree = tempHome(); // 无 dsh-base：异常安装形态。
    const cacheTree = tempHome();
    const cachePkg = makePackage(cacheTree, "cordis-plugin-loader", "1.0.3"); // 非 dsh-*：不参与。
    const scope = path.join(home, "profiles", "node_modules", "@deepseek-ai");
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(cachePkg, path.join(scope, "cordis-plugin-loader"));

    const report = reanchorMirrorToHost(home, path.join(hostTree, "package.json"));
    assert.deepEqual(report.trigger, []);
    assert.deepEqual(report.rebuilt, []);
    assert.equal(fs.readlinkSync(path.join(scope, "cordis-plugin-loader")), cachePkg);
  });
});

function manifestVersionOf(pkgDir: string): string | null {
  try {
    return (
      (
        JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
          version?: string;
        }
      ).version ?? null
    );
  } catch {
    return null;
  }
}
