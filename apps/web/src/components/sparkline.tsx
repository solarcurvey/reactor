export function Sparkline({ points, className = "" }: { points: number[]; className?: string }) {
  if (points.length < 2) {
    return <div className={`h-8 w-16 ${className}`} aria-hidden />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 64;
      const y = 22 - ((p - min) / span) * 18;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = points[points.length - 1]! >= points[0]!;
  return (
    <svg viewBox="0 0 64 24" className={`h-8 w-16 ${className}`} aria-hidden>
      <path d={d} fill="none" stroke={up ? "#3dcc8a" : "#e85d4c"} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
