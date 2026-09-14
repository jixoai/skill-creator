/*
Orthogonal intents (maintained 2026-09-15; original user request: 新增 www/
产品官网，jixoai 家族风格、GitHub Pages 部署):
1. One vite pipeline for dev/build (sveltekit + tailwindcss v4 css-first).
   [image-pipeline] imagetools rides FIRST so `?w=…&format=webp;png&as=picture`
   imports resolve before any consumer plugin (Owner image-optimization law).
2. ONE llms.txt generation point: the registry llms-txt vite plugin, wired
   here and nowhere else (orchestrated double generation is forbidden by the
   llms-txt law); siteUrl is the project pages URL until the Owner cuts DNS.
3. Dev server pinned to port 13260 (unique per concurrent agent law).
*/
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { imagetools } from "vite-imagetools";
import { llmsTxt as llmsTxtPlugin } from "./vite-plugins/llms-txt.mjs";

// The registry artifact's JSDoc narrows the plugin config type to
// `{distDir?}` while its runtime consumes the full reference schema
// (siteUrl/title/summary/…) — widen the call site instead of editing the
// locked file (disk==lock law). An assertion bypasses excess-property
// checking without weakening anything at runtime.
const llmsTxt = llmsTxtPlugin as unknown as (config: Record<string, unknown>) => Plugin;

// The AI export layer's canonical URL: the project pages path until the
// Owner cuts DNS over to the custom domain (SITE_URL + SITE_CNAME move
// together in the cutover — no code change beyond the env).
const siteUrl = process.env.SITE_URL ?? "https://jixoai.github.io/skill-creator";

export default defineConfig({
  plugins: [
    // image pipeline (Owner law 2026-09-07): ?w=…&format=webp;png&as=picture
    // imports for raster assets; must run before the sveltekit plugin.
    imagetools(),
    sveltekit(),
    tailwindcss(),
    llmsTxt({
      distDir: "dist",
      siteUrl,
      title: "Skill Creator",
      summary:
        "Local-first workbench for Agent skills: a thin CLI over a single daemon shell with three apps (Workspaces, Creator, Repository), a DSH-kernel agent panel, and an MCP capability surface where every mutation is a human-approved proposal.",
    }),
  ],
  server: { port: 13260 },
});
