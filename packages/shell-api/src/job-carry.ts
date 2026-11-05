// What a job said at the tap, kept for the rows that take its place (QA's Jobs hunt, 5 Nov): the core's own row
// for a Send dropped its dollars ("Sent to the address you gave"), every row lost the time left its starting row had, and
// a Swap read as the Move underneath. job-start.ts hands each new row id the starting row's dollars and end (the
// protocol's time); a Swap's sheet names its row (swap-follow.ts); Home's live rows read them back (live-steps.ts). Kept
// with the job rows in Home's sealed store (job-start.ts sealJobs; QA, 5 Nov: never plain localStorage), as long
// as an ended row (KEPT_MS), so a reload keeps them. A store that won't answer keeps them in memory for this run.
import { KEPT_MS } from "./tasks.ts";

/** The plain localStorage copy before 5 Nov: read once into the sealed store, then erased. */
export const JOB_CARRY_KEY = "zf.job-carry.v1";
/** Home's device.store key (sealed as Home's own copy). */
export const SEALED_CARRY = "job-carry.v1";
/** `usd`: "$3.00"; `endsAt`: the protocol's end (ms); `words`: a Swap's name ("Swap $10 of USDC for SOL"); `lands`:
 *  what its sheet priced to come in ("0.0644 SOL"). */
export type Carried = { usd?: string; endsAt?: number; words?: string; lands?: string; at: number };
const str = (x: unknown, ok: RegExp) => (typeof x === "string" && ok.test(x) ? x : undefined);

/** The page's carry over `all`; `keep` joins what Home's sealed store kept (this page's win) and writes every change
 *  there from then on (job-start.ts sealJobs). Until then, and when the store won't answer, it is in memory only. */
export function createJobCarry(all = new Map<string, Carried>(), now: () => number = Date.now) {
  let write: ((text: string) => void) | undefined;
  const save = () => {
    for (const [k, x] of all) if (now() - x.at >= KEPT_MS) all.delete(k);
    write?.(JSON.stringify(Object.fromEntries(all)));
  };
  return {
    get: (id: string): Carried | undefined => all.get(id),
    /** Adds to what each row has (a Swap's name and its job's time, told apart, end on the one row). */
    set(ids: readonly string[], c: Omit<Carried, "at">): void {
      if (!Object.values(c).some((x) => x !== undefined)) return;
      for (const id of ids) all.set(id, { ...all.get(id), ...c, at: now() });
      save();
    },
    keep(text: string | null, w: (text: string) => void): void {
      try {
        const raw = JSON.parse(text ?? "{}") as Record<string, Partial<Carried>>;
        for (const [id, c] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
          if (all.has(id) || !c || typeof c.at !== "number" || now() - c.at >= KEPT_MS) continue;
          const usd = str(c.usd, /^\$[\d,]+(\.\d+)?$/), words = str(c.words, /^Swap /), lands = str(c.lands, /\S/);
          const endsAt = typeof c.endsAt === "number" && Number.isFinite(c.endsAt) ? c.endsAt : undefined;
          all.set(id, { at: c.at, ...(usd ? { usd } : {}), ...(endsAt !== undefined ? { endsAt } : {}), ...(words ? { words } : {}), ...(words && lands ? { lands } : {}) });
        }
      } catch { /* a damaged copy is no copy */ }
      write = w;
      save();
    },
  };
}
let carry: ReturnType<typeof createJobCarry> | undefined;
/** The page's one carry. */
export const jobCarry = () => (carry ??= createJobCarry());
/** What the job's starting row (or its sheet) said, for the row `id` that took its place. */
export const carried = (id: string): Carried | undefined => jobCarry().get(id);
export const carryTo = (ids: readonly string[], c: Omit<Carried, "at">): void => jobCarry().set(ids, c);
/** What a Swap's sheet priced to come in ("0.0644 SOL"), by its Spending row's id: its end line says it. */
export const swapLands = (id: string): string | undefined => carried(`move:${id}`)?.lands;
/** Names a Swap's row the moment the core made it (not only once the sheet closes): its job reads "Swap $5 of USDC for
 *  SOL" from its first read, never the Move underneath (QA's Sim crawl, 5 Nov), after a reload too. */
export const nameSwap = (id: string, words: string, lands?: string): void => carryTo([`move:${id}`], { words, ...(lands ? { lands } : {}) });
