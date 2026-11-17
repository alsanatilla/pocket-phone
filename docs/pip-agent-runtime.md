# Pip server runtime

Server chat runs (`pip-runs.js`) and scheduled reports (`pip-background.js`) use
OpenClaw 2026.11.3 through its published `openclaw/plugin-sdk/agent-core` entry
point. `@openclaw/agent-core` is a private workspace package, not an npm dependency.
No OpenClaw internals are imported or copied.

The `Agent` owns model/tool iteration, transcript state, argument validation,
lifecycle events and cancellation. Pocket supplies its tools, permissions,
rendering, durable approvals and database writes. The supported `streamFn`
extension uses Pocket's existing AI SDK provider transports; those transports make
one model request and do not run an agent loop.

`src/server/pip-agent-transport.js` translates the two message/event contracts.
`src/server/pip-agent.js` registers tools and consumes Agent events.

## Limits

- **Per request**: the output cap is the person's reply limit (`value.maxTokens`),
  the same on every request (`maxOutputTokens` passed to the transport).
- **Per reply**: at most `MAX_REQUESTS` = 12 model requests, counted across approval
  pauses through the checkpoint. The last request's instructions say it is the last:
  write the answer now; cards may still be drawn; lookups are refused. Past the
  ceiling the reply ends with what it has plus a notice.
- There is **no per-reply token budget** and thinking is never counted. Only the
  classic app's browser loop still uses the older budget (`tokens` / `researchTokens`)
  in `src/client/pip-stream.js` (see "One loop in the app" below).
- **Time**: one five-minute research deadline shared by all requests of a reply, and
  a 90-second idle limit (no bytes from the provider; the transport's `clock` and
  every agent event reset it). Neither runs while the person decides on an approval;
  the idle limit does not run while a tool works.
- **Lookups** (tools that are neither writes nor state tools) are refused with a
  `research_budget_reached` result once research stops. Research stops at: the
  `research` caps (lookups, web calls), `RESEARCH_LIMITS.calls` / `webCalls`,
  48,000 characters of lookup results, after eight requests, when the `enough`
  judge says yes, when an identical failed call repeats, or after a cut-off message.
  A single result over 8,000 characters is `result_too_large`. The model is then
  told that research stopped. Cards, plans and approved saves are never taken away:
  removing them made models write "[card: …]" stand-ins instead of drawing.
- A conversation over 190,000 characters ends the reply.
- A message cut off at the reply limit (`length`), whether it is text or a tool call,
  is dropped and written again, at most twice in a row. After that the reply ends
  with its partial text and "The reply limit per message was reached."

Endings for the ceiling, the deadline, the idle limit, the context size and
`length` keep the partial answer and its cards, add the notice, settle the
activity and publish phase `failed`. The turn ends as failed with that message,
and Continue (`resume`) can pick it up. Pressing stop raises
`AbortError('Stopped')`. Any other failure publishes the normalized answer with
the activity settled before it throws.

## Tools

Lookups run in parallel, at most `RESEARCH_LIMITS.parallel` (3) at a time.
Writes, device tools, cards and state tools are `executionMode: 'sequential'`, so
a batch that contains one runs one call at a time. Identical lookups are answered
from cache (`cached: true`), including lookups running at that moment and a
restarted run's observations. An identical failed call is answered from its
failure (`repeated: true`). A write that was already saved in this turn
(`applied_href`) is answered with `existing_proposal` instead of asking again. A
grant switched off while a call ran is `access_disabled`. A tool that throws is
`data_unavailable`, and invalid arguments are `invalid_arguments`: both are tool
results, never a crashed run.

Text streams into the answer and thinking into `result.reasoning` (bounded to its
last 16,000 characters past 24,000). Text written before a lookup moves to the
reasoning as working notes. Text up to the last drawn card stays. While
`show_card` streams its arguments (`toolcall_start` / `toolcall_delta`), the
card's complete elements stand in the answer as an open fence. The checked card
replaces that fence, or the fence is dropped.

## Steering

While a chat reply runs on the server, a message the person sends goes into that reply: Pip takes it in at its
next step and carries on in the same reply, instead of the message waiting until the reply is over.

- **Storage.** A steering message is a queued message (a `pocket_pip_runs` row, status `waiting`, see
  docs/pip-message-flow.md) whose `config.steer` names the run it was sent into. No schema change. The client sends
  `steer` = the turn uid it sees running; the server sets `config.steer` only when that turn is the lane's active
  run and it is `queued`, `running` or `awaiting`, the message has no attached sources, and fewer than
  `MAX_STEERS` (5, `src/shared/pip-steer.js`) were sent into that reply. Otherwise it is an ordinary queued
  message. Size: the normal 16,000-character limit.
- **Delivery.** The run's process takes waiting rows for its run immediately before a model request: in
  `prepareNextTurnWithContext` (they are queued with `agent.steer()`, `steeringMode: 'all'`, and the loop's
  after-turn steering checkpoint commits them as user messages), and in Pocket's own loop before its first request,
  after an approval and after a finished message. That is a single indexed read per model request, at most twelve
  per reply, never a poll loop. Steers are never admitted while a tool batch runs: OpenClaw would skip the batch's
  unstarted sequential calls (approved saves, cards) with a "steering" result.
- **Exactly once.** Taking is one write transaction on the run's lease (`take` in `drive`): the rows become
  `steered` and the run's turn records them in `turn.steers`; if the lease is lost or the run is stopping, nothing
  is taken. It is chained behind the progress writes, so none of them can write the turn back without the
  messages. Each delivered user message carries `pocketSteer: uid`; a message the turn records as taken but the
  transcript lacks (a restart rebuilds the transcript from the chat; a checkpoint written before a later take) is
  added once before the next request, never twice. A restarted reply keeps its steers at `pos` 0.
- **Ending first.** A message not taken before the reply ends stays `waiting` and is the next queued message,
  exactly as before (`settleLane` / `startNext`). A finished message is not the end while a request is left: if a
  message arrived, the reply continues after it. At the last request (`MAX_REQUESTS`) nothing is taken.
- **Approvals.** While a run waits for a decision, a steering message decides nothing; it is held and delivered
  when the run continues, after the batch's results. Stop still stops: a stopping run takes nothing, and messages
  left waiting are held with the rest of the queue.
- **Limits.** A steer resets no counter: the request ceiling, the deadline, the lookup caps and the idle limit
  hold. One exception: research stopped only by the "enough looked up" judge (`counters.enoughStopped` with that
  `finalReason`) starts again, and the judge is asked again only after new lookups. Per-message effort caps still
  refuse. Scheduled jobs and assignments pass no steering source; nothing about them changes.
- **Transcript.** The model receives `steerText(text)`: the message marked as sent while it worked. The turn keeps
  `steers: [{ uid, text, at, taken, pos }]`, `pos` being the answer's length when taken. The rule for text before
  a steer is the existing one: working notes before a lookup move to the reasoning (`moveNotes`); what stands in the
  answer when the message is taken stays (`cardEnd` moves to it), and the answer continues after it. The stored form
  is normalized piece by piece so every `pos` stays exact. Later replies replay a finished steered turn as
  question, answer up to the message, the message (cut to 2,000 characters; not counted in the history budget),
  the rest of the answer (`replayAnswer` in pip-core.js). Continue or retry of a steered turn keeps its steers.
- **Live and UI.** `replyOf` cuts the streamed blocks at each steer (`steers[i].block`), so followers draw it in
  place. In the new app the send key while Pip works is "Send to Pip now"; a message not taken yet shows at the end
  of the running reply ("for pip's next step", or "after your decision" while a change waits) with `take back`; a
  taken one stands where it was taken in, marked "taken in". Lab states: `steer-sent`, `steer-held`,
  `steer-taken`, `steer-done`.

## Approvals

A plan card (a Timeline) has "add to calendar and tasks" in its menu: it sends the plan's items, built from the
stored card, with `[about card <id>]` (`planRequest` in `src/shared/pocket-card-edit.js`; rules in `PLAN_PROMPT`).
The model answers with one `create_record` per item in one message, so the person gets one pause; two or more
waiting writes are shown as one list with per-item review/decline and `save all` (`ApprovalGroup` in
`src/app/features/pip/Offers.tsx`). Writes are not counted against the lookup caps and there is no per-reply write
cap, so a ten-item plan takes two model requests of the twelve.

Approval checkpoints contain OpenClaw messages (thinking blocks untouched), pending
calls, previews, rows, counters and displayed output. A durable run pauses at the
assistant message boundary, before executing its tool batch, with every write and
device call of that message pending at once. On resume, Pocket first checks that
every pending request is settled; if one is not, it pauses again unchanged. Then
it supplies approved, declined or device results using the same call IDs, and
calls `Agent.continue()`. The database's existing run lease and idempotent write
boundary still own concurrency. Approval request IDs include the request index,
so reusing a provider tool-call ID cannot reuse an earlier approval. Completed
conversation history continues to use Pocket's existing storage format and is
translated at the runtime boundary.

## Compaction

A chat longer than the replay (pinned first request, 20 exchanges, 60,000
characters) loses its middle. `src/server/pip-compaction.js` summarises those
omitted turns once, before a server reply's request is built, and `requestBody`
replays the summary where they were: a `<pocket_conversation_summary>` block,
marked as historical reference data, before the first replayed turn after the
pinned one. The coverage block still lists every omitted turn (plus
`summarized_turns`, `summary_through_turn_id`), `read_chat_history` still
recovers exact text, and the conversation memory block is unchanged.

- **Stored** on the chat as `summary = { upto, text, made, model }` (the last turn
  covered), written with `writeObject` in a transaction that checks the run still
  holds its lease and that the stored summary is still the one it extended. It
  syncs like any header field; `mergeObject` keeps the newest summary by `made`,
  so a device whose copy predates it cannot drop it.
- **When**: the replay omits turns today and the summary does not cover them. A
  stored summary is extended once 3 more turns fall out (`EXTEND_AFTER`), with
  OpenClaw's incremental `previousSummary`; it never reads covered turns again.
  While a chat has a summary the replay keeps 8,600 characters free for it, so
  the planned window and the replayed window are the same.
- **Input**: stored turns only, prose via `answerText` (no card sources, card
  records, tool-call markup or tags), each request clipped to 2,000 characters
  and each answer to 4,000, at most 40,000 serialised characters per compaction
  (the oldest pending turns first; the rest wait). Unfinished turns are sent as
  "[No answer …]". The prompt treats the turns as untrusted data.
- **Output**: at most 1,500 tokens; stored and replayed text is capped at 8,000
  characters.
- **Cost**: the summary request's usage is added to the turn's usage and charged
  with the reply (`chargeTokens`). It is skipped when OpenClaw's estimate of it
  would leave less than 20,000 tokens of the day's budget.
- **Failure**: a failed, cut-off (`length`), slow (30 s) or stopped summary,
  or one over budget, changes nothing: the reply goes out with the clipped
  replay. A continued run (approval checkpoint) and assignments never compact.

OpenClaw's `generateSummary` writes the summary through Pocket's transport with
the chat's own model and key; `serializeConversation` and `estimateTokens`
bound and price its input. `prepareCompaction`, `findCutPoint`, `compact` and
`shouldCompact` are not used: they cut OpenClaw session entries by a token
window, whereas Pocket's replay window decides what is omitted and the summary
must cover exactly that for the coverage block to stay true.

## Deployment

Deployment requires Node >=24.16.0 <25 or >=26.1.0. The Fly Dockerfile pins Node
24.16.0. Install with `npm ci` and build with `npm run build`.
Pending checkpoints made by the previous runtime must be stopped and resubmitted;
they are rejected explicitly rather than interpreted as OpenClaw transcripts.
The OpenClaw Node package is never loaded into browsers.

## One loop in the app

In the app people use (`src/app`) every Pip reply runs on this server loop; there is
no browser-only chat. `src/app/features/pip/runner.ts` gives `ReplyRunner` the server
as its only transport, and `src/app/features/pip/account.ts` handles what used to send
a reply into the tab:

- **Not signed in:** no message field; one sentence ("Pip answers on Pocket's server,
  so it needs your Pocket account.") and the `sign in` key. Nothing is sent.
- **Signed in, but the tab has no session yet or lost it:** the session is read once;
  an ended session says "sign in again", an unreachable server says so, both as the
  turn's error with `start over`.
- **A key kept only in this tab** (from before keys lived on the account, or typed
  in as a guest in the same tab): when the server has no key for the chat's endpoint,
  one dialog asks to store it on the account; yes stores it sealed in
  `pocket_pip_keys` (`/api/pip/keys`) before the message is sent. No asks once per
  page; the server then refuses. A per-request key would not do: a paused run resumes
  in a later request and a restarted worker continues it, both from the vault.
  Saving a key in settings while signed in already stores it on the account.
- **The server refuses** (`src/shared/pip-refusals.js`: no key for the endpoint; the
  daily limit of "Pip on its own"'s key used up) or cannot be reached: the turn ends
  failed with one sentence that names the provider and links to settings. A refused
  submit over the live socket now ends the follow at once (`pip-remote.js`).
- **Device tools** are unchanged: they arrive as approvals of the server run.

The browser loop (`src/client/pip-local.js` → `pip-stream.js`) stays only for the
classic app (`/classic`), whose guests and signed-out tabs still answer in the tab.
`pip-core.js` no longer refers to it, so the app's bundle does not contain it
(checked by `src/app/features/pip/one-loop.test.tsx`).

## Verification

Verification uses the real OpenClaw Agent and simulated provider HTTP streams:
`node --test tools/pip-agent.test.mjs tools/pip-agent-transport.test.mjs tools/pip-runs.test.mjs tools/pip-effort.test.mjs tools/pip-background.test.mjs tools/pip-assignments.test.mjs tools/pip-compaction.test.mjs`
plus the full tools suite (`NODE_OPTIONS=--experimental-vm-modules npm run test:tools`).
These cover:
- approvals, edited and invalid inputs, partly settled batches, device tools and restart recovery
- the request ceiling, `length` retries, the deadline and the idle limit, and stops
- cards after the lookup limit, card drafts and card updates
- reasoning, usage, failure states and scheduled jobs
- steering (`tools/pip-steer.test.mjs`): delivery between steps and after a finished message, held during an
  approval, exactly once across a pause and a restart, the ceiling, `MAX_STEERS`, the judge, and history replay

They do not establish live model quality or deployment health.

## Checking against a real model

`npm run check:live` (`tools/live/`) sends a fixed set of requests through the real reply loop (`streamChat`) with
the real request building (`config`, `requestBody`, plus the date, server note, memory instructions and effort note
pip-runs.js appends) and the production tool definitions for a server chat with notes, tasks, calendar and web
search on, then judges each reply with deterministic checks (`tools/live/checks.mjs`). It is never run
automatically: not by the tests, the build or a deploy. Without a key it prints one "skipped" line and exits 0.

```
POCKET_CHECK_KEY=… npm run check:live
POCKET_CHECK_KEY=… POCKET_CHECK_ONLY=plan-card,steer POCKET_CHECK_REPEAT=3 npm run check:live
```

- `POCKET_CHECK_KEY` (required; never printed or written, and redacted from the report and output),
  `POCKET_CHECK_BASE_URL` (default `https://opencode.ai/inference/go/openai/v1`; ignored for anthropic, whose URL is
  fixed), `POCKET_CHECK_MODEL` (default `deepseek-v4.1-flash`), `POCKET_CHECK_PROVIDER` (`compatible` | `anthropic`),
  `POCKET_CHECK_ONLY` (comma list of scenario names), `POCKET_CHECK_REPEAT` (default 1; a scenario passes when two
  thirds of its runs, rounded up, pass: 1/1, 2/2, 2/3, 3/4, 4/5), `POCKET_CHECK_REPORT` (the JSON report's path;
  default a file in the system temp directory).
- **No database, no account, no web.** `tools/live/world.mjs` holds a few German and English notes, tasks and
  appointments read through Pocket's real tools over an in-memory record source; `search_web` / `read_web_page`
  answer from three canned pages; saves are recorded, not written; memory and jobs tools are no-ops. Effort is fixed
  per scenario in place of the JEV judgment, so the effort note and lookup limits match production.
- **Scenarios** and what they guard:
  `plan-card` (a plan is drawn with show_card as a Timeline, never "[card: …]" text or raw JSON in the prose; the
  stand-in is looked for in the streamed text, since the stored form drops it);
  `card-after-history` (with a stored card replayed as a show_card call, a new table is still drawn by tool call);
  `research-then-card` (lookup cap 2: a lookup is refused, a Table/Chart is drawn after it, canned URLs are cited,
  at most `MAX_REQUESTS`); `update-card` (update_card with the earlier card's id, no second card, the stored card
  shows 13:00); `save-with-approval` (one create_record task due tomorrow, saved once); `save-declined` (nothing
  saved and the reply says so without claiming a save); `steer` (a message sent when the first tool call shows is
  taken through the same `steering.take` option pip-runs.js passes, reaches the model, and the answer after it
  mentions the tour and names none of the canned restaurants); `language` ("Was steht morgen an?": the prose has at
  least three German function words and at least 70% of the counted function words are German; reasoning is not
  read); `no-runaway` ("Hey": at most 2 requests, no tools, under 600 characters, under 4,000 output tokens);
  `thinking-limit` (reply limit 1,024: done, or the "reply limit per message" notice with a non-empty partial
  answer; never empty, never another error).
- **Output.** A table per scenario (k/N, requests, tokens in/out, seconds, first failed check) and a JSON report
  with every check's reason, requests, tokens and duration per run, and on failure the answer (1,500 characters),
  the activity rows and the last 800 characters of reasoning. Exit 1 if any scenario fails.
- **Cost.** One full run is about 27 model requests (requests are counted at HTTP, so a provider retry counts),
  mostly a few thousand input tokens each: the system text and tool definitions are sent every time. The run
  prints the tokens used and the requests made against that estimate.
- **Differences from production.** Approvals are answered in place (`approve`), not through a durable checkpoint;
  the server note is a copy of pip-runs.js's unexported `NOTE`; compaction, the effort and "enough" judges, and
  device tools are not exercised. `node --test tools/live/selftest.test.mjs` (part of `test:tools`) proves each
  check can fail, against a scripted fake provider.

## What bounds research

Nothing guesses in advance how many lookups a message needs. The judged effort level (none, quick, thorough) is one
sentence of advice in the instructions and caps nothing: capped, "try again" was judged `none` and every search was
refused. Research is bounded by what is real: 12 model requests per reply, 48,000 characters of lookup results, the
five-minute deadline, and for thorough research the "is this enough?" judge on what was found.

Going round in circles is decided by OpenClaw, not counted by Pocket: every lookup tool is wrapped with
`wrapToolWithBeforeToolCallHook` from `openclaw/plugin-sdk/agent-harness-runtime` with loop detection on, scoped to
the reply. It warns the model after 10 identical calls and blocks the call after 20 identical outcomes; a blocked
call ends research for the reply. That module needs the pinned Node version; on an older local Node it cannot load,
lookups run unguarded and one line is logged. Run the suites on the server's Node to exercise it:
`npm exec --package=node@24.16.0 -- npm run test:tools`.

## Native OpenClaw path

> The in-process server loop described below was removed. Production has one reply runtime, the OpenClaw gateway
> (`docs/pip-gateway.md`); this document is kept for the shared concepts and the browser page's own loop.

Pip is a real OpenClaw agent. A chat reply in `drive`
(`src/server/pip-runs.js`) then goes through the gateway's WebSocket operator protocol instead of the in-process loop
or the Responses client-tools path, which both stay as they are and are selected exactly as before when the flag is
off. Assignments and replies with device tools keep the old paths for now.

What OpenClaw owns: the agent loop, the chat's session and its history (one session per Pocket chat, key
`agent:<agent>:pocket-<sha256(account, chat)>`, so a chat uid can never reach another account's session), compaction,
steering into the running turn, memory (memory-core, USER.md, MEMORY.md), instructions (AGENTS.md, SOUL.md,
IDENTITY.md and the `pocket-cards` skill, generated by `services/gateway/config.mjs`), the date and timezone
(`PIP_GATEWAY_TIMEZONE`), limits and loop detection. What Pocket adds are adapters only:

- `src/server/pip-openclaw.js`: Pocket's server as an operator client (`GatewayClient` from
  `openclaw/plugin-sdk/gateway-runtime`, scopes read/write/approvals, caps `tool-events` and `plugin-approvals`).
  `chat.send` carries only the person's message and attached sources; `agent` events (`assistant`, `tool`, `usage`)
  become the turn's answer, activity rows, cards and phase, published to the live socket as before; `chat` final,
  aborted or error ends it. Stop is `chat.abort`. A message sent into the reply (Pocket's `steer`, taken by `take` as
  before) is `chat.send` with `queueMode: "steer"`: OpenClaw injects it into the running turn. (`interrupt` would
  abort the turn and start a new one, so it is not used.) Pocket does not send a system prompt, a recap or history.
- `/internal/pip-tools` on the web process (`toolsEndpoint`): loopback, a per-boot `PIP_TOOLS_TOKEN`, and an answer
  only for a session a running reply registered, with that reply's account, grants and record source.
- `services/gateway/pocket-plugin`: Pocket's tools as an OpenClaw plugin (`definePluginEntry`, one factory per tool,
  schemas and descriptions from `pip-sdk-tools.js`; the list is `src/server/pip-openclaw-tools.js`). Writes
  (`create_record`, `change_record`, `remove_job`) return `requireApproval` from `before_tool_call` with Pocket's
  preview as the title.
- Approvals: `plugin.approval.requested` becomes a pending run request and the run shows `awaiting` (the stretch keeps
  its lease and heartbeat, so `continueRun` leaves it alone); `decideRun` wakes the reply, which resolves with
  `allow-once` or `deny`. The write runs once, only for an approved call id, through `applyApprovedWrite`.
- Cards: `show_card` and `update_card` run in Pocket as before; the fence is placed at the `tool` result event, after
  the text streamed before the call. Working notes before a lookup move to the reasoning, as in the old loop.

What OpenClaw cannot do here, and what happens instead:

- OpenClaw approvals freeze the call's arguments, so a proposed record cannot be edited before approval. The request
  is marked `frozen`; the app offers approve and decline only, and `decideRun` refuses an edited input.
- A plugin approval lives at most ten minutes in OpenClaw (Pocket waited up to twelve hours). When it times out the
  call is blocked there and Pocket settles the request as declined (`expiry`).
- The streamed events report output tokens only; the turn's usage and the daily charge count those.
- A reply runs inside the gateway: if Pocket's process dies meanwhile, the restarted stretch cannot follow that
  OpenClaw run again and ends the turn as interrupted (Continue or retry starts a new one).
- OpenClaw offers every plugin tool on every turn; a tool outside the reply's grants answers `access_disabled`.
- Web search stays Pocket's `search_web` / `read_web_page`: OpenClaw's Firecrawl provider is a separate plugin
  package that is not installed.
- Several writes in one model message are put to the person one after another, not as one group.
- The SSE fallback follower (`runFrames`) streams live frames as `running`, so it shows a native approval only when
  it reconnects; the live socket (what the app uses) reads the record on the `awaiting` event and shows it at once.

Prompt weight for "hi" (measured by `tools/pip-openclaw-native.test.mjs`): the config uses the `minimal` tool profile
plus memory, `skills_read` and Pocket's tools, denies `gateway`, `presence` and `session_status`, turns Tool Search
off and limits skills to `pocket-cards`. The system text drops from about 32,000 to 13,300 characters; Pocket's 18 tool
schemas are about 24,600 characters, the largest part of the request (about 39,000 characters, roughly 9,800 tokens).

Verification: `tools/pip-openclaw-native.test.mjs` runs the real gateway on Node 24 with a fake OpenAI-compatible
model and a real libSQL database (it skips on older Node): a plain reply, a read tool, a card stored as a fence, an
approved save saved once, a declined save, stop, a message steered into the running turn, and a second message in
the same chat that the model sees with the first turn from the session. It prints gateway boot, first-turn and
next-turn latency and the size of the "hi" request.

### What phase 2 can delete once this is on

Chat replies (with routines and assignments moved to the gateway as well, since they share these modules):

- `src/server/pip-agent.js` (the in-process OpenClaw `Agent` loop: limits, research caps, lookup cache, checkpoints,
  card drafts, steering delivery) and `src/server/pip-agent-transport.js`.
- `src/server/pip-compaction.js` (OpenClaw compacts sessions) and the `summary` handling in `src/client/pip-core.js`
  `requestBody` / `src/shared/objects.js`.
- `src/server/pip-effort.js` and `src/shared/pip-effort.js` (effort and "enough" judges, `ENOUGH_STOPS`).
- `src/server/pip-memory-store.js` (`remember` / `forget`, `memoryNote`, `MEMORY_INSTRUCTIONS`); the memory page then
  only shows the workspace files (`src/pages/api/pip/memory.ts`).
- `src/server/pip-gateway.js` and `src/server/pip-gateway-run.js` (the Responses client-tools path, its six-turn
  recap and its own pause/resume), and the `PIP_GATEWAY_CLIENT` / `PIP_GATEWAY_CHAT` flags in `fly.toml`.
- In `src/server/pip-runs.js`: the gateway branch (`useGatewayChat`), the `streamChat` call and everything built only
  for it (`requestBody`, `NOTE`, the date line, `memoryNote`, the effort note, `judgeEffort` / `judgeEnough`,
  `compactChat`, `observations`, `settlementMap` and the checkpoint resume of `continueRun` for chat runs).
- Server use of `src/client/pip-core.js` `SYSTEM`, `requestBody`, `contextCoverage`, `SDK_RESEARCH_INSTRUCTIONS` and
  `CARDS_PROMPT` in the system text (the classic app's browser loop still uses them until it goes), and
  `src/client/pip-limits.js` for the server.
- The memory, update_plan and assignment tools in the server's tool list; `pip-sdk-tools.js` keeps the schemas the
  plugin publishes.
- Tests: `tools/pip-agent.test.mjs`, `tools/pip-agent-transport.test.mjs`, `tools/pip-compaction.test.mjs`,
  `tools/pip-effort.test.mjs`, `tools/pip-gateway.test.mjs`, `tools/pip-gateway-run.test.mjs`,
  `tools/pip-memory-store.test.mjs`, `tools/pip-steer.test.mjs` (in-process delivery; the native steer is covered by
  the native test), the reply-loop cases of `tools/pip-runs.test.mjs` and `tools/pip-run-restart.test.mjs` (a native
  reply is not resumed after a restart), and `tools/live/` (`check:live` drives `streamChat`; a native version would
  drive the gateway). `tools/pip-budget.test.mjs` and `tools/pip-reliability.test.mjs` test the classic app's browser
  loop and go with it, not with this switch.
- The sections "Limits", "Tools", "Steering" (delivery), "Approvals" (checkpoints) and "Compaction" above.

### Native assignments and scheduled reports

Research assignments and non-training scheduled reports use `nativeReply` too.
Assignments accept a self-contained brief; jobs use a stable per-account, per-routine session and pass the job's
instructions and scratch notes as their request. Neither constructs Pocket's conversation replay or injects the
old memory list. `start_assignment` and `update_scratch` are declared in the plugin manifest as well as its config.
Gym and COROS read tools remain available subject to the account's grants.

Pocket enforces an allowed-tool list at both preview and execution: unattended runs cannot save records, change
jobs, or start nested assignments. Only scheduled reports can update their scratch notes. The scheduler and report
delivery still belong to Pocket; this does not migrate scheduling to OpenClaw cron.

The plugin calls the web process. If that process does not own the session, it forwards once to the worker's
`/internal/pip-tools`, on the configured worker port. Both endpoints require loopback and the per-boot token;
the worker never forwards. In native mode a gateway child exit restarts the service instead of advertising a
fallback that native replies do not use.

Training conversations, automatic planning and phone-calendar waits now use the native path too.
Still outstanding: migration of scheduling itself, the sandbox connection, production first-message profiling,
and removal of the non-native runtime and its callers in deployments without the gateway. The
classic browser loop is also retained. Do not delete shared modules while those callers still use them.


### Training and device parity

The native plugin also declares `coros_write` and `update_training_preferences`. Ordinary chat writes still ask
for approval; training runs pass a server-owned `autoApproveTools` list. Their preview must pass the existing
training policy before the plugin skips an interactive approval. Execution checks both the approved tool/arguments
and the planner's current authorization. A paused training conversation can remember preferences, but cannot
schedule workouts or save unrelated notes. Native runs also observe COROS format pages before scoped writes.

Phone-calendar requests retain their device request rows and account checks while the gateway run waits. The
request is answered through `decideRun`; stop cancels the wait, and a ten-minute timeout returns an unavailable
result. No checkpoint/resume loop or model restart is needed for that wait.

The intermediate Responses client and its tests have been deleted, along with `PIP_GATEWAY_CLIENT` and
`PIP_GATEWAY_CHAT`. `docs/pip-gateway.md` describes the current runtime; the earlier phase-2 checklist above is
historical and includes these now-removed files.
