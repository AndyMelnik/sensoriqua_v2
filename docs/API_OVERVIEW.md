# Sensoriqua 2 — API Overview

Summary of the main HTTP API used by the frontend. Full OpenAPI spec is available at **`/docs`** when the backend is running.

---

## Authentication and context

- **Standalone:** No auth. DSN from env **SENSORIQUA_DSN** or header **X-Sensoriqua-DSN**; optional query **user_id**.
- **Navixy App Connect:**  
  - **POST /api/auth/login** — Body: `email`, `iotDbUrl`, `userDbUrl`, `role`. Returns JWT and user info. DSNs must be PostgreSQL; localhost/private IPs rejected unless **ALLOW_PRIVATE_DSN** is set.  
  - All other **/api/\*** requests require **Authorization: Bearer &lt;token&gt;**. DSN and user_id come from the token.

---

## Endpoints (summary)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/config | Default DSN (masked) and default user_id. |
| GET | /api/groupings | List groupings: `type` = groups \| tags \| departments \| garages \| sensor_types \| **vehicles** \| **employees** \| **sensor_names**; optional `search`. |
| POST | /api/objects | List objects; body: group_ids, tag_ids, department_ids, garage_ids, sensor_type_ids, **vehicle_ids**, **employee_ids**, **sensor_ids**, client_id, include_grouping_info. |
| GET | /api/objects/{id}/sensors | Sensors for one object; optional search, include_type_and_params. |
| GET | /api/configured-sensors | List configured sensors for current user. |
| POST | /api/configured-sensors | Create; body: object_id, device_id, sensor_input_label, sensor_source, sensor_label_custom, min_threshold, max_threshold, multiplier, sparkline_hours (1\|2\|4\|8, default 1). |
| PATCH | /api/configured-sensors/{id} | Update; body: sensor_label_custom, min_threshold, max_threshold, multiplier, sparkline_hours. Returns the **updated configured sensor** (same fields as list/create). |
| DELETE | /api/configured-sensors/{id} | Soft-delete (is_active = false). |
| GET | /api/dashboard-planes | List dashboard planes for current user (with object_label, thresholds, multiplier). |
| POST | /api/dashboard-planes | Add plane; body: configured_sensor_id, position_index. |
| DELETE | /api/dashboard-planes/{id} | Remove plane. |
| PATCH | /api/dashboard-planes/order | Reorder; body: order = [ { dashboard_plane_id, position_index }, ... ]. |
| POST | /api/sparklines | Body: pairs = [ { device_id, sensor_input_label, sensor_source?, hours? (1\|2\|4\|8) } ]. Returns series keyed by "device_id:source:label". |
| POST | /api/latest-values | Body: pairs (same shape). Returns values keyed by "device_id:source:label". |
| GET | /api/map-condition-fields | Distinct **sensor_name** from `raw_telematics_data.inputs` and **state_name** from `raw_telematics_data.states` (for map condition pickers). |
| POST | /api/map-positions | Body: `{ "device_ids": [ 1, 2, 3 ] }`. Returns latest **lat, lon, ts, speed** per device from the **last row** in `tracking_data_core` (ORDER BY device_time DESC), so lat and lon come from the same GPS fix. |
| POST | /api/sensor-history | Body: device_id, sensor_input_label, sensor_source?, hours? (1\|4\|12\|24), from_ts?, to_ts?, raw? (unresampled). Returns { series: [ { ts, value }, ... ] }. |

**Configured sensor update:** `PATCH` returns the full row (including `object_label` from the business DB). The UI merges this into the list and syncs **localStorage** when the API is available. If optional columns are missing on an older Postgres schema, the backend still updates the available fields.

**Map / business mapping (groupings + objects):** `vehicles` lists fleet rows (`vehicles.object_id` → objects). `employees` lists staff with an object assignment. `sensor_names` lists distinct `sensor_description` rows (`sensor_id` + label). Object filters use `vehicle_ids` / `employee_ids` / `sensor_ids` via EXISTS joins on `vehicles`, `employees`, and `sensor_description` respectively.

---

## Dashboard export/import (file format)

Exported dashboard JSON (from the UI) looks like:

```json
{
  "version": 1,
  "exportedAt": "2025-03-06T12:00:00.000Z",
  "name": "My Dashboard",
  "dashboard": {
    "planes": [
      {
        "configured_sensor_id": 1,
        "position_index": 0,
        "device_id": 123,
        "sensor_input_label": "speed",
        "sensor_source": "tracking",
        "object_label": "Vehicle A",
        "group_id": "g-xxx"
      }
    ],
    "groups": [
      { "id": "g-xxx", "label": "Engine" }
    ]
  }
}
```

Import matches planes by `configured_sensor_id` or by (device_id, sensor_input_label, sensor_source), restores order and **group_id**; group labels are taken from **groups** and applied to the dashboard layout (and stored in localStorage).

---

## Report export/import (file format)

Exported report JSON (from the Reports tab) has this shape:

```json
{
  "version": 1,
  "exportedAt": "2025-03-06T12:00:00.000Z",
  "name": "My Report",
  "report": {
    "config": {
      "objects": [
        {
          "object_id": 123,
          "object_label": "Vehicle A",
          "device_id": 456,
          "sensors": [
            {
              "input_label": "speed",
              "sensor_source": "tracking",
              "label": "Speed",
              "multiplier": 0.01
            }
          ]
        }
      ],
      "dateFrom": "2025-03-01T00:00",
      "dateTo": "2025-03-06T23:59",
      "title": "Sensor reading report",
      "description": "Optional notes shown in HTML/PDF export"
    },
    "data": {
      "chartSeries": [ { "label": "Speed", "color": "#0ea5e9", "data": [ { "ts": "...", "value": 50 } ] } ],
      "tableRows": [ ... ],
      "columns": [ { "key": "ts", "label": "Time" }, ... ],
      "summaryRows": [ ... ],
      "summaryColumns": [ ... ]
    }
  }
}
```

- **config** — Always present: **objects** (each with object_id, object_label, device_id, **sensors** array of input_label, sensor_source, label, multiplier), **dateFrom**, **dateTo** (datetime-local style strings).
- **data** — Optional. If present, the report was generated at export time; import can show the graph and tables without calling the API. Contains **chartSeries** (ReportSeries), **tableRows**, **columns**, **summaryRows**, **summaryColumns**.

On import, the UI restores the timeframe and selected objects; after sensors are loaded for those objects, it restores the sensor slots (matched by input_label and sensor_source) and multipliers. If **data** is present, it is displayed as the current report.

**HTML / PDF export** — Built in the browser from the current report view (`reportExport.ts`). **PDF** uses jsPDF + jspdf-autotable (chart SVG rasterized into the PDF). No server endpoint for report files.

**XLSX export** — Per-table download in the UI via `exportXlsx.ts` (ExcelJS, write-only; no parsing of uploaded spreadsheets).

---

## Errors

- **400** — Validation (e.g. MIN ≥ MAX, invalid from_ts/to_ts, hours not 1/4/12/24).  
- **403** — e.g. configured sensor not found or access denied when adding a dashboard plane.  
- **404** — Object/sensor/plane or configured sensor not found.  
- **501** — Navixy App Connect not configured (JWT_SECRET missing or too short).  
- **503** — App state table/schema not available (frontend may fall back to localStorage).

Error body is JSON with **detail** (string or object). The frontend shows a generic error message and, in debug mode, can show status and response body.
