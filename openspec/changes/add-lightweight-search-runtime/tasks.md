## 1. Search Runtime Law

- [x] 1.1 Define a backend-neutral search contract and remove command-layer backend introspection
- [x] 1.2 Implement the default in-process full-text backend on top of a lightweight library
- [x] 1.3 Keep `uFuzzy` as the explicit fuzzy backend and demote it from the default runtime path
- [x] 1.4 Rework `auto` mode to compose `fulltext` and `fuzzy` with explicit quality rules
- [x] 1.5 Add `sqlite-vec` as the explicit `vector` backend prototype
- [x] 1.6 Remove or isolate ChromaDB from the required/default runtime path

## 2. Index Lifecycle

- [x] 2.1 Introduce backend-neutral persisted index state under `assets/search/`
- [x] 2.2 Replace implicit hash-file invalidation with explicit index-state refresh rules
- [x] 2.3 Update content mutation commands to invalidate or rebuild index state deterministically
- [x] 2.4 Migrate generated skill structure away from backend-branded runtime directories

## 3. CLI and Generated Artifacts

- [x] 3.1 Rename public search modes to `auto`, `fulltext`, `fuzzy`, and `vector`
- [x] 3.2 Update CLI help, README, and generated skill templates to remove Chroma-specific language from the stable contract
- [x] 3.3 Implement `chroma` as an undocumented legacy alias to `vector` at the CLI boundary

## 4. Verification

- [x] 4.1 Add unit tests for backend contract, mode selection, and index freshness behavior
- [x] 4.2 Add end-to-end integration coverage for `download-context7`, persisted indexing, `search-skill`, and explicit `vector` mode
- [x] 4.3 Define and execute a replacement verification matrix comparing the new runtime against current ChromaDB-covered workflows
- [x] 4.4 Validate the local `sqlite-vec` + embedding runtime on supported Node/platform combinations
- [x] 4.5 Validate the change with `openspec validate`, typecheck, test suite, and a real local skill workflow before removing ChromaDB
