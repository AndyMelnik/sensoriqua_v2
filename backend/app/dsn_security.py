"""
DSN SSRF protections: scheme checks, DNS-aware private-IP blocking, and
hostaddr pinning so libpq does not re-resolve between check and connect
(DNS rebinding / TOCTOU).
"""
from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import urlparse

from psycopg.conninfo import conninfo_to_dict, make_conninfo

_ALLOWED_DSN_SCHEMES = ("postgresql", "postgres")
_PRIVATE_HOST_PATTERN = re.compile(
    r"^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)",
    re.IGNORECASE,
)

ALLOW_PRIVATE_DSN = os.environ.get("ALLOW_PRIVATE_DSN", "").strip().lower() in ("1", "true", "yes")


def _allow_private_dsn() -> bool:
    """Read at call time so .env loaded after import is respected."""
    return os.environ.get("ALLOW_PRIVATE_DSN", "").strip().lower() in ("1", "true", "yes")


def _is_trusted_env_dsn(dsn: str) -> bool:
    """Operator-configured SENSORIQUA_DSN is trusted (may be private/localhost)."""
    env = os.environ.get("SENSORIQUA_DSN", "").strip()
    return bool(env) and dsn.strip() == env


class UnsafeDsnError(ValueError):
    """Raised when a DSN fails SSRF / scheme validation."""


def is_private_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _host_looks_private(host: str) -> bool:
    host = host.strip().strip("[]")
    if not host:
        return True
    if host.lower() == "localhost" or _PRIVATE_HOST_PATTERN.match(host):
        return True
    return is_private_ip(host)


def resolve_host_ips(host: str) -> list[str]:
    """Resolve host to unique IP strings (IPv4/IPv6). Raises UnsafeDsnError if unresolvable."""
    host = host.strip().strip("[]")
    if not host:
        raise UnsafeDsnError("DSN must include a hostname")
    if is_private_ip(host) or _looks_like_ip(host):
        return [host]
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise UnsafeDsnError("DSN hostname could not be resolved") from e
    addrs: list[str] = []
    seen: set[str] = set()
    for info in infos:
        addr = info[4][0]
        if addr not in seen:
            seen.add(addr)
            addrs.append(addr)
    if not addrs:
        raise UnsafeDsnError("DSN hostname could not be resolved")
    return addrs


def _looks_like_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip().strip("[]"))
        return True
    except ValueError:
        return False


def hostname_resolves_to_private(host: str) -> bool:
    """True if host is private literal or any resolved A/AAAA is private (SSRF)."""
    host = host.strip().strip("[]")
    if _host_looks_private(host):
        return True
    try:
        addrs = resolve_host_ips(host)
    except UnsafeDsnError:
        return True
    return any(is_private_ip(a) for a in addrs)


def assert_dsn_scheme_and_host(dsn: str) -> tuple[str, dict]:
    """
    Parse DSN; ensure postgres scheme and a host (or hostaddr).
    Returns (original_stripped_dsn, conninfo dict).
    """
    if not dsn or not str(dsn).strip():
        raise UnsafeDsnError("DSN is required")
    dsn = str(dsn).strip()
    if "://" in dsn:
        try:
            parsed = urlparse(dsn)
        except Exception as e:
            raise UnsafeDsnError("Invalid DSN") from e
        scheme = (parsed.scheme or "").lower()
        if scheme not in _ALLOWED_DSN_SCHEMES:
            raise UnsafeDsnError("DSN must be a PostgreSQL URL (postgresql:// or postgres://)")
    try:
        params = conninfo_to_dict(dsn)
    except Exception as e:
        raise UnsafeDsnError("Invalid PostgreSQL DSN") from e
    host = (params.get("host") or "").strip()
    hostaddr = (params.get("hostaddr") or "").strip()
    if not host and not hostaddr:
        raise UnsafeDsnError("DSN must include a hostname")
    return dsn, params


def prepare_safe_dsn(dsn: str, *, allow_private: bool | None = None) -> str:
    """
    Validate DSN and return a conninfo string with hostaddr pinned to a resolved IP
    that passed SSRF checks. libpq then connects to that IP without a second DNS lookup.
    """
    allow = _allow_private_dsn() if allow_private is None else allow_private
    if allow_private is None and _is_trusted_env_dsn(dsn):
        allow = True
    _, params = assert_dsn_scheme_and_host(dsn)

    host = (params.get("host") or "").strip()
    existing_hostaddr = (params.get("hostaddr") or "").strip()

    # Prefer validating explicit hostaddr if the client supplied one (cannot trust alone).
    if existing_hostaddr:
        candidates = [a.strip().strip("[]") for a in existing_hostaddr.split(",") if a.strip()]
        if not candidates:
            raise UnsafeDsnError("DSN hostaddr is empty")
        for addr in candidates:
            if not _looks_like_ip(addr):
                raise UnsafeDsnError("DSN hostaddr must be an IP address")
            if not allow and is_private_ip(addr):
                raise UnsafeDsnError("DSN must not point to localhost or private network")
        # Pin to first allowed address; keep host for TLS/SNI when present
        params["hostaddr"] = candidates[0]
        return make_conninfo(**params)

    if not allow and _host_looks_private(host):
        raise UnsafeDsnError("DSN must not point to localhost or private network")

    addrs = resolve_host_ips(host)
    if not allow:
        if any(is_private_ip(a) for a in addrs):
            raise UnsafeDsnError("DSN must not point to localhost or private network")
        addrs = [a for a in addrs if not is_private_ip(a)]
        if not addrs:
            raise UnsafeDsnError("DSN must not point to localhost or private network")

    params["hostaddr"] = addrs[0]
    return make_conninfo(**params)


def validate_dsn(dsn: str, *, allow_private: bool | None = None) -> None:
    """Validate DSN (and exercise resolve checks) without needing the pinned conninfo."""
    prepare_safe_dsn(dsn, allow_private=allow_private)
