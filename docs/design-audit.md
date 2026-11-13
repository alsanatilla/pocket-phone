# Design audit of the React screens, 2026-11-13

Each screen in `src/app/router.tsx` (and its menus and dialogs) and `/ios`, checked against `docs/DESIGN.md` on a
390 × 844 picture taken with the lab (`tools/manual/chat-lab.mjs`, seeded fake accounts, no model calls), and on the
1280 × 800 picture for two screens (see "Not looked at"). "Fixed" means the change is in this branch and the after-picture was
looked at. "Open" means it is still wrong or still needs a decision; nothing below is called fine because a test
passed.

The pictures were taken into the session's scratchpad (`before/`, `final/`, `mock/`) and are not committed: the
lab writes them again with `node tools/manual/chat-lab.mjs --only <state>`. New lab states: `task-detail`,
`task-menu`, `tasks-next`, `note-editor`, `ios`; `settings` and these new ones are now whole-page pictures.

## What changed across screens

| Change | Where | Guide |
|---|---|---|
| Dates read `13 Nov`, whatever the browser's language (`dateAt` in `src/app/lib/utils.ts`); the lab's browser wrote `Nov 13` | notes, memory, chat list, tasks, jobs' next run and once | 15 |
| A section's count shows only from seven rows (`Section`'s new `count`) | tasks, notes, memory | 9 |
| No `›` on rows of a list where every row opens its thing | tasks, notes, model picker | 9, 18 #5 |
| `RowMenu`'s dots sit on the row's first line (they sat about 5 px low on every row) | every `RowMenu`: Today, memory, jobs, task steps, chat list | 4, 12 |
| Dialogs lose the corner "close" key; `DialogFooter cancel` puts a quiet cancel before the confirming key | job editor, Pip's review dialogs | 13, 18 #7 |

## Screen by screen

### Today (`today-morning`, `today-evening`, `today-decision`, `today-empty`)
Approved design; looked at again because of the `RowMenu` change and the day fix.
- **Fixed (behaviour):** after midnight Today mixed two days. `dayPart` said evening until 04:00, but the date, the tasks
  ("late", "tomorrow", finished today) and the day's note used the new calendar day, while the appointments showed the
  new day's under the label "tomorrow". Now one rule: before 04:00 a look belongs to the evening before (`dayMoment`,
  `dayOf` in `src/app/data/today.ts`). At 01:00 on Tuesday Today shows "Mon 9 Nov · evening", Monday's tasks as not
  yet late, Tuesday's as "tomorrow", what was finished Monday evening and after midnight, and Tuesday's appointments.
  Tests at 18:00 and 01:00 give the same picture; from 04:00 it is Tuesday's morning. Side effect, deliberate: a task
  finished between 00:00 and 04:00 counts for the evening before, not for the next morning.
- Fixed: the dots of an assignment's row are on its line now.
- Open: none found in the pictures.

### Pip: chat, cards, status, chat list, model picker (`long`, `card-menu`, `chat-list`, `dialog`, `model-list`, `approval`)
- **Fixed:** the model picker drew `›` on every model and a long name ran under "think free 1024k"
  (`ERNIE-5.5-Flash-Preview`): the name's `truncate` was on an inline span. Names are cut now; no arrows.
- Fixed: chat list dates `10 Nov`.
- Fixed: Pip's review dialog had a "close" key in its corner; it has cancel next to its confirming key now (not
  photographed: the lab has no state with the review dialog open).
- Open: the model picker's popover sits about 4 px off the page's right edge on a phone (its width is
  `min(22rem, 100vw - 1.5rem)`, the page gutter is 16 px). Small; not changed.

### Notes list (`notes`)
- **Fixed:** an arrow on every row; counts 1 and 5 beside the labels; `Nov 13` dates; a hairline above the search
  field (a field inside a page has no line, 11).
- Open: the 120-character title wraps over four lines; the guide says names truncate in a list of destinations but a
  note's title is also its content. Left as it is; a decision for the person.

### Note editor (`note-editor`)
Not changed: a redesign was asked for as a mock first, `docs/mockups/note-editor.html`. What the current one breaks:
three icon-only keys (eye, pin, bin; 8.5), the bin beside pin instead of last in a menu (8.6), the keys reach past the
right page edge at 390 px, "‹ notes" is dim text and not a key (8.1), a green or pulsing amber dot as the save state
(signal colours as states, 6), and the text sits 6 px in from the page's left edge (4). The classic editor's
history, "ask pip" and paper page are missing here.

### Tasks list (`tasks`, `tasks-next`)
- **Fixed:** an arrow on every row; counts beside the labels; the add field floated mid-page under a short list
  (18 #15) and now ends the page; in "next 7 days" the group said "Monday, Nov 16" and each row said "Mon" again: the
  group now says "Monday 16 Nov" and the rows only their steps; a template's "use" key on every template row moved
  into the row's menu (not photographed: the lab account has no template).
- Open: the lists of a person are a row of keys (`# name 3`) under the views strip. With many lists this becomes a
  wall of keys; the fix is a design decision (a list, or a sheet), not a correction.

### Task detail (`task-detail`, `task-menu`, `task-focus`)
- **Fixed:** four keys at the end (save task, complete, cancel, delete). Now: `save task` (go), `complete`, and the
  task's `⋯` at the far right with `delete` (asks first). `cancel` went: the `‹ tasks` key above does the same.
- Fixed: a red `remove` key on every step; each step's `⋯` has `remove`.
- Fixed: "0/0" beside "steps" when there are none; date, list and important labels sit on their values' line.
- Open: the date field is the browser's own (`11/16/2026` in an English-US browser, not `16 Nov`); a custom date
  control is a design change. The rows of date and list are taller than the others (the native controls' height).
- Exception, written down: the task's menu is a `RowMenu` at the end of the keys line, not of a list row. It is the
  one place for what a single item can do beyond its two keys (section 8's decision order ends in "a menu").

### Memory (`memory`, `memory-empty`)
- **Fixed:** `since Nov 13` dates; the count "4" beside the label; the add field ends the page instead of floating
  under the list.
- Open: none found.

### Jobs and the job editor (`jobs`, `job-editor`)
- **Fixed:** the section label "jobs" repeated the page's title (18 #16) with a count; the header's meta wrapped
  beside "+ new job" and now says only "today 0k of 200k tokens"; "next 16 Mon 06:30" reads "next Mon 16 06:30";
  `pip's notes for this job` was a key with dim text (a hand-styled key).
- Fixed: the editor's "close" key in its corner; cancel and save at its bottom right.
- Open: a job is three lines (name, schedule, next run or failure; 7 says a row of three lines is two things), and
  the editor's seven day keys are seven toggle keys side by side (8.4); the chosen days are hard to tell from the
  others. Both need a design, not a correction. The recent runs row's "failed" sits 2 px above its line, as every
  text note at a row's end does (`Row`'s end slot); not changed.
- Open: the lab's `job-editor` state once failed to sign in within 15 s when run after many states; run alone it
  passed. A lab timing problem, not the app.

### Settings (`settings`, whole page)
- **Fixed:** "Pocket on iPhone · widget & shortcuts" was an amber link alone under the title (a link belongs inside a
  sentence); it is a "go to" row under "iphone" now. The sections "jobs" (a row "open jobs") and "memory" (a row
  "memory: …") repeated themselves; they are one "pip" section with two rows. "advanced" was a key with dim text.
- Open: "advanced" for your own endpoint opens fields while the line under it says "Add an endpoint first."; the
  order of that sentence and the key could read better. "connected" is the one bright word in a second line.

### /ios (`ios`, whole page)
- **Fixed:** German, the system font, hand-made grey buttons with borders, its own colours. Now English, Pocket's
  fonts and colours (`global.css`), the page title in the pixel face, section labels, `create key` as the one go key
  and `revoke key` as a destructive key at the far end, the steps as numbered lists, code on `bg-secondary`. Built with
  `Button`, `buttonVariants`, `SectionLabel` and `PageTitle` rendered at build time. The two endpoints, the element ids
  and the script's behaviour are the same; only its two sentences are English now.
- Open: the server's own error messages from `/api/ios/key` are shown as they come.

## Not looked at

- The classic app (`/classic`) and the Android app: out of scope.
- States with no lab state: Pip's review dialog open, a task list's menu (rename, save as template, delete list), a
  template row, a task list view, the jobs setup ("let pip work on its own"), settings while signed out, a job's notes
  open. The code changes there are small and follow the same pattern, but no picture was taken.
- Desktop pictures were taken for every state; I looked at two of them (`job-editor`, `task-detail`). They show
  one more finding, open: the desktop header's sync label reads `SYNCED 08:51 PM`, a 12-hour time in capitals
  (section 15 wants `20:51`), in the shell's header, which this audit did not change.

## The note editor mock

`docs/mockups/note-editor.html`, for the person's yes before anything is built. States: writing, saving, draft
restored, thought parked, long title and body, reading, offline, changed elsewhere, save failed, menu, history, new
note. The "changed elsewhere" state is a proposal: today the newer save wins without a word.
