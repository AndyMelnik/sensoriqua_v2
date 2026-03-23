# Sensoriqua 2 — Architecture

High-level technical overview of the application.

---

## Stack

| Layer      | Technology |
|-----------|-------------|
| Backend   | Python 3.10+, FastAPI, uvicorn |
| API       | REST, JSON; OpenAPI at `/docs` |
| Database  | PostgreSQL (telematics + business data); optional PostgreSQL or SQLite for app state |
| Frontend  | React 19, TypeScript, Vite 7 |
| Build     | Vite (frontend); static assets can be served from `backend/static/` for single-URL deploy |

---

## Data flow

1. **Data sources (read-only)**  
   - **PostgreSQL** with schemas `raw_business_data` and `raw_telematics_data`: objects, groups, tags, sensors, inputs, states, tracking_data_core.  
   - DSN comes from: JWT (Navixy App Connect), `X-Sensoriqua-DSN` header, or `SENSORIQUA_DSN` env.

2. **App state (configured sensors, dashboard layout)**  
   - **PostgreSQL** (e.g. `app_sensoriqua` schema) when using Navixy or when `SENSORIQUA_APP_STATE_DSN` points to Postgres.  
   - **SQLite** by default when not using Navixy (`sensoriqua_state.db` in backend, or path from `SENSORIQUA_APP_STATE_DSN`).  
   - **Frontend localStorage** when the backend returns 503 for app state (configured list, dashboard planes, dashboard groups and assignments). Grouping (group_id, group labels) is also stored in localStorage and in exported dashboard JSON.

3. **Auth**  
   - **Standalone:** No auth; optional `user_id` query and `X-Sensoriqua-DSN` header.  
   - **Navixy App Connect:** `POST /api/auth/login` returns JWT; backend stores per-user DSNs and uses Bearer token for all `/api/*` requests.

---

## Backend layout

- **`app/main.py`** — FastAPI app, CORS, security headers, routes (groupings, objects, sensors, configured sensors, dashboard planes, sparklines, sensor history, latest values, auth). Serves `backend/static/` when present.
- **`app/db.py`** — Connection helpers for Postgres (telematics/business) and app state (Postgres or SQLite); table name resolution; SQLite WAL and busy timeout.
- **`app/auth.py`** — JWT create/verify, credential storage, request context (DSN, user_id).

Schema names and table names used in SQL are fixed or derived from `app_state_table()` (e.g. `app_sensoriqua.configured_sensors` or SQLite `configured_sensors`). User input is passed only as parameters, not concatenated into SQL.

---

## Frontend layout

- **`App.tsx`** — Root component: tabs (Dashboards / Reports), left panel (steps 1–4 in Reports), configured sensors, dashboard grid (with grouping), report chart and tables, modals (config, group, export, confirm, history, debug).
- **`api.ts`** — API client: DSN, auth token, localStorage for configured sensors, dashboard planes, dashboard groups and assignments; all `/api/*` calls.
- **`ReportChart.tsx`** — Multi-series graph: zoom (drag), reset, legend toggles, tooltip, segments (no drop to zero on missing values).
- **`ReportTable.tsx`** — Sortable, filterable, paginated table with Export XLSX (and optional Export HTML).
- **`Sparkline.tsx`** / **`HistoryChart.tsx`** — Small and full history charts for dashboard.
- **`ConfigModal.tsx`** / **`AccordionStep.tsx`** — Config form and collapsible steps.

State: React useState/useCallback/useRef; report data and chart size from API and ResizeObserver. No global store.

---

## Deployment modes

1. **Local dev** — Backend on port 8000, frontend on 5173 (Vite proxy to API).  
2. **Single-URL (e.g. Render)** — Frontend built to `backend/static/`; backend serves `/` and `/assets/*`; API at `/api/*`. See [RENDER.md](RENDER.md).  
3. **Split** — Backend and frontend on different hosts; set **CORS_ORIGINS** and optionally **ALLOW_FRAME_ORIGINS** (see [CONFIGURATION.md](CONFIGURATION.md)).

---

## Security (summary)

- CORS and frame-ancestors are configurable.  
- DSNs for login are validated (Postgres only; private hosts blocked unless `ALLOW_PRIVATE_DSN=1`).  
- Queries use parameter binding; dynamic identifiers (e.g. tracking columns) are whitelisted.  
- Security headers: X-Content-Type-Options, Referrer-Policy, CSP frame-ancestors.  
For details see the main [README](../README.md#security) and any **SECURITY.md** in the repo.
