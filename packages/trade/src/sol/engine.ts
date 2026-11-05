// The Solana engine: one per trading wallet. It holds its own caches (routes, pool reads, proofs, blockhash, fees, the
// aggregator's rate gate), so two wallets never share state and a test starts clean with a new engine.
//
// prepare(): a coin still on its own launch curve (Meteora DBC / DAMM v2, Raydium LaunchLab) is built natively, at once;
// then the direct path (pool maths, no API); then Jupiter, and the curve again if Jupiter refuses a coin whose pool the
// market data named late. The curve goes before Jupiter because Jupiter routes those one way only (21 Oct: the buy but not
// the sell of 3 of 3 LaunchLab coins) and takes 2-8 s to say so. The curve lookup (one read, remembered for 10 minutes)
// runs alongside the direct path's probes, so neither waits for the other.
import { BalanceMemory } from "../balances.ts";
import { TradeError } from "../errors.ts";
import { MoveSamples } from "../slippage.ts";
import { newMemo, type Amount, type Ctx, type Side, type SolDeps, type SolPrepared } from "./context.ts";
import { curvePoolOf, nativeSellWorks, prepareCurve } from "./curve-trade.ts";
import { poolChanged, prepareDirect, tryDirect } from "./direct.ts";
import type { JupCtx, JupMemo } from "./jupiter.ts";
/** The aggregator path loads with the first quote that needs it, never in a screen's first load (Home reads holdings
 *  through this engine and never quotes: Home's budget, 4 Nov). */
const jupiter = () => import("./jupiter.ts");

type Opts = { attempt?: number };
export interface SolEngine {
  /** Every path in order. Throws a TradeError ("funds", "unavailable", "unsellable", "node", "moved"). */
  prepare(side: Side, mint: string, amount: Amount, opts?: Opts): Promise<SolPrepared>;
  prepareDirect(side: Side, mint: string, amount: Amount, opts?: Opts): Promise<SolPrepared>;
  /** The direct path, or undefined when it doesn't build this coin. "funds" still throws. */
  tryDirect(side: Side, mint: string, amount: Amount, opts?: Opts): Promise<SolPrepared | undefined>;
  prepareCurve(side: Side, mint: string, amount: Amount, opts?: Opts): Promise<SolPrepared>;
  prepareJupiter(side: Side, mint: string, amount: Amount, opts?: Opts): Promise<SolPrepared>;
  nativeSellWorks(mint: string, paySol: bigint, tokens: bigint): Promise<boolean | undefined>;
  /** The coin's pool changed (a live-feed update, a landed trade): the next quote reads it again. */
  poolChanged(mint: string): void;
  /** Balances settled by trades, so a lagging node's old balance is corrected. */
  readonly memory: BalanceMemory;
  /** Price samples from aggregator quotes, which lift the slippage floor of a fast coin. */
  readonly moves: MoveSamples;
}

/** How long the native paths (a launch curve, the direct pool) have before the Jupiter route is asked beside them. */
export const JUP_HEAD_START_MS = 250;

export function createSolEngine(d: SolDeps): SolEngine {
  const memo = newMemo(), memory = new BalanceMemory(), moves = new MoveSamples();
  const j: JupMemo = { stamps: [], openHops: new Map(), sellChecked: new Map() };   // as jupiter.ts newJupMemo
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ctx = (attempt = 0): Ctx => ({ d, m: memo, memory, moves, now, attempt });
  const jctx = (attempt = 0): JupCtx => ({ ...ctx(attempt), j, fetch: d.fetch ?? fetch, sleep, graceMs: d.graceMs });
  const funds = (e: unknown) => e instanceof TradeError && e.kind === "funds";
  // the native curve: money, and a round trip that failed (it can't be sold back), are final; any other refusal is undefined
  const curve = (side: Side, mint: string, amount: Amount, opts?: Opts) =>
    prepareCurve(ctx(opts?.attempt), side, mint, amount).catch((e: unknown) => { if (funds(e) || (e instanceof TradeError && e.kind === "unsellable")) throw e; return undefined; });
  return {
    async prepare(side, mint, amount, opts) {
      const c = ctx(opts?.attempt);
      const direct = tryDirect(c, side, mint, amount);
      direct.catch(() => undefined);                                           // awaited below, or not needed once the curve builds it
      // UX audit 4 Nov: the Jupiter route waited for the curve lookup and the direct path in turn. It now starts by itself
      // once neither has answered within JUP_HEAD_START_MS, so a coin only Jupiter trades doesn't wait in line; a coin the
      // native paths build in time costs no Jupiter call (its keyless host allows 5 calls in 10 s)
      let jup: Promise<SolPrepared> | undefined;
      const startJup = () => { if (!jup) { jup = jupiter().then((m) => m.prepareJupiter(jctx(opts?.attempt), side, mint, amount)); jup.catch(() => undefined); } return jup; };
      const early = setTimeout(startJup, JUP_HEAD_START_MS);
      try {
        // a curve lookup no node answered is asked once more before the coin can go to another venue
        if (await curvePoolOf(c, mint).catch(() => curvePoolOf(c, mint)).catch(() => undefined)) {
          const native = await curve(side, mint, amount, opts);
          if (native) return native;
        }
        const dp = await direct;
        if (dp) return dp;
      } finally { clearTimeout(early); }
      try { return await startJup(); }
      catch (e) {
        // Jupiter refused the coin (no route, not tradable, its build failed) or stayed rate-limited: a coin still on a
        // launch curve is built natively. Any other coin keeps Jupiter's answer
        if (!(e instanceof TradeError) || !(e.kind === "unavailable" || (e.kind === "node" && /jup\.ag/.test(e.message)))) throw e;
        const native = await curve(side, mint, amount, opts);
        if (native) return native;
        throw e;
      }
    },
    prepareDirect: (side, mint, amount, opts) => prepareDirect(ctx(opts?.attempt), side, mint, amount),
    tryDirect: (side, mint, amount, opts) => tryDirect(ctx(opts?.attempt), side, mint, amount),
    prepareCurve: (side, mint, amount, opts) => prepareCurve(ctx(opts?.attempt), side, mint, amount),
    prepareJupiter: async (side, mint, amount, opts) => (await jupiter()).prepareJupiter(jctx(opts?.attempt), side, mint, amount),
    nativeSellWorks: (mint, paySol, tokens) => nativeSellWorks(ctx(), mint, paySol, tokens),
    poolChanged: (mint) => poolChanged(ctx(), d.owner, mint),
    memory, moves,
  };
}
