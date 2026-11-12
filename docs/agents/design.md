# Pocket's look: "Terminal"

The person chose this direction on 2026-11-12 after calling the old look "AI slop". It is the law for every screen.
Read `docs/agents/GUIDELINES.md` first; a task that restyles a screen names its section below.

The foundation is built: tokens and type in `src/app/styles/global.css`, the header in `src/app/shell/Shell.tsx`,
a reply in `src/app/features/pip/Turn.tsx` and the `.prose` rules. **Look at those before writing anything**: a
restyled screen must look like it belongs next to them.

## The rules (second version, 2026-11-12)

The first version replaced boxes by hairlines and buttons by dim words. The person's verdict: "still too many
lines, no visual hierarchy, hard to understand what is a button and what is not." These rules replace it. The
building blocks are in code: **`src/app/ui/kit.tsx`** (`Section`, `SectionLabel`, `Row`, `Tick`, `Segmented`,
`Keys`, `Figures`, `Figure`), **`src/app/components/ui/button.tsx`** (the key) and `switch.tsx`. A screen is made of
these; it does not repeat their classes by hand.

1. **One typeface.** IBM Plex Mono at the body size (`text-sm`), normal letter-spacing. The pixel face
   (`font-pixel`) only for the name "pocket" and a page's one big title (`PageTitle`).
2. **Two lines in the whole app**: under the header and over a page's prompt line. No other rule, border or
   divider: not between rows, not around or between figures, not under labels, not around sections. Space
   separates. (Floating surfaces, a menu, dialog or sheet, keep their one outline.)
3. **What can be pressed has a shape; what cannot has none.**
   - An action is a **key**: `<Button>`. Quiet by default; `variant="go"` (amber) for the one main action of a
     screen or dialog; `variant="destructive"` for removing. Never a bare word, never an underlined word, never an
     icon alone (except the header's settings and the composer's send key).
   - On/off is a **`Switch`**. Done/not done is a **`Tick`**. A choice of view is a **`Segmented`**.
   - A row that leads somewhere is a **`Row` with `onOpen`/`href`**: it ends in `›`.
   - A link inside running text is amber and underlined.
   - Text that is not pressable never looks like any of these: no fills, no underline, no amber, no `›`.
4. **Three levels.** The page title (pixel, 30px). A section's name (`SectionLabel`: small, upper-case, dim) with
   24px above it and 4px below. Content: the main line `text-hi`, a second line `text-xs text-dim`, running text
   `text-foreground`. Figures are `Figure`s: 22px, all the same size in a group.
5. **Colour.** `text-hi`, `text-foreground`, `text-muted-foreground`, `text-dim`; amber for the name, the prompt
   marker, the caret, the `go` key, a switch that is on, a link in text; `text-destructive` for overdue, errors and
   a destructive key's words. Chart colours for charts only.
6. **Rows** are `Row`s: optional lead (a `Tick`, a time), main line, optional second line, optional end (a note, a
   key, a switch). Keys that belong to a row go at its end when there is one, or in a `Keys` line under it when
   there are two or more.
7. **Fields are prompt lines** (`src/app/ui/SendButton.tsx`, `PipComposer.tsx`): a marker, the text, and a `go` key
   to send. Only the page's main field has the line over it (rule 2).
8. **Rhythm.** 12px between paragraphs, 24px between sections, 16px page padding. Nothing centred except an empty
   state's one sentence.
9. **Wording.** Lower-case labels and keys; sentences end with a full stop; no exclamation marks, no emoji. Times
   `08:07`, durations `6 s`.
10. **Motion.** What exists stays. Add none.

## How a restyle is done

- Change classes and markup of the screen you were given; behaviour, data and tests of behaviour stay.
- Do not add a colour, a font size outside those above, a radius, a shadow or a component library piece.
- Tests that assert text or roles must pass unchanged; a test that asserts a class name you removed is updated and
  named in the report.
- Before and after pictures from the lab are part of the task (`docs/agents/chat-polish.md`, P1 and P3, has the
  commands). If your screen has no lab state, add one in the lab's pattern. Open your pictures at 390px and compare
  them with `long-phone.png`: same greys, same sizes, same lines.
- Say in the report what you were unsure about. A screen that still has a box "because the component needs it" is
  not done: say which component, and stop.

---

## Tasks

| # | Screens | State |
|---|---|---|
| D0 | Foundation: tokens, header, a reply, its Markdown, the composer's prompt line | done |
| D1 | Cards and Today (everything the card registry draws), the card menu | ready |
| D2 | Fields and lists: the composer's lower row, the model picker's trigger, Notes, Tasks, a task's page | ready |
| D3 | The chat list, Memory, Jobs, Settings, dialogs and menus, toasts | not ready |
| D4 | The note editor | not ready |

### D1 — Cards and Today

Everything a card or Today's surface can draw comes from `src/app/surface/` (`components.tsx`, `controls.tsx`,
`registry.tsx`, `cards.tsx`, `Surface.tsx`, `TodayActions.tsx`, `ChartPlot.tsx`). Restyle all of it to the rules,
then the two places that frame a card (`src/app/features/pip/stream/Card.tsx`, `CardMenu.tsx`) and Today's page
(`src/app/features/today/TodayPage.tsx`, `PinnedCards.tsx`).

- **Metric / tiles** follow rule 6 exactly. Today a tile is a bordered box and its figure is in the pixel face, at
  a size that depends on its length ("7 h 12" small, "62" large): both go. A `Grid` of metrics is one group of
  columns; two metrics are two columns, four are two rows of two (hairline between the rows).
- **Card, Stack, Grid** draw no frame and no background: they only arrange. A `Card` with a title shows the title
  as a rule-4 label.
- **Table** as in `.prose table` (`global.css`). **TaskList / ThoughtList / schedule rows** follow rule 5.
- **Button** in a card: a word (rule 7) in `text-primary` with `›` before it, one per line or in a row with 16px
  between; a card's choices are not filled buttons.
- **Chart**: no frame, no background; axis labels and ticks `text-dim` at the label size; one hairline as the
  baseline; series in the chart colours as now. Do not change what a chart computes.
- **Forms in a card** (`controls.tsx`): fields as prompt lines (rule 8); the submit is the one filled button.
- **Text, Heading, Badge, Hero**: plain text in the four greys; a Hero figure is `text-[28px] font-medium text-hi`
  in the mono face; a Badge is `text-xs text-dim` in square brackets, e.g. `[stabil]`.
- **The card menu**: today its `⋯` button floats in an empty band above the card. Remove that band. A finished
  card with an id gets one line under it: at the left its note (`pinned to today`, `updated 12:05`, `keeps itself
  current`, joined with ` · `) in `text-xs text-dim`, at the right the word `more`, which opens the same menu
  (`aria-label="Card options"` stays). 44px tall on touch. Menu items stay as they are.
- **Today**: the date line is `text-xs text-dim`; the page's title stays in the pixel face but in `text-hi`, not
  amber; pinned cards come first, each under a rule-4 label made of its chat title at the left and `from pip` at
  the right; the thought field is a prompt line with `+`; the line at the bottom ("Standard layout" / `arrange`)
  is `text-xs text-dim` words on one line, no dashed rule, no button chrome.

Lab: use the existing states `long`, `card-building`, `card-menu`, `today-pinned` (do not add states: another
agent edits the lab's table). Add to your report the before/after of those four at phone size.

Files: `src/app/surface/*.tsx` (not the tests' meaning: update only class assertions), `src/app/features/pip/stream/Card.tsx`,
`CardMenu.tsx`, `src/app/features/today/*.tsx`, and style rules for these in `src/app/styles/global.css` (the
`.pocket-*` block for legacy cards may be restyled to the rules too). Nothing else.

### D2 — Fields and lists

- **`src/app/ui/SendButton.tsx`** holds the shared field pieces (`FIELD`, `BARE_INPUT`, send and stop buttons).
  Make them rule 8: no frame, a top hairline where the field ends a page; the send button is a 32px square,
  `rounded-sm`, amber when there is something to send, `bg-secondary text-dim` when not; stop is the same square
  with `■`. Every user of these pieces (search with `grep -rn "SendButton\|FIELD\|BARE_INPUT" src/app`) must still
  look right: check Tasks, Memory and Today's thought field.
- **The composer's lower row** (`src/app/features/pip/PipComposer.tsx`, `ModelPicker.tsx`): one line under the
  prompt line: at the left the web toggle as the word `web` (`text-hi` when on, `text-dim` when off; its
  `aria-label` and behaviour stay), then the model's name as `text-xs text-dim` with a small chevron (the trigger
  of the picker; the list itself is D3); at the right the send square. The row is 44px tall on touch and there is
  no empty space under it beyond the page's bottom padding: find why the page leaves a band under the composer on
  a phone (`PipPage.tsx` and `Shell.tsx` paddings) and remove it, keeping the safe-area inset.
- **Notes list** (`src/app/features/notes/NotesPage.tsx`): `/` prompt line for search at the top; rule-4 labels
  (`pinned`, `recent`); rule-5 rows: title, first line under it, date at the right; the count at the end in
  `text-xs text-dim`. New note is the word `+ new` at the right of the header line of the page, not a filled button.
- **Tasks** (`TasksPage.tsx`, `TaskPage.tsx`): groups under rule-4 labels with their counts at the right
  (`overdue` in `text-destructive`); rule-5 rows with `[ ]` / `[x]`; steps progress as the second line; the new
  task field is a `+` prompt line at the bottom. A task's page: the title in `text-hi`, its fields as label/value
  rows, its actions as words.
- **`src/app/ui/PageTitle.tsx`**: pixel face, `text-[30px] leading-none text-hi`, with an optional quiet line
  under it.

Lab: add the states `notes` (six notes, one pinned, one with a 120-character title) and `tasks` (overdue, today
with one done, this week with one that has steps, later). Before/after of `notes`, `tasks`, `empty`, `long` at
phone size in the report.

Files: `src/app/ui/SendButton.tsx`, `src/app/ui/PageTitle.tsx`, `src/app/features/pip/PipComposer.tsx`,
`ModelPicker.tsx` (the trigger only), `PipPage.tsx` and `src/app/shell/Shell.tsx` (bottom padding only),
`src/app/features/notes/NotesPage.tsx`, `src/app/features/tasks/*.tsx`, `tools/manual/chat-lab.mjs` (the two
states). Nothing else.

### D3 — Everything else that still has a box (ready; D1 and D2 are merged)

Restyle to the rules, in this order, and stop to report after the list if time runs short rather than rushing:

1. **Pip's leftovers** (`src/app/features/pip/`): the empty chat (`Empty` in `PipPage.tsx`: the small amber
   pixel `pip` goes; one sentence in `text-muted-foreground`, starters as words with `›` before them, one per row,
   rule 5); the source chips above the composer (`PipComposer.tsx`: `kind · title` as `text-xs text-dim` with the
   word `remove`); the folds in `Turn.tsx` (`Fold`: the lookups are listed open as rows `✓ title · summary` with the
   duration at the right in `text-dim`, in `text-xs`; when a reply is finished and has more than three, the list
   folds to one line `n steps · 6 s` that opens on tap; `reasoning` stays a fold, as a word); the failed/unfinished
   block (a `text-destructive` sentence and the words `continue` · `start over`, no dashed frame); `Offers.tsx`
   (an approval is a label, the proposal as rows, the words `decline` · `review` · `save`, the one filled button
   only for the final save inside the review).
2. **The chat list** (`ChatList.tsx`): a sheet with rule-4 labels and rule-5 rows; the current row is
   `bg-secondary` without an amber edge; `+ new chat` is a word at the top right, not a filled bar; each row's
   options are the word `more`.
3. **The model picker's list** (`ModelPicker.tsx`): rows; the provider as a rule-4 label; the chosen model in
   `text-hi` with `[x]`; `free` in `text-dim`.
4. **Menus, dialogs, sheets, toasts** (`src/app/components/ui/dropdown-menu.tsx`, `dialog.tsx`, `sheet.tsx`,
   `sonner.tsx`, `src/app/ui/dialog/DialogHost.tsx`): a menu or dialog is the one place a surface is allowed, because
   it floats: `bg-popover`, a 1px `border`, `rounded-sm`, no shadow beyond the existing one being reduced to none;
   items are rows of words, 44px on touch; a dialog's actions are words at the right with the confirming one in
   `text-primary` (a destructive one in `text-destructive`); its field is a prompt line. A toast is one line of
   `text-xs` on `bg-popover` with a hairline, no icon.
5. **Memory** (`src/app/features/memory/MemoryPage.tsx`): rule-5 rows without the surrounding frame; `since …` and
   the actions `edit` · `forget` on the row's second line; the add field a `+` prompt line.
6. **Jobs** (`src/app/features/jobs/`): each job a row with its schedule on the second line and its state at the
   right; the editor's fields as label/value rows and prompt lines.
7. **Settings** (`src/app/features/settings/SettingsPage.tsx`): sections under rule-4 labels, each setting a
   label/value row; no section frames.

Lab: add the states `settings`, `jobs` (two jobs, one failed), `dialog` (the rename prompt open) and `model-list`
(the picker open); update `card-menu` and `chat-list` if their checks change. Before/after at phone size for:
`empty`, `long-top`, `failed`, `approval`, `chat-list`, `card-menu`, `memory`, and the four new ones.

Files: `src/app/features/pip/*.tsx` (not `stream/`), `src/app/features/memory/*.tsx`, `src/app/features/jobs/*.tsx`,
`src/app/features/settings/SettingsPage.tsx`, `src/app/components/ui/dropdown-menu.tsx`, `dialog.tsx`, `sheet.tsx`,
`sonner.tsx`, `src/app/ui/dialog/DialogHost.tsx`, `tools/manual/chat-lab.mjs`, tests beside these files for class
assertions only. Nothing else.


---

## Second pass: every screen on the building blocks

The first pass (D1–D3) is merged but follows the first version of the rules. This pass moves every screen onto
`kit.tsx`, `Button` and `Switch` and removes every line rule 2 does not allow.

What it means in practice, for every file you are given:

- Delete `border-t`, `border-b`, `border-y`, `border-l`, `divide-*` and `<hr>`/Separator uses, except the two lines
  of rule 2 and the outline of a floating surface.
- Every pressable word (`edit`, `forget`, `more`, `disconnect`, `continue`, `start over`, `decline`, `review`,
  `pause`, `run now`, `remove`, `clear`, `+ new`, `+ list`, `arrange`, `keep`, `save` …) becomes a `<Button>` with
  the right variant. One `go` key per screen or dialog at most.
- Every `[ ]` / `[x]` text becomes a `Tick` (done/not done) or a `Switch` (on/off); `role` and labels stay.
- Every list becomes `Row`s inside `Section`s; every label a `SectionLabel`; a view switch a `Segmented`; figures
  `Figures`/`Figure`.
- A row that navigates uses `onOpen`/`href`; a row that only shows something has neither.
- Tests of behaviour must pass. Where a test looked for a word button by role and name, it still finds it (a
  `Button` is a button). Update a test only where markup it reached into is gone, and list it.

| # | Files | State |
|---|---|---|
| E1 | `src/app/surface/*.tsx` (cards and Today's blocks), `src/app/features/pip/stream/Card.tsx`, `CardMenu.tsx`, `src/app/features/today/*.tsx`, the `.pocket-*` and `.prose` rules in `global.css` (tables: no rules between rows, 6px row padding; code: no left rule, `bg-secondary` behind the block with `rounded-[5px]` and 10px padding, the one filled non-pressable shape allowed) | ready |
| E2 | `src/app/features/pip/*.tsx` (not `stream/`), `src/app/ui/SendButton.tsx`, `src/app/features/notes/NotesPage.tsx`, `src/app/features/tasks/*.tsx` | ready |
| E3 | `src/app/features/memory/*.tsx`, `src/app/features/jobs/*.tsx`, `src/app/features/settings/SettingsPage.tsx`, `src/app/components/ui/dropdown-menu.tsx`, `dialog.tsx`, `sheet.tsx`, `alert-dialog.tsx`, `src/app/ui/dialog/DialogHost.tsx`, `src/app/ui/PageTitle.tsx` | ready |

Each task: lab before and after (all states), the pictures of its screens compared at phone size and described,
the four commands. `tools/manual/chat-lab.mjs` may be changed only where a state's own check reaches into markup
that changed (say what). `kit.tsx`, `button.tsx` and `switch.tsx` are not to be changed: if a block is missing
something, stop and say what.
