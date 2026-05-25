import React, { useCallback, useMemo, useState } from 'react';

type Point = { ts: string; value: number | null };

const Y_AXIS_WIDTH = 96;
const X_PADDING = 8;
const Y_PADDING_TOP = 12;
const Y_PADDING_BOTTOM = 28;
const LABEL_FONT = '12px system-ui, sans-serif';
const GRID_COLOR = 'rgba(148, 163, 184, 0.25)';
const GRID_LINES_Y = 5;
const GRID_LINES_X = 6;
const MAX_POINTS = 600;

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6 || (abs < 1e-3 && abs > 0)) return v.toExponential(1);
  const s = v.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 0 });
  return s.length > 10 ? (abs >= 1000 ? v.toExponential(1) : v.toFixed(2)) : s;
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function downsample(values: number[], times: string[]): { values: number[]; times: string[] } {
  if (values.length <= MAX_POINTS) return { values, times };
  const step = values.length / MAX_POINTS;
  const outV: number[] = [];
  const outT: string[] = [];
  for (let i = 0; i < MAX_POINTS; i++) {
    const idx = Math.min(Math.floor(i * step), values.length - 1);
    outV.push(values[idx]);
    outT.push(times[idx]);
  }
  return { values: outV, times: outT };
}

function valueInRange(v: number, min?: number | null, max?: number | null): boolean {
  if (min != null && v < min) return false;
  if (max != null && v > max) return false;
  return true;
}

export const HistoryChart = React.memo(function HistoryChart({
  data,
  width = 560,
  height = 260,
  stroke = '#0ea5e9',
  showThresholds,
  min: minThreshold,
  max: maxThreshold,
  seriesLabel = 'Value',
}: {
  data: Point[];
  width?: number;
  height?: number;
  stroke?: string;
  showThresholds?: boolean;
  min?: number | null;
  max?: number | null;
  seriesLabel?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series = useMemo(
    () => data.filter((d) => d.value != null) as { ts: string; value: number }[],
    [data]
  );

  const chart = useMemo(() => {
    if (series.length === 0) return null;

    const values = series.map((d) => d.value);
    const times = series.map((d) => d.ts);
    const { values: plotV, times: plotT } = downsample(values, times);

    const hasTh = showThresholds && (minThreshold != null || maxThreshold != null);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const minVal = Math.min(dataMin, minThreshold ?? dataMin, maxThreshold ?? dataMin);
    const maxVal = Math.max(dataMax, minThreshold ?? dataMax, maxThreshold ?? dataMax);
    const range = maxVal - minVal || 1;

    const w = width - Y_AXIS_WIDTH - X_PADDING;
    const h = height - Y_PADDING_TOP - Y_PADDING_BOTTOM;
    const chartLeft = Y_AXIS_WIDTH;
    const chartRight = width - X_PADDING;
    const yMin = Y_PADDING_TOP;
    const yMax = Y_PADDING_TOP + h;
    const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y));

    const yAt = (v: number) => clampY(Y_PADDING_TOP + h - ((v - minVal) / range) * h);
    const xAt = (i: number) => chartLeft + (i / Math.max(plotV.length - 1, 1)) * w;

    const points = plotV.map((v, i) => ({
      ts: plotT[i],
      value: v,
      x: xAt(i),
      y: yAt(v),
      index: i,
    }));

    const polyPoints = points.map((p) => `${p.x},${p.y}`).join(' ');

    const gridPathParts: string[] = [];
    for (let i = 1; i < GRID_LINES_X; i++) {
      const x = chartLeft + (w * i) / GRID_LINES_X;
      gridPathParts.push(`M${x} ${Y_PADDING_TOP}V${Y_PADDING_TOP + h}`);
    }
    for (let i = 1; i < GRID_LINES_Y; i++) {
      const y = Y_PADDING_TOP + (h * i) / GRID_LINES_Y;
      gridPathParts.push(`M${chartLeft} ${y}H${chartRight}`);
    }

    const yTicks = Array.from({ length: GRID_LINES_Y }, (_, i) => {
      const t = i / (GRID_LINES_Y - 1);
      const val = maxVal - range * t;
      const y = Y_PADDING_TOP + h * t;
      return { val, y };
    });

    const labelIndices =
      plotV.length <= 2
        ? [0, plotV.length - 1].filter((i) => i >= 0)
        : [0, Math.floor(plotV.length / 2), plotV.length - 1];
    const labelPositions = labelIndices.map((i) => xAt(i));

    const thMinY = minThreshold != null ? yAt(minThreshold) : null;
    const thMaxY = maxThreshold != null ? yAt(maxThreshold) : null;
    const bandTop =
      minThreshold != null && maxThreshold != null ? Math.min(thMinY!, thMaxY!) : null;
    const bandBot =
      minThreshold != null && maxThreshold != null ? Math.max(thMinY!, thMaxY!) : null;

    const last = points[points.length - 1];
    const lineColorFor = (v: number) =>
      hasTh ? (valueInRange(v, minThreshold, maxThreshold) ? '#22c55e' : '#ef4444') : stroke;

    return {
      hasTh,
      dataMin,
      dataMax,
      minVal,
      maxVal,
      gridPath: gridPathParts.join(' '),
      yTicks,
      labelIndices,
      labelPositions,
      plotT,
      points,
      polyPoints,
      last,
      lineColorFor,
      thMinY,
      thMaxY,
      bandTop,
      bandBot,
      chartLeft,
      chartRight,
      yMin,
      yMax,
    };
  }, [series, width, height, minThreshold, maxThreshold, showThresholds, stroke]);

  const pickIndexFromEvent = useCallback(
    (clientX: number, clientY: number, svg: SVGSVGElement) => {
      if (!chart) return null;
      const rect = svg.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const { chartLeft, chartRight, yMin, yMax, points } = chart;
      if (x < chartLeft || x > chartRight || y < yMin || y > yMax) return null;
      const rel = (x - chartLeft) / (chartRight - chartLeft);
      const idx = Math.round(rel * Math.max(points.length - 1, 1));
      return Math.max(0, Math.min(points.length - 1, idx));
    },
    [chart]
  );

  const clearHover = useCallback(() => setHoverIndex(null), []);

  if (series.length === 0) {
    return (
      <div className="history-chart history-chart-empty" style={{ width, height }}>
        No data for this period
      </div>
    );
  }

  if (!chart) return null;

  const {
    hasTh,
    dataMin,
    dataMax,
    gridPath,
    yTicks,
    labelIndices,
    labelPositions,
    plotT,
    points,
    polyPoints,
    last,
    lineColorFor,
    thMinY,
    thMaxY,
    bandTop,
    bandBot,
    chartLeft,
    chartRight,
    yMin,
    yMax,
  } = chart;

  const active = hoverIndex != null ? points[hoverIndex] : null;
  const display = active ?? last;
  const lineColor = lineColorFor(display.value);

  const tooltipAnchor =
    active != null
      ? active.x <= chartLeft + (chartRight - chartLeft) * 0.25
        ? 'start'
        : active.x >= chartLeft + (chartRight - chartLeft) * 0.75
          ? 'end'
          : 'middle'
      : 'middle';

  const tooltipX =
    active != null
      ? tooltipAnchor === 'start'
        ? active.x + 6
        : tooltipAnchor === 'end'
          ? active.x - 6
          : active.x
      : last.x;

  const tooltipW = 118;
  const tooltipH = 34;
  const tooltipTop = active
    ? Math.max(yMin, Math.min(active.y - tooltipH - 8, yMax - tooltipH - 4))
    : 0;
  const tooltipLeft =
    tooltipAnchor === 'start'
      ? tooltipX
      : tooltipAnchor === 'end'
        ? tooltipX - tooltipW
        : tooltipX - tooltipW / 2;

  const ariaLabel = `${seriesLabel}, ${series.length} points, min ${formatCompact(dataMin)}, max ${formatCompact(dataMax)}`;

  return (
    <div className="history-chart-block">
      <div className="history-chart-main">
        <svg
          width={width}
          height={height}
          className="history-chart history-chart-interactive"
          role="img"
          aria-label={ariaLabel}
          onMouseMove={(e) => setHoverIndex(pickIndexFromEvent(e.clientX, e.clientY, e.currentTarget))}
          onMouseLeave={clearHover}
        >
          <path d={gridPath} fill="none" stroke={GRID_COLOR} strokeWidth={1} />
          {bandTop != null && bandBot != null && bandBot > bandTop && (
            <rect
              x={chartLeft}
              y={bandTop}
              width={chartRight - chartLeft}
              height={bandBot - bandTop}
              fill="rgba(34, 197, 94, 0.1)"
              pointerEvents="none"
            />
          )}
          {hasTh && minThreshold != null && (
            <line
              x1={chartLeft}
              x2={chartRight}
              y1={thMinY!}
              y2={thMinY!}
              stroke="#94a3b8"
              strokeDasharray="5 3"
              strokeWidth={1.25}
              pointerEvents="none"
            />
          )}
          {hasTh && maxThreshold != null && minThreshold !== maxThreshold && (
            <line
              x1={chartLeft}
              x2={chartRight}
              y1={thMaxY!}
              y2={thMaxY!}
              stroke="#94a3b8"
              strokeDasharray="5 3"
              strokeWidth={1.25}
              pointerEvents="none"
            />
          )}
          <polyline
            points={polyPoints}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={active != null ? 0.5 : 1}
            pointerEvents="none"
          />
          {active != null && (
            <>
              <line
                x1={active.x}
                x2={active.x}
                y1={yMin}
                y2={yMax}
                stroke="var(--accent)"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.75}
                pointerEvents="none"
              />
              <line
                x1={chartLeft}
                x2={chartRight}
                y1={active.y}
                y2={active.y}
                stroke="var(--accent)"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.75}
                pointerEvents="none"
              />
              <circle
                cx={active.x}
                cy={active.y}
                r={4}
                fill={lineColorFor(active.value)}
                stroke="var(--surface)"
                strokeWidth={1.5}
                pointerEvents="none"
              />
              <rect
                x={tooltipLeft}
                y={tooltipTop}
                width={tooltipW}
                height={tooltipH}
                rx={4}
                fill="var(--surface)"
                stroke="var(--border)"
                strokeWidth={1}
                pointerEvents="none"
              />
              <text
                x={tooltipX}
                y={tooltipTop + 13}
                textAnchor={tooltipAnchor}
                className="history-chart-tooltip-value"
                pointerEvents="none"
              >
                {formatValue(active.value)}
              </text>
              <text
                x={tooltipX}
                y={tooltipTop + 26}
                textAnchor={tooltipAnchor}
                className="history-chart-tooltip-time"
                pointerEvents="none"
              >
                {formatDateTime(active.ts)}
              </text>
            </>
          )}
          {active == null && (
            <circle cx={last.x} cy={last.y} r={3} fill={lineColor} pointerEvents="none" />
          )}
          {yTicks.map((tick, i) => (
            <text
              key={i}
              x={Y_AXIS_WIDTH - 6}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--muted, #94a3b8)"
              style={{ font: LABEL_FONT }}
              pointerEvents="none"
            >
              {formatValue(tick.val)}
            </text>
          ))}
          {labelIndices.map((idx, i) => (
            <text
              key={idx}
              x={labelPositions[i]}
              y={height - 8}
              textAnchor="middle"
              fill="var(--muted, #94a3b8)"
              style={{ font: LABEL_FONT }}
              pointerEvents="none"
            >
              {formatTime(plotT[idx])}
            </text>
          ))}
        </svg>
      </div>

      <div className="history-chart-stats" aria-hidden>
        <span className="history-chart-stat" title="Minimum in period">
          <span className="history-chart-stat-label">min</span>
          {formatCompact(dataMin)}
        </span>
        <span className="history-chart-stat" title="Maximum in period">
          <span className="history-chart-stat-label">max</span>
          {formatCompact(dataMax)}
        </span>
        <span
          className="history-chart-stat history-chart-stat-active"
          title={active != null ? 'Hovered value' : 'Latest value'}
          style={{ color: lineColor }}
        >
          <span className="history-chart-stat-label">{active != null ? 'at cursor' : 'latest'}</span>
          {formatCompact(display.value)}
        </span>
        {active != null && (
          <span className="history-chart-stat history-chart-stat-time" title="Time at cursor">
            <span className="history-chart-stat-label">time</span>
            {formatDateTime(active.ts)}
          </span>
        )}
      </div>

      <div className="history-chart-legend" aria-label="Chart legend">
        <span className="history-chart-legend-item">
          <span className="history-chart-legend-line history-chart-legend-line-series" style={{ background: lineColor }} />
          <span className="history-chart-legend-label">{seriesLabel}</span>
        </span>
        {hasTh && minThreshold != null && (
          <span className="history-chart-legend-item" title="Minimum threshold">
            <span className="history-chart-legend-line history-chart-legend-line-threshold" />
            <span className="history-chart-legend-label">
              MIN <strong>{formatValue(minThreshold)}</strong>
            </span>
          </span>
        )}
        {hasTh && maxThreshold != null && (
          <span className="history-chart-legend-item" title="Maximum threshold">
            <span className="history-chart-legend-line history-chart-legend-line-threshold" />
            <span className="history-chart-legend-label">
              MAX <strong>{formatValue(maxThreshold)}</strong>
            </span>
          </span>
        )}
        {hasTh && minThreshold != null && maxThreshold != null && (
          <span className="history-chart-legend-item history-chart-legend-ok" title="Values inside MIN–MAX are green">
            <span className="history-chart-legend-swatch history-chart-legend-swatch-ok" />
            <span className="history-chart-legend-label">In range (green)</span>
          </span>
        )}
      </div>
    </div>
  );
});
