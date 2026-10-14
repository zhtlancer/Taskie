# ==========================================
# Stage 1: Build Frontend Assets
# ==========================================
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Production Container Runtime
# ==========================================
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/data.sqlite \
    UPLOAD_DIR=/app/data/uploads \
    CLIENT_DIST_DIR=/app/public

# Copy backend dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend

# Use official native prebuilds without installing a compiler toolchain.
# npm can implicitly run node-gyp for binding.gyp; skip install scripts and
# verify both native dependencies on each target architecture before publishing.
RUN npm ci --omit=dev --engine-strict --ignore-scripts \
    && npm cache clean --force \
    && node -e "const assert = require('node:assert/strict'); const Database = require('better-sqlite3'); const db = new Database(':memory:'); assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1); db.close();" \
    && node -e "const assert = require('node:assert/strict'); const sharp = require('sharp'); sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).resize(8, 8).webp().toBuffer({ resolveWithObject: true }).then(({ data, info }) => { assert.ok(data.length > 0); assert.equal(info.format, 'webp'); assert.equal(info.width, 8); assert.equal(info.height, 8); }).catch(err => { console.error(err); process.exit(1); });"

# Copy backend application source code
COPY backend/src ./src

# Create alias link so node src/server.js works from /app or /app/backend
RUN ln -s /app/backend/src /app/src 2>/dev/null || true

# Copy built frontend assets from stage 1
COPY --from=frontend-builder /app/frontend/dist /app/public

# Create persistent storage directories
RUN mkdir -p /app/data /app/data/uploads

# Start as root only to hand /app/data to PUID:PGID (default 1000, the image's node user),
# then run the app unprivileged; see docker-entrypoint.sh.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# Volume mount point for SQLite database and uploaded photos
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

WORKDIR /app/backend
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
