// The private pocket's payments (D27): a NEP-413 signature over a NEAR Confidential Intents transfer that 1Click
// prepared (generate-intent).
//
// A NEP-413 signature can authorise moving the pocket's coins, so the core signs only the one exact shape 1Click was
// recorded preparing (25 Oct, a real quote, nothing submitted): a single transfer from the pocket to the quote's own
// deposit address, of exactly the quote's amount of exactly its coin (as the confidential id "imt:<minter>:<coin>",
// that one minter), expiring exactly with the quote (within 4 days), for "intents.far". A signature for intents.far can't be
// replayed on the public intents.near. The quote itself is read back by its deposit address through the pinned quote
// server (1Click's public status doesn't know confidential addresses), never taken from the app: a confidential
// deposit, refunding to the pocket, still waiting, in date. Anything else is refused before any sheet.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, fromBase64, utf8 } from "./sol/bytes.ts";
import type { QuoteFacts } from "./intents.ts";

/** NEP-413's prefix: 2^31 + 413, little-endian, so a signed message can never also be a transaction. */
const NEP413_TAG = 2147484061;
/** A confidential quote lives about 3 days; the intent may not outlive it, nor 4 days. */
const MAX_DEADLINE_MS = 4 * 86_400_000;
/** The verifying name 1Click's confidential intents are signed for. */
const CONFIDENTIAL_RECIPIENT = "intents.far";
/** Confidential token ids are wrapped to bind them to their minter: "imt:<minter>:<coin>" (recorded 25 Oct). */
const CONFIDENTIAL_MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";

export interface Nep413Payload {
  message: string;
  /** 32 bytes, base64. */
  nonce: string;
  recipient: string;
  callbackUrl?: string;
}

/** The transfer the pocket would sign, once checked: who gets it, which coin, how much. */
export interface PocketTransfer {
  depositAddress: string;
  tokenId: string;
  amount: string;
}

const isUnits = (v: unknown): v is string => typeof v === "string" && /^\d{1,39}$/.test(v);

/** A private send goes up to $10,000 (D132; D27's $100 went with D128), by 1Click's own signed price: the relay's cap,
 *  kept in the core too. */
export const POCKET_PAYMENT_MAX_USD = 10_000;
/** The same, as people read it: "$10,000". */
export const POCKET_MAX_TEXT = `$${POCKET_PAYMENT_MAX_USD.toLocaleString("en-US")}`;

/** Is this exactly the one transfer the pocket may sign for this quote? Null if yes; otherwise why not. */
export function pocketIntentRefusal(payload: Nep413Payload, quote: QuoteFacts | null, depositAddress: string, pocket: string, nowMs: number): string | null {
  if (!quote) return "NEAR Intents doesn't know this payment address.";
  if (quote.status !== "PENDING_DEPOSIT" || !(Date.parse(quote.deadline) > nowMs)) return "This price has run out.";
  if (quote.refundTo !== pocket || quote.refundType !== "CONFIDENTIAL_INTENTS") return "A refund must come back to your private balance.";
  if (payload.recipient !== CONFIDENTIAL_RECIPIENT || payload.callbackUrl !== undefined) return "It isn't a private payment.";
  let nonce: Uint8Array;
  try {
    nonce = fromBase64(payload.nonce);
  } catch {
    return "Its one-time number can't be read.";
  }
  if (nonce.length !== 32) return "Its one-time number can't be read.";
  let m: any;
  try {
    m = JSON.parse(payload.message);
  } catch {
    return "Its message can't be read.";
  }
  const keys = m && typeof m === "object" && !Array.isArray(m) ? Object.keys(m).sort().join() : "";
  if (keys !== "deadline,intents,signer_id") return "Its message has parts a payment doesn't need.";
  if (m.signer_id !== pocket) return "It isn't from your private balance.";
  const deadline = Date.parse(m.deadline);
  // 1Click gives the intent its quote's own deadline (about 3 days out): exactly that, in the future, within 4 days.
  if (!(deadline > nowMs && deadline === Date.parse(quote.deadline) && deadline <= nowMs + MAX_DEADLINE_MS)) return "It must expire with its price, within 4 days.";
  if (!Array.isArray(m.intents) || m.intents.length !== 1) return "It must be a single payment.";
  const t = m.intents[0];
  if (!t || typeof t !== "object" || Object.keys(t).sort().join() !== "intent,receiver_id,tokens" || t.intent !== "transfer") return "It must be a plain transfer, with no note or instructions.";
  if (t.receiver_id !== depositAddress) return "It doesn't pay the address that goes with this price.";
  const tokens = t.tokens && typeof t.tokens === "object" ? Object.entries(t.tokens) : [];
  if (tokens.length !== 1) return "It must move one coin.";
  const [tokenId, amount] = tokens[0];
  if (tokenId !== `imt:${CONFIDENTIAL_MINTER}:${quote.originAsset}` || !isUnits(amount) || amount !== quote.amountIn) return "Its coin or amount doesn't match the price.";
  return null;
}

/** What the person asked to pay (audit H4, 3 Nov): their own payee, from the page, never the relay's answer. `minAmountOut`:
 *  the amount they asked to arrive, when they asked for one (a Send of an exact amount in leaves it out; its sheet shows
 *  1Click's signed minimum before Face ID). */
export interface PayeeAsk {
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  destinationAsset: string;
  minAmountOut?: string;
}

/**
 * The payee pin (audit H4): a private payment is signed only for a quote that pays exactly whom the person asked, the way
 * they asked, in the coin they asked, and at least what they asked to arrive. Whoever runs the relay holds the partner key
 * and can get a real, 1Click-signed quote that pays someone else with the refund to the pocket: every other check passes
 * that, this one doesn't. No payee given: refused too, so every private payment is pinned. Null if it pays what was asked.
 */
export function payeeRefusal(quote: QuoteFacts, payee: unknown): string | null {
  const p = payee as Partial<PayeeAsk> | null | undefined;
  if (!p || typeof p.recipient !== "string" || !p.recipient || !["DESTINATION_CHAIN", "INTENTS", "CONFIDENTIAL_INTENTS"].includes(p.recipientType as string) || typeof p.destinationAsset !== "string" || (p.minAmountOut !== undefined && !isUnits(p.minAmountOut))) {
    return "ZeroFee wasn't told who this pays, so it signed nothing.";
  }
  // an EVM address is the same address in any letter case; every other kind is compared exactly
  const evm = /^0x[0-9a-fA-F]{40}$/.test(p.recipient);
  const sameWho = evm ? quote.recipient.toLowerCase() === p.recipient.toLowerCase() : quote.recipient === p.recipient;
  if (!sameWho || quote.recipientType !== p.recipientType) return "The swap service's price pays someone you didn't pick, so ZeroFee signed nothing.";
  if (quote.destinationAsset !== p.destinationAsset) return "The swap service's price pays another coin than you picked, so ZeroFee signed nothing.";
  if (p.minAmountOut !== undefined && (!isUnits(quote.minAmountOut) || BigInt(quote.minAmountOut) < BigInt(p.minAmountOut))) return "The swap service's price pays less than you asked, so ZeroFee signed nothing.";
  return null;
}

/** The transfer inside an accepted payload (call only after `pocketIntentRefusal` returned null). */
export function pocketTransfer(payload: Nep413Payload): PocketTransfer {
  const t = JSON.parse(payload.message).intents[0];
  const [[tokenId, amount]] = Object.entries(t.tokens as Record<string, string>);
  // The coin as the rest of ZeroFee names it (the confidential id carries it after its "imt:<id>:" prefix).
  return { depositAddress: t.receiver_id, tokenId: tokenId.slice(`imt:${CONFIDENTIAL_MINTER}:`.length), amount };
}

function borshString(s: string): Uint8Array {
  const b = utf8(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}

/** NEP-413's hash: sha256 of the tag and the borsh payload { message, nonce: [u8; 32], recipient, callbackUrl: Option }. */
/** The bytes NEP-413 hashes: its tag, the message, the 32-byte nonce, the recipient and the callback (none or one). */
export function nep413Bytes(payload: Nep413Payload): Uint8Array {
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  const callback = payload.callbackUrl === undefined ? new Uint8Array([0]) : new Uint8Array([1, ...borshString(payload.callbackUrl)]);
  return new Uint8Array([...tag, ...borshString(payload.message), ...fromBase64(payload.nonce), ...borshString(payload.recipient), ...callback]);
}

export function nep413Hash(payload: Nep413Payload): Uint8Array {
  return sha256(nep413Bytes(payload));
}

/** The signed data 1Click's submit-intent takes. */
export function signNep413(payload: Nep413Payload, secret: Uint8Array) {
  return {
    standard: "nep413" as const,
    payload,
    public_key: `ed25519:${base58(ed25519.getPublicKey(secret))}`,
    signature: `ed25519:${base58(ed25519.sign(nep413Hash(payload), secret))}`,
  };
}
