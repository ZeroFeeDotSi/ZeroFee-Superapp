// How a coin leaves, unchanged: which transactions, how much arrives, how much leaves, and the fee. Pure: every number
// it needs is read beforehand (two nodes, one block), so every route is tested without a network.
//
//   to someone's ledger balance   mt_transfer (from the ledger), or ft_transfer_call / wrap-and-deposit (from the account);
//                                 with a `msg`, mt_transfer_call from the ledger only, so the receiver can act on it
//   to a NEAR account             plain NEAR from the account; a NEAR coin by ft_withdraw (ledger) or ft_transfer (account),
//                                 after paying the receiver's storage on that coin when it has none (a second approval)
//   to its own chain              a bridged *.omft.near coin by ft_withdraw home; the bridge's fee is on top, so the
//                                 receiver gets the amount exactly
// Anything else (a different chain, a HOT or Omni coin out of the ledger) is refused with a Problem: convert first.
import { ProblemError } from "@zerofee/core/problem";
import type { TxRequest } from "@zerofee/core/signer";
import { fromUnits, toUnits } from "./amount.ts";
import { validAddress } from "./addresses.ts";
import { NATIVE_NEAR, NEAR_DECIMALS, WRAPPED_NEAR, type Catalogue } from "./catalogue.ts";
import { ftIntoLedgerOf, ftTransfer, mtTransfer, mtTransferCall, nearIntoLedger, registerOn, sendNear, withdrawHome, withdrawToNear } from "./moves.ts";
import type { Payee } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";

export const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** How much of one coin the account has, in the smallest unit. For NEAR itself, `account` is what can be spent. */
export interface Holding {
  ledger: bigint;
  account: bigint;
}

export interface SendInput {
  cat: Catalogue;
  me: string;
  tokenId: string;
  /** What arrives, in the coin's units. */
  amount: string;
  to: Payee;
  held: Holding;
  /** NEAR on the account that can be spent (storage and the fee reserve left out). */
  nearSpendable: bigint;
  /** For a coin sent to a NEAR account: whether the receiver already has storage on its contract, and the price. */
  storage?: { registered: boolean; yocto: string };
  /** Carried on-chain with a transfer, for the receiver. */
  memo?: string;
  /** For the receiver to act on (mt_transfer_call): it keeps what it accepts and the rest comes straight back. */
  msg?: string;
  why: string;
}

export interface SendPlan {
  steps: TxRequest[];
  arrives: bigint;
  leaves: bigint;
  fee: bigint;
  tokenId: string;
  symbol: string;
  decimals: number;
  priceUsd?: string;
  /** A bridge withdraw: it finishes on the far chain a little later. */
  viaBridge: boolean;
  /** An mt_transfer_call: what the receiver kept is read from the transaction afterwards. */
  call: boolean;
  /** Where it goes, as a person would read it. */
  to: string;
}

const fail = (p: ReturnType<(typeof walletProblems)[keyof typeof walletProblems]>): never => {
  throw new ProblemError(p);
};

export function planSend(i: SendInput): SendPlan {
  const native = i.tokenId === NATIVE_NEAR;
  const coin = native ? null : i.cat.coin(i.tokenId);
  if (!native && !coin) fail(walletProblems.routeUnavailable("This coin"));
  const symbol = native ? "NEAR" : coin!.symbol;
  const decimals = native ? NEAR_DECIMALS : coin!.decimals;
  const units = toUnits(i.amount, decimals);
  if (units === null || units <= 0n) fail(walletProblems.amountInvalid());
  const arrives = units!;
  const base = { arrives, tokenId: i.tokenId, symbol, decimals, priceUsd: native ? i.cat.coin(WRAPPED_NEAR)?.priceUsd : coin!.priceUsd };
  const short = (n: bigint) => fromUnits(n, decimals);
  const need = (have: bigint, total: bigint) => {
    if (have < total) fail(walletProblems.balanceLow(short(total), symbol));
  };

  // Into someone's ledger balance: instant, no fee but the network's.
  if (i.to.kind === "ledger") {
    const owner = i.to.accountId.trim();
    if (!ACCOUNT_ID.test(owner)) fail(walletProblems.recipientInvalid());
    if (owner === i.me) fail(walletProblems.recipientSelf());
    const plan = { ...base, leaves: arrives, fee: 0n, viaBridge: false, call: false, to: owner };
    if (i.msg !== undefined) {
      // intents.near tells the receiver, so the coins must already be in the ledger: moving them in from the account
      // first would be a second transaction, and the two don't fit in one approval's gas.
      if (native || i.held.ledger < arrives) fail(walletProblems.balanceLow(short(arrives), symbol));
      return { ...plan, call: true, steps: [mtTransferCall({ to: owner, tokenId: i.tokenId, units: arrives, memo: i.memo, msg: i.msg, why: i.why })] };
    }
    if (native) {
      need(i.nearSpendable, arrives);
      return { ...plan, steps: [nearIntoLedger({ accountId: i.me, yocto: arrives, owner, why: i.why })] };
    }
    if (i.held.ledger >= arrives) return { ...plan, steps: [mtTransfer({ to: owner, tokenId: i.tokenId, units: arrives, memo: i.memo, why: i.why })] };
    if (coin!.route === "near" && i.held.account >= arrives) {
      return { ...plan, steps: [ftIntoLedgerOf({ contract: i.tokenId.slice("nep141:".length), owner, units: arrives, memo: i.memo, why: i.why })] };
    }
    return fail(walletProblems.balanceLow(short(arrives), symbol));
  }

  const chain = i.to.chain;
  const address = i.to.address.trim();
  const network = i.cat.network(chain);
  const chainName = network?.name ?? chain;

  // To a NEAR account.
  if (chain === "near") {
    if (!ACCOUNT_ID.test(address)) fail(walletProblems.recipientInvalid());
    if (i.to.memo) fail(walletProblems.memoUnsupported("NEAR"));
    // the sender's own account is never a payee, whatever the coin (core hunt 5 Nov, QA: USDC to oneself was
    // planned as a withdraw to oneself while NEAR was refused): the same refusal as NEAR and a ledger transfer
    if (address === i.me) fail(walletProblems.recipientSelf());
    const plan = { ...base, leaves: arrives, fee: 0n, viaBridge: false, call: false, to: address };
    // NEAR to a NEAR account is always plain NEAR from the account (never wrapped NEAR out of the ledger).
    if (native || i.tokenId === WRAPPED_NEAR) {
      need(i.nearSpendable, arrives);
      return { ...plan, tokenId: NATIVE_NEAR, steps: [sendNear({ to: address, yocto: arrives, why: i.why })] };
    }
    if (coin!.route !== "near") fail(walletProblems.routeUnavailable(symbol));
    const contract = i.tokenId.slice("nep141:".length);
    const steps: TxRequest[] = [];
    if (i.storage && !i.storage.registered) steps.push(registerOn({ contract, accountId: address, yocto: i.storage.yocto, why: `Let ${address} receive ${symbol}` }));
    if (i.held.ledger >= arrives) steps.push(withdrawToNear({ contract, receiverId: address, units: arrives, memo: i.memo, why: i.why }));
    else if (i.held.account >= arrives) steps.push(ftTransfer({ contract, to: address, units: arrives, memo: i.memo, why: i.why }));
    else fail(walletProblems.balanceLow(short(arrives), symbol));
    return { ...plan, steps };
  }

  // Home to its own chain: only bridged *.omft.near coins, only to their own chain.
  if (native || coin!.route !== "poa" || coin!.chain !== chain || !coin!.bridge) fail(walletProblems.routeUnavailable(symbol));
  if (!validAddress(chain, address)) fail(walletProblems.addressInvalid(chainName));
  const tag = i.to.memo?.trim();
  if (tag && !(chain === "xrp" && /^\d{1,10}$/.test(tag))) fail(walletProblems.memoUnsupported(chainName));
  const bridge = coin!.bridge!;
  if (arrives < bridge.minWithdraw) fail(walletProblems.belowMinimum(short(bridge.minWithdraw), symbol));
  // The bridge's fee is its own number (audit W-6): it must be less than what arrives, so at most half of what leaves is
  // ever fee. A fee that big is either a send too small to be worth it or a wrong table; either way nothing goes.
  if (bridge.withdrawFee < 0n || bridge.withdrawFee >= arrives) fail(walletProblems.feeTooHigh(short(bridge.withdrawFee), symbol));
  const leaves = arrives + bridge.withdrawFee;
  need(i.held.ledger, leaves);
  return {
    ...base,
    leaves,
    fee: bridge.withdrawFee,
    viaBridge: true,
    call: false,
    to: `${address} on ${chainName}`,
    steps: [withdrawHome({ contract: i.tokenId.slice("nep141:".length), address, tag, units: leaves, why: i.why })],
  };
}
