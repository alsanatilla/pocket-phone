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

## T2 — Every chat write is logged, and tabs are told by number (ready)

T1 is merged: read `src/shared/chat-log.js` and `src/server/chat-log.js` first. (T1 differs from its text above in
two accepted points: `chat.deleted` carries `uid`, and `applyChatEvents` keeps the order turns are in, with
`turns.order` emitted whenever that would differ from `after`.)

After this task every change of a chat on the server has a number, a tab can ask for the changes after a number, and
the event a tab already gets says which number the chat is at. No client code changes: that is T3.

### 1. `src/server/chat-log.js`: one more function

`chatLogHead(tx, userId, chatUid)` → the chat's highest `seq` inside the given transaction (0 when none). Use it in
`appendChatEvents` instead of that function's own `MAX(seq)` query.

### 2. `src/server/objects.js`: `writeObject` logs chats

Only for `collection === 'chats'`, only inside the existing `if (payload !== previous?.payload)` block, in the same
transaction `tx`, after the `pocket_objects` insert:

- `head = await chatLogHead(tx, userId, uid)`.
- `events = head === 0 ? chatEvents(null, value) : chatEvents(stored, value)`. Why: a chat that existed before the log
  did has no events; its first logged write must be the whole chat, or a reader starting at 0 would rebuild only the
  last change. This is the migration; there is no separate migration script.
- `logged = await appendChatEvents(tx, userId, uid, events)`.
- If the transaction fails or is retried (the function has a retry loop: read it), nothing of the log may remain
  from the failed attempt. It is in `tx`, so a rollback covers it; make sure no log write happens outside `tx`.

After the commit, where `publish(userId, { type: 'objects', collection, uid, revision })` is: for chats add
`seq` (the last logged event's `seq`, or omit the field when nothing was logged) and `events` (the logged events)
**only when `JSON.stringify(events).length <= 32_000`**; otherwise send `seq` without `events`, and the tab will ask.
Other collections' events stay exactly as they are.

Return value of `writeObject`: add `seq` (the chat's head after the write; for chats only). Existing callers ignore it.

Trimming: after the commit, when the last logged `seq` is a multiple of 200, call
`trimChatEvents(userId, uid, 2000)` and ignore its failure (wrap that one call; a failed trim must not fail a write
that is already committed).

### 3. Reading: `src/pages/api/objects/chat-events.ts` and the socket

- New route `POST /api/objects/chat-events`, body `{ accountId, chat, after }`, written like the POST in
  `src/pages/api/objects/[collection].ts` (`sameOrigin`, `signedIn`, `readJson`, the 409 when `accountId` differs,
  `failure`). `chat` must pass `objectId` from `src/shared/objects.js`, else 400. Answers
  `{ accountId, chat, ...await readChatEvents(user.id, chat, after) }`. Check that Astro routes the static file name
  before the dynamic `[collection].ts` (it does by its rules; prove it with the test in 4.5 or by `npm run build`
  and reading the route list).
- `services/server/web.mjs`: add `'chat.events': '/api/objects/chat-events'` to `COMMANDS`. Nothing else in that
  file changes. The socket does not know the account id of the body; the tab will send it (T3).

### 4. Tests: `tools/chat-log-writes.test.mjs`

Same setup as `tools/chat-log.test.mjs`. Use `writeObject` and `readChatEvents`; build chats with the helper style
of that file. Required:

1. A new chat written once: replaying `readChatEvents(…, 0).events` with `applyChatEvents(null, …)` equals the
   stored value (compare with `canonical`). `writeObject`'s result has `seq` equal to `head`.
2. Five further writes (a turn added with `appendTurns: true` the way `writeTurn` in `src/server/pip-runs.js` does
   it, an answer changed, title changed, a turn's card updated, chat deleted): after each, replay from 0 equals the
   stored value, and replay of only the events after the previous head, applied to the previous stored value, equals
   it too.
3. A write that changes nothing (same object again) logs nothing: `head` is unchanged.
4. A chat that exists without a log (insert its row into `pocket_objects` and `pocket_object_changes` directly with
   SQL, as an old chat): the next `writeObject` logs the whole chat; replay from 0 equals the stored value.
5. The published event: subscribe with `subscribe` from `src/server/pocket-events.js` before writing; a small write
   publishes `seq` and `events` whose replay on the previous value gives the new one; a write with a turn whose
   answer is 40,000 characters publishes `seq` and no `events`.
6. Another user reading the same chat uid gets `head: 0` and no events.
7. A zine write (see how `validObject` wants a zine; a deleted zine `{ id, updated, deleted: true }` is the simplest
   valid one) logs nothing and its event has neither `seq` nor `events`.

The existing suites must stay green; `tools/pip-runs.test.mjs` and `tools/pip-jobs.test.mjs` exercise `writeObject`
heavily.

### Files you may touch

`src/server/chat-log.js`, `src/server/objects.js`, `src/pages/api/objects/chat-events.ts` (new),
`services/server/web.mjs` (one entry), `tools/chat-log-writes.test.mjs` (new), `docs/pip-message-flow.md` (append
one short section "A chat has a numbered log" describing what now exists, in the style of the sections above it).

### Do not

No client changes (`src/client`, `src/app`). Do not change `mergeObject`, `sanitizeObject` or `validObject`. Do not
change what `readObjects` returns.

## T3 — The tab applies chat events (not ready)

The open chat applies events from `chat.events` instead of pulling the object; a gap falls back to the pull.

## T4 — A reply continues after a restart (not ready)

## T5 — A message sent during a reply is queued; offline sends wait (not ready)

## T6 — First reaction within 200 ms; time to first token measured (not ready)

## T7 — Long chats load their last turns first (not ready)
