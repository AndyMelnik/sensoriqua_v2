"""
Navixy App Connect integration: JWT auth and per-user DSN storage.
When JWT_SECRET is set (App Connect enabled):
- POST /api/auth/login accepts middleware payload and returns JWT; stores iotDbUrl/userDbUrl per user.
- All other /api/* routes require a valid Bearer token; DSN and user_id come only from that token.
  No fallback to X-Sensoriqua-DSN or default DSN, so each browser session uses only that user's credentials.
"""
import os
import uuid
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Header, HTTPException, Request

JWT_SECRET = os.environ.get("JWT_SECRET", "").strip()
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# userId (UUID str) -> { "iotDbUrl", "userDbUrl" }; never expose to client; isolated per user/session
_user_credentials: dict[str, dict[str, str]] = {}
# Stable integer id for app_sensoriqua.user_id (schema uses INTEGER); one-to-one per Navixy user
_uuid_to_int: dict[str, int] = {}
_int_counter = 1


def _stable_user_id(uuid_str: str) -> int:
    """Map Navixy userId (UUID) to a stable integer for app_sensoriqua tables."""
    global _int_counter
    if uuid_str not in _uuid_to_int:
        _uuid_to_int[uuid_str] = _int_counter
        _int_counter += 1
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
    _user_credentials[user_id] = {"iotDbUrl": iot_db_url, "userDbUrl": user_db_url}


def get_credentials(user_id: str) -> dict[str, str] | None:
    return _user_credentials.get(user_id)


@dataclass
class RequestContext:
    """DSN and user_id for the current request. From JWT when present, else header/query."""
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
    Resolve DSN and user_id from JWT (Navixy) or header/query (standalone).
    When App Connect is enabled: requires valid Bearer token; uses only that user's stored
    iotDbUrl/userDbUrl. No fallback to header or default DSN, so sessions are isolated.
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
    # Standalone: header DSN and query user_id
    dsn = (x_sensoriqua_dsn and x_sensoriqua_dsn.strip()) or default_dsn
    uid = user_id_query if user_id_query is not None else default_user_id
    return RequestContext(dsn=dsn, app_state_dsn=None, user_id=uid)
