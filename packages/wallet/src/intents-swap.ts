// Swap in place (product decision, 5 Nov; the HOME-SAFE-HOT spec): the ONE path for Swap and for Buy and Sell
// of the intents coins (Home's Swap, the coin page, Trade's "Native coins"). Two coins listed on NEAR Intents swap inside
// it, never withdrawn, never bridged:
//   ledger.swapQuote { from, to, amountIn, source }   a dry price (display only); amounts in the coin's own units
//   ledger.swap      { quoteId }                      the job, at once; ledger.movementUpdated follows it to its end
// source "safe": the Safe's intents.near balance, ONLY through NEAR Confidential (product decision, 8 Nov: "make it all
//   confidential"; core safe-swap-private.ts SAFE_SWAP_PRIVATE): Home's Send's own two legs (safe-send.ts swapFromSafe),
//   the coin into Private by ONE mt_transfer the account contract makes and counts, one Face ID, then Private pays NEAR
//   Intents, which swaps it and lands the coin got back in the Safe. The public swap (the Safe paying an INTENTS-to-INTENTS
//   quote straight) is gone. No Safe key on intents.near (QA's rule).
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
import { safeCanSell } from "@zerofee/core/band-coins";
import { SAFE_SWAP_PRIVATE } from "@zerofee/core/safe-swap-private";
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
/** The core's answer for a move it doesn't hold (security-problems.ts floatMoveUnknown). */
const MOVE_UNKNOWN = "security.float.unknown-move";
/** How long the core keeps a move (float-moves.ts KEEP_MS). A job starts no later than its move, so a real let-go is always this old. */
const MOVE_KEPT_MS = 7 * 86_400_000;

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
  approvals: (steps: TxRequest[], canChain: boolean, caller?: string) => TxRequest[];
  remember: (m: Movement) => Promise<void>;
  /** 1Click's status follow (the ledger's slow path), for a Safe swap the fast read didn't see end. */
  follow: (m: Movement, depositAddress: string) => void;
  now: () => number;
  iso: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** The Safe's swap through NEAR Confidential (safe-send.ts swapFromSafe): into Private, swapped there, back to the Safe.
   *  None, or SAFE_SWAP_PRIVATE off (`open`): a Safe swap is refused by name, before any price. */
  throughPrivate?: (o: { from: string; to: string; units: bigint; least: bigint; key?: string }, caller: Caller) => Promise<Movement>;
  open?: boolean;
}

/** What leg 2 of a Safe Swap can promise at least, from the market's least (units of the coin got): leg 1 into Private
 *  keeps 1Click's 1% room (slippageTolerance 100), so leg 2 pays at least 99% of it in (safe-send.ts fromSafe askedShare). */
export const throughLeast = (minRaw: string): bigint => (BigInt(minRaw) * 99n) / 100n;

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
    // the Safe swaps only through NEAR Confidential: off (or no way through here), refused before any price
    if (source === "safe" && !((d.open ?? SAFE_SWAP_PRIVATE) && d.throughPrivate)) throw new ProblemError(walletProblems.swapNotYet());
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
    // the least said is what leg 2 can promise through Private (throughLeast), the same figure the tap holds it to
    const least = throughLeast(r.quote.minAmountOut).toString();
    const quote: Quote & { source: SwapSource } = {
      id, from, to, amountIn, amountOut: fromUnits(r.quote.amountOut, toCoin.decimals), minOut: fromUnits(least, toCoin.decimals),
      ...(feeUsd !== undefined ? { feeUsd: feeUsd.toFixed(2) } : {}), feeNote: feeNoteOf(feeUsd, inUsd),
      ...(typeof r.quote.timeEstimate === "number" && r.quote.timeEstimate > 0 ? { etaSeconds: r.quote.timeEstimate } : {}), expiresAtIso, source,
    };
    sweep();
    kept.set(id, { quote, source, units: units.toString(), minRaw: least, at: d.now() });
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
    // the Safe: through NEAR Confidential only (safe-send.ts swapFromSafe), one Face ID; its end is the Send job's own
    // follow (send-job.ts: leg 1 into Private on 1Click's status, then leg 2's, what arrived from 1Click's record)
    if (!((d.open ?? SAFE_SWAP_PRIVATE) && d.throughPrivate)) throw new ProblemError(walletProblems.swapNotYet());
    const key = typeof p.key === "string" && /^[\w-]{8,64}$/.test(p.key) ? p.key : undefined;
    const m = await d.throughPrivate({ from: quote.from, to: quote.to, units: BigInt(k.units), least: BigInt(k.minRaw), ...(key ? { key } : {}) }, caller);
    return { ...m, ...(quote.feeUsd !== undefined ? { feeUsd: quote.feeUsd } : {}), ...(quote.etaSeconds ? { etaSeconds: quote.etaSeconds } : {}), source: "safe" };
  }

  /** The NEAR wallet's swaps a reader follows now: Activity resumes a moving job on its every read, and one job has one reader. */
  const following = new Set<string>();
  /** The NEAR wallet's swap ends on its move's own end (the core's read of 1Click's status): every 250 ms for its first
   *  10 minutes, then every 10 s until it ends (B3: never "moving" forever). A move the core has let go (a week old) ends
   *  here, in words that say neither safe nor lost. */
  async function watchPrivate(job: SwapJob, moveId: string, caller: Caller, tapMs: number, decimals?: number) {
    if (following.has(job.id)) return;
    following.add(job.id);
    const t0 = Date.parse(job.startedAtIso);
    let unread = false;
    try {
      for (;;) {
        await sleep(!unread && d.now() - t0 < SAFE_WATCH_FOR_MS ? PRIVATE_WATCH_MS : SLOW_WATCH_MS);
        const r = await d.bridgeFor(caller).call<{ status: string; settled?: { amountOut?: string } }>("subwallet.float.move", { id: moveId }).catch(() => null);
        if (r && "problem" in r && r.problem.code === MOVE_UNKNOWN) {
          // a week old: the core let it go, and no later read can answer. Younger: a missing or unreadable record reads the
          // same, and the move may still be live, so this job keeps reading (resume only takes moving jobs: an end is for good)
          if (d.now() - t0 >= MOVE_KEPT_MS) return void (await d.remember({ ...job, status: "problem", updatedAtIso: d.iso(), problem: walletProblems.nearSwapUnread() }));
          unread = true;
          continue;
        }
        if (!r || !("ok" in r) || r.ok.status === "pending") continue;
        const status: Movement["status"] = r.ok.status === "done" ? "done" : r.ok.status === "refunded" ? "refunded" : "problem";
        // what arrived: 1Click's settled figure as the core read it, never the quote
        const out = r.ok.settled?.amountOut;
        const got = out && /^\d{1,40}$/.test(out) && decimals !== undefined ? { amountOut: fromUnits(out, decimals) } : {};
        const end = status === "done" ? { settledMs: Date.now() - tapMs, ...got } : status === "problem" ? { problem: walletProblems.nearSwapFailed() } : {};
        await d.remember({ ...job, status, updatedAtIso: d.iso(), ...end });
        return;
      }
    } finally { following.delete(job.id); }
  }

  /** A reload (B3): a NEAR wallet swap still moving is followed again by its move id, at the pace of its age. A Safe swap
   *  is followed by the ledger from its deposit address (resumeQuotes). */
  async function resume(job: Movement) {
    if (job.kind !== "swap" || job.status !== "moving" || job.source !== "private" || !job.id.startsWith("swap:") || !job.caller) return;
    const to = job.to ? await d.coin(job.to) : null;
    void watchPrivate({ ...job, source: "private" }, job.id.slice("swap:".length), job.caller as Caller, Date.parse(job.startedAtIso), to?.decimals);
  }

  return { swapQuote, swap, resume };
}

/** The ledger's own parts, wired here so the ledger (in Home's first load) carries one line for this. */
export function ledgerSwap(l: Pick<IntentsSwapDeps, "bridgeFor" | "myAccount" | "now" | "iso" | "signAll" | "approvals" | "remember" | "throughPrivate"> & {
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
