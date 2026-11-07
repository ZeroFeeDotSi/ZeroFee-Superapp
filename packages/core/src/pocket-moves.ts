// The private pocket's way out: home to the main balance (UI: money is never stuck). One coin per move, the pocket's
// own coin to the same coin in the main account's NEAR Intents balance, through a confidential 1Click quote the core
// asks for itself through ZeroFee's pinned relay, exactly as the float's moves (float-moves.ts): the recipient is the
// core's own main account (never an app's word), a refund comes back to the pocket, and before it signs the core reads
// the quote back by its deposit address and checks the transfer 1Click prepared is the one payment the quote needs
// (private-pocket.ts) and the quote is the one it asked for. No sheet: money going home to the person's own account.
// A move is saved before each step, so a restart finds it; the caller's `key` makes asking again safe.
import { POCKET_HOME_LEAST_PERCENT } from "./float-floors.ts";
import type { FloatRelay } from "./float-moves.ts";
import { parseQuote, type QuoteFacts } from "./intents.ts";
import { type Nep413Payload, pocketIntentRefusal, signNep413 } from "./private-pocket.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { withMoveKey } from "./move-key.ts";
import { utf8 } from "./sol/bytes.ts";
import type { Vault } from "./vault.ts";
import { quoteDeadline } from "./quote-deadline.ts";

export interface PocketMove {
  id: string;
  status: "pending" | "done" | "failed" | "refunded";
  where: "pocket" | "in-flight" | "main";
  sent: { tokenId: string; amount: string };
  expected: { tokenId: string; amount: string };
  startedAtIso: string;
  updatedAtIso: string;
}

interface Kept {
  move: PocketMove;
  key: string;
  fields: string;
  depositAddress?: string;
  tag?: string;
  /** The signed transfer, kept until 1Click has it: sending it again is harmless (its one-time number is used once). */
  signed?: unknown;
  submitted?: boolean;
}

export interface PocketMoveDeps {
  vault: Vault;
  relay: FloatRelay | undefined;
  /** The pocket and its key; refused if there is none. */
  pocket: () => Promise<{ address: string; secret: () => Promise<Uint8Array> }>;
  /** The account's own NEAR account id: the only place the pocket's money goes. */
  mainAccount: () => Promise<string>;
  /** What 1Click holds in the pocket (oneclick-account.ts), for "all". */
  balances: () => Promise<{ tokenId: string; amount: string }[]>;
  now?: () => number;
  /** The key a 1Click quote must be signed with. Default: 1Click's own; tests sign their quotes with a test key. */
  quoteKey?: string;
  /** How the money lands at `mainAccount`: the Safe's public NEAR Intents balance (default), or another private balance
   *  (the new words' pocket or float, SubWallets.sweepOldWords). The quote is checked for exactly this. */
  recipientType?: "INTENTS" | "CONFIDENTIAL_INTENTS";
  /** The vault record the moves are kept in. Default: the pocket's own way home. */
  record?: string;
}

const RECORD = "pocket-move-log";
const QUOTE_MINUTES = 10;
const KEEP_MS = 7 * 86_400_000;
/** 1Click's fee and the 1 % slippage fit well inside this (float-floors.ts: Move's sheet says the least from it). */
const AT_LEAST_PERCENT = POCKET_HOME_LEAST_PERCENT;
const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
/**
 * the audit's way-home audit M9 (7 Nov): a way home's refusal in plain words (rule 8): what failed, by name, as the first
 * sentence (the refusal's head, shell-api refusal-face); where the money is and the next tap after it. The service's own
 * text ("fetch failed", a relay's message) is never on screen: it rides on the error's `cause`, for the log.
 */
export const HOME_REFUSED = {
  said: "NEAR Intents said no.",
  silent: "NEAR Intents didn't answer.",
  noAddress: "NEAR Intents gave no address to pay.",
  nothingToSign: "NEAR Intents sent nothing to approve.",
  checked: "ZeroFee stopped it: NEAR Intents' price wasn't the one it asked for.",
  still: "Your money is still in Private. Try again in a minute.",
  notTaken: "NEAR Intents didn't take it. Check Activity for where your money is.",
} as const;
/** The refusal's every field in the same words: never the generic "This wallet can't approve this" or "in that wallet". */
const homeRefused = (head: string, cause?: unknown) =>
  Object.assign(new ProblemError({ ...securityProblems.subwalletRefused(`${head} ${HOME_REFUSED.still}`), whatHappened: head, money: { state: "safe", where: "in Private" } }), cause === undefined ? {} : { cause });
const notTaken = (cause: unknown) =>
  Object.assign(new ProblemError({ ...securityProblems.subwalletRefused(HOME_REFUSED.notTaken), whatHappened: "NEAR Intents didn't take it.", money: { state: "unsure", where: "in Private, or on its way to your Safe", check: "Activity" } }), { cause });
const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));

export class PocketMoves {
  private writing: Promise<unknown> = Promise.resolve();
  private readonly d: PocketMoveDeps;

  constructor(deps: PocketMoveDeps) {
    this.d = deps;
  }

  private now(): number {
    return this.d.now ? this.d.now() : Date.now();
  }

  /** One call per key at a time (audit AUD-CORE-1): an overlapping call with the same key gets the first one's answer. */
  private readonly inFlight = new Map<string, Promise<PocketMove>>();

  /** `amount`: the coin's smallest units, as text, or "all". `key`: the caller's own name for this move. */
  home(tokenId: unknown, amount: unknown, key: unknown): Promise<PocketMove> {
    if (typeof key !== "string") return this.homeNow(tokenId, amount, key);
    const had = this.inFlight.get(key);
    if (had) return had;
    // And across cores on the same vault (audit RM-4).
    const p = withMoveKey(this.d.vault, `pocket:${key}`, () => this.now(), () => this.homeNow(tokenId, amount, key)).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async homeNow(tokenId: unknown, amount: unknown, key: unknown): Promise<PocketMove> {
    if (typeof tokenId !== "string" || !/^nep141:[a-z0-9_.-]{2,64}$/.test(tokenId)) throw invalid("The coin must be one on NEAR.");
    if (amount !== "all" && (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n)) throw invalid('amount is the coin\'s smallest units, as text, or "all"');
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw invalid("key is the caller's own name for this move, 8 to 80 letters, digits, - or _");
    const fields = JSON.stringify([tokenId, amount]);
    const had = (await this.kept()).find((k) => k.key === key);
    if (had) {
      if (had.fields !== fields) throw invalid("That key names a different move.");
      return { ...had.move };
    }
    const relay = this.d.relay;
    if (!relay) throw refused("Private payments aren't set up on this phone yet.");
    const pocket = await this.d.pocket();
    const main = await this.d.mainAccount();
    const units = amount === "all" ? BigInt((await this.d.balances()).find((b) => b.tokenId === tokenId)?.amount ?? "0") : BigInt(amount as string);
    if (units === 0n) throw invalid("Your private balance has none of that coin.");
    const atLeast = (units * AT_LEAST_PERCENT) / 100n;
    const at = new Date(this.now()).toISOString();
    const k: Kept = {
      key, fields,
      move: { id: `pm-${key}`, status: "pending", where: "pocket", sent: { tokenId, amount: "0" }, expected: { tokenId, amount: atLeast.toString() }, startedAtIso: at, updatedAtIso: at },
    };
    try {
      const raw = await relay.quote({
        dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: tokenId, depositType: "CONFIDENTIAL_INTENTS",
        destinationAsset: tokenId, amount: units.toString(), refundTo: pocket.address, refundType: "CONFIDENTIAL_INTENTS",
        recipient: main, recipientType: this.d.recipientType ?? "INTENTS", deadline: quoteDeadline(this.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
      });
      const depositAddress = raw?.quote?.depositAddress;
      if (typeof depositAddress !== "string" || !/^[0-9a-f]{64}$/.test(depositAddress)) throw homeRefused(HOME_REFUSED.noAddress);
      k.depositAddress = depositAddress;
      if (typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag)) k.tag = raw.zerofeeStatusTag;
      await this.keep(k);
      const gen = await relay.generateIntent(pocket.address, depositAddress);
      const p = gen?.intent?.payload;
      const payload: Nep413Payload | null = gen?.intent?.standard === "nep413" && typeof p?.message === "string" && typeof p?.nonce === "string" && typeof p?.recipient === "string" ? { message: p.message, nonce: p.nonce, recipient: p.recipient, ...(p.callbackUrl !== undefined ? { callbackUrl: p.callbackUrl } : {}) } : null;
      if (!payload) throw homeRefused(HOME_REFUSED.nothingToSign);
      // The quote by its deposit address, as 1Click signed it (the relay only passes it on): never the app's word.
      const quote = parseQuote(await relay.status(depositAddress, k.tag), depositAddress, this.d.quoteKey);
      // pocketIntentRefusal also holds the refund to the pocket itself.
      const why = pocketIntentRefusal(payload, quote, depositAddress, pocket.address, this.now()) ?? notAsked(quote!, tokenId, units, atLeast, main, this.d.recipientType ?? "INTENTS");
      if (why) throw homeRefused(HOME_REFUSED.checked, why);
      k.move.sent = { tokenId, amount: quote!.amountIn };
      k.signed = signNep413(payload, await pocket.secret());
      await this.keep(k);
    } catch (e) {
      // Nothing was signed: the money never left the pocket.
      if (k.depositAddress) (k.move.status = "failed"), await this.keep(k);
      throw e instanceof ProblemError ? e : homeRefused((e as { refused?: boolean } | null)?.refused ? HOME_REFUSED.said : HOME_REFUSED.silent, e);
    }
    // Signed: from here the money may move, so a move 1Click may have is answered, never thrown. Only 1Click's own "no"
    // ends it here; with no answer at all it stays pending, and subwallet.private.move sends it again.
    try {
      await relay.submitIntent(k.signed);
      k.submitted = true;
      k.move.where = "in-flight";
    } catch (e) {
      if ((e as { refused?: boolean }).refused) {
        delete k.signed;
        k.move.status = "failed";
        await this.keep(k);
        throw notTaken(e);
      }
    }
    await this.keep(k);
    return { ...k.move };
  }

  /** Where one move's money is now, from 1Click's status through the relay (a signed transfer cut off by a restart is sent again). */
  async move(id: unknown): Promise<PocketMove> {
    await this.writing;
    const k = (await this.kept()).find((x) => x.move.id === id);
    if (!k) throw new ProblemError(securityProblems.floatMoveUnknown());
    await this.refresh(k);
    return { ...k.move };
  }

  /** The last week's moves, newest first, the open ones read again. */
  async moves(): Promise<PocketMove[]> {
    const all = await this.kept();
    for (const k of all.filter((x) => x.move.status === "pending").slice(0, 10)) await this.refresh(k).catch(() => undefined);
    return (await this.kept()).map((k) => ({ ...k.move })).sort((a, b) => b.startedAtIso.localeCompare(a.startedAtIso));
  }

  private async refresh(k: Kept): Promise<void> {
    if (k.move.status !== "pending" || !k.depositAddress || !this.d.relay) return;
    const relay = this.d.relay;
    const raw = (await relay.status(k.depositAddress, k.tag).catch(() => null)) as { status?: unknown } | null;
    const status = typeof raw?.status === "string" ? raw.status : "";
    const quote = parseQuote(raw, k.depositAddress, this.d.quoteKey);
    if (k.signed && !k.submitted && status === "PENDING_DEPOSIT" && quote && Date.parse(quote.deadline) > this.now()) {
      await relay.submitIntent(k.signed).then(() => ((k.submitted = true), (k.move.where = "in-flight")), () => undefined);
    }
    if (status === "SUCCESS") Object.assign(k.move, { status: "done", where: "main" });
    else if (status === "REFUNDED") Object.assign(k.move, { status: "refunded", where: "pocket" });
    else if (status === "FAILED") Object.assign(k.move, { status: "failed", where: "pocket" });
    // Past the deadline and never submitted: failed, still in the pocket. Submitted: followed to 1Click's final word (AUD-CORE-3).
    else if (status === "PENDING_DEPOSIT" && quote && Date.parse(quote.deadline) <= this.now() && !k.submitted) Object.assign(k.move, { status: "failed", where: "pocket" });
    // Submitted, and an hour past its deadline still waiting (audit RM-2): the pocket's intent was signed to expire with
    // its price, so it can't run any more: it failed, the money still in the pocket.
    else if (status === "PENDING_DEPOSIT" && quote && k.submitted && Date.parse(quote.deadline) + 60 * 60_000 <= this.now()) Object.assign(k.move, { status: "failed", where: "pocket" });
    else if (["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"].includes(status)) k.move.where = "in-flight";
    if (k.move.status !== "pending") delete k.signed;
    await this.keep(k);
  }

  private async kept(): Promise<Kept[]> {
    const raw = await this.d.vault.get(this.d.record ?? RECORD);
    if (!raw) return [];
    try {
      const all = JSON.parse(new TextDecoder().decode(raw)) as Kept[];
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }

  private keep(k: Kept): Promise<void> {
    const next = this.writing.then(async () => {
      k.move.updatedAtIso = new Date(this.now()).toISOString();
      const old = (x: Kept) => x.move.status !== "pending" && Date.parse(x.move.updatedAtIso) + KEEP_MS < this.now();
      const others = (await this.kept()).filter((x) => x.key !== k.key && !old(x));
      await this.d.vault.put(this.d.record ?? RECORD, utf8(JSON.stringify([k, ...others])));
    });
    this.writing = next.catch(() => undefined);
    return next;
  }
}

/** The quote is the one asked for: the pocket's coin, confidential, the same coin to the main account, all of it, near enough. */
function notAsked(q: QuoteFacts, tokenId: string, units: bigint, atLeast: bigint, main: string, recipientType: "INTENTS" | "CONFIDENTIAL_INTENTS"): string | null {
  if (q.originAsset !== tokenId || q.depositType !== "CONFIDENTIAL_INTENTS") return "It isn't paid from your private balance's coin.";
  if (q.destinationAsset !== tokenId) return "It doesn't deliver the same coin.";
  if (q.recipient !== main || q.recipientType !== recipientType) return recipientType === "INTENTS" ? "The swap service's price doesn't pay your Safe. Nothing moved." : "The swap service's price doesn't pay your new private balance. Nothing moved.";
  if (q.amountIn !== units.toString()) return "It doesn't take the amount asked for.";
  if (!/^\d+$/.test(q.minAmountOut) || BigInt(q.minAmountOut) < atLeast) return "It promises less than asked for.";
  return null;
}
