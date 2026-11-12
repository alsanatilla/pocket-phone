# Pocket's look: "Terminal"

The person chose this direction on 2026-11-12 after calling the old look "AI slop". It is the law for every screen.
Read `docs/agents/GUIDELINES.md` first; a task that restyles a screen names its section below.

The foundation is built: tokens and type in `src/app/styles/global.css`, the header in `src/app/shell/Shell.tsx`,
a reply in `src/app/features/pip/Turn.tsx` and the `.prose` rules. **Look at those before writing anything**: a
restyled screen must look like it belongs next to them.

## The rules

1. **One typeface.** IBM Plex Mono, at the body size (`text-sm`, 13px; 14px on touch screens) with normal
   letter-spacing. The pixel face (`font-pixel`) appears in exactly two places: the name "pocket" in the header and
   the one big title a page may have (`PageTitle`). Never inside content, never for numbers, never for labels.
2. **No boxes.** No bordered or filled containers around content: no cards, bubbles, pills, chips, rounded panels,
   side rules or dashed frames. Things are separated by a hairline (`border-t` / `border-b`, the `border` colour) and
   by space. The only filled shapes are the send button and a selected/hover row (`bg-secondary`).
3. **Four greys and one accent.**
   `text-hi` what the person wrote, titles, figures · `text-foreground` running text · `text-muted-foreground`
   secondary text · `text-dim` labels, times, counts, placeholders. Amber (`text-primary`) only for the name, the
   prompt marker `›`, the caret, the send button and a link in running text. `text-destructive` for overdue and
   errors. Nothing else gets a colour; the chart colours are for charts.
4. **Small labels.** A section starts with a label: `text-[10.5px] uppercase tracking-[0.06em] text-dim`, with an
   optional count or note at the right in `text-xs text-dim` (not upper-case). No icons beside labels.
5. **Rows.** A list is rows: `flex gap-2.5 border-t py-2`, the last one also `border-b`; main text `text-hi`, a
   second line `text-xs text-dim truncate`, the note at the right `text-xs text-dim shrink-0`. A whole row is the
   tap target, at least 44px tall on a touch screen (`min-h-11 sm:min-h-0`). A checkbox is the text `[ ]` / `[x]`
   in `text-dim`; done text is `text-dim line-through`.
6. **Figures.** A group of figures is columns divided by hairlines, between a hairline above and below:
   `grid grid-cols-3 border-y`, each cell `border-l pl-3 py-2` (the first without the left line and padding), label
   as in rule 4, the figure `text-[19px] font-medium text-hi` with its unit `text-[11px] text-dim ml-1`. All figures
   of a group are the same size whatever their length.
7. **Actions are words.** `edit`, `forget`, `pin` as lower-case text in `text-dim hover:text-foreground`, separated
   by space, no button chrome. One primary action per screen may be a filled amber button. Icons only where a word
   does not fit (the header's settings, the composer's send); 16px, `text-dim`.
8. **Fields are prompt lines.** No frame: a marker (`›`, `+`, `/`) in amber or dim, then the text, on a line
   separated from the content by `border-t`. See `PipComposer.tsx`.
9. **One header row.** A page adds at most one quiet line under it (`text-xs text-dim`, 44px tall on touch).
10. **Rhythm.** 12px between paragraphs, 18px between sections, 16px page padding. No large empty bands; nothing
    centred except an empty state's one sentence.
11. **Wording.** Lower-case labels and actions; sentences end with a full stop; no exclamation marks, no emoji, no
    "✨". Times as `08:07`, durations as `6 s`.
12. **Motion.** What exists stays (the caret, the short rise of a new block). Add none.

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
