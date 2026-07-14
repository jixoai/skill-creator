/**
 * 原始需求 [2026-07-14]：「目的是以人为本，要让小白到各行各业到专业工程师用起来都舒心」。
 * 正交意图：
 * 1. 将原始技能元数据转换为紧凑可读文本。
 * 2. 为 provider 提供稳定的视觉语义。
 */
import type { SkillMetadata } from "./types";

/** 将字节数格式化为紧凑的人类可读尺寸。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 返回 provider badge 的稳定颜色 class。 */
export function providerTone(provider: string): string {
  const map: Record<string, string> = {
    agents: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    claude: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    codex: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    gemini: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
    plugin: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    file: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  };
  return map[provider] ?? "bg-slate-500/15 text-slate-600 dark:text-slate-400";
}

/** 返回技能位置的短标签。 */
export function locationLabel(location: SkillMetadata["location"]): string {
  switch (location) {
    case "user":
      return "User";
    case "project":
      return "Project";
    case "plugin":
      return "Plugin";
  }
}

/** 将技能路径缩短为适合界面扫描的形式。 */
export function shortenPath(p: string): string {
  const home = typeof window !== "undefined" ? "/Users" : "";
  if (home && p.startsWith(home)) {
    const idx = p.indexOf("/", home.length + 1);
    if (idx > 0) return "~" + p.slice(idx);
  }
  return p;
}
