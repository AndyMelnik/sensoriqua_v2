#!/usr/bin/env bash
# Build frontend and copy to backend/static (same as Render deploy).
# Run from repo root: ./scripts/build-for-render.sh
# Optional: commit backend/static/ and use a simpler Render build (backend only) if you prefer.
set -e
cd "$(dirname "$0")/.."
echo "Building frontend..."
cd frontend
npm ci
npm run build
echo "Copying dist to backend/static..."
mkdir -p ../backend/static
cp -r dist/* ../backend/static/
echo "Done. backend/static/ is ready. Start backend with: cd backend && uvicorn app.main:app --host 0.0.0.0 --port \$PORT"
