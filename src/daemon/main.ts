/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 用户原始需求 [2026-09-30]：「在启动 skill creator 的时候会在 ~/.agents/skills/
 * skill-creator-v2 这个目录提供一个 `Skill Creator V2` 的技能。」
 * 正交意图：
 * 1. 将进程环境与公开 CLI 冷启动入口转换为 daemon 启动参数。
 * 2. 统一处理单实例退出与顶层启动异常。
 * 3. 允许隔离测试显式关闭 native tray，避免污染操作员 OpenTray 状态。
 * 4. 生产入口独有的产品自描述技能自举（dev 入口不挂载，故 dev daemon 天然不写
 *    用户全局根；测试另有 env 隔离阀）。
 * 妥协声明：四意图仍聚合——三者都是「进程入口横切」，拆出第 4 项会引入仅生产
 * 入口与 bootDaemon 之间的隐式顺序耦合；ensureSelfSkill 自含失败边界，聚合成本
 * 低于拆分。
 */
import { resolveDaemonAppLaunch } from "./app-launch.js";
import { bootDaemon } from "./index.js";
import { isDevRuntime, log } from "./log.js";
import { readPackageVersion } from "./package-version.js";
import { ensureSelfSkill } from "./self-skill.js";
import { webModeFromEnv } from "../shared/web-mode.js";

async function main(): Promise<void> {
  // ensureSelfSkill 永不抛出，失败只记日志，绝不阻塞启动（design D2）。
  const selfSkill = ensureSelfSkill();
  if (selfSkill.kind === "installed" || selfSkill.kind === "updated") {
    log(`self-skill bootstrap ${selfSkill.kind}`);
  } else if (selfSkill.kind === "failed") {
    log(`self-skill bootstrap failed: ${selfSkill.reason}`);
  }
  const cliVersion = readPackageVersion();
  const webviewUrl = process.env.SKILL_CREATOR_DEV_WEBVIEW_URL;
  const withTray = process.env.SKILL_CREATOR_DISABLE_TRAY !== "1";
  const web = withTray ? webModeFromEnv() : false;
  const appLaunch = web ? undefined : resolveDaemonAppLaunch(import.meta.url);
  const handles = await bootDaemon({ cliVersion, webviewUrl, withTray, web, appLaunch });
  if (!handles) {
    // Another instance is running.
    process.exit(0);
  }
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  log(`daemon startup failed: ${message}`);
  if (!isDevRuntime()) console.error(message);
  process.exit(1);
});
