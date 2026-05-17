# ────────────────────────────────────────────────────────────────────────────
# Board Game Builder — Dockerfile
# Runs the Fastify backend on port 7860 (Hugging Face Spaces default).
# The static UI is built separately and served via GitHub Pages.
#
# Build:
#   docker build -t board-game-builder .
# Run locally:
#   docker run -p 7860:7860 -v $(pwd)/.data:/data board-game-builder
# ────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/scaffold/package.json apps/scaffold/
# Install production deps only (skip UI — not served from here)
RUN pnpm install --frozen-lockfile --filter @bgb/shared --filter @bgb/backend --filter @bgb/scaffold

# ── Build shared + backend ────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/backend/ apps/backend/
COPY apps/scaffold/ apps/scaffold/
RUN pnpm --filter @bgb/shared build && \
    pnpm --filter @bgb/backend build

# ── Runtime image ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN npm install -g pnpm@9
WORKDIR /app

# Copy built artefacts + node_modules
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/backend ./apps/backend
COPY --from=build /app/apps/scaffold ./apps/scaffold
COPY package.json pnpm-workspace.yaml ./

# Persistent storage for SQLite + bundles (mount as a volume in production)
VOLUME /data

# ── Environment defaults ──────────────────────────────────────────────────────
# PORT=7860 is required by Hugging Face Spaces.
ENV PORT=7860
# DATA_DIR and BUNDLES_DIR use the HF persistent /data volume.
ENV DATA_DIR=/data
ENV BUNDLES_DIR=/data/bundles
# Allow all UI origins — the HF Space URL is not known at build time.
# Override with a specific origin list for tighter security.
ENV ALLOWED_ORIGINS=*
# Log level
ENV LOG_LEVEL=info

EXPOSE 7860

# Healthcheck — HF Spaces uses this to determine readiness
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:7860/healthz || exit 1

CMD ["node", "apps/backend/dist/index.js"]
