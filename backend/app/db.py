"""
Database connection for Sensoriqua.
Uses DSN from header X-Sensoriqua-DSN (testing) or env SENSORIQUA_DSN.
Loads SENSORIQUA_DSN from .env (gitignored) when present.

Optional: SENSORIQUA_APP_STATE_DSN for configured_sensors and dashboard_planes.
If set to a path like sqlite:///./sensoriqua_state.db or file:sensoriqua_state.db,
app state is stored in that SQLite file (no CREATE rights needed on main DB).

When using Navixy App Connect, override_dsn (userDbUrl) can be passed to use
per-user Postgres for app state.
"""
import os
import sqlite3
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Generator

# Set inside get_app_state_conn so app_state_table() returns correct prefix
_app_state_schema: ContextVar[str] = ContextVar("app_state_schema", default="postgres")

import psycopg
from psycopg.rows import dict_row

# Load .env from backend directory so SENSORIQUA_DSN is set (file is gitignored)
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_path)

# Default DSN: from env (e.g. .env) or placeholder
DEFAULT_DSN = os.environ.get(
    "SENSORIQUA_DSN",
    "postgresql://user:password@localhost:5432/iot_db"
)

# Optional: use SQLite for app state when main DB has no CREATE rights
APP_STATE_DSN = os.environ.get("SENSORIQUA_APP_STATE_DSN", "").strip()

# When no override_dsn and no APP_STATE_DSN, use this SQLite file so app works without app_sensoriqua on Postgres
_DEFAULT_APP_STATE_PATH = Path(__file__).resolve().parent.parent / "sensoriqua_state.db"

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS configured_sensors (
  configured_sensor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  object_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  sensor_input_label TEXT NOT NULL,
  sensor_source TEXT NOT NULL DEFAULT 'input',
  sensor_id INTEGER NULL,
  sensor_label_custom VARCHAR(100) NOT NULL,
  min_threshold REAL NULL,
  max_threshold REAL NULL,
  multiplier REAL NULL,
  sparkline_hours INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cfg_user ON configured_sensors(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_cfg_object ON configured_sensors(object_id);
CREATE INDEX IF NOT EXISTS idx_cfg_device_sensor ON configured_sensors(device_id, sensor_input_label);

CREATE TABLE IF NOT EXISTS dashboard_planes (
  dashboard_plane_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  configured_sensor_id INTEGER NOT NULL REFERENCES configured_sensors(configured_sensor_id) ON DELETE CASCADE,
  position_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, configured_sensor_id)
);
CREATE INDEX IF NOT EXISTS idx_dash_user ON dashboard_planes(user_id);
"""


def get_dsn_from_header(header_value: str | None) -> str:
    """DSN for this request: header takes precedence over env."""
    if header_value and header_value.strip():
        return header_value.strip()
    return DEFAULT_DSN


def _use_sqlite_app_state() -> bool:
    if not APP_STATE_DSN:
        return False
    lower = APP_STATE_DSN.lower()
    return lower.startswith("sqlite:") or lower.startswith("file:")


def _sqlite_path() -> Path | None:
    if not _use_sqlite_app_state():
        return None
    s = APP_STATE_DSN
    if s.startswith("file:"):
        s = s[5:].lstrip("/")
    elif s.startswith("sqlite:"):
        s = s[7:].lstrip("/")
    if not s or s == ":memory:":
        return None
    path = Path(s)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent.parent / path
    return path


@contextmanager
def get_conn(dsn: str) -> Generator[psycopg.Connection, None, None]:
    """Context manager for a single Postgres connection. Caller closes via context."""
    conn = psycopg.connect(dsn, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


class _SqliteCursorWrapper:
    def __init__(self, cursor: sqlite3.Cursor):
        self._cur = cursor

    def fetchone(self) -> dict[str, Any] | None:
        row = self._cur.fetchone()
        if row is None:
            return None
        return dict(zip([c[0] for c in self._cur.description], row))

    def fetchall(self) -> list[dict[str, Any]]:
        rows = self._cur.fetchall()
        if not rows:
            return []
        return [dict(zip([c[0] for c in self._cur.description], r)) for r in rows]

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount


class _SqliteConnWrapper:
    """Wraps sqlite3 connection to use %s placeholders and return dict rows."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn
        conn.row_factory = sqlite3.Row

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> _SqliteCursorWrapper:
        sqlite_sql = sql.replace("%s", "?")
        cur = self._conn.execute(sqlite_sql, params or ())
        return _SqliteCursorWrapper(cur)

    def commit(self) -> None:
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()


def _migrate_sqlite_multiplier(conn: sqlite3.Connection) -> None:
    """Add multiplier column to configured_sensors if missing (for existing DBs)."""
    cur = conn.execute("PRAGMA table_info(configured_sensors)")
    cols = [row[1] for row in cur.fetchall()]
    if "multiplier" not in cols:
        conn.execute("ALTER TABLE configured_sensors ADD COLUMN multiplier REAL NULL")
        conn.commit()


def _migrate_sqlite_sparkline_hours(conn: sqlite3.Connection) -> None:
    """Add sparkline_hours column to configured_sensors if missing (for existing DBs)."""
    cur = conn.execute("PRAGMA table_info(configured_sensors)")
    cols = [row[1] for row in cur.fetchall()]
    if "sparkline_hours" not in cols:
        conn.execute("ALTER TABLE configured_sensors ADD COLUMN sparkline_hours INTEGER NOT NULL DEFAULT 1")
        conn.commit()


_SQLITE_INITED: set[Path] = set()


def _init_sqlite_schema(path: Path) -> None:
    """Run schema creation once per process lifetime, using WAL mode for concurrency."""
    if path in _SQLITE_INITED:
        return
    timeout_sec = float(os.environ.get("SENSORIQUA_SQLITE_TIMEOUT", "10.0"))
    conn = sqlite3.connect(str(path), timeout=timeout_sec)
    try:
        conn.execute(f"PRAGMA busy_timeout = {int(timeout_sec * 1000)}")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.executescript(_SQLITE_SCHEMA)
        conn.commit()
        _migrate_sqlite_multiplier(conn)
        _migrate_sqlite_sparkline_hours(conn)
    finally:
        conn.close()
    _SQLITE_INITED.add(path)


def _open_sqlite_app_state(path: Path) -> _SqliteConnWrapper:
    path.parent.mkdir(parents=True, exist_ok=True)
    _init_sqlite_schema(path)
    timeout_sec = float(os.environ.get("SENSORIQUA_SQLITE_TIMEOUT", "10.0"))
    conn = sqlite3.connect(str(path), timeout=timeout_sec, check_same_thread=False)
    conn.execute(f"PRAGMA busy_timeout = {int(timeout_sec * 1000)}")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return _SqliteConnWrapper(conn)


def _app_state_schema_for_conn(override_dsn: str | None) -> str:
    """Return 'sqlite' or 'postgres' so app_state_table() resolves correctly before opening conn."""
    if override_dsn:
        return "postgres"
    if _use_sqlite_app_state():
        return "sqlite"
    return "sqlite"  # default: no APP_STATE_DSN -> use default SQLite


@contextmanager
def get_app_state_conn(main_dsn: str, override_dsn: str | None = None) -> Generator[Any, None, None]:
    """
    Context manager for app_sensoriqua (configured_sensors, dashboard_planes).
    If SENSORIQUA_APP_STATE_DSN is set to sqlite, uses that (overrides Navixy userDbUrl).
    Else if override_dsn is set (e.g. Navixy userDbUrl), uses that Postgres for app state.
    Otherwise uses default SQLite at backend/sensoriqua_state.db (no Postgres schema required).
    Yields a connection with execute(sql, params) and dict rows.
    Table names: SQLite no prefix; Postgres use app_sensoriqua.X (via app_state_table).
    """
    schema = _app_state_schema_for_conn(override_dsn)
    token = _app_state_schema.set(schema)
    try:
        if _use_sqlite_app_state():
            path = _sqlite_path()
            if path:
                conn_wrapper = _open_sqlite_app_state(path)
                try:
                    yield conn_wrapper
                finally:
                    conn_wrapper.close()
                return
        if override_dsn:
            with get_conn(override_dsn) as conn:
                yield conn
            return
        # No override and no APP_STATE_DSN: use default SQLite so app works without app_sensoriqua on main DB
        conn_wrapper = _open_sqlite_app_state(_DEFAULT_APP_STATE_PATH)
        try:
            yield conn_wrapper
        finally:
            conn_wrapper.close()
    finally:
        _app_state_schema.reset(token)


def app_state_uses_sqlite() -> bool:
    """True if app state is stored in SQLite (so table names have no schema prefix)."""
    return _use_sqlite_app_state() or not APP_STATE_DSN


def app_state_table(name: str) -> str:
    """Table name for app state: 'app_sensoriqua.X' for Postgres, 'X' for SQLite."""
    return name if _app_state_schema.get() == "sqlite" else f"app_sensoriqua.{name}"
