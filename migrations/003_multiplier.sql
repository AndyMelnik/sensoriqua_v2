-- Add multiplier column to scale raw sensor values (e.g. 0.001 for mV to V)
ALTER TABLE app_sensoriqua.configured_sensors
  ADD COLUMN IF NOT EXISTS multiplier numeric NULL;

COMMENT ON COLUMN app_sensoriqua.configured_sensors.multiplier IS 'Optional scale factor for raw values; displayed_value = raw_value * (multiplier ?? 1)';
