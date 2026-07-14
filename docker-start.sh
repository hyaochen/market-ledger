#!/bin/sh
set -eu

export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export DATABASE_URL="${DATABASE_URL:-file:/app/data/dev.db}"

mkdir -p /app/data

echo "[t_web] prisma db push"
npx prisma db push --skip-generate

if [ ! -f /app/data/.seeded ]; then
  echo "[t_web] prisma seed (first run)"
  npx prisma db seed || true
  touch /app/data/.seeded
fi

echo "[t_web] next standalone server on :${PORT}"
exec node server.js
