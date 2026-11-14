# Pip server runtime

Server chat runs (`pip-runs.js`) and scheduled reports (`pip-background.js`) use
OpenClaw 2026.11.3 through its published `openclaw/plugin-sdk/agent-core` entry
point. `@openclaw/agent-core` is a private workspace package, not an npm dependency.
No OpenClaw internals are imported or copied.

The `Agent` owns model/tool iteration, transcript state, argument validation,
lifecycle events and cancellation. Pocket supplies its tools, permissions,
rendering, durable approvals and database writes. The supported `streamFn`
extension uses Pocket's existing AI SDK provider transports; those transports make
one model request and do not run an agent loop.

`src/server/pip-agent-transport.js` translates the two message/event contracts.
`src/server/pip-agent.js` registers tools and consumes Agent events.

## Limits

- **Per request**: the output cap is the person's reply limit (`value.maxTokens`),
  the same on every request (`maxOutputTokens` passed to the transport).
- **Per reply**: at most `MAX_REQUESTS` = 12 model requests, counted across approval
  pauses through the checkpoint. The last request's instructions say it is the last:
  write the answer now; cards may still be drawn; lookups are refused. Past the
  ceiling the reply ends with what it has plus a notice.
- There is **no per-reply token budget** and thinking is never counted. Browser-only
  chats still use the older budget (`tokens` / `researchTokens`) in
  `src/client/pip-stream.js`.
- **Time**: one five-minute research deadline shared by all requests of a reply, and
  a 90-second idle limit (no bytes from the provider; the transport's `clock` and
  every agent event reset it). Neither runs while the person decides on an approval;
  the idle limit does not run while a tool works.
- **Lookups** (tools that are neither writes nor state tools) are refused with a
  `research_budget_reached` result once research stops. Research stops at: the
  `research` caps (lookups, web calls), `RESEARCH_LIMITS.calls` / `webCalls`,
  48,000 characters of lookup results, after eight requests, when the `enough`
  judge says yes, when an identical failed call repeats, or after a cut-off message.
  A single result over 8,000 characters is `result_too_large`. The model is then
  told that research stopped. Cards, plans and approved saves are never taken away:
  removing them made models write "[card: …]" stand-ins instead of drawing.
- A conversation over 190,000 characters ends the reply.
- A message cut off at the reply limit (`length`), whether it is text or a tool call,
  is dropped and written again, at most twice in a row. After that the reply ends
  with its partial text and "The reply limit per message was reached."

Endings for the ceiling, the deadline, the idle limit, the context size and
`length` keep the partial answer and its cards, add the notice, settle the
activity and publish phase `failed`. The turn ends as failed with that message,
and Continue (`resume`) can pick it up. Pressing stop raises
`AbortError('Stopped')`. Any other failure publishes the normalized answer with
the activity settled before it throws.

## Tools

Lookups run in parallel, at most `RESEARCH_LIMITS.parallel` (3) at a time.
Writes, device tools, cards and state tools are `executionMode: 'sequential'`, so
a batch that contains one runs one call at a time. Identical lookups are answered
from cache (`cached: true`), including lookups running at that moment and a
restarted run's observations. An identical failed call is answered from its
failure (`repeated: true`). A write that was already saved in this turn
(`applied_href`) is answered with `existing_proposal` instead of asking again. A
grant switched off while a call ran is `access_disabled`. A tool that throws is
`data_unavailable`, and invalid arguments are `invalid_arguments`: both are tool
results, never a crashed run.

Text streams into the answer and thinking into `result.reasoning` (bounded to its
last 16,000 characters past 24,000). Text written before a lookup moves to the
reasoning as working notes. Text up to the last drawn card stays. While
`show_card` streams its arguments (`toolcall_start` / `toolcall_delta`), the
card's complete elements stand in the answer as an open fence. The checked card
replaces that fence, or the fence is dropped.

## Approvals

Approval checkpoints contain OpenClaw messages (thinking blocks untouched), pending
calls, previews, rows, counters and displayed output. A durable run pauses at the
assistant message boundary, before executing its tool batch, with every write and
device call of that message pending at once. On resume, Pocket first checks that
every pending request is settled; if one is not, it pauses again unchanged. Then
it supplies approved, declined or device results using the same call IDs, and
calls `Agent.continue()`. The database's existing run lease and idempotent write
boundary still own concurrency. Approval request IDs include the request index,
so reusing a provider tool-call ID cannot reuse an earlier approval. Completed
conversation history continues to use Pocket's existing storage format and is
translated at the runtime boundary.

## Deployment

Deployment requires Node >=24.16.0 <25 or >=26.1.0. The Fly Dockerfile pins Node
24.16.0. Install with `npm ci` and build with `POCKET_TARGET=node npm run build`.
Pending checkpoints made by the previous runtime must be stopped and resubmitted;
they are rejected explicitly rather than interpreted as OpenClaw transcripts.
Browser-only chats still use the existing client runtime. This change migrates
the server backend; it does not load the OpenClaw Node package into browsers.

## Verification

Verification uses the real OpenClaw Agent and simulated provider HTTP streams:
`node --test tools/pip-agent.test.mjs tools/pip-agent-transport.test.mjs tools/pip-runs.test.mjs tools/pip-effort.test.mjs tools/pip-background.test.mjs tools/pip-assignments.test.mjs`
plus the full tools suite (`NODE_OPTIONS=--experimental-vm-modules npm run test:tools`).
These cover:
- approvals, edited and invalid inputs, partly settled batches, device tools and restart recovery
- the request ceiling, `length` retries, the deadline and the idle limit, and stops
- cards after the lookup limit, card drafts and card updates
- reasoning, usage, failure states and scheduled jobs

They do not establish live model quality or deployment health.
