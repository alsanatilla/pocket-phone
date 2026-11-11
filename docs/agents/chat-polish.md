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
| P3 | Writing is fluid: a trial of Streamdown for the reply's text | ready |
| P4 | "Is this enough?" after each round of lookups, first only recorded | ready |
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

---

## P3 — A trial: the reply's text drawn by Streamdown (ready)

### What the lab measured (2026-11-11, phone size, median of three)

While one reply of about 220 words is written: **31 elements already on screen were removed and drawn again, 15 of
them after being visible for more than 100 ms**; layout shift 0.4; the view was up to 126 px behind the text in 29
frames; 12 requests to `/api/markdown`. Frames themselves are steady (16.7 ms). So the reply does not stutter
because the browser is slow: it stutters because each finished block is first drawn as an approximation
(`Pending` in `src/app/features/pip/stream/Prose.tsx`), then replaced by HTML the server rendered, and the whole
reply is replaced once more when it ends.

### The trial

Replace that mechanism, for a reply's prose only, with **Streamdown** (`streamdown@2.7.1`, Apache-2.0, by Vercel):
a React component made for Markdown that is still being written. It renders in the browser, keeps finished blocks
mounted and completes unfinished syntax, so nothing is requested from the server and nothing is swapped.

This is a trial on a branch. It is merged only if the numbers and the pictures are better; say plainly if they are
not.

1. `npm install streamdown@2.7.1` (exactly this version; it is the one dependency this task adds). Read its README
   and types in `node_modules/streamdown` first: how it is told that text is still streaming, which plugins exist
   for code highlighting, math and diagrams, and how its styles reach Tailwind v4 (`@source` in the app's CSS).
   **Do not enable plugins for math or diagrams.** Code highlighting only if it comes without loading a highlighter
   for every language up front; otherwise leave code blocks plain and say so.
2. `src/app/features/pip/stream/Prose.tsx`: `Prose` keeps its props (`text`, `streaming`, `className`) and renders
   through Streamdown. `Pending`, `Block` and `useRenderedMarkdown` stay exported if anything else imports them
   (`grep -rn` before removing); nothing else in the app changes its imports.
3. Looks: a reply must look as it does now. The app styles rendered Markdown through the `prose` class and classes
   such as `md-table` in `src/app/styles/global.css`; Streamdown brings its own classes. Use its `components` (or
   class options) so headings, paragraphs, lists, links, tables, code and quotes get Pocket's existing styles, fonts
   and colours. No new colours, no new fonts, no rounded "chat bubble" styles from the library. Links open as they do
   today (read how the current renderer treats links and keep that: same-tab or new-tab, `rel`).
4. Safety: the current renderer sanitizes on the server. Read what Streamdown does with raw HTML in Markdown and
   with link and image URLs (its hardening options) and set it so that raw HTML is not rendered and only `http`,
   `https` and `mailto` links work. Say in the report what you set and what you verified.
5. The caret at the end of the text while it streams stays (class `caret`; see `Pending`).

### Measure

Build (`POCKET_TARGET=node POCKET_ALLOW_PROXY=1 npx astro build`) and run the lab before your change and after it:

```
PUPPETEER_MODULE=/tmp/claude-1000/-data-workspace-pocket-phone/c5f48c1b-1c82-4368-b6cd-2b17434fdce7/scratchpad/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js \
  node tools/manual/chat-lab.mjs --out app/build/reports/chat-lab-before   # then …-after
```

Targets: `swaps.visible` 2 or fewer (from 15), `markdownRequests.count` 0 (from 12), `layoutShift` below 0.1 (from
0.4), frames no worse. Also record the size of the built client JavaScript before and after
(`du -sb dist/client/_astro` and the five largest files): the trial fails if the page's first load grows by more
than 150 kB gzipped, unless the growth is in a chunk that is only loaded when a reply is shown; say which.

Compare the pictures `long`, `long-top`, `writing`, `card-building`, `failed` at both sizes, before and after, and
list every visible difference. The lab's own check for raw Markdown must still pass.

### Tests

`src/app/features/pip/stream/stream.test.tsx` and `Turn.test.tsx` test the current rendering. Read them. Tests that
assert *what the person sees* (text present, no raw Markdown, a table is a table, the caret while streaming) must
pass, adapted only where they reach into the old mechanism (for example waiting for a server render). Do not delete
a test; list each one you changed and why. Add: a table, a code block and a list each render as such from text
alone with no request made (assert `fetch` was not called); half-written Markdown (`**bold` without its end, an
open code fence, a table with only its header) shows no stray syntax characters; raw HTML in the text is not
rendered as elements.

### Files you may touch

`package.json` and `package-lock.json` (the one dependency), `src/app/features/pip/stream/Prose.tsx`,
`src/app/styles/global.css` (the `@source` line and style rules for the reply's Markdown only),
`src/app/features/pip/stream/stream.test.tsx`, `src/app/features/pip/Turn.test.tsx`, `segments.ts` beside it only to
remove helpers nothing uses any more.

### Do not

Do not touch the server renderer, `/api/markdown`, notes, or the classic app: they keep using it. Do not change
scrolling (`PipPage.tsx`); that is the next task. Do not merge or push.

### Your report adds

Both `stream.json` medians side by side, the bundle sizes, the list of visible differences, what you set for
safety, and your own judgement: better, same or worse, and why.

---

## P4 — "Is this enough?" after each round of lookups, first only recorded (ready)

P2 is live: JEV names a level before the reply, and `none` and `quick` cap the lookups. `thorough` has no cap, and
that is where replies still run away: asked to compare two cars from six notes, DeepSeek made 11 to 18 searches and
one reply failed. This task lets JEV say, between rounds, whether what was found is enough to answer. **In this
task its answer is only recorded, never acted on**: a wrong "enough" would make answers worse, so the lead compares
the record with real replies before it may stop anything.

Read `docs/agents/chat-polish.md` P2 and the code it added (`src/shared/pip-effort.js`, `src/server/pip-effort.js`,
the `research` option in `src/client/pip-stream.js`, `drive` in `src/server/pip-runs.js`) before anything else.

### 1. `src/client/pip-stream.js`: a question between rounds

The `research` option gains `enough?: (state) => Promise<boolean> | boolean`.

- It is asked in `prepareStep`, at the start of a round, only when all hold: it is given; lookups (the counter P2
  added) were made since it was last asked; the reply is not already in its final rounds (`final` would be true
  without it). `state` is `{ lookups, rounds: currentRound }`. Read the AI SDK's types for `prepareStep` in
  `node_modules/ai` to confirm it may be async, and make it async only if it may; if it may not, stop and report.
- When it resolves `true`: `finalReason ||= 'Enough looked up for this message'`, so the round that starts is a
  final round through the existing path. Anything else (false, a throw, a rejection) changes nothing; a throw is
  swallowed.
- It is asked at most 6 times in a reply.
- Without the option nothing changes.

### 2. `src/shared/pip-effort.js` and `src/server/pip-effort.js`: asking JEV

- `enoughQuestions()` → one choice named `enough`, instructions
  `Can the assistant give a good answer to the message with what it has looked up so far?`, criteria
  `yes`: `What was found covers what the message asks; more lookups would repeat or add detail nobody asked for.`
  `no`: `Something the message asks for has not been found yet, or the findings contradict each other.`
- `enoughState(turn, rows)` → `{ message, found }`: `message` as in `effortState`; `found` the finished lookups so
  far (rows of `turn.activity` that are done and are neither writes nor state tools; take the names from
  `src/client/pip-tools.js`), each `{ did, got }`: `did` the row's title (at most 120 characters), `got` the start
  of its result text (at most 300), newest last, at most the last 12.
- `enoughFromAnswers(answers)` → `true`, `false`, or `null` when the answer is not a choice of `yes`/`no`.
- `judgeEnough(userId, turn, { fetcher, timeoutMs = 1200 })` → `{ enough, ms }` or `null`, built like `judgeEffort`
  (same key, endpoint, headers, never throws). Share what the two have in common in one small function in that file
  rather than copying it.

### 3. `src/server/pip-runs.js`, `drive`: recording, not stopping

- Only when the reply's level is `thorough`, pass `research: { enough }` (alone: `thorough` has no caps). `enough`
  calls `judgeEnough` with the turn as it is now, **always resolves `false`**, and the first time JEV says yes
  records where the reply stood: `enoughAt: <lookups made then>` in the turn's usage, beside `effort` (same places
  the usage is rebuilt; read how P2 keeps `effort`). Also keep `enoughAsked: <how often JEV was asked>`.
- A level other than `thorough`, or no level: `enough` is not passed.
- One constant at the top of the new code, `ENOUGH_STOPS = false`, with a comment that the lead switches it on after
  comparing; when true, `enough` resolves what JEV said. Tests cover both values through an option, not by editing
  the constant (for example `drive` reads `process.env.PIP_ENOUGH_STOPS === '1' || ENOUGH_STOPS`; say what you chose).

### 4. Tests: add to `tools/pip-effort.test.mjs`

1. `enoughState` cuts lengths, keeps the last 12, leaves out cards, writes and failed rows; `enoughFromAnswers`
   for yes, no, and three bad shapes.
2. Recording only: level `thorough`, JEV says `no` after round one and `yes` after round two; the model makes
   lookups in four rounds and all of them run; the stored turn has `usage.enoughAt` equal to the lookups made when
   yes came, and `usage.enoughAsked` 2 or more; the reply is the model's own.
3. Stopping, with the option on: same script; after the yes, the next lookups are refused with
   `research_budget_reached` and the reply finishes with the model's final text.
4. JEV failing on the second question (500, timeout) changes nothing and the reply finishes.
5. Level `quick` and no level: no request with the `enough` question reaches JEV (count them by the question name
   in the request body).
6. Never asked more than 6 times: a model that looks up in 9 rounds.
7. Every test already in the file passes unchanged.

### Files you may touch

`src/client/pip-stream.js`, `src/shared/pip-effort.js` + `.d.ts`, `src/server/pip-effort.js`,
`src/server/pip-runs.js` (`drive` only), `tools/pip-effort.test.mjs`, `docs/pip-message-flow.md` (extend the section
"Pip looks up as much as the message deserves").

### Do not

Do not stop replies by default. Do not change the levels or their caps. Nothing on the tab path or in jobs.

---

## P6 — Looking things up does not use up the answer (ready)

### What real replies showed (2026-11-11)

Asked to compare two cars from six short notes, GLM 5.3 made 6 to 12 lookups and then **failed** with "The
configured reply token limit was reached": the reply's whole output budget (`maxTokens`, 4,096 here) is one number
that every round draws from, a model that thinks before each lookup spends most of it on the rounds, and nothing is
left for the answer. The person gets "Collected observations: …" instead of an answer, after 40 seconds. JEV's
"enough?" (P4) does not help here: it said yes late or never.

### The change, in `src/client/pip-stream.js` only

Today: `tokens` starts at `value.maxTokens`; `onStepEnd` does `tokens -= usage.outputTokens || allowance` for every
round; `prepareStep` ends the reply when `tokens < 1` and makes rounds final when `tokens <= reserve`.

After this task there are two budgets:

- **The answer's budget** is `tokens`, as now, starting at `value.maxTokens`.
- **The lookups' budget** is new: `researchTokens`, starting at `RESEARCH_LIMITS.researchTokens`, a new entry in
  `src/client/pip-limits.js` with the value `16000`.

A round is charged to one of them when it ends (`onStepEnd`):

- A round whose tool calls are **all lookups** (at least one call; none of them a write or a state tool; the same
  rule the `lookups` counter uses) is charged to `researchTokens`.
- Every other round (text only, or any card, write or other state tool) is charged to `tokens`, as now.

And:

- When `researchTokens` falls below 1, research ends the way the other limits end it: add it to the condition that
  computes `final`, and set `finalReason ||= 'Research token budget reached'` at that point. The reply must then
  still write its answer with the full remaining `tokens`.
- A round's allowance (`maxOutputTokens`) is computed as now from `tokens` (a round may turn out to be the answer),
  but a round that is not final is also capped at what is left of `researchTokens` plus the reserve, so a lookup
  round cannot run far past the lookups' budget.
- `researchTokens` is stored in and restored from the checkpoint counters like `tokens` (a checkpoint without it:
  the full budget).
- Nothing else changes: the same usage is reported (`result.usage`), the same daily accounting, the same messages.

Read the whole function before changing it, and read every existing test that mentions `token` in
`tools/pip-runs.test.mjs`, `tools/pip-reliability.test.mjs` and `tools/pip-cards.test.mjs`: they describe today's
behaviour for the answer's budget, which must not change for a reply without lookups.

### Tests: `tools/pip-budget.test.mjs` (new)

Run the real pipeline against the provider fixture, as `tools/pip-cards.test.mjs` does. The fixture's
`compatibleMessage` can report usage; read `tools/pip-provider-fixtures.mjs` for how to give a round its
`output_tokens`.

1. The failure above, fixed: `maxTokens` 4096; six rounds of one lookup each, every round reporting 700 output
   tokens; then a final text of 900 tokens. The reply finishes with that text (today it fails after the fifth
   round). `result.usage.output_tokens` is the sum of all rounds.
2. A reply without lookups is charged exactly as before: a text round of 3,000 tokens with `maxTokens` 4096 leaves
   1,096; show it through the next round's `max_tokens` in the provider request.
3. A round that draws a card (`show_card`) is charged to the answer, not to the lookups; a round with one lookup
   and one card in it too.
4. The lookups' budget ends research: lookup rounds that together report more than 16,000 tokens are followed by a
   final round (the provider request offers no lookup tools, as for the other limits) and the reply finishes with
   its text.
5. A pause keeps both budgets: a run that pauses for an approval after two lookup rounds continues with the
   lookups' budget it had left (assert through the stored checkpoint's counters).
6. All existing suites pass unchanged. If an existing test asserts a number that this task changes on purpose, do
   not edit it: name it in the report.

### Files you may touch

`src/client/pip-stream.js`, `src/client/pip-limits.js` (the one entry), `tools/pip-budget.test.mjs` (new),
`docs/pip-message-flow.md` (extend the "Budget" point in "Cards are a tool call").

### Do not

Do not change `maxTokens`, the reserve, the other limits, or what a reply costs to report. No UI.
