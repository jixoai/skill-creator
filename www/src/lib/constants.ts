/**
 * Orthogonal intents (maintained 2026-09-15; original user request: 新增
 * www/ 产品官网，域名时代 2026-09-15 cutover):
 * 1. Single source of the public identity: repo, npm, and the canonical
 *    URL the AI export layer treats as canonical.
 * 2. SITE_URL resolves from the build-time __SITE_URL__ define (fed by the
 *    SITE_URL env in vite.config.ts, same default) so head canonical links
 *    and the llms.txt layer move together — the define is actually wired
 *    since the domain cutover (before that it fell to the hardcoded
 *    fallback silently).
 */
declare const __SITE_URL__: string | undefined;

export const SITE_URL =
  typeof __SITE_URL__ === "string" ? __SITE_URL__ : "https://skill-creator.jixoai.com";
export const SITE_DOMAIN = "skill-creator.jixoai.com";
export const SITE_SUBTITLE = "agent skills workbench";
export const GITHUB_URL = "https://github.com/jixoai/skill-creator";
export const NPM_URL = "https://www.npmjs.com/package/skill-creator";
export const JIXOAI_URL = "https://jixoai.com";
