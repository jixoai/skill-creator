# Changelog

## 2.2.0 (2026-09-20)

A local BM25 skill-search index under the whole product, a first screen that
loads in ~1s instead of ~7s, and native OS pickers for choosing directories.

### Added

- **Local skill search everywhere** — a daemon-owned search index (canonical
  `realpath` dedup, CJK-aware frozen tokenizer, MiniSearch BM25 with frozen
  rerank weights, persisted under a versioned envelope with per-file stat
  freshness and event-driven watching) now backs four faces: `skill-creator
  search` on the CLI, `skills.search` / `skills.duplicates` over RPC, the
  `skills_search` / `skills_duplicates` MCP tools, and three GUI entry points
  — the ProviderView filter box (URL-`q` truth), the ⌘K command palette, and
  the composer `$` menu. Exclusion dirs are tunable via a `search-config.toml`
  written next to the index, with an in-UI shortcut to open it in your editor.
- **Same-content badges on skill rows** — skills whose indexed bytes are
  identical across installations show a Finder-style link badge (`↗N`,
  "Same content as N other installations") in list and search rows, replacing
  the old full-screen duplicate-groups block on the Workspaces home (owner
  ruling: a badge is the honest signal, a wall of groups is noise).
- **Native directory picker for workspace import** — the Import dialog's new
  Browse… button routes through `@opentray/ext-dialog` (upgraded the opentray
  family to 0.32.0, whose osascript bridge made real-host dialogs clickable —
  two upstream bugs found and fixed along the way, jixoai/opentray#8 and #10).
  Unsupported platforms or headless daemons hide the button; a picked
  directory backfills the path and seeds the display name.
- **Attachment pickers show loading** — the composer's image and document
  buttons now spin their own icon while the native file-picker is up (each
  target separately), matching the import Browse feedback.

### Fixed

- **Search returned nothing on real libraries** — the ranking pool folded
  duplicate content *after* the top-40 cut, so 30+ byte-identical copies of
  one skill drowned every other result, and the surviving representative only
  carried its own installation scope, which made provider-filtered views match
  nothing. Folding now happens before the pool (one representative per content
  hash) and the primary merges the group's full installation list.
- **First screen took 5–7 seconds** — `workspace.list` ran two full discovery
  sweeps over ~50 agent roots per call and the WebUI fired it 3–4× per load;
  the registry now scans each `(provider, root)` exactly once (counts and
  dedup keys from the same pass, Claude-plugin side effects skipped for
  non-claude roots), the WebUI shares one in-flight request per connection
  generation, the `npx skills` provenance probe warms in the background
  instead of blocking the first `skills.list`, and same-target reads share
  one in-flight discovery with explicit invalidation after every disk write.
  Measured cold first paint: ~5–7s → ~1.07s; opening a skill: 27–156ms → 40ms.
- Search-row clicks opened "Skill not found" — the global canonical id was
  passed to the provider-scoped detail RPC; the row now resolves the local
  skill by name.

### Changed

- **Visual polish pass over Workspaces** — a two-round reviewed rework: 22rem
  list column with a width-capped centered detail pane, a 12px text floor,
  unified hover/nesting card language, icon-only header actions, neutralized
  row icons, an icon-rail active state, and layered not-found messaging that
  keeps the opaque id out of the headline.

## 2.1.0 (2026-09-16)

The `$` skill-reference composer surface, the dual-era MCP fix that revives the
in-session tool face, and a calmer Settings → Model pane.

### Added

- **`$` skill references in the composer** — typing `$` opens a fuzzy-searchable
  menu of every enabled skill across all workspaces, grouped under
  `Workspace / provider` headers (916 skills · 44 groups on the dev machine).
  Matching is case-insensitive subsequence with contiguous-run and word-start
  weighting (description hits rank slightly higher without rescuing misses).
  Picking an entry drops a `$name ` chip that rides the same ordered-occurrence
  machinery as `@` references: same-name skills from different providers pair
  in pick order, backspace deletes the whole chip, and edited-out tokens are
  pruned at submit. The daemon expands each reference server-side into a
  bounded `[reference: skill <name> · <provider>]` block (registry-scoped
  document read, ≤200k chars; missing targets fail the prompt typed). The `$`
  reference semantics stay orthogonal to `/name` command triggering.

### Fixed

- **In-session MCP tools were silently dead** — the kernel's MCP client rides
  the 2026-07-28 protocol line; the daemon endpoint (SDK 1.30) rejected its
  `MCP-Protocol-Version` header with 400, so `mcp__skill-creator__*` tools never
  reached agent sessions. The MCP server stack migrates to
  `@modelcontextprotocol/server@2`: one per-request factory now serves both
  eras — modern `server/discover` negotiation and legacy 2025 `initialize`
  (external clients unaffected). Verified by a regression test that drives a
  real v2 client through the HTTP endpoint and calls a tool over the negotiated
  era, plus a live dev stack with zero protocol errors in the daemon log.
- **Settings → Model scroll chaos** — the right pane now hands scroll ownership
  to the Model section (the tab-content area is the single vertical scroller),
  the provider gallery flows inline instead of its own `52vh` scroller, and the
  phantom horizontal scrollbar (a negative-margin escape widening the child
  32px past the pane) is gone. The tab strip only captures vertical wheel
  events while it can actually scroll. Verified by a per-container walkthrough
  (desktop/narrow × light/dark) with DOM-measured scroll facts.
- **Opening the agent panel too early killed app reactivity** — opening the
  panel before the WebSocket connected tripped Svelte's
  `effect_update_depth_exceeded` (the settings loader threw synchronously and
  wrote its own effect inputs back in the same frame), leaving the whole app
  unresponsive until reload. The lazy load now gates on connection status.
- Trigger-menu selected rows get a visible primary tint (the old accent was
  ~3% lightness from the popover), and queue-dock row actions move from bare
  12px icons to 24px pads with expanded hit zones plus an explicit steer
  disabled state.

### Changed

- **The kernel DSH home is app-scoped by default** — the daemon now bootstraps
  `<home>/.skill-creator/dsh-home` instead of reading your real `~/.dsh`, so an
  incompatible harness checkout can no longer break the product kernel mount
  (model routes and credentials project into the same isolated home). Set
  `DSH_HOME` to opt back into a shared harness home.

## 2.0.2 (2026-09-15)

Hotfix for picked-image thumbnails.

### Fixed

- **Picked images showed a generic icon instead of a thumbnail** — the R18
  native-picker rewrite carried only `{path, name}` into the composer draft,
  leaving the `preview` field a dead channel: the daemon's jSquash thumbnail
  pipeline (`agent.files.preview`) was unreachable from the composer and
  attachment chips always fell back to the icon tile. Picked images now
  hydrate their thumbnails asynchronously (chips upgrade in place when the
  daemon thumbnail arrives; user-removed entries are never resurrected).
  Verified live against a real photo: 1152×812 jpeg → 256×180 thumbnail.

## 2.0.1 (2026-09-15)

Hotfix for the native file picker shipped in 2.0.0.

### Fixed

- **Native file picker never opened (macOS)** — the `@xmorse/rfd` async dialog
  panics off the main thread in non-GUI host processes, leaving the RPC promise
  pending forever: the attach buttons went dead with no dialog, no error, and no
  way to recover without a restart. The picker now runs the synchronous dialog
  in a dedicated child process (main-thread-safe, panic-isolated, watchdog at
  10 minutes). Verified live: dialog opens and returns real paths, and picker
  failures now surface a toast instead of failing silently.
- Concurrent picker requests from a second client get a typed
  "dialog is already open" rejection instead of queueing invisibly.

## 2.0.0 (2026-09-14)

A major rewrite of the Skill Creator experience: model configuration rebuilt around
route tabs, the agent panel redesigned on the dsh-webui design grammar, session
management with automatic cleanup, and native file picking — reviewed through six
independent codex review rounds (final PASS 9.6/10).

### Highlights

- **Model routes as tabs** — every provider endpoint is a self-contained tab
  (identity/icon, credential, endpoint, models, remove). Adding from the catalog
  creates the route immediately; duplicates number themselves (`zai-2`,
  `Z.ai (1)`). Per-model configuration: modelId with cross-provider completion
  (namespace IDs filtered), auto-generated display name, reasoning efforts
  (tags with standard-tier completion, default `low/high/max`), context window and
  max output tokens with shorthand input (`0.5M`, `253k`), input/output type
  chips with models.dev-sourced defaults, and one-click connection testing across
  all nine wire protocols.
- **Agent panel, redesigned** — dsh-webui disclosure-row grammar, full-width
  assistant messages, right-aligned user bubbles, thinking/tool/todo rows,
  context meter with per-model capacity, turn pills, `/compact` slash menu, `$`
  skill-name completion, per-role lazy session creation, draft data isolated per
  session, resizable panel (320–720px), narrow-screen drawer overlay, and
  collapse-without-destroy semantics.
- **Session management** — Settings → Sessions lists sessions by date with
  per-row delete (kernel-only rows marked and protected), a configurable
  retention policy (`sessionCleanupDays`, default 30) enforced at boot, and a
  Clean-now action. Product transcripts only; `$DSH_HOME` kernel logs are never
  touched.
- **Native file & image picking** — attachment buttons wake the OS-native file
  dialog via `@xmorse/rfd` on the daemon side; real paths flow through prompt
  attachments with daemon-side size guards. jSquash powers server-side thumbnail
  previews.
- **Schema-gated firehose** — every DSH kernel event is validated at the daemon
  boundary (Zod safeParse per event type); malformed payloads are dropped with
  bounded diagnostics and never pollute frame sequencing. Assistant reasoning is
  persisted durably and replays identically after restart.

### Breaking

- Persisted state is re-narrowed on load per the no-compatibility policy:
  unknown fields in `workspaces.json` / steward stores are discarded by
  safeParse (data is not migrated or rewritten). Backup `~/.skill-creator`
  before upgrading if you need to roll back.
- CLI and daemon versions must match; a version mismatch replaces the daemon.
- Minimum Node.js is now `>=24.0.0` (DSH kernel persistence uses `node:zlib` zstd).

### Security

- The settings view now returns the stored API key (`providers[].apiKey`,
  password-masked in the UI with an eye toggle) per product decision
  2026-09-13 — the loopback+token surface remains single-user local. Run/audit
  payloads keep structural credential redaction.

### Fixed

- Credentials are written to the kernel's version-1 `refs` layout (flat
  top-level keys no longer break the next DSH boot).
- Effort tags no longer delete themselves on click (label-click forwarding bug).
- Composer text no longer loses focus outline styling or clears on blur.
- Auto-compact now fires when `inputTokens ≥ contextWindow − maxOutputTokens`,
  with a visible transcript marker.

### What's next

- Roles as subagents with `@`-summoning — see the [proposal](docs/research/2026-09-12-roles-as-subagents.md)
  (three design decisions pending).

## 1.5.2 (2026-05-21)

See git history for the 1.x series.
