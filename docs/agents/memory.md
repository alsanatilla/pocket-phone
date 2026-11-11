# Pip remembers the person: the plan and its tasks

Read `docs/agents/GUIDELINES.md` first. Do only the task you were given; only tasks marked **ready** may be started.

## What it is

A short list of lasting facts about the person (how they like answers, what they are working towards, who the
people around them are). Pip adds to it while it talks, every reply and every job reads it, and the person sees
each thing Pip remembered and can change or remove it. No search index, no embeddings: the whole list goes into the
request. Built in Pocket, on purpose: a memory library would add a second model provider and remember without
showing what.

| # | Task | State |
|---|---|---|
| M1 | The list, the tools, the prompt, the API (no UI) | ready |
| M2 | "remembered: …" under a reply, and the page that lists the memory | not ready (after M1) |

---

## M1 — The memory list, Pip's tools for it, and the API (ready)

### 1. Storage: `src/server/pip-memory-store.js` (new) and one table

Add to `TABLES` in `src/server/database.js`, on one line like its neighbours:

```sql
CREATE TABLE IF NOT EXISTS pocket_pip_memory (
  user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE,
  id TEXT NOT NULL,            -- 'm' + 6 characters, lowercase letters and digits
  text TEXT NOT NULL,
  chat_uid TEXT NOT NULL DEFAULT '',   -- where Pip learned it ('' when the person wrote it)
  created INTEGER NOT NULL, updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, id))
```

Functions (every one takes `userId` first and filters by it):

- `MEMORY_MAX = 100`, `MEMORY_TEXT = 300`.
- `listMemory(userId)` → `[{ id, text, chat, created, updated }]`, oldest first.
- `remember(userId, text, { chat = '', replaces = '' } = {})` → `{ id, text, replaced }`. `text` is trimmed, inner
  whitespace collapsed to single spaces, cut to `MEMORY_TEXT`; empty → an error with `status: 400` and
  `code: 'memory_empty'`. With `replaces` naming an existing entry, that entry's text and `updated` change (its `id`
  and `created` stay) and `replaced` is true. A text equal to an existing entry's (compared lowercase) changes
  nothing and returns that entry. A new entry when the list already has `MEMORY_MAX` → an error with `status: 409`,
  `code: 'memory_full'` and a message that says to replace or forget one first.
- `forget(userId, id)` → boolean (whether there was one).
- After a change (`remember` that wrote, `forget` that removed) publish `{ type: 'memory' }` with `publish` from
  `src/server/pocket-events.js`, after the write.
- `memoryNote(entries)` → the text for the model, `''` for an empty list:

  ```
  What you remember about the person (your memory, newest last; the id in brackets is for replacing or forgetting):
  - [m1a2b3c] Trains for a half marathon in April.
  - [m9x8y7z] Likes short answers without preamble.
  ```

### 2. The tools: `remember` and `forget`

Do this exactly the way `update_scratch` is done; find every place that name appears
(`grep -rn "update_scratch" src tools`) and give the two new tools the same treatment in each.

- `src/client/pip-sdk-tools.js`: `remember { text: string (1–300), replaces?: string }` and `forget { id: string }`.
  Descriptions, in the plain style of the others:
  - remember: `Keep one lasting fact about the person in your memory, in one short sentence: how they like answers, what they are working towards, who someone is to them, a standing preference. Not what only matters in this chat, not something a note or task already holds, never a password or key. To correct something you remember, pass its id as replaces.`
  - forget: `Remove one thing from your memory by its id, when the person asks you to forget it or it is no longer true.`
- `src/client/pip-tools.js`: a new category `"memory"` for both, offered only when `value.memory === true` (as
  `"job"` is offered only when `value.backgroundJob === true`); both in `STATE_TOOLS`; labels `remember` /
  `forget`, and result summaries `remembered` / `already remembered` (when nothing changed) / `forgotten` /
  `not remembered` (failed).
- The executor is the server's, like `update_scratch`'s: in `drive` (`src/server/pip-runs.js`) and in
  `runRoutine` (`src/server/pip-background.js`), inside the existing `executeTool`, before the other branches:
  `remember` → `{ kind: 'memory', saved: true, id, text, replaced }` or, on the store's error,
  `{ error: <code>, message }`; `forget` → `{ kind: 'memory', forgotten: <boolean>, id }`. Pass the chat's uid as
  `chat`.
- Where each of the two paths builds the `value` it hands to `streamChat`, set `memory: true`. Nothing sets it on
  the tab path, so a chat that runs in the browser never offers these tools.

### 3. The prompt

- In `drive` and in `runRoutine`, where the date line is appended to `body.instructions`: read `listMemory` once
  and append `memoryNote(...)` when it is not empty, then this paragraph (always, on these two paths):

  `When you learn something lasting about the person that will matter in later conversations, call remember with one short sentence. Do it without asking and without mentioning it in your answer; Pocket shows them what you remembered. Remember sparingly: at most one or two things from a message, and nothing you already remember.`

- The memory read at the start of a reply is what that reply sees; a fact remembered during the reply is not
  re-read into the same reply.

### 4. The API: `src/pages/api/pip/memory.ts` (new)

Written like `src/pages/api/objects/chat-events.ts` (`sameOrigin` on writes, `signedIn`, `readJson`, `failure`).

- `GET` → `{ accountId, entries: await listMemory(user.id) }`.
- `POST` body `{ accountId, action, id?, text? }`; the 409 "Account changed" check as in the objects route.
  `action: 'add'` → `remember(user.id, text)`; `'edit'` → `remember(user.id, text, { replaces: id })` (404 with
  `code: 'memory_missing'` when there is no such entry); `'forget'` → `forget(user.id, id)`. Each answers
  `{ accountId, entries }` with the list after the change. Any other action → 400.

### 5. Tests: `tools/pip-memory-store.test.mjs` (new)

Setup from the top of `tools/pip-runs.test.mjs`.

1. `remember`: trims and collapses whitespace, cuts at 300, refuses empty; the same text again (other case) adds
   nothing; `replaces` changes the text and keeps id and `created`; entry 101 is refused with `memory_full`, and a
   `replaces` still works on a full list.
2. `forget` removes one and reports whether it existed; another user's entry with the same id is untouched.
3. `memoryNote` is `''` for no entries and lists ids and texts in order.
4. A change publishes `{ type: 'memory' }`; a `remember` that changed nothing publishes nothing.
5. A server run where the model calls `remember`: the entry exists afterwards with the chat's uid; the tool result
   the model got has `saved: true` and the id; the reply finishes with the model's text; the activity row is `done`.
6. The next run's first request carries the remembered sentence and its id in its instructions, and offers
   `remember` and `forget` among its tools.
7. `forget` through a run removes it; `remember` with `replaces` through a run corrects it.
8. A scheduled job (`runClaimed`, as `tools/pip-jobs.test.mjs` does) sees the memory in its instructions and can
   remember.
9. `toolNames` without `memory: true` offers neither tool (the tab path).
10. A `remember` call does not count as a lookup: with JEV's level `none` (see `tools/pip-effort.test.mjs` for how
    a level is given) it still runs.

### Files you may touch

`src/server/pip-memory-store.js` (new), `src/server/database.js` (one line), `src/client/pip-sdk-tools.js`,
`src/client/pip-tools.js`, `src/server/pip-runs.js` (`drive` only), `src/server/pip-background.js` (`runRoutine`
only), `src/pages/api/pip/memory.ts` (new), `tools/pip-memory-store.test.mjs` (new), a `.d.ts` beside a changed file
if typecheck needs it, `docs/pip-message-flow.md` (append a short section "Pip remembers the person").

### Do not

No UI. No embeddings, no search, no second model call. Do not touch `src/client/pip-memory.js` (that file is about
replaying a conversation, not this memory). Do not offer the tools on the tab path.
