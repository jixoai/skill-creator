## Context

`skill-creator` currently treats ChromaDB as the “better search” path and builds multiple layers around it: server lifecycle management, backend-specific adapter logic, backend-specific docs/templates, and CLI modes named after the storage engine. That is a poor fit for the actual problem shape.

The product is not a general vector-search platform. It is a local skill knowledge builder that searches markdown slices under `assets/references/`. Most queries are title/path/API-term/best-practice lookups over a relatively small corpus per skill. The platform law should reflect that.

At the same time, we should not regress into a one-off fuzzy matcher. We still need:

- prefix and typo tolerance
- weighted fields and result ordering
- persisted indexes for faster repeat queries
- clean backend replacement if corpus size or search expectations change later

The current local tech-selection demo already establishes a useful baseline:

- `uFuzzy` alone failed the natural-language query set
- `MiniSearch` satisfied the demo query set
- `sqlite-vec` plus local embeddings also satisfied the demo query set

That means the architecture question is no longer “is vector search possible locally?” but “what becomes the default law, and what remains an optional capability?”

## Goals / Non-Goals

**Goals:**

- Make local skill search work without a separately managed ChromaDB service.
- Define a stable backend contract so commands and content management stop peeking into backend internals.
- Persist reusable search indexes in a backend-neutral skill-local location.
- Keep source provenance and user-content priority as first-class search behavior.
- Rename public search modes around behavior instead of implementation brand names.
- Admit SQLite vector search as a formal backend candidate without making it the default path prematurely.

**Non-Goals:**

- Building a semantic RAG platform or remote search service.
- Preserving backend-branded public APIs such as `--mode=chroma` forever.
- Solving extremely large multi-million-document corpora in this change.
- Introducing a database server or cross-process runtime requirement as the new default.

## Decisions

### 1. Introduce a backend-neutral `SearchBackend` contract

Commands and content management will talk to a backend interface instead of concrete Chroma/uFuzzy implementations. The contract should expose:

- `backendId`
- `initialize()`
- `buildIndex(referencesDir)`
- `search(query, options)`
- `clearIndex()`
- `getStats()`
- `getIndexState()` or equivalent backend metadata

Rationale:

- Removes command-layer `as any` inspection and backend-class guessing.
- Lets the CLI and content manager operate on platform laws instead of implementation details.
- Keeps future backend swaps localized.

Alternatives considered:

- Keep the current adapter graph and only remove Chroma-specific code. Rejected because the public/runtime law would remain implicit and fragile.

### 2. Adopt `MiniSearch` as the default full-text backend

Recommended default backend: `MiniSearch`.

Rationale:

- It is a small in-process full-text engine intended for Node/browser use.
- It supports weighted full-text search, prefix search, fuzzy search, and field filtering.
- It supports index serialization/deserialization, which maps well to persisted skill-local indexes.
- It removes the need for Chroma server startup, ports, embedding models, and backend-specific operational glue.

Alternatives considered:

- `SQLite FTS5`: technically strong and worth preserving as a future backend option, especially if we later need larger on-disk corpora, richer boolean/proximity queries, or SQL-native ranking. Rejected as the immediate default because it introduces a database integration step and a heavier implementation/migration surface than the current problem requires.
- `Orama`: also viable as a pure JavaScript search engine. Not selected for the first migration because `MiniSearch` gives us a narrower, easier-to-verify fit around full-text indexing plus explicit JSON serialization.

### 3. Keep `uFuzzy` as the explicit fuzzy backend, but not as the primary search runtime

The public modes become:

- `fulltext`: default lightweight full-text backend
- `fuzzy`: explicit fuzzy/path/substring-style backend
- `vector`: explicit vector backend
- `auto`: orchestrates between `fulltext` and `fuzzy` only in this change

Recommended `auto` behavior:

- run `fulltext` first
- if results are empty or below a quality threshold, run `fuzzy`
- merge/rerank while preserving provenance and source priority

Rationale:

- `MiniSearch` handles most content search well.
- `uFuzzy` remains useful for path-like, symbol-like, or typo-heavy lookup behavior.
- Public modes now describe behavior, not vendor identity.
- The demo evidence is not strong enough to prove that `MiniSearch` fully subsumes every `uFuzzy` use case, so removal would be premature.
- The demo evidence is also not yet strong enough to justify automatically blending vector search into the default path.

### 4. Admit `sqlite-vec` as the explicit `vector` backend candidate

`sqlite-vec` becomes the formal vector backend candidate, activated through `--mode=vector`.

For the prototype and verification phase:

- vector storage uses SQLite plus `sqlite-vec`
- embeddings may use the existing local `@chroma-core/default-embed` path
- vector mode remains an explicit capability, not the default search runtime

Rationale:

- Local demo evidence shows the stack is technically viable in this repo.
- It preserves a path to semantic retrieval after Chroma removal.
- It keeps vector-specific complexity out of the default path until the replacement matrix proves it belongs there.

Alternatives considered:

- Make `sqlite-vec` the new default immediately. Rejected because it would force embedding/runtime complexity into the mainline path before the full replacement matrix is complete.
- Keep vector search out of the change entirely. Rejected because the demo already proves local viability and the user explicitly wants it in the candidate set.

### 5. Move persisted index artifacts to a backend-neutral location

Persisted index assets should live under `assets/search/` instead of `assets/chroma_db/` or other backend-branded folders.

Recommended artifacts:

- `assets/search/index-state.json`
- `assets/search/fulltext-index.json`
- optional backend-specific cache files nested under `assets/search/<backend-id>/`

`index-state.json` should include:

- backend id
- backend schema version
- references content hash
- index build timestamp

Rationale:

- Makes the skill directory structure reflect platform law instead of current implementation.
- Supports deterministic rebuild decisions.
- Avoids template/docs drift when backends change.

### 6. Treat Chroma removal as a deliberate cleanup, and keep the alias at the CLI boundary only

The stable contract is:

- `fulltext`
- `fuzzy`
- `vector`
- `auto`

Rationale:

- Public interface should not encode retired implementation details.
- This repo is still early enough that a clean break is cheaper than carrying a misleading alias indefinitely.

If the CLI accepts `--mode=chroma`, it SHALL be treated only as an undocumented legacy alias to `--mode=vector` and SHALL not appear in the stable contract, docs, or generated templates.

## Risks / Trade-offs

- [Risk] Search loses vector-style semantic matching that Chroma sometimes approximated.  
  → Mitigation: rely on title/path/source boosts, stronger chunk metadata, MiniSearch fuzzy/prefix support, and keep the backend contract open for a future SQLite FTS5 or optional vector backend.

- [Risk] `MiniSearch` is in-memory during query execution and may struggle if a single skill corpus grows very large.  
  → Mitigation: persist serialized indexes, keep the backend contract open, and only escalate to SQLite FTS5 if real corpus size justifies it.

- [Risk] `sqlite-vec` introduces runtime and embedding complexity that may exceed the current product baseline.  
  → Mitigation: keep `vector` explicit, verify it through demo and replacement matrix, and decide separately whether the package runtime floor must be raised.

- [Risk] Breaking mode removal can surprise existing users and templates.  
  → Mitigation: update all generated templates/docs/tests in the same change and produce a clear migration error for removed mode names.

- [Risk] Auto-mode quality heuristics may be unstable if we keep them implicit.  
  → Mitigation: encode auto-mode thresholds and merge rules in tests and backend metadata.

- [Risk] We remove ChromaDB before the replacement proves equivalent workflow coverage.  
  → Mitigation: treat Chroma removal as the last step, gated on an explicit verification matrix and real local workflow evidence.

## Migration Plan

1. Add the new backend contract and implement `MiniSearch`-based full-text backend.
2. Keep `uFuzzy` as the explicit fuzzy backend while demoting it from the default runtime path.
3. Add `sqlite-vec` as the explicit `vector` backend prototype.
4. Introduce backend-neutral persisted index state under `assets/search/`.
5. Update content mutation flows to invalidate/rebuild via the new index-state law.
6. Update CLI mode parsing, help text, templates, and generated docs.
7. Run a replacement verification matrix that covers unit behavior, index lifecycle, Context7 refresh, user content mutation, full-text quality, and vector-mode quality.
8. Remove ChromaDB from the required/default runtime path only after that matrix passes.
9. Delete backend-specific folders/docs/tests that no longer apply.
10. Run OpenSpec validation, typecheck, unit/integration tests, and a real end-to-end skill creation/search verification.

Rollback strategy:

- Since this is primarily a local CLI/runtime change, rollback is a normal package revert.
- Persisted search artifacts remain isolated under skill-local `assets/search/`, so rollback does not require shared service cleanup.

## Open Questions

- Does shipping `vector` mode require raising the supported Node runtime floor, or do we constrain it behind a runtime capability check first?
- Do we want SQLite FTS5 documented in this same change as a future backend target, or keep that as a later follow-up once `sqlite-vec` usage stabilizes?
