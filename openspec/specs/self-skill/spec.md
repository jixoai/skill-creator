# self-skill Specification

## Purpose
Define the product's self-describing skill bootstrap: on production daemon start, Skill Creator provides a `skill-creator-v2` skill in the community global skills root so any agent on the machine can learn to manage and search skills through Skill Creator, and the product's own embedded agent consumes the same document instead of a prompt-embedded copy.

## Requirements

### Requirement: Production start ensures the self skill

The production daemon entry MUST ensure `~/.agents/skills/skill-creator-v2` is a
symbolic link (directory symlink; junction on win32) to the skill directory bundled
inside the running skill-creator installation (`<pkgroot>/skills/skill-creator-v2`,
located by a `package.json` with name `skill-creator`; npm and git installations are
the same identity under this check). Bootstrap IO failures MUST NOT prevent daemon
startup.

#### Scenario: fresh machine

- **WHEN** the production daemon starts and the link path does not exist
- **THEN** the daemon creates the root directory if needed and links it to the
  bundled skill directory

#### Scenario: link points at another skill-creator installation

- **WHEN** the existing link resolves to a skill directory inside a different
  skill-creator installation (e.g. an older npx cache or global install)
- **THEN** bootstrap removes the link and recreates it pointing at the current
  installation's source

#### Scenario: dangling link

- **WHEN** the link target no longer exists (install evicted) and no user content
  can be lost
- **THEN** bootstrap replaces the link

#### Scenario: legacy v1 copy

- **WHEN** a real directory exists whose managed frontmatter marker identifies the
  copy-based bootstrap AND its document bytes match the current install's source
- **THEN** bootstrap replaces the directory with a link without a backup prompt
  (byte-identical product output); a marked but diverged directory surfaces as a
  `user-directory` conflict instead of being removed

#### Scenario: user disabled the skill

- **WHEN** the user attempts to disable the linked self skill through the product's
  toggle
- **THEN** the operation returns a typed conflict and the package source is never
  modified (renaming through the link would write outside the server-owned root;
  a linked entry's enable/disable is managed by the link itself)

#### Scenario: bootstrap IO failure

- **WHEN** the global skills root is unreadable or unwritable
- **THEN** the daemon logs the typed failure and continues startup

#### Scenario: development runtime isolation

- **WHEN** the dev daemon (`src/daemon/dev.ts`) starts
- **THEN** no file under the user's real global skills root is written by bootstrap

### Requirement: The self skill is discoverable as a normal skill

The linked skill MUST appear in the product's own discovery surfaces (skills.list /
counts / search) like any other skill in the global root, including through the
symlinked directory entry.

#### Scenario: ccski-based discovery through the symlink

- **WHEN** skills.list or workspace counts scan a root containing the symlinked
  self skill
- **THEN** the symlink entry is discovered (the ccski symlink-entry augmentation
  mirrors the customDir entry shape) and reported with the same scope metadata as a
  real directory skill; toggling it returns a typed conflict (the rename would
  pierce the link into the install's source tree)

#### Scenario: search round trip

- **WHEN** the skill search index is built over roots containing the self skill
- **THEN** querying for `skill-creator` returns the self skill like any other
  canonical skill

### Requirement: Product prompt points to the self skill

The product agent prompt section MUST NOT embed the capability usage guide; it MUST direct the agent to read the global `skill-creator-v2` skill through the skill-creator MCP read tools and keep only session-specific conventions inline.

#### Scenario: pointer recipe present

- **WHEN** the product prompt section is rendered
- **THEN** it instructs locating the skill via `skills_search` and reading it via `skills_info`, and contains no inlined tool-catalog enumeration

### Requirement: User-maintained entries become explicit conflicts

Bootstrap MUST NOT modify or delete an existing `skill-creator-v2` entry whose
origin is not a skill-creator installation (a user-maintained real directory, or a
link into user-owned space). Such an entry MUST be reported as a conflict and
MUST only change through an explicit user decision.

#### Scenario: user directory

- **WHEN** the entry is a real directory without the product marker
- **THEN** bootstrap changes nothing and reports a `user-directory` conflict

#### Scenario: foreign link

- **WHEN** the entry is a link whose target is not inside any skill-creator
  installation
- **THEN** bootstrap changes nothing (the target is never touched) and reports a
  `foreign-link` conflict

### Requirement: Conflicts are resolved by an explicit user decision

A detected conflict MUST be surfaced on both faces after startup (CLI start
notice — interactive when a TTY is present; WebUI home banner — the only visible
face for the TTY-less Dock cold-start vector) with the documented choices: install
the product version (optionally backing up the user directory to
`~/.agents/skills-backup/skill-creator-v2-YYYY-MM-DD-HH-mm-ss`), or keep the user's
version. Resolution and keep MUST go through server-owned logic shared by both
faces.

#### Scenario: overwrite with backup

- **WHEN** the user chooses install with backup for a user-directory conflict
- **THEN** the directory is moved to the timestamped backup path and the link is
  created

#### Scenario: keep is remembered

- **WHEN** the user chooses to keep their version
- **THEN** the decision is persisted with a fingerprint of the conflicting entry
  and subsequent starts stay silent while the entry is unchanged; a changed entry
  reminds again

#### Scenario: foreign link needs no backup

- **WHEN** the conflicting entry is a link into user-owned space
- **THEN** only the link is removed (backup applies to real directories whose
  content would otherwise be lost)
