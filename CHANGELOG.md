# Changelog

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
