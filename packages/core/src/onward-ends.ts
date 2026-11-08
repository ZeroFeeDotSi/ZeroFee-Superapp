// The independent grade (3 Nov, w-m04d): the Approve sheet of a Move from the Safe to the SOL and ETH (RH) wallets said
// "Move $310.00 (310.00 USDC) to your NEAR wallet". That is what the signature does (leg 1 goes into the NEAR wallet),
// but the person asked for SOL and ETH (RH). The sheet now names where the money ends, and the route as a quiet line.
//
// Trust: this applies only to a step the core itself read as a move into the person's OWN NEAR wallet (intents.ts
// TRADING_BALANCE: its title ends " to your NEAR wallet"), and only when the asking app's onward words (TxRequest.onward)
// are exactly the engine's own form ("it goes on to your SOL and ETH (RH) wallets." and, when the Safe sent a little
// more, the rest line), naming only the person's own chain wallets. An app that lies can only move the name between the
// person's own wallets; the money still goes only where the bytes say, and the amount is the core's own. Anything else
// keeps the core's own title and the app's words as its "says:" line.
import { REST_STAYS_LINE, REST_STAYS_OLD } from "./inflow-grid.ts";
import { SITE_WALLETS } from "./site-wallets.ts";

/** The person's own chain wallets, as Home names them (D124). */
export const OWN_ENDS = ["SOL", "Robinhood", "BNB"] as const;
const TO_NEAR_WALLET = " to your NEAR wallet";
export const ROUTE_LINE = "It goes through your NEAR wallet first.";
/** The listed sites' own wallets (site-wallets.ts), each filled on Solana (finding 45: a $3 pump.fun Add's sheet said
 *  only "to your NEAR wallet"). AgentZero's pocket is not a site and has its own sheet. */
const SITE_ENDS: ReadonlySet<string> = new Set(SITE_WALLETS.filter((w) => !w.agent).map((w) => w.name));

/** The wallets an onward line names, in its order, and whether the rest stays there; null for anything else. `onward` may
 *  carry the core's "<App> says: " lead (dev-signer onwardOf). */
export function onwardEnds(onward: string | undefined): { ends: string[]; rest: boolean; site?: true } | null {
  if (typeof onward !== "string") return null;
  const site = /^(?:[A-Z][a-z]{1,15} says: )?it goes on to your (.{1,30}) wallet on Solana\.$/.exec(onward.trim());
  if (site) return SITE_ENDS.has(site[1]!) ? { ends: [site[1]!], rest: false, site: true } : null;
  const m = /^(?:[A-Z][a-z]{1,15} says: )?it goes on to your (.+?) (wallet|wallets)\.( The rest stays (?:hidden in your NEAR wallet|in Private)\.)?$/.exec(onward.trim());
  if (!m) return null;
  const names = m[1]!.split(/, | and /);
  if (!names.length || names.length > OWN_ENDS.length || new Set(names).size !== names.length) return null;
  if (!names.every((n) => (OWN_ENDS as readonly string[]).includes(n))) return null;
  if ((names.length === 1) !== (m[2] === "wallet")) return null;
  if (m[3] && ` ${REST_STAYS_LINE}` !== m[3] && ` ${REST_STAYS_OLD}` !== m[3]) return null;
  return { ends: names, rest: !!m[3] };
}

/**
 * Home's Swap from the Safe to one chain wallet's coin (spending.ts then.swap, the engine's own form): "it is a swap of
 * $25.00 of USDC for SOL in your SOL wallet." and, when the inflow grid sent more, " $1.00 stays hidden in your NEAR
 * wallet." Null for anything else. The dollars are the app's; the sheet uses them only when they add up to the core's.
 */
export function swapAsk(onward: string | undefined): { usd: number; pay: string; get: string; rest: number } | null {
  if (typeof onward !== "string") return null;
  const m = /^(?:[A-Z][a-z]{1,15} says: )?it is a swap of \$(\d{1,6}\.\d{2}) of (USDC|USDT|NEAR) for (SOL|Robinhood|ETH \(RH\)|BNB) in your (SOL|Robinhood|ETH \(RH\)|BNB) wallet\.(?: \$(\d{1,6}\.\d{2}) stays hidden in your NEAR wallet\.)?$/.exec(onward.trim());
  if (!m || m[3] !== m[4]) return null;
  return { usd: Number(m[1]), pay: m[2]!, get: m[3]!, rest: m[5] ? Number(m[5]) : 0 };
}
/** The Swap's sheet words (copywriter): its title, and the line for what the grid adds on top. */
export const swapTitle = (usd: number, pay: string, get: string) => `Swap $${usd.toFixed(2)} of ${pay} for ${get}`;
export const restLine = (rest: number) => `$${rest.toFixed(2)} more leaves your Safe, rounded up for privacy. It stays in your NEAR wallet. It's not a fee.`;

const list = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]!);

/**
 * A title the core made for a move into the person's own NEAR wallet ("Move $310.00 (310.00 USDC) to your NEAR wallet"),
 * with the move's onward words: the title names the end wallets, and the lines say the route and the rest. Null when the
 * title isn't that move or the words aren't the engine's own form.
 */
export function endsTitle(title: string, onward: string | undefined): { title: string; lines: string[] } | null {
  // Home's Swap: the person's own amount and the grid's rest add up to what the core says leaves, to the cent; else the
  // core's own title stands
  const s = swapAsk(onward);
  const left = /^Move \$([\d,]+\.\d{2}) /.exec(title);
  if (s && left && title.endsWith(TO_NEAR_WALLET) && !title.includes(", then ") && Math.abs(s.usd + s.rest - Number(left[1]!.replace(/,/g, ""))) < 0.005) {
    return { title: swapTitle(s.usd, s.pay, s.get), lines: [ROUTE_LINE, ...(s.rest >= 0.01 ? [restLine(s.rest)] : [])] };
  }
  const e = onwardEnds(onward);
  if (!e || !/^Move /.test(title) || !title.endsWith(TO_NEAR_WALLET) || title.includes(", then ")) return null;
  const to = e.site ? ` to your ${e.ends[0]} wallet on Solana` : ` to your ${list(e.ends)} wallet${e.ends.length > 1 ? "s" : ""}`;
  // a site's Add says the word of the button the person pressed, Add (browser-sites crawl F14, QA, the copywriter)
  const head = e.site ? title.replace(/^Move /, "Add ") : title;
  return { title: head.slice(0, -TO_NEAR_WALLET.length) + to, lines: [ROUTE_LINE, ...(e.rest ? [REST_STAYS_LINE] : [])] };
}

/**
 * The core's own swap into the person's NEAR wallet ("Swap $2.20 (0.5486 NEAR) for USDC", a Described with
 * `intoNearWallet`), with the engine's onward words: titled as the Move the person asked for ("Move $2.20 (0.5486 NEAR)
 * to your SOL wallet"), the swap's own lines kept, and one line for where it goes next (a UI test, 4 Nov: the sheet
 * of a SOL Move said only "lands in your NEAR wallet"). Null when the words aren't the engine's own form.
 */
export function swapEnds(title: string, onward: string | undefined): { title: string; lines: string[] } | null {
  // Home's Swap paid with the Safe's NEAR: the core's own figure (its price), for the coin the person asked for
  const s = swapAsk(onward);
  const t = /^Swap (.+) for USDC$/.exec(title);
  if (s && t && s.rest < 0.01) return { title: `Swap ${t[1]} for ${s.get}`, lines: [ROUTE_LINE] };
  const e = onwardEnds(onward);
  const m = /^Swap (.+) for [^ ]+$/.exec(title);
  if (!e || !m) return null;
  const wallets = `your ${list(e.ends)} wallet${e.ends.length > 1 ? "s" : ""}`;
  return { title: `Move ${m[1]} to ${wallets}`, lines: [`Then it goes on to ${wallets}.`, ...(e.rest ? [REST_STAYS_LINE] : [])] };
}
