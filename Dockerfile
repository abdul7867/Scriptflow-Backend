FROM node:20-bookworm-slim

# Install system dependencies: Python (for yt-dlp), FFmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    python-is-python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Create temp dir with cache/config subdirectories for yt-dlp
RUN mkdir -p temp/.cache temp/.config data && chown -R node:node /app

# Set HOME to writable temp directory to prevent read-only filesystem errors
ENV HOME=/app/temp

COPY package*.json ./

# Install npm dependencies
RUN npm ci

COPY . .

# Build TypeScript
RUN npm run build

# Ensure permissions for the entire app directory
RUN chown -R node:node /app

# Switch to non-root
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD ["npm", "start"]
