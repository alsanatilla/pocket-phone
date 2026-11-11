# One big chat with Pip: the plan and its tasks

Read `docs/agents/GUIDELINES.md` first. Do only the task you were given; only tasks marked **ready** may be started.

## What the person asked for

"I just want one big chat. And if I want to, I can create separate ones." Opening Pip always lands in the same
ongoing conversation; a separate chat is something you start on purpose with "+".

## How it is built

A chat is one stored object that every writer sends whole, limited to 2,000 turns and 3 MB, and turns cannot be
taken out of it again (`mergeObject` in `src/shared/objects.js` keeps the union). So the one big chat is not one
object. It is a **chain of ordinary chats marked `home: true`**, called segments:

- The **current segment** is the home chat created last. Messages go there.
- When the current segment is full, the next message starts a new segment. Nothing is moved or deleted.
- The page shows the segments joined, oldest first, as one conversation.
- The model sees the current segment, plus the last turns of the segment before it, plus its memory of the person
  (`docs/agents/memory.md`) and `read_chat_history` for anything older.

Every other chat is a separate chat and works as today.

| # | Task | State |
|---|---|---|
| H1 | The `home` mark, the segments, when a new one starts, what the model sees (no UI) | ready |
| H2 | Pip opens the big chat; the list; earlier messages on demand | not ready (after H1) |

---

## H1 — Home segments: the mark, the rule, the model's view (ready)

### 1. The mark (`src/shared/objects.js`)

A chat may carry `home: true`. `sanitizeObject` keeps it (add it to the picked fields); `validObject` accepts
`home` only as `true` or absent (as it does `pinned` being a boolean or absent: read that line). A tombstone stays
`{ uid, updated, deleted }`. Nothing else in that file changes. The chat log (`src/shared/chat-log.js`) needs no
change: check with a test that a `home` chat round-trips through `chatEvents` / `applyChatEvents`.

### 2. `src/shared/pip-home.js` (+ `.d.ts`): the rules, pure

- `HOME_TITLE = 'pip'`, `HOME_TURNS = 60`, `HOME_BYTES = 400_000`, `HOME_TAIL = 6`.
- `homeSegments(chats)` → the chats with `home === true` that are not deleted, ordered by `created` then `uid`
  (oldest first). `chats` is any array of chat objects.
- `currentHome(chats)` → the last of those, or `null`.
- `homeFull(chat)` → true when it has `HOME_TURNS` turns or more, or `JSON.stringify(chat).length >= HOME_BYTES`.
  A chat whose last turn is not finished (`status === 'streaming'`) is never full: a reply must end in the segment
  it started in.
- `homeTail(segments, chat)` → the turns the model also sees when it answers in `chat`: the last `HOME_TAIL`
  turns with `status === 'done'` of the segment right before `chat` in `segments`; `[]` when `chat` is not a home
  segment, is the first one, or already has `HOME_TAIL` or more turns of its own.

### 3. The app's side: `src/app/data/home.ts` (new)

Uses `chats`, `listChats`, `createChat` from `./chats.ts` and the functions above.

- `homeChats()` → `homeSegments(listChats())`.
- `homeChat()` → the current segment; when there is none, creates it: a new chat with `home: true`,
  `title: HOME_TITLE`, `titled: true` (so no title is generated for it). Returns the chat.
- `homeForSend()` → the segment the next message goes to: `homeChat()`, unless it is full, then a new segment
  (same marks, the previous segment's `config`). Returns the chat.
- `isHome(chat)` → boolean.
- Creating a segment is one `chats` write; two calls in a row without a message in between must not create two
  empty segments (an empty current segment is never full).

Read `ChatStore.create` and `update` in `src/client/pip-core.js` and `createChat` in `chats.ts` for how a chat is
made and changed; `home`, `title` and `titled` are set with one `chats.update` right after `create`, or by a small
optional argument added to `createChat` in `chats.ts`: choose the smaller change and say which.

### 4. The server's side

- `src/server/pip-runs.js`, where a run creates the chat object from the header the tab sent when the chat is not
  stored yet (search for `titled` in that file): a header with `home: true` makes a chat with `home: true`. The
  header is client input: accept exactly `true`.
- `src/client/pip-remote.js`, where the tab builds that header: send `home: true` for a home chat.
- `drive` in `src/server/pip-runs.js`, where `conversationView` is built from the stored chat: when the chat is a
  home segment, read the account's other home segments (one query on `pocket_objects`, collection `chats`, this
  user; parse and filter with `homeSegments`; do not load chats that are not home if the payload can be filtered
  cheaply first, e.g. `payload LIKE '%"home":true%'`), and put `homeTail(segments, chat)` **before** the chat's own
  turns in `conversationView.turns`. Only the view the request is built from changes: the stored chat is never
  written with those turns. Not a home chat: nothing changes, and no extra query is made.

### 5. Tests

`tools/pip-home.test.mjs` (new; setup from the top of `tools/pip-runs.test.mjs`):

1. `homeSegments` orders by `created`, leaves out deleted and ordinary chats; `currentHome` is the last.
2. `homeFull`: 59 turns no, 60 yes; a small chat with one huge answer yes; 60 turns with the last one streaming no.
3. `homeTail`: the last 6 done turns of the previous segment, in order; fewer when it has fewer; none for the first
   segment, for an ordinary chat, and for a segment with 6 or more turns of its own; streaming and failed turns of
   the previous segment are not taken.
4. `sanitizeObject` keeps `home: true`; `validObject` refuses `home: false` and `home: 'yes'`; a home chat
   round-trips through `chatEvents` / `applyChatEvents` and through `writeObject` (stored payload has `home`).
5. A server run in a new home segment whose previous segment ends with "My dog is called Bruno." / "Noted.": the
   provider's first request contains those two as earlier messages before the new question; the stored new segment
   has only its own turn.
6. A server run in an ordinary chat makes no query for home segments (count executed SQL through a wrapper, or
   assert on the provider request that nothing was added; say which you could do) and its request is unchanged.
7. A run whose header says `home: true` for a chat not stored yet stores it with `home: true`; `home: 'true'` (a
   string) does not.

`src/app/data/home.test.ts` (new; see `src/app/data/cards.test.ts` for storage setup):

8. `homeChat()` creates one segment titled `pip`, marked `home` and `titled`; a second call returns the same one.
9. `homeForSend()` returns the same segment until it is full; with 60 finished turns it returns a new one that
   keeps the previous `config`, and `homeChats()` then has two, oldest first; calling it again returns the new one.

### Files you may touch

`src/shared/objects.js`, `src/shared/pip-home.js` + `.d.ts` (new), `src/app/data/home.ts` + `home.test.ts` (new),
`src/app/data/chats.ts` (only for the optional argument or the `home` field on the `Chat` type),
`src/server/pip-runs.js` (the two places named), `src/client/pip-remote.js` (the header), `tools/pip-home.test.mjs`
(new), a `.d.ts` beside a changed file if typecheck needs it, `docs/pip-message-flow.md` (append a short section
"One big chat").

### Do not

No UI: `PipPage`, the chat list and the router are H2. Do not change `mergeObject`. Do not move or delete turns.
Background jobs keep writing to their own chats.

---

## H2 — Pip opens the big chat (not ready)
