#!/bin/sh
# The Fly volume arrives root-owned; Pocket runs as node. Prepare the gateway's home, then hand over.
set -e
if [ -d /data ]; then
  mkdir -p /data/openclaw
  chown -R node:node /data
fi
exec gosu node "$@"
