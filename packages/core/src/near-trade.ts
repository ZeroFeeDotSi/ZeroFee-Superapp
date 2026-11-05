// NEAR coins at chain speed (product decision, 3 Nov; amends D96): a buy or a sale of a NEAR coin is one
// public transaction from the NEAR coin wallet (a hot key from the words, m/44'/397'/16', hot-keys.ts) straight into one
// Rhea (Ref v2) pool: no 1Click hop, no intents. Funding stays private (Spending moves the money in, as for SOL); the
// trade itself is public, as on Solana.
//
// The app never hands the core bytes to sign here. It names the trade (side, coin, pool, amount in, least out) and the
// core builds the transaction itself, from a fixed shape:
//   buy:  wrap.near   [storage_deposit (only if the wallet isn't registered)] [near_deposit (only what isn't wrapped yet)]
//                     ft_transfer_call { receiver_id: v2.ref-finance.near, amount, msg }            (exactly 1 yoctoNEAR)
//   sell: <the coin>  ft_transfer_call { receiver_id: v2.ref-finance.near, amount, msg }            (exactly 1 yoctoNEAR)
//   msg:  {"force":0,"actions":[{"pool_id":N,"token_in":…,"token_out":…,"amount_in":…,"min_amount_out":…}]}
//   register (a coin's account for the wallet, before its first buy): <the coin> storage_deposit, at most 0.01 NEAR
// Then the serialized bytes are decoded again by tx-decode.ts (a separate implementation) and checked against the same
// rules (nearTradeBytesRefusal), on top of sameTransaction: anything else is never signed.
import { base64ToBytes } from "@fastnear/utils";
import { NEAR_CLOSED, NEAR_GATE, NEAR_STORAGE_MAX_YOCTO, REF_EXCHANGE_ID, WNEAR } from "./near-gate.ts";
import type { CoreAction } from "./tx-build.ts";

export { NEAR_CLOSED, NEAR_GATE, NEAR_STORAGE_MAX_YOCTO, REF_EXCHANGE_ID, WNEAR };
import { isAccountId } from "./tx-build.ts";
import type { DecodedTx } from "./tx-decode.ts";

/** One swap's gas: Ref's ft_on_transfer, the swap, the coin's transfer out and the resolve (Ref's own UI asks 180 Tgas). */
export const NEAR_SWAP_GAS = 180_000_000_000_000n;
/** near_deposit and storage_deposit: plain calls. */
export const NEAR_SMALL_GAS = 10_000_000_000_000n;
/** A Rhea pool's wNEAR must be at least this many times the trade's NEAR (review H1): a trade a twentieth of the pool's
 *  NEAR moves its price about 5 % at most (constant product: 1/(1+1/20)), so a dust pool made to drain a wallet is never
 *  one to trade in, and a real coin's pool always is for dust trades ($937k RHEA pool: 20x is ~$23k). */
export const NEAR_POOL_DEPTH = 20n;
/** What a trade brings back may be at most this far under what it gives, at the core's own market prices (as SALE_CHEAP:
 *  85 %). Under it the trade is refused, never asked. */
export const NEAR_FAIR_SHARE = 0.85;
/** The least out may be at most this far under the pool's own answer (get_return at the same block). */
export const NEAR_SLIPPAGE_MAX_BPS = 500;
const ONE_YOCTO = 1n;
const DIGITS = /^\d{1,39}$/;
const U128_MAX = (1n << 128n) - 1n;

export interface NearTradeAsk {
  side: "buy" | "sell";
  /** The coin's NEP-141 contract. */
  coin: string;
  /** Ref's pool id (GeckoTerminal's "refv1-<id>"). */
  poolId: number;
  /** yoctoNEAR (buy) or the coin's smallest units (sell). */
  amountIn: string;
  /** The least the swap may give back: the coin's units (buy) or yocto wNEAR (sell). */
  minOut: string;
}

/** The ask, checked to the letter: any other key, an odd number or an odd coin is refused. Null: it's a trade's shape. */
export function nearAskRefusal(a: unknown): string | null {
  if (!a || typeof a !== "object") return "a NEAR trade names its side, coin, pool and amounts";
  const x = a as Record<string, unknown>;
  const extra = Object.keys(x).filter((k) => !["side", "coin", "poolId", "amountIn", "minOut"].includes(k));
  if (extra.length) return `a NEAR trade has no ${extra[0]}`;
  if (x.side !== "buy" && x.side !== "sell") return "side is buy or sell";
  if (!isAccountId(x.coin) || x.coin === WNEAR || x.coin === REF_EXCHANGE_ID) return "the coin is a NEAR coin's contract";
  if (typeof x.poolId !== "number" || !Number.isInteger(x.poolId) || x.poolId < 0 || x.poolId > 1_000_000_000) return "the pool is Rhea's pool number";
  for (const k of ["amountIn", "minOut"] as const) {
    if (typeof x[k] !== "string" || !DIGITS.test(x[k] as string) || BigInt(x[k] as string) > U128_MAX) return `${k} is a whole number written as text`;
    if (BigInt(x[k] as string) <= 0n) return k === "minOut" ? "a trade has a least it gives back" : "a trade moves something";
  }
  return null;
}

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** Ref's swap message, always in this exact form (its keys in this order, nothing else). */
export function swapMsg(a: NearTradeAsk): string {
  const [tokenIn, tokenOut] = a.side === "buy" ? [WNEAR, a.coin] : [a.coin, WNEAR];
  return JSON.stringify({ force: 0, actions: [{ pool_id: a.poolId, token_in: tokenIn, token_out: tokenOut, amount_in: a.amountIn, min_amount_out: a.minOut }] });
}

/**
 * The transaction a NEAR trade is. `wrapYocto`: the NEAR to wrap first (a buy's amount less the wNEAR the wallet already
 * holds, read by the core); `registerWnear`: the wallet has no wNEAR account yet (the core read it), with its storage.
 */
export function nearTradeTx(a: NearTradeAsk, o: { wrapYocto: bigint; registerWnearYocto?: bigint; wallet: string }): { receiverId: string; actions: CoreAction[] } {
  const swap: CoreAction = { kind: "call", method: "ft_transfer_call", args: enc({ receiver_id: REF_EXCHANGE_ID, amount: a.amountIn, msg: swapMsg(a) }), gas: NEAR_SWAP_GAS, depositYocto: ONE_YOCTO };
  if (a.side === "sell") return { receiverId: a.coin, actions: [swap] };
  const actions: CoreAction[] = [];
  if (o.registerWnearYocto !== undefined) actions.push({ kind: "call", method: "storage_deposit", args: enc({ account_id: o.wallet, registration_only: true }), gas: NEAR_SMALL_GAS, depositYocto: o.registerWnearYocto });
  if (o.wrapYocto > 0n) actions.push({ kind: "call", method: "near_deposit", args: enc({}), gas: NEAR_SMALL_GAS, depositYocto: o.wrapYocto });
  actions.push(swap);
  return { receiverId: WNEAR, actions };
}

/** A coin account for the wallet on the coin's own contract (NEP-145), before its first buy. */
export function nearRegisterTx(coin: string, wallet: string, depositYocto: bigint): { receiverId: string; actions: CoreAction[] } {
  return { receiverId: coin, actions: [{ kind: "call", method: "storage_deposit", args: enc({ account_id: wallet, registration_only: true }), gas: NEAR_SMALL_GAS, depositYocto }] };
}

const json = (b: Uint8Array): unknown => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)); } catch { return undefined; } };
const sameKeys = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => k in (o as object));

/**
 * The bytes, decoded again by tx-decode.ts, checked against the ask on their own (defence in depth beside
 * sameTransaction): the signer is the wallet; the receiver is wrap.near (buy) or the coin (sell, register); only the
 * calls above, each with its exact deposit; the swap's message parsed strictly and equal to the ask. Null: signable.
 * `register`: the coin a storage_deposit is for (a register's own transaction).
 */
export function nearTradeBytesRefusal(d: DecodedTx, wallet: string, a: NearTradeAsk | { register: string; maxYocto: bigint }): string | null {
  if (d.signerId !== wallet) return "It isn't a payment from your NEAR coin wallet.";
  if ("register" in a) {
    if (d.receiverId !== a.register || d.actions.length !== 1) return "It isn't a coin account for this wallet.";
    const s = d.actions[0]!;
    if (s.kind !== "call" || s.method !== "storage_deposit" || s.depositYocto > a.maxYocto || s.depositYocto <= 0n) return "It isn't a coin account for this wallet.";
    const args = json(s.args) as { account_id?: unknown; registration_only?: unknown } | undefined;
    if (!sameKeys(args, ["account_id", "registration_only"]) || args!.account_id !== wallet || args!.registration_only !== true) return "It isn't a coin account for this wallet.";
    return null;
  }
  if (d.receiverId !== (a.side === "buy" ? WNEAR : a.coin)) return "It goes to a contract a NEAR trade doesn't use.";
  const steps = [...d.actions];
  const last = steps.pop();
  if (!last || last.kind !== "call" || last.method !== "ft_transfer_call" || last.depositYocto !== ONE_YOCTO) return "It isn't one swap on Rhea.";
  const args = json(last.args) as { receiver_id?: unknown; amount?: unknown; msg?: unknown } | undefined;
  if (!sameKeys(args, ["receiver_id", "amount", "msg"]) || args!.receiver_id !== REF_EXCHANGE_ID || args!.amount !== a.amountIn || typeof args!.msg !== "string") return "It isn't one swap on Rhea.";
  // the message is exactly the one this core writes for the ask: same keys, same order, same numbers, one action
  if (args!.msg !== swapMsg(a)) return "Its swap isn't the trade you asked for.";
  // a buy's own steps before the swap: at most one wNEAR registration for the wallet, then at most one wrap
  let i = 0;
  if (a.side === "sell" && steps.length) return "It does more than one swap.";
  const reg = steps[i];
  if (reg && reg.kind === "call" && reg.method === "storage_deposit") {
    const r = json(reg.args) as { account_id?: unknown; registration_only?: unknown } | undefined;
    if (!sameKeys(r, ["account_id", "registration_only"]) || r!.account_id !== wallet || r!.registration_only !== true || reg.depositYocto > NEAR_STORAGE_MAX_YOCTO) return "It registers an account that isn't this wallet's.";
    i++;
  }
  const wrap = steps[i];
  if (wrap && wrap.kind === "call" && wrap.method === "near_deposit") {
    if (!sameKeys(json(wrap.args), []) || wrap.depositYocto <= 0n || wrap.depositYocto > BigInt(a.amountIn)) return "It wraps more NEAR than the trade uses.";
    i++;
  }
  if (i !== steps.length) return "It does something a NEAR trade doesn't need.";
  return null;
}

// ── the outcome: landed only when the swap really happened ───────────────────────────────────────────────────────────

/** What a send_tx / tx answer says about a NEAR trade: `landed` (the swap used all it was given and the coin out reached
 *  the wallet, at least the least), `refunded` (the swap failed and its coins went back), `failed` (a receipt failed),
 *  `unproven` (used in full, but no transfer line the core reads says where the coin went: the wallet's balance, read on
 *  two nodes at final, decides), or null (not executed yet). */
export type NearOutcome = { landed: true; got: bigint } | { refunded: true } | { failed: string } | { unproven: true } | null;

/** NEP-141 transfers to `wallet` from Ref, as the coin's own logs say, summed: the NEP-297 EVENT_JSON ft_transfer, or the
 *  older plain line ("Transfer <amount> from v2.ref-finance.near to <wallet>"), which wrap.near writes (mainnet, 3 Nov:
 *  HV5jNuVr…, a sale on Rhea paid in wNEAR, never unwrapped). Only the coin's own receipts count. */
function transfersIn(r: any, wallet: string, token: string): bigint {
  let sum = 0n;
  for (const ro of Array.isArray(r?.receipts_outcome) ? r.receipts_outcome : []) {
    if (ro?.outcome?.executor_id !== token) continue;
    if (ro?.outcome?.status && "Failure" in ro.outcome.status) continue;
    // one receipt's transfer is counted once: its NEP-297 events when it writes any, else its plain lines (re-review L:
    // a coin that writes both never counts twice)
    let events = 0n, plainSum = 0n;
    for (const log of Array.isArray(ro?.outcome?.logs) ? ro.outcome.logs : []) {
      if (typeof log !== "string") continue;
      const plain = /^Transfer (\d{1,39}) from ([a-z0-9._-]{2,64}) to ([a-z0-9._-]{2,64})$/.exec(log);
      if (plain) { if (plain[2] === REF_EXCHANGE_ID && plain[3] === wallet) plainSum += BigInt(plain[1]!); continue; }
      if (!log.startsWith("EVENT_JSON:")) continue;
      const e = (() => { try { return JSON.parse(log.slice("EVENT_JSON:".length)); } catch { return undefined; } })();
      if (e?.standard !== "nep141" || e?.event !== "ft_transfer" || !Array.isArray(e?.data)) continue;
      for (const t of e.data) if (t?.old_owner_id === REF_EXCHANGE_ID && t?.new_owner_id === wallet && typeof t?.amount === "string" && DIGITS.test(t.amount)) events += BigInt(t.amount);
    }
    sum += events > 0n ? events : plainSum;
  }
  return sum;
}

/** Listed NEAR coins by their own symbol: a coin that names itself one of these and isn't that contract is never shown
 *  by that name on a sheet (re-review L, as Solana's taken set). */
export const NEAR_TAKEN: Readonly<Record<string, string>> = {
  NEAR: WNEAR, WNEAR: WNEAR, USDC: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", USDT: "usdt.tether-token.near",
  RHEA: "token.rhealab.near", REF: "token.v2.ref-finance.near", ETH: "aurora", WETH: "c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.factory.bridge.near",
  BTC: "nbtc.bridge.near", WBTC: "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near", SOL: "sol.omft.near",
};
/** The name a coin's own contract gives, as a sheet may show it: plain letters only, at most 12; a listed coin's name on
 *  another contract, or none: "this coin". */
export function sheetSymbol(raw: unknown, coin: string): string {
  const s = typeof raw === "string" ? Array.from(raw.replace(/[^\p{L}\p{N} ._$-]/gu, "").trim()).slice(0, 12).join("") : "";
  if (!s) return "this coin";
  const listed = NEAR_TAKEN[s.toUpperCase()];
  return listed !== undefined && listed !== coin ? "this coin" : s;
}

export function nearOutcome(r: any, a: NearTradeAsk, wallet: string): NearOutcome {
  const status = r?.status ?? r?.transaction_outcome?.outcome?.status;
  if (!status || typeof status !== "object" || !("SuccessValue" in status || "Failure" in status)) return null;
  if ("Failure" in status) return { failed: "The NEAR network refused it." };
  // ft_transfer_call's answer (the last action's): how much of the amount the swap USED; less than all is a refund
  let used: string | undefined;
  try { used = JSON.parse(new TextDecoder().decode(base64ToBytes(String(status.SuccessValue)))); } catch { used = undefined; }
  if (typeof used !== "string" || !DIGITS.test(used)) return { failed: "Its answer can't be read." };
  if (BigInt(used) !== BigInt(a.amountIn)) return BigInt(used) === 0n ? { refunded: true } : { failed: "The swap used only part of it." };
  const failedReceipt = (Array.isArray(r?.receipts_outcome) ? r.receipts_outcome : []).some((ro: any) => ro?.outcome?.status && "Failure" in ro.outcome.status);
  const got = transfersIn(r, wallet, a.side === "buy" ? a.coin : WNEAR);
  // the coin out never reached the wallet (Ref kept it as lost and found), or less than the least: never "landed"
  if (failedReceipt && got < BigInt(a.minOut)) return { failed: "Rhea couldn't send the coin to your wallet." };
  // used in full and no transfer line the core reads: the wallet's balance, on two nodes at final, decides (review M3)
  if (got === 0n) return { unproven: true };
  if (got < BigInt(a.minOut)) return { failed: "Less came back than the least." };
  return { landed: true, got };
}
