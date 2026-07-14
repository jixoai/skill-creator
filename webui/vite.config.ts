/**
 * 原始需求 [2026-07-14]：「webui 的框架我已经搭建好了」。
 * 正交意图：
 * 1. 装配 SvelteKit、Tailwind CSS 与静态产物输出。
 * 2. 暴露 browser-safe shared contracts，并挂载开发 daemon 插件。
 */
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { skillCreatorDaemonDev } from "./config/daemon-dev";

export default defineConfig({
  server: {
    watch: {
      // Build output is produced by `pnpm build` and must not trigger HMR.
      ignored: ["**/build/**", "**/.svelte-kit/**", "**/dist/**"],
    },
  },
  plugins: [
    tailwindcss(),
    sveltekit({
      // 让 webui 能 import repo root 的 browser-safe shared 契约。
      alias: {
        $shared: fileURLToPath(new URL("../src/shared/", import.meta.url)),
      },
      adapter: adapter({
        pages: "build",
        assets: "build",
        fallback: "index.html",
        precompress: false,
        strict: false,
      }),
    }),
    skillCreatorDaemonDev(),
  ],
});
