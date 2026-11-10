# Cards you can use: the plan and its tasks

Read `docs/agents/GUIDELINES.md` first. Do only the task you were given; only tasks marked **ready** may be started.

## Where we are

Pip draws a card with `show_card` and changes one with `update_card` (section "Cards stay alive" in
`docs/pip-message-flow.md`). A card is kept in a turn's `answer` as a `pocket` fence of JSON Lines; its first lines
are marks: `/id` (its id) and `/updated` (when it was last changed). The person cannot do anything with a card yet
except press a button Pip put in it.

## Where we are going

1. **C1–C2**: pin a card so it also shows on Today (the same card, not a copy), remove a card, and ask Pip about one
   card ("change this", "refresh this").
2. **C3**: a pinned card with a source keeps itself current on a schedule.
3. **C4**: Pip asks with a form card instead of several messages; approvals are cards.
4. **C5**: a threshold on a figure ("tell me when this drops below 850").

---

## C1 — A card can be pinned, removed and referred to (data and logic; implemented)

No visible UI in this task. You add the mark, the functions the UI will call, and their tests.

### 1. The `/pinned` mark (shared)

A pinned card carries one more mark line, after `/updated` and before `/root`:
`{"op":"add","path":"/pinned","value":<time in ms when it was pinned>}`.

- `src/shared/pocket-spec.js`: read how `/id` and `/updated` reach the spec `pocketSpec` returns, and let `/pinned`
  reach it the same way (`spec.pinned`, a positive number, else absent).
- `src/shared/pip-reply.js`, `canonicalCard`: keep the line, exactly like `/updated`.
- `src/shared/pocket-card-tool.js`: `cardFence(spec, { id, updated, pinned })` writes it; and a new export
  `cardMarks(spec)` → `{ id, updated, pinned }` holding only the marks that are set on a spec `pocketSpec` returned,
  so a caller can rebuild a card without losing one.
- `src/client/pip-stream.js`, the inner `reviseCard` (what `update_card` runs): a card Pip changes keeps its pin.
  Today it rebuilds the fence with the id and a new `updated`; pass the old card's `pinned` on as well. This is the
  only change in that file.

### 2. `src/shared/pocket-card-edit.js` (new, with `.d.ts`): changing one card in an answer

Pure functions on an answer string; they use `pocketSpec`, `cardFence`, `cardMarks`, `replaceCard` and
`normalizeAnswer`. Each returns the new answer, or `null` when the answer has no card with that id.

- `pinCard(answer, id, at)` → the card with `pinned: at`; `at` 0 (or omitted) unpins it. Its other marks and all its
  elements stay byte-for-byte what `cardFence` writes for the same spec.
- `dropCard(answer, id)` → the answer without that card, normalized with `normalizeAnswer` (so the blank lines
  around it close up). An answer that held only that card becomes `''`.
- `cardsIn(answer)` → `[{ id, pinned, updated, source }]` for each card that has an id, in order; `source` is the
  fence's inner text (what the `Card` component takes as `source`).

### 3. Referring to a card in a message

When the person asks about one card, their message ends with a trailer on its own last line:
`[about card <id>]`. It is ordinary text in the turn, so every path carries it.

- `src/shared/pocket-card-edit.js`: `aboutCard(text)` → `{ text, id }`: `text` without the trailer (trimmed) and the
  id, or `{ text, id: '' }` when there is none. `withCard(text, id)` → `text` with the trailer added (replacing one
  that is already there). The trailer counts only as the last line; the id must match `^[a-z0-9]{4,24}$`.
- `src/shared/pocket-cards.js`, `CARDS_PROMPT`: one added sentence, next to the sentences about `update_card`: a
  message that ends with "[about card <id>]" is about that card; change it with update_card and that id. Plain
  wording in the style of its neighbours.

### 4. `src/app/data/cards.ts` (new): what the UI calls

Uses `chats` and `listChats` from `./chats.ts` and the functions above. Read `src/app/data/chats.ts` and
`ChatStore.update` in `src/client/pip-core.js` first.

- `pinnedCards()` → `{ chat: string; chatTitle: string; turn: string; id: string; pinned: number; source: string }[]`
  for every pinned card in every chat that is not deleted, newest pin first. Skip turns whose `answer` does not
  contain the text `/pinned` before parsing anything (most turns have no card).
- `setCardPinned(chat: string, id: string, pinned: boolean)` → boolean (false when the chat or card is not there).
  Finds the turn holding the card, replaces its answer with `pinCard(...)`, and sets that turn's `updated` to
  `Math.max(Date.now(), (turn.updated ?? 0) + 1)` so the change wins the merge on other devices (see `mergeObject`
  in `src/shared/objects.js`). One `chats.update` call.
- `removeCard(chat: string, id: string)` → boolean, the same way with `dropCard`.
- A turn whose `status` is `streaming` is never changed: both return false.

### 5. Tests

`tools/pip-cards.test.mjs` (add; build cards with `cardFence`):

1. `pinCard` pins, re-pins with a new time, unpins; id, `updated` and elements are unchanged each time (compare
   `pocketSpec` results); the prose around the card is untouched; unknown id → `null`.
2. `normalizeAnswer` keeps the `/pinned` line and its position.
3. Through the real pipeline (as the existing `update_card` tests in that file do): a pinned card in an earlier turn
   that the model changes with `update_card` is still pinned afterwards, with the new figures and a new `updated`.
4. `dropCard`: card between two paragraphs → the two paragraphs with one blank line between; only card → `''`;
   two cards → only the named one goes.
5. `cardsIn` lists ids, marks and sources in order and skips a card without an id.
6. `aboutCard` / `withCard`: round trip; a trailer in the middle of the text is not one; an invalid id is not one;
   `withCard` on a text that already has a trailer replaces it.
7. The prompt contains the new sentence (assert on a distinctive part of it).

`src/app/data/cards.test.ts` (new; see `src/app/data/data.test.ts` for how these tests set up storage):

8. `pinnedCards` finds pinned cards across two chats, newest first, with the chat's title; unpinned and deleted
   chats' cards are not listed.
9. `setCardPinned` pins and unpins, bumps the turn's `updated`, and returns false for a missing chat, a missing card
   and a streaming turn. `removeCard` removes the card and keeps the turn.

### Files you may touch

`src/shared/pocket-spec.js`, `src/shared/pip-reply.js`, `src/shared/pocket-card-tool.js`,
`src/shared/pocket-card-edit.js` + `.d.ts` (new), `src/shared/pocket-cards.js`, `src/client/pip-stream.js` (the one
change named above), `src/app/data/cards.ts` + `cards.test.ts` (new), `tools/pip-cards.test.mjs`, a `.d.ts` beside a
shared file you changed if typecheck needs it, and `docs/pip-message-flow.md` (append a short section "The person
can pin, remove and point at a card").

### Do not

No React components, no CSS, nothing in `src/app/features` or `src/app/surface`. Do not change `show_card`'s or
`update_card`'s arguments. Do not store pins anywhere but in the card.

---

## C2 — The card menu and pinned cards on Today (UI; implemented by the lead)

Finished cards with an id have a menu to pin/unpin, ask Pip to change or refresh that card, and remove it after
confirmation. The menu has its own space above the generated content and a 44px touch target on phones.
Today reads pinned cards from their original chats and offers the same change/refresh actions plus a link back
to the chat. Changes in storage update Today through the existing collection bus. The card reference is carried
in the message trailer; the chat shows “about a card” instead of the internal id.

Component tests cover menu visibility, pinning, Today updates, unpinning, targeted requests, confirmation and a
card disappearing before removal. A local Chromium check at 390px covers pin → Today → unpin and overflow.
C1–C5 are deployed (Vercel builds `main`); a live-model check of these menu requests is still outstanding.

## C3 — A pinned card keeps itself current (implemented)

A pinned card that names a web source (a Chart or Table with `source.url`) is kept current by a watch routine of
its own: pinning starts it, unpinning and removing stop it. The routine answers in the card's own chat, so the card
is changed with `update_card` where it stands, and answers `SKIP` when only the figures moved. It reads the source
every six hours inside 07:00–22:00; the person can pause or reschedule it in `/jobs` like any other routine.

- `sourceUrl` and `cardName` (`src/shared/pocket-card-edit.js`) find the address and a short name in the card.
- `src/app/data/card-watch.ts` builds and saves the routine (`kind: watch`, `chat`, `card`, `every: 360`),
  resumes one that was paused, and deletes it when the card is unpinned or removed.
- A routine may name the chat it answers in (`chat`, `card` in `src/server/pip-background.js`), and a watch with
  one is not skipped for "nothing new in the workspace": its source is outside the workspace.
- Pinning still works without a routine: signed out, or with no key for Pip on its own, the toast says so.

## C4 — Forms and approvals as cards (implemented)

- A `Form` card asks for up to six answers in one card instead of one question per message: labeled fields of type
  `text`, `number` or `choice`, one submit, and what the person filled in comes back as one ordinary message.
  It is in the surface catalog, the card catalog (`CARD_COMPONENTS`) and the cards prompt.
- Approvals and write proposals already draw as cards (`Frame` in `src/app/features/pip/Offers.tsx`), in the same
  border and ground as a generated card, with approve or decline on the card itself.

## C5 — Thresholds (implemented)

A figure can carry a threshold the person sets from the card's menu ("tell me when it drops below…" / "rises
above…"), for a card that names a source. The threshold is a mark inside the card, like the pin:
`{"op":"add","path":"/alert","value":{"below":850}}` after `/pinned` and before `/root`, kept by `update_card`,
`normalizeAnswer` and every other rewrite. Setting one pins the card and starts the C3 watch with the threshold in
its prompt, so the routine tells the person when the figure crosses it and stays quiet otherwise; the card's header
shows the threshold beside the time. "stop telling me" clears the mark and leaves the card current.
