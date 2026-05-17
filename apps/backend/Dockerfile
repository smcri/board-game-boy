# Multi-stage Node 20 Alpine build for the backend.
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.0.0

# Copy root config
COPY pnpm-workspace.yaml tsconfig.base.json package.json pnpm-lock.yaml* ./

# Copy packages
COPY packages/shared ./packages/shared

# Copy apps/backend
COPY apps/backend ./apps/backend

# Install dependencies
# Note: pnpm install without --frozen-lockfile since this is MVP without committed lockfile
RUN pnpm install

# Build
RUN pnpm --filter @bgb/backend build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.0.0

# Copy only necessary files from builder
COPY --from=builder /app/pnpm-workspace.yaml /app/tsconfig.base.json /app/package.json ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/backend ./apps/backend

# Create data directory
RUN mkdir -p /data /data/bundles

# Set environment defaults for HF Spaces / DigitalOcean
ENV PORT=7860
ENV DATA_DIR=/data
ENV BUNDLES_DIR=/data/bundles
ENV LOG_LEVEL=info

EXPOSE 7860

CMD ["node", "apps/backend/dist/index.js"]
