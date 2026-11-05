// 1Click's own signature on a quote (the outside study's item 2). Every quote 1Click makes, public or confidential, is
// signed with 1Click's quote key over its terms and its deposit address, and a status read carries the same signed
// quote. The core believes a quote's terms only when that signature checks, so whoever passes a quote along (our relay
// for Private and Trading, or anything between the phone and 1Click) can't change who gets paid, the refund or the amounts.
//
// The scheme and the key are 1Click's own, from its SDK (@defuse-protocol/one-click-sdk-typescript, src/quote-signature.ts:
// npm 0.1.26 and GitHub main ae8b24e064 agree), checked against a live public quote and a live confidential one
// (28 Oct 2026). The message is base58(sha256(the signed fields as sorted-key JSON)), as text, signed with ed25519. The
// fields are listed here exactly as the SDK builds them: a field 1Click adds later makes the check fail, closed.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, fromBase58, utf8 } from "./sol/bytes.ts";

/** 1Click's quote key (the SDK's ONE_CLICK_MANAGER_PUB_KEY). */
export const ONE_CLICK_QUOTE_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,90}$/;
const orNone = (v: unknown) => (v ? v : undefined);

/** JSON with every object's keys sorted and undefined left out (json-stable-stringify, as 1Click signs). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stable(x))).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The text 1Click signs for a quote response ({ quoteRequest, quote, timestamp }), field for field as its SDK builds it. */
export function quoteMessage(r: { quoteRequest: any; quote: any; timestamp: unknown }): string {
  const req = r.quoteRequest, q = r.quote;
  const request = {
    dry: req.dry, swapType: req.swapType, slippageTolerance: req.slippageTolerance, originAsset: req.originAsset, depositType: req.depositType,
    destinationAsset: req.destinationAsset, amount: req.amount, refundTo: req.refundTo, refundType: req.refundType, recipient: req.recipient,
    recipientType: req.recipientType, deadline: req.deadline, quoteWaitingTimeMs: orNone(req.quoteWaitingTimeMs), referral: orNone(req.referral),
    virtualChainRecipient: orNone(req.virtualChainRecipient), virtualChainRefundRecipient: orNone(req.virtualChainRefundRecipient), customRecipientMsg: orNone(req.customRecipientMsg),
  };
  const amounts = {
    amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, amountInUsd: q.amountInUsd, minAmountIn: q.minAmountIn,
    amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, amountOutUsd: q.amountOutUsd, minAmountOut: q.minAmountOut,
  };
  // A real (not dry) quote also signs where to pay and until when; its deadline stands in for the request's.
  const quote = req.dry ? amounts : {
    ...amounts, depositAddress: orNone(q.depositAddress), depositMemo: orNone(q.depositMemo), deadline: orNone(q.deadline), timeWhenInactive: orNone(q.timeWhenInactive),
    timeEstimate: orNone(q.timeEstimate), refundFee: orNone(q.refundFee), withdrawFee: orNone(q.withdrawFee),
  };
  return base58(sha256(utf8(stable({ ...request, ...quote, timestamp: r.timestamp }))));
}

/** Did 1Click sign this quote response (a quote's answer, or a status's `quoteResponse`)? Anything unreadable is no. */
export function signedBy1Click(r: unknown, key: string = ONE_CLICK_QUOTE_KEY): boolean {
  const x = r as { quoteRequest?: unknown; quote?: unknown; timestamp?: unknown; signature?: unknown } | null;
  if (!x || typeof x !== "object" || !x.quoteRequest || typeof x.quoteRequest !== "object" || !x.quote || typeof x.quote !== "object") return false;
  if (typeof x.timestamp !== "string" || typeof x.signature !== "string" || !KEY.test(x.signature) || !KEY.test(key)) return false;
  try {
    const signature = fromBase58(x.signature.slice(8));
    const publicKey = fromBase58(key.slice(8));
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return ed25519.verify(signature, utf8(quoteMessage(x as { quoteRequest: any; quote: any; timestamp: string })), publicKey, { zip215: false });
  } catch {
    return false;
  }
}
