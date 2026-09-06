/**
 * Manager island 构建（openspec dsh-webui-composition task 3.1a）。
 *
 * 产出单文件 `build-island/dsh-island.js`（IIFE），由 daemon 同源服务在
 * /manager/dsh-island.js，DSH client plugin 动态加载后在 DSH 页面挂载
 * Svelte island（原有 Manager 视图，未批量改写）。
 *
 * 正交意图：
 *   [1] Svelte（非 SvelteKit）lib 构建：entry = dsh-island/entry.ts，全部内联。
 *   [2] SvelteKit 依赖面压到 shims：$app/navigation、$app/state → island 实现
 *       （navigation adapter 语义，见 integration-contract）。
 *   [3] Tailwind/主题：与主应用共用 routes/layout.css（?inline 进 bundle）。
 */
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const webuiRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $shared: fileURLToPath(new URL("../src/shared/", import.meta.url)),
      $lib: fileURLToPath(new URL("./src/lib/", import.meta.url)),
      // navigation adapter 面：SvelteKit 导航语义落到 island 内部实现。
      "$app/navigation": fileURLToPath(
        new URL("./src/lib/dsh-island/shims/app-navigation.ts", import.meta.url),
      ),
      "$app/state": fileURLToPath(
        new URL("./src/lib/dsh-island/shims/app-state.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "build-island",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        // 组件 scoped CSS 走稳定资产名（entry 在 mount 时注入 <link>）。
        assetFileNames: "dsh-island[extname]",
      },
    },
    lib: {
      entry: fileURLToPath(new URL("./src/lib/dsh-island/entry.ts", import.meta.url)),
      formats: ["iife"],
      name: "SkillCreatorManagerIsland",
      fileName: () => "dsh-island.js",
    },
    // IIFE 单文件：sourcemap 便于诊断，minify 保持默认。
    sourcemap: true,
  },
});
