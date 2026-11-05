// Tests only (no core code imports this): a stand-in for 1Click's quote key, so a test's quote is signed the way 1Click
// signs real ones (quote-signature.ts). The core takes this key only through a `quoteKey` option, which only tests set.
import { ed25519 } from "@noble/curves/ed25519.js";
import { quoteMessage } from "./quote-signature.ts";
import { base58, utf8 } from "./sol/bytes.ts";

const SECRET = new Uint8Array(32).fill(7);
export const TEST_QUOTE_KEY = `ed25519:${base58(ed25519.getPublicKey(SECRET))}`;

/** A quote response ({ quoteRequest, quote }) with a timestamp and the test key's signature, as 1Click returns one. */
export function signedQuote<T extends { quoteRequest: object; quote: object }>(r: T, timestamp = new Date().toISOString()): T & { timestamp: string; signature: string } {
  const withTime = { ...r, timestamp };
  return { ...withTime, signature: `ed25519:${base58(ed25519.sign(utf8(quoteMessage(withTime)), SECRET))}` };
}
