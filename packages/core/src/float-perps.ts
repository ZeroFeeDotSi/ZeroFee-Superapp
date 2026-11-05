// D119 landing 3: Trading ↔ the person's own Perps account on Hyperliquid, through 1Click, with FloatMoves' own steps
// (fromFloat for a move out, the same checks as a move in for a move back). Loaded on first use (float-moves.ts toPerps /
// fromPerps import it), so none of it is in Home's first load.
import { FLOAT_USDC, type FloatMove, type Kept, type PerpsKit } from "./float-moves.ts";
import { leastIn as least } from "./float-floors.ts";
import { parseQuote } from "./intents.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { quoteDeadline } from "./quote-deadline.ts";

/** Hyperliquid's USDC on HyperCore as 1Click lists it (GET 1click.chaindefuser.com/v0/tokens, read 3 Nov 2026: blockchain
 *  "hypercore", symbol USDC, 8 decimals, the hip1 token 0x6d1e7cde53ba9467b783cb7c530ce054). */
export const HL_USDC_ASSET = "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054";
export const HL_USDC_DECIMALS = 8;
const PERPS_ADDRESS = /^0x[0-9a-f]{40}$/;
const QUOTE_MINUTES = 10;
const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));
const wordsOf = (e: unknown): string => {
  const p = (e as { problem?: { whatHappened?: unknown } })?.problem?.whatHappened;
  return (typeof p === "string" ? p : String((e as Error)?.message ?? e)).replace(/\s+/g, " ").slice(0, 200);
};

/**
 * Put money in Perps: Trading's USDC → USDC on HyperCore at the person's own Perps address, by a 1Click quote checked
 * like any move out (fromFloat: the coin, this recipient, at least leastIn of it, a fair price, a refund back to
 * Trading). `recipient` is the perps service's own address (made from the words in the core), never an app's.
 */
export async function toPerps(f: PerpsKit, amount: unknown, key: unknown, recipient: unknown): Promise<FloatMove | { declined: true }> {
  const fields = JSON.stringify(["perps-out", amount, recipient]);
  const had = await f.again(key, fields);
  if (had) return had;
  if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw invalid("amount is USDC in smallest units, as text");
  if (typeof recipient !== "string" || !PERPS_ADDRESS.test(recipient)) throw invalid("the Perps account is the core's own address");
  const usd = Number(amount) / 1e6;
  return f.fromFloat({
    kind: "out", key: key as string, fields, usd, perps: true,
    ask: { swapType: "EXACT_INPUT", destinationAsset: HL_USDC_ASSET, amount, recipient, recipientType: "DESTINATION_CHAIN" },
    atLeast: BigInt(Math.floor(least(usd) * 10 ** HL_USDC_DECIMALS)),
    words: `Move about $${usd.toFixed(2)} to Perps on Hyperliquid`,
  });
}

/**
 * Take out of Perps: USDC on HyperCore → Trading, by a 1Click quote checked like a move in (notAskedIn: exactly this
 * amount, USDC into Trading, a refund into Trading, a fair price). `pay` is the perps service's own: the main key sends
 * exactly `amountIn` to the quote's deposit address on Hyperliquid (spotSend, on the person's sheet). Hyperliquid's own
 * "no" ends the move; no answer keeps it open until 1Click says.
 */
export async function fromPerps(f: PerpsKit, amount: unknown, key: unknown, pay: (depositAddress: string, amountIn: string) => Promise<void>): Promise<FloatMove | { declined: true }> {
  const fields = JSON.stringify(["perps-in", amount]);
  const had = await f.again(key, fields);
  if (had) return had;
  if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) throw invalid("amount is HyperCore USDC in smallest units, as text");
  const relay = f.d.relay;
  if (!relay) throw refused("Your NEAR wallet can't move money on this phone yet.");
  const float = await f.d.float();
  const units = BigInt(amount);
  const usd = Number(amount) / 10 ** HL_USDC_DECIMALS;
  const place = await f.d.guard.take(usd);
  if (place.ask) await f.refusePastGuard(place.why, place.release);
  const at = new Date(f.now()).toISOString();
  const k: Kept = {
    key: key as string, fields, place: place.id,
    move: { id: `fm-${key}`, kind: "in", perps: true, status: "pending", where: "chain", sent: { tokenId: HL_USDC_ASSET, amount }, expected: { tokenId: FLOAT_USDC, amount: "0" }, usd: Math.round(usd * 100) / 100, startedAtIso: at, updatedAtIso: at },
  };
  let depositAddress = "";
  let amountIn = "";
  try {
    const raw = await relay.quote({
      dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: HL_USDC_ASSET, depositType: "ORIGIN_CHAIN",
      destinationAsset: FLOAT_USDC, amount, refundTo: float.address, refundType: "CONFIDENTIAL_INTENTS",
      recipient: float.address, recipientType: "CONFIDENTIAL_INTENTS", deadline: quoteDeadline(f.now(), QUOTE_MINUTES * 60_000), confidentiality: "basic",
    });
    depositAddress = raw?.quote?.depositAddress;
    if (typeof depositAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) throw refused("NEAR Intents gave no address to pay on Hyperliquid. Nothing moved.");
    k.depositAddress = depositAddress;
    if (typeof raw?.zerofeeStatusTag === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(raw.zerofeeStatusTag)) k.tag = raw.zerofeeStatusTag;
    await f.keep(k);
    const q = parseQuote(await relay.status(depositAddress, k.tag), depositAddress, f.d.quoteKey);
    const why = f.notAskedIn(q, { coin: HL_USDC_ASSET, float: float.address, units, usd }) ?? (q?.depositMemo ? "It asks for a memo Hyperliquid's transfer can't carry." : null);
    if (why) throw refused(why);
    amountIn = q!.amountIn;
    k.move.expected = { tokenId: FLOAT_USDC, amount: q!.minAmountOut };
    await f.keep(k);
  } catch (e) {
    await place.release();
    if (k.depositAddress) (k.move.status = "failed"), await f.keep(k);
    throw e instanceof ProblemError ? e : refused(`NEAR Intents said no. Nothing moved. ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
  f.paying.add(k.move.id);
  try {
    await pay(depositAddress, amountIn);
    k.submitted = true;
    k.move.where = "in-flight";
  } catch (e) {
    k.payError = wordsOf(e);
    // Only a spotSend Hyperliquid didn't answer may have gone (the perps service marks it maybeSent): open until 1Click
    // says. Anything else (Hyperliquid's no, a refusal before the send) left nothing out of the Perps account.
    if ((e as { maybeSent?: boolean })?.maybeSent) k.move.reason = `Not confirmed by Hyperliquid yet: ${k.payError}`;
    else Object.assign(k.move, { status: "failed", where: "chain", reason: `Not sent from Perps: ${k.payError}` });
  } finally {
    f.paying.delete(k.move.id);
  }
  if (k.move.status === "failed") {
    await place.release();
    delete k.place;
  }
  const kept = await f.amend(k.move.id, (now) => (!now || now.move.status === "pending" ? k : { ...now, ...(k.submitted ? { submitted: true } : {}) }));
  return { ...(kept ?? k).move };}
