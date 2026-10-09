# Pip architecture decision: AI SDK

Decision date: 9 October 2026. Scope: browser Pip first.

## Chosen architecture

Use **Vercel AI SDK 7 `ToolLoopAgent`** with Pocket's existing Astro UI, browser storage, account sync, and tab-only provider keys. The user selected AI SDK after reviewing repository research. No additional agent framework or workflow service is introduced in this migration.

| Responsibility | Owner |
| --- | --- |
| Provider streaming, tool-call parsing, structured continuation | AI SDK and its provider adapters |
| Tool definitions, input validation, tool execution, approval of writes and resumption after the decision | AI SDK `tool()` with zod input schemas, `toolApproval` |
| Tool calls an open model writes as `<tool_call>` text | AI SDK language-model middleware (`wrapLanguageModel`) |
| Current question, bounded history and recorded action memory | Pocket's context builder and history tools |
| Tool permissions, what each tool does (record reads, Firecrawl web research, writes), previews and refusals before approval | Pocket's tool layer |
| Per-reply token, time, call and result budgets | Pocket's `prepareStep` and tool execution policy |
| Caching, refused duplicate saves and outcome journal | Pocket's runtime wrapper |
| Chat rendering, approval cards with editable review, Stop/Continue/Restart | Existing Pocket UI |
| Persisted chats and cross-device synchronization | Existing browser storage and Turso account API |

The model receives the current question and relevant history. SDK-generated tool calls execute through Pocket's existing permission-aware functions. Writes (`create_record`, `change_record`, `coros_write`) need the user's approval: the stream ends with an approval request, the reply waits for the decision (an edit replaces the call's input), and the next SDK call carries `tool-approval-response` messages, so the SDK validates the input again and runs or refuses the tool. The SDK carries matching tool IDs and provider reasoning metadata into subsequent model calls. Pocket records only the readable answer, reasoning summary and actual tool/action outcomes, keeping signatures and encrypted provider reasoning out of saved activity.

## Implementation

- `src/client/pip-core.js` builds provider-neutral instructions/messages/tool definitions and loads the agent runtime on demand.
- `src/client/pip-stream.js` runs `ToolLoopAgent`. Its `prepareStep` selects current tools and allowance; tool executors enforce Pocket's limits and record outcomes; `toolApproval` previews each write and waits for the user's decision.
- `src/client/pip-sdk-tools.js` defines every tool with the SDK's `tool()` and a zod input schema, loaded with the SDK. `src/client/pip-tools.js` keeps permissions and what each tool does.
- `src/client/pip-provider.js` loads Anthropic, OpenAI, OpenRouter or the generic compatible adapter, and wraps the non-Anthropic ones in middleware that turns text-format tool calls into SDK tool calls. Its fetch boundary enforces the configured endpoint, no redirects, no browser credentials, bounded data, safe errors, and cancellation.
- `src/client/pip-limits.js` holds the shared runtime limits and context-overflow message without importing the SDK into the initial app bundle.
- The existing UI, action approval flow, history recovery and account storage remain integrated with the new runtime.

Pinned dependencies: `ai@7.0.136`, `@ai-sdk/anthropic@4.0.78`, `@ai-sdk/openai@4.0.91`, `@ai-sdk/openai-compatible@3.0.67`, `@openrouter/ai-sdk-provider@3.1.0` and `zod@4.6.5`.

## What the GitHub examples contributed

- [vercel/ai: building agents](https://github.com/vercel/ai/blob/main/content/docs/03-agents/02-building-agents.mdx): use the SDK's agent loop and lifecycle hooks instead of reconstructing provider tool transcripts ourselves.
- [OpenRouterTeam/ai-sdk-provider](https://github.com/OpenRouterTeam/ai-sdk-provider): use the provider-specific adapter for OpenRouter reasoning metadata and fallback options.
- [Mastra approval recall example](https://github.com/mastra-ai/mastra/blob/main/examples/agent/src/hitl-approval-recall.ts): verify stored decisions and actual execution independently of assistant prose. We borrowed the testing principle, without adding Mastra.
- [Vercel Eve session/run design](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md): conversation identity, execution identity, user decisions and stream observation are separate concepts. These remain useful for a future server runtime.
- [vercel-labs/github-tools chat](https://github.com/vercel-labs/github-tools/blob/main/apps/chat/server/api/workflow/chats/%5Bid%5D.post.ts): a concrete authenticated web agent reference with structured messages and run IDs.

The research also considered [Vercel Workflow's Astro integration](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/getting-started/astro.mdx), [Mastra durable agents](https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/docs/harness/durable-agents.mdx), and [LangGraph persistence](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx). They are alternatives for durable server execution; none is required for the selected SDK migration.

## Verification

The SDK tests use protocol-valid provider streams and exercise the installed adapters directly, with fake credentials and no paid model calls. They cover signed Anthropic continuation, encrypted OpenRouter reasoning, fallback models, native OpenAI token settings, result-to-call matching, concurrency, duplicate reads, permission revocation, malformed arguments, HTTP retries and interrupted streams.

Existing history/recovery tests cover original-question priority, observed actions, bounded and paged recall, partial-answer exclusion, Continue/Restart, context errors, storage failures and account changes. Browser checks exercise the actual chat UI and production builds check the lazy-loaded runtime chunks.

These verify runtime contracts. They do not establish that every real-model answer will be relevant or correctly researched; conversation-quality evaluations remain necessary.

## Remaining runtime boundaries

AI SDK alone does not provide a durable background worker. The run is still browser-owned and interrupts when the tab closes, including while it waits for an approval; nothing is written until the user approves. Continue reuses recorded observations after a user request; it is not automatic server-side resumption.

Likewise, introducing AI SDK does not implement a persistent cancelled-request/dismissed-action ledger. Old pending proposals still need a separate product-state change to guarantee that they cannot resurface after "nevermind". That unfinished prototype has been archived outside the application source.

If background execution is added later, use stable chat/request/run/action IDs, authoritative structured messages and decisions, authenticated cancellation, payload-scoped approvals, and idempotent mutations. Server-side provider credentials require an explicit account setting; existing browser-tab keys must not be silently uploaded.
