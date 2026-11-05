// AgentZero pays for its replies, exactly, from its own wallet (D152, product decision, 3 Nov: "compute exactly their API costs, we
// charge nothing on top"). Its wallet is a plain NEAR account (the implicit account of its own key, agent-wallet.ts)
// holding plain USDC and a little NEAR for sending fees. Replies add up in one batch (product decision, 4 Nov); the phone pays the
// batch as ONE plain USDC ft_transfer to ZeroFee's receiving account (ZEROFEE_RECEIVE, pinned in this build, never taken
// from the relay), with the memo the relay named for this id, right after each reply (D37: prepaid, no credit; the relay
// holds the next reply until it is paid). No 1Click: ZeroFee never has anyone's money.
//
// What the phone checks before it signs (SR3):
// - the amount is at most the batch's cost as the PHONE computes it from its usage (summed per model) and the one price
//   table (agent-price.ts): the relay may ask less (a Stop's estimate, capped; a part already paid), never more;
// - at most BATCH_CAP_MICROS for any one payment (one reply's most), and inside the month's cap (lowering it
//   holds at once; raising it needs Face ID), counted before signing;
// - the memo is the relay's id memo's exact shape ("agentzero <32 hex>"), so nothing else can ride in it;
// - one payment per batch figure (the batch's number and what was paid of it): a payment signed for it is kept (vault)
//   until the relay says it counted it; asked again for the same (a retry, a crash, the relay's 402) the SAME signed
//   transaction is sent again (NEAR runs a transaction once), never a second one;
// - one at a time on this phone (a lock), so two replies never pick the same nonce or count twice.
// The bytes are built, decoded again by a separate decoder (tx-decode.ts) and compared before the key signs.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { AGENT_USDC } from "./agent-route.ts";
import { BATCH_CAP_MICROS, batchMicros } from "./agent-price.ts";
import type { Chain } from "./chain.ts";
import { txHashOf } from "./chain.ts";
import { withMoveKey } from "./move-key.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords } from "./signer.ts";
import { base58 } from "./sol/bytes.ts";
import { type CoreAction, serialize, signedBase64, sameTransaction, type UnsignedTx } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";
import type { FloatRelay } from "./float-moves.ts";
import { parseQuote } from "./intents.ts";
import type { Vault } from "./vault.ts";
import { quoteDeadline } from "./quote-deadline.ts";

/** ZeroFee's receiving account (step O1), PINNED IN THIS BUILD: a relay can't redirect a payment. */
export const ZEROFEE_RECEIVE = "37764cf3c4418f8b0a963768bcaa1ddddc201cad32c040db2dfc919936465822";
/** USDC's contract on NEAR (AGENT_USDC without "nep141:"). */
export const USDC_CONTRACT = AGENT_USDC.slice("nep141:".length);
/** A NEP-141 transfer: 1 yocto attached, 30 Tgas (USDC's ft_transfer uses a few). */
export const PAY_GAS = 30_000_000_000_000n;
/** Under this much NEAR AgentZero can't send (fees): the screen says so and the next fill adds NEAR. 0.005 NEAR. */
export const FEES_LOW_YOCTO = 12n * 10n ** 21n;
/** SR3 H2: what a transfer's 30 Tgas can cost at NEAR's highest gas price, with a margin (0.004 NEAR): under it NEAR
 *  would refuse the transaction, so the phone never signs one (a reply's payment, or Move all's transfer to its deposit
 *  address). A fill tops NEAR up below FEES_LOW_YOCTO (0.012), well above it. */
export const PAY_FEE_YOCTO = 4n * 10n ** 21n;
/** A transaction is valid for 86,400 blocks after the block it names; past that (with a margin) it can never land. */
export const VALID_BLOCKS = 86_400 + 1_000;
/** What an account can spend: NEAR locks 10^19 yocto per byte of storage it uses. */
const spendable = (a: { balanceYocto: bigint; storageBytes: bigint }) => a.balanceYocto - a.storageBytes * 10n ** 19n;
export const MONTH_CAP_USD = 20;
export const MONTH_CAP_MOST_USD = 200;
const MONTH_MS = 30 * 86_400_000;
/** Move all waits this long after a payment was sent before it may go too (the payment has landed, or never will). */
export const EMPTY_AFTER_MS = 2 * 60_000;
const MEMO = /^agentzero [0-9a-f]{32}$/;
/** Its records, in the vault's "agentzero:" view (agent-wallet.ts records). */
export const PAY_KEYS = { pending: "pay-pending", month: "pay-month", cap: "pay-cap", receipts: "pay-receipts", paid: "pay-paid-replies" } as const;

const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();

/** What the relay said AgentZero owes (its closing line, its 402, or its pay route): checked here, never trusted for the
 *  amount. */
export interface Owed {
  owedMicros: unknown;
  /** One model's usage (a relay from before batches: one reply's), read only when `byModel` isn't there. */
  usage: unknown;
  model: unknown;
  memo: unknown;
  /** The relay's own number for this batch (each batch its own): a batch figure is paid once, by it (SR3 M7). */
  reply: unknown;
  /** Product decision, 4 Nov: the batch's usage summed per model (model → Anthropic's four counts), over `replies` replies. */
  byModel?: unknown;
  replies?: unknown;
  /** What was paid of this batch already (a payment that came in while a reply was settling). */
  paidMicros?: unknown;
}

/** One batch figure's payment, as kept until the relay counts it. */
export interface Pending {
  /** Which batch figure: replyId(memo, batch number[:paid so far]). */
  reply: string;
  tx: string;
  from: string;
  micros: number;
  signed: string;
  /** The transaction's nonce on AgentZero's key: once the key's nonce has passed it, it can never land. */
  nonce: string;
  /** The block height it was signed at: past it + VALID_BLOCKS, a transaction that hasn't landed never will. */
  height: number;
  atMs: number;
}

export interface PayDeps {
  vault: Vault;
  chain: Chain;
  /** ZeroFee's pinned relay (1Click's quotes): only "Move all to my Safe" asks it, to go home privately. */
  relay?: FloatRelay;
  /** Tests only: 1Click's quote key (a test key). */
  quoteKey?: string;
  /** AgentZero's own NEAR key, made for this signature and wiped after (agent-wallet.ts KeyMaker). */
  key: () => Promise<Uint8Array>;
  /** D103's check and the core's sheet: only raising the month's cap asks for them. */
  strong?: () => Promise<void>;
  approve?: (w: PlainWords) => Promise<boolean>;
  now?: () => number;
}

type Month = { startMs: number; micros: number };

/** The reply a payment is for: the relay's memo and its own id for the reply. */
export function replyId(memo: string, reply: string): string {
  return hex(sha256(enc.encode(JSON.stringify([memo, reply]))));
}
const REPLY = /^[0-9a-f]{16}$/;

/**
 * The amount to pay for this batch, or why not. The phone's own figure (the batch's usage × the one price table) is the
 * most; the relay may ask less, never more; one payment at most BATCH_CAP_MICROS. `reply`: which batch figure this is
 * (the batch's number, and what was paid of it when some was).
 */
export function payAmount(o: Owed): { micros: number; memo: string; reply: string } | { why: string } {
  // a batch (product decision, 4 Nov): its usage per model; a relay from before batches: one reply's usage and its model
  const byModel = o.byModel !== undefined ? o.byModel : typeof o.model === "string" ? { [o.model]: o.usage } : null;
  const own = batchMicros(byModel, o.replies ?? 1);
  if (own === null) return { why: "That cost can't be read." };
  if (typeof o.memo !== "string" || !MEMO.test(o.memo)) return { why: "That payment's note isn't ZeroFee's." };
  const asked = o.owedMicros;
  if (!Number.isSafeInteger(asked) || (asked as number) <= 0) return { why: "That cost can't be read." };
  if ((asked as number) > own) return { why: `ZeroFee asked more than AgentZero's replies cost. Nothing was paid.` };
  if ((asked as number) > BATCH_CAP_MICROS) return { why: `One payment can't be more than $${(BATCH_CAP_MICROS / 1e6).toFixed(2)}. Nothing was paid.` };
  if (typeof o.reply !== "string" || !REPLY.test(o.reply)) return { why: "That cost can't be told apart. Nothing was paid." };
  const paid = o.paidMicros ?? 0;
  if (!Number.isSafeInteger(paid) || (paid as number) < 0) return { why: "That cost can't be read." };
  return { micros: asked as number, memo: o.memo, reply: paid ? `${o.reply}:${paid}` : o.reply };
}

/** Move all's quote, as 1Click signed it, is exactly the move home asked for (SR3 L14). Null if yes; otherwise why not. */
export function homeRefusal(q: import("./intents.ts").QuoteFacts | null, o: { from: string; safe: string; held: bigint; nowMs: number }): string | null {
  if (!q) return "The swap service doesn't know that price.";
  if (q.status !== "PENDING_DEPOSIT" || !(Date.parse(q.deadline) > o.nowMs)) return "That price has run out.";
  if (q.originAsset !== AGENT_USDC || q.depositType !== "ORIGIN_CHAIN" || q.amountIn !== o.held.toString()) return "It isn't all of AgentZero's USDC.";
  if (q.destinationAsset !== AGENT_USDC || q.recipient !== o.safe || q.recipientType !== "INTENTS") return "It doesn't pay your Safe.";
  if (q.refundTo !== o.from || q.refundType !== "ORIGIN_CHAIN") return "A refund must come back to AgentZero's wallet.";
  if (!/^\d{1,30}$/.test(q.minAmountOut) || BigInt(q.minAmountOut) * 100n < o.held * 98n) return "It promises less than it should.";
  return null;
}

export class AgentPay {
  private turn: Promise<unknown> = Promise.resolve();
  private readonly d: PayDeps;
  constructor(d: PayDeps) {
    this.d = d;
  }
  private now(): number {
    return (this.d.now ?? Date.now)();
  }
  private async read<T>(name: string, fallback: T): Promise<T> {
    const raw = await this.d.vault.get(name);
    if (!raw) return fallback;
    try {
      return JSON.parse(new TextDecoder().decode(raw)) as T;
    } catch {
      return fallback;
    }
  }
  private write(name: string, v: unknown): Promise<void> {
    return this.d.vault.put(name, enc.encode(JSON.stringify(v)));
  }
  /** One at a time on this phone, and across cores on one vault. */
  private one<T>(run: () => Promise<T>): Promise<T> {
    const next = this.turn.then(() => withMoveKey(this.d.vault, "agent-pay", () => this.now(), run));
    this.turn = next.catch(() => undefined);
    return next;
  }

  private async cap(): Promise<number> {
    const c = await this.read<{ usd?: unknown } | null>(PAY_KEYS.cap, null);
    const usd = Number(c?.usd);
    return Number.isFinite(usd) && usd >= 0 && usd <= MONTH_CAP_MOST_USD ? usd : MONTH_CAP_USD;
  }
  /** The month's cap and what replies cost in it, in dollars, and when it ends. */
  async month(): Promise<{ capUsd: number; spentUsd: number; endsAtIso: string | null }> {
    const capUsd = await this.cap();
    const m = await this.read<Month | null>(PAY_KEYS.month, null);
    const live = m && this.now() < m.startMs + MONTH_MS ? m : null;
    return { capUsd, spentUsd: (live?.micros ?? 0) / 1e6, endsAtIso: live ? new Date(live.startMs + MONTH_MS).toISOString() : null };
  }
  /** Lower (or the same) holds at once; higher needs D103's check and the core's sheet (Face ID). */
  async setCap(usd: unknown): Promise<{ capUsd: number } | { declined: true }> {
    const n = Number(usd);
    if (!(Number.isInteger(n) && n >= 0 && n <= MONTH_CAP_MOST_USD)) throw invalid(`usd: a whole number of dollars, $0 to $${MONTH_CAP_MOST_USD}`);
    const was = await this.cap();
    if (n > was) {
      if (!this.d.strong || !this.d.approve) throw refused("Raising AgentZero's limit needs Face ID.");
      await this.d.strong();
      const words: PlainWords = { title: "Raise AgentZero's monthly limit", lines: [`AgentZero may spend up to $${n} a month on thinking (now $${was}).`, "It pays only from its own wallet, one reply at a time."], warnings: [], effect: [] };
      if (!(await this.d.approve(words).catch(() => false))) return { declined: true };
    }
    await this.write(PAY_KEYS.cap, { usd: n });
    return { capUsd: n };
  }

  /** The payment kept for a reply, if any (sent or not yet counted). */
  pending(): Promise<Pending | null> {
    return this.read<Pending | null>(PAY_KEYS.pending, null);
  }
  /** The relay counted this reply's payment: it is done. */
  async counted(tx: unknown): Promise<{ ok: true }> {
    await this.one(async () => {
      const p = await this.pending();
      if (p && p.tx === tx) {
        await this.d.vault.delete(PAY_KEYS.pending);
        const paid = await this.read<string[]>(PAY_KEYS.paid, []);
        await this.write(PAY_KEYS.paid, [p.reply, ...(Array.isArray(paid) ? paid : [])].slice(0, 1000));
        const r = await this.read<{ tx: string; micros: number; atMs: number }[]>(PAY_KEYS.receipts, []);
        await this.write(PAY_KEYS.receipts, [{ tx: p.tx, micros: p.micros, atMs: p.atMs }, ...(Array.isArray(r) ? r : [])].slice(0, 200));
      }
    });
    return { ok: true };
  }

  /**
   * Pay what AgentZero owes: one batch, whole (no sheet: AgentZero's own money, inside its caps). → {tx, from, micros}:
   * the transaction the relay reads. Asked again for the same batch figure, the same transaction (sent again; NEAR runs it
   * once). Refused by name when the amount isn't right, the caps are reached, or AgentZero's wallet can't pay (no USDC,
   * or no NEAR for the fee).
   */
  pay(o: Owed): Promise<{ tx: string; from: string; micros: number }> {
    return this.one(async () => {
      const a = payAmount(o);
      if ("why" in a) throw refused(a.why);
      const reply = replyId(a.memo, a.reply);
      // SR3 M7: a batch figure already paid and counted is never paid again (a stale or repeated ask)
      const done = await this.read<string[]>(PAY_KEYS.paid, []);
      if (Array.isArray(done) && done.includes(reply)) throw refused("That was already paid. Nothing was paid again.");
      const kept = await this.pending();
      if (kept && kept.reply === reply) {
        await this.send(kept);
        return { tx: kept.tx, from: kept.from, micros: kept.micros };
      }
      // another reply's payment, not yet counted, is never left behind: it is sent again, and this one waits for it
      if (kept) {
        await this.send(kept);
        throw refused("AgentZero's last payment is still on its way. Try again in a moment.");
      }
      // the month's cap, counted before signing
      const cap = await this.cap();
      const m = await this.read<Month | null>(PAY_KEYS.month, null);
      const live: Month = m && this.now() < m.startMs + MONTH_MS ? m : { startMs: this.now(), micros: 0 };
      if (live.micros + a.micros > cap * 1e6) throw new ProblemError({ code: "agentzero.pay.cap", whatHappened: `AgentZero has used this month's $${cap} for thinking.`, money: { state: "safe", where: "in AgentZero's wallet" }, next: { kind: "nothing", label: "OK" } });
      const secret = await this.d.key();
      let p: Pending;
      try {
        const pub = ed25519.getPublicKey(secret);
        const from = hex(pub);
        const publicKey = `ed25519:${base58(pub)}`;
        const block = await this.d.chain.commonBlock();
        const [key, acct, usdc] = await Promise.all([
          this.d.chain.accessKey(from, publicKey, block),
          this.d.chain.account(from, block),
          this.d.chain.view(USDC_CONTRACT, "ft_balance_of", { account_id: from }, block),
        ]);
        if (!key || !acct) throw new ProblemError({ code: "agentzero.pay.empty", whatHappened: "AgentZero's wallet has no money yet.", money: { state: "safe", where: "in AgentZero's wallet" }, next: { kind: "nothing", label: "OK" } });
        if (spendable(acct) < PAY_FEE_YOCTO) throw new ProblemError({ code: "agentzero.pay.fees", whatHappened: "AgentZero has no NEAR left for sending fees. Add money to keep going.", money: { state: "safe", where: "in AgentZero's wallet" }, next: { kind: "nothing", label: "OK" } });
        if (typeof usdc !== "string" || !/^\d{1,30}$/.test(usdc) || BigInt(usdc) < BigInt(a.micros)) throw new ProblemError({ code: "agentzero.pay.empty", whatHappened: "AgentZero's wallet is empty. Add money to keep going.", money: { state: "safe", where: "in AgentZero's wallet" }, next: { kind: "nothing", label: "OK" } });
        const actions: CoreAction[] = [{ kind: "call", method: "ft_transfer", args: enc.encode(JSON.stringify({ receiver_id: ZEROFEE_RECEIVE, amount: String(a.micros), memo: a.memo })), gas: PAY_GAS, depositYocto: 1n }];
        const tx: UnsignedTx = { signerId: from, publicKey, nonce: key.nonce + 1n, receiverId: USDC_CONTRACT, blockHash: block.hash, actions };
        const bytes = serialize(tx);
        if (!sameTransaction(decodeTransaction(bytes), tx)) throw new ProblemError(securityProblems.decodeMismatch());
        const signature = ed25519.sign(sha256(bytes), secret);
        p = { reply, tx: txHashOf(bytes), from, micros: a.micros, signed: signedBase64(tx, signature), nonce: String(tx.nonce), height: block.height, atMs: this.now() };
      } finally {
        secret.fill(0);
      }
      // kept and counted BEFORE it is sent: a crash after this sends the same transaction again, never a second one
      await this.write(PAY_KEYS.pending, p);
      await this.write(PAY_KEYS.month, { startMs: live.startMs, micros: live.micros + a.micros });
      await this.send(p);
      return { tx: p.tx, from: p.from, micros: p.micros };
    });
  }

  /**
   * Send a kept payment (again). NEAR runs a transaction once, so a second send of the same bytes can't pay twice. Only a
   * transaction NEAR ran and refused is dropped (its money never moved; its amount goes back to the month); any other
   * failure keeps it, to be sent again or forgotten by `forget` once it provably can't land.
   */
  private async send(p: Pending): Promise<void> {
    let r;
    try {
      r = await this.d.chain.send(p.signed, p.tx, p.from);
    } catch {
      throw new ProblemError({ code: "agentzero.pay.sending", whatHappened: "AgentZero's payment is on its way. Try again in a moment.", money: { state: "safe", where: "in AgentZero's wallet" }, next: { kind: "nothing", label: "OK" } });
    }
    if (r.status === "failed" || r.partly) return this.drop(p, "That payment didn't go through. Nothing was paid.");
  }
  private async drop(p: Pending, line: string): Promise<never> {
    await this.d.vault.delete(PAY_KEYS.pending);
    const m = await this.read<Month | null>(PAY_KEYS.month, null);
    if (m && m.micros >= p.micros) await this.write(PAY_KEYS.month, { ...m, micros: m.micros - p.micros });
    throw refused(line);
  }

  /**
   * "Move all to my Safe" (§2, D152; SR3 L14, the review's call: privately). All of AgentZero's USDC goes home through
   * 1Click: paid on NEAR into a one-time deposit address, delivered into the Safe's own NEAR Intents balance, so no public
   * transfer from AgentZero's account names the Safe. The quote is ZeroFee's own (the pinned relay), read back as 1Click
   * signed it and held to exactly this: USDC in and out, all of it, the core's own Safe (`safe`, never an app's word),
   * refunds to AgentZero's own account, a fair minimum, in date. Then the core's sheet (`approve`), then one plain
   * ft_transfer to the deposit address. Refused while a reply's payment was just sent. AgentZero keeps its NEAR (fees).
   */
  empty(safe: string, approve: (usd: number) => Promise<boolean>): Promise<{ tx: string; micros: number } | { declined: true }> {
    return this.one(async () => {
      if (!/^[a-z0-9._-]{2,64}$/.test(safe)) throw refused("There's no Safe to move it to yet.");
      // a payment just sent may still be landing; one older has landed or never will (its nonce goes to this move then)
      const kept = await this.pending();
      if (kept && this.now() - kept.atMs < EMPTY_AFTER_MS) throw refused("AgentZero's last payment is still on its way. Try again in a moment.");
      if (!this.d.relay) throw refused("This phone can't reach ZeroFee right now. Nothing moved.");
      const secret = await this.d.key();
      try {
        const pub = ed25519.getPublicKey(secret);
        const from = hex(pub);
        const publicKey = `ed25519:${base58(pub)}`;
        const block = await this.d.chain.commonBlock();
        const [key, acct, usdc] = await Promise.all([this.d.chain.accessKey(from, publicKey, block), this.d.chain.account(from, block), this.d.chain.view(USDC_CONTRACT, "ft_balance_of", { account_id: from }, block)]);
        const held = typeof usdc === "string" && /^\d{1,30}$/.test(usdc) ? BigInt(usdc) : 0n;
        if (!key || !acct || held === 0n) throw refused("AgentZero's wallet is empty.");
        if (spendable(acct) < PAY_FEE_YOCTO) throw refused("AgentZero has no NEAR left for the fee. Add money first.");
        // ZeroFee's own quote for exactly this move, read back as 1Click signed it
        const ask = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: AGENT_USDC, depositType: "ORIGIN_CHAIN", destinationAsset: AGENT_USDC, amount: held.toString(), refundTo: from, refundType: "ORIGIN_CHAIN", recipient: safe, recipientType: "INTENTS", deadline: quoteDeadline(this.now(), 30 * 60_000), confidentiality: "basic" };
        const got = (await this.d.relay.quote(ask).catch(() => null)) as { quote?: { depositAddress?: unknown }; zerofeeStatusTag?: string } | null;
        const deposit = got?.quote?.depositAddress;
        if (typeof deposit !== "string" || !/^[0-9a-f]{64}$/.test(deposit)) throw refused("The swap service didn't give a price for that. Nothing moved.");
        const q = parseQuote(await this.d.relay.status(deposit, got?.zerofeeStatusTag).catch(() => null), deposit, this.d.quoteKey, this.now());
        const why = homeRefusal(q, { from, safe, held, nowMs: this.now() });
        if (why) throw refused(`${why} Nothing moved.`);
        if (!(await approve(Number(held) / 1e6).catch(() => false))) return { declined: true } as const;
        const actions: CoreAction[] = [{ kind: "call", method: "ft_transfer", args: enc.encode(JSON.stringify({ receiver_id: deposit, amount: held.toString() })), gas: PAY_GAS, depositYocto: 1n }];
        const tx: UnsignedTx = { signerId: from, publicKey, nonce: key.nonce + 1n, receiverId: USDC_CONTRACT, blockHash: block.hash, actions };
        const bytes = serialize(tx);
        if (!sameTransaction(decodeTransaction(bytes), tx)) throw new ProblemError(securityProblems.decodeMismatch());
        const hash = txHashOf(bytes);
        const r = await this.d.chain.send(signedBase64(tx, ed25519.sign(sha256(bytes), secret)), hash, from);
        if (r.status === "failed" || r.partly) throw refused("That move didn't go through. Nothing moved.");
        return { tx: hash, micros: Number(held) };
      } finally {
        secret.fill(0);
      }
    });
  }

  /** What AgentZero's wallet holds: its plain USDC and its NEAR (for fees), as two nodes agree at one block. */
  async balance(): Promise<{ address: string; usdcMicros: bigint; nearYocto: bigint; feesLow: boolean }> {
    const secret = await this.d.key();
    let address: string;
    try {
      address = hex(ed25519.getPublicKey(secret));
    } finally {
      secret.fill(0);
    }
    const block = await this.d.chain.commonBlock();
    const [acct, usdc] = await Promise.all([this.d.chain.account(address, block), this.d.chain.view(USDC_CONTRACT, "ft_balance_of", { account_id: address }, block).catch(() => "0")]);
    const nearYocto = acct ? spendable(acct) : 0n;
    return { address, usdcMicros: typeof usdc === "string" && /^\d{1,30}$/.test(usdc) ? BigInt(usdc) : 0n, nearYocto, feesLow: nearYocto < FEES_LOW_YOCTO };
  }

  /**
   * The relay's two archival nodes don't know the kept payment (SR3 H1/H2). It is forgotten (and its amount given back to
   * the month) only when it provably can never land: NEAR's chain is past the last block its transaction is valid for
   * (signed at height h, valid until h + 86,400 blocks). Before that it is kept and sent again: it may still land, and an
   * archival node knows every transaction that did, so a payment that landed is never forgotten.
   */
  forget(tx: unknown): Promise<{ forgotten: boolean }> {
    return this.one(async () => {
      const p = await this.pending();
      if (!p || p.tx !== tx) return { forgotten: false };
      const block = await this.d.chain.commonBlock();
      if (!(Number.isSafeInteger(p.height) && block.height > p.height + VALID_BLOCKS)) {
        await this.send(p).catch(() => undefined);
        return { forgotten: false };
      }
      await this.drop(p, "forgotten").catch(() => undefined);
      return { forgotten: true };
    });
  }
}
