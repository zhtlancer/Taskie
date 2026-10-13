# ==========================================
# Stage 1: Build Frontend Assets
# ==========================================
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Production Container Runtime
# ==========================================
FROM node:20-bookworm-slim AS runner
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

# Install production dependencies (preserve required shared runtime libraries)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libstdc++6 \
    && npm install --omit=dev \
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
