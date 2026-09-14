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

## Integration review fixes (2026-09-15, orchestrator pass)

8. **Node floor corrected to 24**: the badge and env table said ≥ 22.13
   (copied from the v2.0.0 Release body); the enforced truth is the
   package `engines` field (`>=24.0.0`, zstd). README's two stale mentions
   (>=20, >=22.13.0) were fixed in the same pass.
9. **Never rewrite asset URLs in the render layer** (CI-proven 2026-09-15):
   vite already prefixes srcset/asset URLs with the configured base in
   subpath builds (`SITE_BASE=/skill-creator` → `/skill-creator/_app/...`,
   single prefix, verified in dist HTML) and emits root/relative shapes in
   root builds. An orchestrator-pass "fix" that re-based PictureSet URLs
   through `$app/paths` doubled the prefix and 404'd the Pages deploy
   (`/skill-creator/skill-creator/_app/...`); it was reverted. The trap
   that misled the diagnosis: `vite preview` aliases `/_app` at the origin
   root AND a build without SITE_BASE emits relative URLs — only a real
   `SITE_BASE` build's dist output is evidence for deployment behavior.
10. **All four screenshots load eager** (not lazy): native
    `loading="lazy"` never fired in the CDP-driven verification browser
    (headless quirk); the screenshots ARE the page content on a landing
    page, so eager removes both the quirk and the verification gap.
    Root `.prettierignore` exempts the registry-locked files (unipty
    precedent) so the root `pnpm check` stays green.
