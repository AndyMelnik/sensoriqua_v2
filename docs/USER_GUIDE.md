# Sensoriqua 2 — User Guide

This guide describes how to use **Sensoriqua 2 (Dashboards and Reports)** for configuring sensors, building dashboards, and generating reports.

---

## Overview

The application has two main tabs:

- **Dashboards** — Configure sensors, build a live dashboard with panels, and optionally group panels. Export/import dashboard layout.
- **Reports** — Select objects and sensors, set a timeframe, and generate a report with a graph and tables (raw data and summary by date).

Both tabs share the same left-panel workflow: filter by grouping → choose objects → choose and configure sensors.

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
- Click **Configure / Add** to set:
  - **Display label** (e.g. "Speed", "Fuel level")
  - **MIN** and **MAX** thresholds (optional; used for green/red coloring)
  - **Multiplier** (e.g. 0.01 to scale values)
- Click **Add to configured list**. You can add several sensors per object via **+ Add sensor for this object**.

### Configured sensors (center)

- Each card shows: object label, sensor label, sparkline (last hour), and actions.
- **Edit** — Change label, MIN/MAX, or multiplier.
- **Add to dashboard** — Add this sensor to the dashboard (right side).
- **Remove** — Remove from the configured list (you can add it again later from Step 3).

If the backend cannot save (e.g. app state DB unavailable), the app switches to **browser storage**; the tagline will show **"Saved in this browser"**.

### Dashboard (right)

- Each panel shows: object label, sensor label, **latest value**, **timestamp**, and a sparkline.
  - **Green** = value within MIN/MAX; **red** = outside range.
- **Expand** — Dashboard fills the window (hides header and side panels). **Collapse** to return.
- **Update every** — Choose 30 sec, 1 min, or 5 min.
- **Click a panel** — Opens a **history chart** (1, 4, 12, or 24 hours).
- **×** on a panel — Removes it from the dashboard (sensor remains in the configured list).

#### Grouping panels

- **+** (top-left of a panel) — Open the group dialog. Enter a **group label** (e.g. "Engine", "Fuel"). Panels with the same label are shown inside a framed section with that title.
- **−** (top-left) — Remove the panel from its group (no label).
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
- The report will request data only within this range (or use "Try last 24 hours" if the range returns no data).

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
- **Export HTML** (top-right of graph) — Download a single HTML file with the graph, legend, Raw data table, and Summary table (landscape, print-friendly).

### Tables

- **Search** — Filter rows by text.
- **Sort** — Click a column header to sort (toggle ascending/descending).
- **Rows per page** — 20, 50, or 100.
- **Export XLSX** — Download the table data as an Excel file.
- **Pagination** — Previous/Next and page info below the table.

### Export and Import report (JSON)

- **Export** (top right of the report section) — Downloads a JSON file with the current **report configuration**: selected objects, sensors (with multipliers), and timeframe (From/To). If a report has already been generated, the file also includes the **cached data** (graph series, raw table, summary table) so you can re-open the same report without re-fetching. The file name is `sensoriqua-report-<name>-<date>.json`. Export is disabled until at least one object and one sensor are selected in Steps 2–3.
- **Import** — Choose a previously exported report JSON file. The app restores:
  - **Timeframe** (Step 4 From/To).
  - **Selected objects** and **sensors with multipliers** (Steps 2–3). Sensor slots are matched by object and by sensor `input_label` and `source`; if the backend has the same sensors for those objects, the left panel will show the same selection.
  - If the file contained **cached data**, the graph and tables are shown immediately; otherwise you can click **Generate report** to load fresh data for the restored config.

Use export to save a report setup for later, share it with others, or keep a snapshot of the data (when the file includes the cached result).

### Data mode

- By default, the backend returns **1-minute bucketed** data. When the API supports **raw** (unresampled) data, you can request it so the report uses every point (no averaging). The exact option is backend-dependent; the UI sends the request according to the chosen mode.

---

## Tips

- **No data in report** — Try a shorter or different timeframe, or use "Try last 24 hours" if the app suggests it.
- **Dashboard groups** — Use short, clear labels (e.g. "Engine", "Safety") so the framed sections stay readable.
- **Dashboard Export/Import** — Export a dashboard after arranging panels and groups; keep the JSON file to restore the same layout later or on another machine (sensors must exist in the configured list or be resolvable by device/sensor).
- **Report Export/Import** — Export a report config (and optionally the generated data) from the Reports tab; import to restore the same objects, sensors, multipliers, and timeframe, and optionally view the cached report without re-running Generate report.

For configuration and deployment, see [CONFIGURATION.md](CONFIGURATION.md). For the API, see [API_OVERVIEW.md](API_OVERVIEW.md).
