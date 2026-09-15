# agent-surface Specification

## Purpose

Skill Creator shell 内的 Agent 面板与能力供给面：shell 级 drawer、MCP 能力工具、
ui:// 视觉卡与 Manager authority 红线（mutation 产 proposal 待人工审批）。

## Requirements

### Requirement: Skill Creator shell is the sole product host

The Skill Creator shell (ChromeTabs apps + OpenTray window) MUST be the only production host and entry. The Agent surface MUST live inside this shell; no second window, iframe, or DSH-hosted page may serve as the product boundary.

#### Scenario: single entry

- **WHEN** a user opens the daemon WebUI
- **THEN** the Skill Creator shell loads directly with the Agent panel available in-shell
- **AND** no DSH web handshake, plugin boot, or island channel is required to reach product features.

### Requirement: agent panel is a first-class in-shell surface

The Agent panel MUST provide session list/switching, conversation stream with expandable tool rows, approval request cards, terminal narratives, and model/preset/permission configuration projection. It MUST survive tab navigation, degrade visibly on disconnect, and avoid stale projections after scope switches.

#### Scenario: conversation with tool round

- **WHEN** a session produces agent messages and tool calls
- **THEN** the panel renders ordered events with tool rows whose inputs/results are inspectable
- **AND** approval-requiring calls surface as decision cards routed to the Manager approval chain.

#### Scenario: narrow viewport

- **WHEN** the window is 680px wide
- **THEN** the panel switches to a single-screen overlay mode without horizontal overflow.

### Requirement: capabilities are served over MCP via the official bridge

Skill Creator domain capabilities MUST be declared in one capability layer (name, Zod input/output, handler, authority class) and exposed by the skill-creator-mcp MCP server. In-shell agent sessions MUST consume them through the official `@deepseek-ai/dsh-mcp-client` plugin composed into the kernel; external MCP clients use the same server. No bespoke tool-projection bridge may be interposed.

#### Scenario: in-shell consumption through the official bridge

- **WHEN** an agent session calls a Skill Creator capability
- **THEN** the call travels the MCP path via dsh-mcp-client and executes through the capability layer with the declared authority class enforced.

#### Scenario: external MCP client via the daemon endpoint

- **WHEN** an external MCP client connects to the daemon `/mcp` endpoint
- **THEN** it receives the full capability set with schema-faithful descriptors
- **AND** mutating capabilities produce proposals for Manager approval instead of direct writes.

#### Scenario: external MCP client via standalone stdio

- **WHEN** an external MCP client spawns `skill-creator mcp` (stdio)
- **THEN** it receives the first-phase standalone subset: readonly plus propose capabilities
- **AND** proposals created in this form are returned to the client for its own handling rather than persisted to Manager storage; the full set awaits a cross-process single-writer protocol in a later change.

### Requirement: agent output uses MCP Apps cards when guided

The system prompt MUST include versioned best-practice guidance telling the agent when to answer with MCP Apps cards (`ui://` HTML resources) instead of plain text. The panel MUST render such cards per the MCP Apps specification (sandboxed iframe, postMessage JSON-RPC) and translate in-card navigation intents into shell routes.

#### Scenario: card-worthy answer

- **WHEN** the agent presents a skill, finding, proposal, or install/update result in a session
- **THEN** guided output carries the `ui://` card resource and the panel renders it with in-app navigation
- **AND** the same resource remains protocol-valid for any MCP Apps capable host.

### Requirement: MCP exposure keeps Manager authority

The MCP surface MUST NOT bypass Manager authority: loopback-only HTTP with daemon token auth, stdio only for explicit local launch, and every mutation routed through the proposal/approval/audit chain.

#### Scenario: external MCP mutation request

- **WHEN** an external client invokes a mutating capability over MCP
- **THEN** the result is a proposal awaiting human approval with audit records
- **AND** no filesystem write occurs outside the Manager-owned transaction path.

### Requirement: hosted-DSH product path is retired

After this change, the DSH web-hosted product path (web composition host, entry handshake bridge, Manager island channel, vendored client plugin) MUST be removed from the product and from the shipped package; kernel-side assets (version lock, heal, lifecycle) remain.

#### Scenario: package contents

- **WHEN** the production package is packed
- **THEN** it contains no dsh-client plugin vendor directory and no web-composition dependencies
- **AND** the clean-install drill boots the kernel form with the in-shell Agent panel.

### Requirement: agent settings panel edits model configuration and credentials

设置面板 MUST 以分区表单承载模型配置：provider、model、可选 reasoningEffort 构成
ModelSelection 形状；provider 凭据为只写输入（存/清），视图永不回显凭据值，只回
configured 状态。全部写入经 `agent.settings.update` / `agent.credentials.*` RPC，
服务端 revision 与跨字段校验（live preset ↔ 凭据）裁决冲突。

#### Scenario: 编辑模型并保存

- **WHEN** 用户修改 provider/model/effort 并保存
- **THEN** `agent.settings.update` 收到 model 补丁；成功后视图刷新为新 revision
- **AND** live preset 下切换到无凭据 provider 返回 `MODEL_PROVIDER_WITHOUT_CREDENTIAL`
  typed rejection，面板显示 code，不落任何写

#### Scenario: 写入与清除凭据

- **WHEN** 用户在 provider 行输入 API key 保存，随后清除
- **THEN** key 经 `agent.credentials.set` 落 0600 私有存储；重载视图只显示
  configured 徽章；清除后徽章消失，凭据值任何时刻不出现在响应里

### Requirement: agent panel exposes four switchable modes

面板 MUST 提供 create/manage/explore/free 四种模式：设置面选择新会话默认模式；面板 header
的模式 chip 切换当前会话模式；`mode-changed` 帧以分隔行渲染。free 模式在 UI 上明示
token 成本更高。

#### Scenario: 新会话继承默认模式

- **WHEN** settings.defaultMode = manage 且用户新建会话
- **THEN** 会话摘要的 mode 为 manage，内核 setup 注入 manage 专有 prompt section

#### Scenario: 会话内切换模式

- **WHEN** 会话 idle 且用户把模式从 create 切到 explore
- **THEN** `agent.session.setMode` 持久化 mode、当前 live 句柄被释放、对话流出现
  `mode-changed` 分隔行；下一次 prompt 以 explore 模式复活（历史保留）

#### Scenario: 运行中拒绝切换

- **WHEN** 会话 status = running 且用户尝试切换模式
- **THEN** 返回 typed rejection，模式不变，UI 提示稍后重试

### Requirement: Model configuration is a RouteTabs surface

Settings → Model MUST present model routes as tabs, one route per tab, with a single NewTab entry unifying provider presets and custom endpoints (a preset is a prefill of the same form, never a runtime category). Each tab is a self-contained unit (identity/icon, credential, endpoint, models, remove; the Active-model block was removed by user decree [2026-09-12] — the active model's only switch surface is the composer runtime dropdown); edits in one tab MUST NOT touch another tab's fields. The tab strip MUST surface per-route key status (amber dot when missing), the active route (primary underline), an amber chip when the active model dangles outside configured routes, and local "Your presets" (prefill packs stored browser-side, never runtime config).

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

Attachment intake MUST enforce channel limits (count/size/media types) with whole-batch refusal; a document-level drag-and-drop overlay MUST cover the window during file drags; submission MUST wait while any attachment read is in flight; an empty draft with attachments MUST submit an attachment-only message; failed sends MUST keep the draft snapshot for retry.

#### Scenario: over-limit batch refused whole

- **WHEN** a picked batch violates the channel limits
- **THEN** no item of the batch enters the rail and a single reason-keyed notice is shown.

#### Scenario: read-gated send

- **WHEN** the user presses Enter while an attachment read is in flight
- **THEN** submission is held with a still-reading notice
- **AND** the draft and attachments are retained.

### Requirement: trigger pipeline provides command claims and a unified slash directory

The composer MUST run the official trigger grammar: `/` opens at start/whitespace/punctuation with URL carve-outs and claims input-taking commands (claimed phase suppresses the `/` trigger and strips the token's args at submit); `/` skills land as plain text; a programmatic `+` launcher opens the directory without typing a trigger; a durable busy-Enter preference resolves gestures while a turn runs.

#### Scenario: command claim round-trip

- **WHEN** a user picks an input-taking command and submits with args
- **THEN** the claimed token is stripped from the submitted text and the command executes with its arguments
- **AND** Escape does not release a claim — only backspacing the token does.

#### Scenario: URL carve-outs

- **WHEN** the first line begins with `//` (protocol-relative) or the trigger position carries a `://` scheme
- **THEN** the trigger menu does not open.

### Requirement: submission supports queue and steer with durable preference

Enter and the primary button MUST resolve to the configured busy-Enter preference (queue or steer) while a turn is running; Cmd/Ctrl+Enter MUST use the opposite; queued rows MUST be visible in a dock that retires each row when its durable user message frame lands; drafts MUST persist per session across reloads; stopping MUST leave the queue alive to resume FIFO.

#### Scenario: busy-Enter preference drives gesture

- **WHEN** the session is running and the user presses plain Enter with an actionable draft
- **THEN** the gesture resolves to the durable busy-Enter preference and the primary button names the resolved mode
- **AND** Cmd/Ctrl+Enter takes the opposite path.

#### Scenario: queued row retires on arrival

- **WHEN** a message queued while running becomes the next turn
- **THEN** its dock row retires as its durable user message frame arrives
- **AND** a failed send retires its row while keeping the draft for retry.

### Requirement: composer states and seats stay live per the official block model

The composer MUST render locked/read-only states (session removed, disconnected, adjudicating) while keeping the model seat live; transient notices MUST anchor with identical-repeat restart; the context meter MUST render only when the host reports pressure and capacity.

#### Scenario: adjudicating is read-only

- **WHEN** a trigger adjudication or submission is in flight
- **THEN** the draft stays visible and read-only
- **AND** the model picker remains interactive.
