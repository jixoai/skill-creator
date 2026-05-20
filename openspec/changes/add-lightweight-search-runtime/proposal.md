## Why

The current search path is coupled to ChromaDB server startup, embedding infrastructure, and backend-specific CLI semantics. That makes `skill-creator` heavier than the problem requires, even though the actual search domain is local markdown slices and user notes.

This change establishes a stricter platform law: skill search MUST be local, lightweight, and backend-swappable. We need that law now before more templates, commands, and tests bake Chroma-specific assumptions deeper into the system.

## What Changes

- Introduce an explicit search backend contract for indexing, querying, clearing, stats, and backend metadata.
- Replace ChromaDB as the required/default search runtime with a lightweight in-process full-text backend that persists skill-local index artifacts.
- Introduce an explicit `vector` mode backed by SQLite vector search as a formal candidate backend, separate from the default full-text path.
- **BREAKING** Rename public search modes from backend-coupled names to behavior/capability-coupled names. The stable public modes become `auto`, `fulltext`, `fuzzy`, and `vector`.
- The CLI SHALL keep `--mode=chroma` only as an undocumented legacy alias for `--mode=vector`, not as a stable public contract.
- Add deterministic index lifecycle rules based on reference content hash and backend metadata.
- Gate actual ChromaDB removal on validated replacement coverage across unit, integration, and end-to-end search workflows.
- Update generated skill structure, CLI help, templates, docs, and tests to reflect a backend-neutral search runtime.

## Capabilities

### New Capabilities
- `skill-search-runtime`: Define the backend contract, the default lightweight full-text runtime, behavior-based search modes, and provenance-aware result ordering.
- `skill-search-index-lifecycle`: Define how search indexes are stored, invalidated, rebuilt, and reused from skill-local assets.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/core/*search*`, `src/commands/searchContent.ts`, `src/commands/downloadContext7.ts`, `src/commands/removeContext7.ts`, `src/core/contentManager.ts`, `src/cli.ts`, `src/core/skillCreator.ts`
- Affected generated outputs: `templates/SKILL.md`, `templates/SKILL.zh-CN.md`, `templates/skill-creator.md`, `templates/skill-creator.zh-CN.md`
- Affected tests: unit tests for search/content management, integration tests for end-to-end skill creation/search, template-contract tests
- Dependency impact: remove required ChromaDB runtime from the default path; add a lightweight full-text library for persisted in-process indexing; evaluate SQLite vector runtime and local embedding integration for `vector` mode
