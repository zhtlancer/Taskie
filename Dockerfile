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

# Install production dependencies and recompile better-sqlite3 from source
# Use a locally compiled addon and verify it before publishing the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libstdc++6 \
    && npm install -g node-gyp \
    && npm ci --omit=dev --engine-strict \
    && rm -rf node_modules/better-sqlite3/prebuilds \
    && (cd node_modules/better-sqlite3 && node-gyp rebuild --release --force_build=1) \
    && node -e "const assert = require('node:assert/strict'); const Database = require('better-sqlite3'); const db = new Database(':memory:'); assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1); db.close();" \
    && npm uninstall -g node-gyp \
    && rm -rf /var/lib/apt/lists/*

# Copy backend application source code
COPY backend/src ./src

# Create alias link so node src/server.js works from /app or /app/backend
RUN ln -s /app/backend/src /app/src 2>/dev/null || true

# Copy built frontend assets from stage 1
COPY --from=frontend-builder /app/frontend/dist /app/public

# Create persistent storage directories
RUN mkdir -p /app/data /app/data/uploads

EXPOSE 3000

# Volume mount point for SQLite database and uploaded photos
VOLUME ["/app/data"]

WORKDIR /app/backend
CMD ["node", "src/server.js"]
