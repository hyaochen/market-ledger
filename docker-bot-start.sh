#!/bin/sh
# Bot container entrypoint (T-ML-037): start as root only to fix ownership of the shared
# named volume, then run the Telegram bot as the unprivileged "node" user.
set -eu

DATA_DIR=/app/data

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  if [ -n "$(find "$DATA_DIR" ! -user node -print -quit)" ]; then
    echo "[bot] fixing ownership of $DATA_DIR"
    chown -R node:node "$DATA_DIR"
  fi
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

echo "[bot] running as $(id -un) (uid $(id -u))"
exec node_modules/.bin/tsx bot/index.ts
