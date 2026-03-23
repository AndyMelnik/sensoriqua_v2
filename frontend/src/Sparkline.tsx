type Point = { ts: string; value: number | null };

export function Sparkline({ data, width = 120, height = 32, stroke = '#0ea5e9', showThresholds, min, max }: {
  data: Point[];
  width?: number;
  height?: number;
  stroke?: string;
  showThresholds?: boolean;
  min?: number | null;
  max?: number | null;
}) {
  const values = data.map((d) => d.value).filter((v): v is number => v != null);
  if (values.length === 0) return <div className="sparkline-empty">No data</div>;
  const minVal = Math.min(...values, min ?? Infinity);
  const maxVal = Math.max(...values, max ?? -Infinity);
  const range = maxVal - minVal || 1;
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const points = values
    .map((v, i) => {
      const x = padding + (i / Math.max(values.length - 1, 1)) * w;
      const y = padding + height - padding * 2 - ((v - minVal) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  const inRange = (v: number) => {
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
    return true;
  };
  const lastVal = values[values.length - 1];
  const color = showThresholds && (min != null || max != null) ? (lastVal != null && inRange(lastVal) ? '#22c55e' : '#ef4444') : stroke;
  const yAt = (v: number) => padding + h - ((v - minVal) / range) * h;
  return (
    <svg width={width} height={height} className="sparkline">
      {showThresholds && (min != null || max != null) && (
        <>
          {min != null && (
            <line x1={padding} x2={width - padding} y1={yAt(min)} y2={yAt(min)} stroke="#94a3b8" strokeDasharray="2" strokeWidth={1} />
          )}
          {max != null && min !== max && (
            <line x1={padding} x2={width - padding} y1={yAt(max)} y2={yAt(max)} stroke="#94a3b8" strokeDasharray="2" strokeWidth={1} />
          )}
        </>
      )}
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
