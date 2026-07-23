"""Auth / credential security helpers."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

# Ensure JWT-sized secret for Fernet during import-side tests
os.environ.setdefault("JWT_SECRET", "t" * 32)


def test_encrypt_decrypt_roundtrip(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "s" * 32)
    monkeypatch.delenv("CREDENTIALS_ENCRYPTION_KEY", raising=False)
    from importlib import reload
    import app.auth as auth

    reload(auth)
    plain = "postgresql://u:secret@db.example.com:5432/iot"
    enc = auth._encrypt_field(plain)
    assert enc.startswith("enc:v1:")
    assert auth._decrypt_field(enc) == plain


def test_login_api_key_compare():
    from app import main as main_mod

    with patch.object(main_mod, "LOGIN_API_KEY", "abc123secretkey"):
        assert main_mod._login_api_key_ok("abc123secretkey") is True
        assert main_mod._login_api_key_ok("wrong") is False
        assert main_mod._login_api_key_ok(None) is False
        assert main_mod._login_api_key_ok("abc123secretkeX") is False

    # Empty LOGIN_API_KEY: Navixy App Connect default — allow without header
    with patch.object(main_mod, "LOGIN_API_KEY", ""):
        assert main_mod._login_api_key_ok(None) is True
        assert main_mod._login_api_key_ok("") is True
