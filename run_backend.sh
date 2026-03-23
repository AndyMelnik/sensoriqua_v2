#!/usr/bin/env bash
# Run Sensoriqua backend. Set SENSORIQUA_DSN for default DB (or use DSN in UI).
cd "$(dirname "$0")/backend"
uvicorn app.main:app --reload --port 8000
