# pip — Pocket's assistant

Pip uses the API provider and model selected in settings. It has its own name across providers. Provider names remain visible in API and data-access settings so the destination of a request is clear.

## Repetition and caching

The concrete repetition bug was conversation history: Pocket joined a model's remarks before a lookup to its final answer and replayed that combined text on subsequent messages. Failed or stopped partial replies could also be replayed as ordinary answers.

Pip now stores the answer separately from the provider's reasoning summary, lookup steps and pre-lookup remarks. Only completed answers and their paired questions go into later requests. Retry replaces the partial answer; stopping invalidates late callbacks. Within one reply, the original tool-call text, IDs and signed thinking blocks are still retained for the provider's continuation protocol.

Prompt caching stays available on the phone. It reuses input prefixes; it does not replay generated answers. The persona and date are stable for an entire request, including its lookup rounds. Changes to model, access, thinking settings or the date can cause a cache miss. Short chats may not reach a model's minimum cacheable input length. Settings → storage & usage shows the reported read/write counts.

References: [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [thinking summaries and supported configurations](https://platform.claude.com/docs/en/build-with-claude/thinking).

## Conversation storage

Chats, turns, drafts, reasoning and reported usage are in a private SQLite database under Android's no-backup directory. A transaction saves a chat and its turns together. The paid request waits for that particular chat's user message to be saved; a successful save in another chat cannot approve a failed write. Queued writes remain readable while switching chats. The provider's configured model is stored separately from a canonical model name returned by the API, so reloading a chat never drops its provider identity.

The prior single-chat JSON file is imported with its original validation. Its source is removed only after the database copy can be read. A damaged source is kept for recovery. Interrupted replies reopen as retryable failures and are never automatically sent again. There is no automatic deletion of older conversations. New chat keeps the previous conversation and its draft. Chats can be opened, renamed or explicitly deleted from the picker. One reply can run at a time; switching chats leaves it in its original conversation and offers an **open** command.

SQLite replaces the single whole-conversation file because it supports separate chats, atomic updates and an indexed conversation list without rewriting every saved conversation. Drive continues to sync Pocket's existing shared collections. It is a remote sync layer, so replacing it would not solve the local history bug or draft races. Chats are not included in Drive sync or Android backups. They are removed by clearing app data or uninstalling. API keys continue to use Android Keystore encryption and are not stored in the chat database.

## Interface and reasoning

The page uses Pocket's standard header, pixel title and headings, monospace body, accent emphasis, prompt lines and bottom send/stop control. Replies receive Markdown formatting during streaming; parsing is throttled for longer replies. Each answer has an expandable reasoning section when the API supplied a summary or pip performed a lookup. It shows provider-supplied text and actual lookup steps; Pocket does not manufacture reasoning for a model that supplies none. Signatures and encrypted thinking are not displayed or saved with summaries.

The loader is the same pixel character on phone and web. It randomly waves, walks, juggles, reads and hops, switching activities between short animation cycles. Both implementations draw the same 32-pixel geometry. It stops callbacks when hidden, paused or detached, and remains still with reduced motion or disabled Android animations.

The chat has the same static pixel glow on phone and web: only the upper-corner bloom, fading to black before the middle of the page. Sparks stay inside the light, and the conversation and composer sit on black. The artwork is cached by size on Android and painted only on resize in the browser; changing chats disconnects the old canvas observer.

## Browser and shared workflow

The component hierarchy follows [BeautifulUI](https://www.beautifului.dev/): conversation navigation, messages, expandable reasoning, context cards and composer. The implementation and visual styling belong to Pocket: pixel headings, monospace text, accent color and compact controls. No framework or copied component library is required.

Phone and browser drafts can explicitly attach up to three Thought, Task or Note snapshots. Sources accompany the saved user message and completed conversation history. A source changing later does not silently rewrite a question. A reply or selected passage can be kept as a Note, parked as a Thought, turned into an editable Task or copied. These kept records enter Pocket's existing shared collections; a Thought does not become a Task automatically.

Browser conversations and drafts use local browser storage, outside Drive. Keys use tab session storage; Anthropic's key is shared with Paper in the same tab, and compatible API keys are bound to their endpoints. Requests go directly to the chosen provider. Compatible endpoints must allow browser requests through CORS. Explicit retry replaces one unfinished reply; changing provider starts a separate conversation. Clearing browser data removes local chats. The browser replays at most 20 completed pairs within a 60,000-character history budget; it does not offer native Pocket tool lookups.

## Verification

`PipChatTest` exercises persistence, queued-write races, switching during a reply, retries, interruption recovery, provider identity, migration, deletion, UI controls and loader lifecycle on Android API 24 and 35. `PipStreamingTest` feeds local SSE responses through the Anthropic SDK and compatible adapter, including thinking signatures, duplicate reasoning fields and lookup continuations. These fixtures make no paid API requests. `PipPreviewTest` writes fictional native layout previews to `app/build/screenshots/pocket-22-pip-*.png`.

The final 0.7.2 build skips the test suite at the user's request. Earlier checks and the final APK checksum are recorded separately in `BUILD-STATUS.json`. Earlier browser checks used an isolated origin and fake SSE replies; this release's browser preview requires authentication, so only the generated glow artwork was inspected. Handset animation smoothness remains unverified; APK signing is assigned to the release agent.
