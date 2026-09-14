# www — Skill Creator site notes

Private static site for Skill Creator, built on the official jixoai
registry (`jixoai-ui`, <https://ui.jixoai.com>). English-only single-page
landing; deploys to GitHub Pages.

## Deployment modes

| Mode                    | Env                                                                                               | Serving                                 | Notes                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| project pages (current) | `SITE_BASE=/skill-creator` `SITE_URL=https://jixoai.github.io/skill-creator`                      | https://jixoai.github.io/skill-creator/ | the actual address until DNS exists                |
| custom domain (cutover) | `SITE_CNAME=1` `SITE_DOMAIN=skill-creator.jixoai.com` `SITE_URL=https://skill-creator.jixoai.com` | https://skill-creator.jixoai.com/       | Owner-managed; writes `dist/CNAME`; no code change |

The cutover is a workflow-env change only (documented in
`.github/workflows/deploy-www.yml` comments).

## Known divergences / friction (2026-09-15 build round)

1. **Root formatter vs registry lock.** The repo-root gate
   `pnpm exec vp fmt --check` (oxfmt) does not exempt this package: nested
   `.prettierignore` files are ignored when the check runs from the repo
   root (verified), and this task's red line forbids creating a root
   `.prettierignore`. Hand-written site files here are oxfmt-clean;
   registry-locked artifacts (`src/lib/**` locked in `jixoai-ui.lock`,
   `vite-plugins/llms-txt.mjs`) stay verbatim per the disk==lock law and
   WILL be flagged by the root fmt gate until the Owner adds a root
   ignore entry (unipty precedent: root `.prettierignore` listing
   `www/src/lib/...` locked paths).
2. **jixoai-theme lock hash is canon, disk is canon+hue.** The lock
   records the registry-canon digest (pre-hue); `jixoai-ui init/add`
   rewrites `--brand-hue` to 150 on disk afterwards. Verify lock↔disk by
   reverting the hue before hashing, not byte-compare.
3. **jixoai-ui 0.5.1 `add` EOF trap re-arms after every successful add**
   (hue re-application makes `jixoai.css` differ from canon again). The
   skill documents moving `jixoai.css` aside once; in practice it must be
   moved aside before EVERY `add` invocation.
4. **Two type-only patches inside locked registry artifacts** (svelte-check
   gate demanded 0 errors; the family precedent never ran svelte-check, so
   these latent defects shipped unnoticed; `jixoai-ui.lock` hashes were
   synced after patching — `jixoai-ui upgrade` will resync to canon and
   resurface the errors until upstream fixes them):
   - `press-button.svelte`: the Props `Omit<…, 'aria-label' | 'aria-disabled'>`
     list removed two keys the destructure at the bottom still reads —
     dropped them from the Omit (HTMLAttributes re-supplies both).
   - `icon-set.gen.ts`: `CHUNK_OF` typed `Record<IconName, number>` but the
     generator omits alias entries (its own consumer guards with
     `Object.hasOwn`) — widened to `Record<string, number>`.
5. **Screenshots are real UI captures, privacy-cropped**: the Workspaces
   capture keeps the top region only (header + quick actions); the Agent
   panel capture keeps the right-hand panel strip only. Both crops remove
   the "recent agent sessions" list (personal session titles) and real
   home-directory paths.
6. **registry `icons` item became `icon` + generated `icon-set.gen.ts`**
   in the 0.5.x registry; both are adopted into `jixoai-ui.lock`. The
   shipped artifact has an EMPTY `LAZY` map (all icons inline in chunk 0),
   so the `@jixoai/ui-vite-plugin` icons machinery is NOT wired here —
   nothing requests a virtual chunk. `vite-imagetools` v12 ships no client
   types; the `?…&as=picture` import contract is declared locally in
   `src/vite-env.d.ts`.
7. **`llms-txt.mjs` JSDoc narrows the plugin config to `{distDir?}`** while
   the runtime consumes the full reference schema — the vite.config call
   site widens via a typed cast instead of editing the locked file.
