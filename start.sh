#!/usr/bin/env bash
WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$WORKDIR/logs"

# Clean up any existing instances from recorded PIDs or matching ports
if [ -f "$WORKDIR/logs/backend.pid" ]; then
  BPID=$(cat "$WORKDIR/logs/backend.pid")
  if [ -n "$BPID" ]; then kill -9 "$BPID" 2>/dev/null || true; fi
  rm -f "$WORKDIR/logs/backend.pid"
fi
if [ -f "$WORKDIR/logs/frontend.pid" ]; then
  FPID=$(cat "$WORKDIR/logs/frontend.pid")
  if [ -n "$FPID" ]; then kill -9 "$FPID" 2>/dev/null || true; fi
  rm -f "$WORKDIR/logs/frontend.pid"
fi

# 1. Start backend detached with setsid & redirect stdin from /dev/null
cd "$WORKDIR/backend"
setsid node src/server.js </dev/null > "$WORKDIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$WORKDIR/logs/backend.pid"

# 2. Start frontend detached with setsid & redirect stdin from /dev/null
cd "$WORKDIR/frontend"
setsid ./node_modules/.bin/vite --host 0.0.0.0 --port 5173 </dev/null > "$WORKDIR/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$WORKDIR/logs/frontend.pid"

echo "Backend started (PID: $BACKEND_PID)"
echo "Frontend started (PID: $FRONTEND_PID)"
