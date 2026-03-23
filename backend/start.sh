#!/usr/bin/env bash
# Start the API server. Uses PORT from environment (e.g. Render sets PORT=10000); default 8000 locally.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
