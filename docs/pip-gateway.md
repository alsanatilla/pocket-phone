# Pip on the OpenClaw gateway

Pip's replies, workspace and memory are OpenClaw's. The gateway runs on the same Fly machine as Pocket, bound to
`127.0.0.1`; Pocket is a client of it. This replaces the in-process `streamChat` loop and Pocket's own memory table
once the client below is wired.

## Why the gateway and not the memory SDK

OpenClaw's memory is files (`USER.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`) plus a SQLite index, and the parts that
keep it true — writing, watching, dreaming, promotion — live in the gateway. The plugin SDK exposes the search
manager, but not the watcher: a file written by another process is not reindexed, and `openclaw memory index`
refuses while the gateway owns the state. So memory is owned by the gateway, not embedded in Pocket.

## What runs where

- `services/gateway/config.mjs` generates `openclaw.json` at boot from Pocket's environment: loopback gateway on
  `PIP_GATEWAY_PORT` (default 18789), token auth, `memory-core` with FTS-only search (no embedding key needed), a
  custom OpenAI-compatible provider, and one agent (`pocket`) whose workspace is `PIP_GATEWAY_HOME/agents/pocket`.
- `services/server/start.mjs` starts the gateway beside the web process and worker when `PIP_GATEWAY=1`, with
  `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` in `PIP_GATEWAY_HOME` (a Fly volume, so `USER.md` survives deploys).
- The Responses API is enabled at `POST /v1/responses`; select the agent with `model: "openclaw/pocket"`.

## Validated

With a real model through the custom provider, one request
("Remember that I prefer tea over coffee") answered and wrote OpenClaw's user model by itself:

```md
<!-- observed: 2026-11-15 | status: active -->

- Prefer tea over coffee.
```

A later request with no history ("What do I prefer to drink?") answered "Tea." from `USER.md`. Writes, injection and
supersession are the gateway's, not Pocket's.

## The reply loop Pocket still has to move

1. `POST /v1/responses` with the chat's turns as `input`, Pocket's instructions, `stream: true`, and Pocket's tools
   as **client tools** (function definitions): cards (`show_card`, `update_card`), reads, changes, approvals,
   device tools, `remember`/`forget` are gone — memory tools are the gateway's own.
2. Map the SSE events to the turn Pocket already stores: text deltas into `answer`, function calls into `activity`,
   usage into `usage`. `response.output_item.added` / `response.function_call_arguments.delta` /
   `response.output_text.delta` / `response.completed` are the events to read.
3. Execute a client tool in Pocket (the existing `execute`/`preview`), then send its result back as
   `function_call_output` (with `previous_response_id`), continuing the same response. A write that waits for the
   person pauses there: the approval is Pocket's UI, the tool output is what the gateway receives.
4. Store the finished answer in the chat as today; memory is no longer written by Pocket and no list is injected.
5. Background routines use the same client with their own agent session, so they read the person's memory too.
6. The `/memory` page reads `USER.md`/`MEMORY.md` through the gateway (or a file read RPC) and edits them as files;
   the `pocket_pip_memory` table and its API go away.

Until step 1 is done the flag stays off and Pocket keeps its current loop.

## Operations

- `PIP_GATEWAY=1`, `PIP_GATEWAY_TOKEN` (generated per boot when unset), `PIP_GATEWAY_MODEL`, `PIP_GATEWAY_BASE_URL`,
  `PIP_GATEWAY_KEY`, optional `PIP_GATEWAY_HOME`, `PIP_GATEWAY_PORT`, `PIP_GATEWAY_AGENT`.
- The gateway's config is generated, so change Pocket's environment, not `openclaw.json`.
- One agent is enough for one person. A second Pocket account needs its own agent entry and workspace.
- Keyword memory needs no embedding provider. Adding one later is `PIP_GATEWAY_*` config only.
