// While an Add or a move is on its way, the screen asks the core where the money is every few seconds (the float's own
// round is every 2 minutes), so "Trading $X" and "Getting ready" follow the money as it lands.
import { useEffect } from "react";
import type { FloatSnapshot } from "../../float-view.ts";

const EVERY_MS = 3000;

export function useFreshWhileMoving(view: { refresh?: () => Promise<void> }, snap: FloatSnapshot): void {
  const moving = snap.moves.some((m) => m.status === "moving");
  useEffect(() => {
    if (!moving || !view.refresh) return;
    const t = setInterval(() => { void view.refresh?.().catch(() => undefined); }, EVERY_MS);
    return () => clearInterval(t);
  }, [moving, view]);
}
