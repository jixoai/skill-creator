## ADDED Requirements

### Requirement: Bilingual message catalogs with English source of truth

The WebUI MUST serve all user-visible copy (text, aria-label, title,
placeholder) through a typed message catalog with `en` as the key source of
truth and a `zh` catalog whose key set is compile-time enforced to match `en`
exactly. Components MUST NOT carry bare English (or Chinese) user-facing
literals; copy lives in the catalogs and is consumed via the `t(key, params)`
API. Command tokens (`/compact`, `/queue`, `/steer`), trigger characters
(`$`, `@`, `/`), code identifiers, and route/nav proper nouns (Workspaces,
Creator, Repository, Wiki) MUST NOT be translated.

#### Scenario: catalog completeness is enforced

- **WHEN** a message key exists in the `en` catalog but is missing from `zh`
  (or vice versa)
- **THEN** `pnpm --dir webui check` fails (type error), and the runtime
  key-set parity test also fails

#### Scenario: interpolation

- **WHEN** a message value contains `{param}` placeholders and `t` is called
  with matching params
- **THEN** the placeholders are substituted with the param values; unsubstituted
  placeholders remain visible verbatim (no silent swallowing)

### Requirement: Locale persistence and document language sync

The active locale MUST default to `en`, persist in DevicePrefs under a
`language` field (device-preference storage, same store as theme), and survive
incompatible persisted state by falling back to the default. Changing the
locale MUST take effect without a page reload (reactive store) and MUST keep
`document.documentElement.lang` in sync with the active locale.

#### Scenario: switch locale without reload

- **WHEN** the locale changes from `en` to `zh` at runtime
- **THEN** rendered copy in mounted components updates reactively without a
  navigation or reload, DevicePrefs persists `language: "zh"`, and
  `document.documentElement.lang` reports `zh`

#### Scenario: incompatible persisted language

- **WHEN** persisted DevicePrefs carries a `language` value outside
  `["en", "zh"]` (or the payload fails the current schema)
- **THEN** the store loads defaults (`en`) per the incompatible-persisted-state
  rule and does not write back during load

### Requirement: Test-anchored copy stays byte-stable in English

Component tests and smoke tests assert English copy under the default locale;
the `en` catalog values for asserted strings (including the WorkspacesHome
`skills across {n} agent locations` smoke anchor and the SkillMenu empty-state
placeholder) MUST remain byte-identical to the pre-i18n literals unless the
asserting test is updated in the same change. New locale-sensitive tests MUST
set the locale explicitly and restore it afterwards.

#### Scenario: existing tests pass unmodified after migration

- **WHEN** an A-class surface is migrated to the catalogs
- **THEN** that surface's existing component tests pass without assertion
  edits, because the `en` catalog reproduces the prior literals verbatim

### Requirement: Classification-gated adoption across IA tracks

Surfaces are adopted by class: A-class (IA-untouched) surfaces migrate
immediately; B-class (IA-refactoring) surfaces MUST NOT have their copy
structure changed before the IA refactor lands, then migrate under the shared
conventions; C-class (IA-new) surfaces MUST be born consuming the catalogs.
shadcn-svelte generated primitives (`components/ui/**`) MUST NOT be hand-edited
for i18n — copy injection happens through wrappers or catalog parameters, and
unreachable primitives are recorded as SKIP.

#### Scenario: B-class surface checkpoint

- **WHEN** the IA refactor of a B-class surface (shell, workspaces, creator,
  repository, settings manifest, eval-view, import-workspace-dialog) lands
- **THEN** a follow-up change migrates that surface's copy under the catalog
  conventions before the surface is considered i18n-complete

#### Scenario: C-class surface is born bilingual

- **WHEN** a new IA surface (dashboard, skills agent page, evaluating,
  terminal, omnibox) is created
- **THEN** its user-visible copy is authored in the catalogs from the first
  commit, with no bare literals
