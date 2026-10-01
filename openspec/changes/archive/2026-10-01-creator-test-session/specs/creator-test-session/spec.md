# creator-test-session 增量

## ADDED Requirements

### Requirement: Creator Test seeds a reference-carrying agent session

The Creator Test subview MUST seed an Agent panel session through a single
product-owned entry that writes the probe text, registers exactly one skill
`ComposerReference` carrying the full `{workspaceId, providerId, skillId}`
triple, and records the probe template id and version with the session
transcript. The seed MUST NOT auto-send; the user submits explicitly. A
not-yet-saved draft (no stable skill id) MUST render a save-first empty state
instead of constructing a temporary identity.

#### Scenario: prompt payload carries the opaque triple

- **WHEN** the user submits a seeded test run
- **THEN** the `agent.session.prompt` payload contains a skill reference with
  the full `{workspaceId, providerId, skillId}` triple
- **AND** the transcript contains the daemon-expanded `[reference: skill …]`
  block

#### Scenario: probe is reproducible

- **WHEN** a test run is seeded from the product template
- **THEN** the template id (`probe-recall-v1`) and version are recorded in the
  session's test-run metadata together with the target skill revision
- **AND** the user may edit the final prompt text before submitting

#### Scenario: unsaved draft cannot test

- **WHEN** the Creator is in `new` mode without a saved skill
- **THEN** the Test subview shows a save-first state with a save entry point
  and performs no seeding
