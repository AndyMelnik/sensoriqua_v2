#!/usr/bin/env bash
# Build frontend and copy to backend/static (same as Render deploy).
# Run from repo root: ./scripts/build-for-render.sh
set -e
cd "$(dirname "$0")/.."
echo "Building frontend..."
cd frontend
npm ci
npm run build
echo "Replacing backend/static with fresh dist..."
rm -rf ../backend/static
mkdir -p ../backend/static
cp -a dist/. ../backend/static/
echo "Done. backend/static/ is ready. Start backend with: cd backend && uvicorn app.main:app --host 0.0.0.0 --port \$PORT"
