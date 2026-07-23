# Render deploy checklist (API + GUI)

Use this when publishing the current `main` to Render so **backend and frontend** update together.

## 1. Repo must include a fresh GUI build

On every Render deploy the build command:

1. Runs `npm ci && npm run build` in `frontend/`
2. **Deletes** `backend/static`
3. Copies `frontend/dist/` → `backend/static/`
4. Installs Python deps and starts uvicorn

Locally you can reproduce with:

```bash
./scripts/build-for-render.sh
```

## 2. Render Web Service settings

| Setting | Value |
|--------|--------|
| **Repo** | GitHub `AndyMelnik/sensoriqua_v2` (or GitLab equivalent) |
| **Branch** | `main` |
| **Root Directory** | *(empty — repo root)* |
| **Runtime** | Python 3 |
| **Build Command** | see `render.yaml` (must include `rm -rf ../backend/static` and `npm run build`) |
| **Start Command** | `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |

### Environment

| Key | Value |
|-----|--------|
| `PYTHON_VERSION` | `3.11` |
| `NODE_VERSION` | `20.18.0` (**required** so `npm` works on a Python service) |
| `SENSORIQUA_APP_STATE_DSN` | `sqlite:///sensoriqua_state.db` (or disk path) |
| `JWT_SECRET` | Secret, ≥32 chars (Navixy) |
| `CORS_ORIGINS` | Your Render URL, e.g. `https://<name>.onrender.com` |
| `SENSORIQUA_DSN` | Only for standalone (no Navixy) |

## 3. Deploy steps

1. Push latest `main` to the Git remote Render is connected to.
2. Render Dashboard → service → **Manual Deploy** → **Clear build cache & deploy**.
3. In **Logs**, confirm: `vite build` / `✓ built in` and `Application startup complete`.
4. Hard-refresh the browser (old `index.html` may be cached).

## 4. Sanity checks after deploy

- Favicon / Sensoriqua logo (not Vite icon)
- Tabs: Dashboard, Reports, **Map**
- `/docs` opens FastAPI docs (new backend is live)
