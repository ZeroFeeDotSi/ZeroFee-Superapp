// Coin contracts and staking pools, in plain words, and the one payment the core refuses outright: plain NEAR sent to
// a staking pool. A pool shares such NEAR out as a reward to everyone who stakes there, so the sender loses it.
//
// Coins are recognised by contract name (a short list, plus NEAR Intents' bridged *.omft.near coins). Staking pools
// are recognised only by the code they run: NEAR's standard staking pool, checked by code hash on two nodes. Anything
// else stays an unknown contract, with its warning.
import { codeOf } from "./chain.ts";
import type { Block, Chain } from "./chain.ts";
import { formatAmount } from "./format.ts";
import { coinShort } from "./coin-short.ts";
import type { Described } from "./format.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { readable, type Warning } from "./signer.ts";
import { isAccountId } from "./tx-build.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";

/** NEAR's standard staking pool (near/core-contracts), the only pool code ZeroFee describes. */
export const STAKING_POOL_CODE_HASH = "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY";

/** Coin contracts the sheet describes by name. wNEAR is NEAR in a form contracts and NEAR Intents can hold. */
const KNOWN_COINS = new Set([
  "wrap.near",
  "wrap.testnet",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "usdt.tether-token.near",
]);
const isKnownCoin = (contract: string) => KNOWN_COINS.has(contract) || /^[a-z0-9-]+\.omft\.near$/.test(contract);
const INTENTS = "intents.near";

export interface CoinFacts {
  /** Receivers that run the standard staking pool, with the pool's fee now (percent). */
  pools: Map<string, { feePercent: number | null }>;
  /** Coin contract → symbol and decimals, from ft_metadata on two nodes. */
  coins: Map<string, { symbol: string; decimals: number }>;
}

const units = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : null);

function argsOf(a: DecodedAction): Record<string, any> | null {
  if (a.kind !== "call") return null;
  if (a.args.length === 0) return {};
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(a.args));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Read what the words need for this receiver: is it a staking pool (and its fee), or a coin (and its symbol)? */
export async function gatherCoinFacts(tx: DecodedTx, chain: Chain, block: Block): Promise<CoinFacts> {
  const facts: CoinFacts = { pools: new Map(), coins: new Map() };
  if (tx.receiverId === tx.signerId) return facts;
  const receiver = await chain.account(tx.receiverId, block);
  if (codeOf(receiver) === STAKING_POOL_CODE_HASH) {
    const fee = (await chain.view(tx.receiverId, "get_reward_fee_fraction", {}, block)) as { numerator?: number; denominator?: number } | null;
    const feePercent = fee && Number(fee.denominator) > 0 ? (Number(fee.numerator) / Number(fee.denominator)) * 100 : null;
    facts.pools.set(tx.receiverId, { feePercent });
  } else if (isKnownCoin(tx.receiverId) && tx.actions.some((a) => a.kind === "call")) {
    const m = (await chain.view(tx.receiverId, "ft_metadata", {}, block)) as { symbol?: unknown; decimals?: unknown } | null;
    const symbol = typeof m?.symbol === "string" ? m.symbol.replace(/[^\p{L}\p{N}.$_-]/gu, "").slice(0, 16) : "";
    if (symbol && Number.isInteger(m?.decimals) && Number(m!.decimals) <= 36) facts.coins.set(tx.receiverId, { symbol, decimals: Number(m!.decimals) });
  }
  return facts;
}

/**
 * Whom a coin put into NEAR Intents is credited to (ft_transfer_call to intents.near, by its msg), or null when ZeroFee
 * can't tell (audit, core integrity 2). An empty msg credits the sender; a plain NEAR account credits that account; a
 * JSON msg credits its receiver_id, and only a msg with nothing else in it but refund_if_fails and an empty
 * execute_intents is read: intents to run could do anything with the coin, and any other field is unknown.
 */
export function intentsDepositFor(msg: unknown, signerId: string): string | null {
  if (msg === "") return signerId;
  if (typeof msg !== "string") return null;
  if (!msg.trimStart().startsWith("{")) return isAccountId(msg) ? msg : null;
  let m: unknown;
  try {
    m = JSON.parse(msg);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  const known = Object.keys(o).every((k) => k === "receiver_id" || (k === "refund_if_fails" && typeof o[k] === "boolean") || (k === "execute_intents" && Array.isArray(o[k]) && (o[k] as unknown[]).length === 0));
  return known && isAccountId(o.receiver_id) ? o.receiver_id : null;
}

/** Plain NEAR sent to a staking pool is lost to the sender, so it is never signed. Nor is a coin put into NEAR Intents
 *  for someone ZeroFee can't name (intentsDepositFor). */
export function checkCoins(tx: DecodedTx, facts: CoinFacts): void {
  if (facts.pools.has(tx.receiverId) && tx.actions.some((a) => a.kind === "transfer")) {
    throw new ProblemError(securityProblems.requestNotAllowed("Money sent to a staking pool isn't yours any more. Stake it instead."));
  }
  for (const a of tx.actions) {
    const args = argsOf(a);
    if (a.kind !== "call" || a.method !== "ft_transfer_call" || args?.receiver_id !== INTENTS) continue;
    if (intentsDepositFor(args.msg, tx.signerId) === null) throw new ProblemError(securityProblems.requestNotAllowed("ZeroFee can't tell who this money is for, so it signed nothing."));
  }
}

/**
 * An account as the person knows it (mainnet rehearsal, 3 Nov: "Let <64-hex> hold USDC"): the signer's own balance, one
 * of their own wallets by its name (the core's own list), or a NEAR account with no name shortened, its whole id in the
 * sheet's disclosure. A named account is its name.
 */
export function accountWords(id: string, tx: DecodedTx, own: ReadonlyMap<string, string> | undefined, ownBalance: string): { text: string; full?: string } {
  if (id === tx.signerId) return { text: ownBalance };
  const mine = own?.get(id);
  if (mine) return { text: mine };
  return /^[0-9a-f]{64}$/.test(id) ? { text: `the NEAR account ${id.slice(0, 6)}…${id.slice(-4)}`, full: id } : { text: id };
}

/**
 * Plain words for one call on a staking pool or a known coin, or null to fall back to the generic words. `ownBalance`:
 * the signer's balance inside NEAR Intents as the person knows it (intents.ts signerBalance), where a deposit lands.
 * `own`: the person's own wallets by address (the core's own list), so a step for one names it.
 */
export function describeCoinCall(a: DecodedAction, tx: DecodedTx, facts: CoinFacts, ownBalance = "your Safe", own?: ReadonlyMap<string, string>): Described | null {
  const args = argsOf(a);
  if (a.kind !== "call" || !args) return null;
  const near = (yocto: bigint) => `${formatAmount(yocto, 24)} NEAR`;
  // Each step leads with its own line, so in a transaction of several steps none hides behind the first one's title.
  // (A single step's sheet drops the line that repeats its title.)
  const said = (title: string, lines: string[], warnings: Warning[] = [], full?: string): Described => ({ title, lines: [title, ...lines], warnings, ...(full ? { details: [{ label: "The account in full", lines: [full] }] } : {}) });

  const pool = facts.pools.get(tx.receiverId);
  if (pool) {
    const p = tx.receiverId;
    const fee = pool.feePercent === null ? "NEAR didn't give its fee right now." : `Its fee is ${+pool.feePercent.toFixed(2)}% now; it can raise it at any time.`;
    switch (a.method) {
      case "deposit_and_stake":
        return said(`Stake ${near(a.depositYocto)} with ${p}`, [fee]);
      case "unstake": {
        const amount = units(args.amount);
        if (amount === null) return null;
        return said(`Ask ${p} for ${near(amount)} back`, ["It stops earning. You can take it out after about a day."]);
      }
      case "unstake_all":
        return said(`Ask ${p} for all your staked NEAR back`, ["It stops earning. You can take it out after about a day."]);
      case "withdraw": {
        const amount = units(args.amount);
        if (amount === null) return null;
        return said(`Take ${near(amount)} out of ${p}`, ["It comes back into your account."]);
      }
      case "withdraw_all":
        return said(`Take your unstaked NEAR out of ${p}`, ["It comes back into your account."]);
      default:
        return said(`Use the staking pool ${p}`, [`With: ${JSON.stringify(args)}`], [{ kind: "effect-unknown", text: "ZeroFee can't tell what this step does." }]);
    }
  }

  const coin = facts.coins.get(tx.receiverId);
  if (!coin) return null;
  const money = (v: bigint) => `${formatAmount(v, coin.decimals)} ${coin.symbol}`;
  switch (a.method) {
    case "near_deposit":
      return said(`Turn ${near(a.depositYocto)} into ${coin.symbol}`, [`${coin.symbol} is NEAR in a form your Safe can hold. Same amount.`]);
    case "near_withdraw": {
      const amount = units(args.amount);
      return amount === null ? null : said(`Turn ${money(amount)} back into NEAR`, ["It comes back into your account as NEAR."]);
    }
    case "storage_deposit": {
      // the coin by its name and the account by the person's words, never their ids (the contract's is on the explorer)
      // the account itself holds the coin here (not its balance inside NEAR Intents): "your account"
      const who = typeof args.account_id === "string" && args.account_id !== tx.signerId ? accountWords(args.account_id, tx, own, ownBalance) : { text: "your account" };
      return said(`Let ${who.text} hold ${coin.symbol}`, [`It costs ${coinShort(a.depositYocto, 24, "up").text} NEAR, and that comes back later.`], [], who.full);
    }
    case "ft_transfer": {
      const amount = units(args.amount);
      if (amount === null || typeof args.receiver_id !== "string") return null;
      const who = accountWords(args.receiver_id, tx, own, ownBalance);
      return said(`Send ${money(amount)} to ${who.text}`, typeof args.memo === "string" && args.memo ? [`Note: ${readable(args.memo)}`] : [], [], who.full);
    }
    case "ft_transfer_call": {
      const amount = units(args.amount);
      if (amount === null || typeof args.receiver_id !== "string") return null;
      if (args.receiver_id === INTENTS) {
        // the account it credits, never the raw msg (checkCoins refused one ZeroFee can't read)
        const to = intentsDepositFor(args.msg, tx.signerId);
        if (to === tx.signerId) return said(`Put ${money(amount)} into ${ownBalance}`, [`It joins ${ownBalance}.`]);
        if (to !== null) {
          const who = accountWords(to, tx, own, ownBalance);
          return said(`Send ${money(amount)} to ${who.text}`, [`Only ${who.text} can take it out.`], [], who.full);
        }
      }
      const warnings: Warning[] = [{ kind: "effect-unknown", text: `ZeroFee can't tell what ${args.receiver_id} will do with it.` }];
      return said(`Send ${money(amount)} to ${args.receiver_id}, and ask it to act on it`, [`With: ${JSON.stringify(args.msg ?? "")}`], warnings);
    }
    default:
      return null;
  }
}
