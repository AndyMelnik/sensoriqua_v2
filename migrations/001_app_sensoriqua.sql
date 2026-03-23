-- Sensoriqua: app config schema (Bronze stays immutable)
CREATE SCHEMA IF NOT EXISTS app_sensoriqua;

CREATE TABLE IF NOT EXISTS app_sensoriqua.configured_sensors (
  configured_sensor_id bigserial PRIMARY KEY,
  user_id integer NOT NULL,
  object_id integer NOT NULL,
  device_id integer NOT NULL,
  sensor_input_label text NOT NULL,
  sensor_id integer NULL,
  sensor_label_custom varchar(100) NOT NULL,
  min_threshold numeric NULL,
  max_threshold numeric NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfg_user ON app_sensoriqua.configured_sensors(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_cfg_object ON app_sensoriqua.configured_sensors(object_id);
CREATE INDEX IF NOT EXISTS idx_cfg_device_sensor ON app_sensoriqua.configured_sensors(device_id, sensor_input_label);

-- Dashboard: which configured sensors are on the dashboard and in what order
CREATE TABLE IF NOT EXISTS app_sensoriqua.dashboard_planes (
  dashboard_plane_id bigserial PRIMARY KEY,
  user_id integer NOT NULL,
  configured_sensor_id bigint NOT NULL REFERENCES app_sensoriqua.configured_sensors(configured_sensor_id) ON DELETE CASCADE,
  position_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, configured_sensor_id)
);

CREATE INDEX IF NOT EXISTS idx_dash_user ON app_sensoriqua.dashboard_planes(user_id);
