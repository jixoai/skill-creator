/**
 * 原始需求 [2026-07-14]：「引入对各行各业对 skills 的支持」。
 * 正交意图：
 * 1. 根据技能文本启发式推导行业分类。
 * 2. 按行业分类聚合技能列表。
 */
import type { SkillMetadata } from "./types";

/** WebUI 支持的行业分类。 */
export type IndustryCategory =
  | "frontend"
  | "backend"
  | "devops"
  | "data"
  | "mobile"
  | "writing"
  | "design"
  | "security"
  | "testing"
  | "ai-ml"
  | "general";

/** 行业分类的显示名称与视觉语义。 */
export const CATEGORY_META: Record<IndustryCategory, { label: string; color: string }> = {
  frontend: { label: "Frontend", color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  backend: { label: "Backend", color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  devops: { label: "DevOps", color: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  data: { label: "Data", color: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  mobile: { label: "Mobile", color: "bg-pink-500/15 text-pink-600 dark:text-pink-400" },
  writing: { label: "Writing", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  design: { label: "Design", color: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  security: { label: "Security", color: "bg-red-500/15 text-red-600 dark:text-red-400" },
  testing: { label: "Testing", color: "bg-teal-500/15 text-teal-600 dark:text-teal-400" },
  "ai-ml": { label: "AI / ML", color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  general: { label: "General", color: "bg-slate-500/15 text-slate-600 dark:text-slate-400" },
};

/** 关键词 → 分类映射（按优先级降序）。 */
const CATEGORY_RULES: Array<{ category: IndustryCategory; keywords: RegExp }> = [
  {
    category: "security",
    keywords: /security|vulnerab|auth|crypto|encrypt|pen.test|injection|xss|csrf|secrets?/i,
  },
  { category: "testing", keywords: /test|vitest|jest|pytest|e2e|coverage|mock|fixture|tdd|bdd/i },
  {
    category: "devops",
    keywords:
      /ci\/?cd|pipeline|docker|kubernetes|deploy|terraform|ansible|helm|monitoring|grafana|incident/i,
  },
  {
    category: "data",
    keywords:
      /sql|database|query|analytics|etl|pipeline|dataframe|pandas|tableau|meilisearch|index/i,
  },
  {
    category: "mobile",
    keywords: /flutter|react.native|ios|android|swift|kotlin|mobile|app.store|lynx/i,
  },
  {
    category: "frontend",
    keywords: /react|vue|svelte|css|tailwind|html|frontend|ui|component|dom|browser/i,
  },
  {
    category: "backend",
    keywords: /api|server|endpoint|graphql|rest|grpc|database|orm|node|deno|bun|backend/i,
  },
  {
    category: "ai-ml",
    keywords: /ai|ml|machine.learn|llm|gpt|embed|vector|rag|prompt|agent|model|neural|tensor/i,
  },
  {
    category: "writing",
    keywords: /doc|writing|blog|article|content|markdown|readme|summar|translat|proofread/i,
  },
  {
    category: "design",
    keywords: /design|figma|sketch|color|typography|layout|accessib|wcag|design.system/i,
  },
];

/** 根据名称与描述推导一个 skill 的行业分类。 */
export function categorizeSkill(skill: SkillMetadata): IndustryCategory {
  const text = `${skill.name} ${skill.description}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(text)) return rule.category;
  }
  return "general";
}

/** 将 skills 按完整行业分类集合分组。 */
export function groupByCategory(
  skills: SkillMetadata[],
): Record<IndustryCategory, SkillMetadata[]> {
  const groups = {} as Record<IndustryCategory, SkillMetadata[]>;
  for (const skill of skills) {
    const cat = categorizeSkill(skill);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(skill);
  }
  return groups;
}
