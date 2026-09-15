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

## R1 brand pass (2026-09-15, owner feedback: 「图标你没搞对，我给了一整套配套图标」)

11. **The brand set is four variants with a usage law** (resources/README.md):
    Color Symbol = storefront surfaces, Flat Symbol = mid-size UI,
    Monochrome = single-color premium texture, Monochrome Mini = tiny
    containers. The site previously used a hand-drawn `>_` SVG and hue 150
    sampled from the color symbol; the documented brand primary is
    oklch(0.841 0.238 128.85) → `--brand-hue: 129` (note: the on-disk
    flat-symbol.png renders #006048 / hue 168 — intentional per the
    Owner ruling 2026-09-15: the flat variant targets real-world/print
    surfaces, not screens, so its deeper color is by design; the
    screen-side primary stays the README-documented
    oklch(0.841 0.238 128.85)).
12. **Favicon = Monochrome Mini recolored brand green** (#5fa600, the hue-129
    light primary): the monochrome variants exist to be single-colored per
    context, and pure black would vanish on dark tabs. Apple-touch uses
    Flat on white (iOS blacks out transparency). Header logo (28px) = Flat;
    hero carries the Color Symbol as the storefront mark; og-image is
    generated from the Color Symbol + Menlo wordmark.
13. **`__SITE_URL__` define was never wired** — constants.ts declared it but
    vite.config computed `siteUrl` without a define, so canonical/og/llms
    silently used the github.io fallback; wired at the domain cutover.

## R2 typography & layout pass (2026-09-15)

14. **The composition baseline is the registry site's own home page**
    (`ui/apps/www/src/routes/+page.svelte`), which the references do not
    spell out: the section band is exactly `font-nav text-lg uppercase
tracking-[0.3em]` + baseline rule (so 0.3em is family law here, not
    sprawl — do not "fix" it to the 0.24em eyebrow scale), card body copy
    is `text-[13px] leading-6 text-pretty`, and `.data-table` paddings in
    app.css are byte-identical to `docs-tables.css`. R2 therefore aligned
    body copy to 13/24 + `text-pretty`, collapsed in-content labels to
    12px/0.14em (tracking scale: 0.24 eyebrow · 0.14 in-body label),
    moved all four shot captions below their frames at a uniform
    mt-2.5/12px, bottom-aligned the three app-card foot labels through
    the card-grid subgrid (`h-full` flex column + `mt-auto`), and left
    bands/tables at family values.
15. **Table measure caps must ride an inner block, never the cell**
    (browser-measured on this build): on a `width:100%` auto-layout
    table, `td { max-width }` is silently un-capped by surplus-width
    distribution (declared 510px, used 1044–1079px), and a specified
    cell `width` would floor the column minimum (breaking narrow wrap).
    `width: fit-content` on the table stops the stretch but abandons the
    full-width bordered-row grammar. Shipped mechanism:
    `td.wide > .measure { display:block; max-width: 68ch }` — rows stay
    full-width, prose holds the band, narrow cells just wrap (verified:
    no `.table-scroll` engagement at 390px; the only managed scroller is
    the readonly-code `pre`).
16. **agent-browser daemon can wedge mid-session** (even `eval "1+1"`
    hangs; commands never return). Fix that worked: kill the daemon +
    its Chrome (`pkill -f agent-browser`), reopen under a FRESH
    `AGENT_BROWSER_SESSION` name. Careful when other agent-browser
    sessions are live on the machine — a surviving daemon running an
    in-flight `click` belongs to the parallel workflow; leave it.

## R3 motion & interaction pass (2026-09-15)

17. **`--reveal-delay` is dead in the scroll-driven era** — a time-based
    `animation-delay` does not map to `animation-timeline: view()`, so
    the two inherited inline delays (70/90ms) never played; the registry
    reference site uses none. Same-row stagger must be expressed as an
    `animation-range` phase offset (site `data-reveal-lag` = 20% of the
    entry span, tokens in app.css).
18. **The entry sub-range spans the element's OWN height, not
    elementHeight+viewport** (browser-verified via
    `Animation.currentTime` calibration; easy to get wrong analytically —
    the first R3 draft assumed the wider span). Consequences: the theme
    default `entry 75%` is fine on desktop but a card taller than the
    viewport (≈1300px once text reflows at 390px) lingers at partial
    opacity while being read; the site `data-reveal="tall"` modifier
    (entry 35% of own height) makes every band solid before the reading
    zone at any viewport width.
19. **Anchor targets must not carry `data-reveal`**: the browser's
    native fragment scroll aligns the target while its pre-reveal
    transform (translateY 26px) is still active, then the transform
    releases and the section lands 26px above the scroll-padding line
    (measured, deterministic). #security/#get-started now reveal an
    inner wrapper; all four anchors land at delta 0. The registry site
    solves the same problem with a JS re-jump ladder (their ToC line
    precision); the wrapper move needs no JS.
20. **The agent-browser CLI's `media` command exists in help text but
    not in the installed binary** ("Unknown command: media"), and the
    daemon Chrome runs `--remote-debugging-port=0`. For
    prefers-reduced-motion evidence, launch the machine-cached Chrome
    for Testing binary yourself with a debugging port and drive CDP from
    Node's built-in WebSocket (Emulation.setEmulatedMedia +
    Runtime.evaluate) — audit script pattern preserved in this session's
    report; all entrance/press/table-row motion verified killed under
    reduce.
21. **`vite preview` dies when dist is rebuilt underneath it** (ENOENT
    on a hashed immutable asset on the next request). Restart the
    preview on a fresh port after every rebuild instead of trusting a
    surviving server — a stale preview serves cached HTML that quietly
    mismatches the sources.
22. **Theme switch stays instant by family law**: no global color
    transition was added for light/dark/system swaps (press-law
    components already transition their own surfaces 150ms; the canvas
    flips). A crossfade would be a third motion pattern outside the
    two-pattern law. Verified: toggle cycles, persists to
    localStorage, applies `.dark` + colorScheme, no-flash bootstrap
    intact.

## R4 content & closeout pass (2026-09-15)

23. **All four captures are light-theme; one caption said dark**. The
    Workspaces caption claimed "(dark theme)" and the Creator/Agent
    panel captions described UI not in the crop (change log, transcript,
    session selector). Captions/alts now describe the actual pixels,
    cross-checked against webui sources (`WorkspacesHome.svelte` quick
    actions, `templates.ts` categories, `DSH_AGENT_MODES` labels) —
    programmatic pixel audit (94-99% near-white) before trusting any
    visual read.
24. **Light-theme brand green is AA-below on white — family token,
    Owner decision**. Programmatic audit (oklch→sRGB→WCAG): light
    `--primary` = #5fa600 exactly; on white 3.03:1 (AA needs 4.5 for
    the 11-13px eyebrow/label/link text; the fill CTA's white ink is
    the same 3.03). The failing surfaces (hero/section eyebrows, fill
    button) are rendered by registry-locked components; darkening
    per-site would fork the family token (R1 hue law). Dark theme
    passes everywhere (5.03-8.37). Remediation math for a family-level
    fix: oklch L≈0.55 at hue 129 / C 0.237 clears 4.5:1 on white.
    Filed here for the Owner; NOT changed.
25. **Dark table inline code fixed in-app.css** (site-owned surface):
    dark `--accent` on card was 4.30:1; `.dark .data-table code` now
    mixes the same token 85/15 with white → 5.19:1. No second hue, no
    token edits.
26. **`<script>` content in a Svelte template is raw text** —
    `{SITE_URL}` does not interpolate inside `type="application/ld+json"`
    (build-verified). The JSON-LD block carries the canonical domain
    literally; the deploy workflow is cut over to that same domain
    (deploy-www.yml env), so the single hardcode is the production
    truth.
27. **agent-browser is dead on this machine** (`bad interpreter:
/opt/homebrew/opt/node/bin/node`) — R4 evidence fell back to direct
    CDP (Chrome for Testing + Node WebSocket, the R3 #20 pattern).
    Also: `vite preview` binds `[::1]` only (use `localhost`, not
    127.0.0.1) and ignores `-- --port` forwarding (landed on 4173).
28. **Light-theme full-page screenshots defeat blank-band heuristics**
    (white canvas + white cards + light UI captures read as "empty"):
    verify via `naturalWidth` audits, full-width border-line detection,
    and the dark-theme twin instead of brightness stats. The readonly-code
    `pre` is CDP-Tab-focusable — Chrome gives scrollable containers
    implicit keyboard focus (no tabindex anywhere); native, kept.
    Drawer keyboard path verified: aria-expanded toggles, Escape closes
    and returns focus to the hamburger.
