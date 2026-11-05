// D143 (review, 3 Nov): the EVM checks a hot key's trade must pass to be signed with no sheet, beside Trade's decoder
// (evm.ts evmSessionRefusal). Their own file, loaded with the core's signing (subwallets.ts), never in Home's first load.
import { NATIVE, evmPlain, unlimited, type EvmSimulated, type EvmWalletChain } from "./evm.ts";

type BrowserChain = "eth" | "base" | "arb" | "gnosis";
/** Uniswap's Permit2, the one address on each chain Uniswap lists it for (the same page as UNISWAP_UR below). */
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
/**
 * Uniswap's Universal Routers: the spenders a Permit2 allowance may name. Source, read 3 Nov 2026:
 * developers.uniswap.org/contracts/v4/deployments (Universal Router, 2.1.1 and 2.1.2 per chain; Gnosis isn't
 * listed there, so none on Gnosis).
 */
const UNISWAP_UR: Record<BrowserChain, readonly string[]> = {
  eth: ["0x66a9893cc07d91d95644aedd05d03f95e1dba8af", "0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca", "0x23617e59a5925b2a4bf75d73ff6711cd0b29de85"],
  base: ["0x6ff5693b99212da76ad316178a184ab56d299b43", "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7", "0xd6145b2d3f379919e8cdeda7b97e37c4b2ca9c40"],
  arb: ["0xa51afafe0263b40edaef0df8781ea9aa03e381a3", "0x8b844f885672f333bc0042cb669255f93a4c1e6b", "0x2d01411773c8c24805306e89a41f7855c3c4fe65"],
  gnosis: [],
};
/**
 * The routers a Browser-chain wallet may give a coin's allowance to (review, 3 Nov), each from the project's own docs
 * or repo, read 3 Nov 2026. A chain the source doesn't list has none there. GMGN publishes no router address
 * (docs.gmgn.ai/: none), so GMGN's own router isn't here: a sale through it that needs an allowance is refused.
 * - Permit2: developers.uniswap.org/contracts/v4/deployments (Ethereum, Base, Arbitrum One).
 * - 1inch Aggregation Router v6 0x111111125421cA6dc452d289314280a0f8842A65:
 *   github.com/1inch/limit-order-protocol (README: the shared address on Ethereum, Arbitrum One, Gnosis Chain, Base).
 * - KyberSwap MetaAggregationRouterV2 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5:
 *   docs.kyberswap.com/developer-guide/aggregator-api/contracts (Ethereum, Arbitrum, Base).
 * - 0x AllowanceHolder 0x0000000000001fF3684f28c67538d4D072C22734: docs.0x.org/docs/core-concepts/0x-cheat-sheet
 *   (Cancun chains: Ethereum, Arbitrum, Base).
 * - Odos Router V2: github.com/odos-xyz/odos-router-v2 (README, Chain Deployments: Ethereum
 *   0xCf5540fFFCdC3d510B18bFcA6d2b9987b0772559, Base 0x19cEeAd7105607Cd444F5ad10dd51356436095a1, Arbitrum
 *   0xa669e7A0d4b3e4Fa48af2dE86BD4CD7126Be4e13).
 */
export const KNOWN_ROUTERS: Record<BrowserChain, ReadonlySet<string>> = {
  eth: new Set([PERMIT2, "0x111111125421ca6dc452d289314280a0f8842a65", "0x6131b5fae19ea4f9d964eac0408e4408b66337b5", "0x0000000000001ff3684f28c67538d4d072c22734", "0xcf5540fffcdc3d510b18bfca6d2b9987b0772559"]),
  base: new Set([PERMIT2, "0x111111125421ca6dc452d289314280a0f8842a65", "0x6131b5fae19ea4f9d964eac0408e4408b66337b5", "0x0000000000001ff3684f28c67538d4d072c22734", "0x19ceead7105607cd444f5ad10dd51356436095a1"]),
  arb: new Set([PERMIT2, "0x111111125421ca6dc452d289314280a0f8842a65", "0x6131b5fae19ea4f9d964eac0408e4408b66337b5", "0x0000000000001ff3684f28c67538d4d072c22734", "0xa669e7a0d4b3e4fa48af2de86bd4cd7126be4e13"]),
  gnosis: new Set(["0x111111125421ca6dc452d289314280a0f8842a65"]),
};
/** Review H2: a call ZeroFee may sign with no sheet on these chains goes to a router KNOWN_ROUTERS lists (or one of
 *  Uniswap's Universal Routers), or is an allowance (allowanceRefusal checks whose). Anything else: the sheet asks. */
export function knownTarget(chain: EvmWalletChain, call: { to: string; data: string }): boolean {
  if (!isBrowserChain(chain)) return false;
  const to = call.to.toLowerCase(), sel = call.data.replace(/^0x/, "").slice(0, 8).toLowerCase();
  if (sel === "095ea7b3" || (to === PERMIT2 && sel === "87517c45")) return true;
  return KNOWN_ROUTERS[chain].has(to) || UNISWAP_UR[chain].includes(to);
}
/** The longest a Permit2 allowance to a Universal Router may last (Trade's own on BNB Chain: evm.ts PERMIT2_MAX_SEC). */
const PERMIT2_MAX_SEC = 3600;
const isBrowserChain = (c: EvmWalletChain): c is BrowserChain => c === "eth" || c === "base" || c === "arb" || c === "gnosis";

/**
 * An allowance a Browser-chain wallet may give, with no sheet: to a router KNOWN_ROUTERS lists for this chain (or, on
 * Permit2 itself, to one of Uniswap's Universal Routers there, for at most PERMIT2_MAX_SEC), never unlimited and never
 * more than the wallet holds of that coin (two nodes, the lower). Taking one back (0) is always fine. Null: fine.
 */
async function allowanceRefusal(call: { to: string; data: string }, chain: EvmWalletChain, held: (token: string) => Promise<bigint>, nowSec: number): Promise<string | null | undefined> {
  const p = evmPlain({ ...call, value: 0n });
  const data = call.data.replace(/^0x/, "").toLowerCase();
  const word = (i: number) => data.slice(8 + i * 64, 8 + (i + 1) * 64);
  const addr = (w: string) => (/^0{24}[0-9a-f]{40}$/.test(w) ? `0x${w.slice(24)}` : null);
  let token: string, amount: bigint;
  if (p.kind === "approve") {
    if (p.amount === 0n) return null;
    if (!isBrowserChain(chain) || !KNOWN_ROUTERS[chain].has(p.spender)) return "It lets an app ZeroFee doesn't know spend a coin";
    [token, amount] = [p.token, p.amount];
  } else if (call.to.toLowerCase() === PERMIT2 && data.startsWith("87517c45") && data.length === 8 + 4 * 64) {
    // Permit2.approve(token, spender, amount uint160, expiration uint48)
    const t = addr(word(0)), s = addr(word(1));
    if (!t || !s) return "It gives spending permission in a way a trade doesn't need";
    amount = BigInt(`0x${word(2)}`);
    if (amount === 0n) return null;
    if (!isBrowserChain(chain) || !KNOWN_ROUTERS[chain].has(PERMIT2) || !UNISWAP_UR[chain].includes(s)) return "It lets an app ZeroFee doesn't know spend a coin";
    if (BigInt(`0x${word(3)}`) > BigInt(Math.floor(nowSec)) + BigInt(PERMIT2_MAX_SEC)) return "Its spending permission lasts longer than a trade needs";
    token = t;
  } else {
    return undefined; // not an allowance
  }
  if (unlimited(amount.toString())) return "It allows more than this wallet holds";
  const have = await held(token).catch(() => -1n);
  if (have < 0n) return "Its coin's balance couldn't be read";
  return amount > have ? "It allows more than this wallet holds" : null;
}

/**
 * Only the expected coin leaves (D143, as Solana's coinsRefusal): a buy spends no coin the wallet holds, a sale only the
 * coin it sells, read from both nodes' traced Transfer logs. A sale whose coins weren't read isn't signed. Null: fine.
 */
export function evmCoinsRefusal(swaps: readonly { side: "buy" | "sell"; coin?: string }[], coinsIn: Map<string, bigint> | undefined): string | null {
  const s = swaps[0];
  if (!s) return null;
  if (!coinsIn) return s.side === "sell" ? "Its test run couldn't read what it moves" : null;
  const fell = [...coinsIn].filter(([, n]) => n < 0n).map(([c]) => c);
  if (s.side === "buy") return fell.length ? "It spends a coin you hold" : null;
  return fell.some((c) => !s.coin || c !== s.coin.toLowerCase()) ? "It spends another coin you hold" : null;
}

/**
 * D143 (review, 3 Nov): a trade on a chain ZeroFee's trade decoder doesn't read (Ethereum, Base, Arbitrum, Gnosis:
 * the Browser wallet's, GMGN's on Base) is checked by what its test run does to the wallet, on two nodes that both ran
 * it: one coin (or the chain's own coin) out, one coin (or the chain's own coin) in, nothing else leaving. Never a plain
 * send, a coin's transfer out, or an allowance for an app ZeroFee doesn't know: an allowance goes only to a router
 * KNOWN_ROUTERS lists, at most what the wallet holds (allowanceRefusal; taking one back, to 0, is fine). Null: it may be
 * signed; else why not. What it can't check: a floor in calldata it doesn't read (the test run's figures stand).
 */
export async function outcomeRefusal(call: { to: string; value: bigint; data: string }, sim: EvmSimulated, feeOk: boolean, chain: EvmWalletChain, held: (token: string) => Promise<bigint> = async () => 0n, nowSec = Date.now() / 1000): Promise<string | null> {
  if (!sim.ok) return "Its test run didn't go through";
  if (!sim.agreed) return "The two network servers didn't both test it the same way";
  if (!feeOk) return "Its network fee is higher than ZeroFee pays on this chain";
  const p = evmPlain(call);
  if (p.kind === "send") return `It sends ${NATIVE[chain]} out of the wallet`;
  if (p.kind === "transfer") return "It sends coins out of the wallet";
  if (p.kind === "approveAll") return "It lets an app take a whole collection";
  // an allowance (a coin's own, or Permit2's) only to a listed router, at most what the wallet holds: then the sale
  // itself is checked as any trade here (review, 3 Nov)
  if (call.value === 0n) {
    const allowance = await allowanceRefusal(call, chain, held, nowSec);
    if (allowance !== undefined) return allowance;
  }
  if (!sim.coinsIn) return "Its test run couldn't read what it moves";
  const coins = [...sim.coinsIn].filter(([, n]) => n !== 0n);
  const out = coins.filter(([, n]) => n < 0n).length, got = coins.filter(([, n]) => n > 0n).length;
  const paysNative = call.value > 0n, getsNative = !paysNative && (sim.nativeIn ?? 0n) > 0n;
  if (out > 1) return "It spends more than one coin you hold";
  if ((paysNative ? 1 : 0) + out !== 1 || (getsNative ? 1 : 0) + got !== 1) return "It isn't one trade";
  return null;
}
