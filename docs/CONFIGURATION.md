# Sensoriqua 2 — Configuration

Environment variables and deployment options.

---

## Backend environment variables

Set these in **`backend/.env`** (never commit this file). Copy from **`backend/.env.example`**.

| Variable | Description |
|----------|-------------|
| **SENSORIQUA_DSN** | PostgreSQL connection string for telematics/business data (e.g. `postgresql://user:password@host:port/database?sslmode=require`). Used in standalone mode (no JWT). |
| **JWT_SECRET** | Optional. If set and at least 32 characters, enables Navixy App Connect: `POST /api/auth/login`, Bearer auth, per-user DSNs. Generate with e.g. `openssl rand -hex 32`. |
| **LOGIN_API_KEY** | **Required** with JWT on public deploys. `POST /api/auth/login` requires header `X-Sensoriqua-Login-Key`. |
| **ALLOW_OPEN_LOGIN** | Only on trusted private networks: allow login without `LOGIN_API_KEY` (default off). |
| **REQUIRE_AUTH** | If `1`, process exits unless `JWT_SECRET` ≥ 32 chars (recommended on public internet). |
| **LOGIN_RATE_LIMIT_PER_MINUTE** | Max login attempts per client IP per minute (default `30`). |
| **TRUST_PROXY** | Set to `1` only behind a reverse proxy that sets/overwrites `X-Forwarded-For` (use on Render). |
| **ENABLE_OPENAPI** | `1` to expose `/docs`; default off when JWT is enabled. |
| **CREDENTIALS_ENCRYPTION_KEY** | Optional ≥32-char key to encrypt stored App Connect DSNs (falls back to `JWT_SECRET`). |
| **CREDENTIALS_MAX_ENTRIES** | Max stored App Connect sessions (default `1000`; oldest pruned). |
| **SENSORIQUA_CREDENTIALS_PATH** | Optional path to persist App Connect DSNs across restarts (default `backend/sensoriqua_credentials.json`, gitignored). |
| **CORS_ORIGINS** | Comma-separated list of allowed frontend origins. When **JWT_SECRET** is set and this is empty, cross-origin browser API calls are blocked (same-origin static GUI still works). When JWT is off and empty, uses `allow_origins=["*"]` with `allow_credentials=False`. |
| **ALLOW_FRAME_ORIGINS** | Iframe embedding. Empty = `frame-ancestors *`. Comma-separated origins = restrict to those. `deny` = `X-Frame-Options: DENY`. |
| **ALLOW_PRIVATE_DSN** | Set to `1`, `true`, or `yes` only in trusted environments to allow login/client DSNs to localhost/private IPs (checked after DNS resolve on login and on every connect). Operator `SENSORIQUA_DSN` is always allowed. Default: not set (blocked for untrusted DSNs). Connect always pins libpq `hostaddr` to the resolved IP. |
| **ALLOW_CLIENT_DSN** | Standalone only. Opt-in: accept `X-Sensoriqua-DSN` from the client (default off — avoids client choosing the DB). |
| **ALLOW_CLIENT_USER_ID** | Standalone only. Opt-in: accept `?user_id=` from the client (default off — avoids IDOR). |
| **SENSORIQUA_USER_ID** | Default user ID when no auth (default `1`). |
| **SENSORIQUA_APP_STATE_DSN** | Optional. App state database: PostgreSQL URL or SQLite (e.g. `sqlite:///./sensoriqua_state.db`). If not set, backend uses SQLite at `sensoriqua_state.db` when not using Navixy. |
| **SENSORIQUA_SQLITE_TIMEOUT** | Seconds to wait for SQLite lock (default `10`). Used for app state SQLite. |
| **SENSORIQUA_TAG_ENTITY_TYPE_OBJECT** | Integer entity type for object/tracker in `tag_links` (default `1`). |
| **SENSORIQUA_TAG_ENTITY_TYPE_VEHICLE** | Optional. Entity type for vehicle in `tag_links`. When set (default `2`), tags on vehicles resolve via `vehicles.object_id` to include those objects. Set empty to disable. |
| **SENSORIQUA_TAG_ENTITY_TYPE_EMPLOYEE** | Optional. Entity type for employee in `tag_links`. When set (default `3`), tags on employees resolve via `employees.object_id`. Set empty to disable. |

---

## Frontend environment

| Variable | Description |
|----------|-------------|
| **VITE_API_URL** | Backend base URL. If unset, the app uses relative `/api` (same-origin or dev proxy). For production on a different host, set e.g. `https://api.example.com`. |
| **VITE_ALLOW_CLIENT_DSN** | Opt-in: send `X-Sensoriqua-DSN` from the browser. Requires backend **ALLOW_CLIENT_DSN=1**. Default: off. |

---

## App state (configured sensors & dashboard)

- **With Navixy:** App state is stored in the database pointed to by **userDbUrl** (per user).  
- **Without Navixy:**  
  - If **SENSORIQUA_APP_STATE_DSN** is set → that database (Postgres or SQLite).  
  - If not set → SQLite at **backend/sensoriqua_state.db** (created automatically; WAL mode and busy timeout for concurrency).  
- **Dashboard groups** (group labels and which panel belongs to which group) are stored in the frontend (localStorage) and in exported dashboard JSON; they are restored on load and on import.

When the backend cannot read/write app state (e.g. 503), the frontend falls back to **localStorage** for configured sensors and dashboard; the UI shows "Saved in this browser".

---

## Production checklist

1. Set **CORS_ORIGINS** to your real frontend origin(s).  
2. Set **ALLOW_FRAME_ORIGINS=deny** (or a strict list) if you do not want iframe embedding.  
3. Use a strong **JWT_SECRET** if using Navixy App Connect.  
4. Run behind HTTPS; do not commit **.env**.  
5. Optional: use **SENSORIQUA_APP_STATE_DSN** with a dedicated Postgres database for app state in multi-instance deployments.

---

## Single-URL deploy (e.g. Render)

1. Build frontend: `cd frontend && npm run build`.  
2. Copy assets into backend: `cp -r dist/* ../backend/static/`.  
3. Start backend with `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}`.  
4. Backend serves `/` and `/assets/*` from `static/` and API at `/api/*`.  

See [RENDER.md](RENDER.md) for platform-specific steps.
