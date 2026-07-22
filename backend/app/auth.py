"""
Navixy App Connect integration: JWT auth and per-user DSN storage.
When JWT_SECRET is set (App Connect enabled):
- POST /api/auth/login accepts middleware payload and returns JWT; stores iotDbUrl/userDbUrl per user.
- All other /api/* routes require a valid Bearer token; DSN and user_id come only from that token.
  No fallback to X-Sensoriqua-DSN or default DSN, so each browser session uses only that user's credentials.

Standalone (no JWT): uses SENSORIQUA_DSN / default user_id from env.
Client-supplied X-Sensoriqua-DSN and ?user_id= are ignored unless ALLOW_CLIENT_DSN / ALLOW_CLIENT_USER_ID are set.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jwt
from fastapi import Header, HTTPException, Request

logger = logging.getLogger("sensoriqua.auth")

JWT_SECRET = os.environ.get("JWT_SECRET", "").strip()
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Opt-in only: trusting client DSN / user_id enables IDOR and DB selection by the caller.
ALLOW_CLIENT_DSN = os.environ.get("ALLOW_CLIENT_DSN", "").strip().lower() in ("1", "true", "yes")
ALLOW_CLIENT_USER_ID = os.environ.get("ALLOW_CLIENT_USER_ID", "").strip().lower() in ("1", "true", "yes")

_CREDENTIALS_PATH = Path(
    os.environ.get(
        "SENSORIQUA_CREDENTIALS_PATH",
        str(Path(__file__).resolve().parent.parent / "sensoriqua_credentials.json"),
    )
)

_lock = threading.RLock()
# userId (UUID str) -> { "iotDbUrl", "userDbUrl" }; never expose to client
_user_credentials: dict[str, dict[str, str]] = {}
# Stable integer id for app_sensoriqua.user_id
_uuid_to_int: dict[str, int] = {}
_int_counter = 1


def _load_credentials_file() -> None:
    global _int_counter
    if not _CREDENTIALS_PATH.is_file():
        return
    try:
        data = json.loads(_CREDENTIALS_PATH.read_text(encoding="utf-8"))
        creds = data.get("credentials") or {}
        mapping = data.get("uuid_to_int") or {}
        counter = int(data.get("int_counter") or 1)
        with _lock:
            _user_credentials.clear()
            for k, v in creds.items():
                if isinstance(v, dict) and v.get("iotDbUrl") and v.get("userDbUrl"):
                    _user_credentials[str(k)] = {
                        "iotDbUrl": str(v["iotDbUrl"]),
                        "userDbUrl": str(v["userDbUrl"]),
                    }
            _uuid_to_int.clear()
            for k, v in mapping.items():
                try:
                    _uuid_to_int[str(k)] = int(v)
                except (TypeError, ValueError):
                    continue
            _int_counter = max(counter, max(_uuid_to_int.values(), default=0) + 1)
        logger.info("Loaded %s stored App Connect credential(s) from disk", len(_user_credentials))
    except Exception as e:
        logger.warning("Could not load credentials file %s: %s", _CREDENTIALS_PATH, e)


def _save_credentials_file() -> None:
    try:
        _CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _lock:
            payload = {
                "credentials": _user_credentials,
                "uuid_to_int": _uuid_to_int,
                "int_counter": _int_counter,
            }
            tmp = _CREDENTIALS_PATH.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload), encoding="utf-8")
            tmp.replace(_CREDENTIALS_PATH)
            try:
                os.chmod(_CREDENTIALS_PATH, 0o600)
            except OSError:
                pass
    except Exception as e:
        logger.warning("Could not persist credentials file %s: %s", _CREDENTIALS_PATH, e)


_load_credentials_file()


def _stable_user_id(uuid_str: str) -> int:
    """Map Navixy userId (UUID) to a stable integer for app_sensoriqua tables."""
    global _int_counter
    with _lock:
        if uuid_str not in _uuid_to_int:
            _uuid_to_int[uuid_str] = _int_counter
            _int_counter += 1
            _save_credentials_file()
        return _uuid_to_int[uuid_str]


def is_app_connect_enabled() -> bool:
    return len(JWT_SECRET) >= 32


def create_token(user_id: str, email: str, role: str) -> str:
    import time

    now = int(time.time())
    payload = {
        "userId": user_id,
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + JWT_EXPIRATION_HOURS * 3600,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


def store_credentials(user_id: str, iot_db_url: str, user_db_url: str) -> None:
    with _lock:
        _user_credentials[user_id] = {"iotDbUrl": iot_db_url, "userDbUrl": user_db_url}
        _save_credentials_file()


def get_credentials(user_id: str) -> dict[str, str] | None:
    with _lock:
        return _user_credentials.get(user_id)


@dataclass
class RequestContext:
    """DSN and user_id for the current request. From JWT when present, else env defaults."""

    dsn: str
    app_state_dsn: str | None  # When set, use this for app state (Navixy userDbUrl)
    user_id: int


def get_request_context(
    request: Request,
    x_sensoriqua_dsn: str | None = Header(None, alias="X-Sensoriqua-DSN"),
    user_id_query: int | None = None,
    default_user_id: int = 1,
    default_dsn: str = "",
) -> RequestContext:
    """
    Resolve DSN and user_id from JWT (Navixy) or env (standalone).
    When App Connect is enabled: requires valid Bearer token; uses only that user's stored
    iotDbUrl/userDbUrl. No fallback to header or default DSN.
    Standalone: ignores client DSN / user_id unless ALLOW_CLIENT_DSN / ALLOW_CLIENT_USER_ID.
    """
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    token = None
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if token and is_app_connect_enabled():
        payload = verify_token(token)
        if payload:
            uid_str = payload.get("userId")
            creds = get_credentials(uid_str) if uid_str else None
            if uid_str and creds:
                internal_uid = _stable_user_id(uid_str)
                return RequestContext(
                    dsn=creds["iotDbUrl"],
                    app_state_dsn=creds.get("userDbUrl"),
                    user_id=internal_uid,
                )
    # App Connect enabled but no valid token: require auth (no DSN fallback)
    if is_app_connect_enabled():
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Use Navixy to open this application.",
        )
    # Standalone: env DSN + default user; client overrides only if explicitly allowed
    dsn = default_dsn
    if ALLOW_CLIENT_DSN and x_sensoriqua_dsn and x_sensoriqua_dsn.strip():
        dsn = x_sensoriqua_dsn.strip()
    uid = default_user_id
    if ALLOW_CLIENT_USER_ID and user_id_query is not None:
        uid = user_id_query
    return RequestContext(dsn=dsn, app_state_dsn=None, user_id=uid)
