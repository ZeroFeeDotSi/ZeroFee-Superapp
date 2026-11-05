// The sparkline's path (Sparkline.tsx), on its own so it is tested without a renderer.
/** The SVG path through `points`, scaled into width × height with `pad` kept clear at the top and bottom. */
export function sparkPath(points: readonly number[], width: number, height: number, pad = 3): string {
  if (points.length < 2) return "";
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);
  return points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
}

