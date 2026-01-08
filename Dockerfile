FROM node:20-bookworm-slim AS base

# ═══════════════════════════════════════════════════════════════════════════
# SCRIPTFLOW BACKEND - Production Dockerfile
# Optimized for t3.micro (1GB RAM) with security hardening
# ═══════════════════════════════════════════════════════════════════════════

# Security: Set labels for image metadata
LABEL maintainer="ScriptFlow Team"
LABEL version="2.0.0"
LABEL description="ScriptFlow AI Script Generation Backend"

# Install system dependencies: Python (for yt-dlp), FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python-is-python3 \
    ffmpeg \
    curl \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install yt-dlp globally (pinned version for stability)
ARG YT_DLP_VERSION=2024.12.13
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

WORKDIR /app

# Create directories with proper permissions
RUN mkdir -p temp/.cache temp/.config data logs fonts \
    && chown -R node:node /app

# Set HOME to writable temp directory (prevents read-only filesystem errors)
ENV HOME=/app/temp

# ═══════════════════════════════════════════════════════════════════════════
# DEPENDENCIES STAGE
# ═══════════════════════════════════════════════════════════════════════════

COPY --chown=node:node package*.json ./

# Install production dependencies only (smaller image)
RUN npm ci --omit=dev && npm cache clean --force

# ═══════════════════════════════════════════════════════════════════════════
# BUILD STAGE
# ═══════════════════════════════════════════════════════════════════════════

COPY --chown=node:node . .

# Build TypeScript
RUN npm run build

# Remove TypeScript source (not needed in production)
RUN rm -rf src tsconfig.json

# ═══════════════════════════════════════════════════════════════════════════
# PRODUCTION CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

# Security: Switch to non-root user
USER node

# Memory configuration for t3.micro (1GB RAM)
# Heap limit: 512MB, leaving 512MB for OS + FFmpeg + yt-dlp
ENV NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
ENV NODE_ENV=production
ENV MEMORY_HEAP_LIMIT_MB=512

# Port configuration
ENV PORT=3000
EXPOSE 3000

# Health check with proper timeout for slow starts
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Use dumb-init to handle signals properly (prevents zombie processes)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
