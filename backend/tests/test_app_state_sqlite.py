"""App-state SQLite vs Navixy userDbUrl must agree on schema prefix and dialect."""

import app.db as db


def test_schema_prefers_env_sqlite_over_navixy_override(monkeypatch):
    monkeypatch.setattr(db, "APP_STATE_DSN", "sqlite:///sensoriqua_state.db")
    monkeypatch.setattr(db, "USE_USER_DB_APP_STATE", True)
    assert db._app_state_schema_for_conn("postgresql://user:pass@host/db") == "sqlite"
    assert db.request_uses_sqlite_app_state("postgresql://user:pass@host/db") is True


def test_schema_defaults_to_sqlite_even_with_navixy_override(monkeypatch):
    """Render/Navixy: ignore userDbUrl for app state unless explicitly opted in."""
    monkeypatch.setattr(db, "APP_STATE_DSN", "")
    monkeypatch.setattr(db, "USE_USER_DB_APP_STATE", False)
    assert db._app_state_schema_for_conn("postgresql://user:pass@host/db") == "sqlite"
    assert db.request_uses_sqlite_app_state("postgresql://user:pass@host/db") is True


def test_schema_uses_postgres_when_opted_into_user_db(monkeypatch):
    monkeypatch.setattr(db, "APP_STATE_DSN", "")
    monkeypatch.setattr(db, "USE_USER_DB_APP_STATE", True)
    assert db._app_state_schema_for_conn("postgresql://user:pass@host/db") == "postgres"
    assert db.request_uses_sqlite_app_state("postgresql://user:pass@host/db") is False


def test_schema_defaults_to_sqlite_without_env_or_override(monkeypatch):
    monkeypatch.setattr(db, "APP_STATE_DSN", "")
    monkeypatch.setattr(db, "USE_USER_DB_APP_STATE", False)
    assert db._app_state_schema_for_conn(None) == "sqlite"
    assert db.request_uses_sqlite_app_state(None) is True
