// AgentZero in the Sim (D157, product decision, 3 Nov). The Sim
// runs the real chatTurn, prompt, plans and tools; its tools act on the Sim's own sample money in the tab, and its
// Claude is the relay's Sim route (apps/quotes/agentzero-sim.mjs: Sonnet 5.5, free to the visitor, capped).
// What only the iPhone app does for real ends in one honest line, said by our own code here for the plain asks and
// by Claude (the relay's Sim line) for the rest. Never "this doesn't work".

import { SIGN_UP, SITE } from "./site-ask.ts";

/** The one honest line (the relay's SIM_REAL_LINE; a test holds them equal). */
export const SIM_REAL_LINE = "This is the Sim. On the iPhone app it does this for real.";
/** The Sim's AgentZero is off on the relay, or has used the relay's day ($2 by default, ledger row 3). The copywriter's
 *  line, 5 Nov (the relay's SIM_RESTED_WORDS; a test holds them equal). */
export const SIM_RESTED_LINE = "AgentZero is off in the Sim right now. Use it in the ZeroFee iPhone app.";
/** The relay's answers that mean the Sim's AgentZero rests (agentzero-sim.mjs SIM_RESTED, SIM_OFF). */
export const SIM_REST_CODES: readonly string[] = ["agentzero.sim.rested", "agentzero.sim.off"];
/** The relay's Sim route. */
export const SIM_PATH = "/v0/agentzero/sim";
/** The Sim's history before the relay cuts it again (agentzero-sim.mjs: 12 turns, 16,000 characters): a small body. */
export const SIM_HISTORY = { max: 24_000, to: 16_000 } as const;

/**
 * The plain asks only the iPhone app does for real, read by our own code before any model call: a sign-up or sign-in
 * on a site, opening or browsing a site, AgentZero's email, copying a wallet (pump.fun), and AgentZero's jobs (keep
 * money ready, pay a list). A question about them ("what can you do?") is not one: Claude answers it.
 */
export function simReal(words: string): boolean {
  const w = words.trim();
  if (!w || (/\?\s*$/.test(w) && /^(?:what|how|can|could|do|does|is|are|why|when|which|who)\b/i.test(w))) return false;
  if (SIGN_UP.test(w) && (SITE.test(w) || /\b(?:to|on|for|at)\s+\S+/i.test(w))) return true;
  if (/\b(?:sign|log)\s*(?:me\s+)?in(?:to)?\b/i.test(w) && SITE.test(w)) return true;
  if (/\b(?:browse|open|go\s+to|visit)\b/i.test(w) && SITE.test(w)) return true;
  if (/\b(?:your|agentzero'?s|its own)\s+(?:own\s+)?(?:e-?mail|inbox|mailbox)\b/i.test(w)) return true;
  if (/\b(?:send|write|check|read)\s+(?:an?\s+|my\s+)?e-?mails?\b/i.test(w)) return true;
  if (/\bcopy\b[^.]*\b(?:wallet|trader|trades|buys)\b/i.test(w) || /\bpump\.?fun\b/i.test(w)) return true;
  if (/\bkeep\s+\$?\s?\d[\d.,]*\s*(?:dollars?|usd|usdc)?\s+(?:ready|in)\b/i.test(w)) return true;
  if (/\bpay\s+(?:a|my|this|the)\s+list\b/i.test(w)) return true;
  return false;
}

/** D158: a visitor's free replies for today are used (the relay's agentzero.sim.visitor: $0.90 a visitor a UTC day). The
 *  copywriter's line, 5 Nov (the relay's SIM_VISITOR_WORDS): the Sim has
 *  no app or extension link to offer, so no button. */
export const SIM_VISITOR_CODE = "agentzero.sim.visitor";
export const SIM_VISITOR_LINE = "You used up today's free AgentZero replies here. Come back tomorrow, or use the ZeroFee iPhone app.";

/**
 * The Sim's approval, in the browser's own words (shell-api approval-words.ts WEB_WORDS: there is no Face ID in a browser
 * tab; the Sim's sheet has an Approve button). Every line of ZeroFee's own that names Face ID, said in the Sim: tool
 * results Claude reads and lines the screen shows. Claude is told the same by the relay's Sim line.
 */
const SIM_APPROVAL: readonly [RegExp, string][] = [
  [/Only (their|your) Face ID moves it/g, "Only $1 approval moves it"],
  [/ready for your Face ID/g, "ready for you to approve"],
  [/tap Open, then Face ID/g, "tap Open, then Approve"],
  [/you approve each with Face ID/g, "you approve each one"],
  [/(approves?|approved) (it )?(?:with|on) (?:their |your |the person's )?Face ID/g, "$1 it"],
  [/(?:with|on) (?:their |your |the person's )?Face ID/g, "with an approval"],
  [/(the person's|their|your) Face ID/g, "$1 approval"],
  [/\bFace ID\b/g, "an approval"],
];
export const simWords = (text: string): string => SIM_APPROVAL.reduce((t, [re, to]) => t.replace(re, to), text);
