export interface DemoDocument {
  id: string
  title: string
  content: string
  source: 'user' | 'context7'
  filePath: string
}

export interface DemoQueryExpectation {
  query: string
  expectedTopId: string
  note: string
}

export const demoDocuments: DemoDocument[] = [
  {
    id: 'user/zod-safe-parse.md',
    title: 'Zod safeParse pattern',
    source: 'user',
    filePath: 'assets/references/user/zod-safe-parse.md',
    content: `Use safeParse when validating untrusted input in CLI workflows.
safeParse returns a discriminated union instead of throwing, which is easier to compose in automation.
Prefer narrowing on success before writing files or mutating index state.`,
  },
  {
    id: 'context7/zod-parse.md',
    title: 'Zod parse basics',
    source: 'context7',
    filePath: 'assets/references/context7/zod/parse-basics.md',
    content: `parse validates input and throws on failure. Use parse when exceptions are acceptable.
Schemas define the contract for strings, numbers, objects, and nested validation.`,
  },
  {
    id: 'user/minisearch-runtime.md',
    title: 'MiniSearch runtime notes',
    source: 'user',
    filePath: 'assets/references/user/minisearch-runtime.md',
    content: `MiniSearch is a lightweight in-process full-text engine. It supports field boosting,
prefix matching, fuzzy search, and serialized indexes without needing a local service.`,
  },
  {
    id: 'context7/chroma-overview.md',
    title: 'ChromaDB overview',
    source: 'context7',
    filePath: 'assets/references/context7/chroma/overview.md',
    content: `ChromaDB provides embedding collections and vector search. In local tooling it often
requires collection setup, embedding generation, and runtime service coordination.`,
  },
  {
    id: 'user/sqlite-vec-loading.md',
    title: 'sqlite-vec extension loading',
    source: 'user',
    filePath: 'assets/references/user/sqlite-vec-loading.md',
    content: `sqlite-vec loads as a SQLite extension and can be used with node:sqlite.
After enabling extension loading, load vec0 and create virtual tables for vector search.`,
  },
  {
    id: 'context7/context7-download.md',
    title: 'Context7 sliced reference downloads',
    source: 'context7',
    filePath: 'assets/references/context7/context7/download.md',
    content: `download-context7 fetches llms.txt content and slices it into markdown knowledge chunks.
Search systems must rebuild or invalidate indexes when these slices change.`,
  },
]

export const demoQueries: DemoQueryExpectation[] = [
  {
    query: 'safeParse untrusted input validation',
    expectedTopId: 'user/zod-safe-parse.md',
    note: 'User-authored operational guidance should outrank generic parse docs.',
  },
  {
    query: 'lightweight in-process full-text engine with prefix matching',
    expectedTopId: 'user/minisearch-runtime.md',
    note: 'Full-text runtime language should favor MiniSearch notes.',
  },
  {
    query: 'sqlite extension load vec0 with node sqlite',
    expectedTopId: 'user/sqlite-vec-loading.md',
    note: 'Vector backend operational instructions should remain searchable.',
  },
  {
    query: 'rebuild indexes when context7 slices change',
    expectedTopId: 'context7/context7-download.md',
    note: 'Index lifecycle text should be recoverable from the sliced corpus.',
  },
]
