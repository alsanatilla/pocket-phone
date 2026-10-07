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

SQLite replaces the single whole-conversation file because it supports separate chats, atomic updates and an indexed conversation list without rewriting every saved conversation. Signed-in chats, drafts, context and reply activity sync through the Pocket account API between phone and browser. Account chats return on the next sync after clearing a local copy; guest chats are lost when their local data is cleared. Chats are excluded from legacy Drive sync and Android backups. API keys continue to use Android Keystore encryption and are not stored in the chat database.

## Activity, search and reasoning

The page uses Pocket's standard header, pixel title and headings, monospace body, accent emphasis, prompt lines and bottom send/stop control. Replies receive Markdown formatting during streaming; parsing is throttled for longer replies. Actual searches and local reads have their own activity section above the answer. It opens while a reply streams and folds to a compact summary afterward. Each step records its tool name, query/parameters, pending/running/completed/failed/stopped state, elapsed time, result summary and safe source links. Parameters stay behind an additional control. Activity is stored with the reply: private SQLite on phone and account-scoped browser records. Stop and interrupted native replies settle unfinished activity, and retries start a fresh activity list.

Reasoning stays separate. It shows only the provider's summary and remarks before a lookup; it is never presented as proof of tool execution. Legacy phone lookup lines remain readable in older replies. Signed thinking and encrypted search payloads exist only in the current request's continuation; they are not saved in the activity display.

The composer exposes **tools** and **web**. Pocket access starts off and is granted per API provider/endpoint. Notes, undecided Thoughts, chosen Tasks, Gym and cached COROS readings each have their own read permission. Search results are small excerpts; a note can be read explicitly for more detail. COROS reads use only the existing cache, with its update time and stale/missing state; the tool never refreshes COROS or reads its authentication store. All tools are read-only. Keeping a note, thought or task still requires the user's own action.

Anthropic web search starts off. When enabled, its streamed server-tool events create visible activity, query labels and result links; actual citation events create clickable answer citations. Search errors are parsed even when the HTTP request succeeds. A deferred server search alongside client tools waits for the client results; `pause_turn` resumes with the original assistant content. Compatible providers use function tools for Pocket reads. With web search on, they also get `search_web` and `read_web_page`, which call Firecrawl search and scrape from the device. These work without a key at low volume; an optional Firecrawl key is stored like a provider key (encrypted on the phone, tab session in the browser). Page text is capped at 6,000 characters. On OpenRouter, a `:free` model or `openrouter/free` is sent with a `models` fallback list (Nemotron 3 Super, Ling 3.0 Flash, the free router), and HTTP 429/502/503 is retried twice before any reply starts. Unsupported provider/model settings fail visibly.

Both transports cap a reply at four local reads, three web searches and two continuations, with token, argument, result and stream-size budgets. Inputs are validated before reads, access is checked again, and results are treated as untrusted reference data. Only actual provider events and executed reads produce activity. No tool activity is inferred from assistant prose.

The loader is the same pixel character on phone and web. It randomly waves, walks, juggles, reads, hops and plays a tiny gamepad, switching activities between short animation cycles. Both implementations draw the same 32-pixel geometry. It stops callbacks when hidden, paused or detached, and remains still with reduced motion or disabled Android animations. Geometric signal marks and short loading labels give the chat an early-console feel without adding explanatory copy, sound or a background animation loop.

The chat has the same static pixel glow on phone and web: only the upper-corner bloom, fading to black before the middle of the page. Sparks stay inside the light, and the conversation and composer sit on black. The artwork is cached by size on Android and painted only on resize in the browser; changing chats disconnects the old canvas observer.

## Browser and shared workflow

The component hierarchy follows [BeautifulUI](https://www.beautifului.dev/): conversation navigation, messages, compact tool activity, expandable reasoning, context cards and composer. The implementation and visual styling belong to Pocket: pixel headings, monospace text, accent color and compact controls. No framework or copied component library is required. The activity and source patterns were reviewed against [Vercel's tool component](https://elements.ai-sdk.dev/components/tool), [source disclosure](https://elements.ai-sdk.dev/components/sources) and [progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/). The implementation follows Anthropic's [tool protocol](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) and [web search events/citations](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).

Phone and browser drafts can explicitly attach up to three Thought, Task or Note snapshots. Sources accompany the saved user message and completed conversation history. A source changing later does not silently rewrite a question. A reply or selected passage can be kept as a Note, parked as a Thought, turned into an editable Task or copied. These kept records enter Pocket's existing shared collections; a Thought does not become a Task automatically.

Conversations and drafts save locally first, then sync to the signed-in account on phone and browser; each reply merges by its own edit time, so two devices can continue the same chat. Guest chats can be copied into the account when signing in; provider keys are not copied. Keys use tab session storage; Anthropic's key is shared with Paper in the same tab, and compatible API keys are bound to their endpoints. Requests go directly to the chosen provider. Compatible endpoints must allow browser requests through CORS and support function tools when Pocket access is enabled. Explicit retry replaces one unfinished reply; changing provider starts a separate conversation. Clearing browser data removes guest chats; account chats are restored on the next sync. The browser replays at most 20 completed pairs within a 60,000-character history budget. Its read-only tools read the browser's saved/synced Pocket records; they cannot reach device-only records.

## Search and account access

Pocket's global search finds saved Pip questions and answers on phone and web, including messages beyond the API's replay budget. Selecting a hit opens that conversation. Search uses the signed-in account's index and saved local records; it does not make a paid provider request.

Use the same Pocket account across devices. Passkeys are additional sign-in keys for that account; a phone can link through a short code approved in a signed-in browser. Creating an account and signing in are separate actions. Provider keys still stay on their device, so continuing a chat elsewhere requires configuring that device's provider key.

## Verification

The 0.11.0 pass skips the test suite at the user's request. Astro production and Android APK builds passed, along with isolated authentication, device-linking, session revocation, account isolation, search and note-history checks. Search fixtures include long Pip messages, deletion and migration of older account chats. Browser previews with fictional data verified global Pip search alongside Notes, Tasks and Thoughts, including accent-insensitive matches. These checks made no paid provider requests.

Physical passkey prompts, native sign-in and handset animations remain unverified. Actual build results and signing status are recorded in [BUILD-STATUS.json](BUILD-STATUS.json); another release agent handles APK signing.
