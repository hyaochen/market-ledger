#!/bin/sh
set -eu

PORT="${PORT:-3000}"
export DATABASE_URL="${DATABASE_URL:-file:/app/data/dev.db}"

mkdir -p /app/data

echo "[t_web] prisma db push"
npx prisma db push --skip-generate

if [ ! -f /app/data/.seeded ]; then
  echo "[t_web] prisma seed (first run)"
  npx prisma db seed || true
  touch /app/data/.seeded
fi

echo "[t_web] next start on :${PORT}"
npx next start -H 0.0.0.0 -p "${PORT}"
