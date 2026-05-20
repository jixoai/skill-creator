import { defineConfig } from 'tsdown'

export default defineConfig({
  // Entry points: library export and CLI executable
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },

  // Output format: ESM only (modern Node.js)
  format: ['esm'],

  // Declaration files generation
  dts: {
    resolve: true, // Resolve and bundle declaration files
  },

  // Source maps for debugging
  sourcemap: true,

  // Minification for production (reduces bundle size by ~30%)
  minify: true,

  // External dependencies - keep these as runtime dependencies
  external: [
    // Heavyweight libraries that must remain external
    '@chroma-core/default-embed',
    // Node.js built-in modules
    /^node:.*/,
  ],

  // Bundle all other dependencies (commander, inquirer, ora, etc.)
  // This is the default behavior - anything not in "external" gets bundled

  // Rolldown-specific optimizations
  rolldown: {
    // Aggressive tree-shaking for minimal bundle size
    treeshake: {
      preset: 'recommended',
      moduleSideEffects: false,
    },
    // Ensure CLI executable has proper shebang and use .js extension
    output: {
      entryFileNames: '[name].js',
      chunkFileNames: '[name]-[hash].js',
      banner: (chunk) => {
        if (chunk.name === 'cli') {
          return '#!/usr/bin/env node\n'
        }
        return ''
      },
    },
  },
})
