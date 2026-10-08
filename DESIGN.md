# Pocket design system — 0.17.0

Pocket is an Android launcher and a browser workspace. Warm Console uses warm ink, cream monospace text, quiet semantic color, pixel headings and Pip's console sprite. Every screen shares the same typography, spacing, targets and navigation patterns.

0.5.21 replaces per-app variations with one shared set of components in `PocketDesign` and `PocketActivity`. See [RESEARCH.md](RESEARCH.md) for the earlier research that informed proximity, hierarchy and soft keys.

## Rules

1. One typeface for content: monospace. Pixel type (VT323) is only for page titles, the Home clock, readings and the shutter. No sans-serif anywhere in Pocket's own pages.
2. Chrome is lowercase: page titles, header buttons, tabs, item commands, soft keys and setting names. Content keeps its own case: task and note text, messages, explanations, names such as COROS or WhatsApp.
3. Everything starts at the same left edge (16 dp plus safe insets). Commands under an item start where the item's text starts.
4. Amber marks actions and selection. Sage marks recovery and movement, blue marks appointments, lilac marks thoughts and notes, and coral marks overdue actions. These colors belong to small readings, marks or text, never colored card outlines.
5. Group with space and neutral rules. Use plain rows and restrained neutral surfaces, with no colored borders or decorative helper labels. Each area has dithered artwork confined to its header; working lists and editors below stay plain.
6. Touch targets stay at least 48 dp (rows 56 dp) even when labels are small.
7. Android owns Home, Recents, the keyboard and permission dialogs.

## Tokens

Each area has an original header scene: sky (Home, Today), stars (Thoughts), road (Tasks), waves (Notes, Paper), terrain (Movement), iron (Gym), tiles (Apps), rings (Search) and a wandering dotted route in browser Travel. `PixelBackdrop.java` and `pixel-backdrop.js` share an ordered-dither kernel tinted toward warm ink. The left side and lower edge stay quiet so titles remain readable. Text remains native text. Artwork is static and cached; browser scenes redraw on resize and disconnect on exit. No background photo, animation loop or external asset is downloaded.

Pip's upper-corner pixel glow stays inside the header. The transcript and composer sit on plain warm ink. Pip's controls retain shared focus and pressed states; its sprite animates while visible and pauses with reduced motion. Actual tool and search activity supplies the console character without invented telemetry or explanatory labels. No full-screen effects or sound are added.

| Role | Value | Purpose |
| --- | --- | --- |
| Page | #12110F | Page and control backgrounds |
| Surface | #1E1C18 | Quiet grouped surfaces and fields |
| Main text | #F0E9DD | Content and ordinary controls |
| Supporting text | #B6AC9D | Metadata and secondary controls |
| Rule | #3E392F | Neutral separators |
| Accent | #ECC981 | Commit and selection |
| Calendar | #A5BFDC | Appointment time |
| Thoughts / notes | #C1AED5 | Undecided ideas and saved context |
| Movement | #ADBF9C | Recovery and body readings |
| Overdue | #EFA58E | Overdue actions and feedback |
| Page inset | 16 dp | Shared left/right edge plus safe insets |
| Header | 48 dp, grows with font scale | back · title · one action |
| Control / tab / item command | 48 dp | Compact tappable text |
| Row / soft key | 56 dp | List rows and bottom keys |

## Type roles

| Role | Size | Face |
| --- | --- | --- |
| Section label, metadata | 13 sp medium | Atkinson Hyperlegible Mono |
| Row metadata, commands, soft keys, header buttons | 14 sp | Monospace |
| Body, chat, steps | 16 sp | Atkinson Hyperlegible Mono regular |
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
| Section | Separates groups on a page | Pixel heading with 24 dp above; compact metadata uses 13 sp Atkinson |
| Row | Anything that opens something | 18 sp title, optional 14 sp muted second line, whole row is the target |
| Value row | Settings and task details | Name on the left, value in accent on the right |
| Tabs | Switching views of one page (Clock, Today filters, Agenda, Dice) | Equal cells, muted labels, the selected one bold accent above a short accent bar |
| Item commands | Actions for the item directly above (alarm, notification, contact, task) | Compact 14 sp text buttons starting at the content edge; the primary one in accent |
| Soft keys | Page-level commands fixed at the bottom | Equal cells; first key aligned left, last right, middle centered — like a keypad phone |
| Feedback | Result of an action | One warning-coloured line above the soft keys, hidden when empty |
| Dialogs | Choices and confirmations | The platform dialog, sentence case |

Keypads (phone dial pad, calculator, in-call controls, timer presets, dice count) keep equal centered keys; they are keypads, not commands.

## Screens

### Home and Today

Read top to bottom as body → next → act → decide → personal shortcuts:

1. Warm sky header, date and native Home clock.
2. Three equally centered COROS-derived bars: recovery, strain and condition. Missing readings stay empty; stored readings retain their date. Each opens its Movement detail.
3. The current or next appointment with its actual time.
4. Chosen, due and overdue actions, each shown once with a direct completion target.
5. Thoughts ready to revisit, with an explicit make-task action.
6. Saved Today tiles with direct add/edit controls. Existing order, hidden tiles and sync stay intact.
7. Fixed navigation and an oversized actual Pip sprite. Pip has an accessible name and no visible text label in navigation.

Pip's daily brief remains its own screen and an optional tile; it no longer occupies the first Today slot.

### Workspace

Header and date, fixed tabs **today / thoughts / tasks / notes**, a scrolling body and a fixed dock: Today, Search, Capture, Pip and Apps. Tasks opens at All, with Open / Today / Later / Done filters and separate chosen, overdue, today, later and done groups. Steps expand in place and are built only when opened. Notes has a readable list and editor; Thoughts has undecided ideas and optional revisit times. Pip's oversized sprite has an accessible name without a visible text label.

A task page shows the title, status, complete / edit / focus commands, steps, details and source. Plan time reserves an appointment linked to that task. A thought page offers make task / edit, revisit, source note and let go. The transition happens only when chosen; a reminder time never commits an idea to action.

### Apps

Android has Pocket and Installed tabs with scoped search. Pocket tools use small glyphs and generous two-column rows grouped by purpose; installed apps stay in one alphabetical column and launch through the real package manager. Custom groups and shortcuts remain available. Switching tabs retains the query. The browser shows its real Pocket tools directly, including Travel and Zines. Stored app ids remain stable. See [WORKFLOW.md](WORKFLOW.md).

### Travel

Travel lives in Apps → Plan. The browser planner is an ordered route of waypoints, arrival connections, accommodation options, booking links, personal ratings, cancellation dates and costs. Totals stay grouped by their original currency. A small memory prompt lives beside the practical record, so the place still belongs to a story. The South America 2028 itinerary supplied for the exploration is saved as local starter data. This web-only workspace keeps its black, monospace and pixel-led visual language, using open spacing instead of itinerary cards.

### Chat

Pip is a Pocket page: same header (`back` · `pip` · `settings`), a conversation strip with `chats` and `+ new`, and a monospace transcript. Your message is a prompt line in accent (`> …`); replies use white body text, pixel headings and accent emphasis. Actual searches and Pocket reads appear as compact activity above the answer: expanded while working, folded afterward. Queries, status, durations, result summaries and source links are inspectable; parameters stay secondary. Provider reasoning remains a separate expandable section. The composer exposes `□ tools [n]`, `△ web · on/off`, attachments, model and send/stop. Access starts off and is scoped to the chosen API recipient. Pip's matching pixel routines pause when hidden or reduced motion is on. On a phone the panel covers the full width; on wide screens it stays a side panel over the dimmed page. See [PIP.md](PIP.md).

### Camera

Header `back` · `camera` · `rear`. Below the viewfinder an on-screen menu like the old cameras' OSD: profile · size (`3M`, `2M`, `1.2M`, `VGA`) · aspect (`4:3`, `3:2`, `16:9`, `1:1`) · quality (`fine`, `normal`, `basic`). The viewfinder masks everything outside the chosen aspect. Settings holds flash and exposure.

## Loaders and sprites

pip is a low-poly 3D character rendered the way a PlayStation did it: vertices snap to whole pixels, textures are mapped without perspective correction, triangles are painter-sorted, and colour goes through the console's 4×4 dither into 15 bits. His face, controls and back are tiny hand-placed textures. He has six keyed activities (wave, walk, juggle, read, hop, write) and a crouch that follows a pull-to-refresh. The sync loader is a PS2-style memory-card screen: his console body turns slowly over a misty blue glow, mirrored in a glossy floor, with sparks and a soft bloom. `tools/sprites/ps1/build.mjs` renders every frame for each accent colour into sprite sheets used by both the phone (`assets/sprites`) and the browser (`public/sprites`); `src/shared/sprites.js` and `RetroSprites.java` hold the shared frame counts and timing. Animation steps at roughly 9–16 frames per second and stops with reduced motion, hidden pages and the Motion setting.

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
