# Security and hardening

This document summarizes security measures and a pre-publish checklist for deploying Sensoriqua (including to a public GitHub repo).

## Authentication and sessions

- **JWT:** When `JWT_SECRET` is set (Navixy App Connect), all `/api/*` routes except `POST /api/auth/login` require a valid `Authorization: Bearer <token>`.
- **Algorithm:** Tokens are signed with HS256; the backend decodes only with `algorithms=[JWT_ALGORITHM]` (no `alg=none` or algorithm confusion).
- **Secrets:** `JWT_SECRET` must be at least 32 characters. Generate with e.g. `openssl rand -hex 32`. Never commit `.env` or real secrets.
- **Per-user data:** DSN (iotDbUrl/userDbUrl) is stored server-side keyed by user; each request uses only the DSN for the token’s user. No cross-user or cross-session use of credentials.

## Login endpoint and SSRF

- **POST /api/auth/login** accepts `iotDbUrl` and `userDbUrl` (from Navixy middleware). The server connects to these URLs.
- **Validation:** Only `postgresql://` or `postgres://` URLs are accepted. By default, DSNs that point to localhost or private IP ranges are rejected to reduce SSRF risk.
- **Trusted environments:** If the backend runs in a trusted environment (e.g. inside Navixy) and must accept internal DB URLs, set `ALLOW_PRIVATE_DSN=1`. Do not set this on a public-facing deployment.

## CORS

- With **credentials** (Bearer tokens), the app does not use `allow_origins=["*"]` (browser security requirement).
- Set **CORS_ORIGINS** to a comma-separated list of allowed frontend origins (e.g. `https://app.example.com,https://admin.example.com`). When set, only those origins can send credentialed requests.
- If CORS_ORIGINS is not set, CORS uses `allow_origins=["*"]` with `allow_credentials=False`.

## Security headers

The backend adds:

- `X-Content-Type-Options: nosniff`
- **Framing:** By default the backend sends `Content-Security-Policy: frame-ancestors *` so the app can be embedded in an iframe. Set **ALLOW_FRAME_ORIGINS** to comma-separated origins to restrict, or `deny` to send `X-Frame-Options: DENY` (no embedding).
- `Referrer-Policy: strict-origin-when-cross-origin`

## SQL and input validation

- **Parameterized queries:** User-controlled input is passed as parameters (`%s` / `%(name)s`), not interpolated into SQL strings. Schema/table names used in queries are fixed in code (`raw_business_data`, `raw_telematics_data`, `app_sensoriqua.*`).
- **Grouping type:** The `type` query parameter for `/api/groupings` is restricted to a fixed set (`groups`, `tags`, `departments`, `garages`, `sensor_types`).
- **Tracking columns:** For telematics, only whitelisted column names from `TRACKING_DATA_CORE_SIGNALS` are used in dynamic column references.

## Secrets and .env

- **Never commit:** `.env`, `backend/.env`, and `*.env` (except `*.env.example`) are in `.gitignore`. Do not remove them or commit files that contain real DSNs or `JWT_SECRET`.
- **Placeholders:** Default DSN in code is a placeholder; production must set `SENSORIQUA_DSN` (and optionally `JWT_SECRET`, `CORS_ORIGINS`) via environment.

## Dependencies

- Keep backend deps updated (`pip install -r requirements.txt -U` and run `pip audit`).
- Frontend: run `npm audit` and address high/critical findings before release.

## Pre-publish checklist (public repo)

1. **No secrets in repo:** Confirm no `.env` or real credentials are committed; `.gitignore` includes `.env`, `backend/.env`, `*.env`, `!*.env.example`.
2. **CORS:** Set `CORS_ORIGINS` in production to your frontend origin(s). Do not use `allow_origins=["*"]` with credentials in production.
3. **JWT_SECRET:** In production with Navixy, set a strong `JWT_SECRET` (min 32 chars) in the environment, not in code.
4. **SSRF:** Leave `ALLOW_PRIVATE_DSN` unset (or `0`) on any deployment that accepts login from the public internet.
5. **Rate limiting:** The login endpoint has no built-in rate limit. Consider putting the API behind a reverse proxy or gateway that rate-limits (e.g. by IP) for login and sensitive routes.
6. **HTTPS:** Serve the API and frontend over HTTPS in production.

## Client-side storage (localStorage)

- **Auth token:** When using Navixy, the frontend stores the JWT in `localStorage.auth_token` and sends it in the `Authorization` header. This is standard for SPAs; ensure the app is only served over HTTPS and consider short token expiry.
- **Config fallback:** When the backend returns 503 for app state (configured sensors / dashboard), the frontend can store that data in `localStorage` (keys `sensoriqua_configured`, `sensoriqua_dashboard`). This is per-browser data only and is not sent to the server except as part of normal API calls (e.g. sparklines use the list to request time series). No secrets should be stored in these keys.

## Pentest / security checklist (summary)

- **Auth:** JWT with fixed algorithm (HS256); no `alg=none`; 401 when App Connect is on and token missing/invalid.
- **Login:** DSN restricted to postgresql/postgres; private IPs rejected unless `ALLOW_PRIVATE_DSN=1`.
- **SQL:** All user input is parameterized; schema/table names are fixed in code; tracking columns whitelisted.
- **CORS:** Credentialed requests require explicit `CORS_ORIGINS` (no `*` with credentials).
- **Headers:** `X-Content-Type-Options: nosniff`; framing configurable; `Referrer-Policy` set.
- **Secrets:** No `.env` or real DSN/JWT_SECRET in repo; credentials stored server-side per user.
- **Rate limiting:** Not implemented; use a reverse proxy or gateway for login and sensitive routes in production.

## Reporting vulnerabilities

If you find a security issue, please report it privately (e.g. via repository security advisories or a contact listed in the repo) rather than in a public issue.
