/**
 * Sensoriqua API client.
 * Sends Authorization: Bearer <token> when auth_token is in localStorage (Navixy App Connect).
 * Sends X-Sensoriqua-DSN when dsn is set (standalone mode).
 */
const API_BASE = import.meta.env.VITE_API_URL || '';

const AUTH_TOKEN_KEY = 'auth_token';

/** When backend app state fails (503), use localStorage so config works without DB */
const LOCAL_CONFIGURED_KEY = 'sensoriqua_configured';
const LOCAL_DASHBOARD_KEY = 'sensoriqua_dashboard';
const LOCAL_DASHBOARD_GROUPS_KEY = 'sensoriqua_dashboard_groups';
const LOCAL_DASHBOARD_ASSIGN_KEY = 'sensoriqua_dashboard_group_assign';

export function getLocalConfiguredSensors(): unknown[] {
  try {
    const raw = localStorage.getItem(LOCAL_CONFIGURED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setLocalConfiguredSensors(list: unknown[]): void {
  localStorage.setItem(LOCAL_CONFIGURED_KEY, JSON.stringify(list));
}

export function getLocalDashboardPlanes(): unknown[] {
  try {
    const raw = localStorage.getItem(LOCAL_DASHBOARD_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setLocalDashboardPlanes(list: unknown[]): void {
  localStorage.setItem(LOCAL_DASHBOARD_KEY, JSON.stringify(list));
}

export function getLocalDashboardGroups(): unknown {
  try {
    const raw = localStorage.getItem(LOCAL_DASHBOARD_GROUPS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setLocalDashboardGroups(groups: unknown): void {
  localStorage.setItem(LOCAL_DASHBOARD_GROUPS_KEY, JSON.stringify(groups));
}

export function getLocalDashboardAssignments(): unknown {
  try {
    const raw = localStorage.getItem(LOCAL_DASHBOARD_ASSIGN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setLocalDashboardAssignments(assignments: unknown): void {
  localStorage.setItem(LOCAL_DASHBOARD_ASSIGN_KEY, JSON.stringify(assignments));
}

export function getDsn(): string {
  return localStorage.getItem('sensoriqua_dsn') || '';
}

export function setDsn(dsn: string): void {
  if (dsn) localStorage.setItem('sensoriqua_dsn', dsn);
  else localStorage.removeItem('sensoriqua_dsn');
}

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function headers(dsn?: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  const d = dsn ?? getDsn();
  if (d) h['X-Sensoriqua-DSN'] = d;
  return h;
}

export async function getConfig() {
  const r = await fetch(`${API_BASE}/api/config`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getGroupings(type: 'groups' | 'tags' | 'departments' | 'garages' | 'sensor_types', search?: string) {
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

export async function getConfiguredSensors(userId?: number) {
  const q = userId != null ? `?user_id=${userId}` : '';
  const r = await fetch(`${API_BASE}/api/configured-sensors${q}`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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
}) {
  const url = `${API_BASE}/api/configured-sensors`;
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
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
    throw new ApiError(errorMessage, {
      url,
      method: 'POST',
      requestBody: body,
      status: r.status,
      statusText: r.statusText,
      responseBody,
      errorMessage,
    });
  }
  return JSON.parse(responseBody);
}

export async function updateConfiguredSensor(id: number, body: { sensor_label_custom?: string; min_threshold?: number | null; max_threshold?: number | null; multiplier?: number | null }) {
  const url = `${API_BASE}/api/configured-sensors/${id}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
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
    throw new ApiError(errorMessage, {
      url,
      method: 'PATCH',
      requestBody: body,
      status: r.status,
      statusText: r.statusText,
      responseBody,
      errorMessage,
    });
  }
  return JSON.parse(responseBody);
}

export async function deleteConfiguredSensor(id: number) {
  const r = await fetch(`${API_BASE}/api/configured-sensors/${id}`, { method: 'DELETE', headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export type SparklinePair = { device_id: number; sensor_input_label: string; sensor_source?: 'input' | 'state' | 'tracking' };
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

export async function getDashboardPlanes(userId?: number) {
  const q = userId != null ? `?user_id=${userId}` : '';
  const r = await fetch(`${API_BASE}/api/dashboard-planes${q}`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function addDashboardPlane(configured_sensor_id: number, position_index?: number) {
  const r = await fetch(`${API_BASE}/api/dashboard-planes`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ configured_sensor_id, position_index: position_index ?? 0 }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function removeDashboardPlane(dashboard_plane_id: number) {
  const r = await fetch(`${API_BASE}/api/dashboard-planes/${dashboard_plane_id}`, { method: 'DELETE', headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function reorderDashboardPlanes(order: { dashboard_plane_id: number; position_index: number }[]) {
  const r = await fetch(`${API_BASE}/api/dashboard-planes/order`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ order }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
