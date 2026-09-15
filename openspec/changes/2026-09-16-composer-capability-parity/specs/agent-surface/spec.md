## ADDED Requirements

### Requirement: composer editor core matches the official input surface semantics

The Agent Chat composer MUST provide a rich editing surface whose observable semantics match the official webui input box: multi-line editing with unconditional Shift+Enter line breaks, IME-safe submission (composition-closing Enter neither submits nor breaks), undo history cut after a successful send, and paste sanitization that strips reference placeholder characters from all external text.

#### Scenario: IME composition Enter is inert

- **WHEN** the user presses Enter while composing (isComposing, keyCode 229, or within the 10ms post-compositionend window)
- **THEN** the draft is neither submitted nor line-broken
- **AND** no placeholder is rendered during composition.

#### Scenario: undo cannot resurrect sent content

- **WHEN** a send succeeds and the user presses Ctrl/Cmd+Z
- **THEN** the committed prefix does not return
- **AND** a pure suffix typed during the host round-trip is retained.

#### Scenario: placeholder chain

- **WHEN** draft, attachments and claim are all empty
- **THEN** the placeholder follows the priority chain: owner override > disconnected > unavailable > queue hint > mode-specific > default
- **AND** the same text is exposed as the accessible label.

### Requirement: composer attachments are gated and recoverable

Attachment intake MUST enforce host-projected limits (count/size/total/media types) with whole-batch refusal; a document-level drag-and-drop overlay MUST cover the window during file drags; submission MUST wait while any attachment is uploading or failed (with retry/remove affordances); an empty draft with attachments MUST submit an attachment-only message; failed sends MUST restore drafts in submission order and return attachments to the head of the rail.

#### Scenario: over-limit batch refused whole

- **WHEN** a picked batch violates the projected image limits
- **THEN** no item of the batch enters the rail and a single reason-keyed notice is shown.

#### Scenario: upload-gated send

- **WHEN** the user presses Enter while a file attachment is uploading or failed
- **THEN** submission is held with a still-uploading notice
- **AND** the draft and attachments are retained.

### Requirement: trigger pipeline provides command claims and reference chips

The composer MUST run the official trigger grammar: `/` opens at start/whitespace/punctuation with URL carve-outs and claims commands (claimed phase suppresses `/` triggers and strips the token's args at submit); `/` skills land as plain text with lexicon decoration and click-to-preview; `@` inserts atomic reference chips for files and sessions, drills directories in place with breadcrumbs, and accepts quoted paths; a programmatic `+` launcher opens the command menu without typing a trigger.

#### Scenario: command claim round-trip

- **WHEN** a user picks a host input-taking command and submits with args
- **THEN** the claimed token is stripped from the submitted text and the command executes with its arguments
- **AND** Escape does not release a claim — only backspacing the token does.

#### Scenario: reference chip is atomic and blocking

- **WHEN** a draft contains a chip whose owner resolution failed
- **THEN** the chip renders a failure treatment and blocks submission
- **AND** copy/persistence see the chip's clipboard projection.

### Requirement: submission supports queue and steer with durable preference

Enter and the Send button MUST resolve to the configured busy-Enter preference (queue or steer) while a turn is running; Cmd/Ctrl+Enter MUST use the opposite; a held Enter (event.repeat) MUST NOT repeat-send; queued rows MUST be editable, removable and steerable in a queue dock; an empty-draft Cmd/Ctrl+Enter MUST steer the whole queue; drafts MUST persist per session and carry over on session switches; failed sends MUST keep their snapshot for restore.

#### Scenario: busy-Enter preference drives gesture

- **WHEN** the session is running and the user presses plain Enter with an actionable draft
- **THEN** the gesture resolves to the durable busy-Enter preference and the primary button label names the resolved mode
- **AND** Cmd/Ctrl+Enter takes the opposite path.

#### Scenario: optimistic echo retires on durable event

- **WHEN** a submission is accepted locally
- **THEN** a pending echo renders immediately and retires when the durable user message or queue event arrives
- **AND** a failed send restores the draft and attachments without duplicate echoes.

### Requirement: composer states and seats stay live per the official block model

The composer MUST render locked/read-only states (session removed, no workspace, adjudicating/submitting) while keeping the model seat live; transient notices MUST anchor to the composer card with identical-repeat restart; the context meter MUST render only when the host reports pressure and capacity.

#### Scenario: adjudicating is read-only

- **WHEN** a trigger adjudication or submission is in flight
- **THEN** the draft stays visible and read-only
- **AND** the model picker remains interactive.
