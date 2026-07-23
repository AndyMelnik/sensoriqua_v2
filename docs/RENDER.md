# Deploying Sensoriqua 2 on Render.com

This guide explains how to deploy **Sensoriqua 2 (Dashboards and Reports)** on [Render.com](https://render.com) as a single Web Service that serves both the API and the GUI at one URL.

---

## Prerequisites

- A **GitHub** (or GitLab) account and a repository with the Sensoriqua 2 codebase.
- A **Render** account ([dashboard.render.com](https://dashboard.render.com)).
- For **Navixy App Connect**: a Navixy account and your application URL (the Render URL after deploy).  
- For **standalone mode** (no Navixy): a PostgreSQL database with `raw_business_data` and `raw_telematics_data` schemas.

---

## 1. One Web Service (API + GUI)

One Render Web Service runs both the FastAPI backend and the React frontend. The frontend is built during deploy and copied into `backend/static/`; the same URL serves the GUI at `/` and the API at `/api/*` and `/docs`.

### Option A: Deploy with Blueprint (recommended)

1. In [Render Dashboard](https://dashboard.render.com), click **New → Blueprint**.
2. Connect your Git provider and select the **Sensoriqua 2** repository and branch (e.g. `main`).
3. Render reads `render.yaml` and creates a Web Service named **sensoriqua**.
4. After the first deploy, go to the service → **Environment** and add the variables described in [Environment variables](#environment-variables) (at least **JWT_SECRET** for Navixy, or **SENSORIQUA_DSN** for standalone).
5. Save; Render will redeploy. Your app is available at `https://<service-name>.onrender.com`.

### Option B: Create the Web Service manually

1. In Render Dashboard, click **New → Web Service**.
2. Connect the repository and select the branch.
3. Configure:
   - **Name:** e.g. `sensoriqua`
   - **Region:** choose one (e.g. Oregon).
   - **Root Directory:** leave empty (repo root).
   - **Runtime:** Python 3.
   - **Build Command:**
     ```bash
     cd frontend && npm ci && npm run build
     rm -rf ../backend/static
     mkdir -p ../backend/static && cp -a dist/. ../backend/static/
     cd ../backend && pip install -r requirements.txt
     ```
   - **Start Command:**
     ```bash
     cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT
     ```
4. Click **Advanced** and add **Environment Variables** (see below). Add **PYTHON_VERSION** = `3.11` and **NODE_VERSION** = `20.18.0` (needed so `npm` works on a Python service).
5. Click **Create Web Service**. Render builds and deploys; the app will be at `https://<name>.onrender.com`.

---

## 2. Environment variables

Add these in the Render Dashboard under your service → **Environment**.

| Variable | Required | Description |
|----------|----------|-------------|
| **JWT_SECRET** | Yes (for Navixy) | Secret for signing JWTs. Min 32 characters. Generate with: `openssl rand -hex 32`. Store as **Secret** in Render. |
| **SENSORIQUA_DSN** | Yes (standalone only) | PostgreSQL connection string for telematics/business data when **not** using Navixy. Example: `postgresql://user:pass@host:5432/db?sslmode=require`. |
| **SENSORIQUA_APP_STATE_DSN** | No | App state DB (configured sensors, dashboard). Default in blueprint: `sqlite:///sensoriqua_state.db`. For persistence across restarts, use a [Persistent Disk](https://render.com/docs/disks) and e.g. `sqlite:///data/sensoriqua_state.db`, or a Postgres URL. |
| **CORS_ORIGINS** | Recommended | Comma-separated frontend origins, e.g. `https://sensoriqua.onrender.com`. Required when using credentials (Navixy). Do not use `*` with credentials. |
| **ALLOW_FRAME_ORIGINS** | No | Iframe embedding. `deny` = no embedding; or comma-separated origins, e.g. `https://app.navixy.com`. Empty = allow all. |
| **PYTHON_VERSION** | No | Set to `3.11` (or 3.10+) if needed. The blueprint sets 3.11. |
| **NODE_VERSION** | Recommended | e.g. `20.18.0`. Required on a Python Web Service so the build can run `npm ci` / `npm run build`. Without it, deploy may keep the old committed `backend/static` UI. |

**Navixy App Connect:** Set **JWT_SECRET** and **CORS_ORIGINS** (your Render URL). Do **not** set SENSORIQUA_DSN for production users; the DSN comes from Navixy per user (iotDbUrl / userDbUrl).

**Standalone (no Navixy):** Set **SENSORIQUA_DSN** to your Postgres. App state uses SQLite by default (see above for persistence).

---

## 3. Navixy App Connect setup

To use Navixy as the authentication gateway and data source (iotDbUrl / userDbUrl per user):

1. **Deploy** the app on Render so you have a public URL, e.g. `https://sensoriqua.onrender.com`.
2. **Environment:** Set **JWT_SECRET** (min 32 chars, Secret) and **CORS_ORIGINS** = `https://sensoriqua.onrender.com` (or your exact Render URL).
3. In **Navixy**, open **User applications** (or equivalent) and add your application:
   - **Application URL:** `https://sensoriqua.onrender.com` (no trailing slash).
   - The middleware will call `POST https://sensoriqua.onrender.com/api/auth/login` with the user’s email, **iotDbUrl**, **userDbUrl**, and role.
4. Users open the app **via Navixy**. After login they receive a JWT; the frontend stores it and sends it with every `/api/*` request. The backend uses **iotDbUrl** for telematics data and **userDbUrl** for app state (configured sensors, dashboard).

See [NAVIXY_APP_CONNECT.md](NAVIXY_APP_CONNECT.md) for endpoint and JWT details.

---

## 4. Standalone mode (no Navixy)

If you are **not** using Navixy:

1. Set **SENSORIQUA_DSN** to your PostgreSQL connection string (with `raw_business_data` and `raw_telematics_data` schemas).
2. Do **not** set JWT_SECRET (or leave it short). The app will use the single DSN for all requests.
3. Optional: set **SENSORIQUA_APP_STATE_DSN** to a Postgres URL for app state, or leave default SQLite (ephemeral unless you add a Persistent Disk).

Run migrations for app state if using Postgres: see repo root [README](../README.md#quick-start-local) and `migrations/`.

---

## 5. App state and persistence

- **With Navixy:** App state (configured sensors, dashboard) is stored in the **userDbUrl** database per user. No Render Postgres or disk required for that.
- **With SQLite (default when not using userDbUrl):** The file is written inside the container. Render’s filesystem is **ephemeral** — data is lost on restart. To keep SQLite data:
  - Add a [Persistent Disk](https://render.com/docs/disks) and set **SENSORIQUA_APP_STATE_DSN** to e.g. `sqlite:///data/sensoriqua_state.db` (where `data` is the mount path), or  
  - Use **SENSORIQUA_APP_STATE_DSN** with a Postgres URL instead.

---

## 6. Embedding in an iframe

The app allows iframe embedding by default. To restrict or disable:

- **ALLOW_FRAME_ORIGINS=deny** — no embedding.
- **ALLOW_FRAME_ORIGINS=https://app.navixy.com,https://other.com** — only these origins may embed.

---

## 7. Redeploy and updates

- **Auto-deploy:** With default settings, pushing to the connected branch triggers a new build and deploy.
- **Manual deploy:** Dashboard → your service → **Manual Deploy** → **Deploy latest commit**.
- Each deploy runs the full build (frontend + backend); the GUI and API are updated together.

---

## 8. Troubleshooting

| Issue | What to check |
|-------|----------------|
| **Old UI after deploy** | 1) Build logs must show `vite build` / `npm run build`. 2) Set **NODE_VERSION**=`20.18.0`. 3) Build command must **`rm -rf backend/static`** before copy. 4) Confirm Root Directory is empty (repo root). 5) Hard-refresh the browser (cache). |
| Build fails at `npm ci` / `npm: not found` | Add env **NODE_VERSION**=`20.18.0` on the Python Web Service. Ensure `frontend/package-lock.json` is committed. |
| Build fails at `cp dist` | Build command must `rm -rf` then `mkdir -p ../backend/static` before `cp -a dist/. ../backend/static/`. |
| Test build locally | From repo root run `./scripts/build-for-render.sh` (builds frontend and replaces `backend/static/`). |
| 401 Unauthorized on /api/* | With Navixy, JWT_SECRET must be set and users must open the app via Navixy so the middleware calls `/api/auth/login` and the client gets a token. |
| CORS errors | Set **CORS_ORIGINS** to your frontend origin (e.g. the Render URL). No trailing slash. |
| App state lost on restart | Using default SQLite on Render; add a Persistent Disk or use Postgres for SENSORIQUA_APP_STATE_DSN. |
| Free tier spin-down | Free Web Services spin down after inactivity; the first request may be slow (cold start). |

---

## 9. Summary

| Item | Value |
|------|--------|
| **Root Directory** | (empty) |
| **Build Command** | `cd frontend && npm ci && npm run build` → `rm -rf ../backend/static && mkdir -p ../backend/static && cp -a dist/. ../backend/static/` → `cd ../backend && pip install -r requirements.txt` |
| **Start Command** | `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| **GUI** | Served at `/` from `backend/static/` (rebuilt every deploy) |
| **API** | `/api/*`, `/docs` |
| **Env** | `PYTHON_VERSION=3.11`, `NODE_VERSION=20.18.0`, plus JWT/DSN as needed |
| **Required env (Navixy)** | JWT_SECRET, CORS_ORIGINS |
| **Required env (standalone)** | SENSORIQUA_DSN |
