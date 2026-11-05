// NEAR Intents (intents.near, mainnet) in plain words, and the check of 1Click quotes before anything is signed.
//
// Verified against github.com/near/intents (contracts/defuse, d340060) and the 1Click OpenAPI spec
// (1click.chaindefuser.com/docs/v0/openapi.yaml). Every method is called by the account itself with 1 yocto attached.
//
// Look-alikes are never described as the real thing:
// - a withdrawal is "to <address> on <chain>" only when it really is one: a bridged *.omft.near token, sent to the
//   token contract itself, with a WITHDRAW_TO: memo and no msg. Anything else is described as what it is;
// - a payment is "1Click pays …" only when 1Click's quote for that deposit address is still waiting, refunds to this
//   account, and expects exactly the coin and amount in the bytes. Otherwise nothing is signed.
import { codeOf } from "./chain.ts";
import type { Block, Chain } from "./chain.ts";
import { formatAmount, formatShort, fourPlacesText, outsideShort, Unnamed } from "./format.ts";
import type { Described } from "./format.ts";
import { ProblemError } from "./problem.ts";
import { FORK, FORK_CROSS_CHAIN } from "./fork.ts";
import { ONE_CLICK_QUOTE_KEY, signedBy1Click } from "./quote-signature.ts";
import { securityProblems } from "./security-problems.ts";
import { faultOf, serviceProblem } from "./services.ts";
import { readable, type Warning } from "./signer.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";
import { readJson } from "./net.ts";
import { LEG_WORDS, SEND_LEG_WORDS, splitLines } from "./private-route.ts";

export const INTENTS = {
  account: "intents.near",
  /** intents.near's code when these words were written. A different hash adds a warning; the words stay. */
  codeHashBase58: "BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk",
};

const ONE_CLICK = "https://1click.chaindefuser.com";

/** Coins ZeroFee knows by their contract (mainnet). Any other coin carries a warning: a name can be copied. */
const KNOWN_COINS = new Set(["17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "usdt.tether-token.near", "wrap.near"]);

/** Home chains of bridged coins, by the first part of `<chain>[-<address>].omft.near`. */
const OMFT_CHAINS: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", gnosis: "Gnosis",
  avax: "Avalanche", bera: "Berachain", sol: "Solana", btc: "Bitcoin", doge: "Dogecoin", ltc: "Litecoin", zec: "Zcash",
  xrp: "XRP Ledger", tron: "Tron", sui: "Sui", ton: "TON", aptos: "Aptos", cardano: "Cardano", stellar: "Stellar",
};

export interface TokenInfo {
  symbol: string;
  decimals: number;
}

export interface QuoteFacts {
  status: string;
  originAsset: string;
  amountIn: string;
  refundTo: string;
  refundType: string;
  destinationAsset: string;
  minAmountOut: string;
  recipient: string;
  recipientType: string;
  deadline: string;
  /** Where its deposit comes from (ORIGIN_CHAIN, INTENTS, CONFIDENTIAL_INTENTS), the kind of price, and what it promises. */
  depositType?: string;
  swapType?: string;
  /** The confidentiality the quote was asked with ("basic": ZeroFee's own quotes, TN2 review M3). */
  confidentiality?: string;
  amountOut?: string;
  /** What 1Click says the amount in is worth in dollars (signed with the rest). */
  amountInUsd?: string;
  /** Signed with the rest: a memo the deposit needs (XRP, Stellar, TON…), the dollars out, and 1Click's time estimate. */
  depositMemo?: string;
  amountOutUsd?: string;
  timeEstimate?: number;
}

export interface IntentsFacts {
  /** The deployed intents.near code is the one these words were written for (two nodes). */
  codeMatches: boolean;
  /** Coin contract → symbol and decimals, from ft_metadata on two nodes. */
  tokens: Map<string, TokenInfo>;
  /** Token id → the account's balance inside intents.near, on two nodes. */
  balances: Map<string, bigint>;
  /** Deposit address → the 1Click quote waiting for it. */
  quotes: Map<string, QuoteFacts>;
  /** The account's own separate wallets, by address → their name ("your Solana trading wallet"), from the core's own
   *  list (never an app's word): a move to one of them is named by it. */
  ownWallets?: Map<string, string>;
  /** Whom the person entered to pay (TxRequest.payee): a quote paying anyone else outside this account is refused. */
  payee?: { recipient: string; recipientType: string };
  /** A Move's fill (TxRequest.moveFill): its sheet lists the legs. Private's leg (units of its coin) only from the core's
   *  own record of the pocket's share it signed for this Move (dev-signer privateLeg); absent, no Private line. */
  moveFill?: { privateTokenId?: string; privateUnits?: string; payUnits?: string; payee?: string; payeeOwn?: boolean };
  /** A Send's fill (TxRequest.sendFill): the payout joined to this move in, as the core read it from 1Click's signed
   *  quote (dev-signer sendPayout; checked against this move in by sendPayoutFits). */
  sendFill?: SendPayout & { title: string; lines: string[]; gets: string; to: string; seen: string };
}

/** A Send's payout, as 1Click signed its quote, joined to the Safe's move into Private that pays for it (subwallets
 *  privatePay with inDeposit): whom it pays, in which coin, what leaves Private and what they get. */
export interface SendPayout {
  recipient: string; recipientType: string; originAsset: string; destinationAsset: string; amountIn: string; amountOut: string;
  /** The signed quote's dollar figures (quote-signature.ts signs both): what leaves Private and what the payee's coin is
   *  worth, for the fill sheet's "They get · 1.2345 SOL ($39.60)" and its "Network fees · about $0.40". */
  amountInUsd?: string; amountOutUsd?: string;
}
/** The payout fits this move in: the same coin, and no more than the move in promises to bring (send-words
 *  throughJoinRefusal's own rule), with real figures. */
/**
 * The quote pays someone the person picked (audit, core integrity 1): this account itself, one of its own wallets (the
 * core's own list), or exactly the payee the person entered. Whoever runs the relay holds the partner key and can fetch
 * a genuine, 1Click-signed quote that pays a look-alike address, with every other term matching the bytes; the private
 * path pins its payee the same way (private-pocket.ts payeeRefusal). An EVM address is the same in any letter case;
 * every other kind (base58, NEAR names, hex) is compared exactly.
 */
export function paysWhomPicked(quote: QuoteFacts, facts: IntentsFacts, accountId: string): boolean {
  if (quote.recipient === accountId && (quote.recipientType === "INTENTS" || quote.recipientType === "DESTINATION_CHAIN")) return true;
  if (facts.ownWallets?.has(quote.recipient)) return true;
  const p = facts.payee;
  if (!p || typeof p.recipient !== "string" || !p.recipient || p.recipientType !== quote.recipientType) return false;
  const evm = /^0x[0-9a-fA-F]{40}$/.test(p.recipient);
  return evm ? quote.recipient.toLowerCase() === p.recipient.toLowerCase() : quote.recipient === p.recipient;
}

/** 1Click's quote for a deposit address, or null if 1Click doesn't know the address. */
export type OneClickLookup = (depositAddress: string) => Promise<unknown | null>;

/** Spending's hub (Trade's float, D52) as the main sheet names it (demo-core's ownWalletName): "your NEAR wallet" (home/words,
 *  3 Nov: Home's NEAR wallet is this balance; never "Trading" or "Spending" on a sheet). Words only: every check compares this
 *  constant, and what is signed never carries it (intents-words.test.ts pins the payload). */
export const TRADING_BALANCE = "your NEAR wallet";
/** The private pocket, as the core's own list names it (demo-core ownWalletName). */
export const PRIVATE_POCKET = "your private balance";
/** What Private is, said once on the Safe's sheet that fills it (the pair-private walk, 5 Nov). */
export const PRIVATE_SAID = "Private is your money inside NEAR Confidential. Moves pay from it. The public can't see what's in it.";
/** The receipt line of a move into Private: who moves it, and that ZeroFee keeps no fee. */
export const PRIVATE_RECEIPT = "NEAR Confidential moves it. ZeroFee takes nothing.";
/** The main account's balance inside NEAR Intents, as a person knows it (D41, D52: the Safe). */
export const VAULT = "your Safe";

/** The signer's own balance inside NEAR Intents, named as the person knows it: the float's, the pocket's, or the vault. */
export function signerBalance(tx: DecodedTx, facts: IntentsFacts | undefined): string {
  const own = facts?.ownWallets?.get(tx.signerId);
  return own === TRADING_BALANCE || own === PRIVATE_POCKET ? own : VAULT;
}

export const oneClickStatus: OneClickLookup = async (depositAddress) => {
  let res: Response;
  try {
    res = await fetch(`${ONE_CLICK}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw oneClickFailed(null, e);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw oneClickFailed(res.status);
  return readJson(res);
};

/** Ask 1Click for a quote (its public API). `dry: true` prices it without making a deposit address. */
export type OneClickQuoter = (request: Record<string, unknown>) => Promise<any>;

export const oneClickQuote: OneClickQuoter = async (request) => {
  // the mainnet copy (VITE_FORK=1): 1Click can't be copied, so no cross-chain leg starts (fork.ts)
  if (FORK) throw new ProblemError(FORK_CROSS_CHAIN);
  let res: Response;
  try {
    res = await fetch(`${ONE_CLICK}/v0/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw oneClickFailed(null, e);
  }
  // 1Click's own "no" to a pair (4xx) stays the caller's to word ("didn't give a safe price"); only a failure is named here
  if (res.status >= 500 || res.status === 429) throw oneClickFailed(res.status);
  if (!res.ok) throw new ProblemError(securityProblems.partnerUnreachable("the swap service"));
  return readJson(res);
};

/** 1Click failed (B28): by name, and how (521 down, 429 busy, a timeout slow); the app says it as a line and asks again. */
function oneClickFailed(status: number | null, e?: unknown): ProblemError {
  return new ProblemError(serviceProblem("security.partner.unreachable", "oneclick", faultOf(status, e)));
}

const emptyFacts = (): IntentsFacts => ({ codeMatches: true, tokens: new Map(), balances: new Map(), quotes: new Map() });
export const isUnits = (v: unknown): v is string => typeof v === "string" && /^\d{1,39}$/.test(v);
const isOmft = (contract: string) => /^[a-z0-9-]+\.omft\.near$/.test(contract);

/** "nep141:<contract>" → the contract; other kinds of token id → null (their details aren't read yet). */
export function nep141Contract(tokenId: string): string | null {
  return tokenId.startsWith("nep141:") && tokenId.length > 7 ? tokenId.slice(7) : null;
}

/** The home chain of a bridged coin ("sol-5ce3….omft.near" → "Solana"), or null. */
export function homeChain(contract: string): string | null {
  if (!isOmft(contract)) return null;
  return OMFT_CHAINS[contract.slice(0, -".omft.near".length).split("-")[0]] ?? null;
}

function argsOf(a: DecodedAction): Record<string, any> | null {
  if (a.kind !== "call") return null;
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(a.args));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * A 1Click status's quote, for paying `depositAddress`: only 1Click's own signed terms for that very address (the
 * outside study's item 2), so whoever passed the status along (our relay, for Private and Trading) can't change who is
 * paid, the refund or the amounts. Null if it isn't signed by 1Click's key or is for another address. `status` is
 * 1Click's word on progress, which it doesn't sign: it never decides where money goes.
 */
/**
 * 1Click's own fee on a quote: 20 bps to its fee account (seen on a live quote 27 Oct 2026 and again 28 Oct, dry, public).
 * ZeroFee never asks for an app fee, and 1Click's signature doesn't cover them (audit NF-17), so any other, or more, means
 * whoever passed the quote on added one: the quote isn't the core's.
 */
// 1Click's fee accounts: 5880ad2b… on public quotes; 2238fd08… on quotes made with a partner key (seen 2 Nov 2026 on every
// partner-key swap quote, the same single 20 bps; 1Click charges API-key quotes 0.20% by default, docs.near-intents.org
// /resources/fees). Product decision, 2 Nov: 1Click's fee is a protocol cost. Either, alone, at 20 bps or less.
const ONE_CLICK_FEE_ACCOUNTS: readonly string[] = [
  "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd",
  "2238fd089f1c92b206c218cd16b8676cb98964e0d50f8ab729c6396a81e07805",
];
const ONE_CLICK_FEE_BPS = 20;
function ownAppFees(fees: unknown): boolean {
  if (fees === undefined || fees === null) return true;
  if (!Array.isArray(fees)) return false;
  if (fees.length > 1) return false; // 1Click adds one fee entry; a second is someone else's
  let bps = 0;
  for (const f of fees) {
    if (!f || !ONE_CLICK_FEE_ACCOUNTS.includes(f.recipient) || !Number.isInteger(f.fee) || f.fee < 0) return false;
    bps += f.fee;
  }
  return bps <= ONE_CLICK_FEE_BPS;
}

/**
 * A signed quote's bounds (audit T-1): its deadline at most 4 days after its timestamp (as a pocket intent's,
 * private-pocket.ts), and its timestamp at most 10 minutes ahead of our clock. That bounds its age wherever money moves:
 * every payment also needs the signed deadline still ahead (checkIntents, pocketIntentRefusal, convertQuoteRefusal), so
 * nothing is paid on a quote made more than 4 days ago. An older one is still READ, only to say a move that ran out
 * failed (its money stays where it was); it never pays.
 */
export const QUOTE_MAX_LIFE_MS = 4 * 86_400_000;
const QUOTE_CLOCK_SKEW_MS = 10 * 60_000;
/** Request fields that send money or messages somewhere the core never asks for: any of them, and the quote isn't ours. */
const FOREIGN_REQUEST_FIELDS = ["referral", "virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"] as const;

/**
 * Audit T-1 (CRITICAL): 1Click signs a DRY quote over the request and the amounts only, never a deposit address or its
 * deadline, so a relay could bolt its own address onto a genuine dry quote. Only a real quote (`dry === false`) signs
 * where to pay and until when: the deposit address must be that signed one, and the deadline is the signed
 * `quote.deadline` alone (never the request's). A quote carrying a referral, a virtual-chain recipient or a custom
 * message, or whose timestamp is out of bounds, is refused.
 */
export function parseQuote(raw: any, depositAddress: string, quoteKey: string = ONE_CLICK_QUOTE_KEY, nowMs: number = Date.now()): QuoteFacts | null {
  const req = raw?.quoteResponse?.quoteRequest;
  const q = raw?.quoteResponse?.quote;
  if (!req || !q || typeof req !== "object" || typeof q !== "object") return null;
  if (req.dry !== false) return null;
  if (typeof depositAddress !== "string" || !depositAddress || typeof q.depositAddress !== "string" || q.depositAddress !== depositAddress) return null;
  if (typeof q.deadline !== "string" || !q.deadline) return null;
  if (FOREIGN_REQUEST_FIELDS.some((k) => req[k] !== undefined && req[k] !== null && req[k] !== "")) return null;
  const at = typeof raw.quoteResponse.timestamp === "string" ? Date.parse(raw.quoteResponse.timestamp) : NaN;
  const until = Date.parse(q.deadline);
  if (!Number.isFinite(at) || !Number.isFinite(until) || at > nowMs + QUOTE_CLOCK_SKEW_MS || until - at > QUOTE_MAX_LIFE_MS) return null;
  if (!signedBy1Click(raw.quoteResponse, quoteKey)) return null;
  if (!ownAppFees(req.appFees)) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    status: s(raw.status),
    originAsset: s(req.originAsset),
    amountIn: s(q.amountIn),
    refundTo: s(req.refundTo),
    refundType: s(req.refundType),
    destinationAsset: s(req.destinationAsset),
    minAmountOut: s(q.minAmountOut),
    recipient: s(req.recipient),
    recipientType: s(req.recipientType),
    deadline: s(q.deadline),
    depositType: s(req.depositType),
    swapType: s(req.swapType),
    confidentiality: s(req.confidentiality),
    amountOut: s(q.amountOut),
    amountInUsd: s(q.amountInUsd),
    ...(q.depositMemo !== undefined && q.depositMemo !== null && q.depositMemo !== "" ? { depositMemo: String(q.depositMemo) } : {}),
    ...(q.amountOutUsd !== undefined ? { amountOutUsd: s(q.amountOutUsd) } : {}),
    ...(Number.isInteger(q.timeEstimate) ? { timeEstimate: q.timeEstimate } : {}),
  };
}

export function cleanMetadata(m: any): TokenInfo | null {
  const symbol = typeof m?.symbol === "string" ? m.symbol.replace(/[^\p{L}\p{N}.$_-]/gu, "").slice(0, 16) : "";
  const decimals = m?.decimals;
  return symbol && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? { symbol, decimals } : null;
}

/** A plain coin transfer to a 1Click deposit address: */
const isDepositTransfer = (a: DecodedAction, args: Record<string, any> | null): args is Record<string, any> =>
  a.kind === "call" && a.method === "ft_transfer" && !!args && typeof args.receiver_id === "string" && /^[0-9a-f]{64}$/.test(args.receiver_id) && isUnits(args.amount);

/**
 * A coin's own contract paying a 1Click deposit address (ft_transfer; the move into Private from the account itself):
 * only a quote this core asked for itself (`ownQuote`), as 1Click signed it. Any other such transfer reads as a plain
 * send to that address, as before.
 */
async function ownQuoteFacts(tx: DecodedTx, chain: Chain, block: Block, facts: IntentsFacts, quoteKey: string, ownQuote?: OneClickLookup): Promise<IntentsFacts> {
  if (!ownQuote) return facts;
  for (const a of tx.actions) {
    const args = argsOf(a);
    if (!isDepositTransfer(a, args) || facts.quotes.has(args.receiver_id)) continue;
    const quote = parseQuote(await ownQuote(args.receiver_id).catch(() => null), args.receiver_id, quoteKey);
    if (quote) facts.quotes.set(args.receiver_id, quote);
  }
  if (facts.quotes.size > 0) {
    // the coin paid and the coin each quote promises (a UI test: the USDC promised read as "an unnamed coin")
    const contracts = new Set([tx.receiverId, ...[...facts.quotes.values()].map((q) => nep141Contract(q.destinationAsset)).filter((c): c is string => !!c)]);
    for (const contract of contracts) {
      const info = cleanMetadata(await chain.view(contract, "ft_metadata", {}, block).catch(() => null));
      if (info) facts.tokens.set(contract, info);
    }
  }
  return facts;
}

/**
 * Read what the words need: intents.near's code hash, each coin's symbol and decimals, the account's balances, and any
 * 1Click quote waiting for a receiver. Chain reads are on two nodes. Mainnet only: there is no intents.near on testnet.
 */
export async function gatherIntentsFacts(tx: DecodedTx, chain: Chain, block: Block, lookup: OneClickLookup, quoteKey: string = ONE_CLICK_QUOTE_KEY, ownQuote?: OneClickLookup): Promise<IntentsFacts> {
  const facts = emptyFacts();
  if (chain.network !== "mainnet") return facts;
  if (tx.receiverId !== INTENTS.account) return ownQuoteFacts(tx, chain, block, facts, quoteKey, ownQuote);
  const calls = tx.actions.map(argsOf).filter((x): x is Record<string, any> => x !== null);
  const sent = new Set<string>();
  const receivers = new Set<string>();
  tx.actions.forEach((a) => {
    const args = argsOf(a);
    if (!args || a.kind !== "call") return;
    if ((a.method === "mt_transfer" || a.method === "mt_transfer_call") && typeof args.token_id === "string") sent.add(args.token_id);
    if ((a.method === "mt_batch_transfer" || a.method === "mt_batch_transfer_call") && Array.isArray(args.token_ids)) args.token_ids.forEach((t: unknown) => typeof t === "string" && sent.add(t));
    if (a.method === "ft_withdraw" && typeof args.token === "string") sent.add(`nep141:${args.token}`);
    if (a.method === "mt_transfer" && typeof args.receiver_id === "string") receivers.add(args.receiver_id);
    // an mt_transfer_call to what may be a 1Click deposit address (64 hex): looked up so checkIntents refuses it (audit)
    if (a.method === "mt_transfer_call" && typeof args.receiver_id === "string" && /^[0-9a-f]{64}$/.test(args.receiver_id)) receivers.add(args.receiver_id);
    // Route B: a NEAR-native coin paid out of the ledger straight to a 1Click deposit address on NEAR.
    if (a.method === "ft_withdraw" && typeof args.receiver_id === "string" && args.receiver_id !== args.token) receivers.add(args.receiver_id);
  });
  if (calls.length === 0) return facts;
  // 1Click is asked only about addresses that could be its deposit addresses: never about this account itself.
  receivers.delete(tx.signerId);

  // Speed (Move, 5 Nov: the Safe's sheet waited on these one after another, 1Click's lookup a relay round trip among
  // them): every read at once, at the same block; each decides exactly as before, in the same order, and any that fails
  // fails the whole as before. A coin's words: the coins sent at once, a quote's coin once its quote is read.
  const metaOf = (tokenId: string) => {
    const contract = nep141Contract(tokenId);
    return contract ? chain.view(contract, "ft_metadata", {}, block).then((m) => [contract, cleanMetadata(m)] as const) : Promise.resolve(null);
  };
  const sentMeta = Promise.all([...sent].map(metaOf));
  void sentMeta.catch(() => undefined);
  const [acct, looked, balances] = await Promise.all([
    chain.account(INTENTS.account, block),
    Promise.all([...receivers].map(async (receiver) => [receiver, parseQuote(await lookup(receiver), receiver, quoteKey)] as const)),
    Promise.all([...sent].map(async (tokenId) => [tokenId, await chain.view(INTENTS.account, "mt_balance_of", { account_id: tx.signerId, token_id: tokenId }, block)] as const)),
  ]);
  facts.codeMatches = codeOf(acct) === INTENTS.codeHashBase58;
  const more = new Set<string>();
  for (const [receiver, quote] of looked) {
    if (!quote) continue;
    facts.quotes.set(receiver, quote);
    if (!sent.has(quote.destinationAsset)) more.add(quote.destinationAsset);
  }
  for (const [tokenId, balance] of balances) if (isUnits(balance)) facts.balances.set(tokenId, BigInt(balance));
  for (const m of [...(await sentMeta), ...(await Promise.all([...more].map(metaOf)))]) if (m && m[1]) facts.tokens.set(m[0], m[1]);
  return facts;
}

/**
 * Before anything is shown: refuse to spend more of a coin than the account holds in NEAR Intents (the network would
 * refuse it after Face ID and keep the fee), and refuse a payment whose 1Click quote doesn't match the bytes, has run
 * out, or refunds to someone else.
 */
export function checkIntents(tx: DecodedTx, facts: IntentsFacts, accountId: string, now = Date.now()): void {
  const spending = new Map<string, bigint>();
  for (const a of tx.actions) {
    const args = argsOf(a);
    if (a.kind !== "call" || !args) continue;
    const add = (tokenId: unknown, units: unknown) => {
      if (typeof tokenId === "string" && isUnits(units)) spending.set(tokenId, (spending.get(tokenId) ?? 0n) + BigInt(units));
    };
    if (a.method === "mt_transfer" || a.method === "mt_transfer_call") add(args.token_id, args.amount);
    if (a.method === "ft_withdraw" && typeof args.token === "string") add(`nep141:${args.token}`, args.amount);
    if ((a.method === "mt_batch_transfer" || a.method === "mt_batch_transfer_call") && Array.isArray(args.token_ids) && Array.isArray(args.amounts)) {
      args.token_ids.forEach((t: unknown, i: number) => add(t, args.amounts[i]));
    }
  }
  for (const [tokenId, units] of spending) {
    const balance = facts.balances.get(tokenId);
    if (balance !== undefined && units > balance) throw new ProblemError(securityProblems.notEnoughCoin(coin(tokenId, facts)?.symbol ?? "of this coin"));
  }
  for (const a of tx.actions) {
    const args = argsOf(a);
    const plain = isDepositTransfer(a, args);
    // a quote's deposit address is paid by a plain mt_transfer, never mt_transfer_call (its msg runs code there): refused
    if (a.kind === "call" && args && a.method === "mt_transfer_call" && facts.quotes.has(args.receiver_id)) throw new ProblemError(securityProblems.quoteMismatch());
    if (a.kind !== "call" || !args || (a.method !== "mt_transfer" && a.method !== "ft_withdraw" && !plain)) continue;
    const quote = facts.quotes.get(args.receiver_id);
    if (!quote) continue;
    if (quote.status !== "PENDING_DEPOSIT" || !(Date.parse(quote.deadline) > now)) throw new ProblemError(securityProblems.quoteExpired());
    // Inside the ledger (mt_transfer) a refund comes back into NEAR Intents; paid out on NEAR (ft_withdraw, route B) it
    // comes back to the account itself. Either way it must come back to this account, and nowhere else.
    const route =
      a.method === "mt_transfer"
        ? quote.refundType === "INTENTS" && quote.originAsset === args.token_id
        : a.method === "ft_withdraw" && args.msg == null && (quote.refundType === "ORIGIN_CHAIN" || quote.refundType === "INTENTS") && quote.originAsset === `nep141:${args.token}`;
    // Or into one of the account's own private wallets: the Add into Trade's float, or a move into the private pocket.
    // A confidential quote paying that wallet, whose refund comes back to it, by the core's own list (relay rule (b):
    // recipient === refundTo). Paid out of the ledger (ft_withdraw, route B), by the coin's own contract from the
    // account (ft_transfer, a quote this core asked for itself), or inside the ledger (mt_transfer) on a quote that takes
    // its deposit there (INTENTS: the fill's one bridge leg, subwallets privateQuoteIn `intents`; Train 19)
    const paidCoin = a.method === "ft_withdraw" ? `nep141:${args.token}` : plain ? `nep141:${tx.receiverId}` : a.method === "mt_transfer" && quote.depositType === "INTENTS" ? String((args as Record<string, unknown>).token_id) : "";
    const own = facts.ownWallets?.get(quote.refundTo);
    const intoOwn =
      (a.method === "ft_withdraw" || plain || a.method === "mt_transfer") && args.msg == null && paidCoin !== "" && quote.originAsset === paidCoin && quote.refundType === "CONFIDENTIAL_INTENTS" &&
      quote.recipientType === "CONFIDENTIAL_INTENTS" && quote.refundTo === quote.recipient && (own === TRADING_BALANCE || own === PRIVATE_POCKET);
    const matches = ((route && quote.refundTo === accountId) || intoOwn) && quote.amountIn === args.amount;
    if (!matches) throw new ProblemError(securityProblems.quoteMismatch());
    if (!paysWhomPicked(quote, facts, accountId)) throw new ProblemError(securityProblems.quoteMismatch(true));
  }
}

/** A Swap's or a Move's tag (QA, 5 Nov): what the core's own door asked this payment to be. */
export type IntentKind = "swap" | "move";

/** The 1Click deposit addresses a NEAR transaction pays (any coin, any way), for the core's own record of what it asked. */
export function paidAddresses(tx: DecodedTx): string[] {
  const out = new Set<string>();
  const hex = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  if (hex(tx.receiverId) && tx.actions.some((a) => a.kind === "transfer" || a.kind === "call")) out.add(tx.receiverId);
  for (const a of tx.actions) {
    const args = argsOf(a);
    if (a.kind !== "call" || !args) continue;
    if (["mt_transfer", "mt_transfer_call", "ft_withdraw", "ft_transfer", "ft_transfer_call"].includes(a.method) && hex(args.receiver_id)) out.add(args.receiver_id);
    if ((a.method === "mt_batch_transfer" || a.method === "mt_batch_transfer_call") && hex(args.receiver_id)) out.add(args.receiver_id);
  }
  return [...out];
}

/**
 * Under a Swap's or a Move's tag, the payment must say exactly that, or nothing is shown (the audit's rule, 5 Nov). The tag is
 * the core's own: set from what its own quote doors asked (subwallet.safeSwapQuote, subwallet.private.quoteIn,
 * subwallet.float.quoteAdd), never from an app's request, a page or the relay. A swap pays a quote 1Click signed whose
 * payout and refund are both this account; a move pays a signed confidential quote into one of the account's own wallets
 * (recipient = refundTo, the core's own list). Every step pays one of `targets` (the addresses the tag is bound to) or
 * only makes room for it there (storage_deposit) or wraps NEAR for it (near_deposit). Anything else (a send to an
 * unsigned or foreign address, a forged quote, a quote under another key) is refused here, before any sheet.
 * Returns how many payments it checked; the caller refuses a tagged request that pays nothing.
 */
export function checkBoundIntent(tx: DecodedTx, facts: IntentsFacts, accountId: string, kind: IntentKind, targets: ReadonlySet<string>): number {
  const changed = new ProblemError(securityProblems.intentChanged(kind));
  let paid = 0;
  for (const a of tx.actions) {
    const args = argsOf(a);
    if (a.kind !== "call" || !args) throw changed;
    if (a.method === "storage_deposit" && tx.receiverId !== INTENTS.account && typeof args.account_id === "string" && targets.has(args.account_id)) continue;
    if (a.method === "near_deposit" && tx.receiverId === "wrap.near") continue;
    const pays = tx.receiverId === INTENTS.account ? a.method === "mt_transfer" || a.method === "ft_withdraw" : a.method === "ft_transfer";
    if (!pays || args.msg != null || typeof args.receiver_id !== "string" || !targets.has(args.receiver_id)) throw changed;
    const q = facts.quotes.get(args.receiver_id);
    if (!q) throw changed;
    const own = facts.ownWallets?.get(q.recipient);
    const ok =
      kind === "swap"
        ? q.recipient === accountId && q.refundTo === accountId && q.recipientType === "INTENTS" && (q.refundType === "INTENTS" || (a.method === "ft_withdraw" && q.refundType === "ORIGIN_CHAIN"))
        : q.recipient === q.refundTo && q.recipientType === "CONFIDENTIAL_INTENTS" && q.refundType === "CONFIDENTIAL_INTENTS" && (own === PRIVATE_POCKET || own === TRADING_BALANCE);
    if (!ok) throw changed;
    paid++;
  }
  return paid;
}

export function coin(tokenId: string, facts: IntentsFacts): { symbol: string; decimals: number } | null {
  const contract = nep141Contract(tokenId);
  if (!contract) return null;
  // the three pinned coins by their fixed names; any other coin that calls itself one of them is said with its
  // contract, so it never reads as the real one (review, QA)
  const pinned = FIXED_COINS[contract];
  if (pinned) return pinned;
  const read = facts.tokens.get(contract);
  if (!read || isOmft(contract) || !LOOKALIKE.has(read.symbol.toUpperCase())) return read ?? null;
  return { symbol: `${read.symbol} (${contract.length > 24 ? `${contract.slice(0, 6)}…${contract.slice(-4)}` : contract})`, decimals: read.decimals };
}
const LOOKALIKE = new Set(["USDC", "USDT", "WNEAR", "NEAR"]);
/** Finding 61 (a real-money test, 4 Nov): the coins whose names never change (KNOWN_COINS), for a sheet whose coin details didn't
 *  load (NEAR's RPC rate-limited): "USDC", never "an unnamed coin: its id is nep141:1720…" and "2037724 units". */
const FIXED_COINS: Readonly<Record<string, TokenInfo>> = {
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": { symbol: "USDC", decimals: 6 },
  "usdt.tether-token.near": { symbol: "USDT", decimals: 6 },
  "wrap.near": { symbol: "wNEAR", decimals: 24 },
};

/** For a title: "about 0.4917 SOL" (at most 4 significant digits, rounded down so it never reads bigger), or the exact
 *  amount when that is already short. The exact amount is always a line on the sheet too. */
function about(tokenId: string, units: string, facts: Facts): string {
  const c = coin(tokenId, facts);
  if (!c) return money(tokenId, units, facts);
  const n = BigInt(units);
  const drop = 10n ** BigInt(Math.max(0, n.toString().length - 4));
  const exact = formatAmount(n, c.decimals), short = formatAmount(n - (n % drop), c.decimals);
  return short === exact ? `${exact} ${c.symbol}` : `about ${short} ${c.symbol}`;
}

/** The facts, with the sheet's list of the coins it can't name (format.ts Unnamed). */
type Facts = IntentsFacts & { unnamed: Unnamed };

/** "12.5 USDC", or "an amount of a coin ZeroFee can't name" when the coin's details couldn't be read: its exact amount
 *  and its id are then lines of the sheet's disclosure (UI-SIMPLICITY-RULES 3, 6), never dropped. */
function money(tokenId: string, units: string, facts: Facts): string {
  const c = coin(tokenId, facts);
  return c ? `${formatAmount(BigInt(units), c.decimals)} ${c.symbol}` : facts.unnamed.amount(units, tokenId);
}

function coinWarnings(tokenId: string, facts: Facts): Warning[] {
  const contract = nep141Contract(tokenId);
  if (!contract || !coin(tokenId, facts)) {
    // Its id is in the disclosure even where no amount of it is said; the warning names it as the lines do.
    return [{ kind: "effect-unknown", text: `${facts.unnamed.The(tokenId)}: its details didn't load, so its worth isn't known. Its id is in Details.` }];
  }
  if (KNOWN_COINS.has(contract) || isOmft(contract)) return [];
  return [{ kind: "unknown-contract", text: "ZeroFee doesn't know this coin. Names can be copied, so check it's the right one." }];
}

function spend(tokenId: string, units: string, facts: IntentsFacts): { warnings: Warning[]; effects: Described["effects"] } {
  const c = coin(tokenId, facts);
  const balance = facts.balances.get(tokenId);
  if (!c || balance === undefined) return { warnings: [], effects: [] };
  const amount = BigInt(units);
  const warnings: Warning[] = amount * 2n > balance ? [{ kind: "large-amount", text: `This is more than half of your ${c.symbol}.` }] : [];
  return { warnings, effects: [{ token: c.symbol, before: formatShort(balance, c.decimals, "down"), after: formatShort(balance - amount, c.decimals, "down") }] };
}

/** An outside address in a title (format.ts, its one home: the Sim's sheet says it the same). */
const shortAddress = outsideShort;
/** The payee's whole address, one tap away on the sheet, never a raw "Details:" line (mainnet rehearsal, 3 Nov). */
const inFull = (address: string): Described["details"] => [{ label: "The address in full", lines: [address] }];

/**
 * Into one of the account's own private wallets through 1Click (checkIntents made sure of it): the Add into Trade's
 * float, or a move into the private pocket. `send` is the line for what leaves.
 */
/**
 * A swap-service step's title may lead with what leaves, in dollars ("Top up Spending with $21.04 (21.0412 USDC)"), only
 * when that is also what arrives: the same coin by name and decimals on both ends, and at least 99% of it promised
 * (security review of J6, M1: "Move $10.05 (10.05 USDC)" over a promise of 4.917 USDC hid a 51% loss). Anything else,
 * a coin ZeroFee can't name included, keeps the title that names what arrives.
 */
function sameMoney(fromTokenId: string, units: unknown, quote: QuoteFacts, facts: Facts): boolean {
  const a = coin(fromTokenId, facts), b = coin(quote.destinationAsset, facts);
  if (!a || !b || a.symbol !== b.symbol || a.decimals !== b.decimals || !isUnits(units) || !isUnits(quote.minAmountOut)) return false;
  return BigInt(quote.minAmountOut) * 100n >= BigInt(units as string) * 99n;
}

function intoOwnWords(own: string, quote: QuoteFacts, send: string, warnings: Warning[], effects: Described["effects"], facts: Facts, same = false, paid?: string): Described {
  // the "at least" into the person's own pot, to 4 places rounded down (a promise never shown as more); what leaves stays exact
  const out = fourPlacesText(money(quote.destinationAsset, quote.minAmountOut, facts));
  const promise: Warning = { kind: "effect-unknown", text: "The swap service promises the payout. What you approve here is your payment to it." };
  // Home's Swap (audit 2 Nov, S1): another coin of the Safe changed into Spending's coin is a swap, and its sheet is two
  // lines: "Swap $2.10 (0.4740 NEAR) for USDC" (what leaves, dollars first, its exact coin figure once in brackets) and
  // "From your Safe. At least 2.0812 USDC lands in Spending." (what the swap service promises, review J6 M1: a payout
  // that isn't the same money is always said). The refund and the deposit address stay the core's checks, not lines.
  const outSymbol = coin(quote.destinationAsset, facts)?.symbol;
  // The same coin into Spending (Home's Move, a site's Add, Trade's Top up; audit 2 Nov, S1 widened): the money sheet's
  // verb and one line, "Move $3.00 (3 USDC) to Trading" · "From your Safe." The title says what this signature does;
  // where an app sends it on from Spending is that app's move, never written here as this approval's.
  if (own === TRADING_BALANCE && same && paid) {
    // D108 (QA 3 Nov): the pot's name is Trading; the bytes say Spending's balance, never which row (Move says that, before)
    return { title: `Move ${paid} to ${TRADING_BALANCE}`, titleFor: (money: string) => `Move ${money} to ${TRADING_BALANCE}`, lines: ["From your Safe."], warnings, effects: [], bare: true };
  }
  // wrap.near's wNEAR is NEAR one for one, and the Safe calls it NEAR: the sheet says the same name (review of S1)
  // only wrap.near itself, never a coin that merely calls itself wNEAR (review of S1)
  const asNear = (s: string) => (nep141Contract(quote.originAsset) === "wrap.near" ? s.replace(/\bwNEAR\b/g, "NEAR") : s);
  const paidSymbol = coin(quote.originAsset, facts)?.symbol;
  if (own === TRADING_BALANCE && !same && paid && outSymbol && paidSymbol !== outSymbol) {
    return {
      title: asNear(`Swap ${paid} for ${outSymbol}`),
      titleFor: (money: string) => asNear(`Swap ${money} for ${outSymbol}`),
      // the refund lands in Spending, not the Safe the money left: said (review of S1)
      lines: [`From your Safe. At least ${out} lands in ${TRADING_BALANCE}.`, `If the swap fails, it comes back to ${TRADING_BALANCE}.`],
      warnings,
      effects: [],
      bare: true,
      intoNearWallet: true,
    };
  }
  if (own === TRADING_BALANCE) {
    return {
      title: `Move ${about(quote.destinationAsset, quote.minAmountOut, facts)} to ${TRADING_BALANCE}`,
      titleFor: same ? (money: string) => `Move ${money} to ${TRADING_BALANCE}` : null,
      // audit H1: only what's true, never "privately" (an amount and time can still be matched)
      lines: [send, `At least ${out} lands in ${TRADING_BALANCE}. The swap service promises it.`, `If it can't, the money comes back to ${TRADING_BALANCE}.`],
      warnings: [...warnings, promise],
      effects,
    };
  }
  // a Send's fill (product decision, 5 Nov; QA's MUSTs 1 and 4): ONE sheet for the Safe's move in and the payout
  // it pays for, the payee in full and first (D37) and what they get from 1Click's signed quote, the split from the core's figures
  // (send-fill.ts made the block, loaded only with a Send's fill; "They get" is this sheet's own money words)
  const sent = own === PRIVATE_POCKET ? facts.sendFill : undefined;
  if (sent) {
    return {
      title: sent.title,
      titleFor: null,
      // the full address from the signed quote first, unfolded, then where it lands (the audit's D37 condition, the copy review's words), as
      // every outside sheet; then Private said once, the split, what they get
      lines: [sent.to, sent.seen, PRIVATE_SAID, `${SEND_LEG_WORDS.gets} · ${fourPlacesText(money(sent.destinationAsset, sent.amountOut, facts))}${sent.gets ? ` (${sent.gets})` : ""}`, ...sent.lines, LEG_WORDS.seen, `If it can't, the money comes back to ${PRIVATE_POCKET}`, PRIVATE_RECEIPT],
      warnings: [...warnings, promise],
      effects,
    };
  }
  // a Move's legs to one wallet under this one approval (QA, 5 Nov; the design session's ruling): the block,
  // and the title names its Together figure, no source ("Move $5.00 to Private")
  const legs = legsBlock(quote, facts);
  return {
    title: legs ? legs.title : `Move ${about(quote.destinationAsset, quote.minAmountOut, facts)} to your private balance`,
    titleFor: legs ? null : same ? (money: string) => `Move ${money} to your private balance` : null,
    // the legs right under the title, never folded away (the ruling, the audit and the copy review, 5 Nov); then Private said once (the
    // pair-private walk, 5 Nov; words by the design session), and the receipt line: who moves it, and that ZeroFee takes
    // no fee of its own
    lines: [...(legs ? [...legs.lines, LEG_WORDS.seen] : []), PRIVATE_SAID, send, `At least ${out} lands in ${PRIVATE_POCKET}. The swap service promises it.`, `If it can't, the money comes back to ${PRIVATE_POCKET}`, "It pays only when you hold Send or Pay.", PRIVATE_RECEIPT],
    warnings: [...warnings, promise],
    effects,
    // the block says the Safe's figure (its bytes' amountIn): the sheet draws no "Amount:" line over it (QA's Sim re-check
    // 4: "Amount: $40.00" over "Together · $50.00"); one amount, said once
    ...(legs ? { amountSaid: true as const } : {}),
  };
}

/** The fill sheet's legs block (QA's MUST, 5 Nov: only what the core signed or read itself), as the audit and the copy review ruled
 *  it (5 Nov): the title is the Move's own figure and its wallet, "Move $30.00 to your SOL wallet", then "From Private ·
 *  $12.50", "From your Safe · $20.00", "Stays in Private · $2.50", "Together · $30.00", which add up. The Safe's figure is
 *  the signed bytes' own (the quote's amountIn, which checkIntents ties to them), the only Safe figure on the sheet;
 *  the Move's figure is the core's own record of the pocket's share (moveFill.privateUnits) plus what the payment out of
 *  Private pays (moveFill.payUnits, 1Click's signed amountIn), in the same coin; Private's line is that figure less the
 *  Safe's (splitLines: what Private really pays), what stays the Safe's less the Move's. A dollar coin is said to the cent (rounded down), any other as its coin amount.
 *  Private's line not known: the title and "Your Safe adds $20.00 to Private first." alone. The wallet is named only when
 *  the core's ownPayee said it is the person's own (moveFill.payeeOwn) and its own list names it; else, or with no
 *  record, the title is the bytes' own ("Move $20.00 to Private"). Null: not a Move's fill, or a coin the core can't name. */
function legsBlock(quote: QuoteFacts, facts: Facts): { lines: string[]; title: string } | null {
  const m = facts.moveFill;
  if (!m || !isUnits(quote.amountIn)) return null;
  const c = coin(quote.originAsset, facts);
  if (!c) return null;
  // a dollar coin in whole cents (each figure rounded down, Together the others' sum, so the lines always add up); any
  // other coin in its own units
  const dollar = /^USD[CT]$/i.test(c.symbol) && c.decimals >= 2;
  const unit = (u: bigint) => (dollar ? u / 10n ** BigInt(c.decimals - 2) : u);
  const say = (v: bigint): string => (dollar ? `$${(v / 100n).toLocaleString("en-US")}.${String(v % 100n).padStart(2, "0")}` : fourPlacesText(money(quote.originAsset, v.toString(), facts)));
  const safe = unit(BigInt(quote.amountIn));
  const mine = m.privateTokenId === quote.originAsset;
  const priv = mine && m.privateUnits && isUnits(m.privateUnits) ? unit(BigInt(m.privateUnits)) : 0n;
  const pay = mine && m.payUnits && isUnits(m.payUnits) ? unit(BigInt(m.payUnits)) : null;
  const named = m.payee && m.payeeOwn === true ? facts.ownWallets?.get(m.payee) : undefined;
  const alone = { lines: [LEG_WORDS.adds(say(safe))], title: `Move ${say(safe)} to Private` };
  if (pay === null || pay <= 0n) return alone;
  const typed = priv + pay, stays = priv + safe - typed;
  // the Safe bringing less than the payment pays: not a sum the core can stand behind, the bytes' own words
  if (stays < 0n) return alone;
  const title = named ? `Move ${say(typed)} to ${named}` : alone.title;
  if (priv <= 0n) return { lines: alone.lines, title };
  return { lines: splitLines(typed, safe, say), title };
}

/** At most 4 decimal places in a sheet's coin figures (format.ts, its one home: the Sim's sheet reads it too). */
export { fourPlacesText } from "./format.ts";

/** Plain words for one call on intents.near, or null to fall back to the generic words. A coin it can't name is said
 *  as one, its id and exact amount going to `unnamed`, the sheet's own disclosure (one per sheet). */
export function describeIntentsCall(a: DecodedAction, tx: DecodedTx, facts: IntentsFacts, unnamed: Unnamed): Described | null {
  return intentsWords(a, tx, { ...facts, unnamed });
}

function intentsWords(a: DecodedAction, tx: DecodedTx, facts: Facts): Described | null {
  const args = argsOf(a);
  // The move into Private (or the Add) paid by the coin's own contract from the account: only a quote this core asked
  // for itself is in the facts, and checkIntents has matched it to these bytes.
  if (isDepositTransfer(a, args) && tx.receiverId !== INTENTS.account) {
    const quote = facts.quotes.get(args.receiver_id);
    const own = quote ? facts.ownWallets?.get(quote.recipient) : undefined;
    if (!quote || !isUnits(quote.minAmountOut) || (own !== TRADING_BALANCE && own !== PRIVATE_POCKET)) return null;
    const tokenId = `nep141:${tx.receiverId}`;
    return (intoOwnWords(own, quote, `Send ${money(tokenId, args.amount, facts)} from your Safe to the swap service`, coinWarnings(tokenId, facts), [], facts, sameMoney(tokenId, args.amount, quote, facts), money(tokenId, args.amount, facts)));
  }
  if (a.kind !== "call" || tx.receiverId !== INTENTS.account || !args) return null;
  const changed: Warning[] = facts.codeMatches ? [] : [{ kind: "unknown-contract", text: "Your Safe's coins have moved to a place this ZeroFee doesn't know. Read every line." }];

  if ((a.method === "mt_transfer" || a.method === "mt_transfer_call") && typeof args.receiver_id === "string" && typeof args.token_id === "string" && isUnits(args.amount)) {
    const amount = money(args.token_id, args.amount, facts);
    const { warnings, effects } = spend(args.token_id, args.amount, facts);
    const quote = a.method === "mt_transfer" ? facts.quotes.get(args.receiver_id) : undefined;
    if (quote && isUnits(quote.minAmountOut)) {
      // the fill's one bridge leg (Train 19: the Safe's NEAR Intents balance into Private by one mt_transfer, its quote
      // taking the deposit INTENTS): the same words as the move in paid out of the ledger (checkIntents matched it)
      const ownIn = quote.depositType === "INTENTS" && quote.recipientType === "CONFIDENTIAL_INTENTS" && quote.refundTo === quote.recipient ? facts.ownWallets?.get(quote.recipient) : undefined;
      if (ownIn === TRADING_BALANCE || ownIn === PRIVATE_POCKET) {
        return intoOwnWords(ownIn, quote, `Send ${amount} from ${signerBalance(tx, facts)} to the swap service`, [...changed, ...coinWarnings(args.token_id, facts), ...warnings], effects, facts, sameMoney(args.token_id, args.amount, quote, facts), amount);
      }
      const out = money(quote.destinationAsset, quote.minAmountOut, facts);
      const contract = nep141Contract(quote.destinationAsset);
      const where = quote.recipientType === "INTENTS" ? " on NEAR" : contract && homeChain(contract) ? ` on ${homeChain(contract)}` : "";
      const symbol = coin(args.token_id, facts)?.symbol ?? "coins";
      // To one of the account's own wallets (the core's own list): named by its row ("your SOL row"), no address line and
      // no chain after it (the row says the chain); the person's own wallet needs no recipient shown (D37 is for others)
      // The Safe's swap in place (safe-swap.ts): INTENTS in and out, delivered and refunded to the very account that signs.
      // The sheet names the action and the amount the person chose, never "Pay … to <the Safe's own name>" (UI audit, 5 Nov)
      if (quote.recipientType === "INTENTS" && quote.recipient === tx.signerId && quote.refundTo === tx.signerId) {
        const near = (t: string) => (nep141Contract(quote.destinationAsset) === "wrap.near" || nep141Contract(args.token_id) === "wrap.near" ? t.replace(/\bwNEAR\b/g, "NEAR") : t);
        const outSymbol = coin(quote.destinationAsset, facts)?.symbol ?? "coins";
        return {
          title: near(`Swap ${amount} for ${outSymbol}`),
          titleFor: (m: string) => near(`Swap ${m} for ${outSymbol}`),
          lines: [near(`At least ${fourPlacesText(out)} lands in your Safe.`), near(`If it doesn't swap, your ${symbol} comes back to your Safe.`)],
          warnings: [...changed, ...coinWarnings(args.token_id, facts), ...coinWarnings(quote.destinationAsset, facts), ...warnings],
          effects,
        };
      }
      const own = quote.recipientType === "INTENTS" ? undefined : facts.ownWallets?.get(quote.recipient);
      const from = signerBalance(tx, facts);
      const ownWhere = own && / row$/.test(own) ? "" : where;
      return {
        // "Pay" names what arrives; "Send" only with the dollars-first title, whose figure is what leaves (review, Job 1)
        title: own ? `Move ${about(quote.destinationAsset, quote.minAmountOut, facts)} to ${own}` : `Pay ${out} to ${shortAddress(quote.recipient)}`,
        // Dollars first: what leaves, in dollars and its coin (the sheet's amount); what arrives is the next lines'.
        titleFor: sameMoney(args.token_id, args.amount, quote, facts) ? (money: string) => (own ? `Move ${money} to ${own}` : `Send ${money} to ${shortAddress(quote.recipient)}`) : null,
        lines: own
          ? [`Send ${amount} from ${from} to the swap service`, `The swap service promises at least ${fourPlacesText(out)} to ${own}${ownWhere}`, `If it can't, your ${symbol} comes back to ${from}`]
          : [`Send ${amount} from ${from} to the swap service`, `The swap service promises at least ${out} to ${shortAddress(quote.recipient)}${where}`, `If it can't, your ${symbol} comes back to ${from}`],
        ...(own ? {} : { details: inFull(quote.recipient) }),
        warnings: [...changed, ...coinWarnings(args.token_id, facts), ...coinWarnings(quote.destinationAsset, facts), ...warnings, { kind: "effect-unknown", text: "The swap service promises the payout. What you approve here is your payment to it." }],
        effects,
      };
    }
    const lines = [`Send ${amount} from ${signerBalance(tx, facts)} to ${args.receiver_id}, on NEAR`];
    if (typeof args.memo === "string" && args.memo) lines.push(`Note: ${readable(args.memo)}`);
    const extra: Warning[] = [];
    if (a.method === "mt_transfer_call") {
      lines.push(`And ask ${args.receiver_id} to act on it`, `With: ${JSON.stringify(args.msg ?? "")}`);
      extra.push({ kind: "effect-unknown", text: `ZeroFee can't tell what ${args.receiver_id} will do with it.` });
    }
    return { title: `Send ${amount} to ${args.receiver_id}`, lines, warnings: [...changed, ...coinWarnings(args.token_id, facts), ...warnings, ...extra], effects };
  }

  if (a.method === "ft_withdraw" && typeof args.token === "string" && typeof args.receiver_id === "string" && isUnits(args.amount)) {
    const tokenId = `nep141:${args.token}`;
    const amount = money(tokenId, args.amount, facts);
    const { warnings, effects } = spend(tokenId, args.amount, facts);
    const quote = facts.quotes.get(args.receiver_id);
    if (quote && isUnits(quote.minAmountOut)) {
      const out = money(quote.destinationAsset, quote.minAmountOut, facts);
      const contract = nep141Contract(quote.destinationAsset);
      const where = quote.recipientType === "INTENTS" ? " on NEAR" : contract && homeChain(contract) ? ` on ${homeChain(contract)}` : "";
      // To one of the account's own wallets (the core's own list): named by it, the address only under Details.
      const own = quote.recipientType === "INTENTS" ? undefined : facts.ownWallets?.get(quote.recipient);
      // The Add (TRADE-FLOAT S7) into Trade's float, or a move into the private pocket: privately; a refund comes back to
      // that wallet, not the account.
      if ((own === TRADING_BALANCE || own === PRIVATE_POCKET) && quote.refundTo === quote.recipient) {
        return intoOwnWords(own, quote, `Send ${amount} from ${signerBalance(tx, facts)} to the swap service`, [...changed, ...coinWarnings(tokenId, facts), ...warnings], effects, facts, sameMoney(tokenId, args.amount, quote, facts), amount);
      }
      if (own) {
        return {
          title: `Move ${about(quote.destinationAsset, quote.minAmountOut, facts)} to ${own}`,
          titleFor: sameMoney(tokenId, args.amount, quote, facts) ? (money: string) => `Move ${money} to ${own}` : null,
          lines: [`Send ${amount} from ${signerBalance(tx, facts)} to the swap service`, `The swap service promises at least ${out} to ${own}${where}`, `If it can't, your ${coin(tokenId, facts)?.symbol ?? "coins"} come back to ${signerBalance(tx, facts)}`],
          details: inFull(quote.recipient),
          warnings: [...changed, ...coinWarnings(tokenId, facts), ...warnings, { kind: "effect-unknown", text: "The swap service promises the payout. What you approve here is your payment to it." }],
          effects,
        };
      }
      return {
        title: `Pay ${out} to ${shortAddress(quote.recipient)}`,
        titleFor: sameMoney(tokenId, args.amount, quote, facts) ? (money: string) => `Send ${money} to ${shortAddress(quote.recipient)}` : null,
        lines: [`Send ${amount} from ${signerBalance(tx, facts)} to the swap service`, `The swap service promises at least ${out} to ${shortAddress(quote.recipient)}${where}`, `If it can't, your ${coin(tokenId, facts)?.symbol ?? "coins"} come back to ${signerBalance(tx, facts)}`],
          details: inFull(quote.recipient),
        warnings: [...changed, ...coinWarnings(tokenId, facts), ...warnings, { kind: "effect-unknown", text: "The swap service promises the payout. What you approve here is your payment to it." }],
        effects,
      };
    }
    const toHomeChain = args.receiver_id === args.token && isOmft(args.token) && typeof args.memo === "string" && args.memo.startsWith("WITHDRAW_TO:") && args.msg == null;
    if (toHomeChain) {
      const address = args.memo.slice("WITHDRAW_TO:".length);
      const chain = homeChain(args.token) ?? "its home chain";
      const own = facts.ownWallets?.get(address);
      if (own) {
        return {
          title: `Move ${about(tokenId, args.amount, facts)} to ${own}`,
          titleFor: (money) => `Move ${money} to ${own}`,
          lines: [`Move ${amount} from ${signerBalance(tx, facts)} to ${own} on ${chain}`],
          details: inFull(address),
          warnings: [...changed, ...coinWarnings(tokenId, facts), ...warnings],
          effects,
        };
      }
      return {
        title: `Send ${amount} to ${shortAddress(address)} on ${chain}`,
        lines: [`Send ${amount} from ${signerBalance(tx, facts)} to ${address} on ${chain}`, "Check the address. Coins sent to a wrong address are gone for good."],
        warnings: [...changed, ...coinWarnings(tokenId, facts), ...warnings],
        effects,
      };
    }
    const lines = [`Move ${amount} from ${signerBalance(tx, facts)} to ${args.receiver_id} on NEAR`];
    if (typeof args.memo === "string" && args.memo) lines.push(`Note: ${readable(args.memo)}`);
    const extra: Warning[] = [];
    if (args.msg != null) {
      lines.push(`And ask ${args.receiver_id} to act on it`, `With: ${JSON.stringify(args.msg)}`);
      extra.push({ kind: "effect-unknown", text: `If ${args.receiver_id} refuses it, the coins don't come back to ${signerBalance(tx, facts)}.` });
    }
    return { title: `Move ${amount} to ${args.receiver_id}`, lines, warnings: [...changed, ...coinWarnings(tokenId, facts), ...warnings, ...extra], effects };
  }

  // Any other intents.near method: ZeroFee knows the contract, but not this step's effect.
  return {
    title: "A step ZeroFee can't explain",
    lines: ["It asks the place that holds your Safe's coins to do something ZeroFee can't read.", `With: ${JSON.stringify(args)}`],
    warnings: [...changed, { kind: "effect-unknown", text: "ZeroFee can't tell what this step will do. Go on only if you know exactly what it is." }],
  };
}
