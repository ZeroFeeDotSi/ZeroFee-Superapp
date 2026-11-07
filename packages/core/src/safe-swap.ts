// The Safe's swap in place (product decision, 5 Nov; QA's design review, no MUST): a coin the Safe holds in
// its own intents.near balance swaps into another intents coin, delivered back into that same balance. ONE on-chain call
// the account contract makes and counts (intents.near mt_transfer of exactly amountIn to the quote's deposit address;
// lib.rs moves() counts it toward the bands, waits and the day's total), with one Face ID. No Safe key is ever registered
// on intents.near and nothing is withdrawn or bridged.
//
// Who prices it is 1Click (an INTENTS-to-INTENTS quote), the only path open to a contract account that can't sign NEP-413
// intents. The core asks the pinned relay ITSELF (the partner key stays there; the relay passes this case only into a
// ZeroFee Safe), reads the quote back as 1Click SIGNED it, holds it to the person's figure, and keeps it, so the main
// key's sheet checks the mt_transfer against it (intents.ts checkIntents: the signed quote for that receiver, still
// waiting, amountIn equal to the bytes, refunds to this account). the audit's condition 2: receiver = the SIGNED quote's
// deposit address, amountIn = units, the deadline ahead, minAmountOut at least the figure shown: refused here otherwise.
// Loaded with its first use (subwallets.safeSwapQuote), never in Home's first load.
import { intentsRefused } from "./intents-refused.ts";
import { parseQuote, type QuoteFacts } from "./intents.ts";
import { ProblemError } from "./problem.ts";
import { QUOTE_DEADLINE_STEP_MS, quoteDeadline } from "./quote-deadline.ts";
import { securityProblems } from "./security-problems.ts";

/** The intents coins it takes: NEAR tokens (nep141:…) and multi-tokens (nep245:…), by their shape only. */
const ASSET = /^(?:nep141:[a-z0-9_.-]{2,64}|nep245:[a-z0-9_.-]{2,64}:[A-Za-z0-9_.-]{1,80})$/;
const UNITS = /^\d{1,40}$/;
/** A NEAR account name (the Safe's). */
const NEAR_ACCOUNT = /^(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/;
/** How long the quote is asked to last, and how long the core keeps it for the sheet's check. */
export const SAFE_SWAP_DEADLINE_MS = 10 * 60_000;
export const SAFE_SWAP_KEEP_MS = 10 * 60_000;

export interface SafeSwapDeps {
  relay?: { quote(body: Record<string, unknown>): Promise<any> };
  /** The quote's full record through the relay, with its tag (what 1Click signed). */
  status?: (depositAddress: string, tag?: string) => Promise<unknown | null>;
  quoteKey?: string;
  /** The Safe's account id. */
  account: () => Promise<string | null>;
  now?: () => number;
}
export interface SafeSwapQuote {
  depositAddress: string; amountIn: string; amountOut: string; minAmountOut: string; deadlineIso: string;
  amountInUsd?: string; amountOutUsd?: string; etaSeconds?: number;
  /** The relay's tag for this deposit address: only with it does 1Click's status say what arrived (the job's end). */
  statusTag?: string;
}
interface Kept { depositAddress: string; tag?: string; atMs: number }

const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));

/** Why a signed quote isn't the one asked for (the audit's condition 2), or null. Exported for its tests. */
export function safeSwapRefusal(q: QuoteFacts | null, o: { from: string; to: string; amount: string; atLeast: string; account: string; nowMs: number }): string | null {
  if (!q) return "NEAR Intents didn't sign this price. Nothing moved.";
  if (q.status !== "PENDING_DEPOSIT" || !(Date.parse(q.deadline) > o.nowMs)) return "This price is too old. Nothing moved.";
  if (Date.parse(q.deadline) > o.nowMs + SAFE_SWAP_DEADLINE_MS + QUOTE_DEADLINE_STEP_MS + 60_000) return "This price is too old. Nothing moved.";
  if (q.depositType !== "INTENTS" || q.swapType !== "EXACT_INPUT") return "NEAR Intents sent a different kind of price. Nothing moved.";
  if (q.originAsset !== o.from || q.destinationAsset !== o.to) return "NEAR Intents priced different coins. Nothing moved.";
  if (q.amountIn !== o.amount) return "NEAR Intents priced a different amount. Nothing moved.";
  if (q.recipient !== o.account || q.recipientType !== "INTENTS") return "This price doesn't pay into your Safe. Nothing moved.";
  if (q.refundTo !== o.account || q.refundType !== "INTENTS") return "This price doesn't refund to your Safe. Nothing moved.";
  if (!UNITS.test(q.minAmountOut) || BigInt(q.minAmountOut) < BigInt(o.atLeast)) return "The price changed. Nothing moved.";
  return null;
}

export function createSafeSwaps(d: SafeSwapDeps) {
  const now = d.now ?? Date.now;
  const kept = new Map<string, Kept>();
  const sweep = () => { for (const [k, v] of kept) if (now() - v.atMs > SAFE_SWAP_KEEP_MS) kept.delete(k); };

  /** The quote for the Safe's swap, asked by the core, checked as 1Click signed it, and kept for the sheet's check. */
  async function quote(from: unknown, to: unknown, amount: unknown, atLeast: unknown): Promise<SafeSwapQuote> {
    if (typeof from !== "string" || !ASSET.test(from) || typeof to !== "string" || !ASSET.test(to) || from === to) throw new ProblemError(securityProblems.requestInvalid("from and to are two intents coins (nep141:… or nep245:…)"));
    if (typeof amount !== "string" || !UNITS.test(amount) || BigInt(amount) === 0n) throw new ProblemError(securityProblems.requestInvalid("amount is the coin's smallest units, as text"));
    if (typeof atLeast !== "string" || !UNITS.test(atLeast) || BigInt(atLeast) === 0n) throw new ProblemError(securityProblems.requestInvalid("atLeast is the least that may arrive, smallest units, as text"));
    if (!d.relay || !d.status) throw refused("Swaps in your Safe aren't set up on this phone yet.");
    const account = await d.account();
    if (!account || !NEAR_ACCOUNT.test(account)) throw refused("Set up your Safe first.");
    const raw = await d.relay.quote({
      dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: from, depositType: "INTENTS", destinationAsset: to, amount,
      refundTo: account, refundType: "INTENTS", recipient: account, recipientType: "INTENTS",
      deadline: quoteDeadline(now(), SAFE_SWAP_DEADLINE_MS), confidentiality: "basic",
    }).catch((e: unknown) => {
      throw e instanceof ProblemError ? e : intentsRefused(e, "in your Safe");
    });
    const depositAddress = raw?.quote?.depositAddress;
    if (typeof depositAddress !== "string" || !/^[0-9a-f]{64}$/.test(depositAddress)) throw refused("NEAR Intents gave no address to pay. Nothing moved.");
    const tag = typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag) ? raw.zerofeeStatusTag : undefined;
    // what counts is 1Click's own signed quote for that address, never the relay's answer above
    const q = parseQuote(await d.status(depositAddress, tag).catch(() => null), depositAddress, d.quoteKey);
    const why = safeSwapRefusal(q, { from, to, amount, atLeast, account, nowMs: now() });
    if (why) throw refused(why);
    sweep();
    kept.set(depositAddress, { depositAddress, ...(tag ? { tag } : {}), atMs: now() });
    const eta = q!.timeEstimate;
    return {
      depositAddress, amountIn: q!.amountIn, amountOut: q!.amountOut ?? q!.minAmountOut, minAmountOut: q!.minAmountOut, deadlineIso: q!.deadline,
      ...(q!.amountInUsd ? { amountInUsd: q!.amountInUsd } : {}), ...(q!.amountOutUsd ? { amountOutUsd: q!.amountOutUsd } : {}),
      ...(typeof eta === "number" && Number.isInteger(eta) && eta > 0 && eta <= 3600 ? { etaSeconds: eta } : {}),
      ...(tag ? { statusTag: tag } : {}),
    };
  }

  /** For the main key's sheet: the quote this core asked for that address, as 1Click signed it; null for any other. */
  async function facts(depositAddress: string): Promise<unknown | null> {
    sweep();
    const k = kept.get(depositAddress);
    if (!k || !d.status) return null;
    return d.status(depositAddress, k.tag).catch(() => null);
  }

  /** The core asked a Safe swap's quote for this address (the tag's record, dev-signer intentOf): no relay read. */
  function asked(depositAddress: string): boolean {
    return kept.has(depositAddress);
  }

  return { quote, facts, asked };
}

/** One door per core (SubWallets' own options): the quotes it keeps live as long as the core does. */
const doors = new WeakMap<object, ReturnType<typeof createSafeSwaps>>();
export function safeSwapsOf(o: { floatRelay?: SafeSwapDeps["relay"]; privateStatus?: SafeSwapDeps["status"]; quoteKey?: string; mainAccount?: () => Promise<string | null> }) {
  let door = doors.get(o);
  if (!door) doors.set(o, (door = createSafeSwaps({ ...(o.floatRelay ? { relay: o.floatRelay } : {}), ...(o.privateStatus ? { status: o.privateStatus } : {}), ...(o.quoteKey ? { quoteKey: o.quoteKey } : {}), account: async () => (o.mainAccount ? await o.mainAccount() : null) })));
  return door;
}
