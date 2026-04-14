FROM node:20-bookworm-slim

# Install runtime dependencies used by the backend and healthcheck.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source
COPY . .

# Install production dependencies in-image so native modules match this runtime.
RUN rm -rf node_modules \
  && npm_config_build_from_source=true npm ci --omit=dev

# Create data directories
RUN mkdir -p data/recordings data/streams data/snapshots data/thumbnails

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "server.js"]
