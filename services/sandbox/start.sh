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
unset SANDBOX_HOST_KEY SANDBOX_AUTHORIZED_KEY SANDBOX_ACCOUNTS
exec /usr/sbin/sshd -D -e
