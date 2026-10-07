# Incremental releases

Each release labels its signing status and supplies an APK, source snapshot, checksums and actual build results. Signed updates retain Pocket's package ID and release certificate. Old downloads remain available. These are launcher/app builds for the current Nothing OS.

## 0.15.0 — Pip’s daily brief

- A compact, source-linked brief appears on phone Home and Today and browser Today, using saved recovery, appointments, tasks, thoughts ready to revisit and gym history. It works offline without an AI key. Recovery shows its sample date or cache age and marks stale readings; it does not prescribe training. Calendar boundaries use the local civil day, including DST and overnight appointments.
- **Think with Pip / ask Pip** creates a new unsent conversation with the brief’s facts. Previous drafts remain intact; only Send contacts the configured provider. Opening the brief shows all available facts and its enable/disable setting, which syncs between devices. An optional daily brief tile is available without replacing existing layouts.
- Focused checks cover identical Java/browser results, offline edits and rollover, strict preference validation, two-way account sync, source navigation and a simulated browser Pip reply. Android and Astro production builds passed. The full test suite and lint remain skipped as requested; no physical handset was available. The APK is unsigned for the signing agent.

## 0.14.1 — Add tiles directly on Today

- The phone's Today page now has a visible **+ add tile** action above the grid. Choosing a tile adds it immediately. Adding and saving returns to Today without reopening the management dialog.
- Hold a tile to move it up, move it down or remove it. **Edit tiles** remains available next to Add. Changes still use the shared Today layout, preserve browser-only tiles and appear when returning to Today after background sync.
- Android and Astro builds passed; the test suite and lint were skipped as requested. No handset was connected, so native interaction remains unverified on a device. The APK is unsigned for the signing agent.

## 0.14.0 — OpenRouter that answers, web search everywhere

- **Free OpenRouter models.** With OpenRouter's `openrouter/free` or any `:free` model, pip sends a fallback list (NVIDIA Nemotron 3 Super, Ling 3.0 Flash, then the free router). OpenRouter moves to the next one when a model is rate-limited. The free router alone sometimes picked a safety-classifier model that returned no reply. A busy provider (HTTP 429, 502 or 503) is retried twice before pip gives up. Nothing has been generated at that point, so nothing is charged twice.
- **Web search with any provider.** The web toggle now works with OpenAI-compatible APIs too. Pip gets two tools, `search_web` and `read_web_page`, both served by [Firecrawl](https://firecrawl.dev). Searches and pages show up in the activity list with their links. Firecrawl works without a key at low volume. An optional Firecrawl key goes in API settings (browser) or Provider & model (phone); the phone stores it encrypted, the browser keeps it in the tab session. Anthropic keeps its own server-side search.
- Astro and Android builds passed. In the browser, a live OpenRouter run with `openrouter/free` and web search on sent the fallback list and both tools, called Firecrawl search and page reading, and answered with a cited source. The test suite is skipped as requested and the handset was not available, so the phone side is compiled only. The APK is unsigned for the release agent.

## 0.13.0 — PlayStation pip

- **pip in 3D.** The 2D sprites are replaced by a low-poly 3D pip rendered with PS1 traits: wobbling vertices, swimming textures, painter-sorted triangles and the console's 15-bit dither. He is a little handheld console with a hand-textured face (glowing eyes, d-pad, buttons) and back (battery cover, screws, label), stubby limbs and a glowing antenna, standing on a small stage. Six keyed activities: wave, walk (across the stage and back), juggle, read (a book with a turning page), hop (squash and stretch) and write (pencil and notepad), plus a crouch while you pull to refresh.
- **PS2 save screen.** The other sync loader is a memory-card style screen: pip's console body turns slowly over a misty blue glow, mirrored in a glossy floor, with drifting sparks and bloom.
- Both follow the accent colour: every frame is rendered for Yellow, Green, Blue and White (about 1.8 MB of sprite sheets per platform). Phone and browser use the same sheets from one render script; the browser keeps them for offline use.
- Astro and Android builds passed; browser playback was checked with the real sheets. The test suite is skipped as requested; the handset was not available. The APK is unsigned for the release agent.

## 0.12.0 — Detailed sprites, Today tiles and pull to refresh

- **Sprites.** The loaders are redrawn as 48-pixel, lit and dithered sprites. Pip is a handheld console with legs: glass screen with glowing eyes, d-pad and buttons on a control plate, antenna, and six activities (wave, walk, juggle, read, hop, write) plus a crouch for pulling. A cartridge turns in a tiny software 3D renderer (label, ridges, gold pins) and a coin spins with an embossed star. Everything is tinted from the accent colour. One generator (`tools/sprites`) writes identical frames for the phone (`RetroSprites.java`) and the browser (`src/shared/sprites.js`).
- **Pull to refresh.** Pull down at the top of any page on the phone, or any page of the browser on a touch screen, to sync now. Pip crouches as you pull, then a random loader plays until the sync finishes. Ctrl/Cmd+Shift+R syncs in the browser.
- **Today tiles.** Today shows a grid of live tiles — tasks, agenda, thoughts, notes, movement, gym, pip, activity, focus, clock, paper, zines and dice. Add, remove and reorder them from "tiles" in the browser or "edit tiles" on the phone; the layout syncs. Zines stay browser-only, so the phone keeps but does not draw that tile.
- **Calendar and Clock in the browser.** Appointments, alarms, timers and focus sessions now sync with the phone and have web pages (Apps → Calendar, Clock). Editor drafts and a short list of settings also sync; credentials, keys and alarm handles never do.
- Astro and Android builds passed; browser checks used fictional data on a throwaway database. The test suite is skipped as requested and the handset was not available, so phone layouts are compiled, not seen. The APK is unsigned for the release agent.

## 0.11.0 — One account, easier to find and recover

- Web sign-in follow-up: email/password is shown first, passkey sign-in is optional, and passkey account creation is explicitly labelled.
- **Account access.** Sign-in and account creation have separate screens. Passkeys attach to one Pocket account; multiple devices can use that account, with password sign-in retained. A phone can show a short code for approval in a signed-in browser. The account screen lists revocable device sessions and passkeys.
- **Search.** Notes, Tasks and their steps/source text, parked Thoughts, Paper and Pip share a search on phone and web. Local records remain searchable offline; phone appointments stay local. Server indexes update atomically with saves and deletions, and older account data is indexed on first search.
- **Note recovery.** Signed-in Notes offer up to 60 text checkpoints, ten-minute editing-session coalescing with the initial text preserved, and restore checkpoints that retain the text being replaced. Recently deleted recovers notes deleted within 30 days as new notes.
- COROS, chats and browser zines retain the account persistence introduced in 0.10.0. No additional server key or environment variable is required; keep the production origin stable for passkeys.
- Astro production and Android APK builds passed. Browser previews with fictional data verified separate account creation/sign-in, accent-insensitive search, opening newer server-only matches, history restore and deleted-note recovery. Isolated API checks covered private-route authentication, origin checks, account isolation, phone linking, revocation and invalid restore requests; backend checks covered search/history rollback. The test suite is skipped as requested. Physical passkey/handset behavior remains unverified. The APK is 0.11.0, version code 37, unsigned for the signing agent.

## 0.10.0 — Everything persists

- **COROS.** Signed in, the COROS connection moves to your Pocket account: the authorization is encrypted on the server and the last readings are stored there. Phone and browser show the same readings, and a failed refresh never clears them. Refreshes run while Pocket is open (at most every 15 minutes), hourly from the phone when it has a network, and once a day from a scheduled job even when both apps are closed (Vercel Hobby allows one daily run, so the job runs from GitHub Actions against a protected endpoint). An expired authorization keeps the readings and offers reconnect.
- **Pip chats** sync between phone and browser through the account, including drafts, attached context and tool/search activity. Each reply merges by its own edit time, so a chat can continue on another device. Provider keys stay on the device.
- **Zines** sync between browsers with their photos; a zine waits until its photos have uploaded, and removed photos are deleted from the account.
- Isolated database checks covered token rotation, failed refreshes, concurrent chat edits, zine photo deletion, account separation and job authorization. No real COROS data or paid AI requests were used. Astro and Android builds passed; the test suite is skipped as requested. The APK is unsigned for the release agent.

## 0.9.1 — Offline reconnect

- A browser opened from its cached shell while offline reads its Pocket session after reconnecting, then uploads waiting edits without a reload. A temporary startup failure can be retried with Sync now or the next refresh.
- Isolated offline/reconnect checks passed without user data or paid provider requests. The test suite remains skipped as requested.

## 0.9.0 — Astro and Pocket accounts

- The browser workspace moves to Astro on Vercel, with hashed client assets and an offline shell. The existing Pocket design and flows remain.
- Server-only libSQL/Turso credentials back an authenticated, account-scoped API for the seven workspace collections and private Paper JPEGs. Writes merge in a transaction, retain deletion markers and preserve browser edits made during sync.
- Phone and browser share email/password accounts. The native session token is encrypted with Android Keystore; browser copies, chats, drafts and settings are separated per account.
- Existing phone Drive connections remain selectable. Browser Drive import, legacy GitHub Pages export and workspace JSON backup/restore provide migration paths.
- Android and Astro builds passed. Real libSQL connection/schema setup and isolated account, concurrency, deletion, photo and storage checks passed. The test suite is skipped as requested; visual browser and handset checks remain unverified. The APK is unsigned for the release agent.

## 0.8.0 — Pip activity and console character

- Real tool/search activity on phone and web: queries, pending/running/completed/failed/stopped state, elapsed time, result summaries and source links persist with each reply. Activity folds after completion; provider reasoning stays separate.
- Composer controls expose opt-in read-only Notes, Thoughts, Tasks, Gym and cached COROS access. Anthropic web search has its own toggle, streamed activity and clickable citations. Compatible endpoints use function tools for Pocket reads and need browser CORS support. Reads/searches and continuations are bounded; keys and COROS authentication are excluded from tool results.
- Early-console details use Pocket's own pixel type, geometric signal marks, corner ticks and the retained upper-only glow. Pip gains a matching tiny-gamepad animation on both platforms. Reduced-motion behavior stays in place.
- Phone chat storage upgrades to SQLite schema 4 while retaining existing conversations. Original tool IDs, signed thinking and encrypted search blocks survive current-request continuations; only completed text answers are replayed on later questions.
- Java compilation, isolated browser stream checks and a standalone SDK fixture passed. The test suite is skipped as requested. Live chat rendering is unverified because preview requires authentication; the APK is unsigned for the release agent. Actual verification is in BUILD-STATUS.json.

## 0.7.2 — Quieter Pip and exercise selection

- Pip keeps only the upper-corner pixel glow, fading to black. The lower rings and composer glow are removed on phone and web.
- Gym exposes **+ exercise** while logging a workout on both platforms. The web uses an explicit exercise picker rather than a text field that saves and rerenders on blur. Choose an existing lift to switch, or a new one to add; each exercise retains its sets within the same workout. Starting a workout opens the picker, and long dialog lists scroll within the viewport.
- The APK is unsigned for the release agent. Compilation and verification results are in BUILD-STATUS.json; the test suite is skipped as requested.

## 0.7.1 — Pip pixel glow

- Pip's chat and composer now use the approved pixel glow on phone and web: three fine rings rising from the bottom, a top-corner bloom and scattered pixel sparks, with a dark reading area.
- Pip's controls reveal the artwork while keeping focus and pressed feedback. The background is cached by size and has no animation loop; old browser canvas observers are disconnected when changing chats or leaving Pip.
- Movement and Gym remain separate workspace tabs. The APK is unsigned for the release agent; the test suite is skipped as requested. Build results and verification limits are in BUILD-STATUS.json.

## 0.7.0 — Gym and area artwork

- **Gym.** A strength log on phone and web. Start a workout, pick an exercise, and log sets with kg/reps steppers (phone) or fields (web). Last time, your best and a rest timer sit beside the set being logged. Progress shows each lift's best estimated single (Epley e1RM) with its four-week change, an e1RM chart, weekly volume and history. Workouts sync through Drive as `gym.json`; per workout the later edit wins and deletions stay as markers.
- **Area artwork.** Every area has its own dithered scene behind its header: stars for Thoughts, a road for Tasks, waves for Notes and Paper, terrain for Movement, iron bars for Gym, tiles for Apps and rings for Search. Home and Today keep the sky. Phone and web share the same formulas. Titles get a dark halo, the left side stays quiet, and web subtitles are counts instead of explanations.
- **Web.** Gym is tab 6, between Movement and Apps. Apps lists Movement and Gym under Body.
- The APK remains unsigned for the release agent. Compilation results are in BUILD-STATUS.json; the test suite is skipped as requested.

## 0.6.1 — Dithered headers

- Home and Today add an original pixel sky inspired by the supplied reference, tinted with Pocket's accent and fading into black. Phone and web use the same ordered-dither pattern. Text stays crisp and working lists stay plain.
- The artwork is static. Android caches its bitmap by size; the browser paints on resize and disconnects its observer when leaving the page. There is no animation loop or external image download.
- The APK remains unsigned for the release agent. Compilation results are in BUILD-STATUS.json; the test suite is skipped as requested. No data schema, sync scope or task workflow changed.

## 0.6.0 — A connected personal workspace

- **Workflow.** Home, capture and the Today / Thoughts / Tasks / Notes workspace. Apps has one searchable directory grouped by purpose, retaining custom shortcuts and installed apps.
- **Thoughts.** Ideas stay undecided until Make task. Optional review times invite a decision. Source links and stable promotion tokens travel with tasks; existing saved actions remain intact.
- **Actions.** Saving a task opens its details. Focus uses the selected task, Plan time creates a linked local appointment, and completion leads to Activity. Source navigation and Back retain the actual route; search has its own screen.
- **Local calendar.** Pocket Calendar no longer queries or writes Google Calendar, or requests calendar-provider permissions. Drive remains the optional transport for existing shared collections.
- **Web.** The same Today / Thoughts / Tasks / Notes structure, explicit promotion, dates/steps/next/completion, source context, search and drafts. Extras have a secondary Apps home.
- **Pip.** Matching mobile and browser chat, conversation navigation, expandable reasoning, attached Thought/Task/Note snapshots, a bottom composer and keep note / park thought / make task / copy actions. BeautifulUI informed the component structure; Pocket supplies the design. Chats remain local to each device.
- **Motion and copy.** Pip waves, walks, juggles, reads and hops while a reply loads. Phone and web use the same pixel geometry. Reduced motion and visibility pause animation. Unnecessary inline explanations were removed from workspace and chat screens.
- This APK is unsigned for the release agent to sign, as requested. The final APK compilation skips the test suite. Verification and limitations are in [BUILD-STATUS.json](BUILD-STATUS.json). The agent made no paid provider requests; browser checks used isolated fixtures. An earlier web preview reused a connected Drive session; its sample task was removed before checks moved to an isolated origin. Handset behavior remains unverified.

## 0.5.22 — pip, separate chats and reasoning (local build)

- **Pip.** One assistant name across providers, Pocket pixel headings and accent Markdown emphasis, formatted streaming replies and a pixel character that blinks, looks around and changes with thinking/reading/writing. Reduced motion and lifecycle visibility stop its callbacks.
- **History and caching.** Pre-lookup remarks, reasoning summaries and lookup steps are separate from the final answer. Later requests replay only completed question/answer pairs; failed and stopped replies are excluded. Both provider adapters retain the protocol continuation within a reply. Prompt caching remains available and is labelled as reused input.
- **Chats.** Separate conversations, drafts, rename and explicit delete. New chat retains the previous one; switching keeps a reply in its original chat and offers an open command. Settings and access changes stop the active request even if another conversation is open.
- **Storage.** Private SQLite replaces the single chat file, with verified legacy import, atomic writes, readable queued updates and a save barrier tied to each chat. The requested model and returned model are separate, preserving provider identity on reload. Older chats are not automatically removed. Drive sync remains for existing shared collections and does not upload chats.
- **Checks.** Local fake SSE fixtures cover both provider adapters, thinking signatures, repeated reasoning fields and lookup continuations. Storage/UI tests cover Android 7 and Android 15. The stale Google authorization test now asserts the missing-result behavior introduced in 0.5.19. Actual suite counts and the APK checksum are in BUILD-STATUS.json; no paid API or handset requests were made.
- This APK is unsigned and needs the existing release key to install as an update. See [PIP.md](PIP.md) for the audit and storage decision.

## 0.5.21 — One design system, Tasks as the one list, older-looking photos (local build)

- **Design system.** Shared header, section, row, value row, tab, item-command and soft-key components in `PocketDesign`/`PocketActivity`, used by Home, Today, tasks, notes, Tools, Settings, Clock, Agenda, Messages, SMS, Phone, Files, Calculator, Contacts, Dice, Journal, Movement, chat and camera. One monospace typeface for content (sans-serif removed from tasks, steps, editors and chat); lowercase chrome; commands start at the content edge; soft keys align left/centre/right like a keypad phone.
- **Home.** Appointments, next task and latest note share one list with a fixed time/kind column. Health readings are centered and share one three-column grid with the quick actions and tiles. The returning-thought line is gone.
- **Tasks vs Parking Lot.** Tasks are the one list. Open parked thoughts become tasks (due on their return day, linked to their note) on first open, after each cloud sync and when an old Parking tile or notification is used; each thought becomes one task even when another copy syncs it again. `>>` note lines create tasks. Parking is no longer offered as a tile, tool or chat access category; Parking's cloud document stays as a sync record, so older copies and the web see the thoughts as moved to Today.
- **Motion.** Layered shared-axis page transitions (90 ms exit, 60 ms delay, 210 ms decelerating entry) through hardware layers; predictive Back no longer fades the parent; chat slides with matching curves. Today and task pages rebuild on resume only when their data changed.
- **Back.** New tasks and notes return to where they were started; deleting a task or note returns to its origin. Home readings, appointments, Camera photos and SMS conversations opened from elsewhere return there on Back. Tools → today opens the Today task like its tile.
- **Chat.** Full-width Pocket page on phones: standard header with `settings`, monospace transcript with `> ` prompt lines in accent and white replies, empty state, quiet access/cache status line, `send`/`stop` soft key, Pocket's dialog theme. Access choices are Notes and COROS.
- **Camera.** New rendering stages (lens resolution, lateral colour, area contrast, CCD colour matrices, vignetting, wider sharpening halos, bloom and purple fringing, grainy and blotchy noise with high-ISO smoothing, ISO ceiling, chroma bleed) and filtered halving before sampling. On-screen menu for profile, size, aspect and JPEG quality; the viewfinder masks the chosen crop.
- Verification is listed in BUILD-STATUS.json. Handset behaviour, live gestures, real camera frames and paid APIs were not checked. The local APK needs the existing release signing key before installing as an update.

## 0.5.20 — Chat tool continuations and Home swipe (local build)

- Left swipes can start across Home, Today and Tools content with a shorter horizontal threshold. System edges, text inputs, vertical scrolling and multiple-finger gestures retain their normal behavior.
- Gesture observation precedes child dispatch; a clear horizontal swipe can reclaim interception from ScrollView and cancels the original child before it launches a tile or control.
- Empty-argument Claude tools receive a valid input object before the SDK accumulator completes the block; initial arguments and signed thinking blocks are retained.
- Claude schemas use direct SDK builders, and SDK tool values convert to Android JSON without reflective Map conversion. A visible Pocket access row shows enabled Notes/Thoughts/COROS categories and opens their controls; access still defaults off.
- Compatible tool follow-ups retain streamed reasoning text and detail blocks during the current reply. Tool-call names/IDs may arrive in fragments, and usage-only events and terminal finish reasons without a final SSE marker are accepted.
- Provider request errors distinguish the initial tool request from a rejected follow-up; HTTP, JSON, SDK and Android linkage failures identify their stage without exposing data or keys. Token limits, two retrieval rounds, four local reads, category grants and the 16,000-character local-data budget remain; continuation state is bounded and excluded from stored chat history.
- Tests, lint, paid APIs and handset gestures were not run. The local APK needs the existing release signing key before installing as an update.

## 0.5.19 — Google authorization result handling (local build)

- Reads Google's returned result even when Android reports a cancelled activity, preserving the actual error code and installed-certificate diagnostics.
- Missing results and code 16 say authorization did not finish; they no longer imply that the user cancelled after choosing an account. Launch failures remain visible on the Cloud sync page.
- Direct and account-picker results both require an access token and the Drive app-data scope before enabling sync.
- Cloud setup explains the separate Android and web OAuth clients. The Android client must match the installed package and signing SHA-1.
- APK packaging passed; tests, lint and live Google authorization were not run. The local APK is unsigned and needs the existing release signing key.

## 0.5.18 — Home gesture handoff (local build)

- Requires Android 7 or newer for the native chat transport's CompletableFuture APIs.
- Supports Android 11+'s optional AOSP Home gesture contract. Returns an exact matching visible icon's screen bounds for the current Android user; hidden/group/unmapped icons leave the system fallback intact.
- Keeps an already visible Home intact. Pending dashboard, calendar, label and movement changes wait for Android's correlated finish callback or a bounded 750 ms timeout.
- Home refresh triggers share one queued frame and one organizer read for next-task counts and the latest note. Task selection retains its existing ordering and explicit next-task choice.
- Home dismisses chat immediately and uses Android's own task transition instead of Pocket's scale-up override. Normal chat Back/close animations remain.
- A fresh Home handoff does not restore an old chat drawer; reopening from Recents retains the saved page and chat state and does not replay an old gesture callback.
- Android/Nothing OS retains control of Recents and full task animations. No new permissions or root access; handset support and animation quality have not been verified. Tests and lint were not run at the user's request; the APK still needs the existing release signing key.

## 0.5.17 — Pocket chat access and pixel loading (local build)

- Chat settings separately enable read-only saved Notes, open Thoughts and cached COROS data. Matching passages and dated summaries are returned on demand through native client tools; drafts, tasks, photos and credentials are excluded.
- Grants belong to the selected provider and exact normalized API endpoint. Changing the recipient resets access, and turning a category off stops the active reply.
- Anthropic and compatible tool-capable chat models support two lookup rounds and four local reads per reply, with bounded results and a shared reply-token budget. Visible answers remain local history; tool results are transient. No automatic paid retries or background COROS refreshes.
- The sidebar shows a 12 fps pixel wireframe cube with plain thinking/reading status. Motion follows Pocket and Android settings and stops when hidden, detached or paused.
- Source and unsigned APK only: the existing release signing key remains unavailable. Tests, lint, handset checks and paid API requests were not run at the user's request.

## 0.5.15 — home dashboard and COROS (local build)

- Home shows up to two appointments, the exact next task, three movement scores, one returning thought and the latest note. Empty sources disappear. Phone, Messages and Camera remain editable tiles; existing hidden shortcuts and groups remain under All apps.
- Movement signs in independently on the phone through COROS's browser login and PKCE. Tokens use Android Keystore encryption. Score inputs and cached readings stay on the phone; dated snapshots refresh on Home return. Tapping a score opens its inputs.
- Sync now and the first Google connection sync immediately while the screen is open. Failures remain visible, background errors update the page, and OAuth configuration failures show this build's actual signing fingerprint.
- Native tasks use 20 sp readable titles, 14 sp supporting dates/progress, actual checkboxes and visible quick actions. Details expose due dates, importance and checklist additions; the editor keeps Save in its header.
- Optional Drive sync includes portable task ids, checklist progress, selected source snapshots and the chosen next task. Local drafts and reminder ids stay on the phone; remote completion/deletion cancels local reminders. Deletion markers prevent older copies from restoring removed tasks for 30 days.
- No new Android permissions. The update requires the existing release signing key. Physical phone sign-in, Drive transfer and launcher behavior remain to be checked on the handset.

## 0.5.13 — companion apps for everyday work

- Clock edits existing alarms (time, name, daily) with the same ID and on/off state. Named 5/25/50-minute timer presets retain input through tabs/recreation.
- Agenda supports 1–1440-minute appointments, shows end times and writes the chosen end to the selected Android calendar. Legacy records/drafts default to 60 minutes. Duration-only remote changes display once; all-day dates use local calendar days.
- Contacts preserves detail/editor context after recreation, refreshes after permission return and keeps one user-authored draft. Discard is explicit and confirmed; accepted delayed saves retain their native record reference rather than creating another contact on retry.
- Notes supports pin/unpin from its hold menu and Preview → More. Markdown, independent drafts and the formatting wheel are retained.
- Calculator distinguishes a new number from an operator chained onto a result, supports copy and history reuse, and retains invalid expressions without writing history.
- Files keeps Previous/Share/Next reachable and revalidates each selected photo against the owned Camera album.
- Messages leads with active message content; SMS and installed messaging apps are bottom navigation. Phone number entry is larger and plus inserts at the caret.
- Same package, signer, native Android permissions/gestures and dark terminal visual language. No new network/API access. APP-STATUS.md records the actual daily-use limits; physical Nothing Phone checks remain outstanding.

## 0.5.12 — deliberate terminal hierarchy

- Today follows the supplied hierarchy: centered date → current/next appointment → + Task / Note / Focus → TASKS/tabs/list → NOTES. The appointment has no Calendar heading or border. Time, title and metadata are distinct; Today and Agenda use one monospace typeface.
- Task titles use 17 sp and metadata 12 sp; section labels are 12 sp bold uppercase. Single-group lists omit redundant group headings. Checkbox actions remain 56 dp targets.
- Calendar and Search are separate bottom actions. Search opens a real command-style field; Find applies it, Cancel keeps the previous query and Clear restores the full view. Search state survives recreation and the unrelated appointment is hidden while searching.
- Focus uses the appointment shown in the focus block; its topic survives activity recreation. Without a shown appointment, the next task remains the default focus topic.
- Agenda places Upcoming/Past directly above its timeline and keeps creation/draft continuation reachable at the bottom. Permission/setup options remain behind Settings.
- Same package, signer and permissions; no data migration or new network permission. Existing sources, drafts, reminders, notes, messaging and Camera-only Files are retained. Native screenshots are layout renders, not handset recordings.

Layout checks cover content order, single-group headings, long-list scrolling, smaller windows, search cancel/find/clear/recreation and appointment-specific focus after recreation. BUILD-STATUS.json records the final full regression, lint and signature results.

## 0.5.11 — compact apps, Today and source-linked tasks

- Page titles are 24 sp in a 48 dp header that grows with font scaling. Reduced vertical padding gives lists and editors more space; camera setup rows move into Settings. Everyday actions and native Android gestures remain accessible.
- Individual app setup/options open from a Settings button. The dashboard’s Settings tile remains. Phone, SMS, Contacts, message/notification views, Clock and Agenda no longer repeat setup controls on their first page.
- Today combines ongoing/upcoming appointments, due/overdue work, capture and search. Home shows the next appointment and opens the exact next task. Selected native Google calendar events are merged without duplicating a synced local event; pending local edits win.
- Notes → Task, notice More → Make task and Android Share → Pocket Task capture the selected source into a separate draft. Source text/reference survives edits, completion and Markdown export; another note/task draft stays intact. Twenty unfinished captures can be resumed/discarded from Today Settings, with no automatic eviction.
- Task reminders are one-shot exact alarms linked by task ID. Reschedule and five-minute snooze keep the link; completion/deletion cancels them. A linked appointment stays, with its reminder cleared. Reopen does not rearm old alarms. A failed schedule leaves the saved task and shows the error.
- Same package, certificate and permissions, with no Internet permission. No flashable system ROM is included. Native previews use fixture data; handset calls, message delivery, camera, overnight alarms and Nothing’s Home transition remain unverified.

Validation includes source-capture durability/idempotency/failure checks on API 23/35, linked reminder reschedule/snooze/cancellation and stale delivery, calendar deduplication/ongoing/all-day/permission failure, native compact headers and Settings menus, plus the existing suite. BUILD-STATUS.json records the actual final counts and signature.

## 0.5.10 — Back routes, readable planning and native message hub

- Header and system Back follow actual Home/Today routes, including recreation, Preview, task editing and Save. Clock returns through visited tabs; existing-contact edits return to their detail. Native Home/Recents and keyboard behavior remain available.
- Today separates 18 sp titles from 14 sp due dates, priorities and step counts, and gives notes a readable excerpt. Agenda groups days, aligns times separately, labels local/calendar status and supplies Upcoming/Past views.
- Back keeps one unfinished appointment draft without changing its saved event or alarm. Continue draft restores it; unchanged edits create no draft. A linked appointment opens the exact task.
- The default Messages tile opens a native hub for active WhatsApp and other messaging notifications, with group-summary deduplication, installed-app links, SMS inbox and 56 dp Open/Reply/Dismiss controls. The installed apps continue receiving messages. Earlier history opens in the original app.
- Reply uses the app's native freeform RemoteInput action after an explicit Send tap. It checks access, lock state, expiry and conversation identity, prevents duplicate taps and keeps only the user's unfinished composition locally for up to seven days. Received notification text is not stored. App-provided actions and real transport need handset checks.
- Native Calendar Provider changes appear once in the timeline, preserving pending local edits; full local/remote reconciliation and editable duration remain future work.
- Same package/signer and permission set; no Internet permission. Regression checks and native fixture previews cover these paths. Nothing's Home flash still requires physical-device verification.

## 0.5.9 — Notes wheel, editable shortcuts and Home

- Hold in the actual Notes editor for a radial formatting wheel. Move/release or release/tap chooses a format. Format opens the same wheel, More opens the complete native menu, and Select exposes Android selection/clipboard actions. Undo preserves later typing; Clear draft still needs confirmation. Short windows use the menu without reducing target sizes.
- Every dashboard tile offers Change app, Rename, Use app name and Reset shortcut. Choosing ChatGPT shows ChatGPT; changing apps clears an old custom name. Earlier package-only assignments resolve labels off the UI thread. Names and accessibility descriptions update in place.
- Native Home intents show the final dashboard without an extra Pocket page animation, including saved-activity restoration. The black window explicitly excludes transparency/wallpaper. Settings reads Android's real Home role and refreshes after returning.
- The wheel closes on Back, Home, cancellation and pause, restores accessibility, and adds no system overlay/gesture exclusions or permissions.
- PRODUCTIVITY.md prioritizes backup/restore, linked task reminders, calendar reconciliation, unified search and note organization. It documents the corrected swipe-up report and the boundary between Pocket's surface and Nothing's system gesture animation. The physical launcher flash is not confirmed resolved.
- New native activity regressions cover editor holding, both wheel selection modes, cancellation, draft preservation, short windows, label migration/rename/reset, default Home role and immediate Home presentation. Native previews include the wheel.

## 0.5.8 — researched hierarchy and Notes layout

- RESEARCH.md records public NN/G, Carbon, Android accessibility, archived Material divider and Nokia S60 sources, with decisions tailored to this app and the supplied Notes screenshots.
- Shared headers, data rows, primary actions and idle inputs no longer draw default dividers. Focus/selection cues remain; freeform Notes has no field underline.
- Notes puts save in the header, keeps a full-height writing area and has one bottom group containing Format and Preview. Bold, Undo, Gesture help and confirmed Clear draft are available in Format. Swipe formatting stays inside that control.
- Preview reserves the page for the selectable document and has compact Edit/Share soft keys. Native Markwon headings use restrained size steps and no automatic H1/H2 underline; source Markdown and authored content rules remain intact.
- Preserve black, original pixel icons/headings, the selected dashboard tile, generous touch targets, draft autosave, Android navigation and same-signer update installation.
- Existing editor-growth, short-window and formatting checks follow the new control locations. A confirmation regression protects saved notes when clearing through the menu. Native previews include an empty editor and the one-heading reading case.

## 0.5.7 — minimal dark refinement

- Black backgrounds throughout Pocket, including input fields and keypad controls. Text, spacing and thin baselines provide structure.
- Dashboard next task/alarm is a plain text group; quick capture has text controls and unselected app tiles have no outlines. The original nine icons and one selected accent tile remain.
- Call, Send, Save, equals, Stop and Shoot use accent text instead of large filled bars. Form fields use a baseline and show accent focus; rows align with page content.
- Pixel headings, native ripple feedback, visible keyboard/D-pad selection and disabled states remain. Controls keep their existing 52/56 dp touch targets and editors keep their full available height.
- All previous functionality, Android Home/Recents navigation, permissions, draft storage and update-install signing are retained. This increment changes presentation.

## 0.5.6 — design refinement

- Shared PocketDesign primitives define palette, type roles, 4 dp spacing, 16 dp insets, surfaces, headers, controls, list rows, inputs and native feedback states.
- Dashboard groups next task/alarm, refines the nine-icon grid and retains pixel soft keys and D-pad selection.
- Primary Call, Send, Save, equals, Stop and Shoot actions have an accent fill; ordinary navigation and data rows stay quiet. Keypad digits are centered and easier to read.
- Forms use padded fields with visible focus boundaries. Contact/message/photo rows separate the main label from muted metadata.
- Settings accent and Large text apply to shared app controls. Native system font scaling, gestures and short-window scrolling remain available.
- Native render fixtures settle page transitions before screenshots. Existing navigation, touch-target, editor and reliability checks are retained. DESIGN.md is the implementation reference.

## 0.5.5 — reliability increment

- Clock migrates its own records to device-protected storage and restores schedules after locked boot. No other private app data moves there. Old overdue one-shot alarms are reported as missed rather than silently shifted to tomorrow. Scheduling failures roll back the new/edited record.
- Ringing has a bundled fallback tone, preparation timeout, optional vibration, a ten-minute limit, bounded wake lock and sticky recovery on the same boot. Stop/Snooze belong to one occurrence. Denied snooze leaves the alarm ringing. Clock → Alarm setup / test shows exact-alarm, alert/channel, alarm volume and full-screen status and schedules a real ten-second test.
- Camera opening and session setup time out with a retry message. An accepted photo write runs off the UI thread and uses a foreground service while Home is visible. A thumbnail failure after publishing the JPEG still reports the saved photo. Files remains limited to Pocket Camera photos.
- Phone disables repeated call taps during handoff, cancels abandoned permission/SIM preparation and returns to an existing call. Supported earpiece proximity locking ends when the route changes, the call ends or the call screen stops. Withheld numbers remain private.
- Provider reads and permission results belong to their requesting page. Save controls disable during an accepted write; ordered writes finish across activity destruction. Native contact editor tokens and calendar event markers make retries idempotent.
- Notes/tasks autosave drafts after 400 ms and on pause. An intentionally empty draft stays empty. Clearing a draft requires confirmation; sharing into an already open note updates its editor. Concurrent organizer stores serialize entry mutations.
- Appointments save locally before optional Calendar Provider work. Revision-aware sync results merge the native event link without overwriting newer local edits. Failed provider work stays pending for explicit retry. This is not a new Google account or full two-way reconciliation.
- Image/PDF attachment results release their bitmaps if their viewer has closed. Device settings reports revoked brightness access without crashing.

Automated regressions cover the changed paths with Android activities/services, permission callbacks and native provider fixtures. The release's BUILD-STATUS.json has the exact counts. A fixture cannot validate cellular delivery, Camera2 hardware, overnight OEM battery behavior or physical gesture smoothness.

## Next increment — handset findings first

Prioritize issues observed while using the current release, then improve call audio-route selection, incoming/ongoing call notification controls, alarm entry editing and Settings state refresh. Check Camera memory/storage behavior over longer sessions and interrupted saves. Extend contact/appointment loading and deletion recovery where device behavior requires it. Each future APK must pass its relevant regressions and update-install signature checks before delivery.

## Checks on the Nothing Phone (3a)

1. Install over the existing app, open Clock once, and verify saved notes/tasks/alarms/photos.
2. Run the ten-second alarm test with the screen locked. Check Stop/Snooze, a real reboot and an overnight alarm. Keep the stock Clock for essential alarms until these pass.
3. Capture a photo and immediately go Home; reopen Files and check the saved JPEG. Test front camera, flash, permission denial and low storage.
4. Before changing everyday Phone/SMS defaults, check incoming/outgoing calls, screen locking at the ear, speaker/headset/mute/hold and both SIMs if present; then real sent/received SMS and carrier MMS. Sending MMS attachments and RCS are not implemented.
5. Type a draft, switch through Home/Recents and reopen it. Save/edit contacts and a local appointment. Optional Google-calendar writes need an already synced phone calendar and explicit calendar access/selection.
6. Android notification-listener restricted settings still need the user's manual consent. Normal Pocket alert permission, SMS access and listener access are separate. Check actual notifications and native bottom-edge navigation.

The build environment has no attached handset. 0.5.10 is a usable test increment, not certification that every phone service works on this carrier/device. The release checklist records the remaining work so the next session can continue from this version.
