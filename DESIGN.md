# Pocket design system — 0.5.13

Pocket is a daily Android dashboard and set of small native apps for the Nothing Phone (3a). Its character comes from black, text, pixel titles/icons and labelled soft keys. Its polish comes from hierarchy, alignment and usable controls.

This revision is based on the supplied Notes screenshots and public design research. See [RESEARCH.md](RESEARCH.md) for sources, findings and the decisions they informed.

## Rules

1. Content gets the most space and the strongest reading hierarchy.
2. Group related information through proximity. Leave more space between different groups.
3. Do not draw default separators under headers, rows, buttons or editors. There are no decorative divider rows or enclosing cards.
4. Accent identifies a commit action, selection or the classic dashboard soft keys. Ordinary supporting controls are white or muted.
5. Keep frequently used actions visible. Put specialised formatting, undo, wheel help and destructive draft clearing in an explicit menu.
6. Small-looking controls retain generous native touch targets. Android owns Home, Recents, Back, the keyboard and permission dialogs.
7. Preserve the existing pixel icons, titles, dashboard clock and selected tile. Do not add gradients, shadows, glow, animation effects or unrelated ornaments.

These rules describe the Pocket interface. Native Android permission/settings dialogs keep their platform appearance. Lines explicitly written by the user in Markdown, such as a horizontal rule or quoted block, are document content.

Today’s current-item layout uses **one monospace font**. The date is 12 sp grey under a 14 sp bold title. The borderless focus block uses 16 sp accent time, 18 sp regular title and 12 sp accent metadata, with 8 dp within the group. + Task / Note / Focus follow the current item. TASKS and NOTES are 12 sp bold uppercase; task names are 17 sp and supporting details are 12 sp. Notes-empty text is 14 sp grey. Sections use 16–24 dp gaps; notes begin after 24 dp. Side margins remain 16 dp, plus native safe insets. Hit areas remain at least 48/56 dp despite smaller labels.

Task tabs directly precede task rows. A single group has no repeated Today/Anytime heading; multiple groups keep compact uppercase headings. The current appointment is a real tappable source; its primary time/title/context are separate from task controls. Search has no permanent strip: the bottom Search action opens an actual editable `> Find tasks or notes` field with Android’s cursor and explicit Find/Cancel/Clear. Calendar is a bottom navigation action. The header/date and these navigation buttons remain visible while the current-item commands and content scroll. Agenda uses a compact monospace title, filters directly above its timeline and creation/draft actions at the bottom.

## Tokens

| Role | Value | Purpose |
| --- | --- | --- |
| Page | #000000 | Pages, fields, rows and control backgrounds |
| Main text | #FFFFFF | Content, labels and ordinary controls |
| Supporting text | #AAAAAA | Metadata, hints and secondary navigation |
| Disabled text | #858B91 | Unavailable actions |
| Default accent | #F9F594 | Primary action, selection and dashboard soft keys |
| Feedback | #FFBF69 | Action feedback with an accessibility live region |
| Content rule | #303438 | Explicit Markdown content; never a default UI separator |
| Page inset | 16 dp | Shared side alignment, plus actual Android safe-area insets |
| Detail gap | 4 / 8 dp | Related details or cells |
| Content gap | 4 / 8 dp below headers; 12 / 16 dp elsewhere | Give content the space while keeping related controls legible |
| Section gap | 24 / 32 dp | Separate groups in denser pages |
| Header control | 48 dp minimum, font-aware width/height | Back, title and contextual action |
| Control height | 52 dp minimum | Native controls and compact text actions |
| Row / commit height | 56 dp minimum | Data rows, commit controls and editor soft keys |
| Dashboard tile | 72 dp minimum | Original icon grid and selection |

Yellow / Green / Blue / White remain available in Settings. Use the selected accent consistently; do not introduce extra colours for arbitrary app categories. Clock uses the default palette before device unlock and does not read protected launcher preferences.

## Type

| Role | Size | Typeface |
| --- | --- | --- |
| Dashboard status | 12 sp | Monospace |
| List metadata | 14 sp | Monospace |
| Main task / note / event title | 18 sp | Monospace |
| Compact control / help | 14 sp | Monospace |
| Body / row / action | 16 sp | Monospace |
| Editable text | 18 sp | Monospace |
| Section / dial-pad digit | 24 sp | Pixel / monospace |
| Page title | 24 sp | Pixel |
| Shutter | 32 sp | Pixel |
| Numeric counter | 40 sp | Monospace |
| Dashboard clock | 60 sp | Pixel |

Use pixel type for short chrome and time; use monospace for long content. A data row's secondary line is smaller and muted, with no rule underneath. Keep long labels wrapping instead of hiding actions.

Markdown reading uses 16 sp body text. Heading multipliers are 1.5, 1.25, 1.125, 1, 1 and 1, with bold providing additional hierarchy. H1/H2 have no automatic underline. Literal Markdown remains unchanged.

All sizes use sp. Pocket's Large text preference and Android font scaling remain available.

## Component anatomy

| Component | Structure |
| --- | --- |
| Header | Back, centered 24 sp pixel title, contextual right action; one 48 dp row, height and action widths grow with font scaling |
| Notes header | Back, Note/Edit title, accent save action; 64 x 48 dp minimum action targets |
| Data row | Main label, optional muted metadata, vertical padding; no border or baseline |
| Ordinary action | Text and native ripple inside a 52/56 dp target; no filled card or persistent boundary |
| Primary action | Accent text; position follows the task, without an extra decorated bar |
| Field | Hint/value and native cursor; no idle boundary; active single-field focus can show an accent cue |
| Freeform editor | Black writing area, no field underline; grows with the available window |
| Selection | Original filled dashboard tile; other selected/focused controls use accent text and one state cue |
| Feedback | Plain text on black; hidden when empty |
| Menu | Explicitly opened native choices; options retain descriptive labels and guarded actions |

The one-pixel keyboard focus/selection cue is a state indicator, not a repeated layout divider. Preserve visible focus and native ripple so quiet controls still communicate interaction.

Individual app setup belongs behind a **Settings** action. Keep lists, editing and daily controls on the app’s first screen. In Phone/SMS/Contacts, the menu contains roles, access and notification setup; in Clock it opens alarm diagnostics; in Agenda it opens calendar connection. Camera Settings holds profile, quality, flash and exposure. The dashboard Settings tile stays. Permission-off screens explain the unavailable data and point to Settings without repeating every setup option. Emergency calling, in-call actions, capture, Stop and Snooze remain immediate.

## Screen patterns

### Dashboard

Status, clock/date, next task/alarm, quick capture, nine original icons, flexible space, classic bottom soft keys. Separate groups through space. Keep one selected tile; leave other tiles on black. Assigned apps show their real name, with a two-line label and a matching accessibility description. Hold a tile for app/name editing; rename changes presentation, not the stable slot key. Reset affects only that shortcut.

### Notes writing

The header holds Back and save. The editor takes the available height. A single bottom group contains Format and Preview, with 56 dp targets. Format opens the same wheel as holding inside the editor and has a complete accessibility description.

Hold in the editor to open a temporary radial wheel near the finger, clamped into the visible window. Move to a choice and release, or release first and tap. Eight labelled choices surround cancel: Heading, Bullets, Checks, Bold, Plain, Undo, Select and More. Only the currently targeted sector uses accent; there are no sector divider lines. Each label has a native accessible 52 dp target. Select opens Android selection/clipboard controls. More exposes the complete native menu and on-demand help; a short window uses that menu directly. Format is a visible alternative to holding. Clearing requires confirmation and preserves the saved entry. Instructions do not occupy the writing area.

### Notes reading

Header, selectable rendered document, flexible reading space, then compact Edit and Share soft keys. Do not insert action rows between the title and document, underline headings by default, or give every action its own horizontal rule.

### Today and Agenda

Today places capture and Calendar near the top, followed by search, task filters, tasks and notes. Task completion is a separate 56 dp control; the title is 18 sp and due date, priority and steps are 14 sp on their own line. Notes pair a title with a short readable excerpt without changing their Markdown source.

Agenda uses 18 sp day headings and an 84 dp time column. Event titles wrap in the remaining space; status is a separate 14 sp line. Rows have at least 72 dp height and one accessible description containing date, time, title and source. Upcoming/Past are explicit controls. Empty states distinguish those views.

### Messages

Group each active conversation through spacing: app/time, conversation title, sender/text, then 56 dp Open/Reply/Dismiss controls. Use 14/18/16 sp for those text roles. Suppress duplicate group summaries. Reply appears only when the app supplies a native freeform action; otherwise Open remains available. SMS inbox and installed-app links stay visible. Do not present active notifications as a complete saved inbox.

### Lists and forms

Keep each main label close to its metadata. Repeated rows use consistent padding and alignment. Group changes use a section title and a larger gap. Permission/setup pages retain the explanations that are needed to decide about access.

## Interaction and resilience

Header Back and system Back use the same route. Going back closes the wheel first, returns Preview to its editor, and preserves unfinished capture/appointment text. Saving returns to the origin. Root activities retain Android's normal task Back behavior.

Android's real system-bar, cutout and IME insets are part of the layout. A tall editor expands; a short window can scroll to reach the actions. Do not shrink targets to fit or add a gesture service.

The wheel lives in the app window, not a system overlay. Before holding, native typing and scrolling remain available. Opening the wheel temporarily hides the document from accessibility traversal; cancellation restores it. Back, Home, pause and editor detachment close only the wheel. It never excludes Android edge gestures. Android Home returns render without an extra Pocket transition; the black window is opaque. Nothing still controls the system gesture/overview animation.

Menu results, Save and Clear are tied to the requesting editor. Existing draft autosave, explicit save, confirmation, provider work, storage and permission consent remain. This design change adds no network permission or data collection.

## Review criteria

- No repeated idle UI lines in Notes, Preview, headers, data rows or buttons.
- Empty and one-heading Notes previews match the supplied use cases.
- Preserve the pixel identity and black background across shared app components.
- Save, Format, Preview, Edit and Share remain discoverable and touchable.
- Formatting, undo and confirmed draft clearing preserve saved content.
- Editor height, cursor/draft retention, short windows, font scaling and native navigation remain covered.
- Inspect actual native renders, not an unrelated concept image.
- Build/test results belong in BUILD-STATUS.json. Rendering fixtures do not validate physical phone or carrier behaviour.

## Companion-app polish in 0.5.13

Keep the terminal palette, existing monospace body type, compact pixel headings and plain native controls. New behaviour uses text and existing state markers; no cards, decorative borders, gradients, setup banners or additional colours are introduced.

- Messages shows the actual feed below the header. SMS inbox and Apps are fixed bottom commands; listener setup stays in Settings.
- Clock marks the active tab and offers timer presets/optional label. Existing alarm text is a 56 dp edit target; saving retains its identity and disabled state.
- Agenda places a quiet end time below the start. Duration lives in the appointment editor; no duration setup appears on the timeline.
- Calculator makes its expression the reading focus, puts the last calculation below it and exposes copy/history as compact commands.
- Notes uses Pinned metadata and a contextual menu; it never adds pin glyphs or a settings strip to every row.
- Photo Previous/Share/Next stay at the bottom with 56 dp targets. The album remains restricted to Pocket Camera captures.
- Contacts exposes Continue draft only when unfinished user text exists. An accepted save clears that version while retaining newer edits.
