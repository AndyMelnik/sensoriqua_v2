import { useCallback, useMemo, useState } from 'react';

type Point = { ts: string; value: number | null };

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTimeShort(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

export function Sparkline({
  data,
  width = 120,
  chartHeight = 30,
  stroke = '#0ea5e9',
  showThresholds,
  min,
  max,
  showTimeAxis = true,
  showStats = true,
  showLastStat = true,
  interactive = true,
}: {
  data: Point[];
  width?: number;
  chartHeight?: number;
  stroke?: string;
  showThresholds?: boolean;
  min?: number | null;
  max?: number | null;
  showTimeAxis?: boolean;
  /** Min / max / last row under the chart */
  showStats?: boolean;
  /** Include latest (or hovered) value in the stats row */
  showLastStat?: boolean;
  /** Hover crosshair and value label on the chart */
  interactive?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series = useMemo(
    () => data.filter((d) => d.value != null) as { ts: string; value: number }[],
    [data]
  );

  const geometry = useMemo(() => {
    if (series.length === 0) return null;

    const values = series.map((d) => d.value);
    const hasTh = showThresholds && (min != null || max != null);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const plotMin = Math.min(dataMin, min ?? dataMin, max ?? dataMin);
    const plotMax = Math.max(dataMax, min ?? dataMax, max ?? dataMax);
    const range = plotMax - plotMin || 1;

    const padX = 2;
    const padY = 2;
    const plotW = width - padX * 2;
    const plotH = chartHeight - padY * 2;

    const yAt = (v: number) => padY + plotH - ((v - plotMin) / range) * plotH;
    const xAt = (i: number) => padX + (i / Math.max(series.length - 1, 1)) * plotW;

    const points = series.map((d, i) => ({ ...d, x: xAt(i), y: yAt(d.value), index: i }));

    const last = points[points.length - 1];
    const inRange = (v: number) => {
      if (min != null && v < min) return false;
      if (max != null && v > max) return false;
      return true;
    };

    const lineColor =
      hasTh && (min != null || max != null)
        ? inRange(last.value)
          ? '#22c55e'
          : '#ef4444'
        : stroke;

    const polyPoints = points.map((p) => `${p.x},${p.y}`).join(' ');

    const thMinY = min != null ? yAt(min) : null;
    const thMaxY = max != null ? yAt(max) : null;
    const bandTop = min != null && max != null ? Math.min(thMinY!, thMaxY!) : null;
    const bandBot = min != null && max != null ? Math.max(thMinY!, thMaxY!) : null;

    const timeStart = data[0]?.ts ?? series[0].ts;
    const timeEnd = data[data.length - 1]?.ts ?? series[series.length - 1].ts;

    return {
      hasTh,
      dataMin,
      dataMax,
      padX,
      padY,
      plotW,
      plotH,
      points,
      last,
      lineColor,
      polyPoints,
      thMinY,
      thMaxY,
      bandTop,
      bandBot,
      timeStart,
      timeEnd,
      inRange,
    };
  }, [series, data, width, chartHeight, showThresholds, min, max, stroke]);

  const pickIndexFromEvent = useCallback(
    (clientX: number, svg: SVGSVGElement) => {
      if (!geometry || series.length < 1) return null;
      const rect = svg.getBoundingClientRect();
      const x = clientX - rect.left;
      const rel = (x - geometry.padX) / geometry.plotW;
      const idx = Math.round(rel * Math.max(series.length - 1, 1));
      return Math.max(0, Math.min(series.length - 1, idx));
    },
    [geometry, series.length]
  );

  const clearHover = useCallback(() => setHoverIndex(null), []);

  if (!geometry || series.length === 0) {
    return <div className="sparkline-empty">No data</div>;
  }

  const {
    hasTh,
    dataMin,
    dataMax,
    padX,
    padY,
    plotW,
    plotH,
    points,
    last,
    lineColor,
    polyPoints,
    thMinY,
    thMaxY,
    bandTop,
    bandBot,
    timeStart,
    timeEnd,
    inRange,
  } = geometry;

  const activeIndex = interactive && hoverIndex != null ? hoverIndex : null;
  const active = activeIndex != null ? points[activeIndex] : null;
  const display = active ?? last;

  const t0 = formatTimeShort(timeStart);
  const t1 = formatTimeShort(timeEnd);

  const tooltipAnchor =
    active != null
      ? active.x <= padX + plotW * 0.25
        ? 'start'
        : active.x >= padX + plotW * 0.75
          ? 'end'
          : 'middle'
      : 'middle';

  const tooltipX =
    active != null
      ? tooltipAnchor === 'start'
        ? active.x + 3
        : tooltipAnchor === 'end'
          ? active.x - 3
          : active.x
      : last.x;

  const tooltipW = 54;
  const tooltipH = 22;
  const tooltipTop = active
    ? Math.max(padY, Math.min(active.y - tooltipH - 4, chartHeight - tooltipH - 1))
    : 0;
  const tooltipLeft =
    tooltipAnchor === 'start'
      ? tooltipX
      : tooltipAnchor === 'end'
        ? tooltipX - tooltipW
        : tooltipX - tooltipW / 2;

  const ariaLabel = `Sparkline, ${series.length} points, minimum ${formatCompact(dataMin)}, maximum ${formatCompact(dataMax)}, latest ${formatCompact(last.value)}`;

  return (
    <div className="sparkline-block">
      <div className="sparkline-body">
        <div className="sparkline-chart-column" style={{ width }}>
          <svg
            width={width}
            height={chartHeight}
            className={`sparkline-chart${interactive ? ' sparkline-chart-interactive' : ''}`}
            role="img"
            aria-label={ariaLabel}
            onMouseMove={
              interactive
                ? (e) => setHoverIndex(pickIndexFromEvent(e.clientX, e.currentTarget))
                : undefined
            }
            onMouseLeave={interactive ? clearHover : undefined}
          >
            {bandTop != null && bandBot != null && bandBot > bandTop && (
              <rect
                x={padX}
                y={bandTop}
                width={plotW}
                height={bandBot - bandTop}
                fill="rgba(34, 197, 94, 0.08)"
              />
            )}
            {hasTh && min != null && (
              <line
                x1={padX}
                x2={width - padX}
                y1={thMinY!}
                y2={thMinY!}
                stroke="var(--muted)"
                strokeDasharray="3 2"
                strokeWidth={1}
                opacity={0.85}
              />
            )}
            {hasTh && max != null && min !== max && (
              <line
                x1={padX}
                x2={width - padX}
                y1={thMaxY!}
                y2={thMaxY!}
                stroke="var(--muted)"
                strokeDasharray="3 2"
                strokeWidth={1}
                opacity={0.85}
              />
            )}
            <polyline
              points={polyPoints}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={active != null ? 0.45 : 1}
            />
            {active != null && (
              <>
                <line
                  x1={active.x}
                  x2={active.x}
                  y1={padY}
                  y2={padY + plotH}
                  stroke="var(--muted)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={0.55}
                  pointerEvents="none"
                />
                <circle
                  cx={active.x}
                  cy={active.y}
                  r={3.5}
                  fill={hasTh ? (inRange(active.value) ? '#22c55e' : '#ef4444') : lineColor}
                  stroke="var(--surface)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
                <rect
                  x={tooltipLeft}
                  y={tooltipTop}
                  width={tooltipW}
                  height={tooltipH}
                  rx={3}
                  fill="var(--surface)"
                  stroke="var(--border)"
                  strokeWidth={1}
                  opacity={0.96}
                  pointerEvents="none"
                />
                <text
                  x={tooltipX}
                  y={tooltipTop + 9}
                  textAnchor={tooltipAnchor}
                  className="sparkline-svg-value"
                  pointerEvents="none"
                >
                  {formatCompact(active.value)}
                </text>
                <text
                  x={tooltipX}
                  y={tooltipTop + 17}
                  textAnchor={tooltipAnchor}
                  className="sparkline-svg-time"
                  pointerEvents="none"
                >
                  {formatTimeShort(active.ts)}
                </text>
              </>
            )}
            {active == null && (
              <circle cx={last.x} cy={last.y} r={2.5} fill={lineColor} pointerEvents="none" />
            )}
          </svg>
          {showStats && (
            <div className="sparkline-stats" aria-hidden>
              <span className="sparkline-stat" title="Minimum in period">
                <span className="sparkline-stat-label">min</span>
                {formatCompact(dataMin)}
              </span>
              <span className="sparkline-stat" title="Maximum in period">
                <span className="sparkline-stat-label">max</span>
                {formatCompact(dataMax)}
              </span>
              {showLastStat && (
                <span
                  className="sparkline-stat sparkline-stat-last"
                  title={active != null ? 'Hovered value' : 'Latest value'}
                  style={{
                    color:
                      active != null
                        ? hasTh
                          ? inRange(active.value)
                            ? '#22c55e'
                            : '#ef4444'
                          : lineColor
                        : lineColor,
                  }}
                >
                  <span className="sparkline-stat-label">{active != null ? 'val' : 'now'}</span>
                  {formatCompact(display.value)}
                </span>
              )}
            </div>
          )}
          {showTimeAxis && (t0 || t1) && (
            <div className="sparkline-time" aria-label="Time range">
              <span>{t0 || '—'}</span>
              <span className="sparkline-time-dash">–</span>
              <span>{t1 || '—'}</span>
            </div>
          )}
        </div>
        {hasTh && (
          <div className="sparkline-legend" aria-label="Thresholds">
            {min != null && (
              <span className="sparkline-threshold-tag sparkline-threshold-min" title="Minimum">
                min {formatCompact(min)}
              </span>
            )}
            {max != null && (
              <span className="sparkline-threshold-tag sparkline-threshold-max" title="Maximum">
                max {formatCompact(max)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
