// Swap in place (product decision, 5 Nov; the HOME-SAFE-HOT spec): the ONE path for Swap and for Buy and Sell
// of the intents coins (Home's Swap, the coin page, Trade's "Native coins"). Two coins listed on NEAR Intents swap inside
// it, never withdrawn, never bridged:
//   ledger.swapQuote { from, to, amountIn, source }   a dry price (display only); amounts in the coin's own units
//   ledger.swap      { quoteId }                      the job, at once; ledger.movementUpdated follows it to its end
// source "safe": the Safe's intents.near balance. ONE on-chain call the account contract makes and counts (mt_transfer of
//   exactly amountIn to the quote's deposit address), one Face ID; the quote is the core's own (subwallet.safeSwapQuote:
//   asked through the pinned relay, held as 1Click signed it, at least the figure shown), and the Safe's sheet checks the
//   transfer against it. No Safe key on intents.near (QA's rule).
// source "private": the NEAR wallet's private balance (NEAR Confidential): its cash (USDC) and a coin, ONE intent its
//   key signs (subwallet.float.swap).
// 1Click prices both today (only where no direct path is open; its name is on the fee line). The end is
// read, never promised: 1Click's own status for THIS swap's deposit address (the sandbox hunt, 5 Nov, B1: a balance
// rise is anyone's deposit, never this swap's end), or the NEAR wallet's move. Neither watcher ever gives up: past its
// fast minutes it keeps a slow read, and a reload follows the job again (resume). Loaded with its first use.
import type { Bridge } from "@zerofee/core/bridge";
import { INTENTS } from "@zerofee/core/intents";
import { ACCOUNT_POLICY } from "@zerofee/core/known-contracts";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { quoteDeadline } from "@zerofee/core/quote-deadline";
import type { Block } from "@zerofee/core/chain";
import type { TxRequest } from "@zerofee/core/signer";
import type { Caller } from "./ledger.ts";
import { fromUnits, toUnits } from "./amount.ts";
import { QuoteRefused, type Apis, type QuoteRequest, type QuoteResponse } from "./apis.ts";
import type { Catalogue } from "./catalogue.ts";
import { mtTransfer } from "./moves.ts";
import { safeCanSell } from "@zerofee/core/band-coins";
import type { Movement, Quote } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";

/** The NEAR wallet's cash and the Safe's USDC (1Click's USDC on NEAR Intents). */
export const SWAP_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ASSET = /^(?:nep141:[a-z0-9_.-]{2,64}|nep245:[a-z0-9_.-]{2,64}:[A-Za-z0-9_.-]{1,80})$/;
export const SWAP_QUOTE_TTL_MS = 30_000;
/** The Safe's end read: 1Click's status for its deposit address every 400 ms for 10 minutes, then the ledger's own
 *  follow (every 10 s, until it ends). The NEAR wallet's: its move every 250 ms for 10 minutes, then every 10 s. */
export const SAFE_WATCH_MS = 400, SAFE_WATCH_FOR_MS = 10 * 60_000;
export const PRIVATE_WATCH_MS = 250, SLOW_WATCH_MS = 10_000;

export type SwapSource = "safe" | "private";
export interface SwapJob extends Movement { source: SwapSource }

export interface IntentsSwapDeps {
  bridgeFor: (caller: Caller) => Bridge;
  myAccount: (ready: boolean) => Promise<{ accountId: string }>;
  /** The coin's decimals and symbol, from 1Click's list. */
  coin: (tokenId: string) => Promise<{ decimals: number; symbol: string } | null>;
  /** 1Click's status for one deposit address (through the relay, with the quote's tag), or null when unread. */
  status: (depositAddress: string, tag?: string) => Promise<{ status: string; amountOut?: string } | null>;
  /** intents.near's mt_balance_of for an account, at a final block (two nodes). */
  ledgerBalance: (accountId: string, tokenId: string, block?: Block) => Promise<bigint>;
  /** The account contract's current version (it runs the one approval). */
  canChain: (accountId: string) => Promise<boolean>;
  /** A dry 1Click quote through the pinned relay (display only). */
  dryQuote: (request: QuoteRequest) => Promise<QuoteResponse>;
  signAll: (requests: TxRequest[], caller: Caller, since?: number) => Promise<{ txHash: string; explorerUrls: string[]; hold?: Movement["held"]; unsent?: number }>;
  approvals: (steps: TxRequest[], canChain: boolean) => TxRequest[];
  remember: (m: Movement) => Promise<void>;
  /** 1Click's status follow (the ledger's slow path), for a Safe swap the fast read didn't see end. */
  follow: (m: Movement, depositAddress: string) => void;
  now: () => number;
  iso: () => string;
  sleep?: (ms: number) => Promise<void>;
}

interface Kept { quote: Quote; source: SwapSource; units: string; minRaw: string; side?: "buy" | "sell"; coin?: string; at: number }

const text = (v: unknown) => (typeof v === "string" ? v : "");
const pct = (fee: number, of: number) => (of > 0 ? ` (${((fee / of) * 100).toFixed(2)}%)` : "");
/** The fee line: who prices it, by name, and what it costs, from the quote's own dollars. */
export const feeNoteOf = (feeUsd: number | undefined, inUsd: number): string =>
  feeUsd === undefined ? "NEAR Intents prices it. Fees are in the price." : `NEAR Intents prices it. Fees about $${feeUsd.toFixed(2)}${pct(feeUsd, inUsd)}, all in the price.`;

/** The private route of a pair: the NEAR wallet's cash and one coin; null for any other pair. */
export function privateSide(from: string, to: string): { side: "buy" | "sell"; coin: string } | null {
  if (from === SWAP_USDC && to !== SWAP_USDC && to.startsWith("nep141:")) return { side: "buy", coin: to };
  if (to === SWAP_USDC && from !== SWAP_USDC && from.startsWith("nep141:")) return { side: "sell", coin: from };
  return null;
}

/** Whose "no" a refused quote is: the relay's own ("quotes.*", e.g. a relay without the Safe-swap case) is ZeroFee's price
 *  server's, by name; anything else is 1Click's (its message, as it said it). Rule 8: never blame 1Click for ours. */
export const quoteRefusedProblem = (e: QuoteRefused): Problem =>
  typeof e.code === "string" && e.code.startsWith("quotes.") ? walletProblems.swapServerRefused(e.message) : walletProblems.quoteUnavailable(e.message);

/** The Safe's dry quote: INTENTS in, INTENTS out, into the Safe and refunded there (the relay's Safe case). */
export const safeQuoteRequest = (o: { from: string; to: string; units: string; account: string; deadlineIso: string }): QuoteRequest => ({
  dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: o.from, depositType: "INTENTS", destinationAsset: o.to, amount: o.units,
  refundTo: o.account, refundType: "INTENTS", recipient: o.account, recipientType: "INTENTS", deadline: o.deadlineIso, confidentiality: "basic",
});

export function createIntentsSwap(d: IntentsSwapDeps) {
  const kept = new Map<string, Kept>();
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const sweep = () => { for (const [k, v] of kept) if (d.now() - v.at > SWAP_QUOTE_TTL_MS) kept.delete(k); };

  async function swapQuote(p: Record<string, unknown>, caller: Caller): Promise<Quote & { source: SwapSource }> {
    const from = text(p.from), to = text(p.to), amountIn = text(p.amountIn), source = p.source;
    if (!ASSET.test(from) || !ASSET.test(to) || from === to) throw new ProblemError(walletProblems.quoteUnavailable("NEAR Intents doesn't swap one of these coins."));
    if (source !== "safe" && source !== "private") throw new ProblemError(walletProblems.quoteUnavailable("Swap from your Safe or your NEAR wallet."));
    // the Safe swaps only coins it can also pay out with Face ID today (band-coins.ts safeCanSell, the one switch): never
    // a Buy it can't Sell, never a Sell that would wait a day
    if (source === "safe" && (!safeCanSell(from) || !safeCanSell(to))) throw new ProblemError(walletProblems.swapNotYet());
    const [fromCoin, toCoin] = await Promise.all([d.coin(from), d.coin(to)]);
    if (!fromCoin || !toCoin) throw new ProblemError(walletProblems.quoteUnavailable("NEAR Intents doesn't swap one of these coins."));
    const units = toUnits(amountIn, fromCoin.decimals);
    if (units === null || units <= 0n) throw new ProblemError(walletProblems.amountInvalid());
    const id = `sq-${d.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAtIso = new Date(d.now() + SWAP_QUOTE_TTL_MS).toISOString();
    if (source === "private") {
      const ps = privateSide(from, to);
      if (!ps) throw new ProblemError(walletProblems.quoteUnavailable("Your NEAR wallet swaps coins only to and from cash."));
      const r = await d.bridgeFor(caller).call<{ amountIn: string; amountOut: string; minAmountOut: string; decimals: number; coinUsd: number; etaSeconds?: number }>("subwallet.float.swapQuote", { side: ps.side, coin: ps.coin, amount: units.toString() });
      if ("problem" in r) throw new ProblemError(r.problem);
      const q = r.ok;
      const coinUsd = (raw: string) => (Number(raw) / 10 ** q.decimals) * q.coinUsd;
      const inUsd = ps.side === "buy" ? Number(q.amountIn) / 1e6 : coinUsd(q.amountIn);
      const outUsd = ps.side === "buy" ? coinUsd(q.amountOut) : Number(q.amountOut) / 1e6;
      const feeUsd = Number.isFinite(inUsd) && Number.isFinite(outUsd) ? Math.max(0, inUsd - outUsd) : undefined;
      const quote: Quote & { source: SwapSource } = {
        id, from, to, amountIn, amountOut: fromUnits(q.amountOut, toCoin.decimals), minOut: fromUnits(q.minAmountOut, toCoin.decimals),
        ...(feeUsd !== undefined ? { feeUsd: feeUsd.toFixed(2) } : {}), feeNote: feeNoteOf(feeUsd, inUsd),
        ...(q.etaSeconds ? { etaSeconds: q.etaSeconds } : {}), expiresAtIso, source,
      };
      sweep();
      kept.set(id, { quote, source, units: units.toString(), minRaw: q.minAmountOut, ...ps, at: d.now() });
      return quote;
    }
    const { accountId } = await d.myAccount(false);
    const held = await d.ledgerBalance(accountId, from);
    if (held < units) throw new ProblemError(walletProblems.balanceLow(amountIn, fromCoin.symbol));
    const r = await d.dryQuote(safeQuoteRequest({ from, to, units: units.toString(), account: accountId, deadlineIso: quoteDeadline(d.now(), 10 * 60_000) }));
    const inUsd = Number(r.quote.amountInUsd ?? NaN), outUsd = Number(r.quote.amountOutUsd ?? NaN);
    const feeUsd = Number.isFinite(inUsd) && Number.isFinite(outUsd) ? Math.max(0, inUsd - outUsd) : undefined;
    const quote: Quote & { source: SwapSource } = {
      id, from, to, amountIn, amountOut: fromUnits(r.quote.amountOut, toCoin.decimals), minOut: fromUnits(r.quote.minAmountOut, toCoin.decimals),
      ...(feeUsd !== undefined ? { feeUsd: feeUsd.toFixed(2) } : {}), feeNote: feeNoteOf(feeUsd, inUsd),
      ...(typeof r.quote.timeEstimate === "number" && r.quote.timeEstimate > 0 ? { etaSeconds: r.quote.timeEstimate } : {}), expiresAtIso, source,
    };
    sweep();
    kept.set(id, { quote, source, units: units.toString(), minRaw: r.quote.minAmountOut, at: d.now() });
    return quote;
  }

  async function swap(p: Record<string, unknown>, caller: Caller): Promise<SwapJob> {
    const to = await d.coin(text(kept.get(text(p.quoteId))?.quote.to));
    const since = Date.now();
    sweep();
    const k = kept.get(text(p.quoteId));
    if (!k) throw new ProblemError(walletProblems.quoteExpired());
    kept.delete(text(p.quoteId));
    const { quote } = k;
    const at = d.iso();
    const base = { kind: "swap" as const, from: quote.from, to: quote.to, amount: quote.amountIn, startedAtIso: at, updatedAtIso: at, ...(quote.feeUsd !== undefined ? { feeUsd: quote.feeUsd } : {}), ...(quote.etaSeconds ? { etaSeconds: quote.etaSeconds } : {}), caller };
    if (k.source === "private") {
      const key = `swap-${quote.id}`;
      const r = await d.bridgeFor(caller).call<{ id: string; status: string; reason?: string } | { declined: true }>("subwallet.float.swap", { side: k.side, coin: k.coin, amount: k.units, atLeast: k.minRaw, key });
      if ("problem" in r) throw new ProblemError(r.problem);
      if ("declined" in r.ok) throw new ProblemError(walletProblems.declined());
      const job: SwapJob = { ...base, id: `swap:${r.ok.id}`, status: "moving", explorerUrls: [], source: "private" };
      await d.remember(job);
      void watchPrivate(job, r.ok.id, caller, since, to?.decimals);
      return job;
    }
    // the Safe: the core's own quote (held to the figure shown), then ONE mt_transfer of exactly amountIn, one Face ID
    const { accountId } = await d.myAccount(true);
    const r = await d.bridgeFor(caller).call<{ depositAddress: string; amountIn: string; minAmountOut: string; statusTag?: string }>("subwallet.safeSwapQuote", { from: quote.from, to: quote.to, amount: k.units, atLeast: k.minRaw });
    if ("problem" in r) throw new ProblemError(r.problem);
    if (r.ok.amountIn !== k.units || !/^[0-9a-f]{64}$/.test(r.ok.depositAddress)) throw new ProblemError(walletProblems.quoteExpired());
    const tag = typeof r.ok.statusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(r.ok.statusTag) ? r.ok.statusTag : undefined;
    const why = `Swap ${quote.amountIn} in your Safe`;
    const steps = [mtTransfer({ to: r.ok.depositAddress, tokenId: quote.from, units: BigInt(k.units), why })];
    const signed = await d.signAll(d.approvals(steps, await d.canChain(accountId)), caller, since);
    const job: SwapJob = { ...base, id: `swap:${signed.txHash}`, status: signed.hold ? "waiting" : "moving", explorerUrls: signed.explorerUrls, depositAddress: r.ok.depositAddress, ...(tag ? { statusTag: tag } : {}), ...(signed.hold ? { held: signed.hold } : {}), source: "safe" };
    await d.remember(job);
    if (!signed.hold) void watchSafe(job, since, to?.decimals);
    return job;
  }

  /**
   * The Safe's swap ends ONLY on 1Click's own status for its deposit address (B1): SUCCESS is done, with what arrived as
   * 1Click settled it (swapDetails.amountOut, never the quote and never a balance rise, which is anyone's deposit);
   * REFUNDED is refunded at once (B2), FAILED a problem. Read every 400 ms from the tap; past 10 minutes the ledger's
   * follow (every 10 s, never giving up) takes over (B3).
   */
  async function watchSafe(job: SwapJob, tapMs: number, decimals?: number) {
    const dep = job.depositAddress!;
    const t0 = d.now();
    while (d.now() - t0 < SAFE_WATCH_FOR_MS) {
      await sleep(SAFE_WATCH_MS);
      const s = await d.status(dep, job.statusTag).catch(() => null);
      const status = s?.status ?? "";
      if (status === "SUCCESS") {
        const got = s?.amountOut && /^\d{1,40}$/.test(s.amountOut) && decimals !== undefined ? { amountOut: fromUnits(s.amountOut, decimals) } : {};
        await d.remember({ ...job, status: "done", updatedAtIso: d.iso(), settledMs: Date.now() - tapMs, ...got });
        return;
      }
      if (status === "REFUNDED") return void (await d.remember({ ...job, status: "refunded", updatedAtIso: d.iso() }));
      if (status === "FAILED") return void (await d.remember({ ...job, status: "problem", updatedAtIso: d.iso(), problem: walletProblems.convertFailed() }));
    }
    d.follow(job, dep);
  }

  /** The NEAR wallet's swap ends on its move's own end (the core's read of 1Click's status): every 250 ms for 10 minutes,
   *  then every 10 s until it ends (B3: never "moving" forever). */
  async function watchPrivate(job: SwapJob, moveId: string, caller: Caller, tapMs: number, decimals?: number) {
    const t0 = d.now();
    for (;;) {
      await sleep(d.now() - t0 < SAFE_WATCH_FOR_MS ? PRIVATE_WATCH_MS : SLOW_WATCH_MS);
      const r = await d.bridgeFor(caller).call<{ status: string; settled?: { amountOut?: string } }>("subwallet.float.move", { id: moveId }).catch(() => null);
      if (!r || !("ok" in r) || r.ok.status === "pending") continue;
      const status: Movement["status"] = r.ok.status === "done" ? "done" : r.ok.status === "refunded" ? "refunded" : "problem";
      // what arrived: 1Click's settled figure as the core read it, never the quote
      const out = r.ok.settled?.amountOut;
      const got = out && /^\d{1,40}$/.test(out) && decimals !== undefined ? { amountOut: fromUnits(out, decimals) } : {};
      const end = status === "done" ? { settledMs: Date.now() - tapMs, ...got } : status === "problem" ? { problem: walletProblems.convertFailed() } : {};
      await d.remember({ ...job, status, updatedAtIso: d.iso(), ...end });
      return;
    }
  }

  /** A reload (B3): a NEAR wallet swap still moving is followed again by its move id, at the slow pace. A Safe swap is
   *  followed by the ledger from its deposit address (resumeQuotes). */
  async function resume(job: Movement) {
    if (job.kind !== "swap" || job.status !== "moving" || job.source !== "private" || !job.id.startsWith("swap:") || !job.caller) return;
    const to = job.to ? await d.coin(job.to) : null;
    void watchPrivate({ ...job, source: "private" }, job.id.slice("swap:".length), job.caller as Caller, Date.parse(job.startedAtIso), to?.decimals);
  }

  return { swapQuote, swap, resume };
}

/** The ledger's own parts, wired here so the ledger (in Home's first load) carries one line for this. */
export function ledgerSwap(l: Pick<IntentsSwapDeps, "bridgeFor" | "myAccount" | "now" | "iso" | "signAll" | "approvals" | "remember"> & {
  chain: { view(contract: string, method: string, args: object, block: Block): Promise<unknown>; account(id: string, block: Block): Promise<{ codeHash?: string } | null>; commonBlock(): Promise<Block> };
  catalogue: () => Promise<Catalogue>; apis: Apis; relayed?: string; trackQuote: (m: Movement, depositAddress: string, via?: string) => void;
}) {
  const units = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : 0n);
  return createIntentsSwap({
    ...l,
    coin: async (tokenId) => { const c = (await l.catalogue()).coin(tokenId); return c ? { decimals: c.decimals, symbol: c.symbol } : null; },
    status: async (depositAddress, tag) => {
      const s = await l.apis.status(depositAddress, l.relayed, tag);
      const out = s?.swapDetails?.amountOut;
      return s ? { status: s.status, ...(typeof out === "string" ? { amountOut: out } : {}) } : null;
    },
    ledgerBalance: async (accountId, tokenId) => units(await l.chain.view(INTENTS.account, "mt_balance_of", { account_id: accountId, token_id: tokenId }, await l.chain.commonBlock())),
    canChain: async (accountId) => (await l.chain.account(accountId, await l.chain.commonBlock()))?.codeHash === ACCOUNT_POLICY.codeHashBase58,
    dryQuote: async (request) => {
      if (!l.relayed) throw new ProblemError(walletProblems.swapServerRefused("Swaps in your Safe aren't set up on this phone yet."));
      try { return await l.apis.quote(request, l.relayed); } catch (e) { if (e instanceof QuoteRefused) throw new ProblemError(quoteRefusedProblem(e)); throw e; }
    },
    follow: (m, depositAddress) => l.trackQuote(m, depositAddress, l.relayed),
  });
}
