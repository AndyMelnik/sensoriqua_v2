import { useState, useEffect, useCallback, useMemo } from 'react';
import * as api from './api';
import { AccordionStep } from './AccordionStep';
import { UnitsMap, type MapUnit } from './UnitsMap';
import { MapUnitsTable, type MapTableColumn, type MapTableRow } from './MapUnitsTable';

/**
 * Map Step 1 — business entities aligned with raw_business_data:
 * objects ↔ devices/sensor_description; vehicles ↔ objects; employees ↔ objects & departments;
 * groups/tags; sensor metadata from sensor_description (types + distinct sensor_id / labels).
 */
export type MapEntityType =
  | 'objects'
  | 'vehicles'
  | 'employees'
  | 'departments'
  | 'groups'
  | 'tags'
  | 'sensor_types'
  | 'sensor_names';

const MAP_ENTITY_ORDER: MapEntityType[] = [
  'objects',
  'vehicles',
  'employees',
  'departments',
  'groups',
  'tags',
  'sensor_types',
  'sensor_names',
];

const MAP_ENTITY_LABELS: Record<MapEntityType, string> = {
  objects: 'Objects',
  vehicles: 'Vehicles',
  employees: 'Employees / drivers',
  departments: 'Departments',
  groups: 'Groups',
  tags: 'Tags',
  sensor_types: 'Sensor types',
  sensor_names: 'Sensor names',
};

/** Maps Step 1 choice to GET /api/groupings type (objects load via POST /api/objects). */
const MAP_ENTITY_GROUPING_TYPE: Record<
  Exclude<MapEntityType, 'objects'>,
  Parameters<typeof api.getGroupings>[0]
> = {
  vehicles: 'vehicles',
  employees: 'employees',
  departments: 'departments',
  groups: 'groups',
  tags: 'tags',
  sensor_types: 'sensor_types',
  sensor_names: 'sensor_names',
};

type MapCondition = {
  id: string;
  sensor: string;
  source: 'input' | 'state';
  op: '>' | '<' | '=' | 'between';
  value: number;
  value2?: number;
};

type ConditionFieldOption = {
  input_label: string;
  label: string;
  source: 'input' | 'state';
};

function conditionOptionKey(opt: ConditionFieldOption): string {
  return `${opt.source}:${opt.input_label}`;
}

type EntityItem = { id: number | string; label: string };
type ObjectItem = {
  id: number;
  label: string;
  device_id: number;
  group_label?: string | null;
  tag_labels?: string[];
  department_label?: string | null;
  vehicle_label?: string | null;
  employee_label?: string | null;
};

function toObjectFilter(
  entityType: MapEntityType,
  selectedIds: (number | string)[]
): Parameters<typeof api.getObjects>[0] {
  const filter: Parameters<typeof api.getObjects>[0] = { include_grouping_info: true };
  if (selectedIds.length === 0) return filter;
  const nums = selectedIds.map((x) => (typeof x === 'number' ? x : Number(x))).filter((n) => Number.isFinite(n));
  switch (entityType) {
    case 'objects':
      break;
    case 'vehicles':
      filter.vehicle_ids = nums as number[];
      break;
    case 'employees':
      filter.employee_ids = nums as number[];
      break;
    case 'departments':
      filter.department_ids = nums as number[];
      break;
    case 'groups':
      filter.group_ids = nums as number[];
      break;
    case 'tags':
      filter.tag_ids = nums as number[];
      break;
    case 'sensor_types':
      filter.sensor_type_ids = selectedIds.map((x) => String(x));
      break;
    case 'sensor_names':
      filter.sensor_names = selectedIds.map((x) => String(x)).filter((s) => s.length > 0);
      break;
  }
  return filter;
}

function step2Hint(entityType: MapEntityType): string {
  switch (entityType) {
    case 'objects':
      return 'Trackable units (object ↔ device). Pick objects to show, or leave all unchecked to include every object.';
    case 'vehicles':
      return 'Fleet assets (vehicles.object_id → objects). Select vehicles; leave empty to include all linked objects.';
    case 'employees':
      return 'Drivers / staff assigned to an object (employees.object_id). Leave empty for all.';
    case 'departments':
      return 'Org units via employees on objects (employees.department_id). Leave empty for all.';
    case 'groups':
      return 'Business groups (objects.group_id → groups). Leave empty for all.';
    case 'tags':
      return 'Labels via tag_links on objects. Leave empty for all.';
    case 'sensor_types':
      return 'Types from sensor_description plus state / tracking. Leave empty for all.';
    case 'sensor_names':
      return 'All sensor names from raw_telematics_data.inputs. Objects whose device has data for selected sensors. Leave empty for all.';
    default:
      return '';
  }
}

export function MapTab() {
  const [entityType, setEntityType] = useState<MapEntityType>('objects');
  const [entitySearch, setEntitySearch] = useState('');
  const [entityItems, setEntityItems] = useState<EntityItem[]>([]);
  const [selectedEntityIds, setSelectedEntityIds] = useState<(number | string)[]>([]);
  const [mapObjects, setMapObjects] = useState<ObjectItem[]>([]);
  const [conditions, setConditions] = useState<MapCondition[]>([]);
  const [openStep, setOpenStep] = useState(1);
  const [loadingEntity, setLoadingEntity] = useState<string | null>(null);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [mapUnits, setMapUnits] = useState<MapUnit[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapLastUpdated, setMapLastUpdated] = useState<string | null>(null);
  const [conditionFieldOptions, setConditionFieldOptions] = useState<ConditionFieldOption[]>([]);
  const [loadingConditionFields, setLoadingConditionFields] = useState(false);
  const [mapTableRows, setMapTableRows] = useState<MapTableRow[]>([]);
  const [tableAccordionOpen, setTableAccordionOpen] = useState(false);

  const loadEntityItems = useCallback(async () => {
    setLoadingEntity('entity');
    try {
      if (entityType === 'objects') {
        const list = (await api.getObjects({ include_grouping_info: true })) as { id: number; label: string }[];
        setEntityItems(list.map((o) => ({ id: o.id, label: o.label })));
      } else {
        const gType = MAP_ENTITY_GROUPING_TYPE[entityType];
        const list = (await api.getGroupings(gType, entitySearch || undefined)) as {
          id: number | string;
          label: string;
        }[];
        setEntityItems(list.map((g) => ({ id: g.id, label: g.label })));
      }
    } catch {
      setEntityItems([]);
    } finally {
      setLoadingEntity(null);
    }
  }, [entityType, entitySearch]);

  useEffect(() => {
    loadEntityItems();
  }, [loadEntityItems]);

  const loadMapObjects = useCallback(async () => {
    setLoadingObjects(true);
    try {
      if (entityType === 'objects') {
        const list = (await api.getObjects({ include_grouping_info: true })) as ObjectItem[];
        if (selectedEntityIds.length === 0) {
          setMapObjects(list);
        } else {
          setMapObjects(list.filter((o) => selectedEntityIds.includes(o.id)));
        }
        return;
      }
      const filter = toObjectFilter(entityType, selectedEntityIds);
      const list = (await api.getObjects(filter)) as ObjectItem[];
      setMapObjects(list);
    } catch {
      setMapObjects([]);
    } finally {
      setLoadingObjects(false);
    }
  }, [entityType, selectedEntityIds]);

  useEffect(() => {
    loadMapObjects();
  }, [loadMapObjects]);

  const toggleEntityId = (id: number | string) => {
    setSelectedEntityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const clearEntitySelection = () => setSelectedEntityIds([]);

  const selectAllEntities = () => setSelectedEntityIds(entityItems.map((e) => e.id));

  const filteredEntityItems = entitySearch.trim()
    ? entityItems.filter((e) =>
        String(e.label).toLowerCase().includes(entitySearch.toLowerCase())
      )
    : entityItems;

  const scopeObjects = mapObjects;

  const loadConditionFields = useCallback(async () => {
    setLoadingConditionFields(true);
    try {
      const res = await api.getMapConditionFields();
      const inputs = res.inputs ?? [];
      const states = res.states ?? [];
      const opts: ConditionFieldOption[] = [
        ...inputs.map((name) => ({
          input_label: name,
          label: name,
          source: 'input' as const,
        })),
        ...states.map((name) => ({
          input_label: name,
          label: name,
          source: 'state' as const,
        })),
      ].sort((a, b) => a.label.localeCompare(b.label));
      setConditionFieldOptions(opts);
    } catch {
      setConditionFieldOptions([]);
    } finally {
      setLoadingConditionFields(false);
    }
  }, []);

  useEffect(() => {
    loadConditionFields();
  }, [loadConditionFields]);

  const loadMapPositions = useCallback(async () => {
    if (scopeObjects.length === 0) {
      setMapUnits([]);
      setMapTableRows([]);
      setMapLastUpdated(new Date().toISOString());
      return;
    }
    setMapLoading(true);
    try {
      const deviceIds = [...new Set(scopeObjects.map((o) => o.device_id))];

      // 1. Get lat/lon from last tracking_data_core row per device (coherent GPS fix)
      const posRes = await api.getMapPositions(deviceIds);
      const positions = posRes.positions || {};

      // 2. If conditions: fetch latest input/state values and filter
      let passingDeviceIds = new Set(deviceIds);
      const tv: Record<string, { value?: number | null }> = {};
      if (conditions.length > 0) {
        const pairs: api.SparklinePair[] = [];
        for (const did of deviceIds) {
          for (const c of conditions) {
            pairs.push({
              device_id: did,
              sensor_input_label: c.sensor,
              sensor_source: c.source,
            });
          }
        }
        const tvRes = await api.getLatestValues(pairs);
        Object.assign(tv, tvRes.values || {});
        for (const did of deviceIds) {
          for (const c of conditions) {
            const key = `${did}:${c.source}:${c.sensor}`;
            const v = (tv[key] as { value?: number | null } | undefined)?.value;
            const num = v != null ? Number(v) : NaN;
            if (!Number.isFinite(num)) {
              passingDeviceIds.delete(did);
              break;
            }
            if (c.op === '>') {
              if (!(num > c.value)) {
                passingDeviceIds.delete(did);
                break;
              }
            } else if (c.op === '<') {
              if (!(num < c.value)) {
                passingDeviceIds.delete(did);
                break;
              }
            } else if (c.op === '=') {
              if (num !== c.value) {
                passingDeviceIds.delete(did);
                break;
              }
            } else if (c.op === 'between' && c.value2 != null) {
              const lo = Math.min(c.value, c.value2);
              const hi = Math.max(c.value, c.value2);
              if (!(num >= lo && num <= hi)) {
                passingDeviceIds.delete(did);
                break;
              }
            }
          }
        }
      }

      const rows: MapUnit[] = [];
      const tableRows: MapTableRow[] = [];
      const entityLabel = MAP_ENTITY_LABELS[entityType];
      const getEntityValue = (o: ObjectItem): string | null => {
        switch (entityType) {
          case 'groups':
            return o.group_label ?? null;
          case 'tags':
            return Array.isArray(o.tag_labels) && o.tag_labels.length > 0 ? o.tag_labels.join(', ') : null;
          case 'departments':
            return o.department_label ?? null;
          case 'vehicles':
            return o.vehicle_label ?? null;
          case 'employees':
            return o.employee_label ?? null;
          case 'objects':
            return o.label;
          default:
            return null;
        }
      };
      for (const o of scopeObjects) {
        if (!passingDeviceIds.has(o.device_id)) continue;
        const pos = positions[String(o.device_id)];
        if (!pos || pos.lat == null || pos.lon == null) continue;
        const lat = Number(pos.lat);
        const lon = Number(pos.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        rows.push({
          key: `${o.id}-${o.device_id}`,
          label: o.label,
          objectId: o.id,
          deviceId: o.device_id,
          lat,
          lon,
          ts: pos.ts,
          speed: pos.speed != null && Number.isFinite(pos.speed) ? pos.speed : null,
          entityLabel: entityType !== 'objects' ? entityLabel : undefined,
          entityValue: entityType !== 'objects' ? getEntityValue(o) ?? undefined : undefined,
        });
        const condValues: Record<string, number | null> = {};
        for (const c of conditions) {
          const key = `${o.device_id}:${c.source}:${c.sensor}`;
          const v = (tv[key] as { value?: number | null } | undefined)?.value;
          condValues[`cond_${c.id}`] = v != null && Number.isFinite(Number(v)) ? Number(v) : null;
        }
        const tags = Array.isArray(o.tag_labels) ? o.tag_labels : [];
        tableRows.push({
          label: o.label,
          device_id: o.device_id,
          object_id: o.id,
          group_label: o.group_label ?? null,
          tag_labels: tags.length > 0 ? tags.join(', ') : null,
          department_label: o.department_label ?? null,
          ...condValues,
          lat,
          lon,
          last_update: pos.ts ? new Date(pos.ts).toLocaleString() : null,
          speed: pos.speed != null && Number.isFinite(pos.speed) ? pos.speed : null,
        });
      }
      setMapUnits(rows);
      setMapTableRows(tableRows);
      setMapLastUpdated(new Date().toISOString());
    } catch {
      setMapUnits([]);
      setMapTableRows([]);
    } finally {
      setMapLoading(false);
    }
  }, [scopeObjects, conditions, entityType]);

  const addCondition = () => {
    const first = conditionFieldOptions[0];
    setConditions((prev) => [
      ...prev,
      {
        id: `cond-${Date.now()}`,
        sensor: first?.input_label ?? '',
        source: (first?.source ?? 'input') as MapCondition['source'],
        op: '>' as const,
        value: 0,
      },
    ]);
  };

  const removeCondition = (id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  };

  const updateCondition = (
    id: string,
    patch: Partial<Pick<MapCondition, 'sensor' | 'source' | 'op' | 'value' | 'value2'>>
  ) => {
    setConditions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const handleConditionFieldChange = (id: string, value: string) => {
    const [src, inputLabel] = value.includes(':') ? value.split(/:(.*)/).slice(0, 2) : ['input', value];
    updateCondition(id, {
      source: src as 'input' | 'state',
      sensor: inputLabel || value,
    });
  };

  const mapTableColumns = useMemo((): MapTableColumn[] => {
    const base: MapTableColumn[] = [
      { key: 'label', label: 'Object' },
      { key: 'device_id', label: 'Device ID' },
      { key: 'group_label', label: 'Group' },
      { key: 'tag_labels', label: 'Tags' },
      { key: 'department_label', label: 'Department' },
    ];
    const condCols = conditions.map((c) => {
      const opt = conditionFieldOptions.find(
        (s) => s.input_label === c.sensor && s.source === c.source
      );
      return {
        key: `cond_${c.id}`,
        label: opt ? `${opt.label} (${opt.source})` : `${c.sensor} (${c.source})`,
      };
    });
    return [
      ...base,
      ...condCols,
      { key: 'lat', label: 'Latitude' },
      { key: 'lon', label: 'Longitude' },
      { key: 'last_update', label: 'Last update' },
      { key: 'speed', label: 'Speed' },
    ];
  }, [conditions, conditionFieldOptions]);

  return (
    <div className="main-layout main-layout-map">
      <aside className="left-panel">
        <p className="map-welcome">
          View fleet positions on the map. Choose an entity type below, then select units and click Refresh.
        </p>
        <AccordionStep
          step={1}
          title="Choose business entity"
          open={openStep === 1}
          onToggle={() => setOpenStep((s) => (s === 1 ? 0 : 1))}
        >
          <p className="step-desc">
            Pick the dimension to start from: <strong>objects</strong> (trackable units), <strong>vehicles</strong> (fleet
            assets → objects), <strong>employees</strong> (drivers on objects), <strong>departments</strong>,{' '}
            <strong>groups</strong>, <strong>tags</strong>, <strong>sensor types</strong> or <strong>sensor names</strong>{' '}
            (from <code className="map-inline-code">sensor_description</code>).
          </p>
          <div className="map-entity-type-grid">
            {MAP_ENTITY_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                className={`map-entity-type-btn${entityType === t ? ' active' : ''}`}
                onClick={() => {
                  setEntityType(t);
                  setSelectedEntityIds([]);
                }}
              >
                {MAP_ENTITY_LABELS[t]}
              </button>
            ))}
          </div>
        </AccordionStep>

        <AccordionStep
          step={2}
          title="Select values"
          open={openStep === 2}
          onToggle={() => setOpenStep((s) => (s === 2 ? 0 : 2))}
          badge={
            selectedEntityIds.length > 0
              ? selectedEntityIds.length
              : filteredEntityItems.length > 0
                ? filteredEntityItems.length
                : undefined
          }
        >
          <p className="step-desc">{step2Hint(entityType)}</p>
          <input
            type="text"
            placeholder="Search..."
            value={entitySearch}
            onChange={(e) => setEntitySearch(e.target.value)}
          />
          <div className="list-wrap">
            {loadingEntity && <div className="loading">Loading…</div>}
            {filteredEntityItems.map((e) => (
              <label key={String(e.id)} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedEntityIds.includes(e.id)}
                  onChange={() => toggleEntityId(e.id)}
                />
                {e.label}
              </label>
            ))}
          </div>
          <div className="step-actions">
            <button type="button" className="btn-sm" onClick={clearEntitySelection}>
              Clear
            </button>
            <button type="button" className="btn-sm" onClick={selectAllEntities}>
              Select all
            </button>
            <button type="button" className="btn-sm" onClick={() => void loadEntityItems()}>
              Refresh
            </button>
          </div>
          {selectedEntityIds.length === 0 && entityType !== 'objects' && (
            <p className="hint">No selection = include all objects matching this entity type (no filter on Step 2).</p>
          )}
        </AccordionStep>

        <AccordionStep
          step={3}
          title="Conditions (optional)"
          open={openStep === 3}
          onToggle={() => setOpenStep((s) => (s === 3 ? 0 : 3))}
          badge={conditions.length > 0 ? conditions.length : undefined}
        >
          <p className="step-desc">
            Optional filters on the unit list using latest telemetry. Fields are all distinct{' '}
            <strong>sensor_name</strong> from <code className="map-inline-code">raw_telematics_data.inputs</code> and{' '}
            <strong>state_name</strong> from <code className="map-inline-code">raw_telematics_data.states</code>. All
            conditions must pass.
          </p>
          {loadingConditionFields && <p className="hint">Loading condition fields…</p>}
          {!loadingConditionFields && conditionFieldOptions.length === 0 && (
            <p className="hint">No input or state fields found in telematics data yet.</p>
          )}
          {conditions.map((c) => {
            const currentKey = `${c.source}:${c.sensor}`;
            const optionKeys = new Set(conditionFieldOptions.map(conditionOptionKey));
            const hasCurrent = c.sensor && optionKeys.has(currentKey);
            const effectiveOptions = hasCurrent
              ? conditionFieldOptions
              : [
                  ...conditionFieldOptions,
                  ...(c.sensor ? [{ input_label: c.sensor, label: c.sensor, source: c.source }] : []),
                ];
            return (
            <div key={c.id} className="map-threshold-row">
              <select
                value={currentKey}
                onChange={(e) => handleConditionFieldChange(c.id, e.target.value)}
                aria-label="Field"
                disabled={conditionFieldOptions.length === 0}
              >
                {conditionFieldOptions.length === 0 && (
                  <option value="">No fields loaded</option>
                )}
                {effectiveOptions.map((s) => (
                  <option key={conditionOptionKey(s)} value={conditionOptionKey(s)}>
                    {s.label} ({s.source})
                    {!optionKeys.has(conditionOptionKey(s)) ? ' — no longer in list' : ''}
                  </option>
                ))}
              </select>
              <select
                value={c.op}
                onChange={(e) => updateCondition(c.id, { op: e.target.value as MapCondition['op'] })}
                aria-label="Operator"
              >
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value="=">=</option>
                <option value="between">between</option>
              </select>
              <input
                type="number"
                value={c.value}
                onChange={(e) => updateCondition(c.id, { value: parseFloat(e.target.value) || 0 })}
                placeholder="Value"
                className="map-threshold-value"
                step="any"
              />
              {c.op === 'between' && (
                <input
                  type="number"
                  value={c.value2 ?? ''}
                  onChange={(e) =>
                    updateCondition(c.id, { value2: e.target.value ? parseFloat(e.target.value) : undefined })
                  }
                  placeholder="and"
                  className="map-threshold-value"
                  step="any"
                />
              )}
              <button
                type="button"
                className="btn-sm danger"
                onClick={() => removeCondition(c.id)}
                aria-label="Remove condition"
              >
                ×
              </button>
            </div>
          );
          })}
          <button
            type="button"
            className="btn-sm"
            onClick={addCondition}
            disabled={conditionFieldOptions.length === 0}
          >
            + Add condition
          </button>
        </AccordionStep>

        <div className="map-refresh-footer">
          <button
            type="button"
            className="btn-refresh-map primary"
            onClick={() => void loadMapPositions()}
            disabled={mapLoading || scopeObjects.length === 0}
          >
            {mapLoading ? 'Loading…' : 'Refresh'}
          </button>
          {scopeObjects.length === 0 && !mapLoading ? (
            <p className="hint map-refresh-hint">Select units in Step 1–2 first.</p>
          ) : mapLastUpdated ? (
            <p className="hint map-last-updated">
              Last updated: {new Date(mapLastUpdated).toLocaleString()}
            </p>
          ) : null}
        </div>
      </aside>

      <div className="map-panel">
        <div className="map-panel-header">
          <h2 className="map-panel-title">Live map</h2>
          <p className="map-panel-meta">
            {loadingObjects ? 'Loading objects…' : `${mapUnits.length} unit${mapUnits.length === 1 ? '' : 's'} with GPS`}
            {scopeObjects.length > 0 && ` · ${scopeObjects.length} in scope`}
          </p>
        </div>

        <div className={`accordion-step map-table-accordion ${tableAccordionOpen ? 'accordion-step--open' : ''}`}>
          <button
            type="button"
            className="accordion-step__header map-table-accordion__header"
            onClick={() => setTableAccordionOpen((o) => !o)}
            aria-expanded={tableAccordionOpen}
          >
            <span className="accordion-step__title">Selected units table</span>
            {mapTableRows.length > 0 && (
              <span className="accordion-step__badge">{mapTableRows.length}</span>
            )}
            <span className="accordion-step__chevron" aria-hidden>
              {tableAccordionOpen ? '▼' : '▶'}
            </span>
          </button>
          <div className="accordion-step__frame" hidden={!tableAccordionOpen}>
            <div className="accordion-step__content map-table-accordion__content">
              {mapTableRows.length === 0 ? (
                <p className="hint">Refresh the map to load units, then open this table.</p>
              ) : (
                <MapUnitsTable
                  columns={mapTableColumns}
                  rows={mapTableRows}
                  defaultHiddenKeys={['device_id', 'object_id']}
                />
              )}
            </div>
          </div>
        </div>

        <UnitsMap units={mapUnits} className="map-units-map" />
      </div>
    </div>
  );
}
