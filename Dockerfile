# --- deps: install all dependencies (dev included; builder + bot both need them) ---
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# openssl MUST be present before npm ci / prisma generate,
# otherwise prisma detects the platform as debian-openssl-1.1.x and
# downloads mismatched engines (runtime then fails on 3.0.x lookup)
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

# --- builder: prisma generate + next build (standalone output) ---
FROM deps AS builder

COPY . .
RUN npx prisma generate
RUN npm run build

# --- runner: web (Next.js standalone) ---
FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# prisma engines need libssl on debian-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# prisma CLI + engines + generated client, for `npx prisma db push` in docker-start.sh
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

COPY docker-start.sh ./
RUN chmod +x docker-start.sh && mkdir -p /app/data

EXPOSE 3000

CMD ["./docker-start.sh"]

# --- bot: tsx long-running process (needs full node_modules incl. tsx) ---
FROM node:20-bookworm-slim AS bot

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json* tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY bot ./bot

RUN mkdir -p /app/data

CMD ["node_modules/.bin/tsx", "bot/index.ts"]
