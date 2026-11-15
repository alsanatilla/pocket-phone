# Pip on the OpenClaw gateway

Pip is an OpenClaw agent on the same Fly machine as Pocket. The gateway owns the model loop, sessions,
compaction and memory; Pocket displays replies and provides its account-scoped data tools through a plugin.

## Runtime

- `services/gateway/config.mjs` generates the loopback gateway config and Pip's workspace persona and card skill.
- `services/server/start.mjs` starts web, worker and gateway together. In native mode a gateway exit restarts the
  service. The workspace lives on the Fly volume; session databases remain on local disk.
- `src/server/pip-openclaw.js` sends `chat.send` over OpenClaw's operator connection and maps streamed events to
  Pocket's stored turns. `chat.abort` stops a reply; steering uses `queueMode: steer`.
- `services/gateway/pocket-plugin` exposes Pocket's schemas. Calls go to the web process's authenticated loopback
  `/internal/pip-tools`. Unknown sessions are forwarded once to the worker's endpoint.
- Chats, research assignments, scheduled reports, training conversations and automatic training use the native
  path when `PIP_OPENCLAW_NATIVE=1`. Phone-calendar calls wait for an existing device request to be answered.

## Permissions

Ordinary writes require OpenClaw plugin approval, shown in Pocket. Approval is tied to the tool, arguments and
call id and consumed once. Research and unattended reports have explicit tool allowlists. Training writes are
preauthorized only by the server's training run policy, after a successful preview; execution rechecks the
existing planner's current authorization, date range, session limits and ownership rules. An ordinary chat does
not inherit this policy. Training preferences can be saved while automatic planning is paused.

## Deployment

`PIP_GATEWAY=1`, `PIP_OPENCLAW_NATIVE=1`, `PIP_GATEWAY_HOME`, `PIP_GATEWAY_PORT`, `PIP_GATEWAY_AGENT`,
`PIP_GATEWAY_MODEL`, `PIP_GATEWAY_BASE_URL` and secret `PIP_GATEWAY_KEY` configure the runtime. Gateway and tool
endpoint tokens are generated per boot when not supplied. This is a personal deployment with one agent/workspace;
multiple users would need isolated agent workspaces as well as the existing account-scoped tool sessions.

The Responses adapter (`pip-gateway.js`, `pip-gateway-run.js`) and `PIP_GATEWAY_CLIENT`/`PIP_GATEWAY_CHAT` flags
have been removed. The older in-process runtime still supports deployments without native mode and its tests;
it is not used by production replies. The classic browser app retains its browser loop.

Pocket still owns job scheduling and delivery. Moving scheduling itself to OpenClaw, connecting the sandbox,
removing the remaining non-native runtime and profiling production cold starts are outstanding.

## Verification

`tools/pip-openclaw-native.test.mjs` runs the real gateway against a scripted model and a temporary database:
streaming, reads, cards, approve/decline, stop, steering, session reuse, research write restrictions, job scratch
notes, worker endpoint forwarding, phone-calendar waits, and training preferences and write restrictions.
Run on Node 24.16 or newer. The fixture does not contact a paid model or production accounts.
