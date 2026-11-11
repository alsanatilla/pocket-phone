# A chat that feels right: the plan and its tasks

Read `docs/agents/GUIDELINES.md` first. Do only the task you were given; only tasks marked **ready** may be started.

## Why

Two things the person feels: a reply does not write fluidly, and Pip sometimes looks things up for far too long.
Of the last 40 finished replies, 20 looked nothing up, 11 made one or two lookups, and 6 made six to ten, taking 30
to 60 seconds before the first word. The limit today is the same for every message (20 calls, 8 web searches).

## Tasks

| # | Task | State |
|---|---|---|
| P1 | The chat lab: the chat in fixed states, photographed and measured | ready |
| P2 | Pip looks up as much as the message deserves (JEV judges before the reply) | ready |
| P3 | Writing is fluid (what P1 measures decides the brief) | not ready |
| P4 | "Is this enough?" after each round of lookups | not ready |
| P5 | Design points (card menu, tiles, empty chat, spacing) | not ready |

---

## P1 — The chat lab (ready)

A script that shows Pip's chat in fixed states and says in numbers how it behaves while a reply is written. Every
later task attaches its pictures and numbers, before and after. It is a tool for people and agents, not a test in
the suite.

### What you build

`tools/manual/chat-lab.mjs`, run as `node tools/manual/chat-lab.mjs [--out <dir>] [--only <state>]`.

Two working scripts exist as starting material; read both before writing anything:

- `/tmp/claude-1000/-data-workspace-pocket-phone/c5f48c1b-1c82-4368-b6cd-2b17434fdce7/scratchpad/blocks-e2e.mjs`:
  starts the real server on a scratch database, signs a browser in, and plays a reply into an open chat through
  `/internal/events`. **Its way of setting up a streaming reply works** (the chat is seeded in the tab's storage and
  the run row is inserted before the page opens the chat).
- `…/scratchpad/audit.mjs`: takes the screenshots of finished chats. Its streaming part does **not** work (the tab
  never attached to the run, because the chat was only written on the server): do not copy that part.

Rules for the script:

- The browser library is not a dependency of the repo. Import it as the other browser tools do:
  `await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')`, Chromium from `process.env.CHROME_PATH ||
  '/usr/bin/chromium'`, headless. On this machine run it with
  `PUPPETEER_MODULE=/tmp/claude-1000/-data-workspace-pocket-phone/c5f48c1b-1c82-4368-b6cd-2b17434fdce7/scratchpad/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js`
  (check that path exists; if the file is elsewhere under that `node_modules/puppeteer-core`, use the entry its
  `package.json` names).
- It needs the Node build: `POCKET_TARGET=node POCKET_ALLOW_PROXY=1 npx astro build`. The script checks that
  `dist/server/entry.mjs` exists and says how to build when it does not. It does not build by itself.
- A scratch libSQL file in a temp directory, a free port, the server stopped and the directory removed in `finally`,
  also when a state fails. Nothing touches `.env`, the real database or the network (no model is called: replies
  are played in).
- Default output directory: `app/build/reports/chat-lab/` (see `tools/live-tiles-browser.mjs`; check it is ignored by
  git, and if not, say so in your report instead of changing `.gitignore`).

### The states

Each state is photographed at 390×844 (phone, device scale 2) and 1280×800, as `<state>-phone.png` and
`<state>-desktop.png`, with the page scrolled where a person would be (the bottom, for a chat with content).

| state | what is on screen |
|---|---|
| `empty` | a new chat |
| `thinking` | a question sent, no word yet (`phase: 'requesting'`) |
| `tool` | one lookup running, one done |
| `writing` | prose half written, mid-sentence |
| `card-building` | a card with two of its four elements arrived |
| `long` | a finished reply: paragraphs, a heading, a list, a table, a code block, a card, sources, folded activity |
| `long-top` | the same chat scrolled to the top |
| `failed` | a turn that failed with an error message |
| `approval` | a reply waiting for the person to approve a note (read the `awaiting` tests in `tools/pip-runs.test.mjs` for the shape of such a turn and its requests) |
| `card-menu` | the menu of a finished card, open |
| `today-pinned` | Today with one pinned card |
| `chat-list` | the list of chats, open, with five chats |

Use German and English text in the seeds, one long word (30 characters) and one long URL, so wrapping is exercised.

### The measurements (state `stream`)

One reply is played in from the first word to the end: about 220 words of prose with a heading, a list, a table, a
code block and one card in the middle, sent as `progress` events every 40 ms, three words at a time, the card element
by element. While it plays, measure in the page and print one JSON object, also written to `stream.json`:

- `frames`: count, and the 50th, 95th and worst frame time in ms (`requestAnimationFrame` deltas).
- `longTasks`: count and total ms (`PerformanceObserver` type `longtask`).
- `layoutShift`: the summed score (`layout-shift`, without recent input).
- `follow`: the distance from the bottom of the page to the bottom of the viewport, sampled each frame: maximum and
  how many samples were above 4 px.
- `swaps`: how often an element already on screen inside the reply was removed and replaced, counted with a
  `MutationObserver` on the reply's container (`childList`, `subtree`): removed element nodes, and removed nodes
  whose text had been visible for more than 100 ms. This is the number for "a block was drawn, then drawn again".
- `markdownRequests`: how many requests went to `/api/markdown` while it played, and their median duration.
- `firstWord`: ms from the first `progress` event with text to that text being in the DOM.
- `settle`: ms from the last event to the last DOM change in the reply.

Run the stream three times and report the median of each number, at phone size.

### Done when

- `node tools/manual/chat-lab.mjs` ends with exit code 0, all 24 pictures and `stream.json` exist, and no picture
  shows raw card JSON, a `pocket` fence or an empty page (assert on the page text for each state; a state that is
  not what its row says fails the run with the state's name).
- Running it twice gives pictures of the same states and numbers in the same range.
- The four commands in GUIDELINES still pass (the lab itself is not part of them).

### Your report adds

The numbers of `stream.json`, the list of pictures, and for each state anything that looks broken to you (text
overflowing, something overlapping, raw Markdown such as a table shown as `| a | b |`). Report what you see; do not
fix the app.

### Files you may touch

`tools/manual/chat-lab.mjs` (new) and nothing else.

---

## P2 — Pip looks up as much as the message deserves (ready)

Before a reply on the server, a fast decision model (JEV, the one the Girder game already uses: read
`src/shared/girder-jev.js` and `src/pages/api/girder/jev.ts`) says how much looking-up the message deserves. That
sets how many lookups the reply may make. Measured on 2026-11-11: JEV answers in about 150 ms and judged 9 of 10
sample messages as a person would.

### 1. `src/shared/pip-effort.js` (+ `.d.ts`): the levels

- `EFFORT_LEVELS = ['none', 'quick', 'thorough']`.
- `effortQuestions()` → the `questions` object for JEV, one choice named `effort`:
  instructions `How much looking-up does a good answer to this message need before the assistant writes?`, criteria
  - `none`: `It can be answered from the conversation and general knowledge: small talk, a rewrite, a calculation, an opinion, a follow-up on what was just said.`
  - `quick`: `It needs one or two lookups: one fact from the person's notes, tasks or calendar, or one web search for a current fact.`
  - `thorough`: `It needs several sources compared or a topic researched, or the person asks for thorough research: a purchase comparison, a plan built from many records, a question where sources disagree.`
- `effortState(turn, earlier)` → the `state` object for JEV: `{ assistant: 'A personal assistant that can read the
  person\'s notes, tasks and calendar and search the web.', message, attached, recent }` where `message` is the
  turn's text (at most 2,000 characters), `attached` the number of sources in `turn.context`, and `recent` the last
  two finished turns before it as `{ asked, answered }` (each at most 400 characters; `answered` through
  `answerText` from `src/shared/pip-reply.js`, so no card source is sent).
- `effortFromAnswers(answers)` → the level, or `null` unless `answers.effort.type === 'choice'` and its `choice` is a
  level.
- `effortLimits(level)` → `{ lookups, webCalls }`: `none` → `{ lookups: 1, webCalls: 0 }`, `quick` →
  `{ lookups: 3, webCalls: 2 }`, `thorough` or anything else → `null` (no change to today's limits).
- `effortNote(level)` → the sentence added to the model's instructions: for `none`
  `Pocket judged that this message needs no looking-up: answer directly; look something up only if you cannot answer without it.`,
  for `quick` `Pocket judged that this message needs one or two lookups: make them and answer.`, otherwise `''`.

### 2. `src/client/pip-stream.js`: a limit on lookups

`streamChat` takes a new option `research` (`{ lookups?: number, webCalls?: number }`, default none).

- A **lookup** is a tool call that is neither a write (`WRITE_TOOLS`) nor a state tool (`STATE_TOOLS`: cards and the
  like). Count them in a new counter beside `calls`. Cards must never be refused because of this limit.
- In `runTool`, where the existing budget condition is: a lookup beyond `research.lookups`, or a web tool beyond
  `research.webCalls` (when given; the existing `RESEARCH_LIMITS.webCalls` still applies as well), gets the existing
  `budgetError` as its answer and sets `finalReason ||= 'Enough looked up for this message'`. Follow how the existing
  condition does both; do not add a second mechanism for ending research.
- The counter survives a pause: find where `calls` and `searches` are stored in and restored from the checkpoint's
  counters, and do the same.
- Without the option nothing changes: every existing test must pass untouched.

### 3. `src/server/pip-effort.js`: asking JEV

`judgeEffort(userId, turn, earlier, { fetcher = fetch, timeoutMs = 1200 } = {})` → `{ level, ms }` or `null`.

- The key is the account's OpenRouter key: `readKey(userId, { provider: 'compatible', baseUrl:
  'https://openrouter.ai/api/v1' })` (`src/server/pip-keys.js`; it throws when there is none). No key, a timeout, a
  response that is not ok, or an answer `effortFromAnswers` does not accept → `null`. It never throws and never logs
  the key.
- The request is the one `jev.ts` sends: `POST JEV_ENDPOINT` with `{ model: JEV_MODEL, state, questions }`,
  `authorization: 'Bearer ' + key`, `'X-Title': 'Pocket'`, `signal: AbortSignal.timeout(timeoutMs)`.

### 4. `src/server/pip-runs.js`, `drive`: using it

- A turn that already has `turn.usage.effort` (a run continued after a pause or a restart) keeps that level and is
  not judged again.
- Otherwise start `judgeEffort` at the top of the `try` in `drive`, without awaiting it, and await it just before
  `streamChat` is called, so it runs while the account and the chat are read. `earlier` is the chat's turns before
  this one.
- With a level: pass `research: effortLimits(level)` (omit when `null`), append `effortNote(level)` to
  `body.instructions` where the date line is appended, and keep `effort: level` in the turn's usage for the whole
  run. Read how `usage` is rebuilt in `onUpdate` and at the end (`total(segment)`, `runtime: 'pocket-server'`) and
  add `effort` in the same places, so it is not lost with the next update.
- Without a level (`null`): exactly today's behaviour, and no `effort` in the usage.
- This is the server-run path only. The tab path and background jobs do not change.

### 5. Tests: `tools/pip-effort.test.mjs` (new)

Setup and helpers copied from the top of `tools/pip-runs.test.mjs`. An account gets an OpenRouter key with
`saveKey` from `src/server/pip-keys.js` (see `tools/pip-jobs.test.mjs` for a call). One `fetcher` serves both: a
request to `JEV_ENDPOINT` is answered with `{ answers: { effort: { type: 'choice', choice: <level> } } }` as JSON,
anything else by the provider double.

1. Shared functions: `effortFromAnswers` (each level; wrong type; unknown choice; missing), `effortLimits`,
   `effortNote`, and `effortState` (lengths cut; `recent` holds the last two finished turns, a card in an answer is
   not sent, a streaming turn is skipped).
2. `none`: the model asks for two lookups (`search_notes`) in one round; the first runs, the second is answered
   with `research_budget_reached`; the reply still finishes with the model's text; the stored turn has
   `usage.effort === 'none'`; the provider's first request carries the `none` note in its instructions.
3. `quick`: three lookups run, the fourth is refused; a `show_card` after that still draws.
4. `thorough`: five lookups all run; no note in the instructions; `usage.effort === 'thorough'`.
5. The request to JEV: its `authorization` is the OpenRouter key, not the chat's key; its body has the model, the
   message and `recent` from the chat's earlier turn.
6. JEV fails (status 500; a rejected fetch; `{ answers: {} }`): the reply runs as today, five lookups all run, the
   stored turn has no `usage.effort`.
7. No OpenRouter key: the fetcher never sees `JEV_ENDPOINT`.
8. A run that pauses for an approval and continues is judged once (count the requests to `JEV_ENDPOINT`) and keeps
   its level; lookups made before the pause count after it.

### Files you may touch

`src/shared/pip-effort.js` + `.d.ts` (new), `src/server/pip-effort.js` (new), `src/client/pip-stream.js`,
`src/server/pip-runs.js` (`drive` only), `tools/pip-effort.test.mjs` (new), a `.d.ts` beside a changed file if
typecheck needs it, `docs/pip-message-flow.md` (append a short section "Pip looks up as much as the message
deserves").

### Do not

Do not change `RESEARCH_LIMITS`. Do not judge on the tab path or in jobs. Do not show the level in the UI. Do not add
a setting. Do not call JEV from the browser.
