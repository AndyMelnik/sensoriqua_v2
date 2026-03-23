#!/usr/bin/env bash
# Run Sensoriqua locally: backend + frontend (each in own terminal recommended)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Sensoriqua – starting backend and frontend..."
echo ""

# Backend
if ! lsof -i :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Starting backend on http://127.0.0.1:8000"
  (cd "$ROOT/backend" && source .venv/bin/activate 2>/dev/null || true && uvicorn app.main:app --reload --port 8000) &
  sleep 2
else
  echo "Backend already running on port 8000"
fi

# Frontend
echo "Starting frontend on http://localhost:5173"
(cd "$ROOT/frontend" && npm run dev)
