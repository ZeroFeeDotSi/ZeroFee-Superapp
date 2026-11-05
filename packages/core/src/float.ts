// The trading float (one-balance trading; product decision, 27 Oct): Trade's own balance on NEAR Intents, a NEAR implicit
// account whose key the core holds, as the private pocket's. Money comes in from the main balance with Face ID under the
// person's own rules; only the core moves it between the float and the account's own trading wallets, picking every
// destination from its own list. The moves come with the plan's private mode (confidential both ways); this file is the
// part that doesn't depend on it.
//
// The fee guard: every move costs network and bridge fees, so an app that asked for moves in a loop could spend the
// float on fees. At most 20 moves in any 24 hours go without asking (past that, each one asks on the sheet), and none
// under $2 (most of it would go on fees). An unreadable record counts as all 20 used: the guard never resets itself.
//
// The dollar budget (the outside study's item 2): at most $1,000 in any 24 hours moves between Trading and the trading
// wallets without asking; past it, each such move asks on the sheet. Every destination is already the core's own and
// every quote 1Click's own signed one; this bounds what any failure of those could move unseen in a day. Money going
// home to the main balance doesn't count.
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { utf8 } from "./sol/bytes.ts";
import type { Vault } from "./vault.ts";

export const FLOAT_MOVES_PER_DAY = 20;
export const FLOAT_MIN_USD = 2;
export const FLOAT_NO_SHEET_USD_PER_DAY = 1000;
const DAY_MS = 86_400_000;
const RECORD = "float-moves";

interface Move {
  at: number;
  id: string;
  /** Dollars it moved, counted against the day's budget (none for money going home). */
  usd?: number;
}

export class FloatGuard {
  /** Takes and releases, one at a time: two moves at once can't both take the last free one. */
  private writing: Promise<unknown> = Promise.resolve();
  private readonly vault: Vault;
  private readonly now: () => number;

  constructor(vault: Vault, now: () => number = Date.now) {
    this.vault = vault;
    this.now = now;
  }

  /** The moves of the last 24 hours. A clock set back keeps counting the "future" ones until their 24 hours pass. */
  private async recent(): Promise<Move[]> {
    const raw = await this.vault.get(RECORD);
    if (!raw) return [];
    const now = this.now();
    let list: unknown;
    try {
      list = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      list = null;
    }
    const ok = Array.isArray(list) && list.every((m) => typeof m?.at === "number" && typeof m?.id === "string" && (m.usd === undefined || (typeof m.usd === "number" && Number.isFinite(m.usd) && m.usd >= 0)));
    if (!ok) return Array.from({ length: FLOAT_MOVES_PER_DAY }, (_, i) => ({ at: now, id: `unreadable-${i}` }));
    return (list as Move[]).filter((m) => m.at > now - DAY_MS);
  }

  private locked<T>(run: () => Promise<T>): Promise<T> {
    const next = this.writing.then(run);
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** How many moves may still go without asking in the next 24 hours. */
  async left(): Promise<number> {
    await this.writing;
    return Math.max(0, FLOAT_MOVES_PER_DAY - (await this.recent()).length);
  }

  /**
   * Before a move of about `usd` dollars (the core's own price): refused under $2. Holds one of the 24 hours' moves at
   * once; `ask` is true once all 20 are used, or (when `counts`, a move not going home) once this one would take the
   * day past $1,000; `why` says which (the caller then shows the sheet). `release` gives it back if the move was never
   * signed (declined, refused, or the partner unreachable), so a failing partner can't use up the day.
   */
  take(usd: number, counts = true, unpriced = false): Promise<{ ask: boolean; why?: "moves" | "dollars"; release: () => Promise<void>; id: string }> {
    // `unpriced`: a coin going home that the core has no price for (audit RM-1): it still takes one of the day's moves.
    if (!unpriced && !(Number.isFinite(usd) && usd >= FLOAT_MIN_USD)) {
      return Promise.reject(new ProblemError(securityProblems.requestNotAllowed(`A move under $${FLOAT_MIN_USD} would mostly go on fees.`)));
    }
    return this.locked(async () => {
      const list = await this.recent();
      const move: Move = { at: this.now(), id: Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join(""), ...(counts ? { usd } : {}) };
      await this.vault.put(RECORD, utf8(JSON.stringify([...list, move])));
      const release = () => this.locked(async () => this.vault.put(RECORD, utf8(JSON.stringify((await this.recent()).filter((m) => m.id !== move.id)))));
      const moved = list.reduce((sum, m) => sum + (m.usd ?? 0), 0);
      const why = list.length >= FLOAT_MOVES_PER_DAY ? "moves" : counts && moved + usd > FLOAT_NO_SHEET_USD_PER_DAY ? "dollars" : undefined;
      return why ? { ask: true, why, release, id: move.id } : { ask: false, release, id: move.id };
    });
  }

  /** Gives back the place `take` held under `id` (a kept move that ended without moving money, later; review L4). */
  releaseId(id: string): Promise<void> {
    return this.locked(async () => this.vault.put(RECORD, utf8(JSON.stringify((await this.recent()).filter((m) => m.id !== id)))));
  }
}
