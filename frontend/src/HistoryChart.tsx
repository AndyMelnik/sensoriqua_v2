import React, { useMemo } from 'react';

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

function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6 || (abs < 1e-3 && abs > 0)) return v.toExponential(1);
  const s = v.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 0 });
  return s.length > 10 ? (abs >= 1000 ? v.toExponential(1) : v.toFixed(2)) : s;
}

/** Downsample to at most MAX_POINTS for smoother drawing */
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

export const HistoryChart = React.memo(function HistoryChart({
  data,
  width = 560,
  height = 240,
  stroke = '#0ea5e9',
  showThresholds,
  min: minThreshold,
  max: maxThreshold,
}: {
  data: Point[];
  width?: number;
  height?: number;
  stroke?: string;
  showThresholds?: boolean;
  min?: number | null;
  max?: number | null;
}) {
  const values = useMemo(() => data.map((d) => d.value).filter((v): v is number => v != null), [data]);
  const times = useMemo(() => data.map((d) => d.ts), [data]);

  const chart = useMemo(() => {
    if (values.length === 0) return null;
    const { values: plotV, times: plotT } = downsample(values, times);
    const minVal = Math.min(...values, minThreshold ?? Infinity);
    const maxVal = Math.max(...values, maxThreshold ?? -Infinity);
    const range = maxVal - minVal || 1;
    const w = width - Y_AXIS_WIDTH - X_PADDING;
    const h = height - Y_PADDING_TOP - Y_PADDING_BOTTOM;
    const chartLeft = Y_AXIS_WIDTH;

    const yMin = Y_PADDING_TOP;
    const yMax = Y_PADDING_TOP + h;
    const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y));

    const points = plotV
      .map((v, i) => {
        const x = chartLeft + (i / Math.max(plotV.length - 1, 1)) * w;
        const y = clampY(Y_PADDING_TOP + h - ((v - minVal) / range) * h);
        return `${x},${y}`;
      })
      .join(' ');

    const yAt = (v: number) => clampY(Y_PADDING_TOP + h - ((v - minVal) / range) * h);

    const gridPathParts: string[] = [];
    for (let i = 1; i < GRID_LINES_X; i++) {
      const x = chartLeft + (w * i) / GRID_LINES_X;
      gridPathParts.push(`M${x} ${Y_PADDING_TOP}V${Y_PADDING_TOP + h}`);
    }
    for (let i = 1; i < GRID_LINES_Y; i++) {
      const y = Y_PADDING_TOP + (h * i) / GRID_LINES_Y;
      gridPathParts.push(`M${chartLeft} ${y}H${width - X_PADDING}`);
    }
    const gridPath = gridPathParts.join(' ');

    const yTicks = Array.from({ length: GRID_LINES_Y }, (_, i) => {
      const t = i / (GRID_LINES_Y - 1);
      const val = maxVal - range * t;
      const y = Y_PADDING_TOP + h * t;
      return { val, y };
    });

    const labelIndices = plotV.length <= 2 ? [0, plotV.length - 1].filter((i) => i >= 0) : [0, Math.floor(plotV.length / 2), plotV.length - 1];
    const labelPositions = labelIndices.map((i) => chartLeft + (i / Math.max(plotV.length - 1, 1)) * w);

    const lastVal = values[values.length - 1];
    const inRange = (v: number) => {
      if (minThreshold != null && v < minThreshold) return false;
      if (maxThreshold != null && v > maxThreshold) return false;
      return true;
    };
    const lineColor =
      showThresholds && (minThreshold != null || maxThreshold != null)
        ? lastVal != null && inRange(lastVal)
          ? '#22c55e'
          : '#ef4444'
        : stroke;

    return {
      minVal,
      maxVal,
      points,
      gridPath,
      yTicks,
      labelIndices,
      labelPositions,
      plotT,
      yAt,
      lineColor,
      w,
      h,
      chartLeft,
    };
  }, [data, values, times, width, height, minThreshold, maxThreshold, showThresholds]);

  if (values.length === 0) {
    return (
      <div className="history-chart history-chart-empty" style={{ width, height }}>
        No data for this period
      </div>
    );
  }

  if (!chart) return null;

  const { points, gridPath, yTicks, labelIndices, labelPositions, plotT, yAt, lineColor, chartLeft } = chart;
  const chartRight = width - X_PADDING;

  return (
    <svg width={width} height={height} className="history-chart" aria-hidden>
      <path d={gridPath} fill="none" stroke={GRID_COLOR} strokeWidth={1} />
      {showThresholds && (minThreshold != null || maxThreshold != null) && (
        <>
          {minThreshold != null && (
            <line
              x1={chartLeft}
              x2={chartRight}
              y1={yAt(minThreshold)}
              y2={yAt(minThreshold)}
              stroke="#94a3b8"
              strokeDasharray="4"
              strokeWidth={1}
            />
          )}
          {maxThreshold != null && minThreshold !== maxThreshold && (
            <line
              x1={chartLeft}
              x2={chartRight}
              y1={yAt(maxThreshold)}
              y2={yAt(maxThreshold)}
              stroke="#94a3b8"
              strokeDasharray="4"
              strokeWidth={1}
            />
          )}
        </>
      )}
      <polyline points={points} fill="none" stroke={lineColor} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {yTicks.map((tick, i) => (
        <text
          key={i}
          x={Y_AXIS_WIDTH - 6}
          y={tick.y}
          textAnchor="end"
          dominantBaseline="middle"
          fill="var(--muted, #94a3b8)"
          style={{ font: LABEL_FONT }}
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
        >
          {formatTime(plotT[idx])}
        </text>
      ))}
    </svg>
  );
});
