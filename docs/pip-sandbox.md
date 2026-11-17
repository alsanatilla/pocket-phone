# Pip workspace on Fly

Native gateway integration is configured in `services/gateway/sandbox.mjs` and `config.mjs`.
Each explicitly provisioned account gets an OpenClaw agent, its own local workspace, and an SSH sandbox
with agent scope so files survive across chats. Sessions route by the authenticated account, not model input.
Unprovisioned accounts retain chat tools only. The old in-process adapter remains solely for non-native deployments.

The gateway uses OpenClaw's SSH backend directly. Host keys are pinned, credentials are supplied from existing
Fly secrets, elevated execution is disabled, and the plugin blocks requests to exec on the gateway or a node.
OpenClaw creates its remote workspace below `/workspace/<account>/openclaw`; existing files elsewhere in the
account directory are not deleted. SSH workspaces are seeded once; subsequent remote edits are not automatically
copied to the local workspace. Each provisioned account starts a separate agent session and memory workspace;
the old shared agent files are retained rather than copied across accounts.

Run `node services/gateway/check-sandbox.mjs` in the deployed Pocket image to verify actual gateway exec,
Unix account isolation, absence of Pocket credentials, and file persistence between two fresh chats. It creates
and deletes one uniquely named marker. This uses two real model turns and does not change Pocket records.


## Browse in every account

The sandbox image ships [browse](https://opencode.ai/product/browse) so an agent working in an account can drive a
real Chromium: its relay/MCP server, the unpacked extension (`/opt/browse-extension`, id
`lojchoakeilecchdlgcpblpieghlpnmk`), Chromium and Xvfb. `/usr/local/bin/browse` is a wrapper around the real
`browse-bin`; it starts, on demand and once per account, an Xvfb display and a Chromium profile under
`/workspace/<account>/.browse` (the Unix home, not the agent workspace, which is recreated), then pairs the extension
with that account's relay on first use.

Everything is per account: the profile (and the extension's pairing key), the relay port
(`19990 + uid % 8`) and the DevTools port (`9200 + uid % 100`) live in the account's home on the volume, so one
account's browser and cookies are invisible to another. Nothing starts at boot; a browser costs ~250 MB only while
that account uses it, which is why the machine has 2 GB. Auto-update is off so a running sandbox does not change
under an agent.

The browser is fresh and unauthenticated: it has no person's logins, and browse handoffs (a login, 2FA, a captcha)
need a person at the keyboard, so an agent should use it for public pages and for automation, not for accounts that
belong to someone. Pairing is automatic; `~/.browse/logs/` holds the Chromium, Xvfb and pairing logs, and deleting
`~/.browse/paired` makes the next call pair again.

## Existing sandbox provisioning


Pocket's server chat and scheduled reports offer OpenClaw's native `exec`, `read`,
`write`, `edit`, and `apply_patch` tools to provisioned accounts. Assignments retain
their existing restricted tool surface. The tools come from the public async
coding-tool factory and use OpenClaw's remote-shell backend with its SSH transport
and filesystem bridge. There are no Pocket implementations of a shell or editor.

`pocket-pip-sandbox` is a separate Fly app in Frankfurt, reachable on the private
network at port 2222. Fly's administrative SSH retains port 22. The sandbox has a
persistent volume, Python (including pandas/numpy/matplotlib), Node, git, curl and
SQLite. Outbound internet is enabled. It has no Pocket database, encryption or
model-provider credentials.

Each provisioned Pocket account maps to a deterministic opaque Unix username and
`/workspace/<username>`, mode 0700. User IDs are deterministic across redeploys;
collisions fail provisioning. `/proc` uses `hidepid=2` so accounts cannot inspect
each other's process arguments. The workspace persists across chats. File tools
use OpenClaw's workspace containment checks. Exec always uses the remote sandbox,
even if a model requests a gateway or elevated host. Remote environment variables
are an explicit small allowlist, and no Pocket process environment is forwarded.
Commands run in the foreground for at most 60 seconds and obey run cancellation.
Root/password login, SSH forwarding and user-supplied SSH environment are disabled.

The Pocket server uses 2 GB RAM: OpenClaw's coding tools add about 400 MB to the web
process when they are loaded, and the worker runs beside it. The sandbox uses 512 MB
and a 1 GB volume. Neither is configured to stop automatically.
This is a shared VM with separate Unix accounts, not a VM per tenant.

Configuration (Fly secrets; never commit the values):

- Sandbox: `SANDBOX_HOST_KEY`, `SANDBOX_AUTHORIZED_KEY`, `SANDBOX_ACCOUNTS`.
- Pocket: `PIP_SANDBOX_SSH_KEY`, `PIP_SANDBOX_KNOWN_HOSTS`, `PIP_SANDBOX_ACCOUNTS`.
- The account lists contain comma-separated `sandboxAccount(userId)` values.
- Known hosts uses the alias `pocket-pip-sandbox`, with the pinned server host key.
- Optional `PIP_SANDBOX_HOST` and `PIP_SANDBOX_PORT` are administrator settings,
  useful for an SSH proxy during tests. They are never supplied by the model.

To enable a new account, add its hash to both account lists, restart/deploy the
sandbox to create its Unix user, then update Pocket. Unprovisioned accounts get no
sandbox tools. This explicit provisioning also avoids accidental access by test
accounts or newly registered users. Rotate credentials by deploying the sandbox
public key and Pocket private key together; host-key mismatches fail closed.

Deploy the sandbox from `services/sandbox` using `fly deploy --ha=false`. Deploy
Pocket from the repository root with the same command. The production image
includes the SSH client. `node services/sandbox/check.mjs` in Pocket's deployed
image exercises the real OpenClaw tools, cross-chat persistence, file confinement,
account directory permissions, credential-free environment and outbound HTTPS.
It creates and removes only a uniquely named diagnostic file.

Workspace files are not automatically Pocket notes or downloadable attachments.
Saving notes/tasks still goes through the existing Pocket approval flow.
