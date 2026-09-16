<!--
File intent (2026-09-15, bilingual restructure — Owner ruling: "at least bilingual").
Original user requests: see README-zh.md's intent header (Chinese, canonical history).
Orthogonal intents: 1. Define the product boundary. 2. State the real install and run path.
3. Document the protocol and security model. 4. Provide the development verification entry.
5. Carry the storefront brand mark (color-symbol).
Compromise: the README ships inside the published package as the only public entry —
install, run, boundary, and security facts must live in one file; this English canon and
README-zh.md must evolve in lockstep (same facts, both languages).
-->

<p align="center">
  <img src="./resources/color-symbol.png" alt="Skill Creator" width="180" />
</p>

<h1 align="center">Skill Creator</h1>

English | [简体中文](README-zh.md) · Site <https://skill-creator.jixoai.com>

Skill Creator is a local-first workbench for Agent skills. A thin CLI manages a single daemon; the daemon hosts everything in its own shell (an SPA with three ChromeTabs-style apps): the agent panel on the right carries conversations, a headless DSH (DeepSeek Harness) kernel drives sessions (agent/session/llm/approval), and the Manager's domain capabilities are exposed as an MCP server (`/mcp`, plus a `skill-creator mcp` stdio form from the same implementation) for the kernel and external clients — every mutation arrives as a proposal awaiting human approval. Skill discovery, validation, and installation run through the ccski SDK; Workspace/Provider projection, permission boundaries, and the cross-route experience belong to Skill Creator, not ccski. When the kernel is unavailable the daemon degrades to a Manager-only surface without blocking startup.

```text
                               Skill Creator

  Human
    |
    +-- CLI -------- versioned IPC --------+
    |                                      |
    +-- Tray WebUI -- authenticated oRPC --+--> Daemon --> filesystem / Git
                                                   |
                                                   +--> ccski
                                                   +--> OpenTray ext-webview

  /workspaces                /creator                /repository
  list / import/remove       create / edit           scan / preview / install
  discover / inspect         revision checked        one pinned Git commit
  validate / toggle          change log              curated + user sources
```

The top-level navigation is three apps — Workspaces, Creator, Repository. The WebUI uses a ChromeTabs-style tab shell (`webui/src/lib/shell` + `webui/src/lib/apps`); URLs are resolved by the shell's route registry and SvelteKit serves a single catch-all mount point.

## Product boundary

| Surface                    | Responsibility                                                                                                                                                                                                    | Write boundary                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/workspaces` home         | Index Global and Imported Workspaces; entry points for import and remove-recovery                                                                                                                                 | Remove Workspace deletes only the registry entry, never the user's directory                                                   |
| `/workspaces` provider tab | Discover, filter, inspect, validate, enable, or disable skills in one Workspace's Providers; compare against upstream and reinstall outdated skills; the `Workflow` tab hosts the skill steward workflows (below) | Every operation carries an explicit Workspace ID + Provider ID                                                                 |
| Global Workspace (`~`)     | Aggregates each Agent's global skills roots                                                                                                                                                                       | Read/manage existing skills; never a write target for Creator or Repository                                                    |
| `/creator`                 | Create, load, edit, and delete `SKILL.md` inside imported Workspace.Providers; view the change log (agent sessions live in the right-hand panel, below)                                                           | `workspace`+`provider` preselects a new draft; adding `skill` loads it for editing; update/delete require the content revision |
| `/repository`              | Scan Git repositories, preview skills, dry-run, install to multiple targets, and review results; manage curated and user Discover sources                                                                         | A scan session pins one commit; multiple imported Workspace.Provider write targets; user sources are https-only Git URLs       |

Workspace is the first scope layer for skills; a Provider is one Agent skills root inside it. The Global Workspace (`~`) resolves this machine's Agent global directories from a community catalog; an Imported Workspace derives each Provider root from its canonical directory. The user submits a directory path only when importing; afterwards, skill reads and writes use daemon-verified `WorkspaceProviderTarget`s, opaque Workspace IDs, and Skill IDs — the WebUI never assembles output paths.

The Provider catalog is a reviewed snapshot of [vercel-labs/skills](https://github.com/vercel-labs/skills) `src/agents.ts`, living at `src/shared/provider-catalog.ts` at runtime. See [references/README.md](references/README.md) for the local research checkout notes; it is not a runtime or release dependency.

```text
/creator
   |-- no query ----------------------------------- blank draft in the first writable Workspace.Provider
   |-- ?workspace=ws_*&provider=<provider> -------- blank draft in that Imported Workspace.Provider
   `-- ?workspace=ws_*&provider=<provider>&skill=sk_* -- revision-safe edit

skill without workspace / invalid ID ---- redirect to canonical /creator

Repository install
   `-- selected skills x selected Workspace.Provider targets
          -> daemon-verified local Skill IDs -> Review installed -> Creator edit
```

## Requirements

- Node.js `>=24` (kernel persistence uses `node:zlib`'s zstd; the `package.json` engines field is the same source of truth)
- Bun `>=1.3` (development and build scripts)
- pnpm `>=10`
- Git, callable as `git` by the daemon process
- macOS, Windows (`arm64` / `x64`), or Linux

macOS and Windows host the native app window through `@opentray/ext-webview` (`appMode: true` joins the taskbar/Dock and app switcher; focus, layering, and closing are managed by the OS). On Linux `@opentray/ext-webview` has no native package, so the default is **web mode**: the daemon mounts a plain OpenTray notification-bar icon (menu + icon) and the WebUI opens in the system browser. Any platform can override explicitly with `--web` / `--no-web`.

## Install and development

The repository root is a pnpm workspace that includes `webui`. One install is enough:

```bash
pnpm install
```

Start the WebUI with HMR and the development daemon:

```bash
pnpm dev              # default (native window on macOS/Windows)
pnpm dev --web        # force web mode: plain tray + browser, no native window
pnpm dev --no-web     # force windowed mode (overrides the Linux default)
```

`pnpm dev` is wrapped by `scripts/dev.sh.ts`: it intercepts `--web` / `--no-web` into the `SKILL_CREATOR_WEB` env (vite itself rejects unknown flags) and passes everything else through to vite. Vite first releases the production daemon and any previous dev process tree, then allocates the daemon port, mounts the `/api/` and `/ws/` proxies ahead of the SvelteKit SPA fallback, and mounts the dev-mode OpenTray. Repeated `pnpm dev` runs need no manual socket cleanup; the takeover waits for both the old daemon's PID and IPC endpoint to release. During the daemon startup window the API returns a retryable `503` instead of falling back to `index.html`. On macOS the dev home defaults to `/tmp/sc-v2`, so app state lives under `/tmp/sc-v2/.skill-creator/` and never touches your real user state. Windows uses `skill-creator-v2-dev` under the system temp directory.

Build and full static checks:

```bash
pnpm build
pnpm check
```

`pnpm build` produces:

```text
dist/
|-- cli.js          # skill-creator bin
|-- daemon.js       # daemon entry
|-- package.json    # daemon/CLI version truth
`-- webui/          # static SvelteKit SPA
```

## CLI

Inside the repository use `pnpm skill-creator <command>` after building; as an installed package use `skill-creator <command>`.

| Command         | Behavior                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`         | Start the daemon, wait for the WebUI and tray to mount, then show the native window; web mode opens the browser; headless prints the `openinbrowser` hint and does not auto-open |
| `start --web`   | Start in web mode: mount only the plain tray icon (menu + icon), no native window; the WebUI opens in the system browser (the Linux default)                                     |
| `open`          | Show and focus the existing tray window; web mode falls back to opening the browser; unavailable headless, hinting `openinbrowser`                                               |
| `openinbrowser` | Explicitly open the current daemon's tokened WebUI URL in the system browser                                                                                                     |
| `status`        | Print PID, version, HTTP port, tray state (mounted/web/headless), and any tray error                                                                                             |
| `stop`          | Stop the production daemon; if the production endpoint is gone, discover and stop the dev daemon, waiting for endpoint release                                                   |
| `search`        | Search local skills in-process (BM25 + skill tokenizer, no daemon required); see [Skill search](#skill-search)                                                                   |
| `version`       | Print the package version                                                                                                                                                        |
| `help`          | Print command help                                                                                                                                                               |

```bash
pnpm build
pnpm skill-creator start
pnpm skill-creator start --web   # force web mode (plain tray + browser)
pnpm skill-creator status
pnpm skill-creator open
pnpm skill-creator openinbrowser
pnpm skill-creator stop
```

The commands above were exercised against the built output (`dist/`, identical to the published package): headless `start` prints the recovery hint and exits 0; `status` prints pid/version/port/tray state, the DSH host health line (`--json` prints the full state), and the tokened WebUI URL; `open` is unavailable headless and hints `openinbrowser`; `openinbrowser` prints and invokes the system browser; after `stop` the HTTP endpoint releases immediately and `status` reports ENOENT with the `start` recovery entry. The published package was black-box tested the same way (start/status/stop/restart) after `npm install <tarball>` in an empty directory outside the repo (ccski is bundled into the output, no `link:` dependency; reproduce with `bun scripts/clean-install-check.sh.ts`, evidence in `docs/release/skill-steward.md`). Runtime requires Node `>=24.0.0` (kernel persistence uses `node:zlib`'s zstd; the `node:module` `stripTypeScriptTypes` that DSH code-runtime needs requires `>=22.13`, already covered by 24).

## Skill search

`skill-creator search <query...>` searches every local skill — all Global Workspace provider roots plus every Imported Workspace — in-process, without the daemon:

```bash
skill-creator search "React组件设计"            # human-readable output
skill-creator search react component --json    # machine-readable: { "results": [...] }
skill-creator search http3 --limit 20          # limit 1..50, default 10
```

Results are canonical: multiple installations of the same skill (symlinks included) collapse into one entry with an `installations` list, and byte-identical copies fold into `duplicates`. Ranking is field-weighted BM25+ (name ×10 … body ×1) plus a frozen rerank pass, with prefix and fuzzy (typo) matching; ordering is deterministic and replayable. The first run builds a persistent index under `~/.skill-creator/search-index.json`; later runs refresh it incrementally via stat checks (mtime/size/inode/ctime), so unchanged corpora are not re-read. Exit codes: `0` on a successful query (including zero results), `1` for an empty query, a bad flag, or an index I/O failure. Design, frozen tokenizer/ranking contracts, and benchmark methodology: [docs/search-design.md](docs/search-design.md).

## Skill Steward

The skill steward is a Manager-owned maintenance workflow: choose a task and scope → run → review evidence → human approval → apply → roll back if needed. The entry point is the **Workflow** tab in the Workspaces provider view.

## Agent panel and the MCP capability surface

- **Agent panel**: a shell-level right drawer (440px resident ≥720px, full-screen overlay on narrow screens) that survives tab switches. Session list/create/switch, conversation streams (tool rows expand inputs/results), ask_user_question approval cards, model/preset/approval configuration projection; disconnects are visible and recoverable.
- **Headless kernel**: the daemon boots a single `dsh-base` bundle (no DSH webui/HTTP surface); the product preset carries only persona + ask-user, with generic bash/fs/web tool rows disabled; the official `@deepseek-ai/dsh-mcp-client` bridge registers Manager capabilities as `mcp__skill-creator__*` tools.
- **MCP surface**: `/mcp` (loopback + Bearer web token, stateless streamable HTTP) and `skill-creator mcp` (stdio, readonly-narrowed) share one implementation; skill documents also have a readonly resource template. Tool results automatically attach `ui://` visual cards per capability (skill info/findings/proposals/install results, with in-app navigation); the panel renders them in sandboxed iframes with untrusted text forcibly escaped.
- **Authority red line**: MCP mutations always produce proposals (`*_propose` tools) awaiting human approval in the panel before the Manager executes them; the Manager forever owns path, revision, toggle, install, update, and approval authority.

### Model configuration

- Opening the Workflow tab shows the current runtime config (model, preset, approval policy, revision). The preset is `deterministic` (built-in scripted transport, zero credentials, works offline) or `live` (a real provider).
- Switching to `live` requires writing an API key for the chosen provider first (credentials live in a daemon-private file `0600`; the UI only echoes the configured state, never the value).
- The approval policy `ask` / `never` only affects the agent's interaction policy while running; **apply always requires a human-approved one-time grant** — the policy never widens authorization.

### Maintenance flow

1. Pick a task: `Check` (read-only health inspection), `Optimize` (edit optimization), `Organize` (split/merge/toggle cleanup).
2. Pick a scope: check a subset of skills (empty = the whole Provider), optionally with up to 2000 characters of supplementary instructions.
3. `Run`: the daemon takes a snapshot, the agent executes through five domain-whitelisted tools (every call returns to the Manager registry for audit), and proposals come out.
4. Review: each proposal card goes `Validate` (per-item checks) → `Approve` (mints a one-time grant bound to the patch fingerprint and all input revisions) → `Apply` (a journaled transaction; the mutation diff table lists relPath/semantics/revision changes).
5. Roll back: after `Prepare rollback`, choose per proposal type — toggle-type reverse operations are reverse proposals (Approve reverse / Apply reverse again); split/merge types roll back directly with `Rollback (replay)` replaying the journal backwards. Byte-exact disk restoration is guaranteed by the transaction layer.

### Recovery flows

- **DSH kernel unavailable** (missing package/version mismatch/plugin failure): the daemon explicitly degrades to the Manager-only surface (no agent sessions; `agent.*` returns a typed UNAVAILABLE) and `status`'s `dsh` field carries the reason; restarting the daemon is the recovery path.
- **Apply terminal states `recovery-required` / `compensated`**: the proposal card shows a banner with the daemon-side failure reason; `compensated` means the transaction already rolled itself back, `recovery-required` means leftovers must be handled per the hint (file state is preserved, never silently overwritten). Re-run the task for fresh proposals afterwards — proposals whose revisions drifted are rejected at validation (`stale`).
- **Reconnects**: task/scope selection, runtime config, and the latest run projection survive reconnects; late responses never overwrite newer state.
- **Daemon restart**: `skill-creator stop && skill-creator start`; unconsumed approval grants all expire (authorizations are never replayed) and need re-approval.

## Runtime architecture

```text
src/cli/cli.ts
    |
    | length-prefixed JSON frame
    | protocolVersion + clientVersion
    v
src/daemon/ipc-server.ts ---------------------- single-instance owner
    |
    +--> src/daemon/index.ts ------------------ lifecycle/status
    |       |-- WebServer @ 127.0.0.1:random -- SPA + /ws/rpc + /mcp (MCP face)
    |       |-- dsh-host-lifecycle.ts -------- headless DSH kernel mount
    |       |                                    (failure degrades to manager-only)
    |       `-- TrayHost -> OpenTray ext-webview
    |
    +--> src/daemon/rpc-router.ts
            `--> domain.ts ------------------ one daemon composition root
                    |-- workspace-registry/ -- persisted truth + dynamic projection
                    |-- skill-service.ts ----- ccski adapter
                    |-- creator-service.ts --- revision-safe document writes
                    |-- repository-service.ts  pinned clone lifecycle
                    |-- source-registry.ts --- curated + user Discover sources
                    |-- skills-update-service.ts  lock-hash update check/apply
                    |-- steward/ --------------- Skill Steward pipeline + journal
                    |       `-- dsh-session-binder -- run↔kernel session + stream frames
                    |-- kernel/ ---------------- headless dsh-base boot + agent
                    |       |-- dsh-kernel ------- profile + tool-surface policy + MCP row
                    |       |-- agent-sessions --- panel sessions + stream + answerer
                    |       `-- product-prompt --- versioned best-practices section
                    |-- mcp/ -------------------- skill-creator MCP server
                    |       |-- skill-creator-mcp - capability tools + resources
                    |       |-- cards ------------- ui:// card templates (escaped)
                    |       `-- proposals --------- mutation→proposal approval chain
                    |-- capability/ ------------- capability-core + domain registry
                    |-- dsh-settings.ts ------- model/preset/permissions
                    `-- acp-bridge-service.ts  [internal legacy] agent subprocess + fs security gate (product entry removed, 3.2)

src/shared/rpc-contract.ts
    ^                    ^
    | runtime schemas    | inferred client types
 daemon              webui/src/lib/rpc-client.ts
```

Browser-safe contracts compose in `src/shared/rpc-contract.ts`, with the concrete schemas physically split under `src/shared/contracts/`:

| RPC module     | Procedures                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills`       | `list`, `info`, `toggle`, `validate`, `update.check`, `update.apply`                                                                                                                                            |
| `workspace`    | `list`, `add`, `remove`, `setActive`                                                                                                                                                                            |
| `creator`      | `save`, `load`, `remove`, `revisions`                                                                                                                                                                           |
| `repository`   | `scan`, `preview`, `install`, `sources.list`, `sources.add`, `sources.remove`                                                                                                                                   |
| `daemon`       | `status`                                                                                                                                                                                                        |
| `skillSteward` | `startRun`, `validate`, `approve`, `apply`, `prepareRollback`, `applyRollback` (human approval surface; apply/rollback are journaled transactions)                                                              |
| `agent`        | `sessions.list/streams`, `session.create/prompt/cancel/stream/answer`, `card.get`, `proposals.list/approve/reject`, `settings.get/update`, `credentials.set/clear` (panel + approval chain + config projection) |
| `acp`          | `agents.list`, `session.open`, `session.close` (internal legacy, not a product entry)                                                                                                                           |

The WebUI derives its client types from the shared contract; the daemon implements handlers against the same one. Network input and output both pass Zod runtime validation.

Workspace lists, skill lists/details, and repository scan/preview each carry an independent request generation; a newer request, a scope switch, or an RPC client replacement revokes an older response's commit eligibility so slow responses never clobber fresh UI state. Revoked read/write requests never trigger follow-up refreshes or navigation on a new connection; a dirty draft the Creator has accepted survives disconnect-reconnects.

## Security model

```text
explicit import path
        |
        v
 realpath + directory check --> ws_<digest> --> server registry
                                            |
WebUI mutation -----------------------------+--> server resolves root
   workspaceId + providerId + skillId            |
                                                 +--> containment check
                                                 +--> atomic write

Git source + ref --> temporary clone --> commit SHA --> repo_<session>
                                                        |
                                      preview/install --+--> same snapshot
```

- HTTP listens on `127.0.0.1` only. `/api/health` and the static SPA perform no filesystem mutations.
- The daemon mints a 32-byte web token at every startup. The token reaches the WebUI through the URL fragment, is captured into the tab's `sessionStorage`, and is removed from the address bar; `/ws/rpc` validates it before the protocol upgrade.
- The IPC endpoint is the single-instance lock. On macOS the runtime directory is `0700` and the socket `0600`; Windows uses `\\.\pipe\skill-creator-sock`.
- Workspace, Provider, Skill, Repository Session, and Remote Skill are all bound to server-generated or server-verified identities. Apart from the explicit import in `workspace.add` and the Git source in `repository.scan`, mutations never accept caller-supplied output paths.
- Exactly one in-memory Workspace Registry lives for the daemon's lifetime. Persisted paths must be absolute and normalized; `ws_*` must match the path digest; import, remove, and switch atomically commit the full next state before replacing memory. `skillCount` and availability derive at read time and are never written back.
- Creator drafts may only create direct children of an imported Workspace.Provider; edits and deletes must stay inside that Provider root. Documents land atomically via a temp file plus rename; update/delete reject stale operations on SHA-256 revision mismatch.
- Repository scans clone first, then narrow the HEAD commit with Zod. Preview and install reuse the same temporary snapshot and session ID; eviction immediately rejects new operations but lets accepted installs hold the snapshot until done. daemon stop aborts pending clones, and late scans cannot re-register a session.
- Repository installs cannot target `~`; every target must be an imported, writable Workspace.Provider. Multiple targets yield per-skill, per-target independent results.
- The repository install summary carries the Workspace.Provider targets committed at install time; the ccski installer output is first narrowed by a runtime schema, and only items actually `installed` / `overwritten` and re-verified as a direct, non-symlink `SKILL.md` child of the Provider root receive a local Skill ID for Creator review.
- The daemon publishes its stop coordinator and signal listeners before mounting the tray. Stop closes HTTP/WebSocket and IPC admission first, then reclaims repository, tray, and connections in parallel; native handles arriving late during mount are destroyed immediately, uncooperative sockets are force-closed after the grace deadline, and concurrent stops converge on one completion state.
- Every external read decodes to `unknown` first and then runs the current Zod schema's `safeParse`. Incompatible snapshots inside config files, future database records, and third-party/network responses project to their domain's empty value; collections drop invalid entries; results that cannot safely read as empty return typed failures. RPC/IPC, authentication, paths, and mutation inputs are still rejected explicitly — never degraded to empty.
- The current v2 registry has no migration layer for older schemas. JSON syntax errors or states that fail the current Zod schema load as empty: nothing is read, converted, or written back at load time; the next normal workspace mutation atomically commits the current v2 state. File I/O errors still refuse startup and log to `.skill-creator/logs/daemon.log` under the current home. There is no database today; when one lands, database reads must follow the same projection law.

## State paths

| State              | macOS / release                           | Windows / release                              |
| ------------------ | ----------------------------------------- | ---------------------------------------------- |
| App directory      | `~/.skill-creator/`                       | `%USERPROFILE%\.skill-creator\`                |
| Workspace registry | `~/.skill-creator/workspaces.json`        | `%USERPROFILE%\.skill-creator\workspaces.json` |
| User repo sources  | `~/.skill-creator/sources.json`           | `%USERPROFILE%\.skill-creator\sources.json`    |
| Daemon log         | `~/.skill-creator/logs/daemon.log`        | `%USERPROFILE%\.skill-creator\logs\daemon.log` |
| IPC                | `~/.skill-creator/run/skill-creator.sock` | `\\.\pipe\skill-creator-sock-<home-digest>`    |

`SKILL_CREATOR_HOME` overrides the home root for the current command; the app still creates `.skill-creator/` under it. `SKILL_CREATOR_DEV_HOME` overrides the dev runtime discovery path specifically; on macOS it defaults to `/tmp/sc-v2/.skill-creator/`.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm --dir webui check
pnpm build
pnpm exec vp fmt --check
git diff --check
npm pack --dry-run
```

## License

MIT
