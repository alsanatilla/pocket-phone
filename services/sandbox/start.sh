#!/bin/sh
# The host key and the one key allowed in come from Fly secrets, so they survive a new machine and Pocket's
# known_hosts stays valid. Nothing else is configured at start.
set -eu
[ -n "${SANDBOX_HOST_KEY:-}" ] || { echo "SANDBOX_HOST_KEY is not set" >&2; exit 1; }
[ -n "${SANDBOX_AUTHORIZED_KEY:-}" ] || { echo "SANDBOX_AUTHORIZED_KEY is not set" >&2; exit 1; }
umask 077
printf '%s\n' "$SANDBOX_HOST_KEY" > /etc/ssh/ssh_host_ed25519_key
mkdir -p /etc/ssh/authorized_keys
printf '%s\n' "$SANDBOX_AUTHORIZED_KEY" > /etc/ssh/authorized_keys/accounts
chmod 755 /etc/ssh/authorized_keys && chmod 644 /etc/ssh/authorized_keys/accounts
# The volume arrives owned by root.
# Keep other accounts' process arguments and environments out of /proc.
mount -o remount,hidepid=2 /proc
python3 /usr/local/bin/accounts.py
# sshd passes no secret on: its children start from a clean environment.
# The OAuth client is the machine's app identity, shared by every account on it, so it
# lives as a root-owned file that an account can read but not change.
if [ -n "${PIP_GOOGLE_CLIENT_JSON:-}" ]; then
  umask 022
  printf '%s' "$PIP_GOOGLE_CLIENT_JSON" > /etc/pip-google-client.json
  chmod 644 /etc/pip-google-client.json
fi
# pip-image's shared token: the sandbox proves itself to Pocket's /api/pip/media with it.
if [ -n "${PIP_IMAGE_TOKEN:-}" ]; then
  printf '%s' "$PIP_IMAGE_TOKEN" > /etc/pip-image-token
  chmod 644 /etc/pip-image-token
fi
unset SANDBOX_HOST_KEY SANDBOX_AUTHORIZED_KEY SANDBOX_ACCOUNTS PIP_GOOGLE_CLIENT_JSON PIP_IMAGE_TOKEN
exec /usr/sbin/sshd -D -e
