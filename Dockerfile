# syntax=docker/dockerfile:1
# Production Dockerfile for Trellis.
# Builds the Next.js app and serves it on port 3002.

FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.5 --activate

COPY package.json pnpm-lock.yaml ./

# Install dependencies (frozen lockfile ensures reproducibility)
RUN pnpm install --frozen-lockfile

# Copy app source
COPY . .

# Build the Next.js app — NEXT_PUBLIC_API_URL is baked in at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm build

# ─────────────────────────────────────────────────────────────────────────────
# Production stage
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3002

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.5 --activate

# Copy only what's needed to run
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

EXPOSE 3002

# Cloud Run health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["pnpm", "start"]
