# Sensoriqua 2 — Configuration

Environment variables and deployment options.

---

## Backend environment variables

Set these in **`backend/.env`** (never commit this file). Copy from **`backend/.env.example`**.

| Variable | Description |
|----------|-------------|
| **SENSORIQUA_DSN** | PostgreSQL connection string for telematics/business data (e.g. `postgresql://user:password@host:port/database?sslmode=require`). Used when no JWT and no `X-Sensoriqua-DSN` header. |
| **JWT_SECRET** | Optional. If set and at least 32 characters, enables Navixy App Connect: `POST /api/auth/login`, Bearer auth, per-user DSNs. Generate with e.g. `openssl rand -hex 32`. |
| **CORS_ORIGINS** | Comma-separated list of allowed frontend origins (e.g. `https://app.example.com,https://admin.example.com`). When set, credentials are allowed and wildcard is not used. When empty, backend uses `allow_origins=["*"]` and `allow_credentials=False`. |
| **ALLOW_FRAME_ORIGINS** | Iframe embedding. Empty = `frame-ancestors *`. Comma-separated origins = restrict to those. `deny` = `X-Frame-Options: DENY`. |
| **ALLOW_PRIVATE_DSN** | Set to `1`, `true`, or `yes` only in trusted environments to allow login DSNs to localhost/private IPs. Default: not set (blocked for SSRF mitigation). |
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
