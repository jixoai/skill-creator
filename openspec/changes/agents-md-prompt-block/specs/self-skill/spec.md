# self-skill 变更（增量：setup 注入 ~/.agents/AGENTS.md 引导块）

## ADDED Requirements

### Requirement: setup maintains an agents-md guidance block

`skill-creator setup` MUST ensure a `<skill-creator-v2>…</skill-creator-v2>` managed
block exists in `~/.agents/AGENTS.md` (derived from the isolated global root) and
MUST keep its content equal to the product-owned guidance text, without ever
modifying anything outside the tag pair. Failures MUST NOT abort the rest of setup.

#### Scenario: fresh file

- **WHEN** the AGENTS.md file does not exist
- **THEN** setup creates it containing only the managed block

#### Scenario: append to an existing blockless file

- **WHEN** the file exists without the block
- **THEN** setup appends the block at the end and leaves the existing content
  byte-identical

#### Scenario: refresh a diverged block

- **WHEN** the block exists with outdated or user-edited content
- **THEN** setup replaces only the text between the tags; content before and after
  the block is preserved byte-identically

#### Scenario: unterminated tag

- **WHEN** an opening tag exists without its closing tag
- **THEN** setup reports a typed failure and writes nothing (no nested double block)

#### Scenario: daemon start does not touch agents-md

- **WHEN** the daemon production entry runs its self-skill ensure
- **THEN** ~/.agents/AGENTS.md is not modified (injection is setup-only)
