# agent-surface 变更（redesign-model-tabs-and-agent-panel）

## ADDED Requirements

### Requirement: Model configuration is a RouteTabs surface

Settings → Model MUST present model routes as tabs, one route per tab, with a single NewTab entry unifying provider presets and custom endpoints (a preset is a prefill of the same form, never a runtime category). Each tab is a self-contained unit (identity/icon, credential, endpoint, models, active selection, remove); edits in one tab MUST NOT touch another tab's fields. The tab strip MUST surface per-route key status (amber dot when missing), the active route (primary underline), an amber chip when the active model dangles outside configured routes, and local "Your presets" (prefill packs stored browser-side, never runtime config).

#### Scenario: add route from a provider preset

- **WHEN** the user opens NewTab, picks a catalog provider card, and confirms
- **THEN** the form is prefilled from the preset, the new tab is selected and scrolled into view, and the credential box opens focused with guidance to paste the API key

#### Scenario: custom endpoint is the same journey

- **WHEN** the user starts from scratch and fills name, http(s) base URL, and at least one model id (Enter commits a tag chip)
- **THEN** Add route enables and the result is indistinguishable from a preset-derived route

#### Scenario: active model outside tabs

- **WHEN** settings.model references a provider with no configured route (e.g. env-injected)
- **THEN** the tab strip shows an amber "active outside tabs" chip that links to NewTab prefilled with that provider, and the composer model chip renders amber

### Requirement: Agent panel conversation follows the dsh-webui disclosure grammar

The panel transcript MUST use one disclosure-row grammar for collapsible content (thinking, merged tool rows, tasks dock): 24px rows with icon + title + truncated summary, chevron on hover, 16px vertical rhythm. Assistant messages render full-width markdown without bubbles; user messages render right-aligned rounded bubbles with attachments above and hover actions below. Running state is expressed only by the sweep affordance (no spinners); each turn ends with a usage pill (↑ in / ↓ out / elapsed). Mode switches render as centered dividers using mode labels (never raw ids).

#### Scenario: tool round with todos

- **WHEN** a turn emits thinking, a todo_write call, and a bash call
- **THEN** each renders as a collapsed disclosure row with a derived summary (todos show counts, bash shows description or command first line), and the tasks dock reflects the latest todo snapshot with three-state counts

#### Scenario: edit and resend

- **WHEN** the user invokes edit on a sent user message and resends
- **THEN** the composer enters an amber-noted editing state, sending appends a new message (history preserved), and both states are announced via tooltip/aria-label

### Requirement: Composer is a single card with mode, model, and context affordances

The composer MUST be one rounded card (attachments strip, autogrowing textarea, toolbar). The toolbar hosts the mode chip, image/file attach buttons, a read-only-anchored model chip, a context meter, and a 34px round primary button with the send/stop state machine. The model chip MUST offer a routes-grouped dropdown that hot-switches the active model by writing only `settings.model` (never route configuration; route edits remain exclusively in Settings → Model per PRODUCT_MODEL §5); the dropdown marks the current entry, degrades dangling entries to amber, and disables while a turn is running. The context meter MUST derive capacity from the active route's matching model contextWindow when known and mark the fallback (assumed 128k) in its popover.

#### Scenario: hot-switch the active model mid-session

- **WHEN** the user opens the model chip dropdown and selects a model from another route while idle
- **THEN** `settings.model` is updated through the settings mutation, the chip reflects the new provider · model, and no route field (endpoint, key, model list) is written

#### Scenario: running turn locks the switch

- **WHEN** a turn is running
- **THEN** the model dropdown is disabled with an explanatory title, and the primary button has entered the stop/queue state machine

#### Scenario: context capacity truth

- **WHEN** the active model's route carries a contextWindow (e.g. 204800) and the last usage reports input tokens
- **THEN** the ring ratio uses that capacity; when unknown, the popover shows the fallback value labeled as assumed
