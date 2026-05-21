-- Mini-chart time window for configured sensors (1, 2, 4, or 8 hours)
ALTER TABLE app_sensoriqua.configured_sensors
  ADD COLUMN IF NOT EXISTS sparkline_hours smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN app_sensoriqua.configured_sensors.sparkline_hours IS 'Hours of history for dashboard mini-chart: 1, 2, 4, or 8';
