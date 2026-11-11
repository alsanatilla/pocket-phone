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
| H2 | Pip opens the big chat; the list; earlier messages on demand | ready |

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

## H2 — Pip opens the big chat (ready)

H1 is merged: `src/shared/pip-home.js` (the rules), `src/app/data/home.ts` (`homeChats`, `homeChat`,
`homeForSend`, `isHome`), and the server shows the model the previous segment's last turns. Nothing on screen
changed yet. This task makes the big chat what Pip opens.

Read `src/app/features/pip/PipPage.tsx`, `ChatList.tsx`, `Turn.tsx`, `PipComposer.tsx`, `runner.ts`,
`src/app/data/chats.ts`, `src/app/data/home.ts` and `src/app/router.tsx` completely before writing.

### 1. Which chat the page shows

- `/pip` with no `chat` in the address is **home**. The page no longer redirects to the most recent chat.
- `/pip?chat=<uid>` is that chat, as today. If `<uid>` is a home segment, the page shows home and replaces the
  address with `/pip` (a notification may link to a segment).
- A chat that does not exist: home.

### 2. The thread: `src/app/features/pip/thread.ts` (new, pure) and its use in `PipPage`

`threadOf(chats: Chat[], shown: number)` → `{ items: { turn: ChatTurn; chatId: string }[]; earlier: number }`:
the turns of the given chats joined in order (home: all segments oldest first; a separate chat: that one chat),
of which only the last `shown` are returned as `items`; `earlier` is how many are not shown.

In `PipPage`:

- `shown` starts at 30 for the chat on screen and resets when the chat on screen changes.
- When `earlier > 0`, the thread starts with one button, `earlier messages`, full width of the column, the small
  dim text style of the line under the header, at least 44 px tall on a phone. Pressing it adds 30 to `shown`.
  The view must not jump: the message that was at the top of the screen stays where it is (measure the document's
  height before and after in a layout effect and scroll by the difference).
- Each `Turn` gets the `chatId` of its own segment (card menus, retry and continue act on the right chat).
  `latest` is true only for the last turn of the last chat. A live reply is matched by its chat and turn as today.
- The scroll-following effect and the "new message brings the end into view" effect keep working: the second
  must not fire when `shown` grows (it would throw the reader to the bottom).

### 3. Sending, the composer, the header

- Home: the composer works on the current segment (`homeChat()`): its draft, its sources, its model. A message is
  sent to `homeForSend()`; when that started a new segment, the page simply shows it joined to the rest.
- A reply running in the current segment is watched as today (`watchChat`).
- The header title is the chat's title (`pip` for home). The line under it stays.
- `+` starts a separate chat and opens it, as today.
- An empty home shows the existing `Empty`.

### 4. The list (`ChatList.tsx`)

- First row, above the pinned and dated groups: **`pip`**, with the small line `everything, in one conversation ·
  N messages` (N over all segments; `1 message` singular). It is marked as the current one when home is on screen,
  with the same marking the other rows use. It has no options menu. Choosing it goes to `/pip`.
- Home segments never appear among the other rows, and are not counted in the "N conversations" heading.
- Everything else in the list is unchanged.

### 5. "Ask pip" from elsewhere (`withContext` in `src/app/data/chats.ts`)

Today it adds a source to the chat last opened, else the newest, else a new one. Change only the fallback: the
chat last opened if it still exists, else `homeChat()`. Read how the page records the chat last opened and keep
that for separate chats; home records itself the same way.

### 6. The lab (`tools/manual/chat-lab.mjs`)

- New states: `home` (home with two segments: an earlier one of 40 short exchanges and a current one of 5; at the
  bottom) and `home-earlier` (the same, scrolled to the top, the `earlier messages` button visible; then press it
  and check that the message that was first on screen is still on screen).
- `chat-list` now shows the `pip` row first; update that state's own check to what the list shows.
- `empty` is now a new separate chat or the empty home: keep whichever needs the smaller change and say which.
- Every other state and the `stream` measurement stay as they are. The stream's numbers must be in the same range
  as before your change (`swaps.visible` 1, `markdownRequests` 0, `follow.above4` 1 or 2): report them.

### 7. Tests

- `src/app/features/pip/thread.test.ts` (new): joins segments in order; returns the last `shown`; `earlier` counts
  the rest; one separate chat; zero turns.
- A test for the list (beside `ChatList.tsx`; see `ModelPicker.test.tsx` for rendering a Pip component): the `pip`
  row is first with its count; segments are not among the other rows; the heading counts only separate chats.
- `src/app/data/data.test.ts` or `home.test.ts`: `withContext` with nothing opened adds the source to home.
- Existing tests pass; a test that asserts the old redirect to the most recent chat is named in your report, not
  edited silently.

### Files you may touch

`src/app/features/pip/PipPage.tsx`, `ChatList.tsx`, `thread.ts` + `thread.test.ts` (new), a new test file beside
`ChatList.tsx`, `src/app/data/chats.ts` (`withContext` only), `src/app/data/home.ts` and its test (only if a small
helper is needed), `src/app/router.tsx` (only if the route needs it), `tools/manual/chat-lab.mjs`,
`docs/pip-message-flow.md` (extend "One big chat").

### Do not

No new colours, fonts, icons or components: the `pip` row and the button use what the list and the page already
use. Do not change `Turn.tsx`, `PipComposer.tsx`, the runner or anything on the server. Do not virtualize the
list. Do not migrate existing chats into home.
