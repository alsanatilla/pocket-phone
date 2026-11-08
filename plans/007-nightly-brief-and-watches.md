# 007 — A brief that reads, and watches that stay quiet

- **Status**: DONE
- **Severity**: HIGH (Pip is reactive today: it speaks when spoken to, or on a timer that always speaks)
- **Category**: Missed opportunities
- **Scope**: `src/server/pip-background.js`, `services/pip/worker.mjs`, `src/client/pip-away.js`, `src/client/pip-routine-model.js`, `tools/pip-brief.test.mjs`, plus docs
- **Depends on**: the detached worker (`services/pip`) for low-latency schedules, though both kinds also run from the existing cron

## Problem

Every scheduled run in Pocket speaks. That is right for a check-in and wrong for everything else. Two things
follow from it:

- **A brief is not a check-in.** The morning check-in lists overdue tasks. It cannot say what *changed*, because
  it has no memory of the last one, and it cannot notice that two notes are about the same thing.
- **Pip cannot watch anything.** If you want to be told when something appears — a project you keep circling, a
  promise you made, a name you mentioned once — there is nowhere to put it. You have to remember to ask.

The cost model made this worse: a routine that always answers spends tokens saying "nothing new" every day.

## What this adds

### Two new routine kinds on the existing routine row

No new table, no new scheduler, no new API. `pocket_pip_routines` already carries the item, its `next_run`, a
claim lock, the reply chat, the run history and the push notice. Two kinds join `checkin`, `prompt` and `training`:

| Kind | Speaks when | Message |
| --- | --- | --- |
| `brief` | Something changed since the last brief | Fixed prompt (`BRIEF`), no user text to write |
| `watch` | The model finds a new match | The user's "what to watch for", wrapped by `watchMessage()` |

### `brief` — read what changed, not what exists

- The message asks for five short parts — what changed, what is rotting, one connection or contradiction, the one
  action that would help today, and an optional closing line — and demands that a part with nothing to say is left
  out. No headings, under 150 words, no invented records.
- **The "nothing changed" guard runs before any request.** One query compares the newest record revision with the
  routine's `last_run` (`newestRecordAt()`). Equal or older means `status: 'unchanged'` and no model call at all — the
  same status the training planner already uses for an unchanged workout set.
- **The guard reads where the records actually live.** Content is one document per collection in
  `pocket_documents`; chats are objects in `pocket_objects`. `newestRecordAt()` takes the newest of the two, ignores
  chats (its own output, which would otherwise wake it every night) and ignores drafts, the clock, receipts and
  preferences (which change constantly and are not news). Six tests against a throwaway libSQL file pin all three.
- **The digest names the changed documents**, so a run knows that `tasks` and `notes` moved before it reads them.
- **An empty first brief stays silent.** With no records at all there is nothing to compare, and a request spent
  saying "nothing is here" is the exact waste this plan removes. The routine waits for the first record instead.
- When something did change, the prompt gains a **deterministic digest**: records changed per collection
  (`tasks: 2, notes: 1`). It is a map of what is new, never a substitute for reading the record, and it costs a
  couple of dozen tokens rather than a pre-computed summary.
- The reply arrives in a monthly chat per routine, exactly like every other routine, and notifies through the
  existing push path.

### `watch` — a routine that is allowed to say nothing

- The user writes one sentence: *"Tell me if I mention the Lisbon trip again."*
- The message is the watch plus the same incremental boundary (`since <last run>`), and the model is told to answer
  exactly `SKIP` when nothing matches.
- `quietWatch()` recognises that answer (`/^\s*skip\b/i`, so `SKIP`, `skip.` and `SKIP: nothing new` all count, and
  `SKIPpy` does not). A quiet run **removes its own turn from the chat**, records `status: 'unchanged'`, charges the
  tokens it actually spent and sends no notification. Nothing to read, nothing to dismiss.
- A match replies in at most 80 words: what, where, what to do next. The watch reads its own earlier answers in the
  same chat and is told not to report the same thing twice.

## Routines without a cron

`runPipJob()` used to be reachable only through `GET /api/jobs/pip`, which needed an external caller every 15
minutes. The worker now runs it itself when `PIP_ROUTINES_EVERY_MS` is set:

- A timer in `services/pip/worker.mjs`, guarded by one in-flight flag so a slow sweep is never stacked.
- Safe beside the cron: `runClaimed()` claims the routine row with `lock_until`, so two processes cannot run the
  same routine twice. The cron can stay as a fallback and the two never fight.
- `/healthz` gained `routines: { everyMs, ran, failed, busy }`.

With `PIP_ROUTINES_EVERY_MS=60000` a check-in or watch lands within a minute of its time instead of up to a quarter
of an hour late.

## Cost

Both kinds are bounded by the existing per-account daily limit (`dailyTokens`) and charged through `chargeTokens`.

| Run | Input | Output | Notes |
| --- | --- | --- | --- |
| Brief, nothing changed | 0 | 0 | one SQL query, no request |
| Brief, something changed | ~2–8k | ~300 | tools read only what it cites |
| Watch, quiet | ~1–3k | ~10 | one request, then silence |
| Watch, match | ~1–3k | ~150 | one request, then a notice |

At one brief and three watches a day that is well under 300k tokens a month — inside a subscription plan, and a few
cents metered.

## Deliberately not done

- **No new tool.** A watch is created where every other routine is created, so the phone and the browser both get it
  without a parallel tool catalogue, and the model cannot quietly create standing work for the user.
- **No embeddings, no nightly batch over every record.** The guard plus the model's own reads were enough. A
  vector pass would add an index to keep in sync and a second place where "what changed" is computed.
- **No new chat per watch.** Watches share the existing monthly routine chat, so the conversation list stays short.

## Verification

`node --experimental-vm-modules --test tools/*.test.mjs` — every suite green, including 16 for this plan:

1. a brief needs no prompt, gets a readable default name, and keeps a name the user chose;
2. a brief ignores a prompt and refuses an unknown kind;
3. a watch keeps its sentence, refuses to exist without one, and cannot carry an essay;
4. only a one-word `SKIP` silences a watch (`SKIPpy` and ordinary prose do not);
5. both kinds are scheduled by the existing `nextRun`, including a chosen-days case.

5. `newestRecordAt` ignores chats, drafts, the clock and receipts, and sees documents and objects (6 DB tests).

Live checks on the self-hosted worker, all three paths run for real against the account holding the OpenCode Go key:

- a forced brief wrote one turn in `pip-routine-…-2026-11` (15.7k in / 1.2k out, 13.4k cached) and opened with
  "One thing changed: a new note …";
- a watch with nothing to match returned `unchanged`, wrote no chat object and sent no notice;
- after a matching note was added, the same watch replied in 60 words with the note, its collection and a next step;
- `/healthz` reports `routines: { everyMs: 60000, ran, failed, busy }`.
