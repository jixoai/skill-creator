/**
 * Orthogonal intents (maintained 2026-09-15; original user request: 新增
 * www/ 产品官网，GitHub Pages 部署、不加 CNAME):
 * 1. Single source of the public identity: repo, npm, and the project pages
 *    URL the AI export layer treats as canonical.
 * 2. SITE_URL resolves from the build-time __SITE_URL__ define (fed by the
 *    SITE_URL env in vite.config.ts, same default) so head canonical links
 *    and the llms.txt layer move together at the custom-domain cutover.
 */
declare const __SITE_URL__: string | undefined;

export const SITE_URL =
  typeof __SITE_URL__ === "string" ? __SITE_URL__ : "https://jixoai.github.io/skill-creator";
export const SITE_DOMAIN = "jixoai.github.io/skill-creator";
export const SITE_SUBTITLE = "agent skills workbench";
export const GITHUB_URL = "https://github.com/jixoai/skill-creator";
export const NPM_URL = "https://www.npmjs.com/package/skill-creator";
export const JIXOAI_URL = "https://jixoai.com";
