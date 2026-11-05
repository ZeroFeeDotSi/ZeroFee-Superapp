// A stand-in for the ledger (S3) and the device host, for Pay's tests until MockBridge and packages/wallet land.
//
// It answers the methods Pay uses, as interfaces.md (plus the approved ledger.quotePay / ledger.pay / ledger.transfer /
// ledger.recipientInfo) describes them. Prices and tokens come from a recorded 1Click token list, and fees from
// recorded dry quotes (2026-10-25): withdrawing USDC to Solana cost 0.27 USDC, to Base 0.0024, inside the ledger 0;
// 1Click's app fee without a partner key was up to 0.2% on a conversion and nothing on the same coin.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { add, compare, fromUnits, isDecimal, round, sub, toUnits } from "../amount.ts";
import type { Balance, Movement, PayQuote, Payee, RecipientInfo } from "@zerofee/wallet/types.ts";
import { RECORDED_TOKENS } from "./recorded-tokens.ts";

export { RECORDED_TOKENS };

export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const USDT_NEAR = "nep141:usdt.tether-token.near";
export const WNEAR = "nep141:wrap.near";

/** Withdraw fee by destination, in dollars (recorded). */
const WITHDRAW_FEE_USD: Record<string, string> = { sol: "0.270312", base: "0.0024", ledger: "0" };
const ETA: Record<string, number> = { sol: 7, base: 12, ledger: 10 };

export interface FakeLedgerOptions {
  accountId?: string;
  balances: Record<string, string>;
  /** `code` is the account's contract code hash (null: none), as S3 is asked to report it. */
  recipients?: Record<string, RecipientInfo & { code?: string | null }>;
  /** How long a payment takes to land after it is sent. Default: at once (next tick). */
  settleMs?: number;
  /** Wall clock for quote expiry. */
  now?: () => number;
  stage?: "none" | "needs-backup" | "ready";
  /** What the account's protection says about every quote (as tx.describe would); unset: no protection contract. */
  protection?: { level: "faceid" | "wait" | "device" | "both"; waitSeconds: number; text: string };
  /** Card accounts the core's card.check knows (lower-case addresses). Unset: the check doesn't exist in this build. */
  cardAccounts?: string[];
  /** Wallet's Private pocket (D27), as ledger.private answers it. Unset: a ledger without it. */
  pocket?: { available: boolean; ready: boolean; defaultOn?: boolean; balances: Record<string, string> };
}

export interface Call {
  method: string;
  params?: Record<string, unknown>;
}

const problem = (code: string, whatHappened: string): Problem => ({
  code,
  whatHappened,
  money: { state: "safe", where: "in your Safe" },
  next: { kind: "retry", label: "Try again" },
});

export class FakeLedger implements Bridge {
  readonly calls: Call[] = [];
  readonly store = new Map<string, string>();
  readonly #tokens = new Map(RECORDED_TOKENS.map((t) => [t.assetId, t]));
  readonly #balances: Map<string, string>;
  readonly #quotes = new Map<string, PayQuote & { refundable: string; confidential: boolean }>();
  readonly #pocket: Map<string, string>;
  readonly #handlers = new Map<string, Set<(p: unknown) => void>>();
  readonly #once = new Map<string, Problem>();
  readonly #options: FakeLedgerOptions;
  #declineNext = false;
  #holdNext: { id: string; readyAtIso: string; needsSecondDevice: boolean } | null = null;
  #refundNext = false;
  #n = 0;
  /** What arrived where, for assertions: "<chain or ledger>:<address>" → token → amount. */
  readonly received = new Map<string, Map<string, string>>();

  constructor(options: FakeLedgerOptions) {
    this.#options = options;
    this.#balances = new Map(Object.entries(options.balances));
    this.#pocket = new Map(Object.entries(options.pocket?.balances ?? {}));
  }

  /** What's left in the Private pocket, for assertions. */
  pocketBalance(tokenId: string): string {
    return this.#pocket.get(tokenId) ?? "0";
  }

  /** The next call to `method` answers this Problem instead. */
  failNext(method: string, p: Problem): void {
    this.#once.set(method, p);
  }

  /** The person says no on the next approval sheet. */
  declineNext(): void {
    this.#declineNext = true;
  }

  /** The next transfer comes straight back in the same transaction (a pot that only takes the exact share). */
  refundNext(): void {
    this.#refundNext = true;
  }

  /** The account's protection holds the next payment: it comes back waiting, and nothing moves (S1.6c). */
  holdNext(held: { id: string; readyAtIso: string; needsSecondDevice: boolean }): void {
    this.#holdNext = held;
  }

  #held(kind: Movement["kind"], amount: string): BridgeResult<Movement> | null {
    if (!this.#holdNext) return null;
    const held = this.#holdNext;
    this.#holdNext = null;
    return { ok: { ...this.#movement(kind, amount, "waiting"), held } as Movement };
  }

  balance(tokenId: string): string {
    return this.#balances.get(tokenId) ?? "0";
  }

  on<T>(event: string, handler: (payload: T) => void): () => void {
    const set = this.#handlers.get(event) ?? new Set();
    set.add(handler as (p: unknown) => void);
    this.#handlers.set(event, set);
    return () => set.delete(handler as (p: unknown) => void);
  }

  #emit(event: string, payload: unknown): void {
    for (const h of this.#handlers.get(event) ?? []) h(payload);
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
    this.calls.push({ method, params });
    const failed = this.#once.get(method);
    if (failed) {
      this.#once.delete(method);
      return { problem: failed };
    }
    const ok = (v: unknown) => ({ ok: v as T });
    switch (method) {
      case "account.state":
        return ok({ stage: this.#options.stage ?? "ready", account: { accountId: this.#options.accountId ?? "me.near", network: "mainnet", keys: [], recovery: null } });
      case "ledger.tokens":
        return ok(RECORDED_TOKENS);
      case "ledger.balances":
        return ok(this.#balanceRows());
      case "ledger.private": {
        const pocket = this.#options.pocket;
        if (!pocket) return { problem: problem("security.method.unknown", "This part of the app isn't ready yet.") };
        return ok({ available: pocket.available, ready: pocket.ready, defaultOn: pocket.defaultOn ?? false, rows: this.#balanceRows(this.#pocket, "private") });
      }
      case "ledger.recipientInfo": {
        const id = String(params?.accountId);
        return ok(this.#options.recipients?.[id] ?? { exists: false, hasLedgerBalance: false });
      }
      case "ledger.quotePay":
        return this.#quotePay(params ?? {}) as BridgeResult<T>;
      case "ledger.pay":
        return this.#pay(String(params?.quoteId), params?.confidential === true) as BridgeResult<T>;
      case "ledger.transfer":
        return this.#transfer(params ?? {}) as BridgeResult<T>;
      case "device.store.get":
        return ok({ value: this.store.get(String(params?.key)) ?? null });
      case "device.store.set": {
        const key = String(params?.key);
        if (params?.value === null) this.store.delete(key);
        else this.store.set(key, String(params?.value));
        return ok({ ok: true });
      }
      case "device.openUrl":
        return ok({ ok: true });
      case "subwallet.create":
        // One per kind and chain, as the core keeps them (asking again gives the same one).
        return ok({ id: `sw-${params?.kind}-${params?.chain}`, kind: params?.kind, chain: params?.chain, address: "0x" + "c4".repeat(20), label: "Card wallet" });
      case "card.check": {
        if (!this.#options.cardAccounts) return { problem: problem("security.method.unknown", "This part of the app isn't ready yet.") };
        const isCard = this.#options.cardAccounts.includes(String(params?.address).toLowerCase());
        return ok(isCard ? { isCard } : { isCard, why: "This is an ordinary wallet address, not a Gnosis Pay account. Copy the address from the Gnosis Pay app." });
      }
      default:
        return { problem: problem("security.method.unknown", "This part of the app isn't ready yet.") };
    }
  }

  #balanceRows(from: Map<string, string> = this.#balances, held: Balance["held"] = "ledger"): Balance[] {
    const rows: Balance[] = [];
    for (const [tokenId, amount] of from) {
      const t = this.#tokens.get(tokenId);
      if (!t) continue;
      const usd = t.priceUsd ? round2(mulDec(amount, t.priceUsd)) : undefined;
      rows.push({ tokenId, symbol: t.symbol, name: t.symbol, icon: t.symbol.toLowerCase(), chain: t.chain, amount, usd, bridged: tokenId.includes(".omft.near") || tokenId.startsWith("nep245:"), held, listed: true });
    }
    return rows;
  }

  #quotePay(p: Record<string, unknown>): BridgeResult<PayQuote> {
    const from = this.#tokens.get(String(p.fromTokenId));
    const to = this.#tokens.get(String(p.toTokenId));
    const payee = p.to as Payee;
    const amountOut = String(p.amountOut);
    if (!from || !to || !payee || !isDecimal(amountOut)) return { problem: problem("ledger.quote.unavailable", "We can't price this pair right now.") };
    if (payee.kind === "chain" && payee.chain !== to.chain) return { problem: problem("ledger.quote.unavailable", "That coin isn't on that network.") };
    const dest = payee.kind === "ledger" ? "ledger" : payee.chain;
    const same = from.assetId === to.assetId;
    const outUsd = mulDec(amountOut, to.priceUsd ?? "1");
    const appFee = same ? "0" : mulDec(outUsd, "0.002");
    const costUsd = add(add(outUsd, WITHDRAW_FEE_USD[dest] ?? "0.01"), appFee);
    const expected = ceilUnits(divDec(costUsd, from.priceUsd ?? "1"), from.decimals);
    const withBuffer = ceilUnits(mulDec(expected, "1.005"), from.decimals);
    const id = `q${++this.#n}`;
    const quote: PayQuote = {
      id,
      fromTokenId: from.assetId,
      toTokenId: to.assetId,
      to: payee,
      amountIn: withBuffer,
      amountInExpected: expected,
      amountOut,
      feeUsd: round2up(sub(costUsd, outUsd)),
      feeNote: same ? "Network fee to send it out." : "Network fee, plus NEAR Intents' fee for the conversion.",
      etaSeconds: ETA[dest] ?? 30,
      expiresAtIso: new Date(this.#now() + 60_000).toISOString(),
      refundTo: this.#options.accountId ?? "me.near",
      ...(this.#options.protection ? { protection: this.#options.protection } : {}),
    };
    this.#quotes.set(id, { ...quote, refundable: sub(withBuffer, expected), confidential: p.confidential === true });
    return { ok: quote };
  }

  #declined(): Problem | null {
    if (!this.#declineNext) return null;
    this.#declineNext = false;
    return { code: "ledger.signature.declined", whatHappened: "You said no, so nothing moved.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } };
  }

  #pay(quoteId: string, confidential: boolean): BridgeResult<Movement> {
    const q = this.#quotes.get(quoteId);
    if (!q) return { problem: problem("ledger.quote.expired", "That price ran out.") };
    // A private quote is paid privately, from the pocket; a public one never from it (Wallet's rule).
    if (q.confidential !== confidential) return { problem: problem("ledger.quote.mismatch", "This payment doesn't match its price.") };
    const wallet = confidential ? this.#pocket : this.#balances;
    if (Date.parse(q.expiresAtIso) < this.#now()) return { problem: problem("ledger.quote.expired", "That price ran out.") };
    const declined = this.#declined();
    if (declined) return { problem: declined };
    const held = this.#held("pay", q.amountOut);
    if (held) return held;
    const has = () => wallet.get(q.fromTokenId) ?? "0";
    if (compare(has(), q.amountIn) < 0) return { problem: problem("ledger.balance.low", "Not enough in your balance.") };
    this.#quotes.delete(quoteId);
    wallet.set(q.fromTokenId, sub(has(), q.amountIn));
    const movement = this.#movement("pay", q.amountOut, "moving");
    const timer = setTimeout(() => {
      // The unused part of the buffer comes back, and the receiver gets exactly amountOut.
      wallet.set(q.fromTokenId, add(has(), q.refundable));
      this.#credit(q.to, q.toTokenId, q.amountOut);
      this.#emit("ledger.movementUpdated", { movement: { ...movement, status: "done", updatedAtIso: new Date(this.#now()).toISOString() } });
      this.#emit("ledger.balancesChanged", {});
    }, this.#options.settleMs ?? 0);
    // A test that stops waiting shouldn't keep the process alive for a payment nobody watches.
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    return { ok: movement };
  }

  #transfer(p: Record<string, unknown>): BridgeResult<Movement> {
    const tokenId = String(p.tokenId);
    const amount = String(p.amount);
    const declined = this.#declined();
    if (declined) return { problem: declined };
    const held = this.#held("transfer", amount);
    if (held) return held;
    if (!isDecimal(amount) || compare(this.balance(tokenId), amount) < 0) return { problem: problem("ledger.balance.low", "Not enough in your balance.") };
    if (this.#refundNext) {
      this.#refundNext = false;
      return { ok: this.#movement("transfer", amount, "refunded") };
    }
    this.#balances.set(tokenId, sub(this.balance(tokenId), amount));
    this.#credit({ kind: "ledger", accountId: String(p.toAccountId) }, tokenId, amount);
    this.#emit("ledger.balancesChanged", {});
    return { ok: this.#movement("transfer", amount, "done") };
  }

  #credit(to: Payee, tokenId: string, amount: string): void {
    const key = to.kind === "ledger" ? `ledger:${to.accountId}` : `${to.chain}:${to.address}`;
    const got = this.received.get(key) ?? new Map<string, string>();
    got.set(tokenId, add(got.get(tokenId) ?? "0", amount));
    this.received.set(key, got);
  }

  #movement(kind: Movement["kind"], amount: string, status: Movement["status"]): Movement {
    const iso = new Date(this.#now()).toISOString();
    return { id: `m${++this.#n}`, kind, status, amount, startedAtIso: iso, updatedAtIso: iso, explorerUrls: [] };
  }
}

// Small exact helpers for prices (the fake's own maths; Pay itself never divides money).
const SCALE = 18;
const u = (a: string) => toUnits(round(a, SCALE, "down"), SCALE)!;
function mulDec(a: string, b: string): string {
  const x = u(a);
  const y = u(b);
  return fromUnits((x * y) / 10n ** BigInt(SCALE), SCALE);
}
function divDec(a: string, b: string): string {
  const x = u(a);
  const y = u(b);
  return fromUnits((x * 10n ** BigInt(SCALE)) / y, SCALE);
}
function ceilUnits(a: string, decimals: number): string {
  const x = u(a);
  const step = 10n ** BigInt(SCALE - Math.min(decimals, SCALE));
  return fromUnits(((x + step - 1n) / step) * step, SCALE);
}
function round2(a: string): string {
  const x = u(a);
  const step = 10n ** BigInt(SCALE - 2);
  return fromUnits((x / step) * step, SCALE);
}
function round2up(a: string): string {
  const x = u(a);
  const step = 10n ** BigInt(SCALE - 2);
  return fromUnits(((x + step - 1n) / step) * step, SCALE);
}
