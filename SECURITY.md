# Security and hardening

This document summarizes security measures and a pre-publish checklist for deploying Sensoriqua (including to a public GitHub repo).

## Authentication and sessions

- **JWT:** When `JWT_SECRET` is set (Navixy App Connect), all `/api/*` routes except `POST /api/auth/login` require a valid `Authorization: Bearer <token>`.
- **Algorithm:** Tokens are signed with HS256; the backend decodes only with `algorithms=[JWT_ALGORITHM]` (no `alg=none` or algorithm confusion).
- **Secrets:** `JWT_SECRET` must be at least 32 characters. Generate with e.g. `openssl rand -hex 32`. Never commit `.env` or real secrets.
- **Per-user data:** DSN (iotDbUrl/userDbUrl) is stored server-side keyed by user (in memory + `sensoriqua_credentials.json` by default); each request uses only the DSN for the token’s user.
- **Login hardening:** `LOGIN_API_KEY` is **required** when `JWT_SECRET` is set (header `X-Sensoriqua-Login-Key`), unless `ALLOW_OPEN_LOGIN=1` on a trusted private network. Compared with `secrets.compare_digest`. Per-IP rate limit (`LOGIN_RATE_LIMIT_PER_MINUTE`, default 30). Rate-limit IP uses `X-Forwarded-For` only when `TRUST_PROXY=1` (set this on Render).
- **Credentials at rest:** App Connect DSNs are encrypted (Fernet) when `JWT_SECRET` or `CREDENTIALS_ENCRYPTION_KEY` is ≥32 characters. Oldest sessions are pruned above `CREDENTIALS_MAX_ENTRIES` (default 1000).
- **OpenAPI:** `/docs` is disabled by default when App Connect is on; set `ENABLE_OPENAPI=1` to expose.

## Standalone mode (no JWT)

- Uses `SENSORIQUA_DSN` and `SENSORIQUA_USER_ID` from the environment only.
- **`X-Sensoriqua-DSN` and `?user_id=` are ignored by default** (prevents IDOR and client-chosen databases).
- Enable only for local debugging: `ALLOW_CLIENT_DSN=1` and/or `ALLOW_CLIENT_USER_ID=1`, plus frontend `VITE_ALLOW_CLIENT_DSN=1` if the UI should send a DSN header. Never enable on a public deployment.
- Set **`REQUIRE_AUTH=1`** on public hosts so the process refuses to start without a valid `JWT_SECRET`.

## Login endpoint and SSRF

- **POST /api/auth/login** accepts `iotDbUrl` and `userDbUrl` (from Navixy middleware). The server connects to these URLs.
- **Validation:** Only `postgresql://` or `postgres://` URLs are accepted. Hostname is resolved (`getaddrinfo`); private, loopback, link-local, and reserved addresses are rejected unless `ALLOW_PRIVATE_DSN=1`.
- **Connect-time pin:** Every `get_conn()` re-validates the DSN and sets libpq `hostaddr` to a resolved IP that passed the check, so DNS cannot rebind to a private address between login and connect.
- **Trusted env DSN:** `SENSORIQUA_DSN` from the environment is treated as operator-trusted (private/localhost allowed) but is still pinned via `hostaddr`.
- **Trusted environments:** If the backend runs in a trusted environment (e.g. inside Navixy) and must accept internal DB URLs from login, set `ALLOW_PRIVATE_DSN=1`. Do not set this on a public-facing deployment.

## CORS

- When **JWT is enabled**, empty `CORS_ORIGINS` blocks cross-origin browser API access (same-origin static GUI still works). Set `CORS_ORIGINS` for a separate frontend origin.
- When JWT is off and `CORS_ORIGINS` is empty, CORS uses `allow_origins=["*"]` and `allow_credentials=False`.

## Security headers

The backend adds:

- `X-Content-Type-Options: nosniff`
- **Framing:** By default the backend sends `Content-Security-Policy: frame-ancestors *` so the app can be embedded in an iframe. Set **ALLOW_FRAME_ORIGINS** to comma-separated origins to restrict, or `deny` to send `X-Frame-Options: DENY` (no embedding).
- `Referrer-Policy: strict-origin-when-cross-origin`

## SQL and input validation

- **Parameterized queries:** User-controlled input is passed as parameters (`%s` / `%(name)s`), not interpolated into SQL strings. Schema/table names used in queries are fixed in code (`raw_business_data`, `raw_telematics_data`, `app_sensoriqua.*`).
- **Grouping type:** The `type` query parameter for `/api/groupings` is restricted to a fixed set.
- **Tracking columns:** For telematics, only whitelisted column names from `TRACKING_DATA_CORE_SIGNALS` are used in dynamic column references.

## HTML / PDF export

- Report title, description, and table cells are HTML-escaped.
- Chart SVG embedded in HTML exports is sanitized (scripts, event handlers, and dangerous tags stripped) before write.

## Secrets and .env

- **Never commit:** `.env`, `*.env` (except `*.env.example`), `sensoriqua_credentials.json`, `*.pem` / private keys — listed in `.gitignore`.
- **Placeholders:** Default DSN in code is a placeholder; production must set `SENSORIQUA_DSN` (and optionally `JWT_SECRET`, `CORS_ORIGINS`, `LOGIN_API_KEY`) via environment.

## Dependencies

- Keep backend deps updated (`pip install -r requirements.txt -U` and run `pip audit`).
- Frontend: run `npm audit` and address high/critical findings before release.

## Pre-publish checklist (public repo)

1. **No secrets in repo:** Confirm no `.env` or real credentials are committed.
2. **CORS:** With Navixy/JWT, set `CORS_ORIGINS` to your frontend origin(s).
3. **JWT_SECRET**, **LOGIN_API_KEY**, and **CORS_ORIGINS** for any internet-reachable App Connect deployment. Set **TRUST_PROXY=1** behind Render/nginx. Optionally **REQUIRE_AUTH=1**.
4. **SSRF:** Leave `ALLOW_PRIVATE_DSN` unset on public internet-facing login. Connect-time `hostaddr` pinning is always applied.
5. **Standalone locks:** Leave `ALLOW_CLIENT_DSN` and `ALLOW_CLIENT_USER_ID` unset in production. Do not expose standalone (no JWT) on the public internet.
6. **OpenAPI:** Leave `ENABLE_OPENAPI` unset (docs off with JWT) unless you intentionally need `/docs`.
7. **HTTPS:** Serve the API and frontend over HTTPS in production.

## Client-side storage (localStorage)

- **Auth token:** When using Navixy, the frontend stores the JWT in `localStorage.auth_token` and sends it in the `Authorization` header. Serve over HTTPS; consider short token expiry.
- **Config fallback:** On 503 for app state, configured sensors / dashboard may be stored in localStorage. No secrets should be stored in those keys.

## Pentest / security checklist (summary)

- **Auth:** JWT HS256; 401 when App Connect is on and token missing/invalid.
- **Login:** Postgres URL only; DNS-aware private IP block; rate limit; optional login API key; connect-time hostaddr pin against DNS rebinding.
- **Standalone:** No client `user_id` / DSN unless opt-in env flags.
- **SQL:** Parameterized; fixed identifiers; tracking columns whitelisted.
- **CORS:** Explicit origins when JWT enabled.
- **Exports:** Escaped text + sanitized chart HTML.
- **Secrets:** No `.env` or credential files in repo.

## Reporting vulnerabilities

If you find a security issue, please report it privately (e.g. via repository security advisories or a contact listed in the repo) rather than in a public issue.
