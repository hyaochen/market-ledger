FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app /app

RUN chmod +x docker-start.sh && mkdir -p /app/data

EXPOSE 3000

CMD ["./docker-start.sh"]

