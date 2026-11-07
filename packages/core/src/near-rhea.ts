// NEAR coins under 2 s (the hard rule, 5 Nov: a trade over 2 s, tap to landed, is not trading). The NEAR coin wallet
// keeps its wNEAR, and the coins it buys, in its OWN account inside Rhea (Ref v2's internal balances: the wallet's account
// in v2.ref-finance.near, which only this wallet's key can move or withdraw; ZeroFee holds nothing). A trade is then ONE
// call on Rhea, one receipt, no wrap, no token hop (included -> swapped: 603 ms median on mainnet, 5 Nov):
//   swap:     v2.ref-finance.near  swap { actions: [{ pool_id, token_in, token_out, amount_in, min_amount_out }] }  (1 yocto)
// The wallet's NEAR goes in once ("Ready NEAR for trading", one tap) and comes out on Put away:
//   room:     v2.ref-finance.near  storage_deposit { account_id: <wallet>, registration_only: false }  (exactly RHEA_ROOM_YOCTO)
//   deposit:  wrap.near  [storage_deposit (the wallet's wNEAR account, if none)] [near_deposit (what isn't wNEAR yet)]
//                        ft_transfer_call { receiver_id: v2.ref-finance.near, amount, msg: "" }             (1 yocto)
//   withdraw: v2.ref-finance.near  withdraw { token_id: wrap.near, amount, unregister: false, skip_unwrap_near: true } (1 yocto)
//   room back: v2.ref-finance.near storage_withdraw { amount } (1 yocto): the room's unused NEAR, once Put away has taken
//              all the wallet's NEAR out of Rhea (the audit's SHOULD, 5 Nov)
//   claim:    v2.ref-finance.near  claim_lostfound { token_id } (1 yocto): a coin Ref kept for the wallet in its lost and
//              found (a trade's transfer out failed), sent to the caller's own wallet by Ref (verified 7 Nov on mainnet:
//              the wasm's export, its 1-yocto guard, and a user's own claim tx; the audit's MUST: nothing else new)
// The core builds each from its own reads (near-trade-sign.ts), decodes its bytes again (tx-decode.ts) and holds them to
// rheaBytesRefusal: anything else is never signed. The risk said plainly (review): while ready, the wallet's NEAR and
// coins sit in Rhea's contract, under Rhea's code (upgradable by its DAO, ref-finance.sputnik-dao.near) and its guardians'
// pause; a bug or a pause there could hold them. They are the person's own account balance there, not ZeroFee's.
import { REF_EXCHANGE_ID, WNEAR } from "./near-gate.ts";
import { NEAR_STORAGE_MAX_YOCTO, swapMsg, type NearTradeAsk } from "./near-trade.ts";
import type { CoreAction } from "./tx-build.ts";
import type { DecodedTx } from "./tx-decode.ts";

/** One swap on internal balances: Ref's swap alone (about 5.5 Tgas burnt on mainnet, 5 Nov); the rest is refunded. */
export const RHEA_SWAP_GAS = 60_000_000_000_000n;
/** wrap.near's ft_transfer_call into Ref (Ref's ft_on_transfer, the resolve). */
export const RHEA_DEPOSIT_GAS = 100_000_000_000_000n;
/** Ref's withdraw: its ft_transfer out and its callback (about 38 Tgas burnt on mainnet, 5 Nov). */
export const RHEA_WITHDRAW_GAS = 100_000_000_000_000n;
const SMALL_GAS = 10_000_000_000_000n;
/** The wallet's room in Rhea, paid once: Ref's account (0.00102 NEAR, storage_balance_bounds) and about 30 coins (each
 *  about 0.00148 NEAR, read on mainnet 5 Nov: 2 coins used 0.00398). It stays the person's (Ref's storage_withdraw). */
export const RHEA_ROOM_YOCTO = 50_000_000_000_000_000_000_000n;   // 0.05 NEAR
/** Rhea's storage_withdraw: its NEAR transfer back to the wallet. */
export const RHEA_ROOM_BACK_GAS = 30_000_000_000_000n;
/** Home's NEAR wallet line while its NEAR is ready for trading, in its own account on Rhea (the audit's SHOULD, 5 Nov). */
export const RHEA_HELD_LINE = "Ready to trade: held in Rhea's exchange";
/** A coin the wallet's Rhea account hasn't held yet needs this much room free, or Ref refuses the swap (E11). */
export const RHEA_COIN_ROOM_YOCTO = 2_000_000_000_000_000_000_000n;   // 0.002 NEAR
const ONE_YOCTO = 1n;

/** What the core holds a Rhea transaction's bytes to. */
export type RheaRule =
  | { rhea: "swap"; ask: NearTradeAsk }
  | { rhea: "room" }
  | { rhea: "deposit"; amount: bigint }
  | { rhea: "withdraw"; amount: bigint }
  | { rhea: "roomBack"; amount: bigint }
  | { rhea: "claim"; token: string };

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** Ref's swap arguments for the ask, always in this exact form (its keys in this order, nothing else). */
export function rheaSwapArgs(a: NearTradeAsk): string {
  return JSON.stringify({ actions: JSON.parse(swapMsg(a)).actions });
}

export function rheaSwapTx(a: NearTradeAsk): { receiverId: string; actions: CoreAction[] } {
  return { receiverId: REF_EXCHANGE_ID, actions: [{ kind: "call", method: "swap", args: new TextEncoder().encode(rheaSwapArgs(a)), gas: RHEA_SWAP_GAS, depositYocto: ONE_YOCTO }] };
}

export function rheaRoomTx(wallet: string): { receiverId: string; actions: CoreAction[] } {
  return { receiverId: REF_EXCHANGE_ID, actions: [{ kind: "call", method: "storage_deposit", args: enc({ account_id: wallet, registration_only: false }), gas: SMALL_GAS, depositYocto: RHEA_ROOM_YOCTO }] };
}

/** The wallet's NEAR into its own Rhea account: wrapped first (only what isn't wNEAR yet), then sent in. */
export function rheaDepositTx(amount: bigint, o: { wrapYocto: bigint; registerWnearYocto?: bigint; wallet: string }): { receiverId: string; actions: CoreAction[] } {
  const actions: CoreAction[] = [];
  if (o.registerWnearYocto !== undefined) actions.push({ kind: "call", method: "storage_deposit", args: enc({ account_id: o.wallet, registration_only: true }), gas: SMALL_GAS, depositYocto: o.registerWnearYocto });
  if (o.wrapYocto > 0n) actions.push({ kind: "call", method: "near_deposit", args: enc({}), gas: SMALL_GAS, depositYocto: o.wrapYocto });
  actions.push({ kind: "call", method: "ft_transfer_call", args: enc({ receiver_id: REF_EXCHANGE_ID, amount: amount.toString(), msg: "" }), gas: RHEA_DEPOSIT_GAS, depositYocto: ONE_YOCTO });
  return { receiverId: WNEAR, actions };
}

/** The wallet's wNEAR out of its Rhea account, back to the wallet as wNEAR (never unwrapped by Ref). */
/** The room's unused NEAR back to the wallet (Ref's storage_withdraw, exactly `amount`, to the caller only). */
export function rheaRoomBackTx(amount: bigint): { receiverId: string; actions: CoreAction[] } {
  return { receiverId: REF_EXCHANGE_ID, actions: [{ kind: "call", method: "storage_withdraw", args: enc({ amount: amount.toString() }), gas: RHEA_ROOM_BACK_GAS, depositYocto: ONE_YOCTO }] };
}

export function rheaWithdrawTx(amount: bigint): { receiverId: string; actions: CoreAction[] } {
  return { receiverId: REF_EXCHANGE_ID, actions: [{ kind: "call", method: "withdraw", args: enc({ token_id: WNEAR, amount: amount.toString(), unregister: false, skip_unwrap_near: true }), gas: RHEA_WITHDRAW_GAS, depositYocto: ONE_YOCTO }] };
}

/** A coin Ref holds for the wallet in its lost and found, sent back to the wallet (the caller; no account in the args). */
export function rheaClaimTx(token: string): { receiverId: string; actions: CoreAction[] } {
  return { receiverId: REF_EXCHANGE_ID, actions: [{ kind: "call", method: "claim_lostfound", args: enc({ token_id: token }), gas: RHEA_WITHDRAW_GAS, depositYocto: ONE_YOCTO }] };
}

const json = (b: Uint8Array): unknown => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)); } catch { return undefined; } };
const sameKeys = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => k in (o as object));

/**
 * The bytes, decoded again by tx-decode.ts, held to the rule on their own (beside sameTransaction): signed by the wallet,
 * to Rhea (or wrap.near for a deposit), exactly the calls above with their exact deposits and arguments, the wallet's own
 * account named wherever one is. Null: signable.
 */
export function rheaBytesRefusal(d: DecodedTx, wallet: string, r: RheaRule): string | null {
  if (d.signerId !== wallet) return "It isn't a payment from your NEAR coin wallet.";
  if (r.rhea === "deposit") {
    if (d.receiverId !== WNEAR) return "It goes to a contract a NEAR trade doesn't use.";
    const steps = [...d.actions];
    const last = steps.pop();
    if (!last || last.kind !== "call" || last.method !== "ft_transfer_call" || last.depositYocto !== ONE_YOCTO) return "It isn't your NEAR going into Rhea.";
    const args = json(last.args) as { receiver_id?: unknown; amount?: unknown; msg?: unknown } | undefined;
    // msg "" is Ref's own deposit into the sender's account: never a swap, never another account
    if (!sameKeys(args, ["receiver_id", "amount", "msg"]) || args!.receiver_id !== REF_EXCHANGE_ID || args!.amount !== r.amount.toString() || args!.msg !== "") return "It isn't your NEAR going into Rhea.";
    let i = 0;
    const reg = steps[i];
    if (reg && reg.kind === "call" && reg.method === "storage_deposit") {
      const a = json(reg.args) as { account_id?: unknown; registration_only?: unknown } | undefined;
      if (!sameKeys(a, ["account_id", "registration_only"]) || a!.account_id !== wallet || a!.registration_only !== true || reg.depositYocto > NEAR_STORAGE_MAX_YOCTO) return "It registers an account that isn't this wallet's.";
      i++;
    }
    const wrap = steps[i];
    if (wrap && wrap.kind === "call" && wrap.method === "near_deposit") {
      if (!sameKeys(json(wrap.args), []) || wrap.depositYocto <= 0n || wrap.depositYocto > r.amount) return "It wraps more NEAR than goes in.";
      i++;
    }
    if (i !== steps.length) return "It does something Rhea's deposit doesn't need.";
    return null;
  }
  if (d.receiverId !== REF_EXCHANGE_ID) return "It goes to a contract a NEAR trade doesn't use.";
  if (d.actions.length !== 1) return "It does more than one thing on Rhea.";
  const s = d.actions[0]!;
  if (s.kind !== "call") return "It isn't a call on Rhea.";
  const args = json(s.args);
  if (r.rhea === "swap") {
    if (s.method !== "swap" || s.depositYocto !== ONE_YOCTO) return "It isn't one swap on Rhea.";
    // the arguments are exactly the ones this core writes for the ask: same keys, same order, same numbers, one action
    if (new TextDecoder().decode(s.args) !== rheaSwapArgs(r.ask)) return "Its swap isn't the trade you asked for.";
    return null;
  }
  if (r.rhea === "room") {
    const a = args as { account_id?: unknown; registration_only?: unknown } | undefined;
    if (s.method !== "storage_deposit" || s.depositYocto !== RHEA_ROOM_YOCTO || !sameKeys(a, ["account_id", "registration_only"]) || a!.account_id !== wallet || a!.registration_only !== false) return "It isn't your wallet's room in Rhea.";
    return null;
  }
  if (r.rhea === "roomBack") {
    const a = args as { amount?: unknown } | undefined;
    if (s.method !== "storage_withdraw" || s.depositYocto !== ONE_YOCTO || !sameKeys(a, ["amount"]) || a!.amount !== r.amount.toString() || r.amount <= 0n || r.amount > RHEA_ROOM_YOCTO) return "It isn't your wallet's room coming back from Rhea.";
    return null;
  }
  if (r.rhea === "claim") {
    // the audit's MUST (7 Nov): exactly Ref's claim_lostfound, 1 yocto, { token_id } alone, the kept trade's coin
    const a = args as { token_id?: unknown } | undefined;
    if (s.method !== "claim_lostfound" || s.depositYocto !== ONE_YOCTO || !sameKeys(a, ["token_id"]) || a!.token_id !== r.token) return "It isn't your coin coming back from Rhea.";
    return null;
  }
  const a = args as { token_id?: unknown; amount?: unknown; unregister?: unknown; skip_unwrap_near?: unknown } | undefined;
  if (s.method !== "withdraw" || s.depositYocto !== ONE_YOCTO || !sameKeys(a, ["token_id", "amount", "unregister", "skip_unwrap_near"]) || a!.token_id !== WNEAR || a!.amount !== r.amount.toString() || a!.unregister !== false || a!.skip_unwrap_near !== true) return "It isn't your NEAR coming back from Rhea.";
  return null;
}
