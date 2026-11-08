// UI's mainnet rehearsal (3 Nov): a $2 SOL → USDC swap promised "at least 1.4 USDC", the core's floor (3 % of price room
// and $0.50 of fee room), never what it would really bring. What a Swap really brings, from 1Click's own DRY quotes of
// its legs (QA's rule, ST3: a fee figure only from a real quote), loaded with its first ask (the Home budget). Nothing
// is kept, signed or moved, no sheet shows, and the person's own addresses are never told (stand-ins, as site-add-cost.ts).
//
// Legs: the Safe's coin or a wallet's coin into the NEAR wallet's confidential USDC (none from the NEAR wallet's own
// cash), then that USDC on to a wallet's coin, or home to the Safe (none when it stays in the NEAR wallet). The answer is
// what arrives, in dollars at 1Click's own list price, and the fees: what went in less that, never below zero.
import { FLOAT_MIN_USD } from "./float.ts";
import { CHAIN_COIN, FLOAT_USDC, type FloatMoveDeps, type TradeChain } from "./float-moves.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { STAND_IN } from "./site-add-cost.ts";
import { quoteDeadline } from "./quote-deadline.ts";
import { nearWalletRefused, safeSwapRefused, touchesNearChain, upstreamRefused } from "./near-chain-refused.ts";

/** Where a Swap pays from or lands (swap-corridor.ts's places). */
export type SwapPlace = "safe-usdc" | "safe-near" | "near" | TradeChain;
const CHAINS: readonly string[] = ["sol", "hood", "bsc"];
/** A stand-in on each EVM chain that belongs to nobody (the 0x…dEaD burn address): a price never says where money goes. */
/** An EVM wallet's stand-in (site-add-cost.ts STAND_IN: never 0x…dEaD, which 1Click refuses). */
const EVM_STAND_IN = STAND_IN.evm;
const QUOTE_MINUTES = 10;
const PER_MINUTE = 30, SAME_MS = 10_000;
const kept = new WeakMap<object, { asks: number[]; recent: Map<string, { at: number; price: Promise<SwapCost> }> }>();

export interface SwapCost { arrivesUsd: number; feeUsd: number }
export interface SwapCostDeps { relay: FloatMoveDeps["relay"]; tokenPrice?: FloatMoveDeps["tokenPrice"]; now: () => number }

/** `p.app`: Wallet's sheets (Home's Swap) or ZeroFee's own screens only. `p.from`, `p.to`: SwapPlace. `p.usd`: dollars as text. */
export async function swapCost(d: SwapCostDeps, p: Record<string, unknown>): Promise<SwapCost> {
  if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Home's Swap asks this."));
  if (!d.relay) return priced(d, p);
  let k = kept.get(d.relay);
  if (!k) kept.set(d.relay, (k = { asks: [], recent: new Map() }));
  const now = d.now(), key = JSON.stringify([p.from, p.to, p.usd]);
  for (const [x, v] of k.recent) if (now - v.at >= SAME_MS) k.recent.delete(x);
  const had = k.recent.get(key);
  if (had) return had.price;
  while (k.asks.length && now - k.asks[0]! >= 60_000) k.asks.shift();
  if (k.asks.length >= PER_MINUTE) throw new ProblemError(securityProblems.subwalletRefused("Too many price checks. Try again in a minute."));
  k.asks.push(now);
  const price = priced(d, p);
  k.recent.set(key, { at: now, price });
  price.catch(() => k!.recent.delete(key));
  return price;
}

async function priced(d: SwapCostDeps, p: Record<string, unknown>): Promise<SwapCost> {
  const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));
  const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
  const down = () => new ProblemError(securityProblems.partnerUnreachable("NEAR Intents"));
  const place = (x: unknown): SwapPlace => (x === "safe-usdc" || x === "safe-near" || x === "near" || CHAINS.includes(x as string) ? (x as SwapPlace) : (() => { throw invalid("from and to are places Home's Swap knows"); })());
  const from = place(p.from), to = place(p.to);
  // E7, the Safe's NEAR to its own USDC (swap-corridor.ts route "safe"), is priced as it runs: the Add into the NEAR
  // wallet's confidential USDC, then home. Before (5 Nov, swap directions), it was refused here, so its sheet said
  // "from and to are two places" under the amount. Any other pair inside the Safe has no route (USDC → NEAR: none yet).
  if (from === to || (from.startsWith("safe") && to.startsWith("safe") && !(from === "safe-near" && to === "safe-usdc"))) throw invalid("from and to are two places");
  const n = typeof p.usd === "string" && /^\d{1,7}(\.\d{1,2})?$/.test(p.usd) ? Number(p.usd) : NaN;
  if (!(n >= FLOAT_MIN_USD && n <= 100_000)) throw invalid(`usd is dollars as text, $${FLOAT_MIN_USD} to $100,000`);
  const relay = d.relay;
  if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
  const px = async (t: string) => (t === FLOAT_USDC ? { usd: 1, decimals: 6 } : d.tokenPrice ? await d.tokenPrice(t).catch(() => null) : null);
  const units = (x: number, places: number) => {
    const head = Math.floor(x * 10 ** Math.min(places, 15));
    if (!Number.isSafeInteger(head)) throw down();
    return BigInt(head) * 10n ** BigInt(Math.max(0, places - 15));
  };
  const deadline = quoteDeadline(d.now(), QUOTE_MINUTES * 60_000);
  const ask = async (b: Record<string, unknown>, amount: bigint): Promise<bigint> => {
    const raw: any = await relay.quote({ dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, refundTo: STAND_IN.near, refundType: "CONFIDENTIAL_INTENTS", deadline, confidentiality: "basic", amount: amount.toString(), ...b }).catch((e: unknown) => {
      // a Safe coin's leg in from NEAR's own chain that 1Click didn't take (near-chain-refused.ts): NEAR Intents', by name
      if (upstreamRefused(e) && touchesNearChain(b)) throw refused(from.startsWith("safe") ? safeSwapRefused(n) : nearWalletRefused(n));
      throw e instanceof ProblemError ? e : (e as { refused?: unknown } | null)?.refused ? refused("NEAR Intents said no. Nothing moved.") : down();
    });
    const q = raw?.quote, out = q?.amountOut;
    if (typeof out !== "string" || !/^\d{1,40}$/.test(out) || BigInt(out) === 0n || (q?.amountIn !== undefined && q.amountIn !== amount.toString())) throw refused("NEAR Intents priced it differently than asked. Nothing moved.");
    return BigInt(out);
  };
  // leg 1: into the NEAR wallet's confidential USDC (the Safe's coin, or a wallet's own coin), or the NEAR wallet's cash
  let usdc: bigint;
  if (from === "near") usdc = units(n, 6);
  else {
    const coin = from === "safe-usdc" ? FLOAT_USDC : from === "safe-near" ? "nep141:wrap.near" : CHAIN_COIN[from].tokenId;
    const c = await px(coin);
    if (!c || !(c.usd > 0) || !Number.isInteger(c.decimals)) throw down();
    usdc = await ask({ originAsset: coin, depositType: "ORIGIN_CHAIN", destinationAsset: FLOAT_USDC, recipient: STAND_IN.near, recipientType: "CONFIDENTIAL_INTENTS" }, units(n / c.usd, c.decimals));
  }
  // leg 2: on to a wallet's coin, or home to the Safe; none when it stays in the NEAR wallet
  let arrives: number;
  if (to === "near") arrives = Number(usdc) / 1e6;
  else if (to === "safe-usdc") arrives = Number(await ask({ originAsset: FLOAT_USDC, depositType: "CONFIDENTIAL_INTENTS", destinationAsset: FLOAT_USDC, recipient: STAND_IN.near, recipientType: "INTENTS" }, usdc)) / 1e6;
  else if (to === "safe-near") throw invalid("A swap into the Safe's NEAR goes from the Safe's own coins");
  else {
    const c = CHAIN_COIN[to], cp = await px(c.tokenId);
    if (!cp || !(cp.usd > 0)) throw down();
    const got = await ask({ originAsset: FLOAT_USDC, depositType: "CONFIDENTIAL_INTENTS", destinationAsset: c.tokenId, recipient: to === "sol" ? STAND_IN.sol : EVM_STAND_IN, recipientType: "DESTINATION_CHAIN" }, usdc);
    arrives = (Number(got) / 10 ** c.decimals) * cp.usd;
  }
  // a quote that brings out more than goes in (beyond 1 %) is refused, never shown as a smaller fee
  if (arrives > n * 1.01) throw refused("NEAR Intents didn't give a safe price. Nothing moved.");
  // the audit's S5 (7 Nov): the two figures were rounded each on its own, so at a half cent "about $4.85" + "about $0.16" said
  // $5.01 of a $5.00 swap. One rounding: what arrives is rounded once, and the fee is the rest of the figure in cents
  // (fee = n - cents(arrives)), so the two always add up to it
  const cents = (x: number) => Math.round(Math.max(0, x) * 100) / 100;
  const arrivesUsd = cents(arrives);
  return { arrivesUsd, feeUsd: cents(cents(n) - arrivesUsd) };
}
