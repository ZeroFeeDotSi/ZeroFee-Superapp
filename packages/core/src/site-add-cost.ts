// ST3: what a site's Add costs, in dollars (display only), loaded with its first ask (the Home budget). Two DRY 1Click
// quotes of the Add's own two legs: the Safe's coin → Spending's confidential USDC (as quoteAdd asks it), then that USDC →
// SOL in the site's wallet on Solana (as Make ready moves it). Nothing is kept, signed or moved, and no sheet shows. Each
// leg's cost is what goes in less what comes out, at 1Click's own list price; a quote that pays out more than goes in
// (beyond 1 %), or answers for another amount, is refused, never shown as a smaller fee.
import { FLOAT_MIN_USD } from "./float.ts";
import { CHAIN_COIN, FLOAT_USDC, type FloatMoveDeps } from "./float-moves.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { siteNameOf } from "./site-name.ts";
import { quoteDeadline } from "./quote-deadline.ts";

const QUOTE_MINUTES = 10;
/**
 * Stand-ins for the person's addresses (D70, QA High): a price never tells 1Click or the relay who asks or where his
 * money goes before his tap. Each is of the right shape and belongs to nobody: NEAR's all-zero implicit account (64 hex)
 * for Trading's hidden balance and the refund; for a wallet on Solana or an EVM chain, an address drawn at random once
 * (32 and 20 random bytes: nobody holds their keys). Never a well-known one: 1Click refuses the System Program
 * (1111…1111) and 0x…dEaD as a recipient, at once (relay 400 quotes.upstream.refused, checked 3 Nov, dry),
 * which made every Put money in pump.fun and every Swap to the SOL or ETH (RH) wallet say "1Click didn't answer"; these
 * two were priced (201) the same minute. The fee doesn't depend on who receives it; the real move asks again with his
 * own addresses.
 */
export const STAND_IN = { near: "0".repeat(64), sol: "E3JPVC8RL9u78YMtPm5iiXumDccWnDzjtUpNf7csU7NU", evm: "0xde53dbdb23216283a6177d4db5f52ba11423d13b" } as const;
/** The addresses 1Click refuses as a price's recipient (checked 3 Nov): a stand-in is never one of them. */
export const REFUSED_RECIPIENTS: readonly string[] = ["11111111111111111111111111111111", "0x000000000000000000000000000000000000dEaD"];
/** A leg may come out at most this much better than 1Click's own list price (a quote a hair over the list is real). */
const BETTER_AT_MOST = 0.01;

/** The wallets as the core keeps them (what this reads of one). */
export interface SiteCostWallet { id: string; kind: string; chain: string; address: string; site?: string; oldWords?: true }
export interface AddCostDeps { relay: FloatMoveDeps["relay"]; tokenPrice?: FloatMoveDeps["tokenPrice"]; now: () => number; wallets: () => Promise<SiteCostWallet[]> }

/**
 * `p.app`: the caller (the bridge stamps it): the Browser's money sheet (on Wallet's bridge), the Browser tab ("social") or
 * ZeroFee's own screens (none); a site's page (Browser's engine), Trade, Chat, the apps and AgentZero are refused before
 * anything is read. `p.id`: the wallet the Add fills; only a site's own wallet on Solana, not on replaced words, is priced
 * (spending.topUp's `ready`). `p.usd`: dollars as text. `p.tokenId`: the Safe's coin that pays (default USDC; "near").
 */
/** Review Low (rate): at most this many prices a minute, and the same ask within 10 s answers with the same price. */
const PER_MINUTE = 30;
const SAME_MS = 10_000;
type Price = { feeUsd: number; legsUsd: [number, number] };
/** Per relay (one per core): when each price was asked this minute, and the asks of the last 10 s. */
const kept = new WeakMap<object, { asks: number[]; recent: Map<string, { at: number; price: Promise<Price> }> }>();

export async function siteAddCost(d: AddCostDeps, p: Record<string, unknown>): Promise<{ feeUsd: number; legsUsd: [number, number] }> {
  if (p.app !== undefined && p.app !== "wallet" && p.app !== "social") throw new ProblemError(securityProblems.requestNotAllowed("Only Browser's money sheet asks this."));
  if (!d.relay) return priced(d, p);
  let k = kept.get(d.relay);
  if (!k) kept.set(d.relay, (k = { asks: [], recent: new Map() }));
  const { asks, recent } = k;
  const now = d.now(), key = JSON.stringify([p.id, p.usd, p.tokenId ?? null]);
  for (const [k, v] of recent) if (now - v.at >= SAME_MS) recent.delete(k);
  const had = recent.get(key);
  if (had) return had.price;
  while (asks.length && now - asks[0]! >= 60_000) asks.shift();
  if (asks.length >= PER_MINUTE) throw new ProblemError(securityProblems.subwalletRefused("Too many price checks. Try again in a minute."));
  asks.push(now);
  const price = priced(d, p);
  recent.set(key, { at: now, price });
  price.catch(() => recent.delete(key));
  return price;
}

async function priced(d: AddCostDeps, p: Record<string, unknown>): Promise<{ feeUsd: number; legsUsd: [number, number] }> {
  const w = (await d.wallets()).find((x) => x.id === p.id);
  if (!w || w.kind !== "site" || w.chain !== "sol" || w.oldWords || !siteNameOf(w.site)) throw new ProblemError(securityProblems.subwalletUnknown());
  const usd = p.usd, tokenId = p.tokenId ?? FLOAT_USDC;
  const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));
  const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
  const down = () => new ProblemError(securityProblems.partnerUnreachable("NEAR Intents"));
  const n = typeof usd === "string" && /^\d{1,7}(\.\d{1,2})?$/.test(usd) ? Number(usd) : NaN;
  if (!(n >= FLOAT_MIN_USD && n <= 100_000)) throw invalid(`usd is dollars as text, $${FLOAT_MIN_USD} to $100,000`);
  const coin = tokenId === "near" ? "nep141:wrap.near" : tokenId;
  if (typeof coin !== "string" || !/^nep141:[a-z0-9_.-]{2,64}$/.test(coin)) throw invalid("The coin must be one held in your Safe.");
  const relay = d.relay;
  if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
  const px = async (t: string) => (d.tokenPrice ? await d.tokenPrice(t).catch(() => null) : null);
  const [inPx, solPx] = await Promise.all([coin === FLOAT_USDC ? { usd: 1, decimals: 6 } : px(coin), px(CHAIN_COIN.sol.tokenId)]);
  if (!inPx || !(inPx.usd > 0) || !Number.isInteger(inPx.decimals) || !solPx || !(solPx.usd > 0)) throw down();
  const units = (x: number, places: number) => {
    const head = Math.floor(x * 10 ** Math.min(places, 15));
    // review Low: a coin priced near zero would need more units than a number holds: no price, never a thrown RangeError
    if (!Number.isSafeInteger(head)) throw down();
    return BigInt(head) * 10n ** BigInt(Math.max(0, places - 15));
  };
  const deadline = quoteDeadline(d.now(), QUOTE_MINUTES * 60_000);
  const ask = (b: Record<string, unknown>) =>
    relay.quote({ dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, refundTo: STAND_IN.near, refundType: "CONFIDENTIAL_INTENTS", deadline, confidentiality: "basic", ...b }).catch((e: unknown) => {
      // review Low: a 4xx (1Click said no) is a refusal, never an outage that is asked again
      throw e instanceof ProblemError ? e : (e as { refused?: unknown } | null)?.refused ? refused("NEAR Intents said no. Nothing moved.") : down();
    });
  const outOf = (raw: any, asked: string): bigint => {
    const q = raw?.quote, out = q?.amountOut;
    if (typeof out !== "string" || !/^\d{1,40}$/.test(out) || BigInt(out) === 0n || (q?.amountIn !== undefined && q.amountIn !== asked)) throw refused("NEAR Intents priced it differently than asked. Nothing moved.");
    return BigInt(out);
  };
  // leg 1: the Safe's coin → Spending's confidential USDC
  const in1 = units(n / inPx.usd, inPx.decimals).toString();
  const got1 = outOf(await ask({ originAsset: coin, depositType: "ORIGIN_CHAIN", destinationAsset: FLOAT_USDC, amount: in1, recipient: STAND_IN.near, recipientType: "CONFIDENTIAL_INTENTS" }), in1);
  // leg 2: that USDC → SOL in the site's wallet, quoted on no more than the dollars asked (review M: a leg 1 that
  // over-promises never makes leg 2 look cheaper)
  const mid = got1 < units(n, 6) ? got1 : units(n, 6);
  const got2 = outOf(await ask({ originAsset: FLOAT_USDC, depositType: "CONFIDENTIAL_INTENTS", destinationAsset: CHAIN_COIN.sol.tokenId, amount: mid.toString(), recipient: STAND_IN.sol, recipientType: "DESTINATION_CHAIN" }), mid.toString());
  const usd1 = Number(mid) / 1e6, sol = (Number(got2) / 10 ** CHAIN_COIN.sol.decimals) * solPx.usd;
  const legs: [number, number] = [n - Number(got1) / 1e6, usd1 - sol];
  if (legs.some((c, i) => c < -BETTER_AT_MOST * (i ? usd1 : n))) throw refused("NEAR Intents didn't give a safe price. Nothing moved.");
  // each leg's cost on its own, never below 0: a leg a hair better than the list never credits the other (review M)
  const cents = (x: number) => Math.round(Math.max(0, x) * 100) / 100;
  const each: [number, number] = [cents(legs[0]), cents(legs[1])];
  return { feeUsd: Math.round((each[0] + each[1]) * 100) / 100, legsUsd: each };
}
