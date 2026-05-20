# Search Tech Evaluation Demo

This demo replays the project's real search runtime against the same query set
across multiple backends.

Current backends:

- `fuzzy`
- `fulltext`
- `vector`
- `auto`

## Run

```bash
pnpm demo:search-tech-eval
```

Run against a real local skill corpus:

```bash
pnpm demo:search-tech-eval -- --skill-path /Users/kzf/.claude/skills/acp
```

Artifacts are written to:

- `demo/.tmp/search-tech-eval/demo-static-corpus/report.json`
- `demo/.tmp/search-tech-eval/acp-real-skill/report.json`
- `demo/.tmp/search-tech-eval/<profile>/<backend>/...`

## What this validates

- the benchmark exercises the same runtime adapters used by `search-skill`
- backend-specific index artifacts stay isolated per profile/backend run
- real-skill query expectations can be replayed as a regression harness
- `auto` can be compared directly against `fulltext`, `fuzzy`, and `vector`

## Notes

- The first run may spend extra time initializing the local embedding model.
- This is now a runtime-aligned benchmark harness rather than a separate search prototype.
