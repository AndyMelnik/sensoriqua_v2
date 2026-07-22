"""Unit tests for DSN SSRF / hostaddr pinning."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from app.dsn_security import UnsafeDsnError, prepare_safe_dsn, validate_dsn


def test_rejects_non_postgres_scheme():
    with pytest.raises(UnsafeDsnError, match="PostgreSQL"):
        validate_dsn("mysql://user:pass@example.com/db")


def test_rejects_localhost_by_default():
    with pytest.raises(UnsafeDsnError, match="private"):
        validate_dsn("postgresql://u:p@127.0.0.1:5432/db")


def test_allows_localhost_when_flag_set():
    out = prepare_safe_dsn("postgresql://u:p@127.0.0.1:5432/db", allow_private=True)
    assert "hostaddr=127.0.0.1" in out
    assert "host=127.0.0.1" in out


def test_trusted_env_dsn_allows_private():
    dsn = "postgresql://u:p@10.0.0.5:5432/iot"
    with patch.dict(os.environ, {"SENSORIQUA_DSN": dsn, "ALLOW_PRIVATE_DSN": ""}):
        out = prepare_safe_dsn(dsn)
    assert "hostaddr=10.0.0.5" in out


def test_pins_public_resolved_ip():
    dsn = "postgresql://u:p@db.example.com:5432/iot"
    fake = [(2, 1, 6, "", ("8.8.8.8", 0))]
    with patch("app.dsn_security.socket.getaddrinfo", return_value=fake):
        out = prepare_safe_dsn(dsn, allow_private=False)
    assert "hostaddr=8.8.8.8" in out
    assert "host=db.example.com" in out


def test_rejects_when_any_resolved_ip_private():
    dsn = "postgresql://u:p@evil.example.com:5432/iot"
    fake = [
        (2, 1, 6, "", ("8.8.8.8", 0)),
        (2, 1, 6, "", ("10.1.2.3", 0)),
    ]
    with patch("app.dsn_security.socket.getaddrinfo", return_value=fake):
        with pytest.raises(UnsafeDsnError, match="private"):
            prepare_safe_dsn(dsn, allow_private=False)


def test_rejects_private_hostaddr_override():
    # libpq-style keyword conninfo (URL query hostaddr is uncommon)
    with pytest.raises(UnsafeDsnError, match="private"):
        prepare_safe_dsn(
            "host=db.example.com hostaddr=127.0.0.1 port=5432 dbname=iot user=u password=p",
            allow_private=False,
        )
