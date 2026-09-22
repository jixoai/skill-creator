<!--
File intent (2026-09-21). Owner ruling context: repo READMEs are bilingual
(README.md EN canon + README.zh-CN.md, lockstep — same facts, both
languages, evolving together).
-->

# skill-wiki

A persistent agent-experience wiki: the domain library behind skill-creator's
knowledge layer. It implements the wiki tier of the WikiSkill architecture
([arXiv:2608.27454](https://arxiv.org/abs/2608.27454), Google Research) and
follows the lifecycle framing of
[SkillWiki](https://arxiv.org/abs/2606.16523) (ingestion → production →
provenance → governance → evolution).

**Incubation status.** This package is `private: true` and consumed from
source (`src/` direct export, no build step). It incubates inside the
skill-creator monorepo the same way ccsi did — once the design stabilizes
into a standard it will be published to npm as `skill-wiki`. Zero daemon or
WebUI dependencies; the library core depends on `zod` only, and the CLI's
similarity pipeline additionally consumes `@jixoai/search` (kept out of the
root entry so daemon bundles never pull it in).

## Where it sits in the WikiSkill architecture

The paper separates agent experience into three tiers:

| Tier      | Paper role                              | Who owns it here                     |
| --------- | --------------------------------------- | ------------------------------------ |
| `raw/`    | immutable trajectory logs               | skill-creator kernel session stores  |
| `wiki/`   | persistent knowledge, never rolled back | **this package**                     |
| `skills/` | rollback-able skill proposals           | skill-creator skills layer + steward |

This package is deliberately **LLM-free and IO-minimal**: patch semantics,
dedup, sampling budgets, and gate decisions are pure, deterministic
functions. The four LLM agents from the paper (Wiki Maintainer, Skill
Proposer, …) are orchestrated by the host kernel in a later slice — they
consume this library, never the other way around.

## Storage contract

**Directory mapping standard (owner ruling 2026-09-22).** A wiki is a
property of its directory — a `.git/`-style convention, not a namespace
handed out by any central registry:

- any workspace directory `<dir>` keeps its wiki at
  `<dir>/.agents/skill-wiki/` (`workspaceWikiDirectory(dir)`); project-level
  use needs **no registry at all** — run the CLI in any directory and its
  `.agents/skill-wiki/` is created on demand;
- global is the `~` special case, resolved by `globalWikiDirectory()`:
  `SKILL_WIKI_HOME` env override, else `~/.agents/skill-wiki/`;
- registry workspaces (skill-creator) keep their wiki **co-located** with the
  workspace directory — the registry resolves a workspace id to its directory,
  never to a wiki name;
- there is **no central root and no slug table**: scope shape validation and
  `scopes.json` assignments are retired because the scope is objectively
  decided by the path.

```
<workspace dir>/                     # any project directory (no registry needed)
└── .agents/skill-wiki/
    ├── patterns/            # source of truth: one canonical pattern per file
    │   └── <name>.md
    ├── index.md             # derived projection, always rebuilt from patterns/
    ├── logs.md              # human-readable append-only event log
    ├── skill-impact.md      # machine-appended JSONL audit: proposal → decision
    └── search-index/        # dedup/similarity index (@jixoai/search, sqlite)

~/.agents/skill-wiki/               # global (the "~" special case;
                                    #   SKILL_WIKI_HOME overrides)
```

- **Host and CLI converge** on the same physical directory: the skill-creator
  daemon writes `<dir>/.agents/skill-wiki` through its registry, the CLI
  reads it back with `--workspace <dir>` — one truth, zero bridging.
- **`origin` footprint convention**: pages record where they were captured —
  `"~"` for global writes, the workspace directory's absolute path for
  workspace writes (human-readable and machine-parseable).
- **`patterns/` is the single truth.** `index.md` exists for standard
  compatibility only — the CLI refreshes it after every read command, so
  no maintenance command exists (`rebuildIndex()` also regenerates it from
  the directory). There is never a second truth to reconcile.
- **`logs.md` is unstructured by design** (human-auditable narrative);
  **`skill-impact.md` is structured by design** (one `SkillImpactEntry`
  JSON object per line, the harness's programmatic audit trail).
- Legacy layouts (`~/.skill-wiki/` central root, `~/.skill-creator/wiki`
  sidecar) are migrated once by `scripts/migrate-wiki-roots.sh.ts` — see
  `docs/wiki-design.md`.

## Pattern page anatomy

```markdown
---
title: Pin exit codes in gates
created: 2026-09-21T00:00:00.000Z
updated: 2026-09-21T00:00:00.000Z
origin: /Users/me/Dev/project # workspace footprint where it was captured ("~" for global)
promotedFrom: "" # generalization provenance, written by the LLM maintainer (slice 3)
---

Gate commands must branch on the real exit code, never on piped stdout.
```

- `origin` is the minimal provenance footprint (the paper's provenance-aware
  exploration): `"~"` for global writes, the workspace directory's absolute
  path for workspace writes. `promotedFrom` is a **reserved**
  generalization-provenance slot: when the host's LLM maintainer distills
  workspace knowledge into a global page (creating one, or absorbing it into
  an existing one via patches), it records which workspace's insights
  triggered that page. It is never a mechanical move — workspace pages stay
  where they are, and the append path always writes `null`.
- **Dedup criterion**: `contentHash` = SHA-256 of the body after
  normalizing CRLF → LF and stripping trailing whitespace. File-hygiene
  bytes never participate, so the append side and the read-back side always
  agree. Appending a body whose hash already exists in the scope is
  idempotent: no new page, the existing item is returned with
  `deduplicated: true`.
- **Strict semantics on read**: a page whose frontmatter carries unknown
  keys, missing fields, or incompatible types is dropped from projections
  entirely ("this version cannot accept it" → empty), never field-cleaned
  into a half-valid page.

## Patch engine

The Wiki Maintainer's edit vocabulary, as pure functions over text:

```ts
type WikiEdit =
  | { op: "append"; content: string }
  | { op: "replace"; target: string; content: string } // first match only
  | { op: "insert_after"; target: string; content: string };
```

Anchors resolve **sequentially against the evolving content** — a later edit
may anchor on text produced by an earlier one. Any anchor miss (or empty
target) aborts the whole batch with `WIKI_PATCH_FAILED`: `applyEdits` is a
pure function, so a failed batch never yields a partial result; disk
atomicity (same-directory temp + rename) belongs to the write path.

## Sampling & gating

The paper's proposer preconditions, as frozen pure functions:

- `sampleTrajectories(entries)` — stratified budget: the **most recent
  ≤ 5 failed + ≤ 3 passed** trajectory entries, input order preserved, each
  truncated to 15,000 chars. Budgets are exported constants; the host's
  orchestrator reuses them instead of re-deriving.
- `decideGate(input)` — strict improvement gate: `candidateScore >
baselineScore` accepts, anything else rejects (the host then rolls back
  only the skills tier, per the paper). Every decision returns a schema-
  valid `SkillImpactEntry` so the audit footprint cannot be bypassed.

## API surface

| Module              | Exports                                               | Safe for               |
| ------------------- | ----------------------------------------------------- | ---------------------- |
| `skill-wiki`        | everything (schema, patch, workspace, sampling, gate) | Node                   |
| `skill-wiki/schema` | Zod schemas + types only (pure zod, zero node deps)   | **any** (browser-safe) |

The `./schema` subpath exists so browser bundles (WebUI, shared RPC
contracts) consume types and schemas without pulling `node:fs` through the
workspace tier. Import from the root entry only in Node contexts.

## CLI (private bin)

The package ships a `skill-wiki` bin (`bin/skill-wiki.ts`, run locally via
`pnpm exec tsx bin/skill-wiki.ts` — src-direct, no build step while
private). The implementation lives in `src/cli.ts` and exports a pure
`runCli(argv, io)` face for tests; it is deliberately **not** re-exported
from the root entry (see incubation note above).

```
list    [--workspace <path|~|./>] [--sort name|updated] [--offset 0] [--limit 100] [--json]
show    <name> [--workspace] [--json]
add     --title <t> [--workspace] [--no-similarity] [--json]   # body from stdin
find    <query> [--workspace] [--json]
edit    <name> -f <edits.json> [--workspace] [--json]          # WikiEdit[] JSON file
remove  <name> [--workspace] [--json]                          # + logs.md footprint
log     [--workspace] [--limit 20] [--json]
impact  [--workspace] [--filter accept|reject] [--json]
```

- **`--workspace <path|~|./>`** (default `./`): project-level use is the
  first-class default — the current directory's `.agents/skill-wiki/` is
  used with no registry involvement; `~` addresses global, and any
  relative/absolute directory path addresses that directory's wiki.
- **Exit codes**: `0` success (including hash-deduplicated adds, which print
  `Already captured as "…"`); `2` usage; `3` `WIKI_INVALID_SCOPE`; `4`
  `WIKI_INVALID_PATTERN`; `5` `WIKI_PATCH_FAILED`.
- **Similarity on write**: after every `add` (unless `--no-similarity`) the
  page's title+body is searched against the wiki's
  `search-index/` index (fields `title` weight 3 / `body` weight 1,
  sqlite backend for multi-process safety) and near-relatives are printed as
  `similar: <name> (0.83), …` — the score is relative to the page's
  self-match and the threshold is the frozen versioned constant
  `SIMILARITY_THRESHOLD = 0.35`. Similarity is a warning, never an error
  (search failures degrade to a stderr warning with exit 0). `find` queries
  the same index read-only (populating it once when missing/stale-rebuilt).
- **Derived artifacts self-heal**: every read command refreshes `index.md`
  after output; `add`/`edit`/`remove` keep the search index in step. The
  command surface has no `reindex`.

## Error model

One library-level error class with discriminable codes — no host error
hierarchy is leaked in either direction:

| Code                   | Meaning                                            |
| ---------------------- | -------------------------------------------------- |
| `WIKI_PATCH_FAILED`    | a patch anchor did not resolve (batch aborted)     |
| `WIKI_INVALID_PATTERN` | invalid pattern name / title / frontmatter / entry |
| `WIKI_INVALID_SCOPE`   | workspace reference is empty or unparseable        |

## Design rulings (owner decisions)

- **Directory mapping standard (2026-09-22).** A wiki lives at
  `<dir>/.agents/skill-wiki/` — a property of the directory, like `.git/`.
  Global is the `~` special case (`SKILL_WIKI_HOME`, default
  `~/.agents/skill-wiki`). The central root, slug namespace, and
  `scopes.json` assignment table are retired: the scope is objectively
  decided by the path, so the collision/impersonation problem family
  disappears structurally. CLI `--workspace` defaults to `./`
  (project-level first-class; global is explicit `~`).
- **No `PURPOSE.md` per pattern.** Consumption semantics live in the
  frontmatter; evolution semantics live in `skill-impact.md`. A third
  per-page file would duplicate both.
- **`index.md` is derived, never authoritative.** Read paths rebuild from
  `patterns/`; the file exists for external tooling only.
- **Paper prompts are not ported.** Prompt text ships under CC BY via the
  paper's appendix; product prompts are rewritten in the host's context
  instead of dragging a license chain into this library.
- **Fragment append (P1) is merged into this package** rather than living
  as a separate notes feature — fragments are the wiki's ingestion input.

## Roadmap (host-side, out of this package)

Slice 3 of the incubation plan: the four-agent loop (Wiki Maintainer /
Skill Proposer as kernel agent roles), post-session consolidation, and
workspace → global generalization (LLM distillation that updates global —
creating pages or absorbing insights via patches — while workspace pages
stay untouched) all live in the skill-creator
kernel and consume this library.

## Test & verify

```bash
pnpm exec vitest run packages/skill-wiki   # from the repo root
```
