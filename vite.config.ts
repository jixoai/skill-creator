/**
 * Unified Vite+ quality configuration.
 *
 * User intent [2026-07-14]: use Vite+ and Vitest as the TypeScript project's
 * default verification toolchain.
 *
 * Orthogonal intents:
 *   [1] Resolve source-style `.js` imports to TypeScript during tests.
 *   [2] Keep daemon unit tests isolated in a Node environment.
 *   [3] Format TypeScript and Svelte through one toolchain.
 */
import fs from "node:fs";
import path from "node:path";
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

export default defineConfig({
  fmt: { svelte: true },
  test: {
    plugins: [resolveTypeScriptSources()],
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
