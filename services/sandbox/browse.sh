#!/bin/sh
# browse inside a Pip sandbox account: a headless Chromium of the account's own, driven through browse's extension
# and relay. Everything is per account (profile, relay port, display), started on demand and kept under the account's
# home on the volume, so nothing is shared between two Pip accounts.
#
# The real binary is /usr/local/bin/browse-bin; this wrapper only makes sure there is a browser and a pairing first.
set -eu

BIN=/usr/local/bin/browse-bin
PAIR=/usr/local/bin/browse-pair.py
uid=$(id -u)
# The Unix user's home, not $HOME: an agent's exec runs with HOME set to its OpenClaw workspace, which can be
# recreated. The browser profile and the relay's pairing must live with the account and survive that.
home=$(getent passwd "$uid" | cut -d: -f6)
[ -n "$home" ] && [ -d "$home" ] && [ -w "$home" ] || home=${HOME:-/workspace/$(id -un)}
export HOME="$home"
state="$home/.browse"
log="$state/logs"
port=$((19990 + (uid % 8)))
cdp=$((9200 + (uid % 100)))
display=$((90 + (uid % 8)))
pair_marker="$state/paired"

# The unpacked extension's id comes from its install path, which is the same on every sandbox machine.
export OPENCODE_BROWSER_EXTENSION_ORIGINS=chrome-extension://lojchoakeilecchdlgcpblpieghlpnmk
# One relay port per account (browse's own fallback range); the extension is paired with this address.
export OPENCODE_BROWSER_PORT="$port"
export OPENCODE_BROWSER_AUTO_UPDATE=off

mkdir -p "$state" "$log"

running() {
  # pgrep -f matches the whole command line; the profile directory is unique to this account.
  pgrep -f -- "user-data-dir=$state/chromium" >/dev/null 2>&1
}

start_display() {
  [ -e "/tmp/.X11-unix/X$display" ] && return 0
  nohup Xvfb ":$display" -screen 0 1280x900x24 -nolisten tcp >"$log/xvfb.log" 2>&1 &
  for _ in $(seq 1 50); do [ -e "/tmp/.X11-unix/X$display" ] && return 0; sleep 0.1; done
  echo "browse: Xvfb :$display did not start (see $log/xvfb.log)" >&2
  return 1
}

start_browser() {
  running && return 0
  start_display
  DISPLAY=":$display" nohup chromium \
    --user-data-dir="$state/chromium" \
    --load-extension=/opt/browse-extension \
    --remote-debugging-port="$cdp" --remote-allow-origins='*' \
    --no-first-run --no-default-browser-check --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --disable-features=Translate,MediaRouter --disk-cache-size=67108864 \
    about:blank >"$log/chromium.log" 2>&1 &
  # The CDP endpoint answers only when the extension has loaded as well; that is what pairing needs.
  for _ in $(seq 1 150); do
    if curl -fsS --max-time 1 "http://127.0.0.1:$cdp/json/version" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  echo "browse: Chromium did not start (see $log/chromium.log)" >&2
  return 1
}

# A CLI call that needs no browser (status, version, pair) must not start one; mcp, tools and the page tools do.
case "${1:-}" in
  version|status|set|update|install|uninstall|extension) exec "$BIN" "$@" ;;
esac

start_browser

if [ ! -e "$pair_marker" ]; then
  DISPLAY=":$display" "$PAIR" "$port" "$cdp" >"$log/pair.log" 2>&1 || {
    cat "$log/pair.log" >&2
    echo "browse: pairing with the relay failed" >&2
    exit 1
  }
  : >"$pair_marker"
fi

exec "$BIN" "$@"
