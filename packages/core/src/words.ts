// Decoded transaction → PlainWords, the words on the approval sheet.
//
// Everything here comes from the decoded bytes (tx-decode.ts) and from facts two nodes agreed on (balance, gas price).
// The asking app's own description is only passed through as `hint`. Every step gets its own line, so nothing in the
// transaction is hidden behind a summary.
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase58 } from "@fastnear/utils";
import type { Network, PlainWords, Warning } from "./signer.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";
import { ACCOUNT_POLICY, RECOVERY_POLICY, ownAccountCall } from "./known-contracts.ts";
import { dollarsFirstTitle, dollarWords, formatAmount, formatNear, formatNearShort, shortKey, Unnamed } from "./format.ts";
import type { Described } from "./format.ts";
import { describeModuleCall } from "./account-modules.ts";
import type { ModuleFacts } from "./account-modules.ts";
import { describeCoinCall, intentsDepositFor } from "./coins.ts";
import { endsTitle, swapEnds } from "./onward-ends.ts";
import type { CoinFacts } from "./coins.ts";
import { INTENTS, describeIntentsCall, nep141Contract, signerBalance } from "./intents.ts";
import type { IntentsFacts } from "./intents.ts";

export { dollarsFirstTitle, dollarWords, formatNear, formatNearShort, shortKey, titleMoney } from "./format.ts";

export interface WordsContext {
  network: Network;
  /** One group of a chained approval (plainWordsMany): never the one-step bare form. */
  many?: boolean;
  /** The account's NEAR balance in yocto, as two nodes agreed. */
  balanceYocto: bigint;
  /** The NEAR the person can use (near-available.ts: less storage and the fee reserve), the same figure the Safe shows.
   *  The sheet's NEAR line counts from it (grade 01c, P6); without it, from the balance. */
  availableYocto?: bigint;
  /** Gas price in yocto per gas, as two nodes agreed. */
  gasPriceYocto: bigint;
  /** Accounts this device has sent to before. */
  knownRecipients: ReadonlySet<string>;
  /** `knownRecipients` holds the account's own record from the chain too (any device, before a restore): the warning
   *  then says "before", never only "from this device before". */
  recipientsFromChain?: boolean;
  /** What the NEAR Intents words need (mainnet), gathered before the words are written. */
  intents?: IntentsFacts;
  /** Staking pools and coin contracts this transaction calls (two nodes). */
  coins?: CoinFacts;
  /** Legacy and Agent on an account running the account contract v3 (two nodes). */
  modules?: ModuleFacts;
  /** The transaction actually signed, when the words describe the steps inside it (the account contract's execute):
   *  the fee bound is computed from it, so "at most" stays true. */
  feeFrom?: DecodedTx;
  hint?: string;
  /** The asking app's words for where the money goes on after this signature (TxRequest.onward), "Wallet says: …": the
   *  sheet's last line, smaller, on every form of the sheet, the bare one too. */
  onward?: string;
  /** NEAR in dollars, for the sheet's words only (the fee and the protection's limits in $, D8); never for signing. */
  nearUsd?: number | null;
  /** The sheet's coins it can't name (format.ts), shared by every group of one approval; plainWords makes its own. */
  unnamed?: Unnamed;
}

/** A fee in dollars, rounded up to the cent: "about $0.02", or "under $0.01". */
export function feeUsd(yocto: bigint, nearUsd: number): string {
  const usd = (Number(yocto / 10n ** 16n) / 1e8) * nearUsd;
  return usd < 0.01 ? "under $0.01" : `about $${(Math.ceil(usd * 100) / 100).toFixed(2)}`;
}

/** Coins the sheet counts at $1 each, whatever a list says (audit NF-09): USDC and USDT on NEAR. */
const DOLLAR_COINS = new Set(["17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "usdt.tether-token.near"]);

/** NEAR's own wNEAR contracts: near_deposit there wraps the signer's NEAR into the signer's wNEAR. */
const WRAP_CONTRACTS = new Set(["wrap.near", "wrap.testnet"]);

/** What one step pays or sends: the coin amount as said, and its dollars (null with no price; exact for a dollar coin). */
/** `dollar`: the coin is a dollar coin by its contract (DOLLAR_COINS), never by its symbol: a fake "USDC" never has it. */
export interface Paid { coin: string; usd: number | null; exact: boolean; dollar?: true }

const unitsOf = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : null);
const asNumber = (units: bigint, decimals: number) => Number(formatAmount(units, decimals).replace(/,/g, ""));
/** A step that may move something out whose dollars can't be said: the whole sheet then says no dollar figure. */
const UNPRICED: Paid = { coin: "", usd: null, exact: false };

/**
 * The payment in one step, from the decoded bytes: NEAR sent, staked or attached to a call, or a coin sent by its own
 * contract or out of NEAR Intents. Its dollars: NEAR (and wNEAR) at the sheet's price, a dollar coin at $1, a 1Click
 * payment at the dollars its signed quote says. A step that moves nothing out (the account's own rules) pays nothing.
 * A step that may move something out that can't be read or priced here is UNPRICED, so the sheet says no dollar figure
 * at all rather than the sum of the other steps (security review 2 Nov: "Amount: $1.00 (1 USDC)" over an mt_transfer
 * of 1 USDC beside an mt_batch_transfer of 10,000 USDC to someone else).
 */
function paidIn(a: DecodedAction, tx: DecodedTx, ctx: WordsContext): Paid | null {
  const price = ctx.nearUsd && ctx.nearUsd > 0 ? ctx.nearUsd : null;
  const near = (yocto: bigint): Paid => ({ coin: `${formatNear(yocto)} NEAR`, usd: price === null ? null : asNumber(yocto, 24) * price, exact: false });
  if (a.kind === "transfer" || a.kind === "stake") return a.yocto > 0n && tx.receiverId !== tx.signerId ? near(a.yocto) : null;
  if (a.kind !== "call" || tx.receiverId === tx.signerId) return null;
  let args: Record<string, unknown> = {};
  try {
    args = a.args.length ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(a.args)) ?? {} : {};
  } catch {
    args = {};
  }
  const coinPaid = (contract: string | null, amount: unknown, to: unknown): Paid => {
    const n = unitsOf(amount);
    const info = contract ? ctx.coins?.coins.get(contract) ?? ctx.intents?.tokens.get(contract) : undefined;
    if (!contract || n === null || !info) return UNPRICED;
    const value = asNumber(n, info.decimals);
    // A 1Click quote's dollars only for the step checkIntents matched to it (its method, its exact amount in): never for
    // another step to the same deposit address (an mt_transfer_call, an ft_transfer_call) the quote doesn't cover.
    const quote = typeof to === "string" && (a.method === "mt_transfer" || a.method === "ft_withdraw" || a.method === "ft_transfer") ? ctx.intents?.quotes.get(to) : undefined;
    const quoted = quote && quote.amountIn === String(amount) ? quote.amountInUsd : undefined;
    const fromQuote = quoted !== undefined && quoted !== "" && Number.isFinite(Number(quoted)) && Number(quoted) >= 0;
    const usd = fromQuote ? Number(quoted) : DOLLAR_COINS.has(contract) ? value : contract === "wrap.near" && price !== null ? value * price : null;
    return { coin: `${formatAmount(n, info.decimals)} ${info.symbol}`, usd, exact: !fromQuote && DOLLAR_COINS.has(contract), ...(DOLLAR_COINS.has(contract) ? { dollar: true as const } : {}) };
  };
  if ((a.method === "ft_transfer" || a.method === "ft_transfer_call") && (ctx.coins?.coins.has(tx.receiverId) || ctx.intents?.tokens.has(tx.receiverId))) return coinPaid(tx.receiverId, args.amount, args.receiver_id);
  if (tx.receiverId === INTENTS.account && (a.method === "mt_transfer" || a.method === "mt_transfer_call")) {
    return coinPaid(typeof args.token_id === "string" ? nep141Contract(args.token_id) : null, args.amount, args.receiver_id);
  }
  if (tx.receiverId === INTENTS.account && a.method === "ft_withdraw") return coinPaid(typeof args.token === "string" ? args.token : null, args.amount, args.receiver_id);
  // Any other call on NEAR Intents can move the account's coins there (mt_batch_transfer, a withdrawal of another kind).
  if (tx.receiverId === INTENTS.account) return UNPRICED;
  // Wrapping NEAR into wNEAR at wrap.near itself credits the signer's own wNEAR: nothing leaves, and the wNEAR step that
  // follows is the payment. Counting both said "$12.00 (1.467 NEAR and 1.467 wNEAR)" over a $6 Move (finding 16).
  if (a.method === "near_deposit" && WRAP_CONTRACTS.has(tx.receiverId)) return null;
  // NEAR attached to some other call (not a coin's 1-yocto security deposit, nor a storage fee): it is paid to that contract.
  if (a.depositYocto >= 10n ** 21n) return a.method !== "storage_deposit" ? near(a.depositYocto) : null;
  // A small deposit (1 yocto) is how a coin, NFT or multi-token contract confirms moving what the account holds there
  // (an unknown coin's ft_transfer, an nft_transfer): what moves can't be priced here.
  return a.depositYocto > 0n && a.method !== "storage_deposit" ? UNPRICED : null;
}

/**
 * The coin figure alone when one dollar coin is paid and its dollars say the very same number, to the cent: "Move 5.20
 * USDC to your SOL wallet", never "Move $5.20 (5.20 USDC)", one number said twice (QA's crawl, 5 Nov; the
 * Copywriter). Every digit of the coin figure stays. A dollar coin off its dollar ("$5.19 (5.20 USDC)"), a coin whose
 * figure has more than cents, or a coin only named like one keeps the dollars in front: null.
 */
export function dollarTwin(paid: readonly (Paid | null)[]): string | null {
  const all = paid.filter((p): p is Paid => p !== null);
  const p = all.length === 1 ? all[0]! : undefined;
  if (!p?.dollar || p.usd === null) return null;
  const figure = Number(p.coin.slice(0, p.coin.indexOf(" ")).replace(/,/g, ""));
  const cents = Math.round(figure * 100);
  return Number.isFinite(figure) && Math.abs(figure * 100 - cents) < 1e-6 && Math.round(p.usd * 100) === cents ? p.coin : null;
}

/** The sheet's amount from every step's payment: "about $0.04 (0.01 NEAR)"; nothing when a payment can't be priced. */
export function amountWords(paid: readonly (Paid | null)[]): string | undefined {
  const all = paid.filter((p): p is Paid => p !== null);
  if (all.length === 0 || all.some((p) => p.usd === null)) return undefined;
  const usd = all.reduce((sum, p) => sum + (p.usd ?? 0), 0);
  return `${dollarWords(usd, all.every((p) => p.exact))} (${all.map((p) => p.coin).join(" and ")})`;
}

/** The asking app's words, unless they only say the title again ("Wallet says: Send 0.01 NEAR to x" under "Send 0.01
 *  NEAR to x", grade 02g, E16). */
function hintFor(hint: string | undefined, title: string, coinTitle = title): string | undefined {
  if (!hint) return undefined;
  const bare = (t: string) => t.replace(/^.{1,40}? says: /, "").replace(/[.\s]+$/, "").trim().toLowerCase();
  return bare(hint) === bare(title) || bare(hint) === bare(coinTitle) ? undefined : hint;
}

/** Rough upper bound of NEAR's own cost per step, on top of any gas attached to calls. */
const GAS_PER_STEP = 5_000_000_000_000n;
const GAS_PER_CODE_BYTE = 10_000_000n;

/** The most this transaction can cost in fees: all gas it could burn, at twice the agreed gas price (NEAR's buffer). */
export function maxFeeYocto(tx: DecodedTx, gasPriceYocto: bigint): bigint {
  let gas = 0n;
  for (const a of tx.actions) {
    gas += GAS_PER_STEP;
    if (a.kind === "call") gas += a.gas;
    if (a.kind === "deploy") gas += BigInt(a.code.length) * GAS_PER_CODE_BYTE;
  }
  return gas * gasPriceYocto * 2n;
}

/** NEAR that leaves the account directly (transfers, deposits attached to calls, stake). */
export function outgoingYocto(tx: DecodedTx): bigint {
  return tx.actions.reduce((sum, a) => sum + (a.kind === "transfer" || a.kind === "stake" ? a.yocto : a.kind === "call" ? a.depositYocto : 0n), 0n);
}

function readableArgs(args: Uint8Array): string | null {
  if (args.length === 0) return "";
  try {
    return JSON.stringify(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(args)));
  } catch {
    return null;
  }
}

function describeAction(a: DecodedAction, tx: DecodedTx, ctx: WordsContext, unnamed: Unnamed): Described {
  const self = tx.receiverId === tx.signerId;
  const keyChange = (text: string): Warning => ({ kind: "key-change", text });
  switch (a.kind) {
    case "transfer":
      // its first-time warning is plainWords' (firstTimeWarnings), the same for NEAR and every coin
      return { title: `Send ${formatNear(a.yocto)} NEAR to ${tx.receiverId}`, lines: [`Send ${formatNear(a.yocto)} NEAR to ${tx.receiverId}`], warnings: [] };
    case "call": {
      const intents = ctx.intents && describeIntentsCall(a, tx, ctx.intents, unnamed);
      if (intents) return intents;
      // finding 61 (a real-money test, 4 Nov): a 1Click deposit account the core checked the quote of is "the swap service" here too
      // (its send line says so), never "the NEAR account 1d06c0…f137"
      const deposits = ctx.intents?.quotes.size ? [...ctx.intents.quotes.keys()].map((k): [string, string] => [k, SWAP_SERVICE]) : [];
      const named = deposits.length ? new Map([...deposits, ...(ctx.intents?.ownWallets ?? [])]) : ctx.intents?.ownWallets;
      const coin = ctx.coins && describeCoinCall(a, tx, ctx.coins, signerBalance(tx, ctx.intents), named);
      if (coin) return coin;
      const module = ctx.modules && describeModuleCall(a, tx, ctx.modules, unnamed);
      if (module) return module;
      const json = readableArgs(a.args);
      const pay = a.depositYocto > 0n ? [`Pay ${formatNear(a.depositYocto)} NEAR to ${tx.receiverId} with it`] : [];
      if (self) {
        const known = ownAccountCall(a.method, json ? JSON.parse(json || "{}") : null, ctx.nearUsd);
        if (known) return { title: known.title, lines: [...known.lines, ...pay], warnings: known.warnings ?? [], ...(known.heldYocto ? { heldYocto: known.heldYocto } : {}), ...(known.details ? { details: known.details } : {}) };
      }
      const lines = [`Ask ${tx.receiverId} to do a step ZeroFee can't name`];
      if (json) lines.push(`With: ${json}`);
      else if (json === null) lines.push("With extra details ZeroFee can't read");
      return {
        title: `Use ${tx.receiverId}`,
        lines: [...lines, ...pay],
        details: [{ label: "Details", lines: [`Method: ${a.method}`] }],
        warnings: [
          { kind: "unknown-contract", text: `ZeroFee doesn't know ${tx.receiverId}. Only go on if you trust it.` },
          { kind: "effect-unknown", text: `ZeroFee can't tell what ${tx.receiverId} will do. It can move coins you hold there.` },
        ],
      };
    }
    case "add-key": {
      const p = a.permission;
      const key = shortKey(a.publicKey.handle);
      const classical = a.publicKey.type !== "ml-dsa-65" ? [keyChange("This is an older kind of key. A future quantum computer could break it.")] : [];
      if (p.kind === "full") {
        return {
          title: "Give a new key full control of your account",
          lines: ["Give full control of your account to a new key"],
          warnings: [keyChange("This changes who controls your account."), ...classical],
          details: [{ label: "Details", lines: [`Key: ${key}`] }],
        };
      }
      const isRecoveryKey =
        p.receiverId === tx.signerId && p.methods.length === RECOVERY_POLICY.recoveryKeyMethods.length && p.methods.every((m, i) => m === RECOVERY_POLICY.recoveryKeyMethods[i]);
      const fees = p.allowanceYocto === null ? "It can spend any amount of NEAR on fees." : `It can spend at most ${formatNear(p.allowanceYocto)} NEAR, on fees only.`;
      if (isRecoveryKey) {
        return {
          title: "Add your backup words to your account",
          lines: [
            "Add the key made from your 24 words",
            "It can only start moving your account to a new device. That has to wait, and this device can stop it.",
            `It can't send money. ${fees}`,
          ],
          warnings: [keyChange("This adds a key to your account."), ...classical],
          details: [{ label: "Details", lines: [`Key: ${key}`] }],
        };
      }
      return {
        title: "Add a limited key to your account",
        lines: [`Add a limited key. It can only ask ${p.receiverId} to do ${p.methods.length ? (p.methods.length === 1 ? "one thing" : `${p.methods.length} things`) : "anything"}`, fees],
        warnings: [keyChange("This adds a key to your account."), ...classical],
        details: [{ label: "Details", lines: [`Key: ${key}`, ...(p.methods.length ? [`Methods: ${p.methods.join(", ")}`] : [])] }],
      };
    }
    case "delete-key":
      return {
        title: "Remove a key from your account",
        lines: ["Remove this key. It can never approve for your account again."],
        warnings: [keyChange("This changes who controls your account.")],
        details: [{ label: "Details", lines: [`Key: ${shortKey(a.publicKey.handle)}`] }],
      };
    case "deploy": {
      const hex = Array.from(sha256(a.code), (b) => b.toString(16).padStart(2, "0")).join("");
      // the old recovery-only contract (RECOVERY_POLICY: legacy, unsafe, never installed now): named as old
      const ours = hex === RECOVERY_POLICY.sha256Hex;
      return {
        title: ours ? "Put old recovery rules on your account" : "Put new rules on your account",
        lines: [`Put ${ours ? "ZeroFee's old recovery rules" : "code ZeroFee doesn't know"} on your account`],
        warnings: [keyChange("This changes your account's rules."), ...(ours ? [{ kind: "unknown-contract" as const, text: "These rules are old and not safe. ZeroFee doesn't use them now." }] : [])],
        details: [{ label: "Details", lines: [`Size: ${Math.ceil(a.code.length / 1024)} KB`, `Fingerprint: ${hex.slice(0, 8)}`] }],
      };
    }
    case "use-global": {
      const hash = toBase58(a.codeHash);
      const ours = hash === ACCOUNT_POLICY.codeHashBase58;
      return {
        title: ours ? "Put ZeroFee's rules on your account" : "Put new rules on your account",
        lines: [`Use the network's published copy of ${ours ? "ZeroFee's account rules" : "code ZeroFee doesn't know"}`],
        warnings: [keyChange("This changes your account's rules.")],
        details: [{ label: "Details", lines: [`Fingerprint: ${hash.slice(0, 8)}`] }],
      };
    }
    case "delete-account":
      return {
        title: "Delete your account",
        lines: [`Delete your account. Everything in it goes to ${a.beneficiaryId}.`],
        warnings: [keyChange("This deletes your account.")],
      };
    case "create-account":
      return { title: `Create the account ${tx.receiverId}`, lines: [`Create the account ${tx.receiverId}`], warnings: [] };
    case "stake":
      return { title: `Stake ${formatNear(a.yocto)} NEAR`, lines: [`Lock ${formatNear(a.yocto)} NEAR for staking`], warnings: [] };
  }
}

const jsonArgs = (a: DecodedAction | { kind: string; args?: Uint8Array }): Record<string, unknown> => {
  if (a.kind !== "call" || !a.args?.length) return {};
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(a.args));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
/** What the sheet knows about where a 1Click quote pays and the account's own wallets (none: every receiver is a person). */
export interface SendFacts { quotes?: ReadonlyMap<string, { recipient: string }>; ownWallets?: ReadonlyMap<string, string> }

/**
 * Who one step sends money to, a person or an address (security review 2 Nov: the first-time warning was NEAR's only):
 * NEAR sent; a coin sent by its own contract (ft_transfer, ft_transfer_call, or a deposit into NEAR Intents for another
 * account); a coin sent inside NEAR Intents (mt_transfer) or out of it (ft_withdraw: to a NEAR account, to an address on
 * its home chain, or through a 1Click quote to the quote's recipient). Null: the step pays no one, or pays the account's
 * own wallet (Spending, Private, its chain wallets: the core's own list). With no facts every receiver counts.
 */
export function sentToOf(a: DecodedAction | { kind: string; method?: string; args?: Uint8Array; yocto?: bigint }, tx: { signerId: string; receiverId: string }, facts: SendFacts = {}): string | null {
  const person = (to: unknown): string | null => {
    if (typeof to !== "string" || !to || to === tx.signerId || to === INTENTS.account) return null;
    const paid = facts.quotes?.get(to)?.recipient ?? to;
    return paid === tx.signerId || facts.ownWallets?.has(paid) ? null : paid;
  };
  if (a.kind === "transfer") return (a.yocto ?? 0n) > 0n ? person(tx.receiverId) : null;
  if (a.kind !== "call" || tx.receiverId === tx.signerId) return null;
  const args = jsonArgs(a);
  if (tx.receiverId === INTENTS.account) {
    if (a.method === "mt_transfer" || a.method === "mt_transfer_call") return person(args.receiver_id);
    if (a.method !== "ft_withdraw") return null;
    const home = typeof args.memo === "string" && args.memo.startsWith("WITHDRAW_TO:") && args.receiver_id === args.token && args.msg == null;
    return person(home ? (args.memo as string).slice("WITHDRAW_TO:".length) : args.receiver_id);
  }
  if (a.method !== "ft_transfer" && a.method !== "ft_transfer_call") return null;
  // into NEAR Intents: for the account itself (no msg), or for the account its msg names
  // (an empty msg, a plain account or a JSON receiver_id: coins.ts intentsDepositFor; one it can't read is refused there)
  if (args.receiver_id === INTENTS.account) return person(intentsDepositFor(args.msg, tx.signerId));
  return person(args.receiver_id);
}

/** The first-time warning, for each one this transaction sends to that the past-sends list doesn't hold (NEAR or any
 *  coin). The list unread is never "sent before": the warning shows, and says "from this device". */
function firstTimeWarnings(tx: DecodedTx, ctx: WordsContext): Warning[] {
  const facts: SendFacts = { quotes: ctx.intents?.quotes, ownWallets: ctx.intents?.ownWallets };
  const to = [...new Set(tx.actions.map((a) => sentToOf(a, tx, facts)).filter((x): x is string => x !== null))];
  return to.filter((x) => !ctx.knownRecipients.has(x)).map((x) => ({ kind: "first-time-recipient", text: `You haven't sent to ${x}${ctx.recipientsFromChain ? "" : " from this device"} before.` }));
}

/** The sheet's NEAR line: the NEAR the person can use, before and after (never below zero). `back`: NEAR the step only
 *  gives back (a restore's held 0.0197 at Finish or a stop), with nothing leaving: the after-figure is the balance plus
 *  it, "up to" (only the fee burnt comes off, a fraction of the most it can be), never the most fee taken off it (grade
 *  02h, H8: "7.0972 → 7.0958" over "the 0.0197 NEAR comes back", and it landed at 7.1161). */
function nearEffect(ctx: WordsContext, out: bigint, fee: bigint, back = 0n): { token: string; before: string; after: string } {
  const before = ctx.availableYocto ?? ctx.balanceYocto;
  if (back > 0n && out <= 0n) return { token: "NEAR", before: formatNearShort(before, "down"), after: `up to ${formatNearShort(before + back, "up")}` };
  const leaving = out + fee;
  // A send of (nearly) all: the most the fee can be is more than what's left, but the fee itself is usually far less
  // and comes out of the NEAR kept for fees, so "→ 0" would be untrue (grade 02f, F6: "7.1993 → 0" and 0.0085 stayed).
  // What's left is under the amount less the send, never zero for sure: said so.
  if (before <= leaving && before > out) return { token: "NEAR", before: formatNearShort(before, "down"), after: `under ${formatNearShort(before - out, "up")}` };
  const after = before > leaving ? before - leaving : 0n;
  return { token: "NEAR", before: formatNearShort(before, "down"), after: formatNearShort(after, "down") };
}

/** A 1Click deposit account, by the words the sheet's send line already uses for it. */
const SWAP_SERVICE = "the swap service";
/**
 * A wNEAR payment to the swap service with its set-up steps (a UI test, 4 Nov: "Let your account hold wNEAR, and 3
 * more steps", the swap service's one-time account by its id): the payment is the sheet, and the set-up one line. Only
 * this exact shape folds: one step the core read as its own swap or move (`bare`, or `folds`: a fill into Private; an
 * ft_transfer at the coin's contract),
 * and besides it only the coin's storage for the account itself or for that step's receiver, and NEAR wrapped there that
 * is exactly the amount the step pays. Anything else keeps every step's own lines. Returns the payment step's index and
 * the NEAR the storage costs.
 */
/** The most a folded set-up may cost: 0.01 NEAR (a coin's storage is about 0.00125). */
const MOST_SETUP_YOCTO = 10n ** 22n;

function prepFold(tx: DecodedTx, parts: readonly Described[]): { main: number; setupYocto: bigint } | null {
  if (parts.length < 2 || !WRAP_CONTRACTS.has(tx.receiverId)) return null;
  const isMain = (p: Described) => p.bare === true || p.folds === true;
  const main = parts.findIndex(isMain);
  const pay = tx.actions[main];
  if (main < 0 || parts.filter(isMain).length !== 1 || pay?.kind !== "call" || pay.method !== "ft_transfer") return null;
  const payArgs = jsonArgs(pay);
  const paid = unitsOf(payArgs.amount);
  if (paid === null || typeof payArgs.receiver_id !== "string") return null;
  let wrapped = 0n;
  let setupYocto = 0n;
  for (const [i, a] of tx.actions.entries()) {
    if (i === main) continue;
    if (a.kind !== "call") return null;
    const args = jsonArgs(a);
    if (a.method === "near_deposit") wrapped += a.depositYocto;
    // storage only (registration_only: the rest comes straight back), for the account or the payee (review, QA)
    else if (a.method === "storage_deposit" && (args.account_id === tx.signerId || args.account_id === payArgs.receiver_id) && args.registration_only === true) setupYocto += a.depositYocto;
    else return null;
  }
  // never more than a coin's storage can cost: a big deposit to the payee is said as its own step (review, QA)
  return wrapped === paid && setupYocto <= MOST_SETUP_YOCTO ? { main, setupYocto } : null;
}

export function plainWords(tx: DecodedTx, ctx: WordsContext): PlainWords {
  const unnamed = ctx.unnamed ?? new Unnamed();
  const described = tx.actions.map((a) => describeAction(a, tx, ctx, unnamed));
  const fold = ctx.many ? null : prepFold(tx, described);
  // folded: the payment step alone, plus one line for what setting the coin up costs
  const parts = fold
    ? [{ ...described[fold.main]!, lines: [...described[fold.main]!.lines, ...(fold.setupYocto > 0n ? [`Setting up the coin costs at most ${formatNearShort(fold.setupYocto, "up")} NEAR.`] : [])] }]
    : described;
  const more = parts.length - 1;
  const paid = tx.actions.map((a) => paidIn(a, tx, ctx));
  const amount = amountWords(paid);
  const twin = dollarTwin(paid);
  const coinTitle = more > 0 ? `${parts[0].title}, and ${more} more step${more === 1 ? "" : "s"}` : parts[0].title;
  // Dollars first in the title (VOICE rule 4; audit 2 Nov, B6): one step, priced, says "Send $5.00 (1.1765 NEAR) to
  // alex.near". Several steps keep their coin words: the amount is all of theirs, never the first step's alone.
  // A dollar coin said once (dollarTwin): a step's own title around its coin figure; else its coin words as they are.
  const title = more > 0 ? coinTitle : twin ? (parts[0].titleFor ? parts[0].titleFor(twin) : coinTitle) : dollarsFirstTitle(coinTitle, amount, parts[0].titleFor);
  const fee = maxFeeYocto(ctx.feeFrom ?? tx, ctx.gasPriceYocto);
  // NEAR the step keeps on the account for a while (a waiting recovery's storage), or gives back: in the NEAR line too.
  const out = outgoingYocto(tx) + parts.reduce((sum, p) => sum + (p.heldYocto ?? 0n), 0n);
  // One step: its line usually repeats the title (in its coin words, before the dollars went in), so it is dropped.
  // Several steps: every step keeps its own line.
  const stepLines = parts.length === 1 ? parts[0].lines.filter((l) => l !== title && l !== coinTitle) : parts.flatMap((p) => p.lines);
  // The fee in dollars first, NEAR after it (D8), when a price is known; NEAR alone otherwise. Test NEAR too: Wallet values
  // it at NEAR's own price, the same sample price as here (grade 02f, E3: one coin, one dollar value).
  const feeText = ctx.nearUsd && ctx.nearUsd > 0 ? `${feeUsd(fee, ctx.nearUsd)} (${formatNearShort(fee, "up")} NEAR)` : `${formatNearShort(fee, "up")} NEAR`;
  // The network is said once, as the sheet's "Test network" mark (`testNetwork`), never on every line (grade 02h, H10:
  // "From … on NEAR testnet" on every sheet).
  const lines = [...stepLines, `From ${tx.signerId}. Fee: at most ${feeText}.`];
  // One warning of each kind and text: several steps saying the same thing would only add noise.
  const seen = new Set<string>();
  const warnings = [...firstTimeWarnings(tx, ctx), ...parts.flatMap((p) => p.warnings)].filter((w) => !seen.has(w.kind + w.text) && seen.add(w.kind + w.text));
  if (outgoingYocto(tx) * 2n > ctx.balanceYocto) warnings.push({ kind: "large-amount", text: "This is more than half of your NEAR." });
  const hint = hintFor(ctx.hint, title, coinTitle);
  // The coins it can't name, last: once, for the whole approval (plainWordsMany adds them when it shares one).
  const details = [...parts.flatMap((p) => p.details ?? []), ...(ctx.unnamed ? [] : unnamed.details())];
  // Home's Swap (audit 2 Nov, S1): the step's title and its own line are the sheet; the amount is in the title once.
  // Warnings and details still show; the fee stays in `fee` for anyone who reads it.
  // a Move from the Safe on to the person's own chain wallets names where it ends, the route a quiet line (onward-ends.ts)
  const ends = endsTitle(title, ctx.onward) ?? (parts.length === 1 && parts[0].intoNearWallet ? swapEnds(title, ctx.onward) : null);
  if (parts.length === 1 && parts[0].bare && !ctx.many) {
    return {
      title: ends?.title ?? title,
      // money going on to another wallet says its fee (finding 45: a $3 pump.fun Add's sheet had none); a plain Add or
      // Swap stays title and line (audit 2 Nov, S1)
      lines: [...parts[0].lines, ...(ends ? [...ends.lines, `Fee: at most ${feeText}.`] : [])],
      warnings,
      effect: [],
      ...(ctx.onward && !ends ? { hint: ctx.onward } : {}),
      ...(details.length ? { details } : {}),
      fee: feeText,
      ...(ctx.network !== "mainnet" ? { testNetwork: true as const } : {}),
    };
  }
  return {
    title: ends?.title ?? title,
    lines: ends ? [...lines.slice(0, -1), ...ends.lines, ...lines.slice(-1)] : lines,
    warnings,
    effect: [nearEffect(ctx, out, fee, outgoingYocto(tx) === 0n && out < 0n ? -out : 0n), ...parts.flatMap((p) => p.effects ?? [])],
    ...(details.length ? { details } : {}),
    fee: feeText,
    ...(amount ? { amount } : {}),
    ...(parts.length === 1 && parts[0].amountSaid ? { amountSaid: true as const } : {}),
    ...(ctx.onward && !ends ? { hint: ctx.onward } : !ctx.onward && hint ? { hint } : {}),
    ...(ctx.network !== "mainnet" ? { testNetwork: true as const } : {}),
  };
}

/**
 * Several receivers in one approval (the account contract's execute_many): each group in its own words, in order,
 * joined with "then". The fee bound is the outer transaction's; the NEAR effect counts everything that can leave.
 */
export function plainWordsMany(groups: { tx: DecodedTx; ctx: WordsContext }[], outer: DecodedTx, base: WordsContext): PlainWords {
  // One list of the coins it can't name for every group, so "a second coin ZeroFee can't name" means one coin throughout.
  const unnamed = new Unnamed();
  // `many`: a step in a chain never takes the one-step bare form (security review of S1, High)
  const parts = groups.map((g) => plainWords(g.tx, { ...g.ctx, hint: undefined, feeFrom: outer, unnamed, many: true }));
  const fee = maxFeeYocto(outer, base.gasPriceYocto);
  const out = groups.reduce((sum, g) => sum + outgoingYocto(g.tx), 0n);
  const meta = parts[0].lines.at(-1)!;
  const nearHalf = "This is more than half of your NEAR.";
  const seen = new Set<string>();
  const warnings = parts.flatMap((p) => p.warnings).filter((w) => w.text !== nearHalf && !seen.has(w.kind + w.text) && seen.add(w.kind + w.text));
  if (out * 2n > base.balanceYocto) warnings.push({ kind: "large-amount", text: nearHalf });
  const amount = amountWords(groups.flatMap((g) => g.tx.actions.map((a) => paidIn(a, g.tx, { ...g.ctx, nearUsd: g.ctx.nearUsd ?? base.nearUsd }))));
  const title = parts.map((p) => p.title).join(", then ");
  const onward = groups.at(-1)?.ctx.onward;
  const hint = onward ?? hintFor(base.hint, title);
  const details = [...parts.flatMap((p) => p.details ?? []), ...unnamed.details()];
  return {
    title,
    ...(details.length ? { details } : {}),
    lines: [...parts.flatMap((p) => [p.title, ...p.lines.slice(0, -1)]), "Each step happens only if the one before it worked.", meta],
    warnings,
    effect: [nearEffect(base, out, fee), ...parts.flatMap((p) => p.effect.slice(1))],
    ...(parts[0].fee !== undefined ? { fee: parts[0].fee } : {}),
    ...(amount ? { amount } : {}),
    ...(base.network !== "mainnet" ? { testNetwork: true as const } : {}),
    ...(hint ? { hint } : {}),
  };
}

/** the copy review's words for separate steps on one sheet (fix/safe-steps-one-faceid, 7 Nov), exact. */
export const APART_WORDS = {
  allow: (usd: string, symbol: string) => `1. Your Safe lets NEAR Intents take ${usd} in ${symbol}.`,
  send: "2. Your Safe sends it.",
  only: "Step 2 runs only if step 1 worked.",
  fee: (usd: string) => `Fee · ${usd}. A small NEAR deposit comes back to your Safe later.`,
  /** no NEAR price: the fee in NEAR (provisional, to 53) */
  feeNear: (near: string) => `Fee · at most ${near} NEAR. A small NEAR deposit comes back to your Safe later.`,
  after: "Your Safe after",
} as const;

const callArgs = (a: DecodedAction): Record<string, unknown> => {
  if (a.kind !== "call") return {};
  try {
    return a.args.length ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(a.args)) ?? {} : {};
  } catch {
    return {};
  }
};

/**
 * Separate steps (TxRequest.apart) on ONE sheet. The Safe's own two steps, room for a coin at a deposit address and then
 * paying that address exactly (convert.ts fundingSteps: storage_deposit, then ft_transfer or NEAR Intents' ft_withdraw),
 * say the copy review's words: each step on one line, the rule between them, the fee in dollars, the Safe's coin after, no NEAR row,
 * no "Wallet says:", never an account id. Any other set says every step as a chain does (plainWordsMany), without the
 * asking app's line. The title stays the steps' own (the person's action as the headline follows B2's plan).
 */
export function plainWordsApart(groups: { tx: DecodedTx; ctx: WordsContext }[], outer: DecodedTx, base: WordsContext): PlainWords {
  const { hint: _app, ...general } = plainWordsMany(groups, outer, base);
  const [one, two] = groups;
  const first = one && one.tx.actions.length === 1 ? one.tx.actions[0]! : null;
  const room = groups.length === 2 && first?.kind === "call" && first.method === "storage_deposit" ? first : null;
  const pay = two && two.tx.actions.length === 1 ? two.tx.actions[0]! : null;
  if (!room || !pay || pay.kind !== "call") return general;
  const at = callArgs(room).account_id;
  const p = callArgs(pay);
  const coin = one!.tx.receiverId;
  const paysIt = typeof at === "string" && p.receiver_id === at && ((pay.method === "ft_transfer" && two!.tx.receiverId === coin) || (pay.method === "ft_withdraw" && two!.tx.receiverId === INTENTS.account && p.token === coin));
  const paid = paysIt ? paidIn(pay, two!.tx, { ...two!.ctx, nearUsd: two!.ctx.nearUsd ?? base.nearUsd }) : null;
  if (!paid || paid.usd === null || !paid.coin) return general;
  const symbol = paid.coin.slice(paid.coin.indexOf(" ") + 1);
  const feeYocto = maxFeeYocto(outer, base.gasPriceYocto);
  const price = base.nearUsd && base.nearUsd > 0 ? base.nearUsd : null;
  const fee = price === null ? APART_WORDS.feeNear(formatNear(feeYocto)) : APART_WORDS.fee(feeUsd(feeYocto, price));
  // the Safe's coin after, from the coin's own effect row (worst case); the NEAR row goes (copy review)
  // a dollar coin in dollars to the cent, rounded down as the row is (two decimals on money)
  const cents = (v: string) => { const x = Number(v.replace(/,/g, "")); return Number.isFinite(x) ? `$${(Math.floor(x * 100 + 1e-6) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null; };
  const after = general.effect.filter((e) => e.token === symbol).map((e) => ({ token: APART_WORDS.after, before: "", after: paid.dollar && cents(e.after) ? `${cents(e.after)} in ${symbol}` : `${e.after} ${symbol}` }));
  return { ...general, lines: [APART_WORDS.allow(dollarWords(paid.usd, paid.exact), symbol), APART_WORDS.send, APART_WORDS.only, fee], effect: after };
}
