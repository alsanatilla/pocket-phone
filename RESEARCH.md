# Design research for Pocket — 4 October 2026

## Brief and diagnosis

The requested interface is dark, text based, minimal and reminiscent of early-2000s smartphones, while remaining practical on a modern Nothing Phone (3a). Preserve the existing pixel identity and Android navigation. Avoid a generic card dashboard, oversized controls and repeated decorative rules.

The supplied Notes screenshots show four similar boundaries: the header, editor bottom, Save row and Clear draft row. The Preview repeats action-row boundaries and an automatic Markdown heading underline. These lines give chrome and document content similar visual weight. Persistent gesture instructions and separate Bold, Undo, Save and Clear rows also consume writing space.

The remedy needs both layout and component rules. Merely deleting some borders would leave the crowded action hierarchy in place.

## Sources read

| Source | Relevant finding | Decision for Pocket |
| --- | --- | --- |
| [NN/G: Proximity Principle in Visual Design](https://www.nngroup.com/articles/gestalt-proximity/) | Nearby elements are perceived as related; different amounts of space establish meaningful groups. | Use spacing and aligned text to group rows and sections. Remove the default divider from each row. |
| [NN/G: Visual Hierarchy in UX](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) | Contrast, scale and grouping guide attention in the intended order. | Give the document the most space, distinguish title/body/metadata and make the commit action easy to locate. |
| [NN/G: Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/) | Minimise irrelevant information while retaining the elements that support user tasks. An empty-looking page alone is not sufficient. | Keep Save, Format and Preview visible. Retain labels, touch areas and needed permission explanations. |
| [NN/G: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Put specialised or less-used options behind a deliberate secondary interaction. | Move Bold, Undo, gesture help and Clear draft into the Format menu; retain the gestures and confirmation. |
| [Carbon: Spacing](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview) | A spacing scale and consistent patterns create relationships and hierarchy; sections can be separated without graphical dividers. | Keep a small shared spacing vocabulary: 4/8 dp details, 12/16 dp content rhythm and 24/32 dp section gaps. |
| [Android: Accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility) | Touch targets should be at least 48 dp and can extend beyond the visible icon/text. Text uses sp; contrast matters. | Retain 52/56 dp targets with modest type, font scaling, descriptive controls and native navigation. |
| [Material Design's archived divider guidance](https://m1.material.io/components/dividers.html) | Heavy divider use creates visual noise and reduces impact; spacing and subheaders are alternatives. | Do not use a divider as the default boundary for every component. Keep only functional state cues and explicitly authored Markdown rules. |
| [Nokia S60 UI Style Guide v1.2, November 2005](https://csilverman.com/hig-files/83748622-S60-UI-Style-Guide-v1-2-En.pdf) | Text labels identify soft keys; the Options menu provides additional commands. | Keep labelled soft keys and a deliberate options menu as the retro interaction reference, adapted to touch and Android gestures. |

The Nokia document is an archived Nokia guide hosted by an independent mirror. Relevant soft-key and Options sections were read from its extracted PDF text. Its physical keypad rules are historical reference, not a specification for a modern touchscreen.

## Applied decisions

1. **No persistent UI dividers.** Black headers, ordinary rows, primary actions and the freeform editor blend into the page. Active focus/selection still has a visible cue.
2. **Content before chrome.** The Notes editor and rendered document use the available height. There is no permanent instruction block above the writing area.
3. **Task-oriented actions.** Notes has Save in its header and Format/Preview at the bottom. Preview has Edit/Share below the document. Less-used options are requested through Format.
4. **Restrained document typography.** Native Markwon keeps real Markdown semantics, but H1/H2 have no default underline. Body text is 16 sp and the largest document heading is 1.5 times body size.
5. **Shared native primitives.** Palette, type roles, row spacing, touch sizes, black backgrounds and state behaviour live in PocketDesign. Original pixel icons, headings and the selected dashboard tile remain.
6. **Functional clarity.** Draft autosave, explicit Save, gesture formatting, Undo, confirmation and saved-note preservation remain. Moving controls does not remove the feature.

## Scope and verification

Public web pages were fetched and read directly; web search also located the historical Nokia guide. The current Material 3 divider page and dumb.co returned JavaScript shells without useful article/interface text in this environment. No recommendation here is presented as a verified reading of their current interfaces.

References inform the implementation; they do not demonstrate handset usability. Native fixtures render empty Notes, a real Markdown note, a one-heading preview, the dashboard and the other apps. Interaction checks cover Save, formatting/Undo, confirmed clearing, editor growth and reachability in a short window. Actual counts, signature checks and physical-device limits are in the release build-status file.

The screenshots supplied by the user were inspected locally. No user notes, screenshots or account data were sent to the research websites.

## 0.5.9 — wheel and Home gesture follow-up

The user requested a hold-to-open, game-style wheel in place of formatting swipes. The implementation uses eight plain-text choices, a central cancel action, a single highlighted sector and no decorative segment dividers. A visible Format control opens the same wheel, More exposes the complete menu, and Select retains native selection/clipboard actions. Short windows fall back to the menu. This is a user-requested interaction, not a claim that radial controls are universally faster. Native activity tests cover holding in the editor, both choice modes, cancellation and draft preservation; ergonomic feel still needs the handset.

For the corrected **swipe up to Home** report, the public AOSP [FallbackSwipeHandler](https://android.googlesource.com/platform/packages/apps/Launcher3/+/refs/heads/main/quickstep/src/com/android/quickstep/FallbackSwipeHandler.java) and [TouchInteractionService](https://android.googlesource.com/platform/packages/apps/Launcher3/+/refs/heads/main/quickstep/src/com/android/quickstep/TouchInteractionService.java) sources were fetched and read on 4 October 2026. FallbackSwipeHandler explicitly handles navigation with a third-party default Home and starts that Home during its animation. These sources establish the system/app boundary; they do not verify Nothing's implementation or the reported flash. Pocket removes its additional page animation and makes its window explicitly opaque. PRODUCTIVITY.md records the device checks and remaining limitation.
