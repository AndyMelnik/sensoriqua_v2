import React, { useMemo, useState, useRef, useCallback } from 'react';

export type ReportSeries = {
  label: string;
  color: string;
  data: { ts: string; value: number | null }[];
};

const X_PADDING = 8;
const Y_PADDING_TOP = 20;
const Y_PADDING_BOTTOM = 32;
const LEGEND_HEIGHT = 36;
const LABEL_FONT = '11px system-ui, sans-serif';
const GRID_COLOR = 'rgba(148, 163, 184, 0.2)';
const MAX_POINTS = 800;

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(ts: string): string {
  return new Date(ts).toLocaleString();
}

const SERIES_COLORS = [
  '#0ea5e9', '#22c55e', '#eab308', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

export const ReportChart = React.memo(function ReportChart({
  series,
  width = 700,
  height = 320,
}: {
  series: ReportSeries[];
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<{ ts: string; x: number; y: number } | null>(null);
  const [windowStart, setWindowStart] = useState(0);
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragEndX, setDragEndX] = useState<number | null>(null);
  const [hiddenLabels, setHiddenLabels] = useState<Record<string, boolean>>({});
  const svgRef = useRef<SVGSVGElement>(null);

  React.useEffect(() => {
    // Reset zoom when series change; keep per-label visibility where possible.
    setWindowStart(0);
    setWindowEnd(null);
    setHiddenLabels((prev) => {
      const next: Record<string, boolean> = {};
      series.forEach((s) => {
        if (prev[s.label]) next[s.label] = true;
      });
      return next;
    });
  }, [series]);

  const svgHeight = height - LEGEND_HEIGHT;

  const chart = useMemo(() => {
    if (series.length === 0) return null;
    const visibleSeries = series.filter((s) => !hiddenLabels[s.label]);
    if (visibleSeries.length === 0) {
      // Still compute X-axis from all timestamps so hover and grid work, but no lines.
    }
    const allTsSet = new Set<string>();
    series.forEach((s) => s.data.forEach((d) => allTsSet.add(d.ts)));
    const sortedTs = Array.from(allTsSet).sort();
    const total = sortedTs.length;
    const startIndex = Math.max(0, Math.min(windowStart, total - 1));
    const endIndex = windowEnd != null ? Math.min(windowEnd, total - 1) : total - 1;
    const visibleCount = Math.max(1, endIndex - startIndex + 1);

    const w = width - X_PADDING * 2;
    const h = svgHeight - Y_PADDING_TOP - Y_PADDING_BOTTOM;
    const chartLeft = X_PADDING;
    const chartRight = width - X_PADDING;

    const seriesValueMaps: Map<string, number | null>[] = [];
    const lines: { label: string; color: string; segments: string[] }[] = [];

    visibleSeries.forEach((s, idx) => {
      const byTs = new Map(s.data.map((d) => [d.ts, d.value]));
      seriesValueMaps.push(byTs);
      const valuesAtTs = sortedTs.map((t) => byTs.get(t) ?? null);
      const numericValues = valuesAtTs.filter((v): v is number => v != null);
      if (numericValues.length === 0) return;
      const minVal = Math.min(...numericValues);
      const maxVal = Math.max(...numericValues);
      const range = maxVal - minVal || 1;
      const step = visibleCount <= MAX_POINTS ? 1 : Math.ceil(visibleCount / MAX_POINTS);
      const segments: string[] = [];
      let current: string[] = [];
      for (let i = startIndex; i <= endIndex; i += step) {
        const v = valuesAtTs[i];
        const pos = (i - startIndex) / Math.max(visibleCount - 1, 1);
        const x = chartLeft + pos * w;
        if (v == null) {
          if (current.length > 1) {
            segments.push(current.join(' '));
          }
          current = [];
          continue;
        }
        const y = Y_PADDING_TOP + h - ((v - minVal) / range) * h;
        current.push(`${x},${y}`);
      }
      if (current.length > 1) {
        segments.push(current.join(' '));
      }
      if (segments.length === 0) return;
      lines.push({
        label: s.label,
        color: s.color || SERIES_COLORS[idx % SERIES_COLORS.length],
        segments,
      });
    });

    const gridPathParts: string[] = [];
    for (let i = 1; i < 5; i++) {
      const x = chartLeft + (w * i) / 5;
      gridPathParts.push(`M${x} ${Y_PADDING_TOP}V${Y_PADDING_TOP + h}`);
    }
    for (let i = 1; i < 4; i++) {
      const y = Y_PADDING_TOP + (h * i) / 4;
      gridPathParts.push(`M${chartLeft} ${y}H${chartRight}`);
    }

    const maxXLabels = 12;
    const labelIndices =
      visibleCount <= maxXLabels
        ? Array.from({ length: visibleCount }, (_, i) => startIndex + i)
        : Array.from({ length: maxXLabels }, (_, k) =>
            visibleCount <= 1 ? startIndex : startIndex + Math.round((k / (maxXLabels - 1)) * (visibleCount - 1))
          );
    const labelPositions = labelIndices.map((i) => {
      const pos = (i - startIndex) / Math.max(visibleCount - 1, 1);
      return chartLeft + pos * w;
    });
    const labelTimes = labelIndices.map((i) => sortedTs[Math.min(i, total - 1)]);

    return {
      lines,
      gridPath: gridPathParts.join(' '),
      labelPositions,
      labelTimes,
      w,
      h,
      chartLeft,
      sortedTs,
      startIndex,
      endIndex,
      visibleCount,
      seriesValueMaps,
    };
  }, [series, width, svgHeight, windowStart, windowEnd, hiddenLabels]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!chart || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const { chartLeft, w, sortedTs, startIndex, visibleCount } = chart;
      if (dragStartX !== null) {
        // Update selection range while dragging
        const clampedX = Math.max(chartLeft, Math.min(x, chartLeft + w));
        setDragEndX(clampedX);
      } else {
        if (x < chartLeft || x > chartLeft + w || visibleCount === 0) {
          setHover(null);
          return;
        }
        const indexInWindow = Math.round(((x - chartLeft) / w) * (visibleCount - 1));
        const clampedIndexInWindow = Math.max(0, Math.min(indexInWindow, visibleCount - 1));
        const clampedIndex = startIndex + clampedIndexInWindow;
        const ts = sortedTs[clampedIndex];
        setHover({ ts, x, y: e.clientY - rect.top });
      }
    },
    [chart, dragStartX]
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    setDragStartX(null);
    setDragEndX(null);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!chart || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const { chartLeft, w } = chart;
      if (x < chartLeft || x > chartLeft + w) return;
      setDragStartX(x);
      setDragEndX(x);
    },
    [chart]
  );

  const handleMouseUp = useCallback(
    () => {
      if (!chart || dragStartX === null || dragEndX === null) {
        setDragStartX(null);
        setDragEndX(null);
        return;
      }
      const { chartLeft, w, sortedTs, startIndex, visibleCount } = chart;
      const minX = Math.max(chartLeft, Math.min(dragStartX, dragEndX));
      const maxX = Math.min(chartLeft + w, Math.max(dragStartX, dragEndX));
      const span = maxX - minX;
      setDragStartX(null);
      setDragEndX(null);
      if (span < 8 || visibleCount <= 1) {
        return;
      }
      const total = sortedTs.length;
      const startFrac = (minX - chartLeft) / w;
      const endFrac = (maxX - chartLeft) / w;
      const newStartOffset = Math.round(startFrac * (visibleCount - 1));
      const newEndOffset = Math.round(endFrac * (visibleCount - 1));
      let newStart = startIndex + Math.min(newStartOffset, newEndOffset);
      let newEnd = startIndex + Math.max(newStartOffset, newEndOffset);
      newStart = Math.max(0, Math.min(newStart, total - 1));
      newEnd = Math.max(newStart, Math.min(newEnd, total - 1));
      if (newEnd === newStart) {
        return;
      }
      setWindowStart(newStart);
      setWindowEnd(newEnd);
    },
    [chart, dragStartX, dragEndX]
  );

  if (series.length === 0 || series.every((s) => s.data.length === 0)) {
    return (
      <div className="report-chart report-chart-empty" style={{ width, height }}>
        {series.length > 0
          ? 'No readings in the selected timeframe. Try a different date range or use "Try last 24 hours" below.'
          : 'No data — choose sensors and generate report'}
      </div>
    );
  }

  if (!chart) return null;

  const { lines, gridPath, labelPositions, labelTimes, seriesValueMaps } = chart;

  const resetZoom = () => {
    setWindowStart(0);
    setWindowEnd(null);
  };

  const canResetZoom = windowStart !== 0 || windowEnd !== null;

  const tooltipValues = hover
    ? lines.map((line, i) => ({
        label: line.label,
        color: line.color,
        value: seriesValueMaps[i]?.get(hover.ts) ?? null,
      }))
    : [];

  const toggleSeriesVisibility = (label: string) => {
    setHiddenLabels((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };

  return (
    <div
      className="report-chart report-chart-interactive"
      style={{ width, height }}
    >
      <div className="report-chart-body">
        {canResetZoom && (
          <button
            type="button"
            className="btn-xs report-chart-reset-btn"
            onClick={resetZoom}
            aria-label="Reset zoom"
          >
            Reset
          </button>
        )}
        <svg
          ref={svgRef}
          width={width}
          height={svgHeight}
          className="report-chart-svg"
          aria-hidden
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseUp={handleMouseUp}
        >
          <path d={gridPath} fill="none" stroke={GRID_COLOR} strokeWidth={1} />
          {dragStartX !== null && dragEndX !== null && (
            <rect
              x={Math.min(dragStartX, dragEndX)}
              y={Y_PADDING_TOP}
              width={Math.abs(dragEndX - dragStartX)}
              height={svgHeight - Y_PADDING_TOP - Y_PADDING_BOTTOM}
              fill="rgba(59, 130, 246, 0.15)"
              stroke="rgba(59, 130, 246, 0.8)"
              strokeWidth={1}
            />
          )}
          {hover && (
            <line
              x1={hover.x}
              y1={Y_PADDING_TOP}
              x2={hover.x}
              y2={svgHeight - Y_PADDING_BOTTOM}
              stroke="var(--muted, #94a3b8)"
              strokeWidth={1}
              strokeDasharray="4"
              opacity={0.8}
            />
          )}
        {lines.map((line, i) =>
          line.segments.map((seg, j) => (
            <polyline
              key={`${i}-${j}`}
              points={seg}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))
        )}
        {labelTimes.map((ts, i) => (
          <text
            key={i}
            x={labelPositions[i]}
            y={svgHeight - 10}
            textAnchor="middle"
            fill="var(--muted, #94a3b8)"
            style={{ font: LABEL_FONT }}
          >
            {formatTime(ts)}
          </text>
        ))}
      </svg>
      {hover && (
        <div
          className="report-chart-tooltip"
          style={{
            left: Math.min(hover.x + 12, width - 180),
            top: Math.min(hover.y + 8, svgHeight - 120),
          }}
        >
          <div className="report-chart-tooltip-time">{formatTimeFull(hover.ts)}</div>
          {tooltipValues.map((tv, i) => (
            <div key={i} className="report-chart-tooltip-row">
              <span className="report-chart-tooltip-dot" style={{ background: tv.color }} />
              <span className="report-chart-tooltip-label">{tv.label}</span>
              <span className="report-chart-tooltip-value">
                {tv.value != null ? tv.value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
      <div className="report-chart-legend-wrap">
      <div className="report-chart-legend">
        {series.map((s, i) => {
          const isHidden = !!hiddenLabels[s.label];
          const color = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
          return (
            <button
              key={s.label || i}
              type="button"
              className={`report-chart-legend-item${isHidden ? ' disabled' : ''}`}
              onClick={() => toggleSeriesVisibility(s.label)}
              aria-pressed={!isHidden}
            >
              <span
                className="report-chart-legend-dot"
                style={{ background: color, opacity: isHidden ? 0.4 : 1 }}
              />
              <span className="report-chart-legend-label">{s.label}</span>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
});
