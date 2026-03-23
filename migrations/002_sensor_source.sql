-- Support sensor source: input (inputs), state (states), tracking (tracking_data_core)
ALTER TABLE app_sensoriqua.configured_sensors
  ADD COLUMN IF NOT EXISTS sensor_source text NOT NULL DEFAULT 'input';

COMMENT ON COLUMN app_sensoriqua.configured_sensors.sensor_source IS 'input | state | tracking';
