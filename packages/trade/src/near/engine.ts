// NEAR coins in Trade (TN2, D74; privacy first under D70): a buy or a sale happens INSIDE Spending's confidential balance.
// Spending's USDC on NEAR Intents becomes the coin (or the coin becomes USDC) by a confidential 1Click quote the core asks
// for itself, from and into Spending: no public wallet, no Safe hop, nothing for this app to sign. This engine gives the
// Buy and Sell sheets their price (the core's dry quote, display only), hands the tap to the core (subwallet.float.swap:
// its own sheet, or the Trade session within its caps), and follows the core's move until it lands.
// The sheet says the coin, the dollars and the least; 1Click is named only when it fails. A coin 1Click doesn't trade (Rhea
// only) is refused plainly.
import { ProblemError } from "@zerofee/core/problem";
import { nearProblems } from "./problems.ts";
import type { Amount, ChainEngine, CoinMeta, Fill, Prepared, Quote, Side } from "../types.ts";

/** Spending's own dollars: USDC on NEAR (the core's FLOAT_USDC). */
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** How long the tap waits for the core's move to land before saying 1Click is still finishing it. */
export const NEAR_GIVE_UP_MS = 60_000;
/** The core's move is asked about this often while it lands (then every second after the first 4 s). */
export const NEAR_POLL_MS = 250;
/** The core's floor for a swap (float-moves SWAP_MIN_USD): only a sale of ALL of a coin goes under it. */
export const NEAR_MIN_USD = 1;
/** A quote on the sheet is this fresh at most (the sheet asks again every 8 s anyway). */
const QUOTE_MS = 30_000;
/**
 * How far the price may move between the sheet and the tap (oversight review, High): the sheet's "at least" is the dry
 * quote's amount less this, and the core holds the tap's real quote (1Click's own 1 % slippage under it) to exactly that
 * least. So a small tick between the two still fills, at no less than the sheet said; a bigger one refuses, named.
 */
export const NEAR_SLIPPAGE_BPS = 300;

interface Move { id: string; kind: string; reason?: string; heldAfter?: string; status: "pending" | "done" | "failed" | "refunded"; sent: { tokenId: string; amount: string }; expected: { tokenId: string; amount: string }; settled?: { amountOut?: string; refunded?: string } }
interface SwapQuote { amountIn: string; amountOut: string; minAmountOut: string; decimals: number; symbol?: string; coinUsd: number; etaSeconds?: number }

export interface NearEngineDeps {
  /** The app's bridge call: its answer, or a ProblemError. */
  call<T>(method: string, params: Record<string, unknown>): Promise<T>;
  /** The coin's market data (its symbol, decimals and pools: a coin with only Rhea pools is Rhea-only). */
  meta?(coin: string): Promise<CoinMeta | undefined>;
  /** The coin's every pool, the market's full answer waited for (Rhea's pool lookup, rhea.ts). */
  pools?(coin: string): Promise<CoinMeta["pools"]>;
  /** Spending's float address (the engine's owner). */
  owner: string;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

const tokenOf = (coin: string) => `nep141:${coin}`;
const pow10 = (n: number) => 10 ** n;

export function createNearEngine(d: NearEngineDeps): ChainEngine {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const symbolOf = async (coin: string, fallback?: string) => (await d.meta?.(coin).catch(() => undefined))?.symbol ?? fallback ?? coin.split(".")[0]!.toUpperCase().slice(0, 12);

  async function balance(): Promise<Map<string, bigint>> {
    const b = await d.call<{ tokens?: { tokenId: string; amount: string }[]; unread?: true }>("subwallet.float.balance", {});
    if (b.unread) throw new ProblemError(nearProblems.nearOneClickDown());
    return new Map((b.tokens ?? []).filter((t) => /^\d{1,40}$/.test(t.amount)).map((t) => [t.tokenId, BigInt(t.amount)]));
  }

  /** A core refusal in Trade's words: who failed (1Click), where the money is (Spending). */
  async function said(e: unknown, coin: string, symbol: string): Promise<never> {
    const p = e instanceof ProblemError ? e.problem : undefined;
    if (p?.code === "security.partner.unreachable" || p?.code === "security.partner.down") {
      // 1Click can't price it: a coin GeckoTerminal lists only on Rhea isn't one 1Click trades; anything else, 1Click is down
      const pools = (await d.meta?.(coin).catch(() => undefined))?.pools ?? [];
      throw new ProblemError(pools.length && pools.every((x) => /rhea|ref-finance/i.test(x.dex)) ? nearProblems.nearRheaOnly(symbol) : nearProblems.nearOneClickDown());
    }
    const words = `${p?.whatHappened ?? ""} ${p?.more ?? ""}`;
    if (p && /too far|lasts longer|kind of price/i.test(words)) throw new ProblemError(nearProblems.nearPriceRefused(symbol));
    if (p && /name this coin/i.test(words)) throw new ProblemError(nearProblems.nearUnnamed());
    if (p && /cash|doesn't have that much/i.test(words)) { const cash = (await balance().catch(() => undefined))?.get(NEAR_USDC) ?? 0n; throw new ProblemError(nearProblems.nearShort(Number(cash) / 1e6)); }
    if (e instanceof ProblemError) throw e;
    throw new ProblemError(nearProblems.nearOneClickDown());
  }

  // what Spending holds of the coin after it, by the core's own count (its swap move's heldAfter): the position is that
const fillOf = (m: Move): Fill => ({ txHash: m.id, got: m.settled?.amountOut ?? m.expected.amount, spent: m.sent.amount, fee: "0", ...(m.settled?.amountOut ? {} : { estimated: true }), ...(m.heldAfter && /^\d{1,40}$/.test(m.heldAfter) ? { coinAfter: m.heldAfter } : {}) });

  const engine: ChainEngine = {
    chain: "near",
    owner: d.owner,

    async prepare(side: Side, coin: string, amount: Amount): Promise<Prepared> {
      const token = tokenOf(coin);
      const held = await balance();
      const cash = held.get(NEAR_USDC) ?? 0n, have = held.get(token) ?? 0n;
      const symbol0 = await symbolOf(coin);
      let units: bigint;
      if (side === "buy") {
        units = "usd" in amount ? BigInt(Math.floor(amount.usd * 1e6)) : "raw" in amount ? BigInt(amount.raw) : cash;
        if (units <= 0n) throw new ProblemError(nearProblems.nearShort(Number(cash) / 1e6));
        if (units > cash) throw new ProblemError(nearProblems.nearShort(Number(cash) / 1e6));
      } else {
        if (have <= 0n) throw new ProblemError(nearProblems.nearNotHeld(symbol0));
        units = "fraction" in amount ? (amount.fraction >= 1 ? have : (have * BigInt(Math.round(amount.fraction * 1e6))) / 1_000_000n) : "raw" in amount ? BigInt(amount.raw) : have;
        if (units > have) units = have;
        if (units <= 0n) throw new ProblemError(nearProblems.nearNotHeld(symbol0));
      }
      const q = await d.call<SwapQuote>("subwallet.float.swapQuote", { side, coin: token, amount: units.toString() }).catch((e) => said(e, coin, symbol0));
      const symbol = await symbolOf(coin, q.symbol);
      const coinUnits = (raw: string) => Number(BigInt(raw)) / pow10(q.decimals);
      const payUsd = side === "buy" ? Number(units) / 1e6 : coinUnits(units.toString()) * q.coinUsd;
      const getUsd = side === "buy" ? coinUnits(q.amountOut) * q.coinUsd : Number(BigInt(q.amountOut)) / 1e6;
      const quote: Quote = {
        side, chain: "near", coin, symbol, decimals: side === "buy" ? q.decimals : q.decimals,
        payRaw: units.toString(), payUsd, getRaw: q.amountOut, getUsd, getMinRaw: ((BigInt(q.amountOut) * BigInt(10_000 - NEAR_SLIPPAGE_BPS)) / 10_000n).toString(),
        // no network fee of its own: 1Click's spread is in the price, said as the difference
        feeRaw: "0", feeUsd: Math.max(0, Math.round((payUsd - getUsd) * 100) / 100),
        route: "1Click", slippageBps: NEAR_SLIPPAGE_BPS, expiresAt: now() + QUOTE_MS,
        // all of a coin worth under the core's $1 floor still sells (never stuck there), said plainly on the sheet
        ...(side === "sell" && units === have && payUsd < NEAR_MIN_USD ? { mostlyFees: true as const } : {}),
      };
      return { key: `near|${side}|${coin}|${units}|${q.amountOut}`, at: now(), quote, steps: [], ready: async () => {} };
    },

    async settle(p: Prepared, key: string, onMove?: (id: string, sessionEndsAtIso?: string) => void, session?: { perTxUsd: number; totalUsd: number; minutes: number }): Promise<{ fill: Fill } | { declined: true }> {
      const q = p.quote;
      const r = await d.call<(Move & { sessionEndsAtIso?: string }) | { declined: true }>("subwallet.float.swap", { side: q.side, coin: tokenOf(q.coin), amount: q.payRaw, atLeast: q.getMinRaw, key, ...(session ? { session } : {}) }).catch((e) => said(e, q.coin, q.symbol));
      if ("declined" in r) return { declined: true };
      onMove?.(r.id, r.sessionEndsAtIso);
      let m = r;
      const t0 = now();
      while (m.status === "pending") {
        if (now() - t0 > NEAR_GIVE_UP_MS) throw new ProblemError(nearProblems.nearSlow(q.symbol));
        await sleep(now() - t0 < 4_000 ? NEAR_POLL_MS : 1_000);
        m = await d.call<Move>("subwallet.float.move", { id: m.id }).catch(() => m);
      }
      if (m.status !== "done") throw new ProblemError(nearProblems.nearRefunded(q.symbol));
      return { fill: fillOf(m) };
    },

    async followMove(id: string, symbol: string) {
      // a move the core never kept (refused before it was signed): nothing moved (re-review b)
      const m = await d.call<Move>("subwallet.float.move", { id }).catch((e) => { if ((e as ProblemError)?.problem?.code === "security.float.unknown-move") return null; throw e; });
      if (!m) return { problem: nearProblems.nearNothingMoved(symbol) };
      if (m.status === "pending") return "pending" as const;
      if (m.status === "done") return { fill: fillOf(m) };
      // a no on the sheet is a no, never "1Click couldn't fill" (re-review a)
      return { problem: m.reason === "declined" ? nearProblems.nearNothingMoved(symbol) : nearProblems.nearRefunded(symbol) };
    },

    async holdings(coins?: string[]) {
      const held = await balance();
      const list = coins ?? [...held.keys()].filter((t) => t.startsWith("nep141:") && t !== NEAR_USDC).map((t) => t.slice(7));
      const out = await Promise.all(list.map(async (coin) => ({ coin, raw: (held.get(tokenOf(coin)) ?? 0n).toString(), decimals: (await d.meta?.(coin).catch(() => undefined))?.decimals ?? 18 })));
      return { native: (held.get(NEAR_USDC) ?? 0n).toString(), coins: out.filter((h) => BigInt(h.raw) > 0n) };
    },

    // nothing for the app to sign or send: the core moves the money inside Spending
    async send() { throw new Error("NEAR coins trade inside Spending: nothing to send"); },
    txHash() { throw new Error("NEAR coins trade inside Spending: no transaction"); },
    async status() { return "unknown"; },
    async fill() { return undefined; },
    poolChanged() {},
  };
  return engine;
}
