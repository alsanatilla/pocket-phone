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

A message sent while a reply runs in the chat (another tab or device) is refused with code `run_active`: it goes
back to the composer and the tab shows the running reply instead of recording a failed turn.

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
  round cut thinking models off before their call. Each card costs one more model round (the tools and prompt are
  sent again, about 3,400 input tokens with every tool offered; providers that cache the prefix bill most of it as
  cached).

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

## A chat has a numbered log

Every write of a chat records its changes in `pocket_chat_events`, in the same transaction as the stored object
(`writeObject` in `src/server/objects.js`; the events come from `src/shared/chat-log.js` and are numbered by
`src/server/chat-log.js`). The stored object stays the snapshot. A tab that was away asks
`POST /api/objects/chat-events { accountId, chat, after }` and gets `{ events, head, gap }`: the events after its
number, the chat's highest number, and whether the ones just after it were trimmed (then it reads the stored chat).
The `objects` event now carries `seq` for a chat, with the events themselves while they fit in 32,000 characters; a
larger change sends only `seq`. A chat written before the log existed starts it with one event holding the whole chat.
Each log keeps its newest 2,000 events.
