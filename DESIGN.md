# Pocket design system — 0.6.0

Pocket is a daily Android dashboard and a set of small native apps for the Nothing Phone (3a). Its character comes from black, white monospace text, pixel titles and icons, and labelled soft keys. Its polish comes from every app using the same few patterns, so a page can be scanned without learning it first.

0.5.21 replaces per-app variations with one shared set of components in `PocketDesign` and `PocketActivity`. See [RESEARCH.md](RESEARCH.md) for the earlier research that informed proximity, hierarchy and soft keys.

## Rules

1. One typeface for content: monospace. Pixel type (VT323) is only for page titles, the Home clock, readings and the shutter. No sans-serif anywhere in Pocket's own pages.
2. Chrome is lowercase: page titles, header buttons, tabs, item commands, soft keys and setting names. Content keeps its own case: task and note text, messages, explanations, names such as COROS or WhatsApp.
3. Everything starts at the same left edge (16 dp plus safe insets). Commands under an item start where the item's text starts.
4. Accent marks one thing per group: a commit (save, send, + task), the selected tab, the next/now item, and the classic Home soft keys. Everything else is white or muted.
5. Group with space, not lines. Sections use a small uppercase label and a 24 dp gap. No dividers, cards, shadows or gradients.
6. Touch targets stay at least 48 dp (rows 56 dp) even when labels are small.
7. Android owns Home, Recents, the keyboard and permission dialogs.

## Tokens

| Role | Value | Purpose |
| --- | --- | --- |
| Page | #000000 | Pages, fields and control backgrounds |
| Main text | #FFFFFF | Content and ordinary controls |
| Supporting text | #AAAAAA | Metadata, hints, section labels, header buttons |
| Disabled | #858B91 | Unavailable actions |
| Accent | #F9F594 (or Green/Blue/White in Settings) | Commit, selection, next/now |
| Feedback / warning | #FFBF69 | Feedback line, overdue |
| Page inset | 16 dp | Shared left/right edge plus safe insets |
| Header | 48 dp, grows with font scale | back · title · one action |
| Control / tab / item command | 48 dp | Compact tappable text |
| Row / soft key | 56 dp | List rows and bottom keys |

## Type roles

| Role | Size | Face |
| --- | --- | --- |
| Section label, metadata on Home | 12 sp bold uppercase / 12 sp | Monospace |
| Row metadata, commands, soft keys, header buttons | 14 sp | Monospace |
| Body, chat, steps | 16 sp | Monospace |
| Row title, setting name, editors | 18 sp | Monospace |
| Item page title (task) | 20 sp bold | Monospace |
| Page title | 24 sp | Pixel |
| Home readings, display numbers | 25–40 sp | Pixel / monospace |
| Home clock | 60 sp | Pixel |

All sizes are sp and scale with Pocket's Large text and Android font size.

## Components

Every page is built from these and nothing else.

| Component | Use | Anatomy |
| --- | --- | --- |
| Header | Top of every page, including chat and camera | `back` (muted) · centered lowercase pixel title · one action: `home`, `settings`, or an accent commit such as `save` |
| Section | Separates groups on a page | 12 sp bold uppercase muted label, 24 dp above (8 dp when first) |
| Row | Anything that opens something | 18 sp title, optional 14 sp muted second line, whole row is the target |
| Value row | Settings and task details | Name on the left, value in accent on the right |
| Tabs | Switching views of one page (Clock, Today filters, Agenda, Dice) | Equal cells, muted labels, the selected one bold accent above a short accent bar |
| Item commands | Actions for the item directly above (alarm, notification, contact, task) | Compact 14 sp text buttons starting at the content edge; the primary one in accent |
| Soft keys | Page-level commands fixed at the bottom | Equal cells; first key aligned left, last right, middle centered — like a keypad phone |
| Feedback | Result of an action | One warning-coloured line above the soft keys, hidden when empty |
| Dialogs | Choices and confirmations | The platform dialog, sentence case |

Keypads (phone dial pad, calculator, in-call controls, timer presets, dice count) keep equal centered keys; they are keypads, not commands.

## Screens

### Home

Read top to bottom as now → next → body → act:

1. Status line, wordmark, clock and date.
2. One list with a fixed left column: up to two appointments (time), the next task (`task`, with the open count on the right) and the latest note (`note`). The column is wide enough for a 12-hour time, so every title starts at the same x.
3. Health readings (recovery · strain · condition), centered.
4. Quick actions (`+ thought` · `today` · `focus`).
5. The tile row.
6. Accent soft keys: `capture` · `today` · `pip` · `all`. Notifications open from the count in the status line.

Readings, quick actions and tiles share one three-column grid with identical cell margins, so their centres line up exactly (checked by `RedesignPreviewTest`).

### Workspace

Header and date, fixed tabs **today / thoughts / tasks / notes**, a scrolling body and fixed bottom actions. Today shows the current/next appointment, ready thoughts, chosen/due actions and review links. Tasks has Open / Today / Later / Done filters; Notes has its own readable list; Thoughts has undecided ideas and optional review times. The primary bottom action fits without clipping: capture, + new, + task or + note. Search, Calendar and pip sit alongside it.

A task page shows the title, status, complete / edit / focus commands, steps, details and source. Plan time reserves an appointment linked to that task. A thought page offers make task / edit, revisit, source note and let go. The transition happens only when chosen; a reminder time never commits an idea to action.

### Apps

One searchable directory: custom shortcuts, communicate, plan & think, capture & keep, extras, then installed apps. Photos is the camera album; Paper is the handwritten-page bridge into Notes; Activity is review. Stored app ids remain stable even when their displayed names change. See [WORKFLOW.md](WORKFLOW.md).

### Chat

Pip is a Pocket page: same header (`back` · `pip` · `settings`), a conversation strip with `chats` and `+ new`, and a monospace transcript. Your message is a prompt line in accent (`> …`); replies use white body text, pixel headings and accent emphasis. An expandable reasoning section separates provider summaries and lookup steps from the answer. A small pixel character blinks and looks around during thinking, reading and writing, with motion disabled when hidden or reduced motion is on. A quiet status line shows what pip may read (`reads notes · COROS` or `pocket access · off`) and `input reused` only for reported prompt-cache reads. The composer is a field with a `send` soft key (`stop` while replying). On a phone it covers the full width; on wide screens it stays a side panel over the dimmed page. See [PIP.md](PIP.md).

### Camera

Header `back` · `camera` · `rear`. Below the viewfinder an on-screen menu like the old cameras' OSD: profile · size (`3M`, `2M`, `1.2M`, `VGA`) · aspect (`4:3`, `3:2`, `16:9`, `1:1`) · quality (`fine`, `normal`, `basic`). The viewfinder masks everything outside the chosen aspect. Settings holds flash and exposure.

## Motion

- Pages move along one horizontal axis: forward enters from the right, Back from the left. The old page fades out in 90 ms; the new one follows after 60 ms and settles in 210 ms with a decelerating curve. Both draw through a hardware layer while moving.
- The delay hides the cost of building the new page, so the first visible frame is never the expensive one.
- Predictive Back moves and slightly scales the current page over the previous one; cancelling returns it in 160 ms.
- Chat slides in over 240 ms and out over 180 ms.
- Settings → `motion` off, Android's animator setting, and the locked device all disable Pocket motion.
- Pages are not rebuilt on resume unless their data changed, so returning to an app never stalls Android's own window animation.

## Back

- Header `back` and system Back always do the same thing.
- Back follows the path the user took. Saving an action opens its details; Back then returns to its origin. Other saves and deletes return to the page the action started from. Drafts stay separate from saved data.
- A page opened directly from somewhere else returns there: a Home reading opens Movement on that reading and Back returns Home; an appointment opened from Home or Today returns there; a photo opened from Camera returns to Camera; a conversation started from Contacts returns to Contacts.
- The workspace opens in its own Android task from Home. Internal tabs keep the same workspace; Back from a thought, task or source follows the actual route.

## Review criteria

- Every page uses the header, and its body uses only sections, rows, value rows, tabs, item commands, soft keys and feedback.
- No sans-serif text in Pocket's own pages; chrome labels lowercase.
- Three-column rows on Home share centres.
- Back from a deep link returns to its origin.
- Inspect native renders (`RedesignPreviewTest`, `./gradlew -I tools/render-layouts.gradle :app:renderRomLayouts`), not concept images. Renders do not validate physical phone behaviour.
