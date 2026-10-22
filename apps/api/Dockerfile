# syntax=docker/dockerfile:1
# Production Dockerfile for LifeKeel API Server
# Builds all workspace packages and starts the compiled API server.
#
# R31: the base image is digest-pinned (Dependabot's docker ecosystem keeps
# it current), and compilers stay in the build stages: the runtime image
# carries only Node, the compiled app, production node_modules and the OCR
# and font packages it calls at runtime.

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder

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
# Production dependencies — native modules (better-sqlite3) compile here, with
# the build tools, so the runtime stage never needs them.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS prod-deps

WORKDIR /app
RUN apk add --no-cache python3 make g++ py3-setuptools
RUN corepack enable && corepack prepare pnpm@8.15.5 --activate

# Copy root package files, workspace package.json + built dist files, and pnpm patches.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages

# Install only production dependencies (workspace packages are resolved from the
# copied package.json files and their pre-built dist directories).
# The root "prepare" script runs husky (a devDependency), which is absent under --prod and
# fails the install. Git hooks are meaningless in an image, so drop the script first.
RUN pnpm pkg delete scripts.prepare && pnpm install --frozen-lockfile --prod

# ─────────────────────────────────────────────────────────────────────────────
# Runtime stage
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Tesseract for local document OCR (apps/api/src/ocr/local-ocr.ts). Used only when
# LOCAL_JUDGE_BASE_URL is set, so uploaded documents are read in-process instead of
# being sent to a cloud vision model.
# fontconfig + DejaVu — the /share/readiness/og.png route rasterizes SVG text
# via sharp/librsvg; Alpine ships zero fonts, so digits would render blank
# without these.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng fontconfig ttf-dejavu

COPY --from=prod-deps /app ./
COPY --from=builder /app/category-table.yaml ./category-table.yaml

# Copy on-disk YAML resource directories that the engine and loaders read at
# runtime via path.join(ROOT, ...). Without these, the detector engine silently
# boots with zero detectors, connectors don't load, workflows/outcome-packs/
# verticals are empty — the entire signal-generation half of the product stops.
COPY --from=builder /app/detectors ./detectors
COPY --from=builder /app/connectors ./connectors
COPY --from=builder /app/definitions ./definitions
COPY --from=builder /app/playbooks ./playbooks
COPY --from=builder /app/detector-evals ./detector-evals
COPY --from=builder /app/verticals ./verticals

EXPOSE 3001

# Run as non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs
USER nodejs

# Cloud Run health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "apps/api/dist/server.js"]