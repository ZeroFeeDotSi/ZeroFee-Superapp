// Product decision (4 Nov): Home's bottom line "Safe → SOL $5: on its way." stayed many seconds after AgentZero's card
// already said Landed. The line a Move leaves on screen is now tied to its move: it ends in the same read that shows the
// move landed (the same hand-off the Activity task uses: live-steps moveTrack, from Spending's own rows, legs folded),
// saying "Moved."; a move that stopped just clears it (its task says where the money is). Nothing else is touched: a
// line that was replaced, or that went on its own, ends the watch. Loaded with the first Move that leaves such a line.
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingActivity } from "@zerofee/core/spending";
import { wentNow } from "@zerofee/shell-api/money.ts";
import { foldInto, moveTrack } from "./live-steps.ts";

export const LANDED_LINE = "Moved.";
/** How often the rows are read while the line is up (spending.changed reads at once, too). */
export const LANDING_EVERY_MS = 1000;

/** Follows the move `id` while `line` is on screen; ends the line the moment its money is where it was going. `say` is
 *  the money host's own line (only it and the sheets draw one: security review of Job 1, M1). */
export function endOnLanding(bridge: Bridge, id: string, line: string, say: (text: string) => void, o: { every?: number } = {}): () => void {
  let live = true;
  const stop = () => { live = false; off(); clearInterval(t); };
  const check = async () => {
    if (!live) return;
    if (wentNow() !== line) return stop();
    const r = await bridge.call<SpendingActivity[]>("spending.activity", {});
    if (!live || !("ok" in r) || !Array.isArray(r.ok)) return;
    const row = foldInto(r.ok).find((x) => x.id === id);
    const track = row ? moveTrack(row) : null;
    if (!track?.end) return;
    stop();
    if (wentNow() === line) say(track.end.ok ? LANDED_LINE : "");
  };
  const off = bridge.on("spending.changed", () => void check());
  const t = setInterval(() => void check(), o.every ?? LANDING_EVERY_MS);
  void check();
  return stop;
}
