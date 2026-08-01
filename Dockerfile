# syntax=docker/dockerfile:1
# Production Dockerfile for Kairos Family App
# Builds the Next.js standalone output and serves it on port 3002.

FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.5 --activate

# Copy root workspace files and family app package.json
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches ./patches
COPY apps/family/package.json ./apps/family/

# Install dependencies (frozen lockfile ensures reproducibility)
RUN pnpm install --frozen-lockfile

# Copy family app source
COPY apps/family ./apps/family

# Build the Next.js app — NEXT_PUBLIC_API_URL is baked in at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter @kairos/family build

# ─────────────────────────────────────────────────────────────────────────────
# Production stage
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3002

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.5 --activate

# Copy only what's needed to run
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/patches ./patches
COPY --from=builder /app/apps/family ./apps/family

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

EXPOSE 3002

# Cloud Run health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["pnpm", "--filter", "@kairos/family", "start"]
