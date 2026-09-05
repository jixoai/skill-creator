/**
 * 用户原始需求 [2026-07-27]：「Repository 用来浏览远程 skills 仓库」。
 * 正交意图：
 *   [1] 固化「已知技能仓库源」目录的浏览器安全静态快照，随发布版本固化（不持久化）。
 *   [2] 为 Repository Discover home Tab 与 daemon `sources.list` 提供无副作用事实源。
 * 妥协声明：catalog 手工快照，形态对齐 `provider-catalog.ts`；不在运行时拉取，源失效时按既有
 * `repository.scan` 错误路径降级，不阻塞其它源。
 */

/** 一条精选技能仓库源的稳定目录约定。 */
export interface CuratedSourceEntry {
  /** 稳定 slug，作为 instanceKey 的源；与 user_ 前缀命名空间隔离。 */
  id: string;
  /** 卡片标题。 */
  label: string;
  /** https git URL，喂给 repository.scan。 */
  gitUrl: string;
  /** 一句话卡片描述。 */
  description: string;
  /** 可选的项目主页链接。 */
  homepage?: string;
}

/**
 * 随应用发布的精选技能仓库源目录快照。
 * 浏览器安全：纯静态数据，daemon 与 WebUI 共享，不读盘、不发请求。
 */
export const CURATED_SOURCES: readonly CuratedSourceEntry[] = [
  {
    id: "anthropics-skills",
    label: "Anthropic Skills",
    gitUrl: "https://github.com/anthropics/skills.git",
    description: "Anthropic 官方维护的 Agent skills 集合。",
    homepage: "https://github.com/anthropics/skills",
  },
  {
    id: "vercel-labs-skills",
    label: "Vercel Labs Skills",
    gitUrl: "https://github.com/vercel-labs/skills.git",
    description: "Vercel Labs 维护的社区 Agent skills 集合。",
    homepage: "https://github.com/vercel-labs/skills",
  },
];

/** 返回指定 id 的精选源，未命中返回 `undefined`。 */
export function curatedSourceEntry(id: string): CuratedSourceEntry | undefined {
  return CURATED_SOURCES.find((source) => source.id === id);
}
