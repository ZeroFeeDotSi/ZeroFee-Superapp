// Scan and pay: from what the camera saw to "paid", in as few steps and seconds as possible.
//
// The fast path:
//   read the code (on the phone, under a millisecond) → pick the coin (on the phone) → one quote (1Click, about a second)
//   → confirm → the approval sheet and Face ID → ONE transaction from the ledger → the receiver is paid (1Click
//   estimates 7–12 s after that for Solana and Base).
// warm() loads balances and the token list before the camera opens, so nothing waits on them after the scan.
// A Stopwatch records every step, so the real path can be measured on a phone, not guessed.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { compare, fromUnits, isDecimal, isZero, normalise, toUnits } from "./amount.ts";
import { billFor, type BankBill } from "./bank.ts";
import { chain, shortAddress, chainName } from "./chains.ts";
import { readPayCode } from "./codes/parse.ts";
import type { PayCode, ReadOptions, UnsupportedWhat } from "./codes/parse.ts";
import type { Balance, DepositAddress, Movement, PayQuote, PrivatePocket, Token } from "@zerofee/wallet/types.ts";
import { isDeclined, payProblems } from "./pay-problems.ts";
import { sourcesFor } from "./plan.ts";
import type { PayTarget, Source } from "./plan.ts";
import { TokenDirectory } from "./tokens.ts";

/** What the person told the screen when the code left something open. */
export interface Answers {
  amount?: string;
  network?: string;
  /** For a request that names no coin: which coin to send. */
  tokenId?: string;
}

export interface Confirm {
  target: PayTarget;
  /** Who is paid, as the screen names them: the code's own label, a NEAR name, or a short address. */
  payee: string;
  /** True when `payee` is the name the code gave itself, which nobody checked: show it as "says it's …". */
  labelFromCode: boolean;
  /** Who is paid in words that never come from a code: the person's own name for them, the account, or a short address. */
  payeePlain: string;
  /** The address or account in full. */
  payeeFull: string;
  network: string;
  source: Source;
  /** Every other coin that could pay, for "Pay with…". */
  alternatives: Source[];
  quote?: PayQuote;
  /** The most that leaves the balance, in the paying coin. */
  maxIn: string;
  expectedIn: string;
  inSymbol: string;
  feeUsd?: string;
  feeNote: string;
  /** The route's own delivery estimate (1Click's). None for a transfer inside the ledger: no measured time yet (UI). */
  etaSeconds?: number;
  /** The account's protection will hold this payment (its own words, from the quote), so Confirm says so first. */
  hold?: { level: "wait" | "device" | "both"; waitSeconds: number; text: string };
  /** The "Pay from Private" switch (D27, M4), only when Wallet's Private pocket can pay this; `on`: it pays from there. */
  privacy?: { on: boolean };
}

/**
 * A payment the account's protection is holding (above the person's amount band). Nothing has moved yet: it runs after
 * the wait, or once the second device agrees, and the person can cancel it until then. Never "paid".
 */
export interface Held {
  id: string;
  readyAtIso: string;
  needsSecondDevice: boolean;
}

/** The hold's details, as the ledger reports them on a movement that is waiting (S3: Movement.held). */
export function heldOf(m: Movement): Held | undefined {
  const h = (m as Movement & { held?: Partial<Held> }).held;
  return h && typeof h.id === "string" && typeof h.readyAtIso === "string" ? { id: h.id, readyAtIso: h.readyAtIso, needsSecondDevice: Boolean(h.needsSecondDevice) } : undefined;
}

export type Step =
  /** `declined`: the person said no on the approval sheet; nothing was sent (Send goes back to where it was, J6). */
  | { kind: "confirm"; confirm: Confirm; changed?: boolean; declined?: true }
  | { kind: "ask"; field: "amount" | "network"; networks?: string[]; problem: Problem; token?: Token; symbol?: string }
  /** A bank code Mt Pelerin can pay from the person's personal IBAN: Pay's bank screens take it from here. */
  | { kind: "bank"; bill: BankBill }
  /** A web page (e.g. a restaurant's order-and-pay page): open it in the system's browser sheet. */
  | { kind: "open"; url: string }
  | { kind: "problem"; problem: Problem }
  | { kind: "sent"; movement: Movement; confirm: Confirm }
  /** Held by the account's protection: on hold, nothing moved. The screen shows it as such, never as paid. */
  | { kind: "held"; movement: Movement; confirm: Confirm; held?: Held }
  | { kind: "paid"; movement: Movement; confirm: Confirm };

const UNSUPPORTED: Record<UnsupportedWhat, string> = {
  lightning: "It's a Bitcoin Lightning invoice. ZeroFee can't pay Lightning invoices.",
  "solana-transaction": "This Solana Pay checkout builds its own payment, so ZeroFee can't pay it.",
  walletconnect: "It connects a wallet to a website. Open the website in the Browser app instead.",
  "ens-name": "It gives an Ethereum name instead of an address. Ask for the address.",
  "evm-call": "It asks to run a program, not to make a payment.",
  network: "It's for a network ZeroFee doesn't send on.",
};

/** Turns a code (plus the person's answers) into exactly who gets what. */
export function targetFor(code: PayCode, tokens: TokenDirectory, answers: Answers, self?: string):
  | { ok: PayTarget }
  | { problem: Problem; ask?: "amount" | "network"; networks?: string[]; token?: Token; symbol?: string }
  | { open: string }
  | { bank: BankBill } {
  switch (code.kind) {
    case "unknown":
      return { problem: payProblems.codeUnreadable() };
    case "damaged":
      return { problem: payProblems.codeDamaged() };
    case "bad-request":
      return { problem: payProblems.requestInvalid() };
    case "unsupported":
      return { problem: payProblems.codeUnsupported(UNSUPPORTED[code.what]) };
    case "web":
      return { open: code.url };
    case "bank": {
      const b = code.bank;
      // A code that names an account, in euros: Mt Pelerin pays it from the person's personal IBAN (M3).
      if (b.account && (b.currency ?? "EUR") === "EUR") {
        const amount = b.amount ?? answers.amount;
        if (amount === undefined) return { problem: payProblems.amountNeeded(), ask: "amount", symbol: "EUR" };
        if (!isDecimal(amount) || isZero(amount) || toUnits(amount, 2) === null) return { problem: payProblems.amountInvalid(), ask: "amount", symbol: "EUR" };
        const bill = billFor(b, amount, tokens);
        if (bill) return { bank: bill };
      }
      // The amount and currency are checked patterns; the code's own text (its shop name) never goes in a Problem.
      const asks = b.amount ? `It asks for ${`${b.amount} ${b.currency ?? ""}`.trim()}.` : "It asks you to type the amount.";
      return { problem: payProblems.bankQr(b.scheme, asks) };
    }
    case "request": {
      const r = code.request;
      if (r.to === self) return { problem: payProblems.recipientSelf() };
      // H-4: a request to an address on a chain is paid from Send (its guard, its coin lock), never from here
      if (r.chain) return { problem: payProblems.codeUnsupported("Paste it in Send to pay it.") };
      const tokenId = r.token ?? answers.tokenId;
      const token = tokenId ? tokens.byAsset(tokenId) : tokens.find("near", { symbol: "USDC" });
      if (!token) return { problem: payProblems.coinUnsupported(tokenId ?? "USDC") };
      const amount = amountFor(r.amount ? { decimal: r.amount } : undefined, token, answers);
      if ("problem" in amount) return { ...amount, token };
      return {
        ok: { to: { kind: "ledger", accountId: r.to }, token, amount: amount.ok, message: r.note, notes: [], ref: r.ref },
      };
    }
    case "crypto": {
      const network = code.chain ?? (answers.network && code.candidates.includes(answers.network) ? answers.network : null);
      if (!network) return { problem: payProblems.networkNeeded(), ask: "network", networks: code.candidates };
      const info = chain(network);
      if (!info) return { problem: payProblems.networkUnsupported(network) };
      if (network === "near" && code.address === self) return { problem: payProblems.recipientSelf() };
      if (code.memo && info.memoSendable === false) return { problem: payProblems.memoUnsupported(info.name) };
      const token = tokens.find(network, code.token);
      if (!token) {
        const what = "contract" in code.token ? `the coin ${shortAddress(code.token.contract)}` : "native" in code.token ? "this network's own coin" : code.token.symbol;
        return { problem: payProblems.coinUnsupported(`It asks for ${what} on ${info.name}.`) };
      }
      const amount = amountFor(code.amount, token, answers);
      if ("problem" in amount) return { ...amount, token };
      return {
        ok: {
          to: { kind: "chain", chain: network, address: code.address, ...(code.memo ? { memo: code.memo } : {}) },
          token,
          amount: amount.ok,
          label: code.label,
          message: code.message,
          notes: code.notes,
        },
      };
    }
  }
}

function amountFor(
  fromCode: { decimal: string } | { units: string } | undefined,
  token: Token,
  answers: Answers,
): { ok: string } | { problem: Problem; ask: "amount" } {
  let amount: string | undefined;
  if (fromCode && "units" in fromCode) amount = fromUnits(BigInt(fromCode.units), token.decimals);
  else amount = fromCode?.decimal ?? answers.amount;
  if (amount === undefined) return { problem: payProblems.amountNeeded(), ask: "amount" };
  if (!isDecimal(amount) || isZero(amount) || toUnits(amount, token.decimals) === null) {
    return { problem: payProblems.amountInvalid(), ask: "amount" };
  }
  return { ok: normalise(amount) };
}

/** Times every step of one payment, in milliseconds from the scan. */
export class Stopwatch {
  readonly #clock: () => number;
  readonly #marks = new Map<string, number>();
  #start = 0;
  constructor(clock: () => number) {
    this.#clock = clock;
  }
  start(): void {
    this.#marks.clear();
    this.#start = this.#clock();
  }
  mark(name: "quoted" | "ready" | "sent" | "paid"): void {
    this.#marks.set(name, this.#clock() - this.#start);
  }
  /** e.g. { quoted: 640, ready: 650, sent: 4100, paid: 11800 } */
  read(): Record<string, number> {
    return Object.fromEntries(this.#marks);
  }
}

export interface PayFlowOptions extends ReadOptions {
  bridge: Bridge;
  /**
   * Pay from any coin, converting through 1Click. Off until the mainnet dust test proves 1Click accepts funding by
   * mt_transfer (see plan.ts); until then only the coin asked for pays.
   */
  anyCoin?: boolean;
  /** Milliseconds, for the stopwatch. Default: performance.now. */
  clock?: () => number;
  /** Wall time in ms, for quote expiry. Default: Date.now. */
  now?: () => number;
}

const PREFERRED_KEY = "pay-with";

function unwrap<T>(r: BridgeResult<T>): T {
  if ("problem" in r) throw new FlowProblem(r.problem);
  return r.ok;
}

class FlowProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.code);
    this.problem = problem;
  }
}

/** How long a payment that may have gone out blocks the same payment (audit PS-1). */
export const MAYBE_SENT_MS = 10 * 60_000;
/** Problems that say nothing left: a "no" on the sheet, a price that ran out before signing, a request refused before it. */
const NOTHING_SENT = /\.declined$|\.quote\.expired$|^security\.request\.|^pay\.send\.maybe-sent$/;
/** One payment, by what it pays: who, which coin, how much (and the request's reference). */
export const sendKey = (t: PayTarget) => JSON.stringify([t.to, t.token.assetId, t.amount, t.ref ?? null]);
/** The network link a Problem carries ("Follow it here: https://…"), if any. */
const linkIn = (p: Problem): string | undefined => /https:\/\/\S+/.exec(p.more ?? "")?.[0];

/** One scan-and-pay, start to finish. The screen calls these in order and draws whatever Step comes back. */
export class PayFlow {
  readonly #bridge: Bridge;
  readonly #options: PayFlowOptions;
  readonly #now: () => number;
  readonly stopwatch: Stopwatch;
  #tokens?: TokenDirectory;
  #balances: Balance[] = [];
  #self?: string;
  #preferred?: string;
  #code?: PayCode;
  /** Set instead of a code when sending to a friend (send.ts already knows who and what). */
  #target?: PayTarget;
  #answers: Answers = {};
  #confirm?: Confirm;
  /** Wallet's Private pocket (D27), as ledger.private reads it; unset on a ledger without one. */
  #pocket?: PrivatePocket;
  /** The person's own flip of "Pay from Private" for this payment; unset: the pocket's default (Wallet's defaultOn). */
  #private?: boolean;
  /** Whether the payment being prepared pays from Private, once the default and the flip are weighed. */
  #fromPrivate = false;
  /** Private only (D85, a send Chat asked for): never priced, flipped or paid from the Safe. */
  #privateOnly = false;
  /** The latest word on each movement, so an update that lands before settle() starts listening isn't missed. */
  readonly #updates = new Map<string, Movement>();
  readonly #off: () => void;

  constructor(options: PayFlowOptions) {
    this.#bridge = options.bridge;
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.stopwatch = new Stopwatch(options.clock ?? (() => performance.now()));
    this.#off = this.#bridge.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => this.#updates.set(movement.id, movement));
  }

  /** When the screen goes away. */
  close(): void {
    this.#off();
  }

  /** Before the camera opens: the token list, balances, the account, and the remembered "pay with". */
  async warm(): Promise<Problem | null> {
    try {
      const [tokens, balances, state, preferred, pocket] = await Promise.all([
        this.#tokens ? Promise.resolve(null) : this.#bridge.call<Token[]>("ledger.tokens"),
        this.#bridge.call<Balance[]>("ledger.balances"),
        this.#bridge.call<{ account?: { accountId: string } }>("account.state"),
        this.#bridge.call<{ value: string | null }>("device.store.get", { key: PREFERRED_KEY }),
        this.#bridge.call<PrivatePocket>("ledger.private"),
      ]);
      // No pocket (or a ledger without one) just means no Private switch.
      this.#pocket = "ok" in pocket ? pocket.ok : undefined;
      if (tokens) this.#tokens = new TokenDirectory(unwrap(tokens));
      this.#balances = unwrap(balances);
      this.#self = "ok" in state ? state.ok.account?.accountId : undefined;
      this.#preferred = "ok" in preferred ? (preferred.ok.value ?? undefined) : undefined;
      return null;
    } catch (e) {
      if (e instanceof FlowProblem) return e.problem;
      throw e;
    }
  }

  /** The camera saw something (or the person pasted it). The stopwatch starts here. */
  async read(text: string): Promise<Step> {
    this.stopwatch.start();
    this.#code = readPayCode(text, this.#options);
    this.#target = undefined;
    this.#answers = {};
    this.#private = undefined;
    this.#privateOnly = false;
    return this.#prepare();
  }

  /** Send to a friend: who and what are already known (see send.ts); `payWith` is the coin the person picked.
   *  `privateOnly` (D85, Chat's sends): from Private from the first price on, never the Safe, never flipped off. */
  async send(target: PayTarget, payWith?: string, o: { privateOnly?: boolean } = {}): Promise<Step> {
    this.stopwatch.start();
    this.#code = undefined;
    this.#target = target;
    this.#privateOnly = o.privateOnly === true;
    this.#private = this.#privateOnly ? true : undefined;
    this.#confirm = undefined;
    // From Private only, Private's own rows pick the coin: the form's choice is a coin of the Safe, which never pays this.
    return this.#prepare(this.#privateOnly ? undefined : payWith);
  }

  /**
   * A repeat action to someone already set up (a confirmed card, a saved person): straight to the approval sheet and
   * Face ID. Confirm comes back instead when there's something to say first: a hold, the Private switch, a new price.
   * `approving`: called once the Safe's sheet is next (never for a payment Hidden can make: that stops on Confirm).
   */
  async sendAtOnce(target: PayTarget, payWith?: string, approving?: () => void): Promise<Step> {
    const step = await this.send(target, payWith);
    if (step.kind !== "confirm" || step.changed || step.confirm.hold || step.confirm.privacy) return step;
    approving?.();
    return this.confirm();
  }

  /** The Private switch on Confirm: pay this from Wallet's Private pocket (on) or the main balance (off). A new price either way. */
  async setPrivate(on: boolean): Promise<Step> {
    this.#private = this.#privateOnly ? true : on;
    return this.#prepare();
  }

  /** The token list, once warm(): the Send screen needs it to name what the friend receives. */
  get tokens(): TokenDirectory | undefined {
    return this.#tokens;
  }

  /** The person filled in what the code left open (amount, network, coin). */
  async answer(answers: Answers): Promise<Step> {
    this.#answers = { ...this.#answers, ...answers };
    return this.#prepare();
  }

  /** "Pay with…": the person picked another coin. Remembered on this phone for next time. */
  async payWith(tokenId: string): Promise<Step> {
    this.#preferred = tokenId;
    await this.#bridge.call("device.store.set", { key: PREFERRED_KEY, value: tokenId });
    return this.#prepare(tokenId);
  }

  async #prepare(chosen?: string): Promise<Step> {
    if (!this.#code && !this.#target) return { kind: "problem", problem: payProblems.codeUnreadable() };
    if (!this.#tokens) {
      const problem = await this.warm();
      if (problem) return { kind: "problem", problem };
    }
    let target = this.#target;
    if (!target) {
      const code = this.#code!;
      const found = targetFor(code, this.#tokens!, this.#answers, this.#self);
      if ("open" in found) return { kind: "open", url: found.open };
      if ("bank" in found) return { kind: "bank", bill: found.bank };
      if ("problem" in found) {
        return found.ask ? { kind: "ask", field: found.ask, networks: found.networks, problem: found.problem, token: found.token, symbol: found.symbol } : { kind: "problem", problem: found.problem };
      }
      target = found.ok;
    }
    const anyCoin = this.#options.anyCoin ?? false;
    // The pocket's default presets the switch, but only where the pocket can pay this; the person's own flip wins.
    // From Private, only the pocket's own rows pay; it never borrows from the main balance, and the reverse.
    const fromPrivate = this.#private ?? (this.#pocket?.defaultOn === true && this.#pocketCanPay(target));
    this.#fromPrivate = fromPrivate;
    const rows = fromPrivate ? (this.#pocket?.rows ?? []) : this.#balances;
    // Hidden pays any coin to any coin (D111): its payment is one confidential 1Click quote from the pocket, so USDC on
    // NEAR in Hidden pays USDC on Solana. The Safe's own path converts only once anyCoin is on (the dust proof).
    const sources = sourcesFor(target, rows, chosen ?? (fromPrivate ? undefined : this.#preferred), { anyCoin: (fromPrivate && this.#privateOnly) || anyCoin });
    if (sources.length === 0 && fromPrivate) {
      // the switch goes back off for the person to flip, never for a Private-only send (D85)
      if (!this.#privateOnly) this.#private = false;
      this.#confirm = undefined;
      return { kind: "problem", problem: payProblems.privateShort() };
    }
    if (sources.length === 0) {
      // Say which: the money is there in another coin (converting isn't on yet), or there isn't enough at all.
      const couldConvert = !anyCoin && sourcesFor(target, this.#balances, undefined, { anyCoin: true }).length > 0;
      return {
        kind: "problem",
        problem: couldConvert ? payProblems.coinNeeded(this.#tokens!.label(target.token)) : payProblems.fundsShort(`${target.amount} ${target.token.symbol}`),
      };
    }
    const ordered = chosen ? sources.filter((s) => s.balance.tokenId === chosen) : sources;
    if (ordered.length === 0) {
      const held = this.#balances.find((b) => b.tokenId === chosen);
      return { kind: "problem", problem: payProblems.routeNone(held?.symbol ?? "coin") };
    }

    let last: Problem | undefined;
    for (const source of ordered.slice(0, 3)) {
      const made = await this.#confirmFor(target, source, sources);
      if ("confirm" in made) {
        this.#confirm = made.confirm;
        this.stopwatch.mark("ready");
        return { kind: "confirm", confirm: made.confirm };
      }
      last = made.problem;
    }
    return { kind: "problem", problem: last ?? payProblems.quoteFailed() };
  }

  async #confirmFor(target: PayTarget, source: Source, all: Source[]): Promise<{ confirm: Confirm } | { problem: Problem }> {
    const alternatives = all.filter((s) => s !== source);
    const payee = payeeName(target);
    const base = { target, ...payee, source, alternatives, inSymbol: source.balance.symbol };
    if (source.route === "transfer") {
      return {
        // One mt_transfer inside the ledger: no 1Click and no bridge. The account pays NEAR's own network fee; the
        // approval sheet shows the most it can be. (No number here until the first mainnet transfer measures it.)
        confirm: { ...base, maxIn: target.amount, expectedIn: target.amount, feeNote: "A small network fee, paid in NEAR. The approval sheet shows the most it can be." },
      };
    }
    const quote = await this.#quote(target, source);
    if ("problem" in quote) return quote;
    const q = quote.ok;
    const p = q.protection;
    const hold = p && p.level !== "faceid" ? { level: p.level, waitSeconds: p.waitSeconds, text: p.text } : undefined;
    const privacy = this.#pocketCanPay(target) ? { on: this.#fromPrivate } : undefined;
    return {
      confirm: { ...base, quote: q, maxIn: q.amountIn, expectedIn: q.amountInExpected, feeUsd: q.feeUsd, feeNote: q.feeNote, etaSeconds: q.etaSeconds, ...(hold ? { hold } : {}), ...(privacy ? { privacy } : {}) },
    };
  }

  /**
   * The Private switch (D27, M4): only for a send that goes through 1Click (it leaves NEAR or changes coin), and only
   * when Wallet's pocket is available, set up, and can pay it.
   */
  #pocketCanPay(target: PayTarget): boolean {
    const pocket = this.#pocket;
    if (!pocket?.available || !pocket.ready || pocket.rows.length === 0) return false;
    // Hidden-only (V4 Send's Hidden, Chat): any pocket coin pays any coin; the switch elsewhere stays as it was (review 1b)
    return sourcesFor(target, pocket.rows, undefined, { anyCoin: this.#privateOnly || (this.#options.anyCoin ?? false) }).some((s) => s.route === "quote");
  }

  async #quote(target: PayTarget, source: Source): Promise<{ ok: PayQuote } | { problem: Problem }> {
    const r = await this.#bridge.call<PayQuote>("ledger.quotePay", {
      fromTokenId: source.payTokenId,
      toTokenId: target.token.assetId,
      to: target.to,
      amountOut: target.amount,
      ...(this.#fromPrivate ? { confidential: true } : {}),
    });
    if ("problem" in r) return r;
    const q = r.ok;
    this.stopwatch.mark("quoted");
    // The quote must be for exactly what was asked, and must fit the balance. (S1 checks it again before signing.)
    const sameTo = JSON.stringify(q.to) === JSON.stringify(target.to);
    if (q.fromTokenId !== source.payTokenId || q.toTokenId !== target.token.assetId || !sameTo || compare(q.amountOut, target.amount) !== 0) {
      return { problem: payProblems.quoteFailed() };
    }
    if (compare(q.amountIn, source.balance.amount) > 0) return { problem: payProblems.routeNone(source.balance.symbol) };
    // A conversion the protection would hold can never finish: its price lasts about a minute (Security's (c)). It
    // isn't offered; the next coin is tried, and the core refuses it anyway (security.quote.cant-wait).
    if (!source.sameCoin && q.protection && q.protection.level !== "faceid") return { problem: payProblems.convertWouldHold() };
    return { ok: q };
  }

  /**
   * What sending `amount` of `token` to a network costs now, before there's an address to send to ("Before you start",
   * UI's gap list): the coin a payment would use and its quote, to the person's own receive address on that network.
   * Nothing is signed or kept; the payment itself quotes again. Null when no coin in the balance can pay it.
   */
  async estimate(token: Token, amount: string): Promise<{ feeUsd: string; etaSeconds?: number } | null> {
    const source = sourcesFor({ to: { kind: "chain", chain: token.chain, address: "" }, token, amount, notes: [] }, this.#balances, this.#preferred, { anyCoin: this.#options.anyCoin ?? false })[0];
    if (!source) return null;
    if (source.route === "transfer") return { feeUsd: "0" };
    // Only priced, never received into: the vault's limit doesn't apply (apps/web/src/vault-gate.ts).
    const own = await this.#bridge.call<DepositAddress>("ledger.depositAddress", { chain: token.chain, token: token.assetId, purpose: "estimate" });
    if (!("ok" in own)) return null;
    const r = await this.#bridge.call<PayQuote>("ledger.quotePay", { fromTokenId: source.payTokenId, toTokenId: token.assetId, to: { kind: "chain", chain: token.chain, address: own.ok.address }, amountOut: amount });
    if (!("ok" in r)) return null;
    return { feeUsd: r.ok.feeUsd ?? "0", ...(r.ok.etaSeconds !== undefined ? { etaSeconds: r.ok.etaSeconds } : {}) };
  }

  /**
   * Audit PS-1: payments that may have gone out (a problem after the transaction was handed to the core, other than a
   * "no" or a price that ran out before signing), by what they pay: who, which coin, how much. The same payment within
   * MAYBE_SENT_MS (a retry, or the same Send again) is never submitted a second time: it says to check Activity.
   */
  readonly #maybeSent = new Map<string, { atMs: number; link?: string }>();
  /** Whether this confirm() handed a transaction to the ledger (only then can it have gone out). */
  #handed = false;

  /** The person tapped Pay. Then the approval sheet and Face ID (S1), then one transaction. */
  async confirm(): Promise<Step> {
    const first = this.#confirm;
    const key = first ? sendKey(first.target) : "";
    const was = key ? this.#maybeSent.get(key) : undefined;
    if (was && this.#now() - was.atMs < MAYBE_SENT_MS) return { kind: "problem", problem: payProblems.maybeSent(was.link) };
    this.#handed = false;
    const step = await this.#confirmOnce();
    if (key && this.#handed && step.kind === "problem" && !NOTHING_SENT.test(step.problem.code)) {
      this.#maybeSent.set(key, { atMs: this.#now(), ...(linkIn(step.problem) ? { link: linkIn(step.problem)! } : {}) });
    }
    return step;
  }

  async #confirmOnce(): Promise<Step> {
    let c = this.#confirm;
    if (!c) return { kind: "problem", problem: payProblems.quoteFailed() };
    if (c.quote && Date.parse(c.quote.expiresAtIso) - this.#now() < 5_000) {
      // Quotes live about a minute. A fresh one that asks no more than the person agreed to goes ahead; one that asks
      // more goes back to the screen with the new numbers.
      const fresh = await this.#quote(c.target, c.source);
      if ("problem" in fresh) return { kind: "problem", problem: fresh.problem };
      const next = { ...c, quote: fresh.ok, maxIn: fresh.ok.amountIn, expectedIn: fresh.ok.amountInExpected, feeUsd: fresh.ok.feeUsd, feeNote: fresh.ok.feeNote, etaSeconds: fresh.ok.etaSeconds };
      this.#confirm = next;
      if (compare(fresh.ok.amountIn, c.maxIn) > 0) return { kind: "confirm", confirm: next, changed: true };
      c = next;
    }
    this.#handed = true;
    let r = await this.#send(c);
    if ("problem" in r && c.quote && /\.quote\.expired$/.test(r.problem.code)) {
      // The price ran out between this screen and signing (the core checks it against 1Click at that moment). Get a
      // fresh one, once: it goes ahead only if it asks no more than the person agreed to.
      const fresh = await this.#quote(c.target, c.source);
      if ("problem" in fresh) return { kind: "problem", problem: fresh.problem };
      const next = { ...c, quote: fresh.ok, maxIn: fresh.ok.amountIn, expectedIn: fresh.ok.amountInExpected, feeUsd: fresh.ok.feeUsd, feeNote: fresh.ok.feeNote, etaSeconds: fresh.ok.etaSeconds };
      this.#confirm = next;
      if (compare(fresh.ok.amountIn, c.maxIn) > 0) return { kind: "confirm", confirm: next, changed: true };
      c = next;
      this.#handed = true;
      r = await this.#send(c);
    }
    if ("problem" in r) {
      if (isDeclined(r.problem)) return { kind: "confirm", confirm: c, declined: true };
      return { kind: "problem", problem: r.problem };
    }
    if (r.ok.status === "waiting") return { kind: "held", movement: r.ok, confirm: c, held: heldOf(r.ok) };
    this.stopwatch.mark("sent");
    // Finished in the same transaction: paid, or sent straight back.
    const now = settled(r.ok, c);
    if (now?.kind === "paid") this.stopwatch.mark("paid");
    return now ?? { kind: "sent", movement: r.ok, confirm: c };
  }

  #send(c: Confirm): Promise<BridgeResult<Movement>> {
    // `label` is for the person's own Activity ("Paid Kiosk 4.20 USDC"); the ledger keeps it on the phone only.
    // `memo` is different: it goes on-chain with a transfer, for the requester (the request's own reference).
    // Only when it adds a name: a label that only repeats the address ("Pay says: sam.testnet" under "Send 5.00 USDC to
    // sam.testnet") is left off (the robot's pass 5).
    const own = c.target.name ?? c.target.label;
    const where = c.target.to.kind === "ledger" ? c.target.to.accountId : c.target.to.address;
    const named = c.target.message || (own && own !== where && own !== shortAddress(where));
    const label = c.target.activity ?? (named ? activityLabel(c) : undefined);
    // From Private: the ledger pays it privately from the pocket, or refuses (ledger.private.unavailable); never in public.
    if (c.quote) return this.#bridge.call<Movement>("ledger.pay", { quoteId: c.quote.id, label, ...(c.privacy?.on ? { confidential: true } : {}) });
    const toAccountId = (c.target.to as { accountId: string }).accountId;
    return this.#bridge.call<Movement>("ledger.transfer", {
      tokenId: c.source.payTokenId,
      amount: c.target.amount,
      toAccountId,
      ...(c.target.ref ? { memo: c.target.ref } : {}),
      label,
    });
  }

  /** After "sent": waits for the receiver to be paid. A slow network ends in `pay.payment.slow`; call again to keep waiting. */
  settle(sent: Extract<Step, { kind: "sent" }>, timeoutMs?: number): Promise<Step> {
    const limit = timeoutMs ?? Math.max(90_000, (sent.confirm.etaSeconds ?? 30) * 4_000);
    const known = this.#updates.get(sent.movement.id);
    const already = known && settled(known, sent.confirm);
    if (already) {
      if (already.kind === "paid") this.stopwatch.mark("paid");
      return Promise.resolve(already);
    }
    return new Promise((resolve) => {
      const finish = (step: Step) => {
        clearTimeout(timer);
        off();
        resolve(step);
      };
      const off = this.#bridge.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => {
        if (movement.id !== sent.movement.id) return;
        const step = settled(movement, sent.confirm);
        if (step) {
          if (step.kind === "paid") this.stopwatch.mark("paid");
          finish(step);
        }
      });
      const timer = setTimeout(() => finish({ kind: "problem", problem: payProblems.slow(sent.confirm.payeePlain) }), limit);
    });
  }
}

/** What Activity calls this payment: who was paid, and the request's own note if it had one. */
function activityLabel(c: Confirm): string {
  const text = c.target.message ? `${c.payee}: ${c.target.message}` : c.payee;
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function settled(m: Movement, confirm: Confirm): Step | null {
  switch (m.status) {
    case "waiting":
      return { kind: "held", movement: m, confirm, held: heldOf(m) };
    case "done":
      return { kind: "paid", movement: m, confirm };
    case "refunded":
      return { kind: "problem", problem: payProblems.refunded() };
    case "problem":
      return { kind: "problem", problem: m.problem ?? payProblems.comingBack() };
    default:
      return null;
  }
}

function payeeName(t: PayTarget): Pick<Confirm, "payee" | "payeeFull" | "network" | "labelFromCode" | "payeePlain"> {
  if (t.to.kind === "ledger") {
    const payee = t.name ?? t.to.accountId;
    return { payee, payeeFull: t.to.accountId, network: "ZeroFee", labelFromCode: false, payeePlain: payee };
  }
  const network = chainName(t.to.chain);
  const full = t.to.address;
  const plain = t.name ?? (t.to.chain === "near" ? full : shortAddress(full));
  return { payee: t.name ?? t.label ?? plain, payeeFull: full, network, labelFromCode: !t.name && Boolean(t.label), payeePlain: plain };
}
