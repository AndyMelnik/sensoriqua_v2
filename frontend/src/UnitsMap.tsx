import { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

/** Custom location marker: circle with dot, fleet/unit style. */
const unitLocationIcon = L.divIcon({
  className: 'unit-location-marker',
  html: '<span class="unit-marker-outer"><span class="unit-marker-inner"></span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -10],
});

export type MapUnit = {
  key: string;
  label: string;
  objectId?: number;
  deviceId?: number;
  lat: number;
  lon: number;
  ts?: string;
  speed?: number | null;
  /** Chosen entity type label (e.g. "Group", "Tags") */
  entityLabel?: string;
  /** Value(s) for that entity for this unit */
  entityValue?: string | null;
};

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [map, points]);
  return null;
}

type UnitsMapProps = {
  units: MapUnit[];
  className?: string;
};

export function UnitsMap({ units, className }: UnitsMapProps) {
  const valid = units.filter((u) => Number.isFinite(u.lat) && Number.isFinite(u.lon));
  const points: [number, number][] = valid.map((u) => [u.lat, u.lon]);
  const center: [number, number] = valid.length ? [valid[0].lat, valid[0].lon] : [20, 0];
  const zoom = valid.length === 0 ? 2 : valid.length === 1 ? 13 : 4;

  return (
    <div className={className ?? 'units-map-wrap'}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="units-map-container">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.length > 0 && <FitBounds points={points} />}
        {valid.map((u) => (
          <Marker key={u.key} position={[u.lat, u.lon]} icon={unitLocationIcon}>
            <Popup>
              <div className="units-map-popup">
                <div className="units-map-popup-title">{u.label}</div>
                {u.entityLabel && (
                  <div className="units-map-popup-row">
                    <span className="units-map-popup-label">{u.entityLabel}</span>
                    <span className="units-map-popup-value">
                      {u.entityValue ?? '—'}
                    </span>
                  </div>
                )}
                {(u.objectId != null || u.deviceId != null) && (
                  <div className="units-map-popup-ids">
                    {u.objectId != null && <span>Object {u.objectId}</span>}
                    {u.objectId != null && u.deviceId != null && <span> · </span>}
                    {u.deviceId != null && <span>Device {u.deviceId}</span>}
                  </div>
                )}
                {u.ts && (
                  <div className="units-map-popup-row">
                    <span className="units-map-popup-label">Last update</span>
                    <span className="units-map-popup-value">{new Date(u.ts).toLocaleString()}</span>
                  </div>
                )}
                {u.speed != null && Number.isFinite(u.speed) && (
                  <div className="units-map-popup-row">
                    <span className="units-map-popup-label">Speed</span>
                    <span className="units-map-popup-value">
                      {u.speed.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </span>
                  </div>
                )}
                <div className="units-map-popup-row">
                  <span className="units-map-popup-label">Coordinates</span>
                  <span className="units-map-popup-coord">
                    {u.lat.toFixed(6)}°, {u.lon.toFixed(6)}°
                  </span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
