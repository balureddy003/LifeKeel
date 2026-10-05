# syntax=docker/dockerfile:1
# Production Dockerfile for LifeKeel API Server
# Builds all workspace packages and starts the compiled API server.

FROM node:22-alpine AS builder

WORKDIR /app

# Install native build tools for node-gyp (better-sqlite3, etc.)
# py3-setuptools provides distutils, removed from Python 3.12+ stdlib
RUN apk add --no-cache python3 make g++ py3-setuptools

# Enable pnpm via corepack — pin to the project's packageManager version
# (pnpm@latest resolves to v11+ which requires Node.js v22.13+, but this
# image is Node.js v20. Pinning avoids the ERR_UNKNOWN_BUILTIN_MODULE crash.)
RUN corepack enable && corepack prepare pnpm@8.15.5 --activate

# Copy the whole repo (excluding .dockerignore patterns) and install dependencies.
# The .dockerignore already excludes node_modules, dist, .env, .git, etc.
COPY . .
RUN pnpm install --frozen-lockfile

# Build workspace packages and the API
RUN pnpm exec turbo run build --filter=@lifekeel/api

# ─────────────────────────────────────────────────────────────────────────────
# Production stage — keeps only runtime files and production dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Native build tools are required for better-sqlite3 even in the prod stage
# because we re-install dependencies here (pnpm --prod) rather than copying
# the builder's node_modules wholesale.
RUN apk add --no-cache python3 make g++ py3-setuptools py3-pip

# Tesseract for local document OCR (apps/api/src/ocr/local-ocr.ts). Used only when
# LOCAL_JUDGE_BASE_URL is set, so uploaded documents are read in-process instead of
# being sent to a cloud vision model. NOT build-tested here; verify the image once.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng

# fontconfig + DejaVu — the /share/readiness/og.png route rasterizes SVG text
# via sharp/librsvg; Alpine ships zero fonts, so digits would render blank
# without these.
RUN apk add --no-cache fontconfig ttf-dejavu

# Install yfinance + pandas for the yfinance market-data connector
# (scripts/fetch-yfinance.py). Required by the momentum engine to fetch
# 252-day price history for portfolio tickers. No API key needed — yfinance
# uses Yahoo Finance's public endpoints.
#
# tzdata is required because Alpine's Python 3.12 ships without the IANA
# timezone database. yfinance calls pandas .tz_localize('America/New_York')
# which raises ZoneInfoNotFoundError without tzdata installed.
RUN pip3 install --no-cache-dir --break-system-packages yfinance pandas tzdata

RUN corepack enable && corepack prepare pnpm@8.15.5 --activate

# Copy root package files, workspace package.json + built dist files, and pnpm patches.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/category-table.yaml ./category-table.yaml
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages

# Copy on-disk YAML resource directories that the engine and loaders read at
# runtime via path.join(ROOT, ...). Without these, the detector engine silently
# boots with zero detectors, connectors don't load, workflows/outcome-packs/
# verticals are empty — the entire signal-generation half of the product stops.
COPY --from=builder /app/detectors ./detectors
COPY --from=builder /app/connectors ./connectors
COPY --from=builder /app/playbooks ./playbooks
COPY --from=builder /app/detector-evals ./detector-evals
COPY --from=builder /app/verticals ./verticals

# Copy the yfinance Python bridge so the yfinance connector can invoke it
# via execFile. The connector sync engine calls `scripts/fetch-yfinance.py`
# for the DailyHistory and Fundamentals resources.
COPY --from=builder /app/scripts ./scripts

# Install only production dependencies (workspace packages are resolved from the
# copied package.json files and their pre-built dist directories).
# The root "prepare" script runs husky (a devDependency), which is absent under --prod and
# fails the install. Git hooks are meaningless in an image, so drop the script first.
RUN pnpm pkg delete scripts.prepare && pnpm install --frozen-lockfile --prod

EXPOSE 3001

# Run as non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs
USER nodejs

# Cloud Run health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "apps/api/dist/server.js"]