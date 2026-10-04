/**
 * DSH profile 装载的共享支撑（dsh-kernel-rebase task 2.1 从 dsh-official-profile
 * 提取；web profile 与 headless kernel 共用同一镜像机制）。
 *
 * 用户原始需求 [2026-09-06]（heal 教训）+ [2026-09-07]（completeTransitiveMirror
 * 修复）+ [2026-10-04]（生产 kernel 连续降级事故：heal 写锁孤儿 + 镜像 symlink
 * 目标内容漂移——profile rows 的裸包名必须经 $DSH_HOME/profiles/node_modules
 * 可解析，且该镜像必须既无死锁又不受共享缓存刷新污染）。
 *
 * 正交意图：
 *   [1] 幂等目录链接（ensureDirLink）。
 *   [2] 传递闭包补全镜像（pnpm 布局下 heal 不完整的修复）。
 *   [3] heal 写锁的孤儿恢复（官方协议把孤儿锁清理定为操作员动作；宿主是
 *       $DSH_HOME 的 owner 且 boot 期单例，可安全代行）。
 *   [4] 镜像家族的宿主源重锚（symlink 目标路径不变而内容可变——共享 npx
 *       缓存被 `npx skill-creator@latest` warmup 刷新时家族包会漂到新预发布
 *       版本造成 codec 断裂；重锚到宿主 lockfile 树后版本随宿主 pin）。
 * 妥协声明：四个意图共享「纯文件系统工具、无状态」的形态与镜像目录布局
 * 知识，物理拆分会让布局契约散落；聚合在上限内（4/5）。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/** 幂等目录符号链接：目标变化时替换，不变时保持（对 heal 已生成的镜像无副作用）。 */
export function ensureDirLink(link: string, target: string): void {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (fs.existsSync(link) && fs.realpathSync(link) === target) return;
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, "dir");
}

/**
 * 传递闭包补全（pnpm 布局下 heal 镜像不完整的修复）：对 $home/profiles/
 * node_modules 里每个已镜像包，解析其 package.json 声明的 dependencies/
 * peerDependencies；目标不在镜像中时，用 createRequire 从该包自身位置
 * resolve 真实目录（pnpm 的 .pnpm 嵌套链接可解）并补 symlink。循环到
 * 不动点；解析失败（optional/平台专属 peer）静默跳过——激活期会以 typed
 * pending 呈现，不阻塞宿主。
 */
export function completeTransitiveMirror(home: string): void {
  const mirrorRoot = path.join(home, "profiles", "node_modules");
  if (!fs.existsSync(mirrorRoot)) return;
  const manifestOf = (dir: string): { dependencies?: Record<string, string> } | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      return null;
    }
  };
  const listPackages = (): string[] => {
    const names: string[] = [];
    for (const scope of fs.readdirSync(mirrorRoot)) {
      if (scope.startsWith(".") || scope === ".bin") continue;
      const scopeDir = path.join(mirrorRoot, scope);
      for (const name of fs.readdirSync(scopeDir)) {
        names.push(scope.startsWith("@") ? `${scope}/${name}` : name);
      }
    }
    return names;
  };
  for (let round = 0; round < 8; round += 1) {
    let linked = 0;
    for (const name of listPackages()) {
      const pkgDir = path.join(mirrorRoot, name);
      const manifest = manifestOf(pkgDir);
      const deps = { ...manifest?.dependencies };
      if (!deps) continue;
      for (const dep of Object.keys(deps)) {
        const depLink = path.join(mirrorRoot, dep);
        if (fs.existsSync(depLink)) continue;
        try {
          const resolved = createRequire(path.join(realPkgDir(pkgDir), "package.json")).resolve(
            `${dep}/package.json`,
          );
          ensureDirLink(depLink, path.dirname(resolved));
          linked += 1;
        } catch {
          // optional/平台专属依赖解析失败：交给官方激活期处理。
        }
      }
    }
    if (linked === 0) return;
  }
}

/** 空内容锁的最小超龄（写入 PID 前被杀的孤儿需要等过一个创建窗口才可清）。 */
const ORPHAN_LOCK_MIN_AGE_MS = 60_000;

/**
 * heal 写锁的孤儿恢复（2026-10-04 事故的守护一）：dsh-atomic-write 的跨进程
 * 写锁 = wx 创建 `<file>.lock` + 内容为持有者 PID + 操作完成即删；协议规定
 * 竞争者永不删既有锁（文件年龄不能证明 owner 已停止），孤儿恢复是操作员
 * 动作。宿主在 boot 期持有 IPC 单例，$DSH_HOME 下不应存在其他合法持有者，
 * 故可代行操作员动作：PID 已死（ESRCH）或空内容且超龄的锁清除；PID 存活
 * 或新锁一律保留。返回被清除的锁文件名（供日志）。
 */
export function recoverProfilesOrphanLocks(home: string, now = Date.now()): string[] {
  const profilesDir = path.join(home, "profiles");
  let entries: string[];
  try {
    entries = fs.readdirSync(profilesDir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".lock")) continue;
    const lockPath = path.join(profilesDir, entry);
    try {
      const stat = fs.statSync(lockPath);
      const pid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          continue; // 持有者存活（EPERM/成功都算），不动。
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
        }
        // PID 已死：孤儿锁，清除。
      } else if (now - stat.mtimeMs < ORPHAN_LOCK_MIN_AGE_MS) {
        continue; // 空内容的新锁：可能是并发创建窗口内，等超龄。
      }
      fs.rmSync(lockPath, { force: true });
      removed.push(entry);
    } catch {
      // 单个锁的 stat/read 失败：留给下一轮 boot。
    }
  }
  return removed;
}

export interface MirrorReanchorReport {
  /** 触发重建的漂移包（版本 ≠ 宿主 dsh-base pin）。 */
  trigger: string[];
  /** 热重建后的镜像包清单（自洽时为空 = 未动镜像）。 */
  rebuilt: string[];
}

/**
 * 镜像家族的宿主源守护（2026-10-04 事故的守护二）：镜像 symlink 的目标
 * 路径不变而内容可变——9-22 的镜像链到共享 npx 缓存树，`npx
 * skill-creator@latest` warmup 重装该缓存时把顶层家族包刷到新预发布版本，
 * 镜像随之漂移（typert-loader alpha.2 与同家族 alpha.1 的 codec/zod 实例
 * 断裂 → kernel 持续降级）。
 *
 * 策略 = 漂移检测 + 热重建（不是部分重链）：镜像内任一 @deepseek-ai/dsh-*
 * 包版本 ≠ 宿主 dsh-base 版本即判定漂移，此时清空镜像、以宿主 dsh-base
 * 为种子重跑传递闭包（completeTransitiveMirror）——全家族统一宿主 lockfile
 * 源，zod/codec 实例同源。自洽镜像零动作。**为什么不做部分重链**：混源
 * （.pnpm 实例 + 缓存实例）会让 typert-loader 的 instanceof 校验跨 zod
 * 实例失败（事故日实测 5 contributor 注册失败），同源换血才是完整修复。
 * 传递依赖不在宿主顶层 node_modules，createRequire 解析不到——重建路径
 * 由 completeTransitiveMirror 从 .pnpm 嵌套链接闭包解析，不依赖顶层可见。
 */
export function reanchorMirrorToHost(home: string, installAnchor: string): MirrorReanchorReport {
  const mirrorRoot = path.join(home, "profiles", "node_modules");
  const scopeDir = path.join(mirrorRoot, "@deepseek-ai");
  const report: MirrorReanchorReport = { trigger: [], rebuilt: [] };
  let hostBaseDir: string;
  let hostVersion: string;
  try {
    hostBaseDir = path.dirname(
      createRequire(installAnchor).resolve("@deepseek-ai/dsh-base/package.json"),
    );
    hostVersion = manifestVersion(hostBaseDir) ?? "";
  } catch {
    return report; // 宿主树无 dsh-base（异常安装形态）：不动镜像。
  }
  if (hostVersion === "") return report;
  let names: string[];
  try {
    names = fs.readdirSync(scopeDir);
  } catch {
    return report;
  }
  for (const name of names) {
    if (!name.startsWith("dsh-")) continue;
    const version = manifestVersion(realPkgDir(path.join(scopeDir, name)));
    if (version !== null && version !== hostVersion) report.trigger.push(name);
  }
  if (report.trigger.length === 0) return report; // 自洽：零动作。
  fs.rmSync(mirrorRoot, { recursive: true, force: true });
  completeTransitiveMirrorSeed(home, hostBaseDir);
  try {
    for (const scope of fs.readdirSync(mirrorRoot)) {
      if (scope.startsWith(".") || scope === ".bin") continue;
      const scopeDir2 = path.join(mirrorRoot, scope);
      for (const name of fs.readdirSync(scopeDir2)) {
        report.rebuilt.push(scope.startsWith("@") ? `${scope}/${name}` : name);
      }
    }
  } catch {
    // 重建后的枚举失败不影响 boot（heal/激活期另行兜底）。
  }
  return report;
}

/** 热重建的种子：宿主 dsh-base 落位后由 completeTransitiveMirror 展开闭包。 */
function completeTransitiveMirrorSeed(home: string, hostBaseDir: string): void {
  const mirrorRoot = path.join(home, "profiles", "node_modules");
  ensureDirLink(path.join(mirrorRoot, "@deepseek-ai", "dsh-base"), hostBaseDir);
  completeTransitiveMirror(home);
}

function manifestVersion(pkgDir: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/** 镜像目录可能是 symlink（heal/本模块建的）：解析到真实包目录再作 require 锚。 */
function realPkgDir(pkgDir: string): string {
  try {
    return fs.realpathSync(pkgDir);
  } catch {
    return pkgDir;
  }
}
