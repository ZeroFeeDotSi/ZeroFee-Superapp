// Paying from the pocket (Pay's private switch, Swap's private corridor): a quote paid from the pocket's confidential
// balance. 1Click builds the transfer (generate-intent), the core checks it and signs it with the pocket's key after its
// own sheet (subwallet.privatePay, Wallet's: the pocket is Wallet's), and 1Click runs it (submit-intent). Every 1Click
// call goes through the quote server. Loaded with the first private quote, never in Home's first load (speed budget,
// 3 Nov): the ledger hands over what it needs. The rules are the ledger's own, moved here unchanged.
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { payeeAsk } from "./payee-ask.ts";
import type { AccountInfo } from "@zerofee/core/signer";
import { fromUnits, toUnits } from "./amount.ts";
import { QuoteRefused, type Apis, type QuoteRequest } from "./apis.ts";
import type { Catalogue } from "./catalogue.ts";
import { validAddress } from "./addresses.ts";
import { ACCOUNT_ID } from "./send.ts";
import { PRIVATE_KIND, type Movement, type PayQuote, type Payee } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";

type Caller = string;
export type PrivatePayHeld = { quote: PayQuote; outUnits: bigint; maxInUnits: bigint; pocket: string };
export interface PrivatePayDeps {
  myAccount: (ready: boolean) => Promise<AccountInfo>;
  pocketOf: () => Promise<{ id: string; address: string } | null>;
  privateQuotes: string | undefined;
  catalogue: () => Promise<Catalogue>;
  privatePayRequest: (o: { fromTokenId: string; toTokenId: string; to: Payee; outUnits?: bigint; pocket: string; dry: boolean }) => QuoteRequest;
  askPrivate: (r: QuoteRequest) => Promise<{ quote: { amountIn: string; amountOut: string; amountInUsd?: string; amountOutUsd?: string; timeEstimate?: number; depositAddress?: string }; zerofeeStatusTag?: string }>;
  privatePays: Map<string, PrivatePayHeld>;
  core: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  apis: Apis;
  relayed: string | undefined;
  remember: (m: Movement) => Promise<void>;
  emit: (event: string, payload: unknown) => void;
  trackQuote: (m: Movement, depositAddress: string, via?: string) => void;
  payeeText: (to: Payee) => string;
  iso: () => string;
  now: () => number;
  quoteTtlMs: number;
}

export function createPrivatePay(x: PrivatePayDeps) {
  const { myAccount, pocketOf, catalogue, privatePayRequest, askPrivate, privatePays, core, apis, relayed, remember, emit, trackQuote, payeeText, iso, now } = x;

  async function quotePayPrivately(fromTokenId: string, toTokenId: string, to: Payee, amountOut: string): Promise<PayQuote> {
    await myAccount(true);
    const pocket = await pocketOf();
    if (!pocket || !x.privateQuotes) throw new ProblemError(walletProblems.privateUnavailable());
    const cat = await catalogue();
    const toCoin = cat.coin(toTokenId);
    if (!cat.coin(fromTokenId) || !toCoin) throw new ProblemError(walletProblems.quoteUnavailable("You can't pay with those coins from Private."));
    if (to.kind === "chain" && (to.memo || toCoin.chain !== to.chain || !validAddress(to.chain, to.address.trim()))) throw new ProblemError(walletProblems.addressInvalid(cat.network(to.chain)?.name ?? to.chain));
    if (to.kind === "ledger" && !ACCOUNT_ID.test(to.accountId.trim())) throw new ProblemError(walletProblems.recipientInvalid());
    const outUnits = toUnits(amountOut, toCoin.decimals);
    if (outUnits === null || outUnits <= 0n) throw new ProblemError(walletProblems.amountInvalid());
    const r = await askPrivate(privatePayRequest({ fromTokenId, toTokenId, to, outUnits, pocket: pocket.address, dry: true }));
    const fromCoin = cat.coin(fromTokenId)!;
    const amountIn = fromUnits(r.quote.amountIn, fromCoin.decimals);
    const inUsd = Number(r.quote.amountInUsd ?? NaN), outUsd = Number(r.quote.amountOutUsd ?? NaN);
    const quote: PayQuote = {
      id: `pp-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      fromTokenId,
      toTokenId,
      to,
      amountIn,
      amountInExpected: amountIn,
      amountOut,
      ...(Number.isFinite(inUsd) && Number.isFinite(outUsd) ? { feeUsd: Math.max(0, inUsd - outUsd).toFixed(2) } : {}),
      feeNote: "The swap fee is in this price. Paid from Private.",
      ...(typeof r.quote.timeEstimate === "number" ? { etaSeconds: r.quote.timeEstimate } : {}),
      expiresAtIso: new Date(now() + x.quoteTtlMs).toISOString(),
      refundTo: pocket.address,
    };
    privatePays.set(quote.id, { quote, outUnits, maxInUnits: BigInt(r.quote.amountIn), pocket: pocket.address });
    return quote;
  }

  async function payPrivately(held: PrivatePayHeld, label: string | undefined, caller: Caller): Promise<Movement> {
    const { quote } = held;
    await myAccount(true);
    const pocket = await pocketOf();
    if (!pocket || pocket.address !== held.pocket || !x.privateQuotes) throw new ProblemError(walletProblems.privateUnavailable());
    // A real quote now: refused if it costs more, or pays less, than what was shown.
    const req = privatePayRequest({ fromTokenId: quote.fromTokenId, toTokenId: quote.toTokenId, to: quote.to, outUnits: held.outUnits, pocket: pocket.address, dry: false });
    const r = await askPrivate(req);
    const depositAddress = r.quote.depositAddress;
    if (!depositAddress || BigInt(r.quote.amountIn) > held.maxInUnits || BigInt(r.quote.amountOut) < held.outUnits) throw new ProblemError(walletProblems.quoteExpired());
    privatePays.delete(quote.id);
    let intent: Awaited<ReturnType<Apis["generateIntent"]>>;
    let submitted: { intentHash: string };
    try {
      intent = await apis.generateIntent(relayed!, pocket.address, depositAddress);
    } catch (e) {
      if (e instanceof QuoteRefused) throw new ProblemError(walletProblems.quoteUnavailable(e.message));
      throw e;
    }
    const symbol = (await catalogue()).coin(quote.toTokenId)?.symbol ?? "";
    // The core says whose words these are ("Pay says: …").
    const why = label ?? `Pay ${quote.amountOut} ${symbol} to ${payeeText(quote.to)}`;
    // The quote's status tag lets the core read this quote back from the relay before it signs.
    // H4: the person's own payee and amount, so the core signs only a quote that pays exactly them
    const signed = await core<{ signedData?: unknown; declined?: true }>("subwallet.privatePay", { id: pocket.id, depositAddress, intent: { payload: intent.payload }, why, ...(r.zerofeeStatusTag ? { statusTag: r.zerofeeStatusTag } : {}), payee: payeeAsk(req, held.outUnits) });
    if (signed.declined || !signed.signedData) throw new ProblemError(walletProblems.declined());
    try {
      submitted = await apis.submitIntent(relayed!, signed.signedData);
    } catch (e) {
      if (e instanceof QuoteRefused) throw new ProblemError(walletProblems.quoteUnavailable(e.message));
      throw e;
    }
    const at = iso();
    const movement: Movement = {
      id: `pay:${submitted.intentHash}`,
      kind: "pay",
      status: "moving",
      from: quote.fromTokenId,
      to: payeeText(quote.to),
      amount: quote.amountIn,
      startedAtIso: at,
      updatedAtIso: at,
      explorerUrls: [],
      ...(label ? { label } : {}),
      caller,
      private: true,
    };
    await remember(movement);
    emit("ledger.balancesChanged", {});
    trackQuote(movement, depositAddress, relayed);
    return movement;
  }

  return { quotePayPrivately, payPrivately };
}

/**
 * Out of the pocket (money is never stuck): every coin in it, or the one asked for, home to the same coin in the main
 * balance. The core moves it with the pocket's key, to the main account only (subwallet.private.home); each coin is a
 * movement, followed in Activity from the core's own record of it. Moved here from the ledger unchanged (speed budget).
 * `upTo` (the audit's SHOULD, 8 Nov): what the person's Check this showed, per coin ({tokenId: decimal}): each coin moves at most
 * that, and a coin it didn't show moves not at all, so money that reached Private after the sheet opened (a refund, a
 * fill) stays private. Without it, all of each coin, as before. Only the amount the core is asked for changes.
 */
export async function fromPrivate<M extends { id: string; status: string }>(p: Record<string, unknown>, caller: Caller, x: {
  rows: { tokenId: string; amount: string }[];
  home: (tokenId: string, key: string, amount: string) => Promise<{ ok: M } | { problem: Problem }>;
  /** The coin's decimals, as the rows were worked out with (needed only with `upTo`). */
  decimals?: (tokenId: string) => number;
  status: (m: M) => Movement["status"];
  remember: (m: Movement) => Promise<void>;
  emit: (event: string, payload: unknown) => void;
  iso: () => string;
}): Promise<Movement[]> {
  const upTo = p.upTo;
  if (upTo !== undefined && (typeof upTo !== "object" || upTo === null || Array.isArray(upTo) || Object.values(upTo).some((v) => typeof v !== "string"))) throw new ProblemError(walletProblems.amountInvalid());
  const coinsOut = x.rows.filter((r) => (p.tokenId === undefined || r.tokenId === p.tokenId) && Number(r.amount) > 0);
  const out: Movement[] = [];
  for (const row of coinsOut) {
    // what this coin may move: all of it, or (upTo) the least of what it holds now and what the sheet showed
    let amount = "all", said = row.amount;
    if (upTo !== undefined) {
      const shown = (upTo as Record<string, string>)[row.tokenId];
      if (shown === undefined) continue;
      const d = x.decimals?.(row.tokenId) ?? 0;
      const have = toUnits(row.amount, d), most = toUnits(shown, d);
      if (have === null || most === null) throw new ProblemError(walletProblems.amountInvalid());
      const units = have < most ? have : most;
      if (units <= 0n) continue;
      amount = units.toString();
      said = fromUnits(units, d);
    }
    const key = `wallet-home-${row.tokenId.replace(/[^A-Za-z0-9]/g, "").slice(-24)}-${Date.now().toString(36)}`;
    const moved = await x.home(row.tokenId, key, amount);
    if ("problem" in moved) throw new ProblemError(moved.problem);
    const at = x.iso();
    const m: Movement = { id: `home:${moved.ok.id}`, kind: "private", status: x.status(moved.ok), from: PRIVATE_KIND, to: row.tokenId, amount: said, startedAtIso: at, updatedAtIso: at, explorerUrls: [], caller };
    await x.remember(m);
    out.push(m);
  }
  x.emit("ledger.balancesChanged", {});
  return out;
}
