# self-skill 变更（增量：产品自描述技能自举）

## Purpose

Define the product's self-describing skill bootstrap: on production daemon start, Skill Creator provides a `skill-creator-v2` skill in the community global skills root so any agent on the machine can learn to manage and search skills through Skill Creator, and the product's own embedded agent consumes the same document instead of a prompt-embedded copy.

## ADDED Requirements

### Requirement: Production start ensures the self skill

The production daemon entry MUST ensure the product-owned skill document exists at `<agents skills root>/skill-creator-v2/SKILL.md` before serving, and MUST NOT let bootstrap IO failures prevent daemon startup.

#### Scenario: fresh machine

- **WHEN** the production daemon starts and the skill file does not exist
- **THEN** the daemon atomically writes `SKILL.md` (with ownership markers) and `references/tools.md`

#### Scenario: user disabled the skill

- **WHEN** `SKILL.md` is absent but the product disable marker `.SKILL.md` exists in the skill directory
- **THEN** bootstrap writes nothing (the disable decision survives restarts)

#### Scenario: bootstrap IO failure

- **WHEN** the global skills root is unreadable or unwritable
- **THEN** the daemon logs the typed failure and continues startup

#### Scenario: development runtime isolation

- **WHEN** the dev daemon (`src/daemon/dev.ts`) starts
- **THEN** no file under the user's real global skills root is written by bootstrap

### Requirement: Bootstrap never clobbers user content

The bootstrap MUST only overwrite files it owns, identified by frontmatter ownership markers, and MUST skip foreign or same-version documents.

#### Scenario: foreign file

- **WHEN** `SKILL.md` exists without the product ownership marker or with unparsable frontmatter
- **THEN** bootstrap writes nothing

#### Scenario: same-version user edits

- **WHEN** the file carries the current managed version (regardless of body edits)
- **THEN** bootstrap writes nothing

#### Scenario: older managed version

- **WHEN** the file carries `x-managed-by: skill-creator` with an older `x-managed-version`
- **THEN** bootstrap rewrites the document set (`SKILL.md` + `references/tools.md`) atomically

### Requirement: The self skill is discoverable as a normal skill

The written document MUST satisfy the skill discovery/validation rules (frontmatter `name` matching the directory name, non-empty description, passthrough of extra keys) so it appears in global provider discovery and the product's own search index without special-casing.

#### Scenario: search round trip

- **WHEN** the skill search index is built over roots containing the self skill
- **THEN** querying for `skill-creator` returns the self skill like any other canonical skill

### Requirement: Product prompt points to the self skill

The product agent prompt section MUST NOT embed the capability usage guide; it MUST direct the agent to read the global `skill-creator-v2` skill through the skill-creator MCP read tools and keep only session-specific conventions inline.

#### Scenario: pointer recipe present

- **WHEN** the product prompt section is rendered
- **THEN** it instructs locating the skill via `skills_search` and reading it via `skills_info`, and contains no inlined tool-catalog enumeration
