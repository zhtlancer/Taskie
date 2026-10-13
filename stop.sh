#!/usr/bin/env bash
WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$WORKDIR/logs/backend.pid" ]; then
  BPID=$(cat "$WORKDIR/logs/backend.pid")
  if [ -n "$BPID" ]; then
    kill "$BPID" 2>/dev/null && echo "Stopped backend (PID: $BPID)" || echo "Backend process $BPID not running"
    rm -f "$WORKDIR/logs/backend.pid"
  fi
fi

if [ -f "$WORKDIR/logs/frontend.pid" ]; then
  FPID=$(cat "$WORKDIR/logs/frontend.pid")
  if [ -n "$FPID" ]; then
    kill "$FPID" 2>/dev/null && echo "Stopped frontend (PID: $FPID)" || echo "Frontend process $FPID not running"
    rm -f "$WORKDIR/logs/frontend.pid"
  fi
fi
