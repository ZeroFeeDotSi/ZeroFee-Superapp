// The NEAR transactions the ledger asks the core to sign, built in exactly the shapes the approval sheet knows how to
// describe (Security, 25 Oct). Every call is from the account itself (the predecessor path: post-quantum accounts can't
// sign intents), with 1 yocto attached where intents.near or a coin contract asks for it. Amounts are whole units.
//
//   mtTransfer        move coins inside intents.near: to another account, or into a 1Click quote's deposit address
//   mtTransferCall    the same, and ask the receiver to act on it (`msg`): it keeps what it accepts, and intents.near
//                     sends the rest back in the same transaction
//   withdrawHome      a bridged *.omft.near coin back to its own chain: ft_withdraw to the token itself, memo
//                     "WITHDRAW_TO:<address>[:<tag>]", no msg (a refused withdraw comes back to the ledger)
//   withdrawToNear    a coin out of intents.near to a NEAR account (also a 1Click NEAR deposit address), no msg
//   nearIntoLedger    NEAR on the account → wrapped → into intents.near, one transaction to wrap.near
//   registerOn        pay a coin contract's storage for an account, so it can receive that coin
// Coins on the account itself (sent from a NEAR wallet, D14), each in one transaction to one receiver:
//   sendNear          plain NEAR to a NEAR account
//   ftTransfer        a NEAR coin to a NEAR account
//   ftIntoLedgerOf    a NEAR coin into someone's intents.near balance (ft_transfer_call, msg = their account)
import { STORAGE_DEPOSIT_MAX_YOCTO } from "@zerofee/core/near-gate";
import type { TxRequest } from "@zerofee/core/signer";
import { INTENTS } from "@zerofee/core/intents";
import { ProblemError } from "@zerofee/core/problem";
import { walletProblems } from "./wallet-problems.ts";

const ONE_YOCTO = "1";
const TGAS = 1_000_000_000_000n;
const gas = (tgas: number) => (BigInt(tgas) * TGAS).toString();
/** wrap.near's storage for one account (storage_balance_bounds on mainnet, 25 Oct). */
export const WRAP_STORAGE_YOCTO = "1250000000000000000000";
/**
 * The most storage deposit ever paid for one account on a coin contract: 0.01 NEAR (audit W-7). The amount comes from the
 * contract's own storage_balance_bounds, so a contract could ask for anything; NEAR's coins ask 0.00125 (wrap.near, USDC,
 * USDT), so this is 8x what they need. Above it, nothing is signed.
 */
export const MAX_STORAGE_DEPOSIT_YOCTO = STORAGE_DEPOSIT_MAX_YOCTO;

type Ask = Pick<TxRequest, "receiverId" | "actions" | "why">;
const ask = (r: Ask): TxRequest => ({ ...r, from: "wallet" });

export function mtTransfer(o: { to: string; tokenId: string; units: bigint; memo?: string; why: string }): TxRequest {
  return ask({
    receiverId: INTENTS.account,
    actions: [{ kind: "call", method: "mt_transfer", args: { receiver_id: o.to, token_id: o.tokenId, amount: o.units.toString(), approval: null, ...(o.memo ? { memo: o.memo } : {}) }, depositYocto: ONE_YOCTO, gas: gas(30) }],
    why: o.why,
  });
}

export function mtTransferCall(o: { to: string; tokenId: string; units: bigint; memo?: string; msg: string; why: string }): TxRequest {
  return ask({
    receiverId: INTENTS.account,
    actions: [{ kind: "call", method: "mt_transfer_call", args: { receiver_id: o.to, token_id: o.tokenId, amount: o.units.toString(), approval: null, ...(o.memo ? { memo: o.memo } : {}), msg: o.msg }, depositYocto: ONE_YOCTO, gas: gas(150) }],
    why: o.why,
  });
}

export function withdrawHome(o: { contract: string; address: string; tag?: string; units: bigint; why: string }): TxRequest {
  if (!o.contract.endsWith(".omft.near")) throw new Error(`${o.contract} isn't a bridged coin that goes home this way`);
  return ask({
    receiverId: INTENTS.account,
    actions: [{ kind: "call", method: "ft_withdraw", args: { token: o.contract, receiver_id: o.contract, amount: o.units.toString(), memo: `WITHDRAW_TO:${o.address}${o.tag ? `:${o.tag}` : ""}` }, depositYocto: ONE_YOCTO, gas: gas(100) }],
    why: o.why,
  });
}

export function withdrawToNear(o: { contract: string; receiverId: string; units: bigint; memo?: string; why: string }): TxRequest {
  return ask({
    receiverId: INTENTS.account,
    actions: [{ kind: "call", method: "ft_withdraw", args: { token: o.contract, receiver_id: o.receiverId, amount: o.units.toString(), ...(o.memo ? { memo: o.memo } : {}) }, depositYocto: ONE_YOCTO, gas: gas(100) }],
    why: o.why,
  });
}

/** Wrap NEAR and deposit it into this account's ledger balance (an empty msg credits the sender), or into `owner`'s. */
export function nearIntoLedger(o: { accountId: string; yocto: bigint; owner?: string; why: string }): TxRequest {
  return ask({
    receiverId: "wrap.near",
    actions: [
      { kind: "call", method: "storage_deposit", args: { account_id: o.accountId, registration_only: true }, depositYocto: WRAP_STORAGE_YOCTO, gas: gas(10) },
      { kind: "call", method: "near_deposit", args: {}, depositYocto: o.yocto.toString(), gas: gas(10) },
      { kind: "call", method: "ft_transfer_call", args: { receiver_id: INTENTS.account, amount: o.yocto.toString(), msg: o.owner && o.owner !== o.accountId ? o.owner : "" }, depositYocto: ONE_YOCTO, gas: gas(100) },
    ],
    why: o.why,
  });
}

export function sendNear(o: { to: string; yocto: bigint; why: string }): TxRequest {
  return ask({ receiverId: o.to, actions: [{ kind: "transfer", yocto: o.yocto.toString() }], why: o.why });
}

export function ftTransfer(o: { contract: string; to: string; units: bigint; memo?: string; why: string }): TxRequest {
  return ask({
    receiverId: o.contract,
    actions: [{ kind: "call", method: "ft_transfer", args: { receiver_id: o.to, amount: o.units.toString(), ...(o.memo ? { memo: o.memo } : {}) }, depositYocto: ONE_YOCTO, gas: gas(30) }],
    why: o.why,
  });
}

export function ftIntoLedgerOf(o: { contract: string; owner: string; units: bigint; memo?: string; why: string }): TxRequest {
  return ask({
    receiverId: o.contract,
    actions: [{ kind: "call", method: "ft_transfer_call", args: { receiver_id: INTENTS.account, amount: o.units.toString(), msg: o.owner, ...(o.memo ? { memo: o.memo } : {}) }, depositYocto: ONE_YOCTO, gas: gas(100) }],
    why: o.why,
  });
}

/** NEAR on the account, wrapped and handed to `to` as wNEAR (its storage paid first when it has none): one transaction.
 *  The account's own storage step is left out only when `meRegistered` is true (wrapRegistered read it there). */
export function nearAsWnearTo(o: { accountId: string; to: string; yocto: bigint; registerTo: boolean; meRegistered?: boolean; why: string }): TxRequest {
  const storage = (account_id: string) => ({ kind: "call" as const, method: "storage_deposit", args: { account_id, registration_only: true }, depositYocto: WRAP_STORAGE_YOCTO, gas: gas(10) });
  return ask({
    receiverId: "wrap.near",
    actions: [
      ...(o.meRegistered === true ? [] : [storage(o.accountId)]),
      ...(o.registerTo ? [storage(o.to)] : []),
      { kind: "call", method: "near_deposit", args: {}, depositYocto: o.yocto.toString(), gas: gas(10) },
      { kind: "call", method: "ft_transfer", args: { receiver_id: o.to, amount: o.yocto.toString() }, depositYocto: ONE_YOCTO, gas: gas(30) },
    ],
    why: o.why,
  });
}

/** wrap.near's storage_balance_of answer says the account is set up there: a { total } read. Null (none), anything else,
 *  or a read that failed: not known to be, so its storage step stays (audit, 6 Nov: never skip on an unknown). */
export const isRegisteredRead = (v: unknown): boolean => !!v && typeof v === "object" && typeof (v as { total?: unknown }).total === "string";
/** Is `accountId` set up on wrap.near? Read once before a wrap; a failed read is false. */
export async function wrapRegistered(view: (contract: string, method: string, args: Record<string, unknown>) => Promise<unknown>, accountId: string): Promise<boolean> {
  try {
    return isRegisteredRead(await view("wrap.near", "storage_balance_of", { account_id: accountId }));
  } catch {
    return false;
  }
}

/** Storage on a coin contract for `accountId`, so a transfer of that coin to it isn't refused. Refunded if already paid. */
export function registerOn(o: { contract: string; accountId: string; yocto: string; why: string }): TxRequest {
  // Every storage deposit goes through here: a send, a convert, a move to Private, an Add (audit W-7).
  if (!/^\d{1,30}$/.test(o.yocto) || BigInt(o.yocto) > MAX_STORAGE_DEPOSIT_YOCTO) throw new ProblemError(walletProblems.storageTooHigh());
  return ask({
    receiverId: o.contract,
    actions: [{ kind: "call", method: "storage_deposit", args: { account_id: o.accountId, registration_only: true }, depositYocto: o.yocto, gas: gas(10) }],
    why: o.why,
  });
}
