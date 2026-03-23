# Navixy App Connect integration

Sensoriqua can be used with **Navixy App Connect**, an authentication gateway that lets users sign in with their Navixy account. The middleware provides database credentials per user; the app does not implement its own user management.

## How it works

1. User opens your app through Navixy (e.g. User applications).
2. The middleware validates the user's session and fetches DB credentials from the master database.
3. The middleware calls your **POST /api/auth/login** with `email`, `iotDbUrl`, `userDbUrl`, and `role`.
4. Sensoriqua stores these credentials server-side, generates a JWT, and returns `{ success, user, token }`.
5. The middleware stores the token in the browser (`localStorage.auth_token`) and sends `Authorization: Bearer <token>` on all `/api/*` requests.
6. Sensoriqua resolves the user and DSN from the JWT and uses the stored `iotDbUrl` (telematics) and `userDbUrl` (app state) for that user.

## Backend setup

1. **JWT secret** (required for App Connect):
   ```bash
   # Generate a secret (min 32 characters)
   openssl rand -hex 32
   ```
   Set in `backend/.env`:
   ```
   JWT_SECRET=<your-generated-secret>
   ```

2. **Auth endpoint**: Sensoriqua implements **POST /api/auth/login** as required by the [Navixy App Connect contract](https://docs.navixy.com/). The endpoint is only active when `JWT_SECRET` is set (at least 32 characters).

3. **API behavior**: All `/api/*` routes accept an optional `Authorization: Bearer <token>` header. When present and valid, the request uses the DSN and user identity from the token. Otherwise, the app falls back to `X-Sensoriqua-DSN` and query `user_id` (standalone mode).

## Frontend

The frontend sends `Authorization: Bearer <token>` when `localStorage.auth_token` is set. When users access the app through Navixy, the middleware sets this after a successful login call.

## Data isolation and session security

- **Data source:** All telematics and business data come from the **iotDbUrl** (and app state from **userDbUrl**) supplied by the Navixy auth service at login. The app does not use a shared default DSN or `X-Sensoriqua-DSN` for API requests when App Connect is enabled.
- **Per-user credentials:** Credentials are stored server-side keyed only by the user ID from the JWT. Each request uses the DSN for that token’s user; there is no cross-user use of credentials.
- **Require auth when JWT_SECRET is set:** When `JWT_SECRET` is set, every `/api/*` route except **POST /api/auth/login** requires a valid Bearer token. Requests without a valid token receive 401. So different browser sessions (different users, or the same user in different browsers) are isolated: each session has its own token and thus its own iotDbUrl/userDbUrl.
- **IoT/telematics data:** Read from `iotDbUrl` (per user).
- **App state** (configured sensors, dashboard planes): Stored in `userDbUrl` when using App Connect, so each user has their own data in their Navixy user database. The app uses the `app_sensoriqua` schema there; ensure migrations are applied to each user DB if required. If the app-state backend is unavailable (e.g. 503), the frontend can fall back to localStorage for that session and shows “Saved in this browser.”

## Optional: Basic Auth for static assets

If the middleware serves your static assets and expects Basic Authentication, set in the middleware environment (not in Sensoriqua):

```
DASHBOARD_BASIC_AUTH=username:password
```

Sensoriqua does not enforce Basic Auth; the middleware does when proxying to your app.
