// A sparkline (UI concept v3.1, 5 Nov: a 7-day line under Home's number, on every Trade row): one hairline through the
// points, its colour by whether the end is above the start, a 4 px dot at its end. It draws itself once (stroke-dash,
// 600 ms; none under Reduce Motion) and never animates again: a new series is a new line. Nothing is drawn under two
// points (a day-one wallet shows air, never a flat line pretending to be history).
import { useMemo } from "react";
import { sparkPath } from "./spark-path.ts";
import "./sparkline.css";
export { sparkPath };

export function Sparkline({ points, width = 96, height = 28, up }: { points: readonly number[]; width?: number; height?: number; /** The line's colour: --up or --down; default by the ends. */ up?: boolean }) {
  const d = useMemo(() => sparkPath(points, width, height), [points, width, height]);
  if (!d) return null;
  const rising = up ?? points[points.length - 1]! >= points[0]!;
  const end = d.slice(d.lastIndexOf("L") + 1).trim().split(" ");
  return (
    <svg className={`zf-spark is-${rising ? "up" : "down"}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} pathLength={1} />
      <circle cx={end[0]} cy={end[1]} r="2.2" />
    </svg>
  );
}
