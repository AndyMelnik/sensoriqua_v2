/**
 * Sensoriqua API client.
 * Sends Authorization: Bearer <token> when auth_token is in localStorage (Navixy App Connect).
 * X-Sensoriqua-DSN is sent only when VITE_ALLOW_CLIENT_DSN=1 (must also set ALLOW_CLIENT_DSN on backend).
 *
 * App-state localStorage (configured sensors, dashboard, groups) is scoped by JWT userId so
 * different Navixy clients never share another user's board in the same browser.
 */
const API_BASE = import.meta.env.VITE_API_URL || '';
const ALLOW_CLIENT_DSN =
  String(import.meta.env.VITE_ALLOW_CLIENT_DSN || '').toLowerCase() === '1' ||
  String(import.meta.env.VITE_ALLOW_CLIENT_DSN || '').toLowerCase() === 'true';

const AUTH_TOKEN_KEY = 'auth_token';

/** When backend app state fails (503), use localStorage so config works without DB */
const LOCAL_CONFIGURED_KEY = 'sensoriqua_configured';
const LOCAL_DASHBOARD_KEY = 'sensoriqua_dashboard';
const LOCAL_DASHBOARD_GROUPS_KEY = 'sensoriqua_dashboard_groups';
const LOCAL_DASHBOARD_ASSIGN_KEY = 'sensoriqua_dashboard_group_assign';
const LOCAL_APP_STATE_KEYS = [
  LOCAL_CONFIGURED_KEY,
  LOCAL_DASHBOARD_KEY,
  LOCAL_DASHBOARD_GROUPS_KEY,
  LOCAL_DASHBOARD_ASSIGN_KEY,
] as const;

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

/** Decode JWT payload (no verify — middleware already issued the token). */
function readJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Stable scope for local app-state keys.
 * Prefer Navixy userId from JWT; fall back to anon for standalone (no token).
 */
export function getSessionScope(): string {
  const token = getAuthToken();
  if (!token) return 'anon';
  const payload = readJwtPayload(token);
  const userId = payload?.userId ?? payload?.sub;
  if (userId != null && String(userId).trim() !== '') {
    return `u:${String(userId)}`;
  }
  // Token present but no userId — still isolate from anon / other tokens
  return `t:${token.slice(-24)}`;
}

function scopedStorageKey(base: string, scope = getSessionScope()): string {
  return `${base}::${scope}`;
}

function readScopedJson(base: string, fallbackWhenMissing: unknown): unknown {
  const scope = getSessionScope();
  try {
    const scopedRaw = localStorage.getItem(scopedStorageKey(base, scope));
    if (scopedRaw != null) return JSON.parse(scopedRaw);
    // Legacy unscoped keys: only reuse for anonymous standalone — never for a JWT user
    // (avoids showing another client's dashboard after App Connect login).
    if (scope === 'anon') {
      const legacy = localStorage.getItem(base);
      if (legacy != null) {
        const parsed = JSON.parse(legacy);
        localStorage.setItem(scopedStorageKey(base, scope), legacy);
        localStorage.removeItem(base);
        return parsed;
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return fallbackWhenMissing;
}

function writeScopedJson(base: string, value: unknown): void {
  localStorage.setItem(scopedStorageKey(base), JSON.stringify(value));
  // Drop legacy unscoped key so it cannot leak across users
  localStorage.removeItem(base);
}

/** Clear app-state cache for the current session scope (not the auth token). */
export function clearCurrentSessionAppState(): void {
  const scope = getSessionScope();
  for (const base of LOCAL_APP_STATE_KEYS) {
    localStorage.removeItem(scopedStorageKey(base, scope));
    if (scope === 'anon') localStorage.removeItem(base);
  }
}

/** Remove legacy unscoped keys so they cannot leak into a JWT session. */
export function scrubLegacyUnscopedAppState(): void {
  if (getSessionScope() === 'anon') return;
  for (const base of LOCAL_APP_STATE_KEYS) {
    localStorage.removeItem(base);
  }
}

export function getLocalConfiguredSensors(): unknown[] {
  const v = readScopedJson(LOCAL_CONFIGURED_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function setLocalConfiguredSensors(list: unknown[]): void {
  writeScopedJson(LOCAL_CONFIGURED_KEY, list);
}

export function getLocalDashboardPlanes(): unknown[] {
  const v = readScopedJson(LOCAL_DASHBOARD_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function setLocalDashboardPlanes(list: unknown[]): void {
  writeScopedJson(LOCAL_DASHBOARD_KEY, list);
}

export function getLocalDashboardGroups(): unknown {
  const v = readScopedJson(LOCAL_DASHBOARD_GROUPS_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function setLocalDashboardGroups(groups: unknown): void {
  writeScopedJson(LOCAL_DASHBOARD_GROUPS_KEY, groups);
}

export function getLocalDashboardAssignments(): unknown {
  const v = readScopedJson(LOCAL_DASHBOARD_ASSIGN_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function setLocalDashboardAssignments(assignments: unknown): void {
  writeScopedJson(LOCAL_DASHBOARD_ASSIGN_KEY, assignments);
}

export function getDsn(): string {
  return localStorage.getItem('sensoriqua_dsn') || '';
}

export function setDsn(dsn: string): void {
  if (dsn) localStorage.setItem('sensoriqua_dsn', dsn);
  else localStorage.removeItem('sensoriqua_dsn');
}

function headers(dsn?: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (ALLOW_CLIENT_DSN) {
    const d = dsn ?? getDsn();
    if (d) h['X-Sensoriqua-DSN'] = d;
  }
  return h;
}

export async function getConfig() {
  const r = await fetch(`${API_BASE}/api/config`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getGroupings(
  type: 'groups' | 'tags' | 'departments' | 'garages' | 'sensor_types' | 'vehicles' | 'employees' | 'sensor_names',
  search?: string
) {
  const q = new URLSearchParams({ type });
  if (search) q.set('search', search);
  const r = await fetch(`${API_BASE}/api/groupings?${q}`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getObjects(filter: {
  group_ids?: number[];
  tag_ids?: number[];
  department_ids?: number[];
  garage_ids?: number[];
  sensor_type_ids?: string[];
  vehicle_ids?: number[];
  employee_ids?: number[];
  sensor_ids?: number[];
  sensor_names?: string[];
  client_id?: number;
  include_grouping_info?: boolean;
}) {
  const r = await fetch(`${API_BASE}/api/objects`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(filter),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getSensorsForObject(objectId: number, search?: string, includeTypeAndParams = true) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  params.set('include_type_and_params', String(includeTypeAndParams));
  const r = await fetch(`${API_BASE}/api/objects/${objectId}/sensors?${params}`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getConfiguredSensors() {
  const url = `${API_BASE}/api/configured-sensors`;
  const r = await fetch(url, { headers: headers() });
  return readApiJson(r, url, 'GET');
}

export type ApiDebugInfo = {
  url: string;
  method: string;
  requestBody: unknown;
  status: number;
  statusText: string;
  responseBody: string;
  errorMessage: string;
};

export class ApiError extends Error {
  debug: ApiDebugInfo;
  constructor(message: string, debug: ApiDebugInfo) {
    super(message);
    this.name = 'ApiError';
    this.debug = debug;
  }
}

async function readApiJson(
  r: Response,
  url: string,
  method: string,
  requestBody?: unknown
): Promise<unknown> {
  const responseBody = await r.text();
  if (!r.ok) {
    let errorMessage = responseBody;
    try {
      const j = JSON.parse(responseBody);
      const detail = j.detail;
      errorMessage = typeof detail === 'string' ? detail : JSON.stringify(detail);
    } catch {
      // use raw responseBody
    }
    throw new ApiError(errorMessage || r.statusText || `HTTP ${r.status}`, {
      url,
      method,
      requestBody,
      status: r.status,
      statusText: r.statusText,
      responseBody,
      errorMessage,
    });
  }
  if (!responseBody) return {};
  return JSON.parse(responseBody);
}

export type SparklineHours = 1 | 2 | 4 | 8;

export async function addConfiguredSensor(body: {
  object_id: number;
  device_id: number;
  sensor_input_label: string;
  sensor_source?: 'input' | 'state' | 'tracking';
  sensor_id?: number;
  sensor_label_custom: string;
  min_threshold?: number | null;
  max_threshold?: number | null;
  multiplier?: number | null;
  sparkline_hours?: SparklineHours;
}) {
  const url = `${API_BASE}/api/configured-sensors`;
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  return readApiJson(r, url, 'POST', body);
}

export async function updateConfiguredSensor(id: number, body: { sensor_label_custom?: string; min_threshold?: number | null; max_threshold?: number | null; multiplier?: number | null; sparkline_hours?: SparklineHours }) {
  const url = `${API_BASE}/api/configured-sensors/${id}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  return readApiJson(r, url, 'PATCH', body);
}

export async function deleteConfiguredSensor(id: number) {
  const url = `${API_BASE}/api/configured-sensors/${id}`;
  const r = await fetch(url, { method: 'DELETE', headers: headers() });
  return readApiJson(r, url, 'DELETE');
}

export type SparklinePair = { device_id: number; sensor_input_label: string; sensor_source?: 'input' | 'state' | 'tracking'; hours?: SparklineHours };
export async function getSparklines(pairs: SparklinePair[]) {
  const r = await fetch(`${API_BASE}/api/sparklines`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ pairs }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export type SensorHistoryHours = 1 | 4 | 12 | 24;
export type SensorHistoryOptions = {
  hours?: SensorHistoryHours;
  from_ts?: string; // ISO datetime
  to_ts?: string;   // ISO datetime
  raw?: boolean;    // if true, return raw rows (no time-bucket resampling)
};
export async function getSensorHistory(
  pair: SparklinePair,
  hoursOrOptions: SensorHistoryHours | SensorHistoryOptions,
  signal?: AbortSignal
): Promise<{ series: { ts: string; value: number | null }[] }> {
  const body: Record<string, unknown> = {
    device_id: pair.device_id,
    sensor_input_label: pair.sensor_input_label,
    sensor_source: pair.sensor_source ?? 'input',
  };
  if (typeof hoursOrOptions === 'object' && hoursOrOptions !== null) {
    if ('from_ts' in hoursOrOptions && 'to_ts' in hoursOrOptions) {
      body.from_ts = hoursOrOptions.from_ts;
      body.to_ts = hoursOrOptions.to_ts;
    } else {
      body.hours = hoursOrOptions.hours ?? 24;
    }
    if (hoursOrOptions.raw === true) body.raw = true;
  } else {
    body.hours = hoursOrOptions;
  }
  const r = await fetch(`${API_BASE}/api/sensor-history`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getLatestValues(pairs: SparklinePair[]) {
  const r = await fetch(`${API_BASE}/api/latest-values`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ pairs }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Distinct sensor_name (inputs) and state_name (states) for map conditions. */
export async function getMapConditionFields(): Promise<{ inputs: string[]; states: string[] }> {
  const r = await fetch(`${API_BASE}/api/map-condition-fields`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Latest lat/lon from same tracking_data_core row per device (one GPS fix). */
export async function getMapPositions(deviceIds: number[]): Promise<{
  positions: Record<string, { lat: number; lon: number; ts: string; speed: number | null }>;
}> {
  const r = await fetch(`${API_BASE}/api/map-positions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ device_ids: deviceIds }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getDashboardPlanes() {
  const url = `${API_BASE}/api/dashboard-planes`;
  const r = await fetch(url, { headers: headers() });
  return readApiJson(r, url, 'GET');
}

export async function addDashboardPlane(configured_sensor_id: number, position_index?: number) {
  const url = `${API_BASE}/api/dashboard-planes`;
  const body = { configured_sensor_id, position_index: position_index ?? 0 };
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  return readApiJson(r, url, 'POST', body);
}

export async function removeDashboardPlane(dashboard_plane_id: number) {
  const url = `${API_BASE}/api/dashboard-planes/${dashboard_plane_id}`;
  const r = await fetch(url, { method: 'DELETE', headers: headers() });
  return readApiJson(r, url, 'DELETE');
}

export async function reorderDashboardPlanes(order: { dashboard_plane_id: number; position_index: number }[]) {
  const url = `${API_BASE}/api/dashboard-planes/order`;
  const body = { order };
  const r = await fetch(url, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  return readApiJson(r, url, 'PATCH', body);
}
