// b18 (4a): a chat's browse card after a reload. The run's end is in its Activity row (the task store keeps it), so the
// card reads that row back and says what became of the run, never "Start" again for a run that already went. Each card
// keeps only which row is its own (a hash of its place, task and site, to the row's id), never the task's words.
import { tookIn } from "@zerofee/shell-api/job-steps.ts";
import { CLOSED_LINE } from "@zerofee/browser/agent/live";

const PREFIX = "zf.az.card.";
/** The card's own key: its place in the chat (message id and part), its task and site, hashed (FNV-1a), so nothing it
 *  says is kept here, and a new card with the same words is never an old one. */
export function cardKey(task: string, url: string | null, at = ""): string {
  let h = 0x811c9dc5;
  for (const c of `${at}\u0001${task}\u0001${url ?? ""}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `${PREFIX}${h.toString(16)}`;
}

type Kv = Pick<Storage, "getItem" | "setItem">;
const kvOr = (): Kv | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
/** The card started this run: its row is `az-browser-<at>`. */
export function keepCardRun(key: string, at: number, kv: Kv | null = kvOr()): void {
  try {
    kv?.setItem(key, `az-browser-${at}`);
  } catch {
    /* no storage: the card shows Start after a reload, as before */
  }
}

type Row = { id: string; state: "pending" | "done" | "failed" | "stopped"; startedAt: number; endedAt?: number; detail?: string };
/** What the card says of its run from before the reload, from its row; null when it has none (Start, as new). Pure. */
export function cardWas(key: string, rows: readonly Row[], kv: Kv | null = kvOr()): { line: string; chip: string; took: string | null } | null {
  let id: string | null = null;
  try {
    id = kv?.getItem(key) ?? null;
  } catch {
    id = null;
  }
  const row = id ? rows.find((r) => r.id === id) : undefined;
  if (!row) return null;
  // still going in the store means ZeroFee closed while it ran (the sweep ends such a row with the same line)
  if (row.state === "pending") return { line: CLOSED_LINE, chip: "Stopped", took: null };
  // audit 17's H8: a run that didn't finish says so after a reload too ("Didn't finish."), never "Stopped"
  // the row's own line says how long it took (site-tasks doneDetail): said once, never again under it
  const took = row.state === "done" && typeof row.endedAt === "number" && !/\bTook\b/.test(row.detail ?? "") ? tookIn(row.endedAt - row.startedAt) : null;
  return { line: row.detail ?? (row.state === "done" ? "AgentZero is done." : "AgentZero stopped."), chip: row.state === "done" ? "Done" : row.state === "failed" ? "Didn't finish." : "Stopped", took };
}
