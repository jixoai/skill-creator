/*
Orthogonal intents (maintained 2026-09-15; original user request: 新增 www/
产品官网，GitHub Pages 部署、不加 CNAME——自定义域名由 Owner 后续在 Pages
设置里配置):
1. Serve from the configurable base path: SITE_BASE (/skill-creator for the
   project pages path) feeds kit.paths.base; every internal link resolves
   through $app/paths so nothing hardcodes a prefix.
2. SITE_CNAME=1 switches the build to root serving (custom-domain cutover)
   without code change; scripts/build.mjs writes dist/CNAME in that mode.
3. Stay fully static: adapter-static strict, prerendered from '/'.
*/
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// One place decides the serving mode: the CNAME flag forces root serving;
// otherwise SITE_BASE wins (empty = root, '/skill-creator' = project pages
// path). kit.paths.base must start with '/' and not end with '/' (except
// root).
const cnameMode = process.env.SITE_CNAME === "1";
const rawBase = cnameMode ? "" : (process.env.SITE_BASE ?? "");
const trimmed = rawBase.replace(/^\/+|\/+$/g, "");
const base = trimmed === "" ? "" : `/${trimmed}`;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess({ script: true }),
  kit: {
    adapter: adapter({ pages: "dist", assets: "dist", strict: true }),
    paths: { base },
  },
};

export default config;
