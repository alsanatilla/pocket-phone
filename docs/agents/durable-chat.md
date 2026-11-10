# Durable, responsive chat: the plan and its tasks

Read `docs/agents/GUIDELINES.md` first. Each task below is done alone, reviewed, and merged before the next that
depends on it starts. Do only the task you were given.

## Where we are

- A chat is one JSON object in `pocket_objects` (collection `chats`). Every writer sends the whole object;
  `mergeObject` (`src/shared/objects.js`) merges turn by turn, the newer `updated` wins. Tabs learn of a change from
  an `objects` event and then pull the whole chat again (up to 3 MB).
- A running reply streams as numbered block changes (`src/shared/pip-blocks.js`, `src/server/pip-run-stream.js`),
  kept in memory only.
- A reply whose process dies is ended as failed (`recover` in `src/server/pip-runs.js`); it is not continued.
- A message sent while a reply runs is refused (`run_active`).

## Where we are going

1. **A chat has a numbered log of its changes** beside the stored object. A tab that was away asks for "everything
   after number N" and applies it, instead of pulling the chat again. The stored object stays; it is the snapshot.
2. **A reply survives a restart**: it continues from its last finished model round.
3. **A message sent while a reply runs is queued**, not refused; the same queue covers offline.
4. **The first reaction comes within 200 ms** of sending, and time to first token is measured.
5. **Long chats load their last turns first.**

The order of tasks: T1 → T2 → T3 (the log), then T4, T5, T6, T7. Only tasks marked **ready** may be started.

---

## T1 — The chat log: shared format and server storage (ready)

Nothing existing changes behaviour in this task. You add two modules, one table and tests.

### 1. `src/shared/chat-log.js` (+ `src/shared/chat-log.d.ts`)

Pure functions, no imports except `canonical` from `./objects.js`.

A **chat** here is the object `sanitizeObject('chats', …)` returns (read it in `src/shared/objects.js`): top-level
fields, `config`, `context`, and `turns` (each with a `uid`). A deleted chat is `{ uid, updated, deleted: true }`.

Event kinds (an event is a plain object with `kind`):

| kind | fields | means |
|---|---|---|
| `chat.set` | `fields` (object), `unset` (array of names, omitted when empty) | top-level fields other than `turns` that were added or changed, as whole values (`config` and `context` are replaced whole, compared with `canonical`); `unset` names top-level fields that are gone |
| `turn.put` | `turn` | a turn that was not there before, whole |
| `turn.set` | `uid`, `fields`, `unset` (omitted when empty) | fields of an existing turn that were added or changed (whole values), and those that are gone |
| `turn.cut` | `uid` | a turn that is no longer there |
| `turns.order` | `uids` | the order of all turns, emitted only when the turns of `after` are not in the default order (by `created`, then `uid` with `localeCompare`, as `mergeObject` sorts) |
| `chat.deleted` | `updated` | the chat became a tombstone |

Exports:

- `chatEvents(before, after)` → the events that turn `before` into `after`. `before` may be `null` (a new chat: one
  `chat.set` with every top-level field, one `turn.put` per turn). When `after.deleted` is true: exactly one
  `chat.deleted`. When `before` is deleted and `after` is not: treat `before` as `null`. When nothing differs: `[]`.
  Order of the returned events: `chat.set`, `turn.cut`…, `turn.put`…, `turn.set`…, `turns.order`.
- `applyChatEvents(chat, events)` → a new chat; never mutates its arguments. `chat` may be `null`. After applying,
  turns are in the default order unless a `turns.order` event said otherwise (uids it does not name keep the default
  order after the named ones). An event of an unknown kind, or a `turn.set`/`turn.cut` for a uid that is not there,
  is ignored.

The one property everything rests on, for any two chats `a` (or `null`) and `b`:

```
canonical(applyChatEvents(a, chatEvents(a, b))) === canonical(b)
```

and `chatEvents(b, b)` is `[]`.

### 2. Table (add to `TABLES` in `src/server/database.js`)

```sql
CREATE TABLE IF NOT EXISTS pocket_chat_events (
  user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE,
  chat_uid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,          -- JSON of one event
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, chat_uid, seq))
```

Write it on one line like its neighbours.

### 3. `src/server/chat-log.js`

- `appendChatEvents(tx, userId, chatUid, events, at = Date.now())` → the same events, each with its `seq`.
  `tx` is an open write transaction (`database().transaction('write')`); this function never opens or commits one.
  Numbers start at 1 per chat and have no gaps: the next is `MAX(seq) + 1` read inside `tx`. An empty `events` writes
  nothing and returns `[]`.
- `readChatEvents(userId, chatUid, after = 0, limit = 500)` → `{ events, head, gap }`. `events`: those with
  `seq > after`, ascending, at most `limit`, each `{ seq, at, ...event }`. `head`: the chat's highest `seq` (0 when
  none). `gap`: true when the log no longer holds `after + 1` although `head > after` (it was trimmed): the caller
  must read the stored chat instead. `after` and `limit` that are not safe non-negative integers throw an error with
  `status: 400`; `limit` is capped at 500.
- `trimChatEvents(userId, chatUid, keep = 2000)` → number of rows deleted; keeps the newest `keep`.

### 4. Tests: `tools/chat-log.test.mjs`

Model the file on the top of `tools/pip-jobs.test.mjs` (temp libSQL file, `ensureSchema`, cleanup). `npm run
test:tools` must pick it up: check how the script in `package.json` finds test files and follow that.

Required tests:

1. The property above, on a hand-written sequence of at least 8 states of one chat that covers: new chat; a turn
   added; a turn's `answer`/`status`/`usage` changed; a turn field removed; title and `pinned` changed; `config`
   changed; a turn removed; turns stored out of default order; deleted; created again after deletion. Check every
   consecutive pair, and also `null → each state`.
2. `chatEvents` returns `[]` for equal chats and only the changed fields for one changed turn (assert the exact
   events).
3. `applyChatEvents` does not mutate its inputs (deep-freeze them).
4. Appending in two transactions gives 1..n without gaps; two chats and two users do not share numbers; reading with
   `after` returns only later ones; `limit` cuts and `head` still shows the highest.
5. Replaying the whole log from `null` gives the last state.
6. After `trimChatEvents`, a reader behind the trim gets `gap: true`; a reader at or after it does not.
7. Invalid `after`/`limit` throw with `status: 400`.

### Files you may touch

`src/shared/chat-log.js`, `src/shared/chat-log.d.ts`, `src/server/chat-log.js`, `src/server/database.js` (one line),
`tools/chat-log.test.mjs`, and `package.json` only if the test script lists files by name.

### Do not

Do not call these functions from `objects.js`, runs, or the client. Do not publish events. That is T2.

---

## T2 — Every chat write is logged, and tabs are told by number (not ready: starts after T1 is merged)

`writeObject` (`src/server/objects.js`), in its transaction: `chatEvents(stored, value)` → `appendChatEvents`. The
`objects` event for a chat gains `seq` (the head) so a tab knows what it is missing. The socket gets a request
`chat.events { chat, after }` (`services/server/web.mjs`). Existing chats without a log: a reader gets `gap: true`
and pulls the object, as today. Detailed brief follows after T1.

## T3 — The tab applies chat events (not ready)

The open chat applies events from `chat.events` instead of pulling the object; a gap falls back to the pull.

## T4 — A reply continues after a restart (not ready)

## T5 — A message sent during a reply is queued; offline sends wait (not ready)

## T6 — First reaction within 200 ms; time to first token measured (not ready)

## T7 — Long chats load their last turns first (not ready)
