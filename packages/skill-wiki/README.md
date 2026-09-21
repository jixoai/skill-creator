<!--
File intent (2026-09-21). Owner ruling context: repo READMEs are bilingual
(README.md EN canon + README-zh.md, lockstep). This package is private and
incubating; the EN canon lands now, README-zh.md joins at publish time
(same facts, both languages, per the repo-wide ruling).
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
WebUI dependencies; the only runtime dep is `zod`.

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

One wiki per **scope**, stored in an app-owned sidecar tree (never inside
the user's skill assets):

```
<root>/wiki/<scope>/
├── patterns/          # source of truth: one canonical pattern per file
│   └── <name>.md
├── index.md           # derived projection, always rebuilt from patterns/
├── logs.md            # human-readable append-only event log
└── skill-impact.md    # machine-appended JSONL audit: proposal → decision
```

- **Scopes** are dual-level: global `"~"` (generalized knowledge detached
  from any workspace) and per-imported-workspace `"ws_<24-hex>"`. Scope ids
  are validated by `parseWikiScope`; the host gates `ws_*` against its
  workspace registry before opening a wiki.
- **`patterns/` is the single truth.** `index.md` exists for standard
  compatibility only — `rebuildIndex()` regenerates it from the directory,
  so there is never a second truth to reconcile.
- **`logs.md` is unstructured by design** (human-auditable narrative);
  **`skill-impact.md` is structured by design** (one `SkillImpactEntry`
  JSON object per line, the harness's programmatic audit trail).

## Pattern page anatomy

```markdown
---
title: Pin exit codes in gates
created: 2026-09-21T00:00:00.000Z
updated: 2026-09-21T00:00:00.000Z
origin: ws_0123…def # scope footprint where it was captured
promotedFrom: "" # set when a page is promoted to global
---

Gate commands must branch on the real exit code, never on piped stdout.
```

- `origin` is the minimal provenance footprint (the paper's provenance-aware
  exploration); `promotedFrom` is non-null only on the global scope for
  pages promoted out of a workspace.
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

## Error model

One library-level error class with discriminable codes — no host error
hierarchy is leaked in either direction:

| Code                   | Meaning                                              |
| ---------------------- | ---------------------------------------------------- |
| `WIKI_PATCH_FAILED`    | a patch anchor did not resolve (batch aborted)       |
| `WIKI_INVALID_PATTERN` | invalid pattern name / title / frontmatter / entry   |
| `WIKI_INVALID_SCOPE`   | scope id is neither `~` nor a canonical `ws_<24hex>` |

## Design rulings (2026-09-21, owner decisions)

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
workspace → global promotion automation all live in the skill-creator
kernel and consume this library.

## Test & verify

```bash
pnpm exec vitest run packages/skill-wiki   # from the repo root
```
