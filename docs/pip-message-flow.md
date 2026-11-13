# How a message to Pip travels today

State of `main` on 2026-11-09. This maps what exists, including where it is inconsistent; it is the basis for
the rework proposed at the end, not a description of a target.

## The chain, station by station

| # | Station | Where | What happens |
|---|---|---|---|
| 1 | Send | `src/app/features/pip/runner.ts` → `ReplyRunner.send` in `src/client/pip-core.js` | The turn is written to the chat in local storage before any paid request. |
| 2 | Choose a path | `ReplyRunner.send`: `remote.available(chat)` → `serverRuns()` in `src/client/pip-remote.js` → `serverRunState` in `src/server/pip-runs.js` | Silent, per message. Server run if the account has a usable key for the chat's endpoint; otherwise the tab runs the reply. |
| 3 | Choose a key | Tab: `resolve()` in `src/client/pip-credentials.js` (account vault via relay, else tab key). Server: `account()` in `src/server/pip-runs.js` (vault key for the chat's endpoint, else the background key for the same endpoint). | Two separate resolvers with different rules. |
| 4 | Build the request | `requestBody` in `src/client/pip-core.js`: system prompt (`SYSTEM` + `CARDS_PROMPT` from `src/shared/pocket-cards.js` + date), replayed history, tool names from `toolNames()` in `src/client/pip-tools.js`. Jobs add text in `runRoutine` (`src/server/pip-background.js`). | Same builder everywhere, extended by string concatenation per caller. |
| 5 | Call the model | `streamChat` in `src/client/pip-stream.js` (AI SDK `ToolLoopAgent`), provider from `providerModel` in `src/client/pip-provider.js` | One engine. It runs in three runtimes: the browser bundle, Vercel functions, and the worker. |
| 6 | Tools | `execute` / `preview` in `src/client/pip-tools.js`; writes wait for approval (`approve`), devices answer device tools | Shared. |
| 7 | Output | `onPart` in `streamChat` appends raw `text-delta` to `result.answer`; when the reply ends, `normalizeAnswer` (`src/shared/pip-reply.js`) stores it in one clean form | Every card becomes a ```pocket fence of flat JSON Lines; tool-call debris and empty cards go. Since the output-filter commit. |
| 8 | Store | Tab: `this.store.save(chat)` → sync to the account. Server: `writeTurn` in `src/server/pip-runs.js` (Turso `pocket_objects`) | Two writers of the same chat object. |
| 9 | Deliver | Tab: `onUpdate` → React. Server: SSE frames `runFrames` → `streamReplyRemote` in `src/client/pip-remote.js` | |
| 10 | Read the answer | React chat (`stream/segments.ts`, the same `segmentAnswer` from `src/shared/pip-reply.js`), classic chat (`src/client/pip.js` + `src/shared/markdown.js`), push text and search (`answerText`: prose only), history replay | Stored answers are clean; the chat still repairs replies while they stream and answers stored before the filter. |

## The four paths

| Path | Model called from | Key | Runtime that runs the code |
|---|---|---|---|
| Tab, direct | the browser | tab-only key | browser bundle |
| Tab, relay | the browser through `/api/pip/relay` | account vault, added by Vercel | browser bundle (+ relay on Vercel) |
| Server run | Vercel queues it (`PIP_RUNS_DETACHED=1`), `services/pip/worker.mjs` runs it | vault key, else background key | **the worker**, whatever code it started with |
| Background job | the worker's scheduler (`runPipJob`) | background key / account key | the worker |

Production queues server runs (`PIP_RUNS_DETACHED=1`): every signed-in reply is answered by the worker process,
which at the time of writing runs on a development sandbox and loads its code once at start.

## What goes wrong because of it (observed on 2026-11-09)

1. **Version skew.** Vercel served the fixed key selection while the worker still ran the old one; an OpenRouter
   chat was sent with the OpenCode background key and failed with 401.
2. **Invisible path.** The same chat can run in the tab one message and on the server the next; an error does not
   say where it came from.
3. **No output boundary.** Gemma wrote a card without its fence, as a nested tree, followed by `</function>`.
   The React chat now repairs this when drawing (`7fe9be5`), but the stored answer is still the raw text:
   - the push text (`excerpt`) shows card JSON for every reply with a card, fenced or not;
   - search indexes the JSON;
   - the classic chat and the server Markdown renderer do not know the repairs;
   - the model re-reads its own malformed card in the replayed history.
4. **Errors translated four times.** Provider → relay → server run → client each rephrase; an unreadable vault key
   reached the user as "could not accept this request (409)" until `a3a74d3`.
5. **The worker is a single process on a sandbox.** If it stops, signed-in Pip does not answer in production.

## Measured (2026-11-09)

A Turso round trip takes about 120 ms from the worker's sandbox in Oregon (database in AWS eu-west-1). Vercel sets
no region, so its functions run in its default region. Each progress write, queue claim and follower poll pays
that; the worker writes progress every 700 ms and followers poll every 250 ms with the whole turn in each frame.

## Proposed shape

1. **One execution place.** Every reply of a signed-in account is a server run; the tab only follows it. The
   tab path stays for guests, using the same pipeline module.
2. **One output boundary, right after the model** (`normalizeReply`): drop tool-call debris, find cards (fenced or
   not), flatten and validate them against the catalog, and store the answer as text plus card specs. Every reader
   (React, classic, push, search, replay) reads that, none parses raw text.
3. **One error shape**: `{ code, where, action }` (e.g. `key_unreadable`, `vault`, `reconnect`) from where it
   happens to the screen, worded once in the client.
4. **The worker deployed with the app** (same commit as Vercel, on a host made for it), or server runs inside the
   Vercel functions (`PIP_RUNS_DETACHED` unset) until then.

## Transport (since the live-socket commit)

Each signed-in tab holds one WebSocket to `/api/live` (`services/server/web.mjs`), authenticated by the session
cookie and Pocket's own origin. The server pushes what happens in the account (`src/server/pocket-events.js`):

| Event | Sent when | The tab does |
|---|---|---|
| `run` · `delta` | every change of a running reply as numbered block changes, at most one per 33 ms per reply (see below) | applies it; a gap asks `run.resume` for what it missed |
| `run` · `queued`, `started`, `awaiting`, `decision`, `done`, `failed`, `stopped` | each recorded step of a run | reads the run's record once; an open chat with no reply of its own attaches (`ReplyRunner.attach`) |
| `objects`, `documents` | a chat, note, task … was written by any device | pulls within 250 ms |

The worker runs in its own process and forwards its events to the web process over a loopback endpoint with a
per-boot secret (reply progress at most every 400 ms). Pip's run commands (submit, decide, continue, stop) go over
the socket too, as requests (`pip.runs`) that the web process hands to `/api/pip/runs` with the socket's session and
origin, so they are checked exactly like a POST. Without the socket (Vercel, dev server, a dropped connection) a
tab sends them as POSTs, follows a reply over its SSE stream and syncs on its usual schedule.

A message sent while a reply runs in the chat waits its turn on the server (see the last section). Only a retry or
continue of a turn while another reply runs is still refused with code `run_active`: it goes back to the composer and
the tab shows the running reply instead of recording a failed turn.

## Cards are a tool call (show_card)

Pip draws only by calling `show_card` (`src/client/pip-sdk-tools.js`, behaviour in `src/shared/pocket-card-tool.js`).
The model never writes a card into its answer text; the system prompt says when to draw, the tool's description says
what can be drawn.

- **Checked before it shows.** `cardProblems` tests the card (known components and props, children that exist,
  chart points that are numbers, table rows that match their columns, everything reachable from the root). An
  invalid card is answered with those problems and the model calls again; nothing broken reaches the person.
- **Placed where it was called.** A drawn card is inserted into the answer at that point as a `pocket` fence of
  flat JSON Lines (`cardFence`), so every reader of a stored answer keeps working. Text before a card stays in the
  answer; text before a lookup is still working notes.
- **Builds while written.** The elements already complete in the streamed arguments stand in the answer as an open
  fence (`draftLines`), replaced by the checked card when the call completes.
- **Never replayed as a format.** History shows `[card drawn here with show_card: …]` (`cardsAsRecords`).
- **Budget.** A round may use the reply's remaining tokens less the reserve for the closing text; a fixed 2,048 per
  round cut thinking models off before their call. Lookups have their own budget (`RESEARCH_LIMITS.researchTokens`,
  16,000): a round that ends in tool calls without drawing a card (lookups, the plan, a save) is working, not
  answering, and is charged there; a round that writes text or draws a card is charged to the answer. A round that
  is not final may use at most what the lookups' budget has left plus the reserve. When that budget runs out,
  research ends and the reply writes its answer with the answer budget that is left; in a final round the lookups'
  budget pays only what it still has and the answer the rest.
- **Thinking after lookups.** A model whose provider reports reasoning tokens (GLM 5.3 thinks before every call and
  before the answer) gets, once it has looked something up, what is left of the lookups' budget on top of each
  round's allowance, and the thinking of a round that writes is paid from there while it lasts; its text is paid
  from the answer's. Before, GLM thought through the whole 3,072-token allowance before a thorough answer, was cut
  off, got the 1,024 left, was cut off again and failed with "The configured reply token limit was reached". A
  reply without lookups, or from a model that reports no reasoning, is charged as before.
- **The ceiling.** Every round lowers what the reply may still spend by what it cost (a round without reported usage
  costs its whole allowance), so one reply's output stays within `maxTokens` + 16,000 + the reserve: 21,120 tokens
  at `maxTokens` 4,096, as before the thinking rule. With lookups, an answer's text may now be longer than
  `maxTokens` when the lookups left tokens over.
- **Thinking kept.** The thinking a reply shows is kept to at most 24,000 characters: past that it drops to its last
  16,000 (a thorough GLM reply thinks more than that, and the reply used to fail with "This reply is too large").

Measured on 2026-11-09 with the real pipeline, four requests each (chart, table, choices, tiles): DeepSeek V4.1
Flash 4/4, GLM 5.3 4/4 (two after one correction), Kimi K3.1 Pro 4/4.

## A reply streams as numbered block changes

A reply is a list of blocks (prose, and cards where Pip drew them). While a reply runs, followers get changes to
those blocks, not text to parse (`src/shared/pip-blocks.js`, used by both ends):

- **One encoder per run, in the web process** (`src/server/pip-run-stream.js`). It takes the run's turn as it changes
  (from a reply executing here, or forwarded by the worker), cuts the answer into blocks once, and publishes what
  changed since its last event: `{ kind: 'delta', runId, chat, requestId, seq, ops }`, at most one per 33 ms. Ops:
  `add`, `append`, `set`, `close`, `cut` for blocks; `think`/`thought` for reasoning; `meta` for activity, sources,
  phase, model and usage when they changed; `reset` for the whole state.
- **Every socket of the account gets the same events.** A socket that cannot keep up skips some.
- **Numbers make it resumable.** A tab applies event `seq` only after `seq - 1`. On a gap, or when it joins mid-way,
  it asks `run.resume { runId, after }` and gets the events it missed from the last 400, or the whole state as one
  `reset`.
- **The chat draws blocks as they are** (`Answer` takes `blocks`); nothing in the browser parses the answer while it
  streams. The record read on a step of the run is a checkpoint and never moves the screen backwards.
- **Stored answers are unchanged**: the finished turn is the normalized text (prose and `pocket` fences), which is
  the same blocks written out. Blocks are never stored on a turn.
- A tab without the socket still follows over SSE with text deltas (`pip-frames.js`), and leaves that stream as soon
  as the socket connects.

## Cards stay alive (update_card)

A drawn card has an id (`/id` line in its fence, told to the model in `show_card`'s result and in the record of an
earlier reply: `[card <id> drawn here with show_card: …; change it with update_card]`).

- **`update_card { id, root, elements }`** replaces that card where it stands (`replaceCard`), checked like a new one.
  In the running reply it changes the answer; in an earlier turn it changes that turn, stamps the card (`/updated`)
  and hands the turn to the path that keeps the chat (`saveTurn`): the tab's store, `writeTurn` on a server run, or
  the job's write of the chat when it ends. An unknown id is answered with the ids that exist.
- **A standing watch keeps a card current without a message**: it updates the card and answers SKIP; the chat is
  written, no turn is added and nothing is pushed.
- **Open tabs redraw it** through the usual `objects` event and pull (about half a second), and show "updated <time>".
- **A record is never part of an answer**: a model that copies such a line into its text loses it in `segmentAnswer`
  (`CARD_RECORD`), while it streams and when it is stored.

Measured on 2026-11-10 with `tools/manual/card-update-real.mjs` (draw, then ask for a change; two cases per model):
GLM 5.3 2/2, DeepSeek V4.1 Flash 2/2, Kimi K3.1 Pro 1/2 (the card was changed in all six).

## The person can pin, remove and point at a card

- **Pin.** A pinned card carries one more mark in its fence, after `/updated` and before `/root`:
  `{"op":"add","path":"/pinned","value":<time>}`. The card is the same card, not a copy: `pinCard` rewrites its fence
  with that mark, and `pinnedCards` (`src/app/data/cards.ts`) lists every pinned card in a chat that is not deleted,
  newest pin first. `update_card` reads the old card's pin and keeps it when it rebuilds the fence.
- **Remove.** `dropCard` takes the fence out and `normalizeAnswer` closes the blank lines around it. A turn that held
  only a card stays, with an empty answer.
- **Point at one.** A message that asks about one card ends with `[about card <id>]` on its own last line. It is
  ordinary text, so every path carries it; `aboutCard` and `withCard` read and write it, and `update_card` changes
  that card. The cards prompt tells the model what such a message means.
- **Keep current.** A pinned card with a web source gets a watch routine of its own (`src/app/data/card-watch.ts`):
  it answers in the card's chat, reads the source every six hours, changes the card with `update_card` and answers
  `SKIP` when only the figures moved. A routine can name its chat (`chat`, `card`), and such a watch is never
  skipped for "nothing new in the workspace".
- **A threshold.** `/alert` (`{"op":"add","path":"/alert","value":{"below":850}}`, after `/pinned`, before `/root`)
  is a figure the person wants to be told about. It survives `update_card` and every rewrite; setting it pins the
  card and puts the threshold into the watch's prompt.
- `pinCard`, `dropCard`, `alertCard`, `cardsIn`, `aboutCard` and `withCard` are in `src/shared/pocket-card-edit.js`;
  a turn with `status: streaming` is never changed.

## A chat has a numbered log

Every write of a chat records its changes in `pocket_chat_events`, in the same transaction as the stored object
(`writeObject` in `src/server/objects.js`; the events come from `src/shared/chat-log.js` and are numbered by
`src/server/chat-log.js`). The stored object stays the snapshot. A tab that was away asks
`POST /api/objects/chat-events { accountId, chat, after }` and gets `{ events, head, gap }`: the events after its
number, the chat's highest number, and whether the ones just after it were trimmed (then it reads the stored chat).
The `objects` event now carries `seq` for a chat, with the events themselves while they fit in 32,000 characters; a
larger change sends only `seq`. A chat written before the log existed starts it with one event holding the whole chat.
Each log keeps its newest 2,000 events.

A tab that holds a clean copy of a chat keeps its number beside the chat (`src/client/chat-follow.js`). When the
`objects` event carries the changes and they continue that number exactly, the tab applies them and writes the new
chat; when the event has only `seq`, or the changes do not fit, it asks `chat.events` over the socket (or the same POST)
and applies the answer. A copy with a local edit, an unknown number, or a gap in the log still pulls the whole chat as
before, and a pull writes the number it took the chat at.

## A reply survives a restart

A reply whose process stopped while it ran is continued once. The next page view in the server process (`recover` in
`src/server/pip-runs.js`) or the worker's sweep claims the run with one conditional update: it must still be
`running`, its lease must have expired, it must have no `restarted` event and it must be younger than ten minutes.
The claim clears the unfinished answer, keeps the completed lookups in its activity, records `restarted` and hands
the run to `drive`, which reuses those lookups. A reply that dies again fails with the existing interrupted message.
A page view outside the server process never restarts a run, it ends it as before; the sweep does the restarting
there and counts it as `restarted`.

On SIGTERM or SIGINT the web process and the worker give running replies 20 seconds to finish (`drainRuns`); one
still running then is let go: it stops and its lease is set to 0, so the next process continues it at once instead
of waiting for the lease to expire. A tab that hears `restarted` forgets the changes it had applied and takes the
reply from its start again.

## Pip looks up as much as the message deserves

Before a server reply, `drive` asks JEV (`judgeEffort` in `src/server/pip-effort.js`) how much looking-up the
message needs. It is the same decisions API the Girder game uses, read with the account's OpenRouter key; the levels
and the sentence the model reads are in `src/shared/pip-effort.js`.

- The question is one choice named `effort`: `none`, `quick` or `thorough`. The state is the message (up to 2,000
  characters), how many sources are attached, and the last two finished turns (requests and prose answers, never a
  card's source).
- `none` allows one lookup and no web call, `quick` three lookups and two web calls, `thorough` ten lookups and five
  web calls. `streamChat` counts a lookup as any tool call that is neither a write nor a state tool, and the lookup
  beyond the level is answered with `research_budget_reached`, so the model answers from what it has. Cards are
  never refused by this limit.
- A lookup asked for after the reply has turned final (a limit was reached, or the lookups' own budget ran out) is
  answered the same way instead of failing the reply: the model gets `research_budget_reached` and writes with what
  it has. That is tolerated in two rounds of the reply, kept in the run's checkpoint like the other counters; the
  round after the second is sent with no tools and `tool_choice: none`, and a provider that calls a tool anyway
  fails the reply as before. Writes and state tools in a final round behave as they did.
- The level is judged once per run and kept in `usage.effort`. A run continued after a pause or a restart keeps it
  without asking again, and the lookups it made before the pause count after it.
- No OpenRouter key, no answer within 1.2 seconds, a refused request or an answer that is not one of the levels:
  the reply runs exactly as before and its usage carries no `effort`. The tab path and scheduled jobs are never
  judged.
- Between rounds, a `thorough` reply also asks JEV whether what it has found is enough: `enoughQuestions` and
  `enoughState` in `src/shared/pip-effort.js`, sent by `judgeEnough` in `src/server/pip-effort.js`. The state is
  the message and the last twelve finished lookups, each as its title and the start of its result; cards, writes
  and failed rows are left out. It is asked at most six times, only after new lookups and only while the reply is
  not already final. The count and the lookups last asked about are kept in the run's checkpoint, so a pause does
  not ask again about the same lookups.
- A yes is recorded, not acted on: `drive` passes `enough` only for `thorough`, the callback always tells
  `streamChat` false, and the first yes is kept as `usage.enoughAt` (the lookups made when it came), with
  `usage.enoughAsked` beside it. `ENOUGH_STOPS` in `src/server/pip-runs.js` is off; when the lead switches it on
  (or sets `PIP_ENOUGH_STOPS=1`), a yes ends research through `finalReason`, later lookups are answered with
  `research_budget_reached`, and cards may still draw.
- A thorough reply ends with the model's own answer, also from a model that thinks before every call: the
  thinking after the lookups is paid from what the lookups' budget has left (see "Budget" and "Thinking after
  lookups" under "Cards are a tool call"). Measured on 2026-11-13 with `tools/manual/thorough-real.mjs` (two
  thorough questions over six short notes, the real server path): before, GLM 5.3 failed three of four with "The
  configured reply token limit was reached"; after, DeepSeek V4.1 Flash answered 6 of 6 (41 to 83 s) and GLM 5.3
  9 of 10 (33 to 127 s), the tenth having written its answer and then asked to save a note, which waits for the
  person's approval. GLM's answer rounds thought 5,000 to 11,000 tokens, so its thorough replies stay slow.

## Pip remembers the person

A short list of lasting facts about the person (how they like answers, what they work towards, who someone is to
them) that Pip adds to while it talks and reads in every reply and job. Built in Pocket on purpose: a memory library
would add a second model provider and remember without showing what.

- **The list.** `pocket_pip_memory` holds at most 100 entries of up to 300 characters per account, each with an id of
  `m` and six random characters, the chat it was learned in and when. `remember`, `forget`, `listMemory` and
  `memoryNote` are in `src/server/pip-memory-store.js`: text is trimmed and its whitespace collapsed, equal text in
  any case is the same fact, and the count check and the write share one transaction, so a message sent twice adds
  one entry. A change publishes `{ type: 'memory' }` after the write.
- **The tools.** `remember { text, replaces? }` and `forget { id }` are state tools, so a call never counts as a
  lookup and is never replayed as an observation. They are offered only when the value given to `streamChat` says
  `memory: true`, which `drive` and `runRoutine` set; nothing sets it on the tab path, so a reply that runs in the
  browser has no memory.
- **What the model reads.** Both paths read `listMemory` once while they build the request and append `memoryNote`
  (one line per entry with its id) and a paragraph telling Pip to remember sparingly. A fact saved during a reply is
  in the list from that reply's next request on, never in the reply that saved it.
- **The person's copy.** `GET /api/pip/memory` returns the list; `POST { accountId, action, id?, text? }` adds one,
  edits one (`replaces`, 404 when it is gone) or forgets one, and answers the list after the change. The page that
  shows it is a later task.

## One big chat

Opening Pip lands in one ongoing conversation, kept as a chain of ordinary chats marked `home: true`
(`src/shared/pip-home.js`). The segment created last takes the next message; when it holds 60 turns or 400,000
characters, the next message starts a new one, and nothing is moved. The page shows the segments joined, oldest
first. A server reply in a home segment also reads the last six finished turns of the segment before it and puts
them before its own turns in the request only; `writeTurn` still stores just the new turn in the current segment.

On screen, `/pip` without a `chat` in the address is home; `?chat=<uid>` is a separate chat, and a link that names
a home segment replaces the address with `/pip`. The joined conversation shows its last 30 turns, with `earlier
messages` adding 30 more without moving the message at the top of the screen. The chat list keeps a `pip` row above
the separate chats and leaves the segments out of its count. `withContext` (the app's "ask pip" buttons) adds a
source to the chat last opened, or to home when there is none.


## A message sent while Pip replies waits its turn

Pip is someone the person hands work to without waiting. A message sent while a reply runs in a chat is accepted
and answered next, on the server, with no tab open (`src/server/pip-runs.js`, from "A message sent while Pip replies
waits its turn" down).

**Where the queue lives.** In the run records: a queued message is a row of `pocket_pip_runs` with status
`waiting`. That table already has what the queue needs: the client's `requestId` under a unique key (a retried submit
finds the same row), the turn the person wrote, the device, and the run events every tab hears. No new table, no new
column. Nothing is written to the chat until the message starts, so its segment, model and key are decided then.
While it waits, the row's `config` holds the request it will start with (`{ lane, header, grants, timezone }`); when
it starts it holds the run's settings like every other run, plus `lane`.

A chat's queue is its **lane**: the chat itself, or `home` for every segment of the one big chat (a reply runs in one
segment while the next message may belong in a new one). A lane is busy while it has a run that is `queued`,
`running`, `awaiting` or `stopping`: for a chat, a run in that chat; for home, a run in any home segment or a run a
queued home message started (its `config.lane`, which covers a new segment whose chat is not written yet).

| State | Meaning | Left by |
|---|---|---|
| `waiting` | sent while the lane was busy; starts when it is free, oldest first | start, take back, a stop (→ `held`) |
| `held` | the person stopped the reply in front of it | `resume` (→ `waiting`), `clear` or take back (→ `withdrawn`) |
| `withdrawn` | taken back before it started; never shown, never run | — |
| then as any run | `running` (or `queued` for a worker), `awaiting`, `done`, `failed`, `stopped` | |

`serverRunState` and `runView` never treat a `waiting`, `held` or `withdrawn` row as the chat's run.

**How a message joins.** `submitRun` looks at the lane first: busy, or with `waiting` messages already, and the
message is queued (`queueMessage`): the count and the insert share one transaction, the run event `waiting` is
recorded, and the answer is the row (status `waiting`). Its key, budget and segment are not checked then. A submit that
loses the race for the chat's unique index to another device is queued the same way.

**How the next one starts.** When a run stops being active (`done`, `failed`, `stopped`, or ended because its process
died), whatever ended it calls `settleLane`: after a stop it pauses the lane, otherwise it starts the lane's oldest
`waiting` message (`startNext`). That happens after `drive` has charged the tokens the ended reply spent. The start
is one conditional update: the row must still be `waiting` and nothing may be busy in the lane, so of two processes
starting the same lane one wins; the chat's unique index on active runs refuses it too. A message that a submit would
refuse at that moment (no key for its provider any more, today's token limit reached, the chat removed or full) ends
as a failed turn in its chat with the same sentence a submit would have given, and the next one is tried. A home
message goes to the segment `homeForSend` would choose then: the newest home segment, or a new one when that is
full (a failure is written to the newest segment, so no segment is created for it). A reply ends in the segment it
started in.

Who calls `startNext`: on the long-running server (`PIP_RUNS_MODE=inprocess`) the process that ran the reply, in the
background; with a worker (`PIP_RUNS_DETACHED=1`) the worker step that ended it, which hands the next one to the
worker queue (`queued`); elsewhere (Vercel, dev) the request that ran the reply runs the next one too, within the same
request, one stretch per reply.

**Survives a restart.** The rows are in the database. A reply that was running when the process stopped is continued
or ended as before ("A reply survives a restart"), and its end starts the next one. A lane that has `waiting`
messages and nothing busy (the process stopped between one end and the next start) is started by the worker's sweep
(`sweepRuns`, counted as `advanced`), and on the long-running server also by the next read of the queue.

**Approval.** A reply waiting for the person's decision keeps the lane busy: queued messages wait until it is decided
(or expires, or is stopped). The composer then says in one dim line: "Queued messages start once you decide the
change above."

**Stop.** Stopping the reply ends that reply and pauses the lane: its `waiting` messages become `held`. The thread then
shows them marked `paused`, and after them one line, `2 messages wait`, with two keys, `resume` and `clear`. A stop
usually means "not like this": starting the next message at once would answer something the person may no longer
want, and dropping them silently would lose what they wrote. A new message sent while the lane is paused and idle
starts at once; the held ones keep waiting for resume or clear.

**Limits.** At most five messages wait per lane (`waiting` and `held`); the sixth is refused with code `queue_full`
and "Five messages already wait in this chat. Send this one when Pip has answered one of them.", and goes back to the
composer. A retry or continue of a turn while the lane is busy is still refused with `run_active`.

**Every device sees the same queue.** Each change is a run event (`waiting`, `withdrawn`, `held`, `resumed`, and the
usual `started`, `done`, …) on the live socket. An open chat reads its lane's queue again (`action: 'queue'`, which
answers `{ queue, active }`) after any step of a run, at most once per 100 ms, and when its socket connects. Take
back, resume and clear are run commands too (`withdraw { runId }`, `resume { chat }`, `clear { chat }`), safe to
repeat, and answer the queue.

**On screen.** While a reply runs in a chat on the server, the composer keeps its field and, once something is typed,
shows the send key beside the stop key. A queued message is drawn after the last turn as the person's next question,
with a dim `›` (it has not been asked yet, and amber stays for what is live), and under it one line like a card's: the
dim word `queued` (or `paused`) and one quiet key, `take back`. A queued message the server has already written into
the chat is shown as the chat's turn and no longer as queued.

**Guests and the tab path** have no queue: a reply that runs in the tab keeps today's behaviour (the composer sends
nothing while it runs). There is no second queue in the browser.

## Jobs are set up by saying so, and report into the big chat

"Remind me every Monday at 8 to check the bike prices." "Each evening, tell me what is due tomorrow." "Stop the
Monday reminder." Pip hands work to itself without a form, and what it does on its own lands in the one big chat.

**The tools** (`src/server/pip-job-tools.js`, schemas in `src/client/pip-sdk-tools.js`):

| Tool | Does | Saved |
|---|---|---|
| `list_jobs {}` | the account's jobs: id, name, kind, schedule, on or paused, where it reports, the next run, whether Pip on its own is on | read only |
| `create_job { kind, title, prompt?, time?, days?, every?, at?, active_from?, active_until?, quiet?, to? }` | a scheduled prompt, standing watch, check-in or brief | at once |
| `change_job { id, …the same, enabled? }` | changes, pauses (`enabled: false`) or resumes one | at once |
| `remove_job { id }` | removes one | after the person approves |

- **The validator is the contract.** The tools take exactly what `backgroundRoutine` / `saveRoutine` take, in
  words a model gets right: days as `mon`…`sun`, a moment as `YYYY-MM-DD HH:MM`, active hours as two clocks. They
  are turned into the routine and saved with `saveRoutine`; whatever it refuses (no name, every 5 minutes, a moment
  in the past, the thirteenth job) comes back as `{ error: 'invalid_job', message }` with its own sentence, and the
  model corrects itself. The schemas only check types, so the sentence, not a schema error, is what the model reads.
- **Times are in the account's timezone**, the one in the background settings, which `list_jobs` and every result
  name. A moment is turned into an instant there (`zonedTime`). Before Pip on its own is set up there is no such
  setting; the chat's timezone (the device's, sent with the message) stands in, so "tomorrow at 18:30" is still the
  person's 18:30. Such a job is saved but does not run until Pip on its own is on: the result says `off: true` and the
  line under the reply ends in `· pip on its own is off`.
- **The training planner is not reachable**: the kinds are the four above, and `change_job` / `remove_job` refuse
  the planner's id.
- **The model and the key.** A job runs as every job does: with the provider, model and key of Pip on its own (the
  background settings, the dedicated key or the account key they name). A job created in conversation does not
  carry the chat's model: there is one way a job chooses its model, and the background settings are it. When the
  person's chat uses the same model (the usual case: `/jobs` turns Pip on its own on with the chat's model) nothing
  changes; when they differ, the Jobs page shows the job's model as it does today.
- **Saving is idempotent.** A job created in a reply gets an id derived from the chat, the turn and the tool call,
  so a reply that is continued after a restart and calls again updates the same job instead of adding one. A second
  `create_job` for a job that exists already (the same kind, name, ignoring case, instruction and schedule) saves
  nothing and answers with the one that exists (`existing: true`). A `remove_job` whose job is gone by the time it
  runs (a decision sent twice, a reply continued after a restart) answers `job_not_found` with "removed already".

**Seen and undone.** Create, change, pause and resume save at once, like memory: the person sees a dim line under
the reply (`scheduled: Mon 08:00 · Bike prices`, `paused: …`, `resumed: …`, `changed: …`) with a link to `jobs`,
where every job can be edited, paused or removed by hand; asking Pip ("stop that") undoes it in conversation.
Removing needs approval first (`remove_job` is a write tool, so the run pauses at an approval card like a note or a
task), because it cannot be undone: the job's notes go with it. Asking before every creation would add a tap to the
one thing the person asked for in words, and a wrong creation is harmless and visible; a wrong removal is neither.

**Limits and safety.**

- The existing limit of 12 jobs and the daily token limit apply unchanged (`saveRoutine`, `runRoutine`).
- **A job never has more access than the chat that created it.** `create_job` stores the chat's record grants
  (within Pip on its own's grants) as the job's `grants` and whether the chat could use the web as `web`; `runRoutine`
  runs the job with the background grants narrowed to those, and without web search when `web` is false.
  `change_job` narrows them further to the changing chat's. A job without `grants` (made on the Jobs page) runs with
  the background grants as before.
- **A job never creates jobs.** The tools are offered only when the run's value says `jobs: true`, which only `drive`
  sets (server runs, like `memory: true`). `runRoutine` never sets it, and `permitted` refuses the tools to any value
  with `backgroundJob`. The tab path never sets it either.

**Where a job reports: `to`.** A job has `to: 'home' | 'own'`. `own` is today's behaviour: one chat per job and
month (`Pip · Nightly brief`). `home` writes the report as a turn in the current home segment. Jobs created in
conversation default to `home`; jobs that exist keep `own` (a stored job without `to` reads as `own`) until the
person changes it in the job's editor (one `Switch`, "report in pip"). A watch that keeps a card current (`chat` set)
answers in the card's chat as before and is always `own`.

- **The segment.** `runRoutine` reads the home segments (`homeSegments`), takes the current one (`currentHome`) and,
  when it is full (`homeFull`) or there is none, a new segment made in memory with the marks the app gives one
  (`home`, `title: pip`, `titled`, the previous segment's config). It is written only when the job writes its turn,
  so a job that has nothing to say never makes an empty segment. The segment is chosen when the job starts and the
  turn ends there.
- **The turn.** The model is sent the job's full instruction, as today. The stored turn's text is the job's name and
  `(job)`, e.g. `› Bike prices (job)`, in the existing turn shape; its owner stays `pip-routine`. Only a finished
  report is written: a watch that answers SKIP writes nothing, and a failed run writes nothing to the big chat (the
  failure shows on the Jobs page and pushes once per streak, as before) because a failed turn there would offer the
  person "continue" and "start over" for a message they never sent.
- **What the model sees.** The job reads the segment, plus the tail of the segment before it (`homeTail`), as its
  earlier turns: its own earlier reports are there, which a watch needs to stay quiet about what it said, and so are
  its cards. When the person later talks in the home chat, the job's turns are ordinary earlier turns: the request
  is the job's name, the answer is the report. Nothing marks them further: the person reads them in the chat, and
  the model should be able to answer "what did the bike job say?".
- **A card in an earlier turn.** `update_card` searches the turns the job sees, newest first, including the tail
  of the previous segment. The changed turn is written at once to the segment that holds it (`appendTurns`), so a
  watch that only moved a figure and answers SKIP still keeps the card current, wherever it stands.
- **At the same time as the person.** A job never takes the chat's active-run slot (`pocket_pip_runs`, which
  refuses a second run with `run_active`): it runs outside it, holds its turn in memory and writes it once, when it
  finishes, with `appendTurns`. `writeObject` merges by turn id inside one transaction, so the person's streaming
  turn and the job's report both stay, ordered by when each started. The person is never refused because a job
  runs, and a job is never refused because the person is talking.
- **Delivered once.** A scheduled run's turn id is derived from the job and the scheduled time it was claimed for. A
  run repeated for the same time (the process stopped after the report was written and before the next time was
  saved, so the lock ran out and the job was due again) finds that turn in a home segment, sends no request and
  writes nothing. "run now" from the Jobs page is a new report each time.
- **Notifications** link to the segment (which opens home) and are titled `Pip · <job name>`.
