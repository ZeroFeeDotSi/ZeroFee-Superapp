// Home's Swap of a coin inside one wallet (bug report, 5 Nov; the review's ruling): a
// same-wallet swap never leaves the person's wallet, so it is a trade, direct and under 2 s, on Trade's own engines
// (Jupiter, PumpSwap, pump.fun on Solana; Uniswap on Robinhood Chain). Money that moves BETWEEN wallets never comes here:
// that is spending.move, through NEAR Confidential. Wallet asks through the spending door (spending-host.ts), never with
// Trade's engines in its own hands: the quote is kept here and only its id goes back.
//
//   spending.swap.find  { chain, q }                      Trade's market: a search (a name, or a pasted mint or contract),
//                                                         or the chain's trending list when q is empty (reads only)
//   spending.swap.held  { chain }                         the coins this chain's wallet holds (Trade's positions)
//   spending.swap.quote { chain, pay, get, usd | all }    pay/get: "native" or a coin's address; one leg, or a sale then a buy
//   spending.swap.go    { id }                            the tap: the legs in order, each landed before the next
import type { Problem } from "@zerofee/core/problem";
import { ProblemError } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import type { TradeService, TradeRecord } from "./service.ts";
import type { Market } from "./market/types.ts";
import type { Amount, ChainId, Prepared } from "./types.ts";

/** The chains a coin swaps on inside its wallet (not NEAR's coins: Trade's MARKET has no NEAR; BNB waits for its gate). */
export const SWAP_TRADE_CHAINS: readonly ChainId[] = ["sol", "hood"];
/** Who may ask: Wallet (Home's Swap) and ZeroFee's own screens. */
const CALLERS = new Set(["wallet", "shell", undefined]);
/** A quote is kept this long for its tap (Trade's own quotes re-price past their expiry at the tap). */
export const SWAP_QUOTE_KEEP_MS = 60_000;

export interface SwapLegView { side: "buy" | "sell"; route: string; symbol: string }
export interface SwapQuoteView {
  id: string; chain: ChainId; legs: SwapLegView[];
  /** What leaves the wallet, in dollars (the first leg's own figure). */
  payUsd: number;
  /** What arrives, as the coin got: `getRaw` with `getDecimals`, and the least the swap accepts. A sale then a buy is
   *  priced at the market (`about`): its buy is quoted at the tap, after the sale landed. */
  getRaw: string; getMinRaw: string; getDecimals: number; getSymbol: string; getUsd: number; about: boolean;
  feeUsd: number;
}
export interface SwapDone {
  legs: { id: string; side: "buy" | "sell"; status: TradeRecord["status"]; hashes: string[]; landedMs?: number }[];
  /** A coin → coin swap whose sale landed and whose buy didn't go (the price moved past what the sheet showed, or the buy
   *  was refused): why, in the person's words. The chain's own coin from the sale stays in the wallet. */
  stopped?: { code: string; whatHappened: string };
}
/** The chain's own coin, by name, for the words. */
const NATIVE_NAME: Partial<Record<ChainId, string>> = { sol: "SOL", hood: "ETH" };
/** QA's MUST (5 Nov): the buy after a sale never takes less than the sheet showed. */
export const priceMovedWords = (chain: ChainId): string => `The price moved. Your ${NATIVE_NAME[chain] ?? "coin"} is in your wallet.`;
export interface HeldRow { address: string; symbol: string; decimals: number; raw: string; usd?: number }

type Answer<T> = { ok: T } | { problem: Problem };
const bad = (why: string): Answer<never> => ({ problem: securityProblems.requestInvalid(why) });
const isAddress = (chain: ChainId, a: unknown): a is string =>
  typeof a === "string" && (chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a));
const side = (chain: ChainId, x: unknown): "native" | string | null => (x === "native" ? "native" : isAddress(chain, x) ? x : null);

export interface SwapDoorDeps { svc: () => TradeService; market?: () => Pick<Market, "search" | "trending">; now?: () => number; newId?: () => string }
/** Spending's host hands the runtime itself (one getter, Home's first load stays small). */
export type SwapDoorRuntime = () => { svc: TradeService; market: Pick<Market, "search" | "trending"> };
/** A coin the market found, as the picker reads it. */
export interface FoundRow { chain: ChainId; address: string; symbol: string; name: string; logoUrl?: string }
/** The most rows one find answers. */
export const FIND_MAX = 40;

export function createSwapDoor(o: SwapDoorDeps | SwapDoorRuntime) {
  const d: SwapDoorDeps = typeof o === "function" ? { svc: () => o().svc, market: () => o().market } : o;
  const now = d.now ?? Date.now;
  const newId = d.newId ?? (() => `sw-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const kept = new Map<string, { at: number; chain: ChainId; first: Prepared; then?: string; view: SwapQuoteView }>();
  const sweep = () => { for (const [k, v] of kept) if (now() - v.at > SWAP_QUOTE_KEEP_MS) kept.delete(k); };

  async function held(p: Record<string, unknown>): Promise<Answer<HeldRow[]>> {
    const chain = p.chain as ChainId;
    if (!SWAP_TRADE_CHAINS.includes(chain)) return bad("chain is sol or hood");
    const rows = (await d.svc().positions()).filter((x) => x.chain === chain && /^\d+$/.test(x.raw) && BigInt(x.raw) > 0n);
    return { ok: rows.map((x) => ({ address: x.coin, symbol: x.symbol, decimals: x.decimals, raw: x.raw, ...(typeof x.valueUsd === "number" && Number.isFinite(x.valueUsd) ? { usd: x.valueUsd } : {}) })) };
  }

  async function find(p: Record<string, unknown>): Promise<Answer<FoundRow[]>> {
    const chain = p.chain as ChainId, q = typeof p.q === "string" ? p.q.trim().slice(0, 100) : "";
    if (!["sol", "hood", "near"].includes(chain)) return bad("chain is near, sol or hood");
    if (!d.market) return bad("no market here");
    const rows = q ? await d.market().search(q) : await d.market().trending(chain);
    return { ok: rows.filter((r) => r.chain === chain).slice(0, FIND_MAX).map((r) => ({ chain: r.chain, address: r.address, symbol: r.symbol, name: r.name, ...(r.logoUrl ? { logoUrl: r.logoUrl } : {}) })) };
  }

  async function quote(p: Record<string, unknown>): Promise<Answer<SwapQuoteView>> {
    const chain = p.chain as ChainId;
    if (!SWAP_TRADE_CHAINS.includes(chain)) return bad("chain is sol or hood");
    const pay = side(chain, p.pay), get = side(chain, p.get);
    if (!pay || !get) return bad("pay and get are native or a coin's address on that chain");
    if (pay === get || (pay === "native" && get === "native")) return bad("pay and get are two different coins");
    const all = p.all === true, usd = Number(p.usd);
    if (!all && !(Number.isFinite(usd) && usd > 0)) return bad("usd is a dollar amount above 0, or all is true");
    const amount: Amount = all ? (pay === "native" ? { max: true } : { fraction: 1 }) : { usd };
    const svc = d.svc();
    // one leg: native → a coin is a buy, a coin → native a sale; a coin → another coin is a sale, then a buy at the tap
    const first = await svc.quote(pay === "native" ? "buy" : "sell", chain, pay === "native" ? get : pay, amount);
    const q = first.quote, id = newId();
    const view: SwapQuoteView = pay === "native" || get === "native"
      ? { id, chain, legs: [{ side: q.side, route: q.route, symbol: q.symbol }], payUsd: q.payUsd, getRaw: q.getRaw, getMinRaw: q.getMinRaw, getDecimals: q.side === "buy" ? q.decimals : -1, getSymbol: q.side === "buy" ? q.symbol : "", getUsd: q.getUsd, about: false, feeUsd: q.feeUsd }
      : await twoLegs(id, chain, first, get);
    sweep();
    kept.set(id, { at: now(), chain, first, ...(pay !== "native" && get !== "native" ? { then: get } : {}), view });
    return { ok: view };
  }

  /** A coin → another coin: the sale's least native is what the buy spends; the buy is priced now for the sheet (a
   *  quote of the same size), and quoted again at the tap, once the sale has landed. */
  async function twoLegs(id: string, chain: ChainId, sell: Prepared, coin: string): Promise<SwapQuoteView> {
    const s = sell.quote;
    const b = (await d.svc().quote("buy", chain, coin, { raw: s.getMinRaw })).quote;
    return { id, chain, legs: [{ side: "sell", route: s.route, symbol: s.symbol }, { side: "buy", route: b.route, symbol: b.symbol }], payUsd: s.payUsd, getRaw: b.getRaw, getMinRaw: b.getMinRaw, getDecimals: b.decimals, getSymbol: b.symbol, getUsd: b.getUsd, about: true, feeUsd: s.feeUsd + b.feeUsd };
  }

  async function go(p: Record<string, unknown>): Promise<Answer<SwapDone>> {
    const k = typeof p.id === "string" ? kept.get(p.id) : undefined;
    if (!k) return { problem: { code: "spending.swap.old", whatHappened: "That price is old. Nothing left your wallet.", money: { state: "safe", where: "where it was" }, next: { kind: "retry", label: "Try again" } } };
    kept.delete(p.id as string);                                                  // one tap, one swap
    const svc = d.svc();
    const legs: SwapDone["legs"] = [];
    const leg = (r: TradeRecord) => legs.push({ id: r.id, side: r.kind === "sell" ? "sell" : "buy", status: r.status, hashes: r.hashes, ...(r.timing?.landedAt ? { landedMs: r.timing.landedAt - r.timing.tapAt } : {}) });
    const r1 = await svc.trade(k.first);
    leg(r1);
    // a sale not done (failed, or sent and still unconfirmed): nothing is bought on it
    if (r1.status !== "done" || !k.then) return { ok: { legs } };
    // the buy, with the least the sale brought (what it surely brought; anything above stays in the wallet as its coin),
    // and never for less than the sheet showed (QA's MUST: a pump or a sandwich between the legs): both buys are
    // sized at the same sale floor, so their floors compare directly
    const moved = { code: "spending.swap.priceMoved", whatHappened: priceMovedWords(k.chain) };
    const said = (e: ProblemError) => ({ code: e.problem.code, whatHappened: `${e.problem.whatHappened} Your ${NATIVE_NAME[k.chain] ?? "coin"} is in your wallet.` });
    let buy: Prepared;
    try { buy = await svc.quote("buy", k.chain, k.then, { raw: k.first.quote.getMinRaw }); }
    // the buy's price never came: nothing was sent, the sale stands and is said
    catch (e) { return { ok: { legs, stopped: e instanceof ProblemError ? said(e) : moved } }; }
    if (BigInt(buy.quote.getMinRaw) < BigInt(k.view.getMinRaw)) return { ok: { legs, stopped: moved } };
    try { leg(await svc.trade(buy)); }
    catch (e) {
      // QA's SHOULD (5 Nov): a refusal that says nothing left ("safe") is said as it is; any other throw from the
      // trade may come after the buy was sent: the job stays open, checking, never "your SOL is in your wallet"
      if (e instanceof ProblemError && e.problem.money.state === "safe") return { ok: { legs, stopped: said(e) } };
      legs.push({ id: buy.key, side: "buy", status: "unconfirmed", hashes: [] });
    }
    return { ok: { legs } };
  }

  const methods: Record<string, (p: Record<string, unknown>) => Promise<Answer<unknown>>> = { "spending.swap.find": find, "spending.swap.held": held, "spending.swap.quote": quote, "spending.swap.go": go };
  return {
    has: (method: string) => method in methods,
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<Answer<T>> {
      const run = methods[method];
      if (!run) return { problem: securityProblems.methodUnknown(method) };
      if (!CALLERS.has(params.caller as string | undefined)) return { problem: securityProblems.requestNotAllowed("Only Home can swap coins in your wallet.") };
      try { return (await run(params)) as Answer<T>; }
      catch (e) { if (e instanceof ProblemError) return { problem: e.problem }; return { problem: securityProblems.partnerUnreachable("Trade") }; }
    },
  };
}

/** Spending's door to this one (spending-host.ts, loaded with Home's first swap ask): one door for the app's life; a
 *  refusal is thrown as Spending's own (core/spending.ts says it back as the answer's problem). */
let one: ReturnType<typeof createSwapDoor> | undefined;
export async function swapCall(rt: SwapDoorRuntime, method: string, params: Record<string, unknown>): Promise<unknown> {
  const r = await (one ??= createSwapDoor(rt)).call(method, params);
  if ("problem" in r) throw new ProblemError(r.problem);
  return r.ok;
}
