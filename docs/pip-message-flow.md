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
| `run` · `progress` | every change of a reply executing in the web process, at most one frame per 33 ms per reply, as deltas (`src/server/pip-frames.js`) with the offset they start at | draws it; a gap (missed frame) asks `resync` for the whole state |
| `run` · `queued`, `started`, `awaiting`, `decision`, `done`, `failed`, `stopped` | each recorded step of a run | reads the run's record once; an open chat with no reply of its own attaches (`ReplyRunner.attach`) |
| `objects`, `documents` | a chat, note, task … was written by any device | pulls within 250 ms |

The worker runs in its own process and forwards its events to the web process over a loopback endpoint with a
per-boot secret (reply progress at most every 400 ms). Commands stay POSTs. Without the socket (Vercel, dev
server, a dropped connection) a tab follows a reply over its SSE stream and syncs on its usual schedule.

A message sent while a reply runs in the chat (another tab or device) is refused with code `run_active`: it goes
back to the composer and the tab shows the running reply instead of recording a failed turn.
