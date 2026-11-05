// A plain ask to open, browse, sign up or sign in on a site, read by our own code before any model call. Not the Sim's:
// the web wallet and the Chrome extension (no browse there, tools.ts WEB_ABSENT) say it in one line too (turn.ts), so it
// lives apart from sim.ts, which the extension's build swaps for a stand-in (apps/extension/src/no-sim/build.ts).
export const SIGN_UP = /\b(?:sign(?:ing)?[\s-]?(?:me\s+)?up|register|create\s+(?:an?\s+|my\s+)?account|make\s+(?:an?\s+|my\s+)?account)\b/i;
export const SITE = /\b(?:web\s?sites?|sites?|https?:\/\/|www\.)|\.(?:com|io|fun|xyz|org|net|app)\b/i;

/** W7: a plain ask to open, browse, sign up or sign in on a site (a question about it is not one). */
export function wantsSite(words: string): boolean {
  const w = words.trim();
  if (!w || (/\?\s*$/.test(w) && /^(?:what|how|can|could|do|does|is|are|why|when|which|who)\b/i.test(w))) return false;
  if (SIGN_UP.test(w) && (SITE.test(w) || /\b(?:to|on|for|at)\s+\S+/i.test(w))) return true;
  if (/\b(?:sign|log)\s*(?:me\s+)?in(?:to)?\b/i.test(w) && SITE.test(w)) return true;
  return /\b(?:browse|open|go\s+to|visit)\b/i.test(w) && SITE.test(w);
}
