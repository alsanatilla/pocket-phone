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
