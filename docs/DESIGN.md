# Pocket's design guide

Everyone who changes anything a person sees in Pocket reads this first: the lead, a delegated agent, a future
session. It says what Pocket looks like, why, how to decide when the guide is silent, and how a change is checked
before it ships. It exists because the same mistake was shipped three times in two days.

Contents: [1 What went wrong](#1-what-went-wrong) · [2 The idea](#2-the-idea) ·
[3 Before you draw](#3-before-you-draw-anything) · [4 Hierarchy](#4-hierarchy) · [5 Type](#5-type) ·
[6 Colour](#6-colour) · [7 Space and lines](#7-space-and-lines) · [8 What can be pressed](#8-what-can-be-pressed) ·
[9 Lists](#9-lists) · [10 Headers](#10-headers) · [11 Fields](#11-fields) ·
[12 A reply and its cards](#12-a-reply-and-its-cards) · [13 Floating surfaces](#13-floating-surfaces) ·
[14 States](#14-states) · [15 Words](#15-words) · [16 Motion](#16-motion) · [17 The phone](#17-the-phone) ·
[18 The catalogue of mistakes](#18-the-catalogue-of-mistakes) · [19 How a change ships](#19-how-a-change-ships) ·
[20 The building blocks](#20-the-building-blocks) · [21 The review](#21-the-review)

---

## 1 What went wrong

Four verdicts from the person who uses Pocket, in order. Each was earned.

| When | Verdict | What had been shipped | The lesson |
|---|---|---|---|
| 2026-11-12 | "Ugly, looks AI vibe code slopped." | Every thing in its own box: a bubble, a side bar, bordered tiles, a framed composer. Wide mono text, a pixel face inside content, four greys of meta text. | Decoration is not design. A frame around everything says nothing about anything. |
| 2026-11-12 | "Still too many lines, no visual hierarchy. Hard to understand what's a button and what's not." | Boxes replaced by hairlines everywhere; every action a dim word. | Removing one device and putting another in its place is the same mistake. A rule that says "no X" produces Y. And a thing that can be pressed must look it. |
| 2026-11-13 | "Come on. This is not good design." (the chat list) | A filled key and an arrow on each of sixteen rows; a header with a label, a wrapping count and two keys colliding; rows for empty chats; the date repeated under "yesterday". | A rule applied without looking ("every action is a key") makes a wall of buttons. Rules do not design; looking does. |
| the same day | "Write a comprehensive design guide so this doesn't happen again." | The chat list had gone live from an agent's report; nobody had looked at that screen. | **Nothing ships unseen.** A report that says "done, tests pass" is not evidence about how a screen looks. |

The common root: applying a device uniformly (boxes, then lines, then keys) instead of asking what each screen is
for and looking at the result. Every section below is written against that.

## 2 The idea

Pocket is a quiet, text-first tool on a dark ground, in one mono typeface: a well-kept terminal, not a dashboard.

1. **Content is text and space.** Things are told apart by position, size and brightness, not by containers.
2. **What can be pressed has a shape; what cannot has none.** There are five shapes and nothing else.
3. **One thing leads.** Every screen has one most important thing, and it is obvious which.
4. **Less.** Each element must earn its place; a screen is finished when nothing more can be taken away.

When this guide is silent, decide by those four, in that order, and write down what you decided.

## 3 Before you draw anything

Answer in one sentence each. If you cannot, you are not ready to build.

1. **What is this screen for?** ("Pick a conversation." "See what Pip remembers and correct it.")
2. **What is the one thing a person does here most?** That is the main action. It gets the best place and, if it is
   a key, the amber one. There is at most one.
3. **What must they see to do it?** Everything else is a candidate for leaving out, a second line, or a menu.
4. **How many of each thing can there be?** Design for 0, 1, 16 and 200, and for a name of 3 characters and of 120.
   Most mistakes in section 18 only appear at 16.
5. **What happens on a phone, with a thumb?** Pocket is used on a phone first (section 17).

Then check what exists: another screen probably solved the same problem. Use its solution, do not invent a sibling.

## 4 Hierarchy

A screen has **three levels and no more**:

| Level | What | How it looks |
|---|---|---|
| 1 | The page's title, or in Pip what the person wrote | Title: pixel face, 30px, `text-hi`. The question: `› ` + `font-medium text-hi`. |
| 2 | A section's name | `SectionLabel`: 10.5px, upper-case, `text-dim`, 24px of space above it, 4px below. |
| 3 | Content | Main line `text-hi` (a row's name, a figure) or `text-foreground` (running text); a second line `text-xs text-dim`. |

Rules of thumb:

- **Squint test.** Blur your eyes at the screenshot: you should still see the title, where the sections start, and
  the one main action. If everything is the same grey texture, there is no hierarchy.
- **Brightness is the main tool**, then size, then weight, then space. Colour is not a hierarchy tool here.
- **Space groups.** Things that belong together are close (4–8px); things that do not are far (24px). A label is
  nearer to what it names than to what came before it. Never the same gap everywhere.
- **One left edge.** Titles, labels, rows and text start on the same vertical line. Indent only for a real child
  (a quote, a sub-step).
- **Emphasis is scarce.** If two things are bright and bold, neither is. One `go` key, one title.
- Nothing is centred, except the single sentence of an empty state.

## 5 Type

One family: **IBM Plex Mono**. The pixel face (**VT323**, `font-pixel`) in exactly two places: the name "pocket" in
the header and a page's or sheet's one title.

| Use | Class | Size |
|---|---|---|
| Running text, rows, keys' neighbours | `text-sm` | 13px (14px on touch screens) |
| Second lines, notes, times, keys | `text-xs` | 11.5px (12px on touch) |
| Section label | `text-[10.5px] uppercase tracking-[0.06em]` | 10.5px |
| Figure | `text-[22px] font-medium` | 22px |
| Page / sheet title | `font-pixel text-[30px]` (sheet `text-[26px]`) | 30 / 26px |

- Weights: 400, and 500 for the question, a figure, an active tab, `strong` in a reply. No bold elsewhere.
- Letter-spacing is normal except the label's. Never widen running text.
- A heading inside a reply is the same face and size at weight 500, `text-hi`. Never the pixel face in content.
- Numbers that are compared sit in columns and line up (mono does this for free; do not break it with units of
  different sizes inside the number).
- No other size. If something "needs" 12.5px or 15px, the layout is wrong, not the scale.

## 6 Colour

Tokens live in `src/app/styles/global.css`. Use the classes, never a hex value in a component.

| Class | Value | For |
|---|---|---|
| `bg-background` | `#0d0d0b` | the ground, everywhere |
| `text-hi` | `#f4eee3` | level 1 and a row's or figure's main line |
| `text-foreground` | `#d9d3c7` | running text |
| `text-muted-foreground` | `#9c9484` | secondary sentences (an empty state, a hint) |
| `text-dim` | `#7d776b` | labels, second lines, times, counts, placeholders |
| `bg-secondary` | `#1a1915` | a key, the chosen row, a code block |
| `bg-popover` + `border` | `#151411`, `#24221d` | a floating surface and its one outline |
| `text-primary` / `bg-primary` | `#ecc981` amber | see below |
| `text-destructive` | `#efa58e` | overdue, an error, a destructive key's word |

**Amber is a budget, not a paint.** It marks: the name "pocket"; the prompt marker `›`; the caret; the one `go` key
of a screen; a switch that is on; a link inside running text. If a screenshot shows more than three or four amber
things, something is wrong.

The signal colours (`--calendar`, `--thought`, `--movement`, the chart colours) are for charts and for the classic
app's categories. Not for labels, states or "free".

Contrast: `text-dim` on the ground is 4.6:1; nothing readable goes below it. `text-dim` on `bg-secondary` is for
disabled things only.

## 7 Space and lines

- **Lines: two in the whole app.** Under the header, and above a page's main prompt line. A floating surface has its
  one outline. Nothing else: no rule between rows, around or between figures, under a label, between sections,
  beside a reply or a quote. Space separates. (A quote in a reply is the one exception: a single amber rule at its
  left, because Markdown readers expect it.)
- **Spacing scale (px):** 4 (a label to its content, a main line to its second line) · 8 (between keys; between
  rows' inner parts) · 12 (between paragraphs) · 24 (between sections) · 16 (page padding left and right). Use these;
  do not invent 10, 14, 18, 20.
- **Density:** a row is one line, or a line and a quiet second line. If a row needs three lines, it is two things.
- **No fills behind content** except: a key, the chosen row, a code block. Never a "card" behind a group.
- **Radius:** 5px for keys and the chosen row, 3px for a tick, the popover's `rounded-sm`. No other radius; no
  pills except the switch.
- **No shadows.**

## 8 What can be pressed

There are exactly five shapes. Choose by what the press does.

| The press… | Shape | Component | Notes |
|---|---|---|---|
| does something now | a **key** | `<Button>` | quiet by default; `variant="go"` (amber) for the screen's one main action; `variant="destructive"` for removing |
| turns something on or off | a **switch** | `<Switch>` | the state is visible without pressing |
| marks done / not done | a **tick** | `<Tick>` | filled when done; done text becomes `text-dim line-through` |
| chooses between a few views | a **segmented strip** | `<Segmented>` | 2–5 choices that fit on one line; otherwise it is a list |
| goes somewhere / opens the thing | a **row** | a pressable row | the whole row, 44px tall on touch; see section 9 |

And two quiet helpers, each allowed in one situation only:

- **`RowMenu`** (three dots, no fill): at the end of a row in a list, for what can be done with that one row.
- **A link** (amber, underlined): inside a sentence of running text, nowhere else.

The laws:

1. **Nothing else is pressable, and nothing that is not pressable looks like any of these.** No fills, underline,
   amber or `›` on plain text. No bare dim word that happens to have an `onClick`.
2. **One `go` key per screen, sheet or dialog.** Zero is fine. Two means you have not decided what the screen is for.
3. **Keys are never repeated down a list.** Not one per row, not a row of three under each item. (Section 9.)
4. **At most three keys side by side.** A fourth goes into a menu, or the screen is doing too much.
5. **Icons:** only where they are universal and a word would not fit: the header's settings cog, the send arrow,
   the three dots, a chevron inside a control. 16px, `text-dim`. Never an icon beside a label "to make it nicer",
   never an icon alone as an unexplained action. Every icon button has an `aria-label`.
6. **A destructive action** is never the easiest thing to hit: it sits last, in a menu or at the far end, and asks
   for confirmation when it cannot be undone.
7. **Touch target 44px** for every one of them (the key and tick reach it through an invisible area; a row through
   its height). Two targets never overlap or touch: at least 8px between keys.
8. **Disabled** is the same shape at 45% opacity, not a different colour. A key that can never be pressed in this
   state is left out instead.

Decision order when unsure: can the row itself do it? → is it on/off (switch) or done (tick)? → is it the screen's
main action (`go` key)? → is it one of at most three actions of a single item (keys)? → otherwise a menu.

## 9 Lists

A list is the most common thing in Pocket and the easiest to ruin. The pattern:

```
SECTION NAME
Name of the thing                                   note   ⋯
Name of another thing                               note   ⋯
```

- **A row is a name and at most one quiet note.** The note is the one fact that tells rows apart at a glance (a
  time, a count, a state). A second line only when the name alone cannot identify the thing (a note's first words,
  a job's schedule).
- **Pressing the row is its main action** (open it, edit it). The whole row is the target.
- **No key on a row. No `›` on a row of a list** where every row leads somewhere: when all have it, it says nothing.
  (`Row`'s `onOpen` arrow is for a single "go to …" line among non-pressable content, e.g. "all entries ›".)
- **A switch or a tick may stand at a row's end or start**, because it shows state.
- **Everything else you can do with a row is in its `RowMenu`.** Menu items are words; the destructive one is last.
- **The chosen/current row** is `bg-secondary` with a 5px radius. No bar, no amber, no bold.
- **Leave out what the section already says and what is empty.** No date under "yesterday" (a time is enough), no
  "0 messages", no rows for things with nothing in them, no count beside a label when the rows can be counted at a
  glance (under about seven).
- **Group** by what a person looks for (pinned, today, earlier), with a `SectionLabel`. Not more than five groups.
- **Long names** truncate on one line in a list of destinations (`truncate`); they wrap where the text itself is
  the content (a memory, a task).
- **Long lists** show the most recent thirty or so and offer the rest ("earlier …") instead of scrolling forever.
- A list of one is still a list: do not give the single row extra chrome.

## 10 Headers

- **The app's header:** the name, the four sections, the sync dot, settings. One line under it. It does not change
  per page.
- **A page:** `PageTitle` (the title, one quiet line of meta under it if it helps) and **at most one key** at the
  right, the page's main action if it is "new …". No counts in the title line unless the count is the point.
- **A sheet or dialog:** its title at the left; at the right at most one key. A sheet closes by tapping beside it
  and with Escape; it needs no "close" key. A dialog's actions are at its bottom right (section 13).
- **Pip's line under the header:** which conversation (it opens the list) and two quiet keys. Nothing more may be
  added to it.
- A header never wraps to two lines at 390px. If it would, there is too much in it: remove, do not shrink.

## 11 Fields

- A field is a **prompt line**: a marker (`›` to talk, `+` to add, `/` to search), then the text, on the ground
  with no frame. See `PipComposer.tsx` and `FIELD` / `BARE_INPUT` in `src/app/ui/SendButton.tsx`.
- The page's main field sits at the bottom with the app's second line above it, and sends with a `go` key (the
  arrow). Enter sends; Shift+Enter is a new line.
- A field inside a page (a search, a setting's value) has no line; its marker and placeholder are enough.
- Placeholders are short, lower-case, `text-dim`, and never the only label of a field that keeps a value.
- A form is label/value rows (the label as a `SectionLabel` or the row's dim lead), one `go` key to save at the end.
- Fields are 16px on touch screens (a global rule; iOS zooms the page otherwise). Do not override it.
- Validation is a sentence in `text-destructive` under the field, when the person tries, not while they type.

## 12 A reply and its cards

- **The question** is a prompt line: `›` in amber, the text `font-medium text-hi`; under it one dim line (the time).
- **The reply** is plain running text on the ground: no bubble, no bar, no avatar, no name.
- **What Pip looked up** is a short list (mark, what, duration at the right, `text-xs`). Finished and longer than
  three: one quiet key "n steps · 6 s" that opens it. "reasoning" likewise. Keep these two on one line.
- **Markdown** (`.prose` in `global.css`): paragraphs 12px apart; lists with a dim dash; a table with dim
  upper-case column names and rows separated by space; code on `bg-secondary` with a 5px radius; headings at weight
  500; links amber and underlined.
- **A card** draws no frame. Its parts:
  - **Figures** (`Figures` / `Figure`): label above, the number at 22px, the unit small and dim after it. All
    figures in a group are the same size whatever their length. Two or three per row.
  - **Rows** as in section 9; **a table** as in Markdown; **a chart** without frame or background, dim axis labels.
  - **Choices** Pip offers are quiet keys in one line (at most three). They are the exception to "keys only for
    actions of the screen": a card is a single item.
  - Under a finished card, one line: its note at the left (`pinned to today · updated 12:05`, dim) and one key
    `more` at the right. Nothing above the card.
- **What Pip remembered** and **sources** are dim lines after the reply; sources are links.
- **A failed or unfinished reply** is one `text-destructive` sentence and up to two keys.
- While a reply streams, nothing already on screen moves, is redrawn or changes height (the lab measures this).

## 13 Floating surfaces

A menu, a dialog, a sheet and a toast are the only things with a background of their own, because they float.

- All: `bg-popover`, one 1px `border`, `rounded-sm`, no shadow.
- **Menu:** rows of words, 44px on touch, the destructive one last and `text-destructive`. No icons, no dividers.
  At most six items; more means the thing needs its own screen.
- **Dialog:** a title in the mono face (`text-hi`, weight 500), one sentence if needed, the field as a prompt line,
  and at the bottom right: a quiet key to cancel, then the confirming key (`go`, or `destructive`). Never more than
  two keys. A dialog asks one question.
- **Sheet:** a title (pixel face) and at most one key in its header, then a list. It closes by tapping outside.
- **Toast:** one line of `text-xs`, no icon, gone after a few seconds. For "done" messages only; an error that needs
  action is shown where it happened.

## 14 States

Every screen is designed in all of these before it is called done:

| State | How |
|---|---|
| Empty | One sentence in `text-muted-foreground` that says what will be here and how to start, plus the page's main action. No illustration, no big icon. |
| Loading | The shape of what is coming in `shimmer` blocks (two or three lines), only if it takes long enough to notice. No spinner in the middle of a page. |
| One item / many items | Looks right with 1, 16 and 200 (see section 3). |
| Long text | A 120-character name, a 30-character word, a long URL: wraps or truncates as section 9 says, never overflows sideways. |
| Busy (an action running) | The control that was pressed is disabled; nothing else jumps. |
| Error | A sentence in `text-destructive` where it happened, saying what happened and what to do, and a key to try again if that helps. |
| Offline / signed out | A sentence and the one key that fixes it. |
| Disabled | Same shape, 45% opacity; or left out. |

## 15 Words

- Lower-case for names of sections, keys, menu items, titles: `new chat`, `forget`, `tasks`.
- Sentences for everything that explains; they end with a full stop.
- Short and plain: say what it is or what it does. "remove", not "delete this item permanently".
- A key's word is a verb or a noun that reads as one: `save`, `new chat`, `more`. No "click here", no "OK".
- No exclamation marks, no emoji, no "✨", no "Oops", no "Successfully …".
- Times `08:07`; durations `6 s`; dates `12 Nov`, with the weekday or "yesterday" only as a group name.
- One name for one thing everywhere (it is "chat", not sometimes "conversation").
- The interface is in English; Pip answers in the person's language.

## 16 Motion

- What exists stays: the caret, the short rise of a new block in a reply, the sheet sliding in, a key pressing
  down slightly. 150–250ms, ease-out.
- Add none without a reason a person would feel: motion explains where something came from or that a press landed.
- Nothing loops except the caret and a loading shimmer. Nothing bounces. `prefers-reduced-motion` turns movement
  into a fade.

## 17 The phone

Pocket is designed at **390 × 844** first; desktop is the same column, centred, with more air.

- Check every screen at 390px wide. If it only works wider, it does not work.
- Nothing scrolls sideways, ever (a wide table or code block scrolls inside itself).
- Thumb reach: the main action is in the lower half or at the bottom; destructive things are not next to it.
- 44px targets, 8px apart (section 8). Text fields 16px (section 11).
- The bottom of the page respects `env(safe-area-inset-bottom)`; the composer never hides the last message.
- A row of things that does not fit wraps as a whole or loses its least important part; it never overlaps (the
  chat list's header did).
- Test with real lengths: German words, a 120-character title, sixteen rows.

## 18 The catalogue of mistakes

Each of these was built, shipped and rejected. Before you call a screen done, check it against every line.

| # | The mistake | Why it is wrong | Instead |
|---|---|---|---|
| 1 | A box around every thing (bubble, bordered tile, framed field, section card) | Frames everywhere separate nothing; the screen becomes a grid of containers | Space and brightness (4, 7) |
| 2 | A hairline between every row, around every group | The same mistake with thinner strokes | Two lines in the app (7) |
| 3 | Actions as dim words | Nothing looks pressable | The five shapes (8) |
| 4 | A filled key on every row of a list | A wall of buttons; sixteen equal calls to action | The row is the action; the rest in `RowMenu` (9) |
| 5 | An arrow at the end of every row | When every row has it, it carries no information | No arrow in a list of destinations (9) |
| 6 | A header with a label, a count, and two keys | It wraps and collides at 390px | A title and at most one key (10) |
| 7 | A "close" key on a sheet | It competes with the sheet's real action | Tap outside / Escape (13) |
| 8 | Rows for empty things ("New chat · 0 messages") | Noise that pushes real rows down | Do not list them (9) |
| 9 | The date repeated under a "yesterday" group; "n messages" on every row | Says what the group already says | One note per row that tells rows apart (9) |
| 10 | Three keys under every item (edit / forget; run now / edit / remove) | Mistake 4 in another place | `RowMenu` (9) |
| 11 | Figures of different sizes in one group ("7 h 12" small, "62" large) | Reads as different importance | One size per group (12) |
| 12 | A control floating in its own empty band (the "⋯" above a card, a 44px "more" strip) | Dead space; the control looks orphaned | Attach it to the thing's own line (12) |
| 13 | The pixel face in headings and numbers inside content | Two voices in one text | Pixel face in two places only (5) |
| 14 | Text brackets `[ ]` `[x]` as checkboxes and switches | Cute, unclear, tiny target | `Tick`, `Switch` (8) |
| 15 | An empty strip under the composer; a page shorter than the screen with the field mid-air | Looks broken | The field ends the page (17) |
| 16 | A page title and a section label saying the same words | One of them is redundant | Remove the label |
| 17 | Meta lines in four greys ("model · reads nothing yet", times, counts) | No hierarchy among secondary text | One dim for all secondary text (6) |
| 18 | A colour to mean "free", a ring to dress a number | Decoration | Words and the four greys (6) |
| 19 | Two keys stacked on separate lines where one line would do | Wastes height, reads as two sections | `Keys` on one line |
| 20 | A key taller than its neighbours | Looks like a different kind of control | All keys 28px (8) |

When the person rejects something, it is added here on the same day, with its fix, before anything else is done.

## 19 How a change ships

1. **Decide** with section 3. For a new screen or a new look, **show a mock first** (an HTML page, phone size) and
   get a yes. The person has asked for this more than once; restyling live screens on a guess cost three rounds.
2. **Build with the building blocks** (section 20). If a block is missing something, extend the block, once, for
   everyone; never copy its classes into a screen.
3. **Photograph** the screen with the lab (`tools/manual/chat-lab.mjs`; the commands are in
   `docs/agents/chat-polish.md`). A screen without a lab state gets one, seeded with real lengths and sixteen rows.
4. **The lead looks at every changed screen at 390px, with their own eyes, before it deploys**, and runs the
   review in section 21 on the picture. This step is not delegated and not skipped. An agent's report ("done, tests
   pass, the picture shows …") is a claim to check, not a check.
5. **Say what was not looked at** in the report to the person, plainly.
6. **Deploy**, then tell the person what changed and what to look at.
7. **When they send a screenshot and say it is not good:** they are right. Fix that screen by hand, find the same
   pattern on other screens, add the mistake to section 18, and only then continue.

For delegated agents: `docs/agents/GUIDELINES.md` applies, and a UI task's brief names the screens, the lab states
and this guide. An agent that is unsure does less, not more, and says so. A screen that cannot follow the guide
"because the component needs it" is reported, not shipped.

## 20 The building blocks

| Block | Where | Use |
|---|---|---|
| `Button` (the key) | `src/app/components/ui/button.tsx` | every action; `variant`: default (quiet), `go`, `destructive`, `link` (a link in text) |
| `Switch` | `src/app/components/ui/switch.tsx` | on/off |
| `Tick` | `src/app/ui/kit.tsx` | done/not done |
| `Segmented` | `kit.tsx` | a choice of view |
| `Row` | `kit.tsx` | a line of a list: `lead`, the main line, `sub`, `end`; `onOpen`/`href` only for a single "go to" line |
| `RowMenu` | `kit.tsx` | what can be done with one row (with `DropdownMenuItem`s) |
| `Section`, `SectionLabel` | `kit.tsx` | a section and its name |
| `Keys` | `kit.tsx` | up to three keys on one line |
| `Figures`, `Figure` | `kit.tsx` | numbers in a card or on a page |
| `PageTitle` | `src/app/ui/PageTitle.tsx` | a page's title, meta line and one key |
| `FIELD`, `BARE_INPUT`, `SendButton`, `StopButton` | `src/app/ui/SendButton.tsx` | a prompt line |
| `DropdownMenu`, `Dialog`, `Sheet`, toasts | `src/app/components/ui/`, `src/app/ui/dialog/`, `src/app/ui/toast/` | floating surfaces |
| `.prose` | `src/app/styles/global.css` | Markdown in a reply |
| the card registry | `src/app/surface/` | everything a card or Today can draw |

A screen that needs a class recipe twice needs a block. A screen that styles a button, row or label by hand is
wrong even if it looks right today.

## 21 The review

Run this on the phone-size picture of every changed screen. Every answer must be yes. It takes two minutes; the
three rejected rounds took two days.

**The whole screen**

1. Can I say in one sentence what this screen is for, and does the picture say the same?
2. Squinting: do I see one title, where sections start, and at most one amber key?
3. Is there one left edge?
4. Are there no lines except under the header and above the main field?
5. Is there no box, bar or fill behind content (other than keys, the chosen row, code)?
6. Are amber things three or four at most?

**Pressing**

7. Does everything that can be pressed have one of the five shapes (or is a `RowMenu` / a link in text)?
8. Does nothing that cannot be pressed look like one of them?
9. Is there at most one `go` key?
10. Is there no key repeated on the rows of a list, and no arrow on every row?
11. Are all keys the same height, at most three side by side, 8px apart?
12. Is every target 44px on touch, and do no two touch?

**Content**

13. Does every row show a name and at most one note, with nothing the section already says?
14. Are empty things left out?
15. Does it hold with 0, 1, 16 and 200 items, a 120-character name and a 30-character word?
16. Does the header fit on one line at 390px?
17. Does nothing overflow sideways or overlap?
18. Is the empty state one sentence and the main action?

**Words and finish**

19. Lower-case labels and keys, sentences with full stops, one name per thing, no emoji or exclamation marks?
20. Is it built from the blocks in section 20, with no hand-styled button, row or label?
21. Have I checked it against every line of section 18?
22. **Have I, not an agent, looked at this picture?**

If an answer is no, it is not done. If the guide and your eyes disagree, your eyes win: fix the screen, then fix
the guide.
