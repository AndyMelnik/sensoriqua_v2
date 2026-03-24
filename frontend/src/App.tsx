import { useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import * as api from './api';
import { Sparkline } from './Sparkline';
import { HistoryChart } from './HistoryChart';
import { ConfigModal, type ConfigForm } from './ConfigModal';
import { AccordionStep } from './AccordionStep';
import { ReportChart, type ReportSeries } from './ReportChart';
import { ReportTable } from './ReportTable';
import { MapTab } from './MapTab';
import './App.css';

type MainTab = 'dashboards' | 'reports' | 'map';
type GroupingType = 'groups' | 'tags' | 'sensor_types';

type GroupingItem = { id: number | string; label: string };
type ObjectItem = {
  id: number;
  label: string;
  device_id: number;
  group_id?: number;
  group_label?: string | null;
  tag_labels?: string[];
  department_label?: string | null;
};
type SensorItem = {
  sensor_id?: number | null;
  label: string;
  input_label: string;
  source?: 'input' | 'state' | 'tracking';
  sensor_type?: string | null;
  sensor_units?: string | null;
  description_parameters?: { name: string; value: unknown }[];
};
type ConfiguredSensor = {
  configured_sensor_id: number;
  object_id: number;
  device_id: number;
  sensor_input_label: string;
  sensor_source?: string;
  sensor_label_custom: string;
  min_threshold: number | null;
  max_threshold: number | null;
  multiplier?: number | null;
  object_label: string;
  created_at?: string;
};
type DashboardPlane = {
  dashboard_plane_id: number;
  configured_sensor_id: number;
  position_index: number;
  object_id: number;
  device_id: number;
  sensor_input_label: string;
  sensor_source?: string;
  sensor_label_custom: string;
  min_threshold: number | null;
  max_threshold: number | null;
  multiplier?: number | null;
  object_label: string;
  group_id?: string | null;
};

const GROUPING_LABELS: Record<GroupingType, string> = {
  groups: 'Groups',
  tags: 'Tags',
  sensor_types: 'Sensor type',
};

/** Report export JSON: config (objects + sensors + timeframe) and optional cached data */
type ReportExportSensor = { input_label: string; sensor_source: string; label: string; multiplier: number | string };
type ReportExportObject = { object_id: number; object_label: string; device_id: number; sensors: ReportExportSensor[] };
type ReportExportConfig = { objects: ReportExportObject[]; dateFrom: string; dateTo: string };
type ReportExportData = {
  chartSeries: ReportSeries[];
  tableRows: { ts: string; [key: string]: string | number | null }[];
  columns: { key: string; label: string }[];
  summaryRows: { date: string; [key: string]: string | number | null }[];
  summaryColumns: { key: string; label: string }[];
};
type ReportExportJson = {
  version: number;
  exportedAt: string;
  name?: string;
  report: { config: ReportExportConfig; data?: ReportExportData };
};

function scaleValue(v: number | null, mult: number | null | undefined): number | null {
  if (v == null) return null;
  const m = mult ?? 1;
  return v * m;
}

export default function App() {
  const [groupingType, setGroupingType] = useState<GroupingType>('groups');
  const [groupingSearch, setGroupingSearch] = useState('');
  const [groupingItems, setGroupingItems] = useState<GroupingItem[]>([]);
  const [selectedGroupingIds, setSelectedGroupingIds] = useState<Record<GroupingType, (number | string)[]>>({
    groups: [], tags: [], sensor_types: [],
  });
  const [objects, setObjects] = useState<ObjectItem[]>([]);
  const [objectsSearch, setObjectsSearch] = useState('');
  const [selectedObjectIds, setSelectedObjectIds] = useState<number[]>([]);
  const [sensorsByObject, setSensorsByObject] = useState<Record<number, SensorItem[]>>({});
  const [selectedSensorsByObject, setSelectedSensorsByObject] = useState<Record<number, Array<{ sensor: SensorItem | null; device_id: number; multiplier?: number | string }>>>({});
  const [configModal, setConfigModal] = useState<ConfigForm | null>(null);
  const [editingConfigId, setEditingConfigId] = useState<number | null>(null);
  const [configured, setConfigured] = useState<ConfiguredSensor[]>([]);
  const [sparklineData, setSparklineData] = useState<Record<string, { ts: string; value: number | null }[]>>({});
  const [dashboardPlanes, setDashboardPlanes] = useState<DashboardPlane[]>([]);
  const [dashboardGroups, setDashboardGroups] = useState<Record<string, { id: string; label: string }>>(
    () => (api.getLocalDashboardGroups() as Record<string, { id: string; label: string }>) || {}
  );
  const [dashboardAssignments, setDashboardAssignments] = useState<Record<number, string>>(
    () => (api.getLocalDashboardAssignments() as Record<number, string>) || {}
  );
  const [groupDialog, setGroupDialog] = useState<{
    plane: DashboardPlane;
    initialLabel: string;
  } | null>(null);
  const [dashboardValues, setDashboardValues] = useState<Record<string, { value: number | null; ts: string }>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<api.ApiDebugInfo | null>(null);
  const [openStep, setOpenStep] = useState<number>(0);
  const [objectListView, setObjectListView] = useState<'full' | 'groups' | 'tags'>('full');
  const [dashboardUpdateSeconds, setDashboardUpdateSeconds] = useState<number>(60);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportDashboardName, setExportDashboardName] = useState('');
  const [historyPlane, setHistoryPlane] = useState<DashboardPlane | null>(null);
  const [dashboardExpanded, setDashboardExpanded] = useState(false);
  const [historyDurationHours, setHistoryDurationHours] = useState<api.SensorHistoryHours>(1);
  const [historyData, setHistoryData] = useState<{ ts: string; value: number | null }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>('dashboards');
  const [reportDateFrom, setReportDateFrom] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 24, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [reportDateTo, setReportDateTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<{
    chartSeries: ReportSeries[];
    tableRows: { ts: string; [key: string]: string | number | null }[];
    columns: { key: string; label: string }[];
    summaryRows: { date: string; [key: string]: string | number | null }[];
    summaryColumns: { key: string; label: string }[];
  } | null>(null);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const preloadedObjectsRef = useRef<{ id: number; label: string; device_id: number }[] | null>(null);
  const reportChartContainerRef = useRef<HTMLDivElement>(null);
  const [reportChartSize, setReportChartSize] = useState({ w: 700, h: 360 });
  const reportAbortRef = useRef<AbortController | null>(null);
  const reportImportInputRef = useRef<HTMLInputElement>(null);
  const [reportImportConfig, setReportImportConfig] = useState<{
    objects: ReportExportObject[];
    dateFrom: string;
    dateTo: string;
    data?: ReportExportData;
  } | null>(null);

  useEffect(() => {
    if (!reportGenerated || !reportData) return;
    const el = reportChartContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 700, height: 360 };
      // When the Reports tab is hidden, the container can briefly report height ≈ 0.
      // Ignore those readings so the chart height doesn't keep shrinking on tab switches.
      const safeHeight = height < 120 ? reportChartSize.h : height;
      setReportChartSize((prev) => ({
        w: Math.max(300, width || prev.w),
        h: Math.max(240, safeHeight || prev.h),
      }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [reportGenerated, reportData, reportChartSize.h]);

  useEffect(() => {
    if (!reportImportConfig) return;
    const objectIds = reportImportConfig.objects.map((o) => o.object_id);
    const allLoaded = objectIds.every((id) => Array.isArray(sensorsByObject[id]));
    if (!allLoaded) return;
    const next: Record<number, Array<{ sensor: SensorItem | null; device_id: number; multiplier?: number | string }>> = {};
    reportImportConfig.objects.forEach((obj) => {
      const available = sensorsByObject[obj.object_id] ?? [];
      const slots = obj.sensors.map((s) => {
        const sensor = available.find(
          (a) => a.input_label === s.input_label && (a.source ?? 'input') === (s.sensor_source || 'input')
        ) ?? null;
        return {
          sensor,
          device_id: obj.device_id,
          multiplier: s.multiplier ?? 1,
        };
      });
      if (slots.length > 0) next[obj.object_id] = slots;
    });
    setSelectedSensorsByObject(next);
    if (reportImportConfig.data) {
      setReportData(reportImportConfig.data);
      setReportGenerated(true);
    }
    setReportImportConfig(null);
  }, [reportImportConfig, sensorsByObject]);

  const loadGroupings = useCallback(async () => {
    setLoading('groupings');
    setError(null);
    try {
      const list = await api.getGroupings(groupingType, groupingSearch || undefined);
      setGroupingItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }, [groupingType, groupingSearch]);

  useEffect(() => { loadGroupings(); }, [loadGroupings]);

  const loadObjects = useCallback(async () => {
    setLoading('objects');
    setError(null);
    try {
      const filter: Parameters<typeof api.getObjects>[0] = {};
      if (selectedGroupingIds.groups.length) filter.group_ids = selectedGroupingIds.groups as number[];
      if (selectedGroupingIds.tags.length) filter.tag_ids = selectedGroupingIds.tags as number[];
      if (selectedGroupingIds.sensor_types.length) filter.sensor_type_ids = selectedGroupingIds.sensor_types as string[];
      filter.include_grouping_info = true;
      const list = await api.getObjects(filter);
      setObjects(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }, [selectedGroupingIds]);

  useEffect(() => { loadObjects(); }, [selectedGroupingIds.groups, selectedGroupingIds.tags, selectedGroupingIds.sensor_types]);

  useEffect(() => {
    if (preloadedObjectsRef.current != null) return;
    api.getObjects({ include_grouping_info: true })
      .then((list) => { preloadedObjectsRef.current = list as { id: number; label: string; device_id: number }[]; })
      .catch(() => {});
  }, []);

  const loadSensorsForObject = useCallback(async (objectId: number, _deviceId: number) => {
    try {
      const list = await api.getSensorsForObject(objectId);
      setSensorsByObject((prev) => ({ ...prev, [objectId]: list }));
    } catch (_) {}
  }, []);

  useEffect(() => {
    selectedObjectIds.forEach((id) => {
      const obj = objects.find((o) => o.id === id);
      if (obj && !sensorsByObject[id]) loadSensorsForObject(id, obj.device_id);
    });
  }, [selectedObjectIds, objects, loadSensorsForObject]);

  useEffect(() => {
    setSelectedSensorsByObject((prev) => {
      let next = { ...prev };
      selectedObjectIds.forEach((id) => {
        const obj = objects.find((o) => o.id === id);
        if (!obj) return;
        const slots = next[id];
        if (slots && slots.length > 0) return;
        next = { ...next, [id]: [{ sensor: null, device_id: obj.device_id }] };
      });
      return next;
    });
  }, [selectedObjectIds, objects]);

  const addSensorSlot = (objectId: number, deviceId: number) => {
    setSelectedSensorsByObject((prev) => ({
      ...prev,
      [objectId]: [...(prev[objectId] ?? []), { sensor: null, device_id: deviceId, multiplier: 1 }],
    }));
  };

  const [useLocalConfig, setUseLocalConfig] = useState(false);

  const loadConfigured = useCallback(async () => {
    setError(null);
    if (useLocalConfig) {
      const list = api.getLocalConfiguredSensors() as ConfiguredSensor[];
      setConfigured(list);
      return;
    }
    try {
      const list = await api.getConfiguredSensors();
      if (list.length === 0) {
        const local = api.getLocalConfiguredSensors() as ConfiguredSensor[];
        if (local.length > 0) {
          setUseLocalConfig(true);
          setConfigured(local);
          return;
        }
      }
      setConfigured(list);
    } catch (e) {
      const is503 = e instanceof api.ApiError && e.debug?.status === 503;
      if (is503) {
        setUseLocalConfig(true);
        const list = api.getLocalConfiguredSensors() as ConfiguredSensor[];
        setConfigured(list);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [useLocalConfig]);

  const applyGroupsToPlanes = useCallback(
    (planes: DashboardPlane[]): DashboardPlane[] =>
      planes.map((p) => ({
        ...p,
        group_id: p.group_id ?? dashboardAssignments[p.configured_sensor_id] ?? null,
      })),
    [dashboardAssignments]
  );

  const loadDashboard = useCallback(async () => {
    if (useLocalConfig) {
      const list = api.getLocalDashboardPlanes() as DashboardPlane[];
      setDashboardPlanes(applyGroupsToPlanes(list));
      return;
    }
    try {
      const list = (await api.getDashboardPlanes()) as DashboardPlane[];
      if (list.length === 0) {
        const local = api.getLocalDashboardPlanes() as DashboardPlane[];
        if (local.length > 0) {
          setUseLocalConfig(true);
          setDashboardPlanes(applyGroupsToPlanes(local));
          return;
        }
      }
      setDashboardPlanes(applyGroupsToPlanes(list));
    } catch (e) {
      const is503 = e instanceof api.ApiError && e.debug?.status === 503;
      if (is503) {
        setUseLocalConfig(true);
        const list = api.getLocalDashboardPlanes() as DashboardPlane[];
        setDashboardPlanes(applyGroupsToPlanes(list));
      }
    }
  }, [useLocalConfig, applyGroupsToPlanes]);

  useEffect(() => { loadConfigured(); }, [loadConfigured]);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const loadSparklines = useCallback(async () => {
    if (configured.length === 0) return;
    try {
      const pairs = configured.map((c) => ({
        device_id: c.device_id,
        sensor_input_label: c.sensor_input_label,
        sensor_source: (c.sensor_source as 'input' | 'state' | 'tracking') || 'input',
      }));
      const res = await api.getSparklines(pairs);
      setSparklineData(res.series || {});
    } catch (_) {}
  }, [configured]);

  useEffect(() => { loadSparklines(); }, [configured, loadSparklines]);

  const loadDashboardValues = useCallback(async () => {
    if (dashboardPlanes.length === 0) return;
    try {
      const pairs = dashboardPlanes.map((p) => ({
        device_id: p.device_id,
        sensor_input_label: p.sensor_input_label,
        sensor_source: (p.sensor_source as 'input' | 'state' | 'tracking') || 'input',
      }));
      const res = await api.getLatestValues(pairs);
      setDashboardValues(res.values || {});
    } catch (_) {}
  }, [dashboardPlanes]);

  useEffect(() => { loadDashboardValues(); }, [dashboardPlanes, loadDashboardValues]);
  useEffect(() => {
    const ms = dashboardUpdateSeconds * 1000;
    const t = setInterval(loadDashboardValues, ms);
    return () => clearInterval(t);
  }, [loadDashboardValues, dashboardUpdateSeconds]);

  useEffect(() => {
    if (!historyPlane) {
      setHistoryData([]);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    const controller = new AbortController();
    api
      .getSensorHistory(
        {
          device_id: historyPlane.device_id,
          sensor_input_label: historyPlane.sensor_input_label,
          sensor_source: (historyPlane.sensor_source as 'input' | 'state' | 'tracking') || 'input',
        },
        historyDurationHours,
        controller.signal
      )
      .then((res) => {
        if (!cancelled) {
          const raw = res.series || [];
          setHistoryData(raw.map((d) => ({ ...d, value: scaleValue(d.value, historyPlane.multiplier) })));
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryData([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [historyPlane, historyDurationHours]);

  const toggleGrouping = (type: GroupingType, id: number | string) => {
    setSelectedGroupingIds((prev) => ({
      ...prev,
      [type]: prev[type].includes(id) ? prev[type].filter((x) => x !== id) : [...prev[type], id],
    }));
  };

  const clearGrouping = (type: GroupingType) => {
    setSelectedGroupingIds((prev) => ({ ...prev, [type]: [] }));
  };

  const filteredObjects = objectsSearch.trim()
    ? objects.filter((o) => o.label.toLowerCase().includes(objectsSearch.toLowerCase()))
    : objects;

  type GroupKey = string;
  const groupedObjects: { key: GroupKey; label: string; items: ObjectItem[] }[] = (() => {
    if (objectListView === 'full') return [{ key: '_', label: 'All', items: filteredObjects }];
    const acc: Record<string, ObjectItem[]> = {};
    filteredObjects.forEach((o) => {
      const keys: GroupKey[] = [];
      if (objectListView === 'groups') keys.push((o.group_label || 'No group') as GroupKey);
      else if (objectListView === 'tags') (o.tag_labels?.length ? o.tag_labels : ['No tag']).forEach((t) => keys.push(t as GroupKey));
      keys.forEach((k) => {
        if (!acc[k]) acc[k] = [];
        if (!acc[k].some((x) => x.id === o.id)) acc[k].push(o);
      });
    });
    return Object.entries(acc)
      .map(([key, items]) => ({ key, label: key, items }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  const toggleObject = (id: number) => {
    setSelectedObjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllObjects = () => {
    setSelectedObjectIds(filteredObjects.map((o) => o.id));
  };

  const openConfigModal = (obj: ObjectItem, sensor: SensorItem) => {
    setEditingConfigId(null);
    const source = sensor.source || 'input';
    setConfigModal({
      object_id: obj.id,
      object_label: obj.label,
      device_id: obj.device_id,
      sensor_input_label: sensor.input_label,
      sensor_source: source,
      sensor_label: sensor.label || sensor.input_label,
      sensor_label_custom: sensor.label || sensor.input_label,
      min_threshold: '',
      max_threshold: '',
      multiplier: '',
    });
  };

  const openEditModal = (c: ConfiguredSensor) => {
    setEditingConfigId(c.configured_sensor_id);
    setConfigModal({
      object_id: c.object_id,
      object_label: c.object_label,
      device_id: c.device_id,
      sensor_input_label: c.sensor_input_label,
      sensor_source: c.sensor_source || 'input',
      sensor_label: c.sensor_input_label,
      sensor_label_custom: c.sensor_label_custom,
      min_threshold: c.min_threshold != null ? String(c.min_threshold) : '',
      max_threshold: c.max_threshold != null ? String(c.max_threshold) : '',
      multiplier: c.multiplier != null ? String(c.multiplier) : '',
    });
  };

  const handleConfigSave = async (form: ConfigForm) => {
    setError(null);
    setDebugInfo(null);
    const minVal = form.min_threshold.trim() ? parseFloat(form.min_threshold) : null;
    const maxVal = form.max_threshold.trim() ? parseFloat(form.max_threshold) : null;
    const multVal = form.multiplier.trim() ? parseFloat(form.multiplier) : null;
    const source = (form.sensor_source as 'input' | 'state' | 'tracking') || 'input';

    if (useLocalConfig) {
      const list = api.getLocalConfiguredSensors() as ConfiguredSensor[];
      if (editingConfigId) {
        const out = list.map((c) =>
          c.configured_sensor_id === editingConfigId
            ? { ...c, sensor_label_custom: form.sensor_label_custom, min_threshold: minVal, max_threshold: maxVal, multiplier: multVal }
            : c
        );
        api.setLocalConfiguredSensors(out);
      } else {
        const localId = -Date.now();
        list.push({
          configured_sensor_id: localId,
          object_id: form.object_id,
          device_id: form.device_id,
          sensor_input_label: form.sensor_input_label,
          sensor_source: source,
          sensor_label_custom: form.sensor_label_custom,
          min_threshold: minVal,
          max_threshold: maxVal,
          multiplier: multVal,
          object_label: form.object_label,
        });
        api.setLocalConfiguredSensors(list);
      }
      setConfigModal(null);
      setEditingConfigId(null);
      loadConfigured();
      if (editingConfigId) {
        const planes = api.getLocalDashboardPlanes() as DashboardPlane[];
        const updated = planes.map((p) =>
          p.configured_sensor_id === editingConfigId
            ? { ...p, min_threshold: minVal, max_threshold: maxVal, multiplier: multVal }
            : p
        );
        api.setLocalDashboardPlanes(updated);
      }
      loadDashboard();
      setHistoryPlane((prev) => (prev && prev.configured_sensor_id === editingConfigId ? { ...prev, min_threshold: minVal, max_threshold: maxVal, multiplier: multVal } : prev));
      return;
    }

    try {
      if (editingConfigId) {
        await api.updateConfiguredSensor(editingConfigId, {
          sensor_label_custom: form.sensor_label_custom,
          min_threshold: minVal,
          max_threshold: maxVal,
          multiplier: multVal,
        });
      } else {
        await api.addConfiguredSensor({
          object_id: form.object_id,
          device_id: form.device_id,
          sensor_input_label: form.sensor_input_label,
          sensor_source: source,
          sensor_label_custom: form.sensor_label_custom,
          min_threshold: minVal,
          max_threshold: maxVal,
          multiplier: multVal,
        });
      }
      setConfigModal(null);
      setEditingConfigId(null);
      await loadConfigured();
      await loadDashboard();
      setHistoryPlane((prev) => (prev && prev.configured_sensor_id === editingConfigId ? { ...prev, min_threshold: minVal, max_threshold: maxVal, multiplier: multVal } : prev));
    } catch (e) {
      const is503 = e instanceof api.ApiError && e.debug?.status === 503;
      if (is503) {
        setUseLocalConfig(true);
        const list = api.getLocalConfiguredSensors() as ConfiguredSensor[];
        if (editingConfigId) {
          const out = list.map((c) =>
            c.configured_sensor_id === editingConfigId
              ? { ...c, sensor_label_custom: form.sensor_label_custom, min_threshold: minVal, max_threshold: maxVal, multiplier: multVal }
              : c
          );
          api.setLocalConfiguredSensors(out);
        } else {
          list.push({
            configured_sensor_id: -Date.now(),
            object_id: form.object_id,
            device_id: form.device_id,
            sensor_input_label: form.sensor_input_label,
            sensor_source: source,
            sensor_label_custom: form.sensor_label_custom,
            min_threshold: minVal,
            max_threshold: maxVal,
            multiplier: multVal,
            object_label: form.object_label,
          });
          api.setLocalConfiguredSensors(list);
        }
        setConfigModal(null);
        setEditingConfigId(null);
        setConfigured(api.getLocalConfiguredSensors() as ConfiguredSensor[]);
        if (editingConfigId) {
          const planes = api.getLocalDashboardPlanes() as DashboardPlane[];
          const updated = planes.map((p) =>
            p.configured_sensor_id === editingConfigId
              ? { ...p, min_threshold: minVal, max_threshold: maxVal, multiplier: multVal }
              : p
          );
          api.setLocalDashboardPlanes(updated);
        }
        loadDashboard();
        setHistoryPlane((prev) => (prev && prev.configured_sensor_id === editingConfigId ? { ...prev, min_threshold: minVal, max_threshold: maxVal, multiplier: multVal } : prev));
        return;
      }
      const is404Configured =
        e instanceof api.ApiError &&
        e.debug?.status === 404 &&
        typeof e.debug.responseBody === 'string' &&
        e.debug.responseBody.includes('Configured sensor not found');
      if (is404Configured) {
        setConfigModal(null);
        setEditingConfigId(null);
        setError('This configured sensor no longer exists in the backend. The list will be reloaded; please reopen it from Configured sensors.');
        await loadConfigured();
        await loadDashboard();
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (e instanceof api.ApiError) setDebugInfo(e.debug);
      else setDebugInfo(null);
    }
  };

  const handleRemoveConfigured = (id: number) => {
    setConfirmDialog({
      title: 'Remove sensor',
      message: 'This sensor will be removed from your configured list. You can add it again later from the left panel.',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        if (useLocalConfig) {
          const list = (api.getLocalConfiguredSensors() as ConfiguredSensor[]).filter((c) => c.configured_sensor_id !== id);
          api.setLocalConfiguredSensors(list);
          const planes = (api.getLocalDashboardPlanes() as DashboardPlane[]).filter((p) => p.configured_sensor_id !== id);
          api.setLocalDashboardPlanes(planes);
          loadConfigured();
          loadDashboard();
          return;
        }
        try {
          await api.deleteConfiguredSensor(id);
          loadConfigured();
          loadDashboard();
        } catch (e) {
          const is503 = e instanceof api.ApiError && e.debug?.status === 503;
          if (is503) {
            setUseLocalConfig(true);
            handleRemoveConfigured(id);
          } else setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const addToDashboard = async (configured_sensor_id: number) => {
    if (useLocalConfig) {
      const c = configured.find((x) => x.configured_sensor_id === configured_sensor_id);
      if (!c) return;
      const planes = api.getLocalDashboardPlanes() as DashboardPlane[];
      const planeId = -Date.now();
      planes.push({
        dashboard_plane_id: planeId,
        configured_sensor_id: c.configured_sensor_id,
        position_index: planes.length,
        object_id: c.object_id,
        device_id: c.device_id,
        sensor_input_label: c.sensor_input_label,
        sensor_source: c.sensor_source,
        sensor_label_custom: c.sensor_label_custom,
        min_threshold: c.min_threshold,
        max_threshold: c.max_threshold,
        multiplier: c.multiplier,
        object_label: c.object_label,
      });
      api.setLocalDashboardPlanes(planes);
      loadDashboard();
      return;
    }
    try {
      await api.addDashboardPlane(configured_sensor_id, dashboardPlanes.length);
      loadDashboard();
    } catch (e) {
      const is503 = e instanceof api.ApiError && e.debug?.status === 503;
      if (is503) {
        setUseLocalConfig(true);
        addToDashboard(configured_sensor_id);
      } else setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeFromDashboard = async (dashboard_plane_id: number) => {
    if (useLocalConfig) {
      const planes = (api.getLocalDashboardPlanes() as DashboardPlane[]).filter((p) => p.dashboard_plane_id !== dashboard_plane_id);
      api.setLocalDashboardPlanes(planes);
      loadDashboard();
      return;
    }
    try {
      await api.removeDashboardPlane(dashboard_plane_id);
      loadDashboard();
    } catch (_) {}
  };

  const confirmRemoveFromDashboard = (p: DashboardPlane) => {
    setConfirmDialog({
      title: 'Remove from dashboard',
      message: `"${p.sensor_label_custom}" will be removed from the dashboard. You can add it back from the configured sensors list.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        setConfirmDialog(null);
        removeFromDashboard(p.dashboard_plane_id);
      },
    });
  };

  const openGroupDialog = (p: DashboardPlane) => {
    const currentLabel = p.group_id ? dashboardGroups[p.group_id]?.label ?? '' : '';
    setGroupDialog({ plane: p, initialLabel: currentLabel });
  };

  const applyGroupLabel = (plane: DashboardPlane, labelRaw: string) => {
    const label = labelRaw.trim();
    if (!label) {
      // Ungroup
      setDashboardPlanes((prev) =>
        prev.map((dp) => (dp.dashboard_plane_id === plane.dashboard_plane_id ? { ...dp, group_id: null } : dp))
      );
      setDashboardAssignments((prev) => {
        if (!plane.configured_sensor_id) return prev;
        const next = { ...prev };
        delete next[plane.configured_sensor_id];
        api.setLocalDashboardAssignments(next);
        return next;
      });
      if (useLocalConfig) {
        const planes = (api.getLocalDashboardPlanes() as DashboardPlane[]).map((dp) =>
          dp.dashboard_plane_id === plane.dashboard_plane_id ? { ...dp, group_id: null } : dp
        );
        api.setLocalDashboardPlanes(planes);
      }
      return;
    }

    // Find or create a stable group id for this label
    let groupId =
      Object.values(dashboardGroups).find((g) => g.label === label)?.id ??
      `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    setDashboardGroups((prev) => {
      if (prev[groupId]) return prev;
      const next = { ...prev, [groupId]: { id: groupId, label } };
      api.setLocalDashboardGroups(next);
      return next;
    });

    setDashboardAssignments((prev) => {
      if (!plane.configured_sensor_id) return prev;
      const next = { ...prev, [plane.configured_sensor_id]: groupId };
      api.setLocalDashboardAssignments(next);
      return next;
    });

    setDashboardPlanes((prev) =>
      prev.map((dp) => (dp.dashboard_plane_id === plane.dashboard_plane_id ? { ...dp, group_id: groupId } : dp))
    );

    if (useLocalConfig) {
      const planes = (api.getLocalDashboardPlanes() as DashboardPlane[]).map((dp) =>
        dp.dashboard_plane_id === plane.dashboard_plane_id ? { ...dp, group_id: groupId } : dp
      );
      api.setLocalDashboardPlanes(planes);
    }
  };

  const sparkKey = (deviceId: number, sensor: string, source: string = 'input') => `${deviceId}:${source}:${sensor}`;
  const inThreshold = (val: number | null, min: number | null, max: number | null) => {
    if (val == null) return true;
    if (min != null && val < min) return false;
    if (max != null && val > max) return false;
    return true;
  };

  const REPORT_COLORS = ['#0ea5e9', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  const generateReport = useCallback(async (useLast24Hours = false) => {
    const pairs: { device_id: number; sensor_input_label: string; sensor_source: 'input' | 'state' | 'tracking'; object_label: string; sensor_label: string; multiplier: number }[] = [];
    selectedObjectIds.forEach((objectId) => {
      const obj = objects.find((o) => o.id === objectId);
      if (!obj) return;
      const slots = selectedSensorsByObject[objectId] ?? [];
      slots.forEach((slot) => {
        if (!slot.sensor) return;
        const rawMult = slot.multiplier;
        const mult =
          typeof rawMult === 'number' && Number.isFinite(rawMult) && rawMult > 0
            ? rawMult
            : typeof rawMult === 'string' && rawMult.trim() !== ''
              ? (() => {
                  const n = parseFloat(rawMult.trim());
                  return Number.isFinite(n) && n > 0 ? n : 1;
                })()
              : 1;
        pairs.push({
          device_id: slot.device_id,
          sensor_input_label: slot.sensor.input_label,
          sensor_source: (slot.sensor.source as 'input' | 'state' | 'tracking') || 'input',
          object_label: obj.label,
          sensor_label: slot.sensor.label || slot.sensor.input_label,
          multiplier: mult,
        });
      });
    });
    if (pairs.length === 0) {
      setError('Select at least one object and one sensor in Steps 2 and 3.');
      return;
    }
    if (!useLast24Hours) {
      const fromIso = new Date(reportDateFrom).toISOString();
      const toIso = new Date(reportDateTo).toISOString();
      if (fromIso >= toIso) {
        setError('Report "From" date must be before "To" date.');
        return;
      }
    }
    setError(null);
    if (reportAbortRef.current) {
      reportAbortRef.current.abort();
    }
    const controller = new AbortController();
    reportAbortRef.current = controller;
    setReportLoading(true);
    setReportGenerated(false);
    const fetchSeries = async (useHours = false) => {
      const opts = { raw: true as const };
      if (useHours) {
        return Promise.all(
          pairs.map((p) =>
            api.getSensorHistory(
              { device_id: p.device_id, sensor_input_label: p.sensor_input_label, sensor_source: p.sensor_source },
              { ...opts, hours: 24 },
              controller.signal
            )
          )
        );
      }
      return Promise.all(
        pairs.map((p) =>
          api.getSensorHistory(
            { device_id: p.device_id, sensor_input_label: p.sensor_input_label, sensor_source: p.sensor_source },
            { ...opts, from_ts: new Date(reportDateFrom).toISOString(), to_ts: new Date(reportDateTo).toISOString() },
            controller.signal
          )
        )
      );
    };
    try {
      let results: { series: { ts: string; value: number | null }[] }[];
      try {
        results = await fetchSeries(useLast24Hours);
      } catch (rangeErr) {
        if ((rangeErr as any)?.name === 'AbortError') {
          return;
        }
        if (!useLast24Hours && rangeErr instanceof Error && (rangeErr.message.includes('400') || rangeErr.message.includes('from_ts') || rangeErr.message.includes('to_ts'))) {
          results = await fetchSeries(true);
        } else {
          throw rangeErr;
        }
      }
      const mult = (i: number) => pairs[i]?.multiplier ?? 1;
      const chartSeries: ReportSeries[] = pairs.map((p, i) => ({
        label: p.sensor_label,
        color: REPORT_COLORS[i % REPORT_COLORS.length],
        data: (results[i]?.series ?? []).map((d) => ({
          ts: d.ts,
          value: d.value != null ? d.value * mult(i) : null,
        })),
      }));
      const allTs = new Set<string>();
      results.forEach((r) => (r?.series ?? []).forEach((d) => allTs.add(d.ts)));
      const sortedTs = Array.from(allTs).sort();
      const columns: { key: string; label: string }[] = [{ key: 'ts', label: 'Time' }];
      pairs.forEach((p, i) => columns.push({ key: `s${i}`, label: p.sensor_label }));
      const valueByTs = results.map((r, idx) => {
        const m = new Map<string, number | null>();
        const mul = mult(idx);
        (r?.series ?? []).forEach((d) => m.set(d.ts, d.value != null ? d.value * mul : null));
        return m;
      });
      const tableRows = sortedTs.map((ts) => {
        const row: { ts: string; [key: string]: string | number | null } = { ts };
        columns.forEach((col, ci) => {
          if (col.key === 'ts') row.ts = new Date(ts).toLocaleString();
          else {
            const idx = ci - 1;
            const v = valueByTs[idx]?.get(ts) ?? null;
            row[col.key] = v;
          }
        });
        return row;
      });

      const dateGroups = new Map<string, Map<number, number[]>>();
      sortedTs.forEach((ts) => {
        const dateStr = ts.slice(0, 10);
        if (!dateGroups.has(dateStr)) dateGroups.set(dateStr, new Map());
        const perSensor = dateGroups.get(dateStr)!;
        pairs.forEach((_, idx) => {
          const v = valueByTs[idx]?.get(ts);
          if (v != null && typeof v === 'number') {
            if (!perSensor.has(idx)) perSensor.set(idx, []);
            perSensor.get(idx)!.push(v);
          }
        });
      });
      const summaryColumns: { key: string; label: string }[] = [{ key: 'date', label: 'Date' }];
      pairs.forEach((p, i) => {
        summaryColumns.push({ key: `s${i}_min`, label: `${p.sensor_label} Min` });
        summaryColumns.push({ key: `s${i}_max`, label: `${p.sensor_label} Max` });
        summaryColumns.push({ key: `s${i}_avg`, label: `${p.sensor_label} Avg` });
      });
      const summaryRows = Array.from(dateGroups.keys())
        .sort()
        .map((dateStr) => {
          const perSensor = dateGroups.get(dateStr)!;
          const [y, m, d] = dateStr.split('-').map(Number);
          const dateDisplay = new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
          const row: { date: string; [key: string]: string | number | null } = {
            date: dateDisplay,
          };
          pairs.forEach((_, idx) => {
            const vals = perSensor.get(idx) ?? [];
            const min = vals.length ? Math.min(...vals) : null;
            const max = vals.length ? Math.max(...vals) : null;
            const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            row[`s${idx}_min`] = min;
            row[`s${idx}_max`] = max;
            row[`s${idx}_avg`] = avg;
          });
          return row;
        });

      setReportData({ chartSeries, tableRows, columns, summaryRows, summaryColumns });
      setReportGenerated(true);
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setReportData(null);
      setReportGenerated(false);
    } finally {
      if (reportAbortRef.current === controller) {
        reportAbortRef.current = null;
      }
      setReportLoading(false);
    }
  }, [selectedObjectIds, selectedSensorsByObject, objects, reportDateFrom, reportDateTo]);

  const exportFullReportHtml = useCallback(() => {
    if (!reportData) return;
    const chartSvg = reportChartContainerRef.current?.querySelector('.report-chart-svg')?.outerHTML ?? '';
    const escapeHtml = (s: string) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rawRows = reportData.tableRows
      .map((row) => `<tr>${reportData.columns.map((col) => `<td>${escapeHtml(String(row[col.key] ?? ''))}</td>`).join('')}</tr>`)
      .join('');
    const rawHeader = `<thead><tr>${reportData.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    const summaryRows = reportData.summaryRows
      .map((row) => `<tr>${reportData.summaryColumns.map((col) => `<td>${escapeHtml(String(row[col.key] ?? ''))}</td>`).join('')}</tr>`)
      .join('');
    const summaryHeader = `<thead><tr>${reportData.summaryColumns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    const legendItems = reportData.chartSeries.map((s) => ({
      label: s.label,
      color: s.color,
    }));
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Sensoriqua Report</title>
  <style>
    @page { size: A4 landscape; margin: 1.2cm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: transparent; color: #0f172a; padding: 0.75rem 1rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.4rem; }
    h2 { font-size: 1.05rem; margin: 1.25rem 0 0.4rem; }
    .chart-wrap { margin-bottom: 0.5rem; overflow: visible; }
    .chart-wrap svg { width: 100%; height: auto; max-height: 9cm; }
    .chart-legend { display: flex; flex-wrap: wrap; gap: 0.4rem 0.9rem; margin: 0.35rem 0 0; padding: 0; list-style: none; font-size: 0.8rem; }
    .chart-legend-item { display: inline-flex; align-items: center; gap: 0.35rem; }
    .chart-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 0.9rem; }
    th, td { padding: 0.35rem 0.5rem; text-align: left; border-bottom: 1px solid #d1d5db; }
    th { background: #f3f4f6; color: #374151; }
    .meta { font-size: 0.8rem; color: #4b5563; margin-bottom: 0.6rem; }
  </style>
</head>
<body>
  <h1>Sensor reading report</h1>
  <p class="meta">Exported ${new Date().toLocaleString()}</p>
  <h2>Graph</h2>
  <div class="chart-wrap">${chartSvg}</div>
  ${legendItems.length ? `<ul class="chart-legend">${legendItems
    .map((item) => `<li class="chart-legend-item"><span class="chart-legend-dot" style="background:${item.color}"></span><span>${escapeHtml(item.label)}</span></li>`)
    .join('')}</ul>` : ''}
  <h2>Raw data</h2>
  <table>${rawHeader}<tbody>${rawRows}</tbody></table>
  <h2>Summary</h2>
  <table>${summaryHeader}<tbody>${summaryRows}</tbody></table>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sensoriqua-report-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [reportData]);

  const cancelReport = () => {
    if (reportAbortRef.current) {
      reportAbortRef.current.abort();
      reportAbortRef.current = null;
    }
    setReportLoading(false);
  };

  const exportReportJson = (name?: string) => {
    const exportObjects: ReportExportObject[] = [];
    selectedObjectIds.forEach((objectId) => {
      const obj = objects.find((o) => o.id === objectId);
      if (!obj) return;
      const slots = selectedSensorsByObject[objectId] ?? [];
      const sensors = slots
        .filter((s) => s.sensor != null)
        .map((s) => ({
          input_label: s.sensor!.input_label,
          sensor_source: (s.sensor!.source ?? 'input') as string,
          label: s.sensor!.label || s.sensor!.input_label,
          multiplier: typeof s.multiplier === 'number' ? s.multiplier : (s.multiplier ?? 1),
        }));
      if (sensors.length > 0) {
        exportObjects.push({
          object_id: obj.id,
          object_label: obj.label,
          device_id: obj.device_id,
          sensors: sensors.map((s) => ({
            ...s,
            multiplier: s.multiplier as number | string,
          })),
        });
      }
    });
    if (exportObjects.length === 0) {
      setError('Select at least one object and one sensor in Steps 2–3 to export report config.');
      return;
    }
    const config: ReportExportConfig = {
      objects: exportObjects,
      dateFrom: reportDateFrom,
      dateTo: reportDateTo,
    };
    const payload: ReportExportJson = {
      version: 1,
      exportedAt: new Date().toISOString(),
      name: name?.trim() || undefined,
      report: {
        config,
        ...(reportGenerated && reportData
          ? {
              data: {
                chartSeries: reportData.chartSeries,
                tableRows: reportData.tableRows,
                columns: reportData.columns,
                summaryRows: reportData.summaryRows,
                summaryColumns: reportData.summaryColumns,
              },
            }
          : {}),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (name?.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'report');
    a.download = `sensoriqua-report-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importReportJson = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      const report = (raw as { report?: ReportExportJson['report'] }).report ?? (raw as { report?: ReportExportJson['report'] }).report;
      const config = report?.config ?? (raw as { config?: ReportExportConfig }).config;
      if (!config || !Array.isArray(config.objects) || config.objects.length === 0) {
        setError('Invalid report JSON: expected report.config.objects array.');
        return;
      }
      const dateFrom = typeof config.dateFrom === 'string' ? config.dateFrom : reportDateFrom;
      const dateTo = typeof config.dateTo === 'string' ? config.dateTo : reportDateTo;
      setReportDateFrom(dateFrom);
      setReportDateTo(dateTo);
      setSelectedObjectIds(config.objects.map((o) => o.object_id));
      setReportImportConfig({
        objects: config.objects,
        dateFrom,
        dateTo,
        data: report?.data,
      });
      if (report?.data) {
        setReportData(report.data);
        setReportGenerated(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid report JSON file.');
    }
  };

  const handleReportImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importReportJson(file);
    e.target.value = '';
  };

  const openExportModal = () => setExportModalOpen(true);

  const exportDashboard = (name: string) => {
    const safeName = name.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'dashboard';
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      name: name.trim() || undefined,
      dashboard: {
        planes: dashboardPlanes.map((p) => ({
          configured_sensor_id: p.configured_sensor_id,
          position_index: p.position_index,
          device_id: p.device_id,
          sensor_input_label: p.sensor_input_label,
          sensor_source: p.sensor_source || 'input',
          object_label: p.object_label,
          group_id: p.group_id ?? null,
        })),
        groups: Object.values(dashboardGroups),
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sensoriqua-dashboard-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportModalOpen(false);
    setExportDashboardName('');
  };

  const findConfiguredForPlane = (
    p: { configured_sensor_id?: number; device_id?: number; sensor_input_label?: string; sensor_source?: string },
    list: ConfiguredSensor[] = configured
  ): ConfiguredSensor | undefined => {
    if (p.configured_sensor_id != null) {
      const byId = list.find((c) => c.configured_sensor_id === p.configured_sensor_id);
      if (byId) return byId;
    }
    const deviceId = p.device_id != null ? Number(p.device_id) : NaN;
    const label = typeof p.sensor_input_label === 'string' ? p.sensor_input_label.trim() : '';
    const source = (p.sensor_source === 'state' || p.sensor_source === 'tracking' ? p.sensor_source : 'input') as 'input' | 'state' | 'tracking';
    if (!Number.isNaN(deviceId) && label) {
      return list.find(
        (c) =>
          c.device_id === deviceId &&
          c.sensor_input_label === label &&
          ((c.sensor_source || 'input') === source)
      );
    }
    return undefined;
  };

  const importDashboard = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const planes =
        data?.dashboard?.planes ??
        data?.dashboard?.Planes ??
        data?.planes ??
        data?.Planes ??
        (Array.isArray(data) ? data : null);
      if (!Array.isArray(planes) || planes.length === 0) {
        setError('Invalid dashboard JSON: expected "dashboard.planes" or "planes" array');
        return;
      }
      const importedGroups = (data?.dashboard?.groups ?? data?.groups) as { id?: string; label?: string }[] | undefined;
      if (Array.isArray(importedGroups) && importedGroups.length > 0) {
        const mapped: Record<string, { id: string; label: string }> = {};
        importedGroups.forEach((g) => {
          const id = (g.id || g.label || '').toString().trim();
          const label = (g.label || g.id || '').toString().trim();
          if (id && label) {
            mapped[id] = { id, label };
          }
        });
        setDashboardGroups(mapped);
        api.setLocalDashboardGroups(mapped);
      }

      type NormalizedPlane = {
        configured_sensor_id?: number;
        device_id?: number;
        sensor_input_label?: string;
        sensor_source?: string;
        object_label?: string;
        position_index: number;
        group_id?: string | null;
      };
      const normalized: NormalizedPlane[] = [];
      for (let i = 0; i < planes.length; i++) {
        const raw = planes[i] as Record<string, unknown>;
        if (!raw || typeof raw !== 'object') continue;
        const idRaw = raw.configured_sensor_id ?? raw.configuredSensorId ?? raw['configured_sensor_id'];
        const id = typeof idRaw === 'number' && !Number.isNaN(idRaw) ? idRaw : Number(idRaw);
        const deviceIdRaw = raw.device_id ?? raw.deviceId;
        const deviceId = typeof deviceIdRaw === 'number' && !Number.isNaN(deviceIdRaw) ? deviceIdRaw : Number(deviceIdRaw);
        const labelRaw = raw.sensor_input_label ?? raw.sensorInputLabel;
        const label = typeof labelRaw === 'string' ? labelRaw.trim() : '';
        const objectLabel = typeof (raw.object_label ?? raw.objectLabel) === 'string' ? String(raw.object_label ?? raw.objectLabel).trim() : '';
        const posRaw = raw.position_index ?? raw.positionIndex ?? i;
        const pos = typeof posRaw === 'number' && !Number.isNaN(posRaw) ? posRaw : i;
        const groupIdRaw = (raw.group_id ?? raw.groupId) as unknown;
        const groupId =
          typeof groupIdRaw === 'string'
            ? groupIdRaw.trim() || undefined
            : typeof groupIdRaw === 'number' && !Number.isNaN(groupIdRaw)
              ? String(groupIdRaw)
              : undefined;
        const hasId = !Number.isNaN(id);
        const hasIdentity = !Number.isNaN(deviceId) && label.length > 0;
        if (hasId || hasIdentity) {
          normalized.push({
            ...(hasId && { configured_sensor_id: id }),
            ...(hasIdentity && {
              device_id: deviceId,
              sensor_input_label: label,
              sensor_source:
                (raw.sensor_source ?? raw.sensorSource) === 'state' || (raw.sensor_source ?? raw.sensorSource) === 'tracking'
                  ? (raw.sensor_source ?? raw.sensorSource) as string
                  : 'input',
              ...(objectLabel && { object_label: objectLabel }),
            }),
            ...(groupId && { group_id: groupId }),
            position_index: pos,
          });
        }
      }
      if (normalized.length === 0) {
        setError('Invalid dashboard JSON: need an array of plane objects with configured_sensor_id and/or position_index.');
        return;
      }
      const hasAnyIdentity = normalized.some((p) => p.device_id != null && p.sensor_input_label);
      let currentConfigured = [...configured];
      if (hasAnyIdentity) {
        try {
          let objectsList: { id: number; label: string; device_id: number }[] | null = preloadedObjectsRef.current;
          if (objectsList == null) {
            objectsList = (await api.getObjects({ include_grouping_info: true })) as { id: number; label: string; device_id: number }[];
            preloadedObjectsRef.current = objectsList;
          }
          const deviceToObject: Record<number, { object_id: number; object_label: string }> = {};
          for (const o of objectsList) {
            if (o?.device_id != null) deviceToObject[o.device_id] = { object_id: o.id, object_label: o.label || '' };
          }
          const seen = new Set<string>();
          const toAdd: NormalizedPlane[] = [];
          for (const p of normalized) {
            if (p.device_id == null || !p.sensor_input_label) continue;
            const key = `${p.device_id}:${p.sensor_input_label}:${p.sensor_source || 'input'}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!findConfiguredForPlane(p, currentConfigured)) toAdd.push(p);
          }
          for (const p of toAdd) {
            const obj = p.device_id != null ? deviceToObject[p.device_id] : null;
            const objectId = obj?.object_id ?? p.device_id!;
            const objectLabel = obj?.object_label ?? p.object_label ?? '';
            const customLabel = (p.object_label || p.sensor_input_label || 'Sensor').slice(0, 100);
            if (useLocalConfig) {
              const newId = -Date.now() - Math.floor(Math.random() * 1e6);
              const newC: ConfiguredSensor = {
                configured_sensor_id: newId,
                object_id: objectId,
                device_id: p.device_id!,
                sensor_input_label: p.sensor_input_label!,
                sensor_source: p.sensor_source || 'input',
                sensor_label_custom: customLabel,
                min_threshold: null,
                max_threshold: null,
                multiplier: null,
                object_label: objectLabel,
              };
              currentConfigured = [...currentConfigured, newC];
              api.setLocalConfiguredSensors(currentConfigured);
            } else {
              await api.addConfiguredSensor({
                object_id: objectId,
                device_id: p.device_id!,
                sensor_input_label: p.sensor_input_label!,
                sensor_source: (p.sensor_source as 'input' | 'state' | 'tracking') || 'input',
                sensor_label_custom: customLabel,
                min_threshold: null,
                max_threshold: null,
                multiplier: null,
              });
            }
          }
          if (!useLocalConfig) {
            currentConfigured = await api.getConfiguredSensors();
          } else {
            currentConfigured = api.getLocalConfiguredSensors() as ConfiguredSensor[];
          }
          setConfigured(currentConfigured);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          const isAppStateError = errMsg.includes('table not found') || errMsg.includes('Configured sensors') || errMsg.includes('app_sensoriqua') ||
            (e instanceof api.ApiError && e.debug?.status === 503);
          if (isAppStateError && hasAnyIdentity) {
            setUseLocalConfig(true);
            currentConfigured = [];
            const seen = new Set<string>();
            for (const p of normalized) {
              if (p.device_id == null || !p.sensor_input_label) continue;
              const key = `${p.device_id}:${p.sensor_input_label}:${p.sensor_source || 'input'}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const newId = -Date.now() - Math.floor(Math.random() * 1e6);
              const customLabel = (p.object_label || p.sensor_input_label || 'Sensor').slice(0, 100);
              currentConfigured.push({
                configured_sensor_id: newId,
                object_id: p.device_id,
                device_id: p.device_id!,
                sensor_input_label: p.sensor_input_label!,
                sensor_source: p.sensor_source || 'input',
                sensor_label_custom: customLabel,
                min_threshold: null,
                max_threshold: null,
                multiplier: null,
                object_label: p.object_label ?? '',
              });
            }
            api.setLocalConfiguredSensors(currentConfigured);
            setConfigured(currentConfigured);
          } else {
            setError(errMsg);
            return;
          }
        }
      }
      const matched: { configured_sensor_id: number; position_index: number; group_id?: string | null }[] = [];
      for (let i = 0; i < normalized.length; i++) {
        const p = normalized[i];
        let c = findConfiguredForPlane(p, currentConfigured);
        if (!c && currentConfigured.length >= normalized.length) {
          c = currentConfigured[i];
        }
        if (c) {
          matched.push({ configured_sensor_id: c.configured_sensor_id, position_index: p.position_index, group_id: p.group_id });
        }
      }
      if (matched.length === 0) {
        if (currentConfigured.length === 0) {
          setError(
            hasAnyIdentity
              ? 'No devices from this file were found in your database. Use the left panel (Filter → select a group or tag) to load objects, then import again. Or check that you are connected to the same database the dashboard was exported from.'
              : `This file has ${normalized.length} panel(s) but no sensor details. Use a dashboard file exported from Sensoriqua (Export includes sensor details) to import on a fresh start.`
          );
        } else {
          setError(
            currentConfigured.length < normalized.length
              ? `File has ${normalized.length} panels, you have ${currentConfigured.length} sensors. Add more in the same order and import again, or use a file exported from this app.`
              : 'This file does not match your sensors. Export your dashboard from this app and import that file.'
          );
        }
        return;
      }
      if (useLocalConfig) {
        const newPlanes: DashboardPlane[] = [];
        matched.forEach((m, i) => {
          const c = currentConfigured.find((x) => x.configured_sensor_id === m.configured_sensor_id);
          if (!c) return;
          newPlanes.push({
            dashboard_plane_id: -Date.now() - i,
            configured_sensor_id: c.configured_sensor_id,
            position_index: m.position_index,
            object_id: c.object_id,
            device_id: c.device_id,
            sensor_input_label: c.sensor_input_label,
            sensor_source: c.sensor_source,
            sensor_label_custom: c.sensor_label_custom,
            min_threshold: c.min_threshold,
            max_threshold: c.max_threshold,
            multiplier: c.multiplier,
            object_label: c.object_label,
            group_id: m.group_id ?? null,
          });
        });
        api.setLocalDashboardPlanes(newPlanes);
        // Update local group assignments for imported planes
        const nextAssignments: Record<number, string> = {};
        matched.forEach((m) => {
          if (m.group_id && typeof m.group_id === 'string') {
            nextAssignments[m.configured_sensor_id] = m.group_id;
          }
        });
        setDashboardAssignments(nextAssignments);
        api.setLocalDashboardAssignments(nextAssignments);
        await loadConfigured();
        await loadDashboard();
        if (matched.length < normalized.length) {
          setError(`Imported ${matched.length} panel(s). ${normalized.length - matched.length} skipped (no matching sensor in your list).`);
        }
        return;
      }
      for (const { dashboard_plane_id } of dashboardPlanes) {
        await api.removeDashboardPlane(dashboard_plane_id);
      }
      for (let i = 0; i < matched.length; i++) {
        const m = matched[i];
        await api.addDashboardPlane(m.configured_sensor_id, m.position_index);
      }
      // Persist group assignments for server-backed dashboards locally
      const nextAssignments: Record<number, string> = {};
      matched.forEach((m) => {
        if (m.group_id && typeof m.group_id === 'string') {
          nextAssignments[m.configured_sensor_id] = m.group_id;
        }
      });
      setDashboardAssignments(nextAssignments);
      api.setLocalDashboardAssignments(nextAssignments);
      await loadConfigured();
      await loadDashboard();
      if (matched.length < normalized.length) {
        setError(`Imported ${matched.length} panel(s). ${normalized.length - matched.length} skipped (no matching sensor in your list).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importDashboard(file);
    e.target.value = '';
  };

  return (
    <div className={`app${dashboardExpanded ? ' app-dashboard-expanded' : ''}`}>
      <header className="top-bar">
        <div className="top-bar-brand">
          <div className="top-bar-title">Sensoriqua 2 (Dashboard, Report, Map)</div>
          <p className="top-bar-tagline">
            Dashboard for monitoring sensors in real time · Reports from sensor readings · Map for live unit positions
            {useLocalConfig && (
              <span className="top-bar-local-hint" title="Configured sensors and dashboard are stored in this browser (localStorage)"> · Saved in this browser</span>
            )}
          </p>
          <nav className="app-tabs" aria-label="Main sections">
            <button
              type="button"
              className={`app-tab${activeTab === 'dashboards' ? ' active' : ''}`}
              onClick={() => setActiveTab('dashboards')}
              aria-current={activeTab === 'dashboards' ? 'true' : undefined}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`app-tab${activeTab === 'reports' ? ' active' : ''}`}
              onClick={() => setActiveTab('reports')}
              aria-current={activeTab === 'reports' ? 'true' : undefined}
            >
              Report
            </button>
            <button
              type="button"
              className={`app-tab${activeTab === 'map' ? ' active' : ''}`}
              onClick={() => setActiveTab('map')}
              aria-current={activeTab === 'map' ? 'true' : undefined}
            >
              Map
            </button>
          </nav>
        </div>
        <div className="top-bar-actions">
          {activeTab === 'dashboards' && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="top-bar-import-input"
                aria-label="Import dashboard JSON"
                onChange={handleImportFile}
              />
              <button type="button" className="btn-sm" onClick={() => importInputRef.current?.click()}>
                Import
              </button>
              <button type="button" className="btn-sm" onClick={openExportModal}>
                Export
              </button>
            </>
          )}
        </div>
      </header>

      {error && <div className="global-error">{error}</div>}

      {exportModalOpen && (
        <div className="modal-overlay" onClick={() => { setExportModalOpen(false); setExportDashboardName(''); }}>
          <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Export dashboard</h3>
            <div className="form-row">
              <label htmlFor="export-dashboard-name">Dashboard name (for file and JSON)</label>
              <input
                id="export-dashboard-name"
                type="text"
                value={exportDashboardName}
                onChange={(e) => setExportDashboardName(e.target.value)}
                placeholder="e.g. My production dashboard"
                autoFocus
              />
            </div>
            <p className="hint">File will be saved as sensoriqua-dashboard-[name]-[date].json</p>
            <div className="modal-actions">
              <button type="button" onClick={() => { setExportModalOpen(false); setExportDashboardName(''); }}>Cancel</button>
              <button type="button" className="btn-sm primary" onClick={() => exportDashboard(exportDashboardName)}>Export</button>
            </div>
          </div>
        </div>
      )}

      {groupDialog && (
        <div className="modal-overlay" onClick={() => setGroupDialog(null)}>
          <div className="modal group-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Dashboard group</h3>
            <div className="form-row">
              <label htmlFor="dashboard-group-label">Group label</label>
              <input
                id="dashboard-group-label"
                type="text"
                defaultValue={groupDialog.initialLabel}
                placeholder="e.g. Engine, Fuel, Safety"
                autoFocus
              />
              <p className="hint">Leave empty to remove this element from any group.</p>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setGroupDialog(null)}>Cancel</button>
              <button
                type="button"
                className="btn-sm primary"
                onClick={() => {
                  const input = (document.getElementById('dashboard-group-label') as HTMLInputElement | null)?.value ?? '';
                  applyGroupLabel(groupDialog.plane, input);
                  setGroupDialog(null);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{confirmDialog.title}</h3>
            <p className="confirm-message">{confirmDialog.message}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button
                type="button"
                className={confirmDialog.danger ? 'danger' : 'primary'}
                onClick={() => confirmDialog.onConfirm()}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {debugInfo && (
        <div className="modal-overlay debug-overlay" onClick={() => setDebugInfo(null)}>
          <div className="modal debug-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Debug: Add sensor failed</h3>
            <p className="debug-summary"><strong>Status:</strong> {debugInfo.status} {debugInfo.statusText}</p>
            <p className="debug-summary"><strong>Message:</strong> {debugInfo.errorMessage}</p>
            <div className="debug-section">
              <label>Request</label>
              <pre className="debug-pre">{debugInfo.method} {debugInfo.url}</pre>
              <pre className="debug-pre">{JSON.stringify(debugInfo.requestBody, null, 2)}</pre>
            </div>
            <div className="debug-section">
              <label>Response body</label>
              <pre className="debug-pre">{debugInfo.responseBody}</pre>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setDebugInfo(null)}>Close</button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                }}
              >
                Copy to clipboard
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'dashboards' && (
      <div className="main-layout">
        <aside className="left-panel">
          <AccordionStep
            step={1}
            title="Filter objects by grouping"
            open={openStep === 1}
            onToggle={() => setOpenStep((s) => (s === 1 ? 0 : 1))}
            badge={selectedGroupingIds.groups.length + selectedGroupingIds.tags.length + selectedGroupingIds.sensor_types.length || undefined}
          >
            <p className="step-desc">Filter by <strong>Group</strong>, <strong>Tag</strong>, and/or <strong>Sensor type</strong>. Select one or more — objects matching any selection appear in Step 2. Leave all empty to see all objects.</p>
            <div className="tabs">
              {(Object.keys(GROUPING_LABELS) as GroupingType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={groupingType === t ? 'tab active' : 'tab'}
                  onClick={() => setGroupingType(t)}
                >
                  {GROUPING_LABELS[t]}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search..."
              value={groupingSearch}
              onChange={(e) => setGroupingSearch(e.target.value)}
            />
            <div className="list-wrap">
              {loading === 'groupings' && <div className="loading">Loading…</div>}
              {groupingItems.map((g) => (
                <label key={g.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedGroupingIds[groupingType].includes(g.id)}
                    onChange={() => toggleGrouping(groupingType, g.id)}
                  />
                  {g.label}
                </label>
              ))}
            </div>
            <button type="button" className="btn-sm" onClick={() => clearGrouping(groupingType)}>Clear</button>
          </AccordionStep>

          <AccordionStep
            step={2}
            title="Choose objects"
            open={openStep === 2}
            onToggle={() => setOpenStep((s) => (s === 2 ? 0 : 2))}
            badge={filteredObjects.length > 0 ? filteredObjects.length : undefined}
          >
            <p className="step-desc">Objects from Step 1. View as full list or grouped by Group / Tag. Select objects to pick sensors in Step 3.</p>
            <div className="view-mode">
              <label className="view-mode-label">View:</label>
              <select
                value={objectListView}
                onChange={(e) => setObjectListView(e.target.value as typeof objectListView)}
              >
                <option value="full">Full list</option>
                <option value="groups">Grouped by Group</option>
                <option value="tags">Grouped by Tag</option>
              </select>
            </div>
            <input
              type="text"
              placeholder="Search objects..."
              value={objectsSearch}
              onChange={(e) => setObjectsSearch(e.target.value)}
            />
            {loading === 'objects' && <div className="loading">Loading…</div>}
            <div className="list-wrap objects-list object-list-grouped">
              {groupedObjects.map((grp) => (
                <div key={grp.key} className="object-group">
                  {objectListView !== 'full' && <div className="object-group__title">{grp.label}</div>}
                  {grp.items.map((o) => (
                    <label key={o.id} className="checkbox-row">
                      <input type="checkbox" checked={selectedObjectIds.includes(o.id)} onChange={() => toggleObject(o.id)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="meta">Showing {filteredObjects.length} objects</div>
            {filteredObjects.length === 0 && objects.length === 0 && !loading && (
              <p className="hint">No objects loaded. Check connection and Step 1 filters (or leave Group/Tag empty to load all).</p>
            )}
            <div className="step-actions">
              <button type="button" className="btn-sm" onClick={() => loadObjects()}>Refresh list</button>
              <button type="button" className="btn-sm" onClick={selectAllObjects}>Select all filtered</button>
            </div>
          </AccordionStep>

          <AccordionStep
            step={3}
            title="Sensors &amp; configure"
            open={openStep === 3}
            onToggle={() => setOpenStep((s) => (s === 3 ? 0 : 3))}
            badge={selectedObjectIds.length > 0 ? selectedObjectIds.length : undefined}
          >
            <p className="step-desc">For each selected object you can add one or more sensors. Choose a sensor, set display label and MIN/MAX, then Add to configured list.</p>
            {selectedObjectIds.length === 0 && <p className="hint">Select objects in Step 2 first.</p>}
            {selectedObjectIds.map((objectId) => {
              const obj = objects.find((o) => o.id === objectId);
              if (!obj) return null;
              const sensors = sensorsByObject[objectId] || [];
              const slots = selectedSensorsByObject[objectId] ?? [{ sensor: null, device_id: obj.device_id }];
              return (
                <div key={objectId} className="object-sensors-block">
                  {slots.map((slot, idx) => (
                    <div key={`${objectId}-${idx}`} className="object-sensor-row">
                      <div className="obj-name">{idx === 0 ? obj.label : '\u00A0'}</div>
                      <select
                        value={slot.sensor ? `${slot.sensor.source ?? 'input'}:${slot.sensor.input_label}` : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setSelectedSensorsByObject((prev) => ({
                              ...prev,
                              [objectId]: (prev[objectId] ?? []).map((sl, i) => i === idx ? { ...sl, sensor: null } : sl),
                            }));
                            return;
                          }
                          const [source, inputLabel] = v.includes(':') ? v.split(/:(.*)/).filter(Boolean) : ['input', v];
                          const s = sensors.find((x) => (x.source ?? 'input') === source && x.input_label === inputLabel);
                          if (s) setSelectedSensorsByObject((prev) => ({
                            ...prev,
                            [objectId]: (prev[objectId] ?? []).map((sl, i) => i === idx ? { ...sl, sensor: s } : sl),
                          }));
                        }}
                      >
                        <option value="">Select sensor</option>
                        {sensors.map((s) => (
                          <option key={`${s.source ?? 'input'}:${s.input_label}`} value={`${s.source ?? 'input'}:${s.input_label}`}>
                            {s.label || s.input_label} ({s.source ?? 'input'})
                            {s.sensor_type || s.sensor_units ? ` · ${[s.sensor_type, s.sensor_units].filter(Boolean).join(' · ')}` : ''}
                          </option>
                        ))}
                      </select>
                      {slot.sensor?.description_parameters && slot.sensor.description_parameters.length > 0 && (
                        <div className="sensor-params">
                          {slot.sensor.description_parameters.map((p, i) => (
                            <span key={i} className="sensor-param">{p.name}: {String(p.value)}</span>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn-sm primary"
                        disabled={!slot.sensor}
                        onClick={() => slot.sensor && openConfigModal(obj, slot.sensor)}
                      >
                        Configure / Add
                      </button>
                    </div>
                  ))}
                  <div className="object-sensor-row object-sensor-add-row">
                    <div className="obj-name" />
                    <button type="button" className="btn-sm" onClick={() => addSensorSlot(objectId, obj.device_id)}>
                      + Add sensor for this object
                    </button>
                  </div>
                </div>
              );
            })}
          </AccordionStep>
        </aside>

        <div className="center-panel">
          <section className="configured-section">
            <h4>Configured sensors</h4>
            <div className="configured-cards">
              {configured.map((c) => {
                const key = sparkKey(c.device_id, c.sensor_input_label, c.sensor_source || 'input');
                const rawData = sparklineData[key] || [];
                const data = rawData.map((d) => ({ ...d, value: scaleValue(d.value, c.multiplier) }));
                const isOnDashboard = dashboardPlanes.some((p) => p.configured_sensor_id === c.configured_sensor_id);
                return (
                  <div key={c.configured_sensor_id} className={`configured-card${isOnDashboard ? ' configured-card-on-dashboard' : ''}`}>
                    <div className="card-main">
                      <div className="card-header">
                        <span className="obj-label">{c.object_label}</span>
                        <span className="sensor-label">{c.sensor_label_custom}</span>
                      </div>
                      <div className="spark-wrap">
                        <Sparkline
                          data={data}
                          width={100}
                          height={24}
                          showThresholds
                          min={c.min_threshold}
                          max={c.max_threshold}
                        />
                      </div>
                    </div>
                    <div className="card-actions">
                      <button type="button" className="card-action-btn" onClick={() => openEditModal(c)} title="Edit" aria-label="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      </button>
                      <button
                        type="button"
                        className={`card-action-btn${isOnDashboard ? ' on-dashboard' : ''}`}
                        onClick={() => !isOnDashboard && addToDashboard(c.configured_sensor_id)}
                        title={isOnDashboard ? 'On dashboard' : 'Add to dashboard'}
                        aria-label={isOnDashboard ? 'On dashboard' : 'Add to dashboard'}
                        disabled={isOnDashboard}
                      >
                        {isOnDashboard ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                        )}
                      </button>
                      <button type="button" className="card-action-btn danger" onClick={() => handleRemoveConfigured(c.configured_sensor_id)} title="Remove" aria-label="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className={`dashboard-panel${dashboardExpanded ? ' dashboard-panel-expanded' : ''}`}>
          <div className="dashboard-panel-header">
            <h4>Dashboard</h4>
            <div className="dashboard-panel-actions">
              {dashboardExpanded ? (
                <button
                  type="button"
                  className="btn-sm primary dashboard-expand-toggle"
                  onClick={() => setDashboardExpanded(false)}
                  title="Collapse to normal view"
                  aria-label="Collapse dashboard"
                >
                  Collapse
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-sm primary dashboard-expand-toggle"
                  onClick={() => setDashboardExpanded(true)}
                  title="Expand to full window"
                  aria-label="Expand dashboard"
                >
                  Expand
                </button>
              )}
              <div className="dashboard-update-duration">
                <label>Update every</label>
                <select
                  value={dashboardUpdateSeconds}
                  onChange={(e) => setDashboardUpdateSeconds(Number(e.target.value))}
                  aria-label="Dashboard update interval"
                >
                  <option value={30}>30 sec</option>
                  <option value={60}>1 min</option>
                  <option value={300}>5 min</option>
                </select>
              </div>
            </div>
          </div>
          {dashboardPlanes.length > 0 && <p className="hint">Sensors added from the list appear here. Values update periodically.</p>}
          <div className="dashboard-grid">
            {dashboardPlanes.length === 0 ? (
              <div className="dashboard-welcome">
                <p className="dashboard-welcome-title">No dashboard yet</p>
                <p className="dashboard-welcome-text">
                  Import a dashboard to get started. Use a JSON file exported from Sensoriqua so it includes sensor details.
                </p>
                <button
                  type="button"
                  className="btn-sm primary dashboard-welcome-import"
                  onClick={() => importInputRef.current?.click()}
                >
                  Import dashboard
                </button>
                <p className="dashboard-welcome-hint">Or add sensors from the left panel, then add them to the dashboard.</p>
              </div>
            ) : (() => {
              const grouped: Record<string, DashboardPlane[]> = {};
              const ungrouped: DashboardPlane[] = [];
              dashboardPlanes.forEach((p) => {
                if (p.group_id) {
                  if (!grouped[p.group_id]) grouped[p.group_id] = [];
                  grouped[p.group_id].push(p);
                } else {
                  ungrouped.push(p);
                }
              });

              const renderPlane = (p: DashboardPlane) => {
                const key = sparkKey(p.device_id, p.sensor_input_label, p.sensor_source || 'input');
                const latest = dashboardValues[key];
                const rawVal = latest?.value ?? null;
                const val = scaleValue(rawVal, p.multiplier);
                const ok = inThreshold(val, p.min_threshold, p.max_threshold);
                const rawData = sparklineData[key] || [];
                const data = rawData.map((d) => ({ ...d, value: scaleValue(d.value, p.multiplier) }));
                return (
                  <div
                    key={p.dashboard_plane_id}
                    className="dashboard-plane"
                    data-ok={ok}
                    role="button"
                    tabIndex={0}
                    onClick={() => setHistoryPlane(p)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHistoryPlane(p); } }}
                    title="Click to view history"
                  >
                    <button
                      type="button"
                      className="plane-close"
                      onClick={(e) => { e.stopPropagation(); confirmRemoveFromDashboard(p); }}
                      title="Remove from dashboard"
                      aria-label="Remove from dashboard"
                    >
                      ×
                    </button>
                    <div className="plane-group-controls">
                      <button
                        type="button"
                        className="plane-group-btn plane-group-add"
                        onClick={(e) => { e.stopPropagation(); openGroupDialog(p); }}
                        title={p.group_id ? 'Change group' : 'Add to group'}
                        aria-label="Add to group"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="plane-group-btn plane-group-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          applyGroupLabel(p, '');
                        }}
                        disabled={!p.group_id || String(p.group_id).trim() === ''}
                        title="Remove from group"
                        aria-label="Remove from group"
                      >
                        −
                      </button>
                    </div>
                    <div className="plane-header">
                      <span className="obj-label">{p.object_label}</span>
                      <span className="sensor-label">{p.sensor_label_custom}</span>
                    </div>
                    <div className="plane-value">
                      {val != null ? val.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                    </div>
                    <div className="plane-ts">{latest?.ts ? new Date(latest.ts).toLocaleString() : '—'}</div>
                    <div className="plane-spark">
                      <Sparkline data={data} width={160} height={36} showThresholds min={p.min_threshold} max={p.max_threshold} stroke={ok ? '#22c55e' : '#ef4444'} />
                    </div>
                  </div>
                );
              };

              return (
                <>
                  {Object.entries(grouped).map(([groupId, planes]) => {
                    const group = dashboardGroups[groupId];
                    return (
                      <div key={groupId} className="dashboard-group">
                        <div className="dashboard-group-header">
                          <span className="dashboard-group-title">{group?.label ?? 'Group'}</span>
                        </div>
                        <div className="dashboard-group-grid">
                          {planes.map((p) => renderPlane(p))}
                        </div>
                      </div>
                    );
                  })}
                  {ungrouped.map((p) => renderPlane(p))}
                </>
              );
            })()}
          </div>
        </div>
      </div>
      )}

      {activeTab === 'reports' && (
      <div className="main-layout main-layout-reports">
        <aside className="left-panel">
          <AccordionStep
            step={1}
            title="Filter objects by grouping"
            open={openStep === 1}
            onToggle={() => setOpenStep((s) => (s === 1 ? 0 : 1))}
            badge={selectedGroupingIds.groups.length + selectedGroupingIds.tags.length + selectedGroupingIds.sensor_types.length || undefined}
          >
            <p className="step-desc">Filter by <strong>Group</strong>, <strong>Tag</strong>, and/or <strong>Sensor type</strong>. Select one or more — objects matching any selection appear in Step 2. Leave all empty to see all objects.</p>
            <div className="tabs">
              {(Object.keys(GROUPING_LABELS) as GroupingType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={groupingType === t ? 'tab active' : 'tab'}
                  onClick={() => setGroupingType(t)}
                >
                  {GROUPING_LABELS[t]}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search..."
              value={groupingSearch}
              onChange={(e) => setGroupingSearch(e.target.value)}
            />
            <div className="list-wrap">
              {loading === 'groupings' && <div className="loading">Loading…</div>}
              {groupingItems.map((g) => (
                <label key={g.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedGroupingIds[groupingType].includes(g.id)}
                    onChange={() => toggleGrouping(groupingType, g.id)}
                  />
                  {g.label}
                </label>
              ))}
            </div>
            <button type="button" className="btn-sm" onClick={() => clearGrouping(groupingType)}>Clear</button>
          </AccordionStep>

          <AccordionStep
            step={2}
            title="Choose objects"
            open={openStep === 2}
            onToggle={() => setOpenStep((s) => (s === 2 ? 0 : 2))}
            badge={filteredObjects.length > 0 ? filteredObjects.length : undefined}
          >
            <p className="step-desc">Objects from Step 1. View as full list or grouped by Group / Tag. Select objects to pick sensors in Step 3.</p>
            <div className="view-mode">
              <label className="view-mode-label">View:</label>
              <select
                value={objectListView}
                onChange={(e) => setObjectListView(e.target.value as typeof objectListView)}
              >
                <option value="full">Full list</option>
                <option value="groups">Grouped by Group</option>
                <option value="tags">Grouped by Tag</option>
              </select>
            </div>
            <input
              type="text"
              placeholder="Search objects..."
              value={objectsSearch}
              onChange={(e) => setObjectsSearch(e.target.value)}
            />
            {loading === 'objects' && <div className="loading">Loading…</div>}
            <div className="list-wrap objects-list object-list-grouped">
              {groupedObjects.map((grp) => (
                <div key={grp.key} className="object-group">
                  {objectListView !== 'full' && <div className="object-group__title">{grp.label}</div>}
                  {grp.items.map((o) => (
                    <label key={o.id} className="checkbox-row">
                      <input type="checkbox" checked={selectedObjectIds.includes(o.id)} onChange={() => toggleObject(o.id)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="meta">Showing {filteredObjects.length} objects</div>
            {filteredObjects.length === 0 && objects.length === 0 && !loading && (
              <p className="hint">No objects loaded. Check connection and Step 1 filters (or leave Group/Tag empty to load all).</p>
            )}
            <div className="step-actions">
              <button type="button" className="btn-sm" onClick={() => loadObjects()}>Refresh list</button>
              <button type="button" className="btn-sm" onClick={selectAllObjects}>Select all filtered</button>
            </div>
          </AccordionStep>

          <AccordionStep
            step={3}
            title="Sensors &amp; configure"
            open={openStep === 3}
            onToggle={() => setOpenStep((s) => (s === 3 ? 0 : 3))}
            badge={selectedObjectIds.length > 0 ? selectedObjectIds.length : undefined}
          >
            <p className="step-desc">For each selected object, choose sensors to include in the report. Selections here define the scope of the report (graph and table).</p>
            {selectedObjectIds.length === 0 && <p className="hint">Select objects in Step 2 first.</p>}
            {selectedObjectIds.map((objectId) => {
              const obj = objects.find((o) => o.id === objectId);
              if (!obj) return null;
              const allSensors = sensorsByObject[objectId] || [];
              const selectedTypes = selectedGroupingIds.sensor_types;
              const sensors = selectedTypes.length === 0
                ? allSensors
                : allSensors.filter((s) => {
                    const source = s.source ?? 'input';
                    const st = s.sensor_type ?? null;
                    return selectedTypes.some((t) => {
                      if (t === 'state') return source === 'state';
                      if (t === 'tracking') return source === 'tracking';
                      return source === 'input' && st != null && String(st) === String(t);
                    });
                  });
              const slots = selectedSensorsByObject[objectId] ?? [{ sensor: null, device_id: obj.device_id }];
              return (
                <div key={objectId} className="object-sensors-block">
                  {slots.map((slot, idx) => (
                    <div key={`${objectId}-${idx}`} className="object-sensor-row">
                      <div className="obj-name">{idx === 0 ? obj.label : '\u00A0'}</div>
                      <select
                        value={slot.sensor ? `${slot.sensor.source ?? 'input'}:${slot.sensor.input_label}` : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setSelectedSensorsByObject((prev) => ({
                              ...prev,
                              [objectId]: (prev[objectId] ?? []).map((sl, i) => i === idx ? { ...sl, sensor: null } : sl),
                            }));
                            return;
                          }
                          const [source, inputLabel] = v.includes(':') ? v.split(/:(.*)/).filter(Boolean) : ['input', v];
                          const s = sensors.find((x) => (x.source ?? 'input') === source && x.input_label === inputLabel);
                          if (s) setSelectedSensorsByObject((prev) => ({
                            ...prev,
                            [objectId]: (prev[objectId] ?? []).map((sl, i) => i === idx ? { ...sl, sensor: s } : sl),
                          }));
                        }}
                      >
                        <option value="">Select sensor</option>
                        {sensors.map((s) => (
                          <option key={`${s.source ?? 'input'}:${s.input_label}`} value={`${s.source ?? 'input'}:${s.input_label}`}>
                            {s.label || s.input_label} ({s.source ?? 'input'})
                            {s.sensor_type || s.sensor_units ? ` · ${[s.sensor_type, s.sensor_units].filter(Boolean).join(' · ')}` : ''}
                          </option>
                        ))}
                      </select>
                      {slot.sensor && (
                        <div className="sensor-multiplier-wrap">
                          <label htmlFor={`report-mult-${objectId}-${idx}`} className="sensor-multiplier-label">×</label>
                          <input
                            id={`report-mult-${objectId}-${idx}`}
                            type="text"
                            inputMode="decimal"
                            className="sensor-multiplier-input"
                            placeholder="1"
                            value={slot.multiplier !== undefined && slot.multiplier !== null && String(slot.multiplier).trim() !== '' ? String(slot.multiplier) : ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setSelectedSensorsByObject((prev) => ({
                                ...prev,
                                [objectId]: (prev[objectId] ?? []).map((sl, i) => i === idx ? { ...sl, multiplier: raw } : sl),
                              }));
                            }}
                            aria-label="Value multiplier for report (e.g. 0.01, 1.5)"
                          />
                        </div>
                      )}
                      {slot.sensor?.description_parameters && slot.sensor.description_parameters.length > 0 && (
                        <div className="sensor-params">
                          {slot.sensor.description_parameters.map((p, i) => (
                            <span key={i} className="sensor-param">{p.name}: {String(p.value)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="object-sensor-row object-sensor-add-row">
                    <div className="obj-name" />
                    <button type="button" className="btn-sm" onClick={() => addSensorSlot(objectId, obj.device_id)}>
                      + Add sensor for this object
                    </button>
                  </div>
                </div>
              );
            })}
          </AccordionStep>

          <AccordionStep
            step={4}
            title="Timeframe"
            open={openStep === 4}
            onToggle={() => setOpenStep((s) => (s === 4 ? 0 : 4))}
          >
            <p className="step-desc">Choose the date and time range for the report data.</p>
            <div className="report-timeframe-fields">
              <div className="form-row">
                <label htmlFor="report-date-from">From</label>
                <input
                  id="report-date-from"
                  type="datetime-local"
                  value={reportDateFrom}
                  onChange={(e) => setReportDateFrom(e.target.value)}
                  aria-label="Report start date and time"
                />
              </div>
              <div className="form-row">
                <label htmlFor="report-date-to">To</label>
                <input
                  id="report-date-to"
                  type="datetime-local"
                  value={reportDateTo}
                  onChange={(e) => setReportDateTo(e.target.value)}
                  aria-label="Report end date and time"
                />
              </div>
            </div>
          </AccordionStep>

          <div className="report-generate-wrap">
            <button
              type="button"
              className="btn-sm primary report-generate-btn"
              disabled={reportLoading || !selectedObjectIds.length || !Object.keys(selectedSensorsByObject).some((k) => (selectedSensorsByObject[Number(k)] ?? []).some((sl) => sl.sensor != null))}
              onClick={() => generateReport()}
            >
              {reportLoading ? 'Generating…' : 'Generate report'}
            </button>
            {reportLoading && (
              <button
                type="button"
                className="btn-sm"
                onClick={cancelReport}
              >
                Stop
              </button>
            )}
          </div>
        </aside>

        <div className="reports-panel">
          <section className="reports-section">
            <div className="reports-section-header">
              <h2 className="reports-section-title">Sensor reading report</h2>
              <div className="reports-section-actions">
                <input
                  ref={reportImportInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="reports-import-input"
                  aria-label="Import report JSON"
                  onChange={handleReportImportFile}
                />
                <button type="button" className="btn-sm" onClick={() => reportImportInputRef.current?.click()}>
                  Import
                </button>
                <button
                  type="button"
                  className="btn-sm primary"
                  onClick={() => exportReportJson()}
                  disabled={!selectedObjectIds.length || !Object.keys(selectedSensorsByObject).some((k) => (selectedSensorsByObject[Number(k)] ?? []).some((sl) => sl.sensor != null))}
                >
                  Export
                </button>
              </div>
            </div>
            <p className="reports-section-desc">
              Choose objects and sensors in Steps 2–3, set the timeframe in Step 4, then click Generate report. All selected sensors are shown as lines in the graph (Y scaled to fit); the table lists values by time.
            </p>
            {reportGenerated && reportData ? (
              <>
                {reportData.chartSeries.length > 0 && reportData.chartSeries.every((s) => s.data.length === 0) && (
                  <div className="reports-no-data-banner">
                    <p>No readings in the selected timeframe. The database may have no data for these objects and sensors in this range.</p>
                    <button type="button" className="btn-sm primary" onClick={() => generateReport(true)} disabled={reportLoading}>
                      Try last 24 hours
                    </button>
                  </div>
                )}
                <div className="reports-placeholder-block reports-chart-block">
                  <div className="report-chart-block-header">
                    <h3>Graph</h3>
                    <button type="button" className="btn-sm primary" onClick={exportFullReportHtml} aria-label="Export full report to HTML">
                      Export HTML
                    </button>
                  </div>
                  <div ref={reportChartContainerRef} className="report-chart-resize-wrap">
                    <ReportChart
                      series={reportData.chartSeries}
                      width={reportChartSize.w}
                      height={reportChartSize.h}
                    />
                  </div>
                </div>
                <div className="reports-placeholder-block reports-table-block">
                  <h3>Raw data</h3>
                  <ReportTable
                    columns={reportData.columns}
                    rows={reportData.tableRows}
                    showExportHtml={false}
                  />
                </div>
                <div className="reports-placeholder-block reports-table-block">
                  <h3>Summary</h3>
                  <ReportTable
                    columns={reportData.summaryColumns}
                    rows={reportData.summaryRows}
                    showExportHtml={false}
                  />
                </div>
              </>
            ) : (
              <div className="reports-placeholder">
                <div className="reports-placeholder-block">
                  <h3>Graph</h3>
                  <p>All chosen sensor series as lines; X-axis = time, Y scaled to graph height (no raw values on Y).</p>
                </div>
                <div className="reports-placeholder-block">
                  <h3>Raw data &amp; Summary</h3>
                  <p>Raw data by timestamp; Summary aggregated by date with Min, Max, Avg per sensor.</p>
                </div>
                {(selectedObjectIds.length > 0 && Object.keys(selectedSensorsByObject).some((k) => (selectedSensorsByObject[Number(k)] ?? []).some((sl) => sl.sensor != null))) ? (
                  <p className="reports-selection-hint">
                    Set Step 4 timeframe and click &quot;Generate report&quot; to load data.
                  </p>
                ) : (
                  <p className="reports-selection-hint">Select objects in Step 2 and sensors in Step 3, set Step 4, then Generate report.</p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
      )}

      {activeTab === 'map' && <MapTab />}

      {historyPlane && (
        <div className="modal-overlay" onClick={() => setHistoryPlane(null)}>
          <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3>Sensor history — {historyPlane.object_label} · {historyPlane.sensor_label_custom}</h3>
              <button type="button" className="modal-close" onClick={() => setHistoryPlane(null)} aria-label="Close">×</button>
            </div>
            <div className="form-row">
              <label htmlFor="history-duration">Duration</label>
              <select
                id="history-duration"
                value={historyDurationHours}
                onChange={(e) => setHistoryDurationHours(Number(e.target.value) as api.SensorHistoryHours)}
                aria-label="Time range"
              >
                <option value={1}>Last 1 hour</option>
                <option value={4}>Last 4 hours</option>
                <option value={12}>Last 12 hours</option>
                <option value={24}>Last 24 hours</option>
              </select>
            </div>
            <div className="history-chart-wrap">
              {historyLoading ? (
                <p className="hint">Loading…</p>
              ) : (
                <HistoryChart
                  data={historyData}
                  width={520}
                  height={220}
                  showThresholds
                  min={historyPlane.min_threshold}
                  max={historyPlane.max_threshold}
                />
              )}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setHistoryPlane(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {configModal && (
        <ConfigModal
          initial={configModal}
          isEdit={editingConfigId != null}
          onSave={handleConfigSave}
          onCancel={() => { setConfigModal(null); setEditingConfigId(null); }}
        />
      )}
    </div>
  );
}
