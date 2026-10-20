#!/bin/sh
# Web container entrypoint (T-ML-037: runs the app as the unprivileged "node" user).
#
# The named volume market-ledger-data holds root-owned files from before this change, so the
# container must START as root, fix ownership of /app/data, then drop privileges and re-exec
# itself as "node". Everything below the privilege-drop block runs as node.
set -eu

DATA_DIR=/app/data

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # chown only when something under the data dir is not already owned by node (cheap check)
  if [ -n "$(find "$DATA_DIR" ! -user node -print -quit)" ]; then
    echo "[t_web] fixing ownership of $DATA_DIR (one-time after non-root switch)"
    chown -R node:node "$DATA_DIR"
  fi
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export DATABASE_URL="${DATABASE_URL:-file:/app/data/dev.db}"

echo "[t_web] running as $(id -un) (uid $(id -u))"

echo "[t_web] prisma db push"
node_modules/.bin/prisma db push --skip-generate

# First-run seed. Production refuses to seed without the *_PASSWORD env keys (see prisma/seed.ts),
# and .seeded is only written after a successful seed.
# A failed seed must NOT crash-loop the container (the app and existing data are still fine, and a
# restart loop would take the live site down for a missing env key); instead it logs loudly and is
# retried on the next container start, because .seeded is not written.
if [ ! -f "$DATA_DIR/.seeded" ]; then
  echo "[t_web] prisma seed (first run)"
  seed_rc=0
  node_modules/.bin/tsx prisma/seed.ts || seed_rc=$?
  if [ "$seed_rc" = "0" ]; then
    touch "$DATA_DIR/.seeded"
  else
    echo "[t_web] ############################################################" >&2
    echo "[t_web] SEED FAILED (exit $seed_rc) -- no users were created. Check the messages above." >&2
    echo "[t_web] .seeded NOT written; the seed will be retried on next container start." >&2
    echo "[t_web] ############################################################" >&2
  fi
fi

echo "[t_web] next standalone server on :${PORT}"
exec node server.js
