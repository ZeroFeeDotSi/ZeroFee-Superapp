// The check of a person's own Claude key, from this device to Anthropic only (split out of ai-key.ts so the public web
// build, which has no key path, can leave Anthropic's address and the key's header out of its bundle: ai-key.ts loads
// this file only behind its inline VITE_ZEROFEE_PUBLIC check, and own-claude.ts is the other user).
import { ANTHROPIC_BASE_URL } from "../claude.ts";
import type { KeyCheck } from "./ai-key.ts";

/** One cheap check, from this device to Anthropic only: the key in a header, never in the address. */
export async function checkClaudeKey(key: string, fetchFn: typeof fetch = fetch): Promise<KeyCheck> {
  try {
    const f = fetchFn; // called unbound: a browser's fetch refuses to run as another object's method
    const r = await f(`${ANTHROPIC_BASE_URL}/v1/models?limit=1`, {
      method: "GET",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 200) return "ok";
    if (r.status === 401 || r.status === 403) return "refused";
    return "busy";
  } catch {
    // Anthropic's 401 carries no CORS header, so a browser (and the iPhone's web view) can't read it: a wrong key looks
    // like no network (real-Claude walk, 3 Nov). Anthropic answering at all, with no key, tells the two apart.
    return (await anthropicReachable(fetchFn)) ? "refused" : "unreachable";
  }
}

/** Does Anthropic answer from here at all? An opaque request with no key (nothing sent but the address): it resolves
 *  when the network reaches Anthropic, whatever it answers, and throws when it doesn't. */
export async function anthropicReachable(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const f = fetchFn;
    await f(`${ANTHROPIC_BASE_URL}/v1/models`, { method: "GET", mode: "no-cors", credentials: "omit", signal: AbortSignal.timeout(8_000) });
    return true;
  } catch {
    return false;
  }
}
