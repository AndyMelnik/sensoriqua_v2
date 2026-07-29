# Sensoriqua 2 — Dashboards, Reports & Map

Sensoriqua 2 is a web app for telematics and IoT monitoring. It combines three workspaces:

| Tab | What it does |
|-----|----------------|
| **Dashboards** | Configure sensors, watch live values and sparklines, build a threshold-colored panel board |
| **Reports** | Pick objects/sensors and a timeframe; generate charts plus raw/summary tables; export JSON, HTML, PDF, XLSX |
| **Map** | Filter fleet units by business entity and telemetry conditions; show live GPS on OpenStreetMap |

Data comes from PostgreSQL telematics schemas (`raw_business_data`, `raw_telematics_data`). Auth can run **standalone** (env DSN) or via **Navixy App Connect** (per-user JWT and DB URLs).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Prerequisites

- **Python 3.10+** (backend)
- **Node.js 18+** and npm (frontend)
- **PostgreSQL** with schemas `raw_business_data` and `raw_telematics_data` (or compatible layout; see [Schema](#schema))

## Quick start (local)

1. **Database**: Ensure PostgreSQL has `raw_business_data` and `raw_telematics_data` schemas. Create the app schema and tables:

   ```bash
   cd backend && source .venv/bin/activate  # or create venv first
   # Set DSN (or use .env, see below), then:
   psql "$SENSORIQUA_DSN" -f ../migrations/001_app_sensoriqua.sql
   psql "$SENSORIQUA_DSN" -f ../migrations/002_sensor_source.sql
   psql "$SENSORIQUA_DSN" -f ../migrations/003_multiplier.sql
   psql "$SENSORIQUA_DSN" -f ../migrations/004_sparkline_hours.sql
   ```
   Or run `python run_migrations.py` from `backend/` (see [migrations/README.md](migrations/README.md)).

2. **Default DSN (gitignored)**  
   The default connection string is read from **`backend/.env`** (this file is in `.gitignore` and must **never** be committed). Copy from example and set your value:

   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env and set:
   # SENSORIQUA_DSN=postgresql://user:password@host:port/db?sslmode=require
   ```

3. **Backend**:

   ```bash
   cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
   ```
   For production (or Render), use `./start.sh` or `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}` so the server binds to `0.0.0.0` and uses the `PORT` env var when set.

4. **Frontend**:

   ```bash
   cd frontend && npm install && npm run dev
   ```

5. Open the app. In **standalone** mode the backend uses the DSN from `.env`. When using **Navixy App Connect**, the middleware provides user and DB credentials; set `JWT_SECRET` in `backend/.env` and see [docs/NAVIXY_APP_CONNECT.md](docs/NAVIXY_APP_CONNECT.md).

## Deploy on Render.com

Sensoriqua 2 runs on [Render](https://render.com) as a **single Web Service** (API + GUI at one URL). Full instructions: **[docs/RENDER.md](docs/RENDER.md)** · quick checklist: **[docs/RENDER_DEPLOY_CHECKLIST.md](docs/RENDER_DEPLOY_CHECKLIST.md)**.

**Quick steps:**

1. Push the repo to GitHub and connect it to Render (**New → Blueprint** and select the repo, or **New → Web Service** and set Build/Start manually).
2. Use the **Build** and **Start** commands from [docs/RENDER.md](docs/RENDER.md#1-one-web-service-api--gui). The blueprint in `render.yaml` is preconfigured (`NODE_VERSION` required for the frontend build).
3. In Render → **Environment**, set at least:
   - **Navixy:** `JWT_SECRET` (Secret, min 32 chars), `CORS_ORIGINS` (your Render URL, e.g. `https://sensoriqua.onrender.com`).
   - **Standalone:** `SENSORIQUA_DSN` (PostgreSQL connection string).
4. Deploy with **Clear build cache** when updating the UI. Open `https://<your-service>.onrender.com` for the GUI; API at `/api/*`, docs at `/docs`.

To test the same build locally: run `./scripts/build-for-render.sh` from the repo root (builds frontend and replaces `backend/static/`).

**Embedding in an iframe:** Allowed by default. Set **ALLOW_FRAME_ORIGINS** to restrict or `deny` to disable (see [docs/RENDER.md](docs/RENDER.md#6-embedding-in-an-iframe)).

## Features

### Dashboards

Build a live monitoring board from telematics sensors (inputs, states, and tracking fields).

**Select and configure**

1. **Filter** objects by **Groups**, **Tags**, or **Sensor type** (multi-select; empty = all objects).
2. **Choose objects** — flat list or grouped by group/tag; search by label.
3. **Pick sensors** per object, then **Configure / Add** (or **Configure / Edit**):
   - Custom **display label**
   - Optional **MIN / MAX** thresholds (drive green/red panel and card coloring)
   - **Multiplier** to scale displayed values
   - **Mini-chart period** — last **1 / 2 / 4 / 8 hours** for sparklines

**Configured list (center)**

- Cards with interactive sparklines (hover for time/value; min/max stats).
- **Search** by object name, display label, or sensor input (with “Showing X of Y”).
- Card **border and sparkline** use the same threshold logic as the dashboard (**green** in range, **red** out of range, **neutral** otherwise).
- **Edit**, **Add to dashboard**, **Remove**.
- Removing a configured sensor also clears its dashboard widgets.
- If app-state DB is unavailable, the UI falls back to **browser localStorage** (“Saved in this browser”) while live values still come from the API. An empty server list is treated as empty (stale local cache is not revived).

**Live dashboard (right)**

- Panels show object/sensor labels, **latest value**, and a fixed-size sparkline.
- **Configured sensors and dashboard widgets stay in sync**: shared sparkline series, shared live reading (`latest-values`, with sparkline as fallback), same multiplier and MIN/MAX.
- Border/sparkline color: **green** inside thresholds, **red** outside, **neutral** when no thresholds or no reading.
- **Expand / Collapse** full-window mode; refresh every **30s / 1m / 5m** (sparklines and latest values together).
- **Click a panel** → interactive **history chart** (1–24h) with crosshair, tooltip, and threshold legend.
- **Group panels** with **+ / −** (named framed sections). The group frame wraps only its widgets, keeps standard widget size, and wraps to the next row when the viewport is narrow. Group status follows member thresholds (alarm if any panel is out of range).
- **Export / Import** dashboard layout as JSON (planes + groups).

### Reports

Generate analytical views over a chosen time range for the same objects and sensors.

1. Reuse the same **filter → objects → sensors** flow; set a **multiplier** per series.
2. **Step 4 — Timeframe:** From / To (or try last 24 hours if empty).
3. Optional **Report name** and **Description** (included in exports).
4. **Generate report** produces:
   - Multi-series **graph** (drag-to-zoom, Reset, clickable legend)
   - **Raw data** table (by timestamp)
   - **Summary** table (by date: Min, Max, Avg)
5. **Exports:** Import/Export **JSON**, **HTML**, **PDF** (jsPDF); per-table **XLSX** (ExcelJS). Tables support search, sort, and pagination.

### Map

Show where units are now, with optional telemetry filters.

1. **Business entity** — Objects, Vehicles, Employees, Departments, Groups, Tags, Sensor types, or Sensor names.
2. **Select values** — multi-select (empty = all for that dimension); search / select all / clear.
3. **Conditions (optional)** — keep only units whose latest input/state values match rules (`>`, `<`, `=`, `between`).
4. **Refresh** loads positions via `POST /api/map-positions` and fills a sortable **units table** (column visibility, XLSX export).
5. **Live map** — OpenStreetMap markers with popups (label, coordinates, speed, last update).

Step-by-step usage: **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.

### Auth and data source

- **Standalone:** Backend uses `SENSORIQUA_DSN` from `.env`. Client `X-Sensoriqua-DSN` / `?user_id=` are **disabled by default** (set `ALLOW_CLIENT_DSN` / `ALLOW_CLIENT_USER_ID` only for local debugging).
- **Navixy App Connect:** Set `JWT_SECRET` (min 32 chars). Optionally set `LOGIN_API_KEY` and `CORS_ORIGINS`. Middleware calls `POST /api/auth/login`; the app returns a JWT and uses **iotDbUrl** / **userDbUrl** per user. All other `/api/*` routes require `Authorization: Bearer <token>`. See [docs/NAVIXY_APP_CONNECT.md](docs/NAVIXY_APP_CONNECT.md).

## Use cases

Sensoriqua 2 fits any Navixy / telematics objects that publish **inputs**, **states**, or **tracking** fields. Typical boards:

### Heavy machinery and construction fleet

Monitor excavators, loaders, dozers, cranes, or generators on one live board.

| What to watch | Example sensors | Suggested thresholds / groups |
|---------------|-----------------|-------------------------------|
| Utilization & motion | `speed`, ignition / work-mode **state** | Group “Motion”; alarm when moving outside shift hours |
| Powertrain health | Engine coolant temp, oil pressure, RPM | MIN/MAX on temp and pressure; group “Engine” |
| Fuel & fluids | Fuel level, AdBlue | Low-fuel MAX/MIN; group “Consumables” |
| Load / productivity | Payload, dig cycles, engine hours | Reports for shift summaries; Map for site location |
| Safety | Seat belt, overload, tip-over angle | Red border when out of range; history click for incident window |

**Workflow:** filter machines by site **Group** or **Tag** → configure the sensors above → **Add to dashboard** → group panels (Engine / Fuel / Safety) → set **Update every** to 30s–1m on active sites → export the layout for other supervisors.

### Warehouse and cold-room climate

Watch rooms, zones, or fridges that report temperature and humidity (and optional door/open state).

| What to watch | Example sensors | Suggested thresholds / groups |
|---------------|-----------------|-------------------------------|
| Ambient climate | Temperature, humidity | e.g. cold room 2–8 °C, humidity 40–70%; group by room name |
| Door / access | Door open **state**, entry count | Alarm when door open too long; pair with temp spike in history |
| Equipment | Compressor running, defrost cycle | Neutral until thresholds set; Reports for daily Min/Max/Avg |
| Multi-zone sites | One object per room or zone | **Search** in Configured sensors by room label; Map if rooms have GPS/trackers |

**Workflow:** configure temp + humidity per room with shared MIN/MAX → put both panels in a group labeled “Cold store A” → green/red frames show compliance at a glance → use **Reports** for HACCP-style daily Min/Max/Avg tables (XLSX/PDF).

### Other examples

- **Utility / genset yards** — voltage, frequency, fuel, runtime hours.
- **Agriculture** — soil moisture, grain bin temperature, irrigation pump state.
- **Municipal fleet** — speed, idle time, PTO state, with Map + condition filters.

In all cases the same pattern applies: **thresholds for at-a-glance status**, **groups for visual zones**, **search** to find objects quickly in a long configured list, and **Reports/Map** when you need history or location.
## Documentation

- **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)** — How to use Dashboards, Reports, and Map.
- **[README — Use cases](#use-cases)** — Heavy machinery, warehouse climate, and related examples.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Stack, data flow, backend/frontend layout.
- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** — Environment variables, CORS, app state, production checklist.
- **[docs/API_OVERVIEW.md](docs/API_OVERVIEW.md)** — API endpoints and dashboard JSON format.
- **[docs/RENDER.md](docs/RENDER.md)** — Deploy on Render (single-URL). **[docs/RENDER_DEPLOY_CHECKLIST.md](docs/RENDER_DEPLOY_CHECKLIST.md)** — Deploy checklist.
- **[docs/NAVIXY_APP_CONNECT.md](docs/NAVIXY_APP_CONNECT.md)** — Navixy App Connect setup.
- **[SECURITY.md](SECURITY.md)** — Hardening notes for public deployments.

## Schema

- **app_sensoriqua.configured_sensors**: user_id, object_id, device_id, sensor_input_label, **sensor_source** (input | state | tracking), sensor_id, sensor_label_custom, min_threshold, max_threshold, multiplier, **sparkline_hours** (1 | 2 | 4 | 8, default 1), is_active, created_at, updated_at.
- **app_sensoriqua.dashboard_planes**: user_id, configured_sensor_id, position_index. (Dashboard **group_id** and group labels are stored in the frontend and in exported JSON; see [API_OVERVIEW](docs/API_OVERVIEW.md).)

**Telematics data (read-only):**

- **raw_telematics_data.inputs** — device_id, device_time, sensor_name, value (used for sparklines and latest values when sensor_source = input).
- **raw_telematics_data.states** — device_id, device_time, state_name, value (sensor_source = state).
- **raw_telematics_data.tracking_data_core** — device_id, device_time, plus value columns (e.g. latitude, longitude, speed, altitude; sensor_source = tracking).

**App state** (configured_sensors, dashboard_planes): When using Navixy, **userDbUrl** is used per user. Otherwise the backend uses **SQLite** at `backend/sensoriqua_state.db` by default (no migrations required). You can override with **SENSORIQUA_APP_STATE_DSN** (e.g. `sqlite:///./sensoriqua_state.db`). If the backend cannot persist app state (e.g. 503), the frontend **falls back to localStorage** for the configured-sensors list and dashboard for that browser session (see “Saved in this browser” in the UI).

## Schema alignment

- **tag_links**: `entity_type` is an **integer**. The app uses `SENSORIQUA_TAG_ENTITY_TYPE_OBJECT` (default `1`) for the object/tracker entity type. Set this in `.env` if your platform uses a different code.
- **Objects** can also be filtered by **department_ids** and **garage_ids** (API supports them; UI grouping tabs are Groups, Tags, Sensor type).
- **garages**: Label is taken from `organization_label` (schema has no `garage_label`).
- **description_parametrs**: Lookup table (`key`, `type`, `description`) used to resolve e.g. `units_type` to a human-readable label for sensors. Table name in schema is `description_parametrs` (typo).

## Security

- **Secrets:** Keep `backend/.env` out of version control. Do not commit DSN or credentials.
- **Production:** With Navixy, use **CORS_ORIGINS** and preferably **LOGIN_API_KEY**. Do not enable `ALLOW_CLIENT_DSN` / `ALLOW_CLIENT_USER_ID` on public deployments. With JWT_SECRET set, the app uses only credentials from the auth service per user.
- For a full safety and security review (auth, CORS, SSRF, headers, SQL), see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and pull request guidelines.

## License

This project is licensed under the [MIT License](LICENSE).

### Disclaimer

This software is provided **“AS IS”**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.
