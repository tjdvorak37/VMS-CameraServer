FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg curl

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create data directories
RUN mkdir -p data/recordings data/streams data/snapshots data/thumbnails

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "server.js"]
