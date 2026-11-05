// MPP's NEAR Intents method, by hand from mpp.dev (its SDK fails the 90-day/10k-a-week gate). A service answers 402 with
// one `WWW-Authenticate: Payment …` per way it takes payment; AgentZero takes only method "nearintents" with intent
// "charge" (a one-time payment): its request (base64url JSON) names the exact amount, the coin, and a single-use deposit
// address for this challenge. The core pays that address; the call is tried again with `Authorization: Payment <base64url
// credential>` (the challenge echoed, the payer, the payment's hash); the answer's Payment-Receipt goes on the receipt.
// Sessions and subscriptions: not until there's a NEAR path for them. Off until the cross-chain switch is on.
import { HIDES_ITS_WORDS, obfuscated } from "../../guard/guard.ts";
import { ASK_ON_PHONE, PER_CALL_USD, RAILS_OFF, b64ToJson, jsonToB64, listedService, railsOn } from "./common.ts";

export interface MppChallenge {
  id: string;
  realm: string;
  method: string;
  intent: string;
  request: string;
  expires?: string;
  description?: string;
  digest?: string;
  opaque?: string;
}

/** Every `Payment` challenge in a WWW-Authenticate header (auth-params, quoted or not). */
export function parseMppChallenges(header: string | null): MppChallenge[] {
  if (!header) return [];
  const out: MppChallenge[] = [];
  const parts = header.split(/(?:^|,)\s*(?=Payment\s)/i).filter((p) => /^Payment\s/i.test(p.trim()));
  for (const part of parts) {
    const params: Record<string, string> = {};
    const re = /([a-zA-Z][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
    const text = part.trim().slice(7);
    for (let m = re.exec(text); m; m = re.exec(text)) params[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? "").replace(/\\(.)/g, "$1");
    const { id, realm, method, intent, request } = params;
    if (!id || !realm || !method || !intent || !request) continue;
    out.push({ id, realm, method, intent, request, ...(params.expires ? { expires: params.expires } : {}), ...(params.description ? { description: params.description } : {}), ...(params.digest ? { digest: params.digest } : {}), ...(params.opaque ? { opaque: params.opaque } : {}) });
  }
  return out;
}

export type MppChoice =
  | { ok: true; challenge: MppChallenge; amount: string; coin: string; depositAddress: string; usd: number }
  | { ok: false; line: string };

/**
 * What to pay, from the challenges, or why not. Only "nearintents" and "charge", not expired, a deposit address, at most
 * min(the cap left, $5) by the core's own price of the coin (`usdOf`; none: refused), a service the person listed.
 */
export function chooseMpp(header: string | null, o: { url: string; listed: readonly string[]; capUsd: number; nowMs: number; usdOf: (coin: string, amount: string) => number | null; on?: boolean }): MppChoice {
  if (!railsOn(o.on)) return { ok: false, line: RAILS_OFF };
  if (!listedService(o.url, o.listed)) return { ok: false, line: ASK_ON_PHONE };
  const all = parseMppChallenges(header);
  if (!all.length) return { ok: false, line: "The service's price couldn't be read. Nothing was sent." };
  // A cap that isn't a number is no cap: nothing is paid (review: NaN let a $900 charge through).
  const most = Number.isFinite(o.capUsd) ? Math.min(Math.max(0, o.capUsd), PER_CALL_USD) : 0;
  let why = "AgentZero pays services only one time each, through NEAR. Nothing was sent.";
  for (const c of all) {
    if (c.method !== "nearintents" || c.intent !== "charge") continue;
    // The guard (item 11): a service whose words hide something is never paid.
    if (obfuscated(c.description) || obfuscated(c.realm)) return { ok: false, line: HIDES_ITS_WORDS };
    if (c.expires && !(Date.parse(c.expires) > o.nowMs)) {
      why = "The service's price ran out. Nothing was sent.";
      continue;
    }
    let req: Record<string, unknown>;
    try {
      req = b64ToJson(c.request) as Record<string, unknown>;
    } catch {
      continue;
    }
    const details = (req.methodDetails && typeof req.methodDetails === "object" ? req.methodDetails : {}) as Record<string, unknown>;
    const amount = req.amount, coin = req.currency;
    const depositAddress = details.depositAddress ?? req.depositAddress;
    if (typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || typeof coin !== "string" || typeof depositAddress !== "string" || !depositAddress) continue;
    const usd = o.usdOf(coin, amount);
    if (usd === null || !(usd > 0) || !Number.isFinite(usd)) {
      why = "The service's price couldn't be read. Nothing was sent.";
      continue;
    }
    if (usd > most) {
      why = `It costs more than $${most.toFixed(2)} a call. ${ASK_ON_PHONE}`;
      continue;
    }
    return { ok: true, challenge: c, amount, coin, depositAddress, usd };
  }
  return { ok: false, line: why };
}

/** The Authorization header for the retry: the challenge as sent, the payer (the account), the payment's hash. */
export function mppAuthorization(c: MppChallenge, payer: string, txHash: string): string {
  const challenge = { id: c.id, realm: c.realm, method: c.method, intent: c.intent, request: c.request, ...(c.expires ? { expires: c.expires } : {}), ...(c.digest ? { digest: c.digest } : {}), ...(c.opaque ? { opaque: c.opaque } : {}) };
  return `Payment ${jsonToB64({ challenge, source: payer, payload: { hash: txHash } }, true)}`;
}
