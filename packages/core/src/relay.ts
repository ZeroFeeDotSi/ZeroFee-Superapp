// The quote relay (apps/quotes): ZeroFee's own server for the private pocket's confidential quotes (D27). One base
// address, set at build time (VITE_ZEROFEE_RELAY), reaches Wallet's ledger, the core's private payments and, on the
// phone, the isolated core's host allowlist (build-web.sh writes it beside the core's bundle). Unset: Private isn't set
// up, and says so.

import { httpsOrigin } from "./https-url.ts";

/**
 * The relay's base: an https origin with no path, query, fragment or user, or undefined when unset or not one. Read
 * without URL (https-url.ts): on the phone this runs in the isolated core, where JavaScriptCore has no URL, and the relay
 * read as unset (phone test, 2 Nov: every Top up "Trading moves aren't set up on this phone yet.").
 */
export function relayBase(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const u = httpsOrigin(raw.trim());
  return u && (u.rest === "" || u.rest === "/") ? u.origin : undefined;
}
