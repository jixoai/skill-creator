/**
 * DSH profile 装载的共享支撑（dsh-kernel-rebase task 2.1 从 dsh-official-profile
 * 提取；web profile 与 headless kernel 共用同一镜像机制）。
 *
 * 用户原始需求 [2026-09-06]（heal 教训）+ [2026-09-07]（completeTransitiveMirror
 * 修复）：profile rows 的裸包名必须经 $DSH_HOME/profiles/node_modules 可解析。
 *
 * 正交意图：
 *   [1] 幂等目录链接（ensureDirLink）。
 *   [2] 传递闭包补全镜像（pnpm 布局下 heal 不完整的修复）。
 * 妥协声明：无——纯文件系统工具，不持状态。
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
      if (scope.startsWith("@")) {
        for (const name of fs.readdirSync(scopeDir)) names.push(`${scope}/${name}`);
      } else {
        names.push(scope);
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

/** 镜像目录可能是 symlink（heal/本模块建的）：解析到真实包目录再作 require 锚。 */
function realPkgDir(pkgDir: string): string {
  try {
    return fs.realpathSync(pkgDir);
  } catch {
    return pkgDir;
  }
}
