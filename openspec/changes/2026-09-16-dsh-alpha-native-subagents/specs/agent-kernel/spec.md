## ADDED Requirements

### Requirement: the kernel rides official native subagents for delegation

The product kernel MUST compose the official `@deepseek-ai/dsh-tool-subagent` rows for its Roles instead of a product-side session bridge. Each role is one configured row with a unique model-facing tool name, a `spawn` provider, continuable background mode, a versioned persona section, a structural tool filter, and a bounded depth. Role tool names MUST pass the per-mode product allowlist before the model can call them; sessions in focused modes MUST only see the roles their mode lists.

#### Scenario: role row activates at boot

- **WHEN** the kernel boots with the role catalog
- **THEN** every role's tool-subagent row is active with its distinct tool name
- **AND** a misconfigured row fails the boot activation assertion rather than degrading silently.

#### Scenario: focused mode gates roles

- **WHEN** a focused-mode session requests a role tool not listed for that mode
- **THEN** the call is denied with an audit record
- **AND** the free mode exposes the full role catalog.

### Requirement: subagent children are structurally narrowed and never ask the user

Role subagents MUST be restricted to their declared tool filter at the child-session creation window (hidden and refused, not prompt-only). Every role tool filter MUST deny `ask_user_question` because the panel's user-question answerer binds only the parent context. Child-originated mutations MUST still produce proposals through the human approval chain.

#### Scenario: outside-filter tool is refused structurally

- **WHEN** a role child attempts a tool outside its filter
- **THEN** the tool is neither listed nor executable in the child session
- **AND** the attempt surfaces as a typed refusal, not an approval prompt.

### Requirement: subagent lifecycle is visible and bounded

Subagent children MUST NOT appear in the panel session list (origin `subagent` filtered). Child activity MUST project onto the parent track as subagent frames (spawn, descriptor, catalog, settlement) with child transcripts inspectable. Kernel dispose MUST drain continuable descendants within a bounded window leaving no orphan children.

#### Scenario: settlement returns to the parent transcript

- **WHEN** a continuable role child settles
- **THEN** the parent transcript receives the settlement notice on its next turn
- **AND** the panel shows the subagent frame with the result summary.

#### Scenario: dispose drains children

- **WHEN** the kernel disposes while role children are live
- **THEN** descendants are drained within the bounded teardown window
- **AND** no child process or session survives the kernel handle.

## MODIFIED Requirements

### Requirement: kernel capability handshake is versioned

The kernel composition MUST pin the DSH package matrix at `0.1.6-alpha.1` audited against official commit `0a15e36e`; drift MUST degrade to typed unavailable with a recovery hint rather than undefined behavior.

#### Scenario: version drift

- **WHEN** an installed DSH package no longer satisfies the locked matrix
- **THEN** boot reports the offending package/version and the daemon continues Manager-only.
