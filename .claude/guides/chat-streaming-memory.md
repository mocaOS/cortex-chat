# Chat, streaming & memory — scoped guide

Owns: the SSE client contract, conversation memory, chat UX, souls (personalities), projects, voice.
Related gates: `tests/streaming-contract.test.ts` (the done→memory incident contract, framing, flags, shutdown resubmit, 429), `tests/negative-control-return-at-done.test.ts` (proves the gate rejects the pre-fix parser), `tests/rate-limit-message.test.ts`, `tests/cortex-analytics.test.ts`.
Canonical code: `src/lib/api.ts` (`askQuestionStream`), `src/app/page.tsx` (orchestration), `src/app/api/ask/stream/route.ts` (proxy).

## Conversation memory & streaming status

Both consume additive, backward-compatible features on `/api/ask/stream`. Parsing lives in `askQuestionStream` (`src/lib/api.ts`); orchestration in `src/app/page.tsx`.

- **Memory round-trip.** The client sends an **opaque** `conversation_memory` blob each turn (`{}` on turn 1), reads the updated blob from the `memory_update` SSE event, and replays it next turn. Never construct or mutate it — store and replay verbatim. Held in `memoryRef` (no stale closure / no re-render), persisted with messages.
- **Event order (backend v2, `EMIT_DONE_BEFORE_MEMORY`).** `done` now arrives **before** `memory_update` (the done frame carries `pending_memory: true`) so the UI finalizes as soon as the last token lands; the blob follows 1-4s later (post-answer compaction) and then the stream closes. The `askQuestionStream` read loop (`src/lib/api.ts`) must keep consuming past `done` until the stream actually ends — gated by `tests/streaming-contract.test.ts`. Separately, `onMemoryUpdate` (`src/app/page.tsx`) re-persists the session when the blob lands after `done` (`doneSeen` flag), or reload/device-switch loses that turn's recall. The parser tests do **not** establish this UI-to-database persistence journey; it needs the route/browser gate recorded in the local index. The legacy order (memory_update → done) still works for older backends.
- **Persistence.** Stored per session in `chat_sessions.memory` (nullable JSON TEXT, migration `0002`). PATCH `/api/me/chats/[id]` folds it into the messages transaction so a settled turn is atomic; GET returns it; loaded on session select, reset on new/delete. Survives reload and device-switch like chat history. Omitted memory key = leave existing untouched; explicit `null` stores JSON text `"null"` (distinct from SQL NULL).
- **Citation continuity.** Each `sources[]` item now carries a conversation-stable `sid`. It rides inside the sources array, so it persists in message metadata and reloads automatically — no separate map, no rendering change.
- **Status events.** `status` `{stage, message}` drives the `ThinkingIndicator` label directly (`message.status.message`), falling back to the old field-presence heuristic when absent. The memory fast-path (no `searching`/`sources`) is handled by this automatically.
- **Heartbeats.** `: ping` comment lines need no handling — the parser only acts on `data: ` lines.

**Incident constraints:** keep reading past `done`; never overwrite populated sources with a trailing empty `sources: []` frame; reset partial answer state before shutdown replay; restore the pre-turn memory snapshot for regenerate/edit-last (see below); Deep Research always streams (the upstream non-streaming agentic path is rejected). The parser/reconnect signals and selected actual shutdown/reset/exhaustion, regenerate/edit/persistence and project realtime journeys have the gates below. Untested event schedules remain separate coverage.

## Chat UX pack

Hover-revealed message actions, sidebar organization, starter prompts, and chat deep links. All client-side except the feedback event and the pin flag.

- **Deep links**: the active chat rides as `/?chat=<id>` — selection pushes history (back/forward walk conversations, `popstate` handler), first-send session creation replaces in place, new-chat/delete return to `/`, and the URL chat is restored on load (membership-checked by the API; unknown ids clean the URL). All via `history.pushState`/`replaceState` in `page.tsx` (`syncUrl`), no route change.
- **Message actions** (`MessageBubble`, hidden while streaming, always visible on touch): copy; **download** (one message as a `.md` file via `downloadMessageMarkdown` — same section format as the chat export, answers include their source footnotes); **regenerate** (offered only on the thread's final assistant message); **edit-and-resend** (user messages — forks the thread, everything after the edited message is dropped); 👍/👎 feedback.
- **Regenerate vs. the opaque memory blob.** The blob can't be rewound, so `page.tsx` keeps a one-turn snapshot (`memoryAtSendRef`) of the blob *as it was when the last question was sent*. Regenerate — and editing the **last** question — restores the snapshot so the redo doesn't "remember" the answer it replaces; editing an earlier message resets memory to `{}` (recall restarts at the fork). A fresh load uses stored recall as the best-available fallback. Within the mounted page, navigation back to the same nonsuperseded local exchange retains its immutable at-send snapshot, even after visible completion or compaction while away. A different loaded last exchange uses stored recall. Regenerate/edit rebuild the thread via `handleSend(question, baseOverride)` — the override is the truncated prefix, avoiding a race with the `messages` state update.
  Same-exchange remote content/memory adoption must not alter a retained local at-send snapshot. A different adopted last exchange uses its stored blob as the best-available fallback. Regenerate/edit use the displayed local prefix without normal-send's fresh rebase; a held adoption response cannot clobber the new local fork.
- **Feedback** stamps `feedback: "up"|"down"` into the message (persisted in message metadata, so the thumb survives reload) and best-effort POSTs `/api/me/feedback`, which writes a `usage_events` row (kind `feedback`, metadata `{sessionId, messageId, rating}`) after verifying chat ownership. Admin dashboard shows a "+ / −" KPI (`json_extract` on the metadata).
- **Sidebar**: client-side title search; pin/unpin (`chat_sessions.pinned`, migration `0005`) — pinned chats form their own group above the time groups, and toggling pinned deliberately does **not** bump `updatedAt`; per-chat Markdown export (`src/lib/exportChat.ts` — transcript + numbered source footnotes per answer; the per-message download reuses the same section renderer).
- **Starter prompts**: admin-curated questions (`app_settings.starterPrompts`, newline-separated, max 4 — `parseStarterPrompts` is the single parser shared by `/api/config`, the layout seed, and the admin validator) rendered as cards on the empty chat screen; a click submits the question.

**Message authorship (projects):** `chat_messages.user_id` is server-stamped for new ids and **preserved by id across full-message replaces** — but only for existing *non-null* authors; a stored null author is attributed to the caller performing the replacement. Echoed `authorId`/`authorName` from the client are always dropped. Replacement also regenerates ordering timestamps. (Corrected 2026-10: previously described as unconditional preservation.)

## Souls (assistant personas)

**Naming:** the user-facing term is **Personality** (DE: Persönlichkeit); **SOUL.md** is the technical file-format term (kept in labels like "SOUL.md content", "Export SOUL.md"). Code identifiers stay `assistants`/`soul*`.

A soul IS a **SOUL.md file** — portable persona documents (soulweaver/OpenClaw convention) stored verbatim in `assistants.soul` and injected server-side per turn. Frontmatter (`name`, `description`, `starters:` dash-list, `collection`) is parsed at save time (`mode:` is retired/ignored — the global default chat mode always applies) by `parseSoulFile` (`src/lib/souls.ts` — hand-rolled, no YAML dep) and cached in columns; the **body** (file minus frontmatter) is the injected persona.

- **Three tiers (`assistants.scope`): `builtin`** (repo-shipped in `src/lib/builtin-souls.ts` — embedded strings, not files, so the standalone build needs no fs reads; seeded by `builtinKey` in `instrumentation.ts`: insert-if-missing, and builtins removed from the repo list are DELETED with explicit reference detach — admin "remove" = `enabled=0` still sticks across restarts), **`global` / `group`** (admin-curated at `/admin/assistants`, `requireAdmin`), **`user`** (personal, max 20, managed from the chat empty screen's souls modal)). All tiers are **editable after creation** (`PATCH` with `{content}` — users their own via `/api/me/assistants/[id]`, admins any tier incl. builtins via `/api/admin/assistants/[id]`); the SOUL.md is replaced verbatim and the cached frontmatter columns (name/description/starters/collection) re-derive, so adjusting the starter questions = editing the `starters:` list. Shared edit UI: `SoulEditModal` (pencil on own souls in the user modal, Edit button on the admin page). Running chats pick edits up on their next turn.
- **Injection:** the client sends `assistant_id` on every `/api/ask/stream` turn (persisted on `chat_sessions.assistant_id`, migration `0006`, so the choice survives reload). The proxy scope-checks it (`getUsableAssistant`), strips the field, and prepends the soul body to `conversation_history` via the same mechanism as the analytics block — order `[analytics, soul, …turns]`, re-applied per request, never persisted, never echoed to the browser.
- **Picker UX:** pill chips on the empty chat screen ("Cortex" default + visible souls + a "+" manage button); the active soul's `starters` replace the global starter cards, its `collection` frontmatter is applied as an advisory default on selection; ongoing chats show a soul chip in the composer. Soul is fixed per chat at creation.
- **Import & verification:** paste / upload / URL. URL import (`src/lib/soul-import.ts`, server-side fetch with private-host guard + size cap) understands soulweaver's public souls API and verifies the **EIP-191 signature** (viem): keccak256(content) must equal `contentHash`, the signing message (`{hash}|{chainId}:{contract}:{tokenId}|codex-vN`) must embed it, and `recoverMessageAddress` must yield the claimed signer → `verifiedSigner` badge. Failed verification downgrades to unverified import, never blocks. Any other URL is treated as raw SOUL.md. **Export** (`downloadSoul`) round-trips the verbatim file — portability is the point.
- **Soul Builder ("Generate" tab)** — soulweaver's architecture, for a hard reason: sending the author meta-prompt as a Cortex query trips the backend's **prompt-injection defense** (instant canned deflection). So `POST /api/me/souls/generate` orchestrates two phases: (1) **research through Cortex with benign queries** — hybrid `/api/search` + plain `/api/ask` questions (`buildResearchQuestions`), deflections filtered by `isUsableAnswer` (soulweaver's refusal detection), every step streamed as a `thinking` frame into the UI's live research log; (2) **writing via the Cortex backend's own primary model** through its admin-gated `POST /api/llm/completions` (rides `CORTEX_API_URL` + `BACKEND_ADMIN_API_KEY`, zero extra config, temp 0.85, unit-metered + Langfuse-traced like every other completion; requires cortex-app ≥ the completions-endpoint release — older backends get a clear 404 message). There is deliberately NO separate LLM config for this — one model stack for the whole product (`buildWriterMessages`/`buildRevisionMessages` in `src/lib/soul-author-prompt.ts`). Revisions skip research and go straight to an editor prompt. No chat persistence, no memory, no analytics/soul injection on itself. **Writer robustness:** the backend endpoint applies `DEFAULT_REASONING_MODE` (default off) like the chat path — on cortex-app builds before that fix, thinking-by-default models (Qwen3.x) burned the whole `max_tokens` budget in a hidden `reasoning_content` channel and the run looked stuck at "Writing the SOUL.md…". Client-side guards regardless of backend version: the route emits `: ping` SSE comments every 10s so the browser leg survives proxy idle timeouts, reasoning deltas (if any reach us) become a throttled status line, the writer is bounded at 5 min, and an empty answer is surfaced as an explicit error naming the cause instead of a silent `done`. Client: `generateSoulStream` (`src/lib/assistants-client.ts`) strips `[src_N]` markers; shared composer `src/components/souls/SoulComposer.tsx`.
- **Deletion never relies on FK actions:** personal/admin soul deletion explicitly nulls `chat_sessions.assistant_id` and `projects.assistant_id` in the same transaction before deleting the row — historical deployments may lack `ON DELETE SET NULL` on those ALTER-added columns (gated by the legacy-fixture negative control in `tests/sqlite-contracts.test.ts`).
- Usage events tag soul turns (`metadata.assistantId`) and builder runs (`path: /api/me/souls/generate`).

## Projects (shared team workspaces)

A project groups chats and carries defaults inherited by chats created inside it: optional soul, collection scope, and **instructions** — an invisible per-turn context block. Tables: `projects` + `project_shares` (one row per grant: either `group_id` or `user_id`) + `chat_sessions.project_id` (migration `0007`).

- **Sharing:** owner-only, via one modal — a single search field over groups AND people (`GET /api/me/directory`, min 2 chars, 8 hits/kind) → chips → `PUT /api/me/projects/[id]/shares` replaces the set. Owner is implicitly a member.
  Direct-user and group grants are an OR: removing one does not revoke the other.
  The server deduplicates input, filters unknown principals and omits an explicit
  owner user grant. Share mutations preserve chat rows/messages/metadata/opaque memory.
  Current list/read/save and new chat-feed admission recheck membership. Open chat
  feeds do not revalidate/terminate on share removal; their connect-time admission
  remains until disconnect. User feeds likewise snapshot project channels at connect;
  the page refreshes/reopens when the accessible project set changes. Do not infer
  instantaneous active-feed revocation from a sidebar disappearing or fresh GET404.
- **Collaboration semantics — multi-user by default:** members see ALL chats in a project and **any member can continue any thread**. Authorship is per-message (`chat_messages.user_id`, migration `0008`; preserved-by-id rule above). Chat administration (title, pin, project move, delete) stays author-only. UI: teammates' names above their user messages; edit-and-resend only on own messages; regenerate only when the last exchange is own. `POST /api/me/chats/[id]/duplicate` still exists as a fork primitive (no UI entry point currently).
- **Realtime:** in-process pub/sub (`src/lib/chat-events.ts`, channel-keyed — `chat:`, `project:`, `user:`, `group:` — stashed on `globalThis` for dev HMR; single-container deployment model — multi-replica would need a shared bus).
  - **Open-chat feed** (`GET /api/me/chats/[id]/events`, membership-checked, 25s heartbeats): settled writes publish `changed`; the **live-turn relay** tees the `/api/ask/stream` answer (client sends `session_id`, membership-checked, project chats only) into `turn_start` (question + asker name) → `token` frames → `turn_done` — watchers render the teammate's question and watch the answer stream, then refetch the settled attributed state.
  - **User feed** (`GET /api/me/events`): multiplexes the user's `user:`/`group:` channels + every accessible project channel (membership snapshot at connect; the client reopens the feed when its project set changes). Publishers: chat create/delete/move, settled project-chat writes, share changes, project edit/delete. Client debounces into `refreshSessions()`.
  - Two members streaming into the SAME chat simultaneously still use atomic full-snapshot last-writer-wins — normal send freshly rebases onto server messages+memory, but overlapping turns are not merged. Each asker receives its own stream; the latest-started relay alone owns the ephemeral late-join replay. An older relay's tokens/completion cannot append to/delete that replay (in-memory turn identity; no persistent revision/CAS).
  - Adoption is read-only and bound to the current session/view and latest requested refresh. Stable message IDs/count do not imply unchanged content, feedback or opaque memory. Discard a delayed adoption after navigation or local streaming; apply refs/state outside React updaters. Returning to an unfinished local turn reattaches its current snapshot, immutable at-send memory and stop control.
  - Native EventSource reconnect does not replay missed settled writes. Adopt on actual `open` using the existing ownership/read guards. On `error`, retire only the selected ephemeral remote pair and its live-view identity; a missed `turn_done` must not block future adoption or strand a ghost streaming answer. This does not change durable LWW or cancel another member's ask.
  - A remote live pair is an ephemeral overlay over settled history. Keep its token snapshot outside React updaters; fresh adoption composes with the latest overlay instead of rejecting reads while remote live. New relay start replaces only the previous selected pair; error/done retires it. Reconnect must preserve missed settled-prefix changes alongside replay, with no duplicate question/answer pair.
- **Injection:** the client sends `project_id` per `/api/ask/stream` turn; the proxy membership-checks it and injects the project's instructions via the analytics-block mechanism — final order `[analytics, soul, project instructions, …turns]`, stripped upstream, never persisted.
- **Sidebar:** collapsible project folders above the flat list (which now shows only non-project chats — `GET /api/me/chats` filters `project_id IS NULL`); new-chat-in-project inherits the project's soul + collection client-side. **Drag & drop**: own chats drag between the flat list and project folders (`PATCH /api/me/chats/[id]` with `projectId`, membership-checked; organizational like pinning — no `updatedAt` bump).
  A move changes only the association: keep history/metadata/citation sid, memory,
  personality, authorship and timestamps. Existing chats do not adopt the target's
   creation defaults. Shared destinations require the existing confirmation; cancel
   has no write, private destinations/moving out have no confirmation. After success,
   derive context from positive current project/flat-list association evidence under
   latest-request and captured session/view guards, not the acknowledgment's target.
  `setChatProject` propagates404 as rejection (the generic GET client's null404 is
  not a write acknowledgment). Refresh lists on failure without rebinding context.
- **Deletion keeps chats** — they fall back to their authors' flat lists. Detaching is done **explicitly in the delete handlers** (projects and souls both): SQLite `ALTER TABLE` FK columns on older deployments may lack the `ON DELETE SET NULL` action (drizzle-kit emitted the ALTERs without it originally; the migration files are fixed, but never rely on the FK action for these columns — see the legacy-fixture negative control in `tests/sqlite-contracts.test.ts`).
  Project removal changes only the affected chats' association; retain personality,
  opaque memory, full message metadata/citation sid, attribution and recency. The
  project owner does not acquire the other authors' detached chats. Author access
  survives; former project access does not grant fresh read/save/feed admission.
  A successful delayed delete acknowledgment clears only the **current** matching
  project context. Use a pure functional state comparison after await; captured
  selection can clear an unrelated project selected meanwhile. Valid author-origin
  compaction and local immutable edit/regenerate snapshots remain eligible.
  A rejected delete is not a successful detach: refresh lists and return without
  clearing the selected context. `deleteProject` already throws on transport and
  non-success HTTP results; swallowing that rejection in the page loses project
  instructions on direct edit/regenerate. A pre-dispatch failure proves no commit;
  a failure after dispatch can have an uncertain outcome and needs its own gate.
  Remote deletion does not reload the selected author's history/recall: positive
  membership in the refreshed author-only **personal flat list** establishes its
  detached association and clears only project context using the live selected ID.
  That evidence is request/view-owned: older flat/project responses cannot replace
  a newer refresh, and a latest-but-pre-navigation list cannot clear a freshly
  loaded different view. Capture selection/view before await; keep its association
  projection separate from global sidebar refresh. No persistent revision/CAS.
  Missing project visibility alone does not establish detach or non-author rights.
  A previously admitted non-author ask/relay can finish after detach; its later
  save rechecks access and returns404. Already-open feeds can receive later author
  writes until disconnected. These are observed limitations, not instant-revocation
  or continued-persistence promises; general ask remains caller-key authorized.

## Voice (STT dictation + TTS read-aloud)

Env-only, feature-gated like SMTP: unset `VOICE_*_BASE_URL` ⇒ the mic and read-aloud buttons don't exist (`ClientConfig.voice` flags). Both pairs point at **any OpenAI-compatible audio API** — a LAN LiteLLM router aggregating speaches (faster-whisper / Kokoro / Voxtral), Venice (`https://api.venice.ai/api/v1`), or OpenAI. Endpoints appended to the base: `/audio/transcriptions` (multipart) and `/audio/speech`.

- **Env:** `VOICE_STT_BASE_URL/API_KEY/MODEL` and `VOICE_TTS_BASE_URL/API_KEY/MODEL/VOICE` (`src/lib/voice.ts`). Keys optional (LAN routers may be keyless). Boot-validated: a set base URL requires its model. Note some TTS backends require `voice` (Kokoro: `af_heart`; `voxtral-tts`: `casual_female`) — the proxy omits the field when unset.
- **Proxies** (`/api/voice/transcribe`, `/api/voice/speech`): `requireAuth()`, provider key injected server-side, provider error bodies sanitized (never leaked — may echo config), 25MB audio cap, TTS input truncated to 4k chars (hearing the start beats an error).
- **UI:** mic in `ChatInput` (MediaRecorder webm/opus → transcribe → appended to the input, dictation-style; pulsing stop-square while recording); read-aloud in the message action row (`ReadAloudButton` — fetch once, blob-URL cached per message, toggle to stop). `stripForSpeech` (`src/lib/voice-client.ts`) reduces markdown to speakable text (code blocks, `[src_N]` markers, links, tables stripped).
- **Permissions-Policy caveat:** the baseline security headers in `next.config.ts` must keep `microphone=(self)` — with `microphone=()` every browser silently refuses `getUserMedia` for the whole document (no prompt, `NotAllowedError`), regardless of user permission. Mic also requires a secure origin (HTTPS or localhost); `ChatInput` checks `window.isSecureContext` and surfaces distinct errors for insecure origin / blocked / no device.
- Sentence-streaming TTS and hands-free call mode are explicitly later phases.

## Turn/session ownership and UI gates

`page.tsx` owns local turn snapshots. Late callbacks never borrow the currently
rendered list/ref for persistence. Next-send keeps an unfinished predecessor's
compaction eligible until the newer turn settles; regenerate/edit supersede the
replaced chain immediately. Navigation detaches rendering, but a valid origin
still persists its own blob/history. Preserve the at-send snapshot verbatim.
Feedback stamps matching IDs in pending snapshots, not another view's message list.
When a valid late local callback selects recall in the current view, select its
matching history and immutable at-send snapshot together. Remote adoption does
not cancel origin persistence or change server LWW; a late origin save may win.
Never expose/persist an adopted remote-history/local-origin-memory hybrid.

Persist completion/feedback explicitly, outside React updaters that may replay.
Loading/remote adoption must not write unchanged history back. Page-local FIFO
session writes are ordering, **not CAS**: other clients retain server full-snapshot
LWW. Message IDs are globally unique; a cross-chat PATCH can 500 rather than save
the blob, so unchanged durable history alone does not prove callback isolation.

- `scripts/chat-journey-checks.ts`: real HTTP auth/persistence/rollback plus six
  positive source-extracted callback gates (synchronous adapter, not React).
- `scripts/chat-browser-journey.ts ... --mode candidate`: actual Chromium login,
  held SSE races (rapid next-send, regenerate, edit-last, chat switch), healthy
  settled/legacy controls, reload/replay and dark EN/DE surfaces. Tooling, scratch
  isolation and exact replay: `docs/regeneration/records/2026-10-02-turn-bound-ui.md`.
- `tests/chat-page-callback-oracle.test.ts`: retained defective baseline rejected
  by positive intended oracles, with healthy controls. Historical D remains
  unchanged; known-defect expectations are no longer candidate gates.

Project gates: `scripts/chat-project-journey.ts <fresh-output> <fresh-id> http|browser`
with root-backed TMPDIR; typecheck `scripts/tsconfig.chat-project.json`. Uses the
same isolated runtime/browser adapter, two synthetic user contexts in one Chromium.
Wait for real EventSource open before remote-write controls; hold actual adoption
GET responses, not fabricated state. `tests/chat-live-turns.test.ts` covers selected
relay ownership (including overlapping same-user streams and independent chats).
Results, baseline failures, gate versions and replay:
`docs/regeneration/records/2026-10-02-project-lifecycle.md`.

Follow-up: `scripts/chat-project-followup-journey.ts <fresh-output> <fresh-id> http|browser`;
typecheck `scripts/tsconfig.chat-project-followup.json`. Owning gate/receipt:
`docs/regeneration/records/2026-10-02-project-followup.md`. It exercises remote
adoption before regenerate/edit, real overlapping GET delivery ordering and
missed idle/live-completion recovery. Normal send can hide stale recall by
re-fetching: use feedback/regenerate consumers and acknowledged HTTP + SQLite.
`chat-feed-transport.ts` drops owned loopback sockets forwarding genuine SSE,
holds new connections while down, and flushes actual headers on restore. Require
observed native error and reopen; `setOffline(true)` alone may leave SSE connected.
Wait for feedback metadata as well as memory/content to commit before judgment.

Continuity: `scripts/chat-project-continuity-journey.ts <fresh-output> <fresh-id> http|browser`;
typecheck `scripts/tsconfig.chat-project-continuity.json`. Owning gate/receipt:
`docs/regeneration/records/2026-10-02-project-continuity.md`. Repeated native drops
while teammate remains live, missed settled-prefix recovery, and remote append/
same-exchange adoption during own held late-memory are positive Chromium gates.
Coherent LWW may select the origin or adopted view; feedback must consume that
exact selected pair without a repairing re-fetch. Keep source-extracted adapters'
bindings/turn fields aligned with the real page without changing their oracles.

Browser tooling is external to dependency resolution; absence is a named
prerequisite, never a browser pass. Selected project realtime/rebase/overlap and
switch-away/back now have actual Chromium gates; demo, voice/admin and broader
project lifecycle journeys remain uncovered. Verify affected
UI in dark EN/DE and state the precise environment/evidence scope.

Held-read/terminal navigation: `scripts/chat-project-selection-journey.ts <fresh-output>
<fresh-id> http|browser`; typecheck `scripts/tsconfig.chat-project-selection.json`.
Receipt: `docs/regeneration/records/2026-10-02-project-selection.md`. Genuine GET
delivery after relay replacement or more tokens must compose the latest overlay
with the captured settled base. Terminal navigation uses sidebar away/browser-back,
direct feedback and regenerate to expose lost at-send refs that normal send repairs.
Keep view recall, durable origin writes and immutable retry state distinct: preserving
at-send state does not authorize replacing a fresh loaded history with local history.

Terminal edit/fallback gate: `scripts/chat-project-terminal-journey.ts <fresh-output>
<fresh-id> http|browser`; typecheck `scripts/tsconfig.chat-project-terminal.json`.
Receipt/checkpoint: `docs/regeneration/records/2026-10-02-project-terminal.md`.
It distinguishes same-exchange local immutable snapshots from different-exchange
and fresh-document stored fallback through direct edit/regenerate and exact feedback.
Independent documents do not share supersession: a fresh document's fork cannot
cancel another document's valid late origin persistence under full-snapshot LWW.
That origin may become visible via a genuine pending adoption read. Stabilize its
delivery before selecting a feedback target; a DOM observation followed by a click
is not one atomic selection. No-GET probes must isolate pre-dispatch/held redo:
post-completion feed-open adoption is legitimate. Gate v1.4 passes HTTP/Chromium;
follow its receipt before repairs. Route quotas must count the intended operation:
Playwright `times` includes non-GET fallthrough. The terminal-local adapter reserves
GETs from the selected document before fetch and holds the current page's effect/
open reads together, delivering latest then older before feedback. That read count
is an identified-page driver schedule, not a public/replacement requirement.

Ask shutdown: `scripts/chat-shutdown-journey.ts <fresh-output> <fresh-id> http|browser`;
typecheck `scripts/tsconfig.chat-shutdown.json`; receipt
`docs/regeneration/records/2026-10-02-ask-shutdown.md`. Actual Chromium receives raw
`event: shutdown` after visible partial content, holds each resubmit before any new
content, and requires the old partial to disappear without persisting it. Two retries
retain one request ID and immutable request body; a fresh regenerate action gets a
new ID and its pre-turn memory. Three shutdowns exhaust into one durable error answer
with unchanged recall. Correlation is not idempotency/CAS. Healthy settled/legacy
controls, exact HTTP/SQLite state, direct no-GET feedback/regenerate and acknowledgments
prevent a normal-send rebase or request capture from masking state loss. The hold
schedule tests pre-done partial recovery, not shutdown during post-done compaction.
`tests/chat-shutdown-oracle.test.ts` challenges exact-state/replay comparators with
shape-correct faults; these are self-controls, not Chromium fault injection.

Project sharing: `scripts/chat-project-sharing-journey.ts <fresh-output> <fresh-id>
http|browser`, types `scripts/tsconfig.chat-project-sharing.json`; receipt
`docs/regeneration/records/2026-10-02-project-sharing.md`. Actual owner-modal direct/
group grant, partial/full revoke and regrant, live sidebar freshness, owner-only
controls, held member continuation and exact feedback/opaque memory pass. Judge a
consumer's no-refetch window by its own actor/document: its write can legitimately
trigger peer adoption. Clicking an already-selected thumb is intentionally a no-op;
a persistence probe must change rating and require a new matching PATCH/200 plus
that selected metadata in HTTP and raw SQLite. Gate v1.1 retains failed v1 bytes;
HTTP v1 remains reusable through an explicit unchanged HTTP-prefix comparison.
`tests/chat-project-sharing-oracle.test.ts` challenges exact stored grant sets.

Move gate: `scripts/chat-project-move-journey.ts <fresh-output> <fresh-id> http|browser`,
types `scripts/tsconfig.chat-project-move.json`; receipt
`docs/regeneration/records/2026-10-02-project-move.md`. Real native drag/drop and
consent, raw move-only state, held compaction/direct edit/regenerate and genuine
held acknowledgment across navigation gate these rules. Correlate each direct
consumer with its own active held response/request ID: a released predecessor can
satisfy generic fixture waits, and mixing a fresh browser request with old upstream
data is not acceptance. A specific-route holder can bypass passive generic route
capture; record its real request once before fetch. Old helpers/gates stay intact.
`tests/chat-project-move-oracle.test.ts` challenges the exact move-state comparator;
`tests/chat-project-move-client.test.ts` covers success/authoritative404+400 rejection.

Delete gate: `scripts/chat-project-delete-journey.ts <fresh-output> <fresh-id> http|browser`,
types `scripts/tsconfig.chat-project-delete.json`; receipt
`docs/regeneration/records/2026-10-03-project-delete.md`. Native EN/DE confirmation,
cancel, owner-only management, exact multi-author detach/unrelated-state preservation,
fresh admission, held compaction and direct feedback/edit/regenerate are gated.
Hold a genuine DELETE response after commit, navigate to another project, then judge
current context independently of origin storage. The delete-local sidebar selector
supports both locales; shared English helpers do not. Keep failed adapter attempts
distinct from the frozen positive context rejection. The legacy-schema SQLite
negative control remains a separate explicit-detach-pattern check, not legacy Next
   route execution. The remote/response-loss gates below cover selected author/non-author
   and known post-commit delivery loss; other uncertain dispatch outcomes remain separate.

Rejected delete: `scripts/chat-project-delete-rejection-journey.ts <fresh-output>
<fresh-id>`, types `scripts/tsconfig.chat-project-delete-rejection.json`; receipt
`docs/regeneration/records/2026-10-03-project-delete-rejection.md`. Abort the actual
Chromium DELETE before forwarding, observe its `requestfailed`/no acknowledgment,
and require exact unchanged project/share/chat/message state. Contrast with a real
successful DELETE in the same server log. Held valid compaction plus direct
regenerate/edit consume immutable pre-turn recall and retained project instructions;
normal send can repair and mask the defect. Every write has either an identified
expected transport failure or a real acknowledgment; do not exempt unknown failures.
`tests/chat-project-delete-client.test.ts` retains success and rejection/no-replay
semantics at the public client boundary. Error-console network diagnostics are
retained separately from required page-error/unhandled-rejection gates.

Remote deletion: `scripts/chat-project-remote-delete-journey.ts <fresh-output> <fresh-id>
http|browser`, types `scripts/tsconfig.chat-project-remote-delete.json`; receipt
`docs/regeneration/records/2026-10-03-project-remote-delete.md`. Native owner removal
with member-owned held compaction gates exact raw state/author admission/late memory/
direct immutable consumers without repairing GET. Non-author admitted answer completion
still has actual late-PATCH404/no storage change; open-feed delivery differs from fresh404.
Settled kind may be absent: correlate author/time with the acknowledged stored write.

Association-list: `scripts/chat-project-association-list-journey.ts <fresh-output> <fresh-id>`, types
`scripts/tsconfig.chat-project-association-list.json`; receipt `records/2026-10-03-project-association-list.md`.
Old personal lists across move/newer refresh and navigation/no-newer-list gate direct immutable/no-GET
consumers, valid compaction/feedback, healthy controls; sidebar triggers need auxiliary messages+memory —
memory-only publishes chat events, not project notifications.

Response loss: `scripts/chat-project-delete-response-loss-journey.ts <fresh-output> <fresh-id>`, types
`scripts/tsconfig.chat-project-delete-response-loss.json`; receipt
`records/2026-10-03-project-delete-response-loss.md`. Real DELETE200/committed detach precedes delivery abort
— no browser ack does not imply rollback; list reconciliation, valid author compaction/direct immutable
redo/no automatic replay have pre-dispatch no-commit and acknowledged-success controls; others remain open.

Overlapping/reverse/delayed-list moves: `scripts/chat-project-move-{overlap,reverse,positive-list}-journey.ts <fresh-output> <fresh-id>`, types
`scripts/tsconfig.chat-project-move-{overlap,reverse,positive-list}.json`; receipts `records/2026-10-03-project-move-{overlap,reverse,positive-list}.md`.
Overlap commits A/B, acks B/A, rejects last-ack context; reverse holds A pre-forward, B commits/acks, then A commits/acks last, final direct context A;
positive-list captures the page's own genuine B-positive project list with real bytes while A is unforwarded, delivers a newer A-positive list,
then the older B response LAST under a bounded unavailable-refresh window failing further project-list deliveries with an actual abort —
an indefinite hold would deadlock the persistSession→refreshSessions write queue, while the supported catch resolves it without repairing
association evidence. In-window failures are phase-locally accounted: projects aborts stay request-object/sequence correlated,
selected-chat events ERR_ABORTED need one-to-one actual instrumented `EventSource.close()` correlation (isLoading cleanup closes at redo
teardown), pre-window navigation cancellations stay retained diagnostics. All three retain accepted writes/LWW, raw move-only state, valid
compaction, immutable no-GET redo and healthy controls; positive request/view-owned membership binds context; absence is not detach; close the
actual drawer before actions; no-ack checks bind chat AND move body, excluding earlier valid history saves; retained phase snapshots precede any teardown dispatch.
