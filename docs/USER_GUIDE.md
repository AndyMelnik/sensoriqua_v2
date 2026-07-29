# Sensoriqua 2 — User Guide

This guide describes how to use **Sensoriqua 2 (Dashboards and Reports)** for configuring sensors, building dashboards, generating reports, and viewing fleet positions on a map.

---

## Overview

The application has three main tabs:

| Tab | Purpose |
|-----|---------|
| **Dashboards** | Configure sensors, build a live dashboard with panels, optional grouping. Export/import dashboard layout. |
| **Reports** | Select objects and sensors, set a timeframe, generate a graph and tables (raw + summary). Export/import JSON, HTML, PDF; export tables to XLSX. |
| **Map** | Filter units by business entity, optional telemetry conditions, show GPS on a map and in a sortable table. |

**Dashboards** and **Reports** share the same left-panel workflow: filter by grouping → choose objects → choose and configure sensors. **Map** uses its own three-step flow (entity → selection → conditions).

---

## Dashboards Tab

### Step 1 — Filter objects by grouping

- Choose **Groups**, **Tags**, or **Sensor type** (tabs).
- Select one or more items in the list. Objects that match **any** selection appear in Step 2.
- Leave all empty to see all objects.
- Use the search box to filter the list.

### Step 2 — Choose objects

- View the list as **Full list**, **Grouped by Group**, or **Grouped by Tag**.
- Search by object label if needed.
- Select the objects you want to work with (checkboxes).

### Step 3 — Sensors & configure

- For each selected object, use **Select sensor** to pick one or more sensors (Input, State, or Tracking).
- Click **Configure / Add** (or **Configure / Edit** if that sensor is already in the configured list) to set:
  - **Display label** (e.g. "Speed", "Fuel level")
  - **MIN** and **MAX** thresholds (optional; used for green/red coloring on dashboard and threshold bands on sparklines)
  - **Multiplier** (e.g. 0.01 to scale values)
  - **Mini-chart period** — last **1**, **2**, **4**, or **8 hours** of history for the sparkline in the configured list and on dashboard panels
- Click **Add** or **Save**. Re-opening **Configure / Edit** for the same object and sensor updates the existing entry (no duplicate).

### Configured sensors (center)

- Each card shows: object label, sensor label, **interactive sparkline** (hover for time/value; min/max row under the chart), and actions.
- **Search** — Filter the list by **object name**, display label, or sensor input. The meta line shows **Showing X of Y**.
- Card **border and sparkline color** match the dashboard: **green** in range, **red** out of range, **neutral** when thresholds are unset or there is no live reading. Live status uses the same **latest value** as dashboard panels (shared refresh interval).
- **Edit** — Change label, MIN/MAX, multiplier, or mini-chart period; click **Save** to persist (API or browser storage). The card and dashboard panels update with the new thresholds and mini-chart period.
- **Add to dashboard** — Add this sensor to the dashboard (right side).
- **Remove** — Remove from the configured list (and from the dashboard if it was placed there). You can add it again later from Step 3.

If the backend cannot save (e.g. app state DB unavailable), the app switches to **browser storage**; the tagline will show **"Saved in this browser"**. An empty list from the server is kept empty (old browser cache is not restored as if it were still configured).

### Dashboard (right)

- Each panel shows: object label, sensor label, **latest value**, and a fixed-size sparkline (min/max under the chart).
  - **Green** = value within MIN/MAX; **red** = outside range; **neutral** = no thresholds or no reading.
- **Configured list and dashboard stay synchronized** — same sparkline series, same live reading, same multiplier and thresholds. Both refresh together when you change **Update every**.
- **Expand** — Dashboard fills the window (hides header and side panels). **Collapse** to return.
- **Update every** — Choose 30 sec, 1 min, or 5 min.
- **Click a panel** — Opens an interactive **history chart** (1, 4, 12, or 24 hours): move the cursor over the graph for crosshair lines, value and time tooltip, min/max/latest stats, and a legend for the sensor line plus MIN/MAX thresholds (green = in range).
- **×** on a panel — Removes it from the dashboard (sensor remains in the configured list).

#### Grouping panels

- **+** (top-left of a panel) — Open the group dialog. Enter a **group label** (e.g. "Engine", "Cold store A"). Panels with the same label sit inside a **framed section** sized to those widgets (not stretched full width).
- **−** (top-left) — Remove the panel from its group.
- On a narrow viewport, **groups and individual widgets wrap to the next row** instead of shrinking and clipping labels or sparklines.
- The group frame color follows member status (red if any panel is in alarm, green if all are OK).
- Group membership and labels are stored **locally** (and in exported JSON). They are restored on next load and when you import a dashboard.

### Export and Import (header)

- **Export** — Opens a dialog. Enter a name and click Export to download a JSON file with the current dashboard layout (planes and **groups**). Use this to back up or share a layout.
- **Import** — Choose a previously exported JSON file. The app matches sensors by `configured_sensor_id` or by device/sensor identity and restores panels and **groups**. If the backend is unavailable, the app may use localStorage for the restored layout.

---

## Reports Tab

### Steps 1–3 (same as Dashboards)

- Filter by grouping, choose objects, then choose sensors.
- For each sensor you can set a **multiplier** (e.g. 0.01) so that values in the report (graph and tables) are scaled.

### Step 4 — Timeframe

- **From** — Start date and time for the report.
- **To** — End date and time.
- The report will request data only within this range (or use **Try last 24 hours** if the range returns no data).

### Report name and description

- Above the generated report, a card contains two single-line fields:
  - **Report name** — Title for exports and the section heading (default: "Sensor reading report").
  - **Description** — Optional notes (included in HTML, PDF, and JSON).
- If description is non-empty, a preview line may appear below the help text before you generate the report.

### Generate report

- Click **Generate report** (disabled until at least one object and one sensor are selected).
- While loading, **Stop** cancels the request.
- The report shows:
  1. **Graph** — All selected sensors as lines (X = time, Y scaled to fit). Missing values do not drop to zero; lines connect known points only.
  2. **Raw data** table — One row per timestamp; columns = Time + one per sensor.
  3. **Summary** table — One row per date; columns = Date + Min, Max, Avg per sensor.

### Graph controls

- **Legend** — Each series has a label under the graph. **Click a label** to show or hide that line.
- **Drag** on the graph — Zoom into the selected time range.
- **Reset** — Restore the full time range (appears when zoomed).

### Tables

- **Search** — Filter rows by text.
- **Sort** — Click a column header to sort (toggle ascending/descending).
- **Rows per page** — 20, 50, or 100.
- **Export XLSX** — Download the table as an Excel file (per table block).
- **Pagination** — Previous/Next and page info below the table.

### Export and Import (report section header)

All main export actions are in the **top-right of the Reports panel** (next to the report title):

| Action | When available | Result |
|--------|----------------|--------|
| **Import** | Always | Restore report JSON (config ± cached data). |
| **Export JSON** | At least one object and sensor selected in Steps 2–3 | Config + optional cached graph/tables. |
| **Export HTML** | After **Generate report** | Single HTML file (graph, legend, both tables). |
| **Export PDF** | After **Generate report** | PDF with title, description, chart, and tables (client-side). |

- **Export JSON** includes **title**, **description**, selected objects/sensors (with multipliers), timeframe, and optionally **cached data** if the report was already generated. Filename: `sensoriqua-<name>-<date>.json`.
- **Import** restores name, description, timeframe, object/sensor selection (matched by `input_label` and `sensor_source`), and displays cached data immediately if present; otherwise click **Generate report** again.

Per-table **Export HTML** (inside a table toolbar) exports only that table when enabled.

### Data mode

- By default, the backend returns **1-minute bucketed** data. When the API supports **raw** (unresampled) data, the report can use every point. The UI sends the request according to the chosen mode.

---

## Map Tab

Use the map to see **where units are** and optionally filter them by **latest telemetry** before refreshing positions.

### Step 1 — Choose business entity

Pick the dimension to start from:

- **Objects** — Trackable units (object ↔ device).
- **Vehicles** — Fleet assets linked via `vehicles.object_id`.
- **Employees** — Drivers/staff assigned to objects.
- **Departments** — Org units via employees on objects.
- **Groups** / **Tags** — Business groupings and labels.
- **Sensor types** — Types from sensor metadata plus state/tracking.
- **Sensor names** — Distinct sensor names from telematics inputs; objects whose device has data for selected names.

### Step 2 — Select values

- Search and multi-select entities for the chosen type.
- **Clear** / **Select all** / **Refresh** list.
- **Empty selection** (for non-object types) = include all objects matching that entity type (no filter on Step 2).

### Step 3 — Conditions (optional)

- Add rules on latest **input** or **state** fields (loaded from telematics).
- Operators: `>`, `<`, `=`, **between** (two values).
- **All** conditions must pass for a unit to appear in the table/map scope.

### Refresh and results

- Click **Refresh** (footer) after defining scope in Steps 1–2.
- **Live map** — Markers at latest GPS from tracking data; popup shows label, coordinates, speed, last update.
- **Selected units table** (collapsible above the map):
  - Columns: object metadata, optional condition values, lat/lon, last update, speed.
  - Sort, search, show/hide columns, **Export XLSX**.

---

## Tips

- **No data in report** — Try a shorter or different timeframe, or use **Try last 24 hours** if the app suggests it.
- **Editing configured sensors** — Use **Edit** on the card or **Configure / Edit** in Step 3 for the same sensor; both save MIN/MAX, multiplier, and mini-chart period.
- **Search configured list** — Type an object or room/machine name to narrow a long Configured sensors list.
- **Mini-chart period** — Use 2–8 hours on noisy or slow-changing sensors so the sparkline is easier to read.
- **Dashboard groups** — Use short, clear labels (e.g. "Engine", "Cold store A") so framed sections stay readable; widgets keep a fixed size and wrap on small screens.
- **Threshold sync** — Edit MIN/MAX once on a configured sensor; both the center card and dashboard panel borders/sparklines update on the next refresh.
- **Dashboard Export/Import** — Export after arranging panels and groups; sensors must exist in the configured list or be resolvable by device/sensor.
- **Report Export/Import** — Export config (and optionally generated data) to reopen the same report without re-fetching.
- **Map conditions** — Add conditions only when you need to narrow units; leave Step 3 empty to show all units in scope.
- **Industry examples** — See **Use cases** in the [README](../README.md#use-cases) (heavy machinery, warehouse climate, and more).

For configuration and deployment, see [CONFIGURATION.md](CONFIGURATION.md). For the API, see [API_OVERVIEW.md](API_OVERVIEW.md).
