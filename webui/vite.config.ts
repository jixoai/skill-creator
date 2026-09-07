/**
 * 原始需求 [2026-07-14]：「webui 的框架我已经搭建好了」。
 * 用户原始需求 [2026-07-20]：「补充 vite.config 相关的插件，实现预构建基于 color-symbol 的 appIcon。」
 * 正交意图：
 * 1. 装配 SvelteKit、Tailwind CSS 与静态产物输出。
 * 2. 暴露 browser-safe shared contracts，并挂载开发 daemon 插件。
 * 3. 在 dev/build 共享的 Vite 预备阶段生成应用图标。
 */
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { openTrayAppIconPlugin } from "@opentray/vite-plugin";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { skillCreatorDaemonDev } from "./config/daemon-dev";

export default defineConfig({
  resolve: {
    alias: {
      // vitest project 模式不继承 sveltekit 注入的 $lib 别名（dev/build 不受影响，
      // 显式声明只为单测的模块解析稳定）。
      $lib: fileURLToPath(new URL("./src/lib/", import.meta.url)),
    },
  },
  server: {
    watch: {
      // Build output is produced by `pnpm build` and must not trigger HMR.
      ignored: ["**/build/**", "**/.svelte-kit/**", "**/dist/**"],
    },
  },
  plugins: [
    openTrayAppIconPlugin({
      sourcePath: fileURLToPath(new URL("../resources/color-symbol.png", import.meta.url)),
    }),
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
