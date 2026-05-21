# Sensoriqua migrations

These SQL files must be applied to the database used by `SENSORIQUA_DSN` (and/or app-state Postgres) so the app can store configured sensors and dashboard layout.

## If you have CREATE rights on the DB

From the project root:

```bash
cd backend && python run_migrations.py
```

(Uses Python/psycopg; `psql` is not required.)

## If your DB user cannot CREATE (e.g. shared Navixy DB)

Your DBA (or anyone with sufficient privileges) must run the migrations **once** in order:

1. **001_app_sensoriqua.sql** — creates schema `app_sensoriqua`, tables `configured_sensors` and `dashboard_planes`.
2. **002_sensor_source.sql** — adds column `sensor_source` to `configured_sensors`.
3. **003_multiplier.sql** — adds column `multiplier` to `configured_sensors` (scale raw values).
4. **004_sparkline_hours.sql** — adds column `sparkline_hours` (1, 2, 4, or 8; default 1) for dashboard mini-chart time window.

They can run them with:

```bash
psql "$SENSORIQUA_DSN" -f migrations/001_app_sensoriqua.sql
psql "$SENSORIQUA_DSN" -f migrations/002_sensor_source.sql
psql "$SENSORIQUA_DSN" -f migrations/003_multiplier.sql
psql "$SENSORIQUA_DSN" -f migrations/004_sparkline_hours.sql
```

Or execute the contents of those files in any SQL client connected to the same database.

After that, **Add** sensor in the app will work, including **mini-chart period** on configured sensors.

**SQLite app state:** The backend applies equivalent schema changes automatically for local `sensoriqua_state.db` when not using Postgres app state.
