"""
Sensoriqua backend: grouping → objects → sensors → configured sensors + dashboard.
DSN: from JWT (Navixy App Connect) or env SENSORIQUA_DSN (standalone).
Client X-Sensoriqua-DSN / ?user_id= only when ALLOW_CLIENT_DSN / ALLOW_CLIENT_USER_ID are set.
Serves the frontend GUI from backend/static when that folder exists (e.g. after build).
"""
from pathlib import Path

# Load backend/.env before reading JWT_SECRET / CORS / other settings
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.is_file():
    try:
        from dotenv import load_dotenv

        load_dotenv(_env_path)
    except ImportError:
        pass

import logging
import os
import secrets
import time
import uuid
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse

import psycopg.errors
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import (
    RequestContext,
    create_token,
    get_request_context,
    is_app_connect_enabled,
    store_credentials,
)
from .db import (
    DEFAULT_DSN,
    get_conn,
    get_app_state_conn,
    app_state_table,
    request_uses_sqlite_app_state,
)
from .dsn_security import UnsafeDsnError, validate_dsn

logger = logging.getLogger("sensoriqua")

# OpenAPI: off by default when App Connect (JWT) is enabled; set ENABLE_OPENAPI=1 to expose /docs.
_ENABLE_OPENAPI_RAW = os.environ.get("ENABLE_OPENAPI", "").strip().lower()
if _ENABLE_OPENAPI_RAW in ("1", "true", "yes"):
    _openapi_on = True
elif _ENABLE_OPENAPI_RAW in ("0", "false", "no"):
    _openapi_on = False
else:
    _openapi_on = not is_app_connect_enabled()

app = FastAPI(
    title="Sensoriqua",
    version="0.1.0",
    docs_url="/docs" if _openapi_on else None,
    redoc_url="/redoc" if _openapi_on else None,
    openapi_url="/openapi.json" if _openapi_on else None,
)


@app.exception_handler(UnsafeDsnError)
async def unsafe_dsn_handler(_request: Request, exc: UnsafeDsnError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})

# CORS: with credentials (Bearer tokens) do not use allow_origins=["*"].
# Set CORS_ORIGINS to comma-separated origins (e.g. https://app.example.com,https://admin.example.com).
_cors_origins_raw = os.environ.get("CORS_ORIGINS", "").strip()
CORS_ORIGINS = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
if is_app_connect_enabled():
    # Same-origin (static GUI) needs no CORS; cross-origin API callers must set CORS_ORIGINS.
    if not CORS_ORIGINS:
        logger.warning(
            "JWT_SECRET is set but CORS_ORIGINS is empty: cross-origin browser API calls will be blocked. "
            "Set CORS_ORIGINS to your frontend origin(s)."
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS or [],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Sensoriqua-DSN", "X-Sensoriqua-Login-Key"],
    )
elif CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Sensoriqua-DSN", "X-Sensoriqua-Login-Key"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# Iframe embedding: default allows any origin so the app can run inside an iframe.
# Set ALLOW_FRAME_ORIGINS to restrict (comma-separated), e.g. https://app.navixy.com
# Set ALLOW_FRAME_ORIGINS=deny to send X-Frame-Options: DENY (no embedding).
_ALLOW_FRAME_ORIGINS = os.environ.get("ALLOW_FRAME_ORIGINS", "").strip()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    if _ALLOW_FRAME_ORIGINS.lower() == "deny":
        response.headers["X-Frame-Options"] = "DENY"
    elif _ALLOW_FRAME_ORIGINS:
        origins = _ALLOW_FRAME_ORIGINS if _ALLOW_FRAME_ORIGINS == "*" else " ".join(o.strip() for o in _ALLOW_FRAME_ORIGINS.split(",") if o.strip())
        response.headers["Content-Security-Policy"] = f"frame-ancestors {origins}"
    else:
        response.headers["Content-Security-Policy"] = "frame-ancestors *"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Default user_id for testing when no auth
DEFAULT_USER_ID = int(os.environ.get("SENSORIQUA_USER_ID", "1"))

# When frontend is built into backend/static (e.g. on Render), we serve the GUI from /
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_SERVE_GUI = _STATIC_DIR.exists() and (_STATIC_DIR / "index.html").exists()


def _request_context(
    request: Request,
    x_sensoriqua_dsn: str | None = Header(None, alias="X-Sensoriqua-DSN"),
    user_id: int | None = Query(None),
) -> RequestContext:
    return get_request_context(
        request,
        x_sensoriqua_dsn=x_sensoriqua_dsn,
        user_id_query=user_id,
        default_user_id=DEFAULT_USER_ID,
        default_dsn=DEFAULT_DSN,
    )


# ---------- Pydantic models ----------

class GroupingQuery(BaseModel):
    type: str  # groups | tags | departments | garages
    search: str | None = None


class ObjectsFilter(BaseModel):
    group_ids: list[int] = []
    tag_ids: list[int] = []
    department_ids: list[int] = []
    garage_ids: list[int] = []
    sensor_type_ids: list[str] = []  # e.g. ["state", "tracking"] or sensor_type from sensor_description
    vehicle_ids: list[int] = []  # objects linked via vehicles.object_id
    employee_ids: list[int] = []  # objects linked via employees.object_id
    sensor_ids: list[int] = []  # objects whose device has sensor_description.sensor_id
    sensor_names: list[str] = []  # objects whose device has sensor_name in raw_telematics_data.inputs
    client_id: int | None = None  # optional tenant scope
    include_grouping_info: bool = False  # return group_label, tag_labels, department_label for UI grouping


SPARKLINE_HOURS_ALLOWED = (1, 2, 4, 8)


def _normalize_sparkline_hours(value: Any) -> int:
    try:
        h = int(value)
    except (TypeError, ValueError):
        return 1
    return h if h in SPARKLINE_HOURS_ALLOWED else 1


class ConfiguredSensorCreate(BaseModel):
    object_id: int
    device_id: int
    sensor_input_label: str
    sensor_source: str = "input"  # input | state | tracking
    sensor_id: int | None = None
    sensor_label_custom: str
    min_threshold: float | None = None
    max_threshold: float | None = None
    multiplier: float | None = None
    sparkline_hours: int = 1  # 1, 2, 4, or 8


class ConfiguredSensorUpdate(BaseModel):
    sensor_label_custom: str | None = None
    min_threshold: float | None = None
    max_threshold: float | None = None
    multiplier: float | None = None
    sparkline_hours: int | None = None


class DashboardPlaneCreate(BaseModel):
    configured_sensor_id: int
    position_index: int = 0


class SparklinesRequest(BaseModel):
    pairs: list[dict[str, Any]] = []  # [ {"device_id": 1, "sensor_input_label": "..." }, ... ]


class LatestValuesRequest(BaseModel):
    pairs: list[dict[str, Any]] = []


class SensorHistoryRequest(BaseModel):
    device_id: int
    sensor_input_label: str
    sensor_source: str = "input"  # input | state | tracking
    hours: int = 1  # 1, 4, 12, or 24 (used when from_ts/to_ts not provided)
    from_ts: str | None = None  # ISO datetime for report timeframe
    to_ts: str | None = None  # ISO datetime for report timeframe
    raw: bool = False  # if True, return raw rows (no time_bucket resampling)


class DashboardOrderRequest(BaseModel):
    order: list[dict[str, Any]] = []  # [ {"dashboard_plane_id": 1, "position_index": 0 }, ... ]


class AuthLoginRequest(BaseModel):
    """Navixy App Connect: payload from middleware."""
    email: str
    iotDbUrl: str
    userDbUrl: str
    role: str = "admin"


# ---------- Navixy App Connect: auth endpoint ----------

# Shared secret for login (header X-Sensoriqua-Login-Key). Optional for standard
# Navixy App Connect (middleware usually cannot send custom headers). When set, it is enforced.
LOGIN_API_KEY = os.environ.get("LOGIN_API_KEY", "").strip()
LOGIN_RATE_LIMIT_PER_MINUTE = max(1, int(os.environ.get("LOGIN_RATE_LIMIT_PER_MINUTE", "30")))
# Only trust X-Forwarded-For when behind a reverse proxy that sets it (otherwise spoofable).
TRUST_PROXY = os.environ.get("TRUST_PROXY", "").strip().lower() in ("1", "true", "yes")
# Refuse to start in standalone mode without JWT (use on public internet).
REQUIRE_AUTH = os.environ.get("REQUIRE_AUTH", "").strip().lower() in ("1", "true", "yes")
_login_attempts: dict[str, list[float]] = defaultdict(list)

if REQUIRE_AUTH and not is_app_connect_enabled():
    raise RuntimeError(
        "REQUIRE_AUTH=1 but JWT_SECRET is missing or shorter than 32 characters. "
        "Set a strong JWT_SECRET for public deployments."
    )
if is_app_connect_enabled() and not LOGIN_API_KEY:
    logger.warning(
        "JWT_SECRET is set without LOGIN_API_KEY: /api/auth/login accepts Navixy middleware "
        "without a shared secret (App Connect default). Set LOGIN_API_KEY if your middleware "
        "can send X-Sensoriqua-Login-Key."
    )
if is_app_connect_enabled() and not TRUST_PROXY:
    logger.warning(
        "TRUST_PROXY is unset: login rate limiting uses the direct TCP peer. "
        "Behind Render/nginx set TRUST_PROXY=1 so X-Forwarded-For is used."
    )


def _client_ip(request: Request) -> str:
    if TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _check_login_rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    now = time.time()
    window = 60.0
    attempts = _login_attempts[ip]
    _login_attempts[ip] = [t for t in attempts if now - t < window]
    if len(_login_attempts[ip]) >= LOGIN_RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Too many login attempts; try again later")
    _login_attempts[ip].append(now)


def _login_api_key_ok(provided: str | None) -> bool:
    if not LOGIN_API_KEY:
        return True
    if not provided:
        return False
    a = provided.encode("utf-8")
    b = LOGIN_API_KEY.encode("utf-8")
    if len(a) != len(b):
        return False
    return secrets.compare_digest(a, b)


def _validate_dsn_for_login(dsn: str, name: str) -> None:
    """Login-time DSN check; connect-time pin happens again in get_conn()."""
    try:
        validate_dsn(dsn)
    except UnsafeDsnError as e:
        raise HTTPException(status_code=400, detail=f"{name}: {e}") from e


@app.post("/api/auth/login")
def auth_login(
    body: AuthLoginRequest,
    request: Request,
    x_login_key: str | None = Header(None, alias="X-Sensoriqua-Login-Key"),
):
    """
    Navixy App Connect: middleware calls this with user info and DB URLs.
    Returns JWT; store iotDbUrl/userDbUrl server-side for this user.
    Requires JWT_SECRET (min 32 chars) in env.
    Optional LOGIN_API_KEY: when set, require matching X-Sensoriqua-Login-Key
    (standard Navixy middleware does not send this header — leave LOGIN_API_KEY unset).
    Rate-limited per client IP. DSNs validated with DNS-aware private IP checks;
    every later get_conn() re-validates and pins hostaddr (DNS rebinding mitigation).
    """
    if not is_app_connect_enabled():
        raise HTTPException(
            status_code=501,
            detail="Navixy App Connect not configured (set JWT_SECRET with at least 32 characters)",
        )
    _check_login_rate_limit(request)
    # When LOGIN_API_KEY is configured, enforce it. When empty, allow Navixy middleware login
    # (App Connect contract has no shared-secret header).
    if LOGIN_API_KEY and not _login_api_key_ok(x_login_key):
        raise HTTPException(status_code=401, detail="Invalid or missing login API key")
    if not body.email or not body.iotDbUrl or not body.userDbUrl:
        raise HTTPException(
            status_code=400,
            detail="Missing required fields: email, iotDbUrl, userDbUrl",
        )
    _validate_dsn_for_login(body.iotDbUrl, "iotDbUrl")
    _validate_dsn_for_login(body.userDbUrl, "userDbUrl")
    user_id = str(uuid.uuid4())
    store_credentials(user_id, body.iotDbUrl, body.userDbUrl)
    token = create_token(user_id, body.email, body.role or "admin")
    logger.info("App Connect login ok for email=%s user_id=%s", body.email, user_id)
    return {
        "success": True,
        "user": {"id": user_id, "email": body.email, "role": body.role or "admin"},
        "token": token,
    }


# ---------- Config (DSN at top for testing) ----------

@app.get("/api/config")
def get_config(ctx: RequestContext = Depends(_request_context)):
    """Return default DSN (masked) for display at top of UI. Password hidden."""
    dsn = ctx.dsn
    if "@" in dsn and "://" in dsn:
        try:
            from urllib.parse import urlparse
            p = urlparse(dsn)
            if p.password:
                netloc = p.hostname or ""
                if p.port:
                    netloc += f":{p.port}"
                dsn_display = f"{p.scheme}://{p.username}:***@{netloc}{p.path or '/'}"
            else:
                dsn_display = dsn
        except Exception:
            dsn_display = dsn
    else:
        dsn_display = dsn
    return {"dsn_placeholder": dsn_display, "default_user_id": ctx.user_id}


# ---------- Groupings ----------

@app.get("/api/groupings")
def list_groupings(
    type: str = Query(
        ...,
        description="groups | tags | departments | garages | sensor_types | vehicles | employees | sensor_names",
    ),
    search: str | None = Query(None),
    ctx: RequestContext = Depends(_request_context),
):
    schema = "raw_business_data"
    schema_tel = "raw_telematics_data"
    dsn = ctx.dsn
    with get_conn(dsn) as conn:
        if type == "sensor_types":
            # Distinct sensor_type from sensor_description + fixed "state" and "tracking"
            out_sensor_types: list[dict[str, Any]] = []
            try:
                cur = conn.execute(
                    f"""
                    SELECT DISTINCT sensor_type AS id
                    FROM {schema}.sensor_description
                    WHERE sensor_type IS NOT NULL AND sensor_type != ''
                    ORDER BY sensor_type
                    """
                )
                for r in cur.fetchall():
                    st = str(r["id"])
                    out_sensor_types.append({"id": st, "label": st})
            except Exception:
                pass
            for sid, label in [("state", "State"), ("tracking", "Tracking")]:
                if not search or search.lower() in label.lower() or search.lower() in sid.lower():
                    out_sensor_types.append({"id": sid, "label": label})
            return out_sensor_types
        if type == "groups":
            q = f"""
                SELECT group_id AS id, group_label AS label
                FROM {schema}.groups
                WHERE 1=1
            """
            if search:
                q += " AND group_label ILIKE %(search)s"
            q += " ORDER BY group_label"
            cur = conn.execute(q, {"search": f"%{search}%" if search else None})
        elif type == "tags":
            q = f"""
                SELECT tag_id AS id, tag_label AS label
                FROM {schema}.tags
                WHERE 1=1
            """
            if search:
                q += " AND tag_label ILIKE %(search)s"
            q += " ORDER BY tag_label"
            cur = conn.execute(q, {"search": f"%{search}%" if search else None})
        elif type == "departments":
            q = f"""
                SELECT department_id AS id, department_label AS label
                FROM {schema}.departments
                WHERE 1=1
            """
            if search:
                q += " AND department_label ILIKE %(search)s"
            q += " ORDER BY department_label"
            cur = conn.execute(q, {"search": f"%{search}%" if search else None})
        elif type == "garages":
            # Schema: garages has organization_label, no garage_label
            q = f"""
                SELECT garage_id AS id, COALESCE(organization_label, 'Garage ' || garage_id::text) AS label
                FROM {schema}.garages
                WHERE 1=1
            """
            if search:
                q += " AND organization_label ILIKE %(search)s"
            q += " ORDER BY label"
            cur = conn.execute(q, {"search": f"%{search}%" if search else None})
        elif type == "vehicles":
            # Fleet assets: vehicles.object_id -> objects; label from common column names if present
            rows = []
            try:
                cur = conn.execute(
                    f"""
                    SELECT v.vehicle_id AS id,
                           COALESCE(
                               NULLIF(TRIM(COALESCE(v.registration_number::text, v.vehicle_label::text, v.name::text, '')), ''),
                               'Vehicle ' || v.vehicle_id::text
                           ) AS label
                    FROM {schema}.vehicles v
                    WHERE v.object_id IS NOT NULL
                    ORDER BY label
                    """
                )
                rows = cur.fetchall()
            except Exception:
                try:
                    cur = conn.execute(
                        f"""
                        SELECT vehicle_id AS id, 'Vehicle ' || vehicle_id::text AS label
                        FROM {schema}.vehicles
                        WHERE object_id IS NOT NULL
                        ORDER BY vehicle_id
                        """
                    )
                    rows = cur.fetchall()
                except Exception:
                    rows = []
            if search and rows:
                s = search.lower()
                rows = [r for r in rows if s in str(r.get("label") or "").lower()]
            return [dict(r) for r in rows]
        elif type == "employees":
            rows = []
            try:
                cur = conn.execute(
                    f"""
                    SELECT e.employee_id AS id,
                           COALESCE(
                               NULLIF(TRIM(
                                   COALESCE(
                                       NULLIF(TRIM(e.full_name::text), ''),
                                       NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ''),
                                       NULLIF(TRIM(e.employee_name::text), ''),
                                       ''
                                   )
                               ), ''),
                               'Employee ' || e.employee_id::text
                           ) AS label
                    FROM {schema}.employees e
                    WHERE e.object_id IS NOT NULL
                    ORDER BY label
                    """
                )
                rows = cur.fetchall()
            except Exception:
                try:
                    cur = conn.execute(
                        f"""
                        SELECT employee_id AS id, 'Employee ' || employee_id::text AS label
                        FROM {schema}.employees
                        WHERE object_id IS NOT NULL
                        ORDER BY employee_id
                        """
                    )
                    rows = cur.fetchall()
                except Exception:
                    rows = []
            if search and rows:
                s = search.lower()
                rows = [r for r in rows if s in str(r.get("label") or "").lower()]
            return [dict(r) for r in rows]
        elif type == "sensor_names":
            # All distinct sensor_name from raw_telematics_data.inputs
            out_sn: list[dict[str, Any]] = []
            try:
                cur = conn.execute(
                    f"""
                    SELECT DISTINCT i.sensor_name
                    FROM {schema_tel}.inputs i
                    WHERE i.sensor_name IS NOT NULL AND TRIM(i.sensor_name) != ''
                    ORDER BY i.sensor_name
                    """
                )
                for r in cur.fetchall():
                    name = str(r["sensor_name"]).strip()
                    if name:
                        out_sn.append({"id": name, "label": name})
            except Exception:
                pass
            if search:
                s = search.lower()
                out_sn = [x for x in out_sn if s in str(x.get("label") or "").lower()]
            return out_sn
        else:
            raise HTTPException(
                400,
                "type must be groups|tags|departments|garages|sensor_types|vehicles|employees|sensor_names",
            )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


# ---------- Objects (filtered by groupings) ----------

@app.post("/api/objects")
def list_objects(
    body: ObjectsFilter,
    ctx: RequestContext = Depends(_request_context),
):
    """Return objects matching any of the selected groupings (OR across types).
    Schema: objects.group_id -> groups; tag_links(entity_id=object_id, entity_type=int, tag_id) -> tags.
    If grouping_info query fails, falls back to plain list so UI always gets objects.
    """
    dsn = ctx.dsn
    schema = "raw_business_data"
    schema_tel = "raw_telematics_data"
    conditions = []
    params: dict[str, Any] = {}
    if body.group_ids:
        conditions.append("o.group_id = ANY(%(group_ids)s)")
        params["group_ids"] = body.group_ids
    if body.tag_ids:
        # Deep tag resolution: tag_links(tag_id, entity_type, entity_id) -> resolve to object_id -> objects.device_id
        # Handles: object (direct), vehicle (via vehicles.object_id), employee (via employees.object_id)
        entity_type_object = int(os.environ.get("SENSORIQUA_TAG_ENTITY_TYPE_OBJECT", "1"))
        entity_type_vehicle = os.environ.get("SENSORIQUA_TAG_ENTITY_TYPE_VEHICLE", "2").strip()
        entity_type_employee = os.environ.get("SENSORIQUA_TAG_ENTITY_TYPE_EMPLOYEE", "3").strip()
        tag_conds = [
            "(tl.entity_type = %(tag_entity_type_object)s AND tl.entity_id = o.object_id)"
        ]
        params["tag_entity_type_object"] = entity_type_object
        params["tag_ids"] = body.tag_ids
        ve_joins = ""
        if entity_type_vehicle:
            tag_conds.append(
                "(tl.entity_type = %(tag_entity_type_vehicle)s AND tl.entity_id = v_tag.vehicle_id AND v_tag.object_id = o.object_id)"
            )
            params["tag_entity_type_vehicle"] = int(entity_type_vehicle)
            ve_joins += f"""
                LEFT JOIN {schema}.vehicles v_tag ON tl.entity_type = %(tag_entity_type_vehicle)s AND tl.entity_id = v_tag.vehicle_id
            """
        if entity_type_employee:
            tag_conds.append(
                "(tl.entity_type = %(tag_entity_type_employee)s AND tl.entity_id = e_tag.employee_id AND e_tag.object_id = o.object_id)"
            )
            params["tag_entity_type_employee"] = int(entity_type_employee)
            ve_joins += f"""
                LEFT JOIN {schema}.employees e_tag ON tl.entity_type = %(tag_entity_type_employee)s AND tl.entity_id = e_tag.employee_id
            """
        conditions.append(f"""
            EXISTS (
                SELECT 1 FROM raw_business_data.tag_links tl
                {ve_joins}
                WHERE tl.tag_id = ANY(%(tag_ids)s)
                  AND ({' OR '.join(tag_conds)})
            )
        """)
    if body.department_ids:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM raw_business_data.employees e
                WHERE e.object_id = o.object_id
                  AND e.department_id = ANY(%(department_ids)s)
            )
        """)
        params["department_ids"] = body.department_ids
    if body.garage_ids:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM raw_business_data.vehicles v
                WHERE v.object_id = o.object_id
                  AND v.garage_id = ANY(%(garage_ids)s)
            )
        """)
        params["garage_ids"] = body.garage_ids
    if body.vehicle_ids:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM raw_business_data.vehicles v
                WHERE v.object_id = o.object_id
                  AND v.vehicle_id = ANY(%(vehicle_ids)s)
            )
        """)
        params["vehicle_ids"] = body.vehicle_ids
    if body.employee_ids:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM raw_business_data.employees e
                WHERE e.object_id = o.object_id
                  AND e.employee_id = ANY(%(employee_ids)s)
            )
        """)
        params["employee_ids"] = body.employee_ids
    if body.sensor_ids:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM raw_business_data.sensor_description sd
                WHERE sd.device_id = o.device_id
                  AND sd.sensor_id = ANY(%(sensor_ids)s)
            )
        """)
        params["sensor_ids"] = body.sensor_ids
    if body.sensor_names:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM raw_telematics_data.inputs i
                WHERE i.device_id = o.device_id
                  AND i.sensor_name = ANY(%(sensor_names)s)
            )
        """)
        params["sensor_names"] = body.sensor_names

    if body.sensor_type_ids:
        # Objects whose device has at least one sensor of any of the selected types
        # "state" -> device in states; "tracking" -> device in tracking_data_core; else -> sensor_type from sensor_description
        type_conds = []
        state_ids = [t for t in body.sensor_type_ids if t == "state"]
        tracking_ids = [t for t in body.sensor_type_ids if t == "tracking"]
        other_ids = [t for t in body.sensor_type_ids if t not in ("state", "tracking")]
        if state_ids:
            type_conds.append(f"o.device_id IN (SELECT DISTINCT device_id FROM {schema_tel}.states)")
        if tracking_ids:
            type_conds.append(f"o.device_id IN (SELECT DISTINCT device_id FROM {schema_tel}.tracking_data_core)")
        if other_ids:
            type_conds.append(
                f"o.device_id IN (SELECT DISTINCT device_id FROM {schema}.sensor_description WHERE sensor_type = ANY(%(sensor_type_ids)s))"
            )
            params["sensor_type_ids"] = other_ids
        if type_conds:
            conditions.append("(" + " OR ".join(type_conds) + ")")

    out: list[dict[str, Any]] = []
    try:
        with get_conn(dsn) as conn:
            if body.include_grouping_info:
                _entity_type_obj = int(os.environ.get("SENSORIQUA_TAG_ENTITY_TYPE_OBJECT", "1"))
                params["_tag_entity_type"] = _entity_type_obj
                sel = f"""o.object_id AS id, o.object_label AS label, o.device_id, o.group_id,
                    g.group_label,
                    (SELECT COALESCE(array_agg(t.tag_label) FILTER (WHERE t.tag_label IS NOT NULL), '{{}}')
                     FROM {schema}.tag_links tl LEFT JOIN {schema}.tags t ON t.tag_id = tl.tag_id
                     WHERE tl.entity_id = o.object_id AND tl.entity_type = %(_tag_entity_type)s) AS tag_labels,
                    (SELECT d.department_label FROM {schema}.employees e
                     JOIN {schema}.departments d ON d.department_id = e.department_id
                     WHERE e.object_id = o.object_id LIMIT 1) AS department_label,
                    (SELECT COALESCE(NULLIF(TRIM(v.registration_number::text), ''),
                       NULLIF(TRIM(v.vehicle_label::text), ''),
                       NULLIF(TRIM(v.name::text), ''),
                       'Vehicle ' || v.vehicle_id::text)
                     FROM {schema}.vehicles v WHERE v.object_id = o.object_id LIMIT 1) AS vehicle_label,
                    (SELECT COALESCE(NULLIF(TRIM(e.full_name::text), ''),
                       NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ''),
                       NULLIF(TRIM(e.employee_name::text), ''),
                       'Employee ' || e.employee_id::text)
                     FROM {schema}.employees e WHERE e.object_id = o.object_id LIMIT 1) AS employee_label"""
                joins = f"LEFT JOIN {schema}.groups g ON g.group_id = o.group_id"
                if not conditions:
                    where = "o.is_deleted = false"
                    if body.client_id is not None:
                        where += " AND o.client_id = %(client_id)s"
                        params["client_id"] = body.client_id
                    sql = f"""
                        SELECT {sel}
                        FROM {schema}.objects o
                        {joins}
                        WHERE {where}
                        ORDER BY o.object_label
                    """
                else:
                    where = " AND ".join(conditions)
                    where = f"o.is_deleted = false AND ({where})"
                    if body.client_id is not None:
                        where += " AND o.client_id = %(client_id)s"
                        params["client_id"] = body.client_id
                    sql = f"""
                        SELECT DISTINCT ON (o.object_id) {sel}
                        FROM {schema}.objects o
                        {joins}
                        WHERE {where}
                        ORDER BY o.object_id, o.object_label
                    """
            else:
                if not conditions:
                    where = "o.is_deleted = false"
                    if body.client_id is not None:
                        where += " AND o.client_id = %(client_id)s"
                        params["client_id"] = body.client_id
                    sql = f"""
                        SELECT o.object_id AS id, o.object_label AS label, o.device_id
                        FROM {schema}.objects o
                        WHERE {where}
                        ORDER BY o.object_label
                    """
                else:
                    where = " AND ".join(conditions)
                    where = f"o.is_deleted = false AND ({where})"
                    if body.client_id is not None:
                        where += " AND o.client_id = %(client_id)s"
                        params["client_id"] = body.client_id
                    sql = f"""
                        SELECT DISTINCT o.object_id AS id, o.object_label AS label, o.device_id
                        FROM {schema}.objects o
                        WHERE {where}
                        ORDER BY o.object_label
                    """
            cur = conn.execute(sql, params)
            rows = cur.fetchall()
        out = [dict(r) for r in rows]
        if body.include_grouping_info and out:
            for row in out:
                if "tag_labels" in row and hasattr(row["tag_labels"], "__iter__") and not isinstance(row["tag_labels"], str):
                    row["tag_labels"] = list(row["tag_labels"]) if row["tag_labels"] is not None else []
                else:
                    row["tag_labels"] = getattr(row.get("tag_labels"), "__iter__", None) and list(row["tag_labels"]) or []
    except Exception:
        with get_conn(dsn) as conn:
            if not conditions:
                where = "o.is_deleted = false"
                if body.client_id is not None:
                    where += " AND o.client_id = %(client_id)s"
                    params["client_id"] = body.client_id
                sql = f"""
                    SELECT o.object_id AS id, o.object_label AS label, o.device_id
                    FROM {schema}.objects o
                    WHERE {where}
                    ORDER BY o.object_label
                """
            else:
                where = " AND ".join(conditions)
                where = f"o.is_deleted = false AND ({where})"
                if body.client_id is not None:
                    where += " AND o.client_id = %(client_id)s"
                    params["client_id"] = body.client_id
                sql = f"""
                    SELECT DISTINCT o.object_id AS id, o.object_label AS label, o.device_id
                    FROM {schema}.objects o
                    WHERE {where}
                    ORDER BY o.object_label
                """
            cur = conn.execute(sql, params)
            rows = cur.fetchall()
        for r in rows:
            row = dict(r)
            row["group_id"] = None
            row["group_label"] = None
            row["tag_labels"] = []
            row["department_label"] = None
            row["vehicle_label"] = None
            row["employee_label"] = None
            out.append(row)
    return out


# Telematics: tracking_data_core value columns (no sensor_name column; use column names)
TRACKING_DATA_CORE_SIGNALS = [
    "latitude", "longitude", "speed", "altitude", "satellites", "hdop", "gps_fix_type", "event_id",
]


# ---------- Sensors per object ----------

@app.get("/api/objects/{object_id:int}/sensors")
def list_sensors_for_object(
    object_id: int,
    search: str | None = Query(None),
    include_type_and_params: bool = Query(True),
    ctx: RequestContext = Depends(_request_context),
):
    """Combined distinct sensor list from raw_telematics_data: inputs (sensor_name), states (state_name), tracking_data_core (column names)."""
    dsn = ctx.dsn
    schema_biz = "raw_business_data"
    schema_tel = "raw_telematics_data"
    with get_conn(dsn) as conn:
        cur = conn.execute(
            f"SELECT device_id FROM {schema_biz}.objects WHERE object_id = %s",
            (object_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Object not found")
        device_id = row["device_id"]
        if not device_id:
            return []
        out: list[dict[str, Any]] = []

        # 1) Distinct sensor_name from inputs (join sensor_description for label/type)
        try:
            cur = conn.execute(
                f"""
                SELECT DISTINCT i.sensor_name AS input_label
                FROM {schema_tel}.inputs i
                WHERE i.device_id = %s
                ORDER BY i.sensor_name
                """,
                (device_id,),
            )
            input_names = [r["input_label"] for r in cur.fetchall()]
        except Exception:
            input_names = []
        sd_map: dict[str, dict] = {}
        if input_names:
            try:
                cur = conn.execute(
                    f"""
                    SELECT sensor_id, sensor_label, input_label, sensor_type, sensor_units, units_type
                    FROM {schema_biz}.sensor_description
                    WHERE device_id = %s AND input_label = ANY(%s)
                    """,
                    (device_id, input_names),
                )
                for r in cur.fetchall():
                    sd_map[r["input_label"]] = dict(r)
            except Exception:
                pass
        units_lookup: dict[int, str] = {}
        try:
            cur = conn.execute(
                f"""
                SELECT key, type, description FROM {schema_biz}.description_parametrs
                WHERE type = 'sensor_description_units_type'
                """
            )
            units_lookup = {r["key"]: r["description"] for r in cur.fetchall()}
        except Exception:
            pass
        for name in input_names:
            sd = sd_map.get(name) or {}
            dp = []
            if sd.get("units_type") is not None and sd["units_type"] in units_lookup:
                dp = [{"name": "units_type", "value": units_lookup[sd["units_type"]]}]
            out.append({
                "source": "input",
                "sensor_id": sd.get("sensor_id"),
                "input_label": name,
                "label": (sd.get("sensor_label") or name) or "",
                "sensor_type": sd.get("sensor_type"),
                "sensor_units": sd.get("sensor_units"),
                "description_parameters": dp,
            })

        # 2) Distinct state_name from states
        try:
            cur = conn.execute(
                f"""
                SELECT DISTINCT state_name AS input_label
                FROM {schema_tel}.states
                WHERE device_id = %s
                ORDER BY state_name
                """,
                (device_id,),
            )
            for r in cur.fetchall():
                name = r["input_label"]
                out.append({
                    "source": "state",
                    "sensor_id": None,
                    "input_label": name,
                    "label": name,
                    "sensor_type": "state",
                    "sensor_units": None,
                    "description_parameters": [],
                })
        except Exception:
            pass

        # 3) tracking_data_core: fixed list of value column names
        for name in TRACKING_DATA_CORE_SIGNALS:
            out.append({
                "source": "tracking",
                "sensor_id": None,
                "input_label": name,
                "label": name,
                "sensor_type": "tracking_data_core",
                "sensor_units": None,
                "description_parameters": [],
            })

    if search:
        search_lower = search.lower()
        out = [
            x for x in out
            if search_lower in (x.get("label") or "").lower()
            or search_lower in (x.get("input_label") or "").lower()
            or search_lower in (x.get("sensor_type") or "").lower()
        ]
    return out


# ---------- Configured sensors CRUD ----------

def _fetch_configured_sensor_row(
    conn: Any,
    cfg: str,
    uid: int,
    configured_sensor_id: int,
    dsn: str,
    use_sqlite: bool,
) -> dict[str, Any]:
    """Load one active configured sensor; tolerate missing optional columns on older schemas."""
    is_active = 1 if use_sqlite else True
    try:
        cur = conn.execute(
            f"""
            SELECT configured_sensor_id, object_id, device_id, sensor_input_label,
                   sensor_source, sensor_id, sensor_label_custom, min_threshold, max_threshold,
                   multiplier, sparkline_hours, created_at
            FROM {cfg}
            WHERE configured_sensor_id = %s AND user_id = %s AND is_active = {is_active}
            """,
            (configured_sensor_id, uid),
        )
        row = cur.fetchone()
    except psycopg.errors.UndefinedColumn:
        try:
            cur = conn.execute(
                f"""
                SELECT configured_sensor_id, object_id, device_id, sensor_input_label,
                       sensor_source, sensor_id, sensor_label_custom, min_threshold, max_threshold,
                       multiplier, created_at
                FROM {cfg}
                WHERE configured_sensor_id = %s AND user_id = %s AND is_active = {is_active}
                """,
                (configured_sensor_id, uid),
            )
            row = cur.fetchone()
            if row is not None:
                row = {**dict(row), "sparkline_hours": 1}
        except psycopg.errors.UndefinedColumn:
            cur = conn.execute(
                f"""
                SELECT configured_sensor_id, object_id, device_id, sensor_input_label,
                       sensor_id, sensor_label_custom, min_threshold, max_threshold, created_at
                FROM {cfg}
                WHERE configured_sensor_id = %s AND user_id = %s AND is_active = {is_active}
                """,
                (configured_sensor_id, uid),
            )
            row = cur.fetchone()
            if row is not None:
                row = {**dict(row), "sensor_source": "input", "multiplier": None, "sparkline_hours": 1}
    if row is None:
        raise HTTPException(404, "Configured sensor not found")
    out = dict(row)
    with get_conn(dsn) as pg:
        cur2 = pg.execute(
            "SELECT object_label FROM raw_business_data.objects WHERE object_id = %s",
            (out["object_id"],),
        )
        ob = cur2.fetchone()
    out["object_label"] = ob["object_label"] if ob else None
    return out


@app.get("/api/configured-sensors")
def list_configured_sensors(ctx: RequestContext = Depends(_request_context)):
    uid = ctx.user_id
    dsn = ctx.dsn
    use_sqlite = request_uses_sqlite_app_state(ctx.app_state_dsn)
    try:
        with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
            cfg = app_state_table("configured_sensors")
            if use_sqlite:
                cur = conn.execute(
                    f"""
                    SELECT configured_sensor_id, object_id, device_id, sensor_input_label,
                           sensor_source, sensor_id, sensor_label_custom, min_threshold, max_threshold,
                           multiplier, sparkline_hours, created_at
                    FROM {cfg}
                    WHERE user_id = %s AND is_active = 1
                    ORDER BY created_at DESC
                    """,
                    (uid,),
                )
                rows = cur.fetchall()
                if not rows:
                    return []
                object_ids = list({r["object_id"] for r in rows})
                labels: dict[Any, Any] = {}
                try:
                    with get_conn(dsn) as pg:
                        cur2 = pg.execute(
                            "SELECT object_id, object_label FROM raw_business_data.objects WHERE object_id = ANY(%s)",
                            (object_ids,),
                        )
                        labels = {r["object_id"]: r["object_label"] for r in cur2.fetchall()}
                except Exception:
                    logger.warning(
                        "configured_sensors list: could not load object labels",
                        exc_info=True,
                    )
                for r in rows:
                    r["object_label"] = labels.get(r["object_id"])
                return [dict(r) for r in rows]
            try:
                cur = conn.execute(
                    f"""
                    SELECT c.configured_sensor_id, c.object_id, c.device_id, c.sensor_input_label,
                           c.sensor_source, c.sensor_id, c.sensor_label_custom, c.min_threshold, c.max_threshold,
                           c.multiplier, c.sparkline_hours, c.created_at,
                           o.object_label
                    FROM {cfg} c
                    JOIN raw_business_data.objects o ON o.object_id = c.object_id
                    WHERE c.user_id = %s AND c.is_active = true
                    ORDER BY c.created_at DESC
                    """,
                    (uid,),
                )
                rows = cur.fetchall()
            except psycopg.errors.UndefinedColumn:
                try:
                    cur = conn.execute(
                        f"""
                        SELECT c.configured_sensor_id, c.object_id, c.device_id, c.sensor_input_label,
                               c.sensor_source, c.sensor_id, c.sensor_label_custom, c.min_threshold, c.max_threshold,
                               c.multiplier, c.created_at,
                               o.object_label
                        FROM {cfg} c
                        JOIN raw_business_data.objects o ON o.object_id = c.object_id
                        WHERE c.user_id = %s AND c.is_active = true
                        ORDER BY c.created_at DESC
                        """,
                        (uid,),
                    )
                    rows = [{**dict(r), "sparkline_hours": 1} for r in cur.fetchall()]
                except psycopg.errors.UndefinedColumn:
                    cur = conn.execute(
                        f"""
                        SELECT c.configured_sensor_id, c.object_id, c.device_id, c.sensor_input_label,
                               c.sensor_id, c.sensor_label_custom, c.min_threshold, c.max_threshold,
                               c.created_at,
                               o.object_label
                        FROM {cfg} c
                        JOIN raw_business_data.objects o ON o.object_id = c.object_id
                        WHERE c.user_id = %s AND c.is_active = true
                        ORDER BY c.created_at DESC
                        """,
                        (uid,),
                    )
                    rows = [{**dict(r), "sensor_source": "input", "multiplier": None, "sparkline_hours": 1} for r in cur.fetchall()]
            return [dict(r) for r in rows]
    except psycopg.errors.UndefinedTable:
        return []


@app.post("/api/configured-sensors")
def add_configured_sensor(
    body: ConfiguredSensorCreate,
    ctx: RequestContext = Depends(_request_context),
):
    uid = ctx.user_id
    if body.min_threshold is not None and body.max_threshold is not None and body.min_threshold >= body.max_threshold:
        raise HTTPException(400, "MIN must be less than MAX")
    sparkline_hours = _normalize_sparkline_hours(body.sparkline_hours)
    dsn = ctx.dsn
    source = (body.sensor_source or "input").strip().lower()
    if source not in ("input", "state", "tracking"):
        source = "input"
    use_sqlite = request_uses_sqlite_app_state(ctx.app_state_dsn)
    try:
        with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
            cfg = app_state_table("configured_sensors")
            row = None
            if use_sqlite:
                cur = conn.execute(
                    f"""
                    INSERT INTO {cfg}
                    (user_id, object_id, device_id, sensor_input_label, sensor_source, sensor_id, sensor_label_custom, min_threshold, max_threshold, multiplier, sparkline_hours)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING configured_sensor_id, object_id, device_id, sensor_input_label, sensor_source, sensor_label_custom, min_threshold, max_threshold, multiplier, sparkline_hours, created_at
                    """,
                    (
                        uid,
                        body.object_id,
                        body.device_id,
                        body.sensor_input_label,
                        source,
                        body.sensor_id,
                        body.sensor_label_custom,
                        body.min_threshold,
                        body.max_threshold,
                        body.multiplier,
                        sparkline_hours,
                    ),
                )
                row = cur.fetchone()
            else:
                try:
                    cur = conn.execute(
                        f"""
                        INSERT INTO {cfg}
                        (user_id, object_id, device_id, sensor_input_label, sensor_source, sensor_id, sensor_label_custom, min_threshold, max_threshold, multiplier, sparkline_hours)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING configured_sensor_id, object_id, device_id, sensor_input_label, sensor_source, sensor_label_custom, min_threshold, max_threshold, multiplier, sparkline_hours, created_at
                        """,
                        (
                            uid,
                            body.object_id,
                            body.device_id,
                            body.sensor_input_label,
                            source,
                            body.sensor_id,
                            body.sensor_label_custom,
                            body.min_threshold,
                            body.max_threshold,
                            body.multiplier,
                            sparkline_hours,
                        ),
                    )
                    row = cur.fetchone()
                except psycopg.errors.UndefinedColumn:
                    cur = conn.execute(
                        f"""
                        INSERT INTO {cfg}
                        (user_id, object_id, device_id, sensor_input_label, sensor_id, sensor_label_custom, min_threshold, max_threshold)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING configured_sensor_id, object_id, device_id, sensor_input_label, sensor_label_custom, min_threshold, max_threshold, created_at
                        """,
                        (
                            uid,
                            body.object_id,
                            body.device_id,
                            body.sensor_input_label,
                            body.sensor_id,
                            body.sensor_label_custom,
                            body.min_threshold,
                            body.max_threshold,
                        ),
                    )
                    row = cur.fetchone()
                    if row is not None:
                        row = dict(row)
                        row["sensor_source"] = "input"
                        row["multiplier"] = None
                        row["sparkline_hours"] = sparkline_hours
            if row is None:
                raise HTTPException(status_code=500, detail="INSERT returned no row")
            conn.commit()
            out = dict(row)
            out["object_label"] = None
            # Label enrichment must not fail the create (iot DB may be slow/unreachable).
            try:
                with get_conn(dsn) as pg:
                    cur2 = pg.execute(
                        "SELECT object_label FROM raw_business_data.objects WHERE object_id = %s",
                        (body.object_id,),
                    )
                    ob = cur2.fetchone()
                if ob:
                    out["object_label"] = ob["object_label"]
            except Exception:
                logger.warning(
                    "configured_sensors create: could not load object_label for object_id=%s",
                    body.object_id,
                    exc_info=True,
                )
            return out
    except HTTPException:
        raise
    except psycopg.errors.UndefinedTable as e:
        if "configured_sensors" in str(e) or "app_sensoriqua" in str(e):
            raise HTTPException(
                status_code=503,
                detail="Configured sensors table not found. Add to backend/.env: SENSORIQUA_APP_STATE_DSN=sqlite:///./sensoriqua_state.db to use local storage without DB migrations (no app_sensoriqua schema required).",
            )
        logger.exception("configured_sensors create failed (UndefinedTable)")
        raise HTTPException(status_code=500, detail="Internal server error")
    except Exception:
        logger.exception("configured_sensors create failed")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.patch("/api/configured-sensors/{configured_sensor_id:int}")
def update_configured_sensor(
    configured_sensor_id: int,
    body: ConfiguredSensorUpdate,
    ctx: RequestContext = Depends(_request_context),
):
    uid = ctx.user_id
    if body.min_threshold is not None and body.max_threshold is not None and body.min_threshold >= body.max_threshold:
        raise HTTPException(400, "MIN must be less than MAX")
    if body.sparkline_hours is not None and body.sparkline_hours not in SPARKLINE_HOURS_ALLOWED:
        raise HTTPException(400, "sparkline_hours must be 1, 2, 4, or 8")
    dsn = ctx.dsn
    use_sqlite = request_uses_sqlite_app_state(ctx.app_state_dsn)
    updated_at = "datetime('now')" if use_sqlite else "now()"
    with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
        cfg = app_state_table("configured_sensors")
        updates = []
        params: list[Any] = []
        payload = body.model_dump(exclude_unset=True)
        if "sensor_label_custom" in payload:
            updates.append("sensor_label_custom = %s")
            params.append(body.sensor_label_custom)
        if "min_threshold" in payload:
            updates.append("min_threshold = %s")
            params.append(body.min_threshold)
        if "max_threshold" in payload:
            updates.append("max_threshold = %s")
            params.append(body.max_threshold)
        if "multiplier" in payload:
            updates.append("multiplier = %s")
            params.append(body.multiplier)
        if "sparkline_hours" in payload:
            updates.append("sparkline_hours = %s")
            params.append(_normalize_sparkline_hours(body.sparkline_hours))
        if not updates:
            raise HTTPException(400, "No fields to update")
        updates.append(f"updated_at = {updated_at}")
        params.extend([configured_sensor_id, uid])
        try:
            cur = conn.execute(
                f"UPDATE {cfg} SET {', '.join(updates)} WHERE configured_sensor_id = %s AND user_id = %s",
                params,
            )
        except psycopg.errors.UndefinedColumn:
            safe_updates = []
            safe_params: list[Any] = []
            for clause, val in zip(updates[:-1], params[: len(params) - 2]):
                col = clause.split(" = ")[0]
                if col in ("multiplier", "sparkline_hours"):
                    continue
                safe_updates.append(clause)
                safe_params.append(val)
            if not safe_updates:
                raise HTTPException(400, "No fields to update (schema missing optional columns)")
            safe_updates.append(f"updated_at = {updated_at}")
            safe_params.extend([configured_sensor_id, uid])
            cur = conn.execute(
                f"UPDATE {cfg} SET {', '.join(safe_updates)} WHERE configured_sensor_id = %s AND user_id = %s",
                safe_params,
            )
        if cur.rowcount == 0:
            raise HTTPException(404, "Configured sensor not found")
        conn.commit()
        return _fetch_configured_sensor_row(conn, cfg, uid, configured_sensor_id, dsn, use_sqlite)


@app.delete("/api/configured-sensors/{configured_sensor_id:int}")
def delete_configured_sensor(
    configured_sensor_id: int,
    ctx: RequestContext = Depends(_request_context),
):
    uid = ctx.user_id
    dsn = ctx.dsn
    use_sqlite = request_uses_sqlite_app_state(ctx.app_state_dsn)
    updated_at = "datetime('now')" if use_sqlite else "now()"
    is_active_val = 0 if use_sqlite else False
    with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
        cfg = app_state_table("configured_sensors")
        dp = app_state_table("dashboard_planes")
        # Remove dashboard widgets for this sensor so soft-deleted rows do not leave orphans.
        conn.execute(
            f"DELETE FROM {dp} WHERE configured_sensor_id = %s AND user_id = %s",
            (configured_sensor_id, uid),
        )
        cur = conn.execute(
            f"UPDATE {cfg} SET is_active = %s, updated_at = {updated_at} WHERE configured_sensor_id = %s AND user_id = %s",
            (is_active_val, configured_sensor_id, uid),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Configured sensor not found")
    return {"ok": True}


# ---------- Sparklines (batch, configurable hours per pair) ----------

def _series_key(device_id: int, label: str, source: str) -> str:
    return f"{device_id}:{source}:{label}"


def _sparkline_row_ts_value(r: dict, ts_field: str = "ts") -> dict:
    ts = r[ts_field]
    val = r["value"]
    return {
        "ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
        "value": float(val) if val is not None else None,
    }


def _fetch_sparklines_for_hours(
    conn: Any,
    has_tb: bool,
    normalized: list[tuple[int, str, str]],
    hours: int,
    series: dict[str, list[dict]],
) -> None:
    time_cond = "now() - make_interval(hours => %s)"

    input_keys = [(d, l) for (d, l, s) in normalized if s == "input"]
    if input_keys:
        placeholders = ",".join(["(%s,%s)"] * len(input_keys))
        flat = [x for k in input_keys for x in k] + [hours]
        bucket_expr = "time_bucket('1 minute', i.device_time)" if has_tb else "date_trunc('minute', i.device_time)"
        sql = f"""
            WITH cfg(device_id, sensor_name) AS (VALUES {placeholders}),
            series AS (
                SELECT i.device_id, i.sensor_name, {bucket_expr} AS bucket_ts,
                       avg(NULLIF(i.value,'')::numeric) AS value
                FROM raw_telematics_data.inputs i
                JOIN cfg ON cfg.device_id = i.device_id AND cfg.sensor_name = i.sensor_name
                WHERE i.device_time >= {time_cond}
                GROUP BY i.device_id, i.sensor_name, {bucket_expr}
            )
            SELECT device_id, sensor_name, bucket_ts AS ts, value FROM series ORDER BY device_id, sensor_name, ts
        """
        cur = conn.execute(sql, flat)
        for r in cur.fetchall():
            key = _series_key(r["device_id"], r["sensor_name"], "input")
            series.setdefault(key, []).append(_sparkline_row_ts_value(r))

    state_keys = [(d, l) for (d, l, s) in normalized if s == "state"]
    if state_keys:
        placeholders = ",".join(["(%s,%s)"] * len(state_keys))
        flat = [x for k in state_keys for x in k] + [hours]
        bucket_expr = "time_bucket('1 minute', s.device_time)" if has_tb else "date_trunc('minute', s.device_time)"
        sql = f"""
            WITH cfg(device_id, state_name) AS (VALUES {placeholders}),
            series AS (
                SELECT s.device_id, s.state_name AS sensor_name, {bucket_expr} AS bucket_ts,
                       avg(NULLIF(s.value,'')::numeric) AS value
                FROM raw_telematics_data.states s
                JOIN cfg ON cfg.device_id = s.device_id AND cfg.state_name = s.state_name
                WHERE s.device_time >= {time_cond}
                GROUP BY s.device_id, s.state_name, {bucket_expr}
            )
            SELECT device_id, sensor_name, bucket_ts AS ts, value FROM series ORDER BY device_id, sensor_name, ts
        """
        cur = conn.execute(sql, flat)
        for r in cur.fetchall():
            key = _series_key(r["device_id"], r["sensor_name"], "state")
            series.setdefault(key, []).append(_sparkline_row_ts_value(r))

    tracking_pairs = [(d, l) for (d, l, s) in normalized if s == "tracking" and l in TRACKING_DATA_CORE_SIGNALS]
    if tracking_pairs:
        col_to_devices: dict[str, list[int]] = {}
        for d, col in tracking_pairs:
            col_to_devices.setdefault(col, []).append(d)
        for col in col_to_devices:
            device_ids = list(dict.fromkeys(col_to_devices[col]))
            placeholders = ",".join(["%s"] * len(device_ids))
            bucket_expr = "time_bucket('1 minute', t.device_time)" if has_tb else "date_trunc('minute', t.device_time)"
            sql = f"""
                SELECT t.device_id, {bucket_expr} AS bucket_ts,
                       avg((t.{col})::numeric) AS value
                FROM raw_telematics_data.tracking_data_core t
                WHERE t.device_id IN ({placeholders}) AND t.device_time >= {time_cond}
                GROUP BY t.device_id, {bucket_expr}
                ORDER BY t.device_id, bucket_ts
            """
            cur = conn.execute(sql, (*device_ids, hours))
            for r in cur.fetchall():
                key = _series_key(r["device_id"], col, "tracking")
                series.setdefault(key, []).append(_sparkline_row_ts_value(r, ts_field="bucket_ts"))


@app.post("/api/sparklines")
def batch_sparklines(
    body: SparklinesRequest,
    ctx: RequestContext = Depends(_request_context),
):
    """Body: { "pairs": [ { "device_id", "sensor_input_label", "sensor_source"?, "hours"?: 1|2|4|8 }, ... ] }
    Returns: { "series": { "device_id:source:sensor_input_label": [ { "ts", "value" }, ... ] } }
    """
    pairs = body.pairs or []
    if not pairs:
        return {"series": {}}
    by_hours: dict[int, list[tuple[int, str, str]]] = {}
    for p in pairs:
        src = (p.get("sensor_source") or "input").strip().lower()
        if src not in ("input", "state", "tracking"):
            src = "input"
        hours = _normalize_sparkline_hours(p.get("hours"))
        by_hours.setdefault(hours, []).append((p["device_id"], p["sensor_input_label"], src))
    dsn = ctx.dsn
    series: dict[str, list[dict]] = {}
    with get_conn(dsn) as conn:
        cur = conn.execute(
            "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'timescale' AND p.proname = 'time_bucket') AS has_tb"
        )
        row_tb = cur.fetchone()
        has_tb = bool(row_tb and row_tb.get("has_tb"))
        for hours, normalized in by_hours.items():
            _fetch_sparklines_for_hours(conn, has_tb, normalized, hours, series)

    return {"series": series}


# ---------- Sensor history (single sensor, configurable duration) ----------

@app.post("/api/sensor-history")
def sensor_history(
    body: SensorHistoryRequest,
    ctx: RequestContext = Depends(_request_context),
):
    """Body: { "device_id", "sensor_input_label", "sensor_source"?, "hours"?, "from_ts"?, "to_ts"? }.
    If from_ts and to_ts are provided, use that timeframe; else use hours (1|4|12|24) from now.
    Returns: { "series": [ { "ts", "value" }, ... ] }.
    """
    use_date_range = bool(body.from_ts and body.to_ts)
    if use_date_range:
        try:
            from datetime import datetime
            datetime.fromisoformat(body.from_ts.replace("Z", "+00:00"))
            datetime.fromisoformat(body.to_ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="from_ts and to_ts must be valid ISO datetimes")
        time_params: tuple = (body.from_ts, body.to_ts)
    else:
        hours = body.hours
        if hours not in (1, 4, 12, 24):
            raise HTTPException(status_code=400, detail="hours must be 1, 4, 12, or 24")
        time_params = (hours,)
    src = (body.sensor_source or "input").strip().lower()
    if src not in ("input", "state", "tracking"):
        src = "input"
    if src == "tracking" and body.sensor_input_label not in TRACKING_DATA_CORE_SIGNALS:
        raise HTTPException(status_code=400, detail="sensor_input_label not allowed for tracking source")
    dsn = ctx.dsn
    series: list[dict] = []
    with get_conn(dsn) as conn:
        if use_date_range:
            time_cond = "AND i.device_time >= %s::timestamptz AND i.device_time <= %s::timestamptz"
        else:
            time_cond = "AND i.device_time >= now() - make_interval(hours => %s)"

        if body.raw:
            if src == "input":
                sql = f"""
                    SELECT i.device_time AS ts, NULLIF(i.value,'')::numeric AS value
                    FROM raw_telematics_data.inputs i
                    WHERE i.device_id = %s AND i.sensor_name = %s {time_cond}
                    ORDER BY i.device_time
                """
                cur = conn.execute(sql, (body.device_id, body.sensor_input_label) + time_params)
            elif src == "state":
                time_cond_s = time_cond.replace("i.device_time", "s.device_time")
                sql = f"""
                    SELECT s.device_time AS ts, NULLIF(s.value,'')::numeric AS value
                    FROM raw_telematics_data.states s
                    WHERE s.device_id = %s AND s.state_name = %s {time_cond_s}
                    ORDER BY s.device_time
                """
                cur = conn.execute(sql, (body.device_id, body.sensor_input_label) + time_params)
            else:
                col = body.sensor_input_label
                time_cond_t = time_cond.replace("i.device_time", "t.device_time")
                sql = f"""
                    SELECT t.device_time AS ts, (t.{col})::numeric AS value
                    FROM raw_telematics_data.tracking_data_core t
                    WHERE t.device_id = %s {time_cond_t}
                    ORDER BY t.device_time
                """
                cur = conn.execute(sql, (body.device_id,) + time_params)
            for r in cur.fetchall():
                series.append({
                    "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"]),
                    "value": float(r["value"]) if r["value"] is not None else None,
                })
        else:
            cur = conn.execute(
                "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'timescale' AND p.proname = 'time_bucket') AS has_tb"
            )
            row_tb = cur.fetchone()
            has_tb = bool(row_tb and row_tb.get("has_tb"))
            bucket_expr = "time_bucket('1 minute', device_time)" if has_tb else "date_trunc('minute', device_time)"

            if src == "input":
                sql = f"""
                    SELECT {bucket_expr.replace('device_time', 'i.device_time')} AS bucket_ts,
                           avg(NULLIF(i.value,'')::numeric) AS value
                    FROM raw_telematics_data.inputs i
                    WHERE i.device_id = %s AND i.sensor_name = %s
                      {time_cond.replace('i.device_time', 'i.device_time')}
                    GROUP BY {bucket_expr.replace('device_time', 'i.device_time')}
                    ORDER BY bucket_ts
                """
                cur = conn.execute(sql, (body.device_id, body.sensor_input_label) + time_params)
            elif src == "state":
                time_cond_s = time_cond.replace("i.device_time", "s.device_time")
                sql = f"""
                    SELECT {bucket_expr.replace('device_time', 's.device_time')} AS bucket_ts,
                           avg(NULLIF(s.value,'')::numeric) AS value
                    FROM raw_telematics_data.states s
                    WHERE s.device_id = %s AND s.state_name = %s
                      {time_cond_s}
                    GROUP BY {bucket_expr.replace('device_time', 's.device_time')}
                    ORDER BY bucket_ts
                """
                cur = conn.execute(sql, (body.device_id, body.sensor_input_label) + time_params)
            else:
                col = body.sensor_input_label
                time_cond_t = time_cond.replace("i.device_time", "t.device_time")
                sql = f"""
                    SELECT {bucket_expr.replace('device_time', 't.device_time')} AS bucket_ts,
                           avg((t.{col})::numeric) AS value
                    FROM raw_telematics_data.tracking_data_core t
                    WHERE t.device_id = %s {time_cond_t}
                    GROUP BY {bucket_expr.replace('device_time', 't.device_time')}
                    ORDER BY bucket_ts
                """
                cur = conn.execute(sql, (body.device_id,) + time_params)

            for r in cur.fetchall():
                series.append({
                    "ts": r["bucket_ts"].isoformat() if hasattr(r["bucket_ts"], "isoformat") else str(r["bucket_ts"]),
                    "value": float(r["value"]) if r["value"] is not None else None,
                })
    return {"series": series}


# ---------- Dashboard planes ----------

@app.get("/api/dashboard-planes")
def list_dashboard_planes(ctx: RequestContext = Depends(_request_context)):
    uid = ctx.user_id
    dsn = ctx.dsn
    use_sqlite = request_uses_sqlite_app_state(ctx.app_state_dsn)
    is_active = "1" if use_sqlite else "true"
    try:
        with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
            dp = app_state_table("dashboard_planes")
            cfg = app_state_table("configured_sensors")
            if use_sqlite:
                cur = conn.execute(
                    f"""
                    SELECT d.dashboard_plane_id, d.configured_sensor_id, d.position_index,
                           c.object_id, c.device_id, c.sensor_input_label, c.sensor_source, c.sensor_label_custom,
                           c.min_threshold, c.max_threshold, c.multiplier
                    FROM {dp} d
                    JOIN {cfg} c ON c.configured_sensor_id = d.configured_sensor_id AND c.is_active = {is_active}
                    WHERE d.user_id = %s
                    ORDER BY d.position_index, d.dashboard_plane_id
                    """,
                    (uid,),
                )
                rows = cur.fetchall()
                if not rows:
                    return []
                object_ids = list({r["object_id"] for r in rows})
                labels: dict[Any, Any] = {}
                try:
                    with get_conn(dsn) as pg:
                        cur2 = pg.execute(
                            "SELECT object_id, object_label FROM raw_business_data.objects WHERE object_id = ANY(%s)",
                            (object_ids,),
                        )
                        labels = {r["object_id"]: r["object_label"] for r in cur2.fetchall()}
                except Exception:
                    logger.warning(
                        "dashboard_planes list: could not load object labels",
                        exc_info=True,
                    )
                for r in rows:
                    r["object_label"] = labels.get(r["object_id"])
                return [dict(r) for r in rows]
            try:
                cur = conn.execute(
                    f"""
                    SELECT d.dashboard_plane_id, d.configured_sensor_id, d.position_index,
                           c.object_id, c.device_id, c.sensor_input_label, c.sensor_source, c.sensor_label_custom,
                           c.min_threshold, c.max_threshold, c.multiplier,
                           o.object_label
                    FROM {dp} d
                    JOIN {cfg} c ON c.configured_sensor_id = d.configured_sensor_id AND c.is_active = true
                    JOIN raw_business_data.objects o ON o.object_id = c.object_id
                    WHERE d.user_id = %s
                    ORDER BY d.position_index, d.dashboard_plane_id
                    """,
                    (uid,),
                )
                rows = cur.fetchall()
            except psycopg.errors.UndefinedColumn:
                cur = conn.execute(
                    f"""
                    SELECT d.dashboard_plane_id, d.configured_sensor_id, d.position_index,
                           c.object_id, c.device_id, c.sensor_input_label, c.sensor_label_custom,
                           c.min_threshold, c.max_threshold,
                           o.object_label
                    FROM {dp} d
                    JOIN {cfg} c ON c.configured_sensor_id = d.configured_sensor_id AND c.is_active = true
                    JOIN raw_business_data.objects o ON o.object_id = c.object_id
                    WHERE d.user_id = %s
                    ORDER BY d.position_index, d.dashboard_plane_id
                    """,
                    (uid,),
                )
                rows = cur.fetchall()
                rows = [{**dict(r), "sensor_source": "input", "multiplier": None} for r in rows]
            return [dict(r) for r in rows]
    except psycopg.errors.UndefinedTable:
        return []


@app.post("/api/dashboard-planes")
def add_dashboard_plane(
    body: DashboardPlaneCreate,
    ctx: RequestContext = Depends(_request_context),
):
    uid = ctx.user_id
    dsn = ctx.dsn
    use_sqlite = request_uses_sqlite_app_state(ctx.app_state_dsn)
    is_active = "1" if use_sqlite else "true"
    with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
        dp = app_state_table("dashboard_planes")
        cfg = app_state_table("configured_sensors")
        cur = conn.execute(
            f"SELECT 1 FROM {cfg} WHERE configured_sensor_id = %s AND user_id = %s AND is_active = {is_active}",
            (body.configured_sensor_id, uid),
        )
        if cur.fetchone() is None:
            raise HTTPException(403, "Configured sensor not found or access denied")
        cur = conn.execute(
            f"""
            INSERT INTO {dp} (user_id, configured_sensor_id, position_index)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, configured_sensor_id) DO UPDATE SET position_index = EXCLUDED.position_index
            RETURNING dashboard_plane_id, configured_sensor_id, position_index
            """,
            (uid, body.configured_sensor_id, body.position_index),
        )
        row = cur.fetchone()
        conn.commit()
    return dict(row)


@app.delete("/api/dashboard-planes/{dashboard_plane_id:int}")
def remove_dashboard_plane(
    dashboard_plane_id: int,
    ctx: RequestContext = Depends(_request_context),
):
    uid = ctx.user_id
    dsn = ctx.dsn
    with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
        dp = app_state_table("dashboard_planes")
        cur = conn.execute(
            f"DELETE FROM {dp} WHERE dashboard_plane_id = %s AND user_id = %s",
            (dashboard_plane_id, uid),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Dashboard plane not found")
    return {"ok": True}


@app.patch("/api/dashboard-planes/order")
def reorder_dashboard_planes(
    body: DashboardOrderRequest,
    ctx: RequestContext = Depends(_request_context),
):
    """Body: { "order": [ { "dashboard_plane_id": 1, "position_index": 0 }, ... ] }"""
    uid = ctx.user_id
    order = body.order or []
    dsn = ctx.dsn
    with get_app_state_conn(dsn, override_dsn=ctx.app_state_dsn) as conn:
        dp = app_state_table("dashboard_planes")
        for item in order:
            pid = item.get("dashboard_plane_id")
            idx = item.get("position_index", 0)
            if pid is not None:
                conn.execute(
                    f"UPDATE {dp} SET position_index = %s WHERE dashboard_plane_id = %s AND user_id = %s",
                    (idx, pid, uid),
                )
        conn.commit()
    return {"ok": True}


# ---------- Map condition fields (distinct telematics names for filter UI) ----------

@app.get("/api/map-condition-fields")
def map_condition_fields(ctx: RequestContext = Depends(_request_context)):
    """Distinct sensor_name from inputs and state_name from states (raw_telematics_data)."""
    schema_tel = "raw_telematics_data"
    dsn = ctx.dsn
    inputs: list[str] = []
    states: list[str] = []
    try:
        with get_conn(dsn) as conn:
            cur = conn.execute(
                f"""
                SELECT DISTINCT i.sensor_name AS n
                FROM {schema_tel}.inputs i
                WHERE i.sensor_name IS NOT NULL AND TRIM(i.sensor_name::text) != ''
                ORDER BY i.sensor_name
                """
            )
            inputs = [str(r["n"]).strip() for r in cur.fetchall() if r.get("n")]
            cur = conn.execute(
                f"""
                SELECT DISTINCT s.state_name AS n
                FROM {schema_tel}.states s
                WHERE s.state_name IS NOT NULL AND TRIM(s.state_name::text) != ''
                ORDER BY s.state_name
                """
            )
            states = [str(r["n"]).strip() for r in cur.fetchall() if r.get("n")]
    except Exception:
        pass
    return {"inputs": inputs, "states": states}


# ---------- Map positions (latest lat/lon from same tracking row per device) ----------

@app.post("/api/map-positions")
def batch_map_positions(
    body: dict[str, Any],
    ctx: RequestContext = Depends(_request_context),
):
    """Body: { "device_ids": [ 1, 2, 3 ] }
    Returns: { "positions": { "device_id": { "lat", "lon", "ts", "speed" }, ... } }
    Uses the LAST row per device_id from tracking_data_core (ORDER BY device_time DESC) so lat and lon
    come from the same GPS fix.
    """
    device_ids = body.get("device_ids") or []
    if not device_ids:
        return {"positions": {}}
    ids = [int(x) for x in device_ids if x is not None]
    if not ids:
        return {"positions": {}}
    dsn = ctx.dsn
    positions: dict[str, dict] = {}
    try:
        with get_conn(dsn) as conn:
            placeholders = ",".join(["%s"] * len(ids))
            # Lat/lon stored as integer × 10^7 (degrees × 10^7) — convert to decimal degrees
            cur = conn.execute(
                f"""
                SELECT DISTINCT ON (t.device_id)
                    t.device_id,
                    t.device_time AS ts,
                    ((t.latitude)::numeric / 10000000) AS lat,
                    ((t.longitude)::numeric / 10000000) AS lon,
                    (t.speed)::numeric AS speed
                FROM raw_telematics_data.tracking_data_core t
                WHERE t.device_id IN ({placeholders})
                  AND t.latitude IS NOT NULL
                  AND t.longitude IS NOT NULL
                ORDER BY t.device_id, t.device_time DESC
                """,
                ids,
            )
            for r in cur.fetchall():
                dev_id = r["device_id"]
                lat = r.get("lat")
                lon = r.get("lon")
                if lat is not None and lon is not None:
                    key = str(dev_id)
                    sp = r.get("speed")
                    # speed stored as × 10^2; convert to human-readable
                    speed_val = float(sp) / 100.0 if sp is not None else None
                    positions[key] = {
                        "lat": float(lat),
                        "lon": float(lon),
                        "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"]),
                        "speed": speed_val,
                    }
    except Exception:
        pass
    return {"positions": positions}


# ---------- Latest value (for dashboard indicators) ----------

@app.post("/api/latest-values")
def batch_latest_values(
    body: LatestValuesRequest,
    ctx: RequestContext = Depends(_request_context),
):
    """Body: { "pairs": [ { "device_id", "sensor_input_label", "sensor_source"?: "input"|"state"|"tracking" }, ... ] }
    Returns: { "values": { "device_id:source:sensor_input_label": { "value", "ts" } } }
    """
    pairs = body.pairs or []
    if not pairs:
        return {"values": {}}
    normalized = []
    for p in pairs:
        src = (p.get("sensor_source") or "input").strip().lower()
        if src not in ("input", "state", "tracking"):
            src = "input"
        normalized.append((p["device_id"], p["sensor_input_label"], src))
    dsn = ctx.dsn
    values: dict[str, dict] = {}
    with get_conn(dsn) as conn:
        input_keys = [(d, l) for (d, l, s) in normalized if s == "input"]
        if input_keys:
            placeholders = ",".join(["(%s,%s)"] * len(input_keys))
            flat = [x for k in input_keys for x in k]
            cur = conn.execute(
                f"""
                WITH cfg(device_id, sensor_name) AS (VALUES {placeholders}),
                latest AS (
                    SELECT DISTINCT ON (i.device_id, i.sensor_name)
                        i.device_id, i.sensor_name, i.device_time AS ts, NULLIF(i.value,'')::numeric AS value
                    FROM raw_telematics_data.inputs i
                    JOIN cfg ON cfg.device_id = i.device_id AND cfg.sensor_name = i.sensor_name
                    ORDER BY i.device_id, i.sensor_name, i.device_time DESC
                )
                SELECT device_id, sensor_name, ts, value FROM latest
                """,
                flat,
            )
            for r in cur.fetchall():
                key = _series_key(r["device_id"], r["sensor_name"], "input")
                values[key] = {"value": float(r["value"]) if r["value"] is not None else None, "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"])}
        state_keys = [(d, l) for (d, l, s) in normalized if s == "state"]
        if state_keys:
            placeholders = ",".join(["(%s,%s)"] * len(state_keys))
            flat = [x for k in state_keys for x in k]
            cur = conn.execute(
                f"""
                WITH cfg(device_id, state_name) AS (VALUES {placeholders}),
                latest AS (
                    SELECT DISTINCT ON (s.device_id, s.state_name)
                        s.device_id, s.state_name AS sensor_name, s.device_time AS ts, NULLIF(s.value,'')::numeric AS value
                    FROM raw_telematics_data.states s
                    JOIN cfg ON cfg.device_id = s.device_id AND cfg.state_name = s.state_name
                    ORDER BY s.device_id, s.state_name, s.device_time DESC
                )
                SELECT device_id, sensor_name, ts, value FROM latest
                """,
                flat,
            )
            for r in cur.fetchall():
                key = _series_key(r["device_id"], r["sensor_name"], "state")
                values[key] = {"value": float(r["value"]) if r["value"] is not None else None, "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"])}
        tracking_pairs = [(d, l) for (d, l, s) in normalized if s == "tracking" and l in TRACKING_DATA_CORE_SIGNALS]
        if tracking_pairs:
            for (device_id, col) in tracking_pairs:
                cur = conn.execute(
                    f"""
                    SELECT device_id, device_time AS ts, {col}::numeric AS value
                    FROM raw_telematics_data.tracking_data_core
                    WHERE device_id = %s
                    ORDER BY device_time DESC
                    LIMIT 1
                    """,
                    (device_id,),
                )
                r = cur.fetchone()
                if r:
                    key = _series_key(r["device_id"], col, "tracking")
                    raw_val = float(r["value"]) if r["value"] is not None else None
                    # speed stored as × 10^2; convert to human-readable
                    if col == "speed" and raw_val is not None:
                        raw_val = raw_val / 100.0
                    values[key] = {"value": raw_val, "ts": r["ts"].isoformat() if hasattr(r["ts"], "isoformat") else str(r["ts"])}
    return {"values": values}


# ---------- Serve frontend GUI when backend/static exists (e.g. single-URL deploy on Render) ----------

if _SERVE_GUI:
    _assets_dir = _STATIC_DIR / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    def _index_response() -> FileResponse:
        # Avoid sticky old SPA shells after redeploy (hashed assets change each build).
        return FileResponse(
            str(_STATIC_DIR / "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    @app.get("/")
    def _serve_index():
        return _index_response()

    @app.get("/{full_path:path}")
    def _serve_spa(full_path: str):
        if full_path in ("docs", "redoc", "openapi.json") or full_path.startswith(("api/", "docs/", "redoc/")):
            raise HTTPException(status_code=404, detail="Not Found")
        # Serve real files from static root (favicon, logos, etc.); do not SPA-fallback over them.
        static_root = _STATIC_DIR.resolve()
        candidate = (static_root / full_path).resolve()
        try:
            candidate.relative_to(static_root)
        except ValueError:
            raise HTTPException(status_code=404, detail="Not Found") from None
        if candidate.is_file():
            return FileResponse(str(candidate))
        return _index_response()
else:
    @app.get("/")
    def root():
        return {
            "name": "Sensoriqua API",
            "docs": "/docs",
            "message": "This is the API. Deploy with frontend built into backend/static to get the GUI at this URL.",
        }
