/**
 * Unified Vite+ quality configuration.
 *
 * User intent [2026-07-14]: use Vite+ and Vitest as the TypeScript project's
 * default verification toolchain.
 *
 * Orthogonal intents:
 *   [1] Resolve source-style `.js` imports to TypeScript during tests.
 *   [2] Keep daemon and build-tool unit tests isolated in a Node environment.
 *   [3] Format TypeScript and Svelte through one toolchain.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite-plus";

function resolveTypeScriptSources(): Plugin {
  return {
    name: "skill-creator/resolve-typescript-sources",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const candidate = path.resolve(path.dirname(importer), source.replace(/\.js$/, ".ts"));
      return fs.existsSync(candidate) ? candidate : null;
    },
  };
}

const projectRoot = path.resolve(__dirname);

export default defineConfig({
  fmt: { svelte: true },
  resolve: {
    // WebUI store 单测经 svelte 模块（$shared / $lib 别名）导入共享契约。
    alias: {
      $shared: path.join(projectRoot, "src/shared"),
      $lib: path.join(projectRoot, "webui/src/lib"),
    },
  },
  test: {
    // Vitest projects：webui/src 下的 store 单测含 `.svelte.ts` runes 模块，必须经
    // webui 的 sveltekit 管线编译（root 管线无 svelte 插件，$state 会变成裸引用）；
    // daemon/build-tool 测试仍在 root Node 管线。两条 include 互斥。
    projects: [
      {
        test: {
          name: "node",
          plugins: [resolveTypeScriptSources()],
          environment: "node",
          include: [
            "test/**/*.test.ts",
            "webui/config/**/*.test.ts",
            "packages/skill-wiki/test/**/*.test.ts",
            "packages/search/test/**/*.test.ts",
          ],
          exclude: ["webui/src/**"],
          globals: false,
          fileParallelism: false,
          testTimeout: 20_000,
          // 0.1.5-rc.2 内核更重：before 钩子里的真实 boot/沙箱搭建在负载下
          // 可能超默认 10s，放宽到与 testTimeout 同级。
          hookTimeout: 20_000,
        },
      },
      {
        plugins: [
          // webui 单测需要 svelte 编译（.svelte 组件与 .svelte.ts runes）；插件从
          // webui 安装解析（root 无 svelte 依赖，不新增 hoisting 假设）。
          createRequire(path.join(projectRoot, "webui", "package.json"))(
            "@sveltejs/vite-plugin-svelte",
          ).svelte(),
        ],
        resolve: {
          alias: [
            { find: "$shared", replacement: path.join(projectRoot, "src/shared") },
            { find: "$lib", replacement: path.join(projectRoot, "webui/src/lib") },
            // $app/navigation 是 SvelteKit 虚拟模块（root vitest 管线解析不了）；
            // alias 到物理 stub 使解析成立，具体行为由测试内 vi.mock 提供。
            {
              find: "$app/navigation",
              replacement: path.join(
                projectRoot,
                "webui/src/lib/__tests__/stubs/app-navigation-stub.ts",
              ),
            },
            // $app/state 同理（组件级测试 mount 的视图 import page）。
            {
              find: "$app/state",
              replacement: path.join(
                projectRoot,
                "webui/src/lib/__tests__/stubs/app-state-stub.ts",
              ),
            },
            // @lucide/svelte 图标是 node_modules 的 .svelte——root vitest 管线
            // 不编译它们；统一替换为空壳 stub（组件面测试不判读图标形状）。
            {
              find: /^@lucide\/svelte\/icons\/.*$/,
              replacement: path.join(
                projectRoot,
                "webui/src/lib/__tests__/stubs/lucide-icon-mocks.js",
              ),
            },
          ],
        },
        test: {
          name: "webui",
          environment: "node",
          include: ["webui/src/**/*.test.ts"],
          globals: false,
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
