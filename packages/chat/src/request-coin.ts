// The coin Request money starts on (grade 02h, H2). It is known before the sheet opens, from the build and the page's
// address, the same way the app picks its network (apps/web mode.ts): never from a balance read that answers later.
// On 2 Nov a brand-new test account's sheet showed USDC, the person tapped Post, the read then switched the field to
// NEAR under "Posting…", and the refusal named the coin the screen now showed (C4: 8 taps against PAR 4).
//
// - Test network (the real app without ?mainnet, and the ?demo outside the public build, whose sample account is a
//   testnet one): NEAR, the one coin a test account can be paid.
// - Mainnet (?mainnet, the phone's mainnet build, and every page of the public build): USDC, dollars.
import { simPage } from "@zerofee/shell-api/release.ts";
import { chainName, detect } from "./detect.ts";

/** True when this page runs on NEAR's test network. */
export function onTestNetwork(search: string, publicBuild: boolean): boolean {
  if (publicBuild) return false;
  return !new URLSearchParams(search).has("mainnet");
}

/** The coin Request money starts on here. */
export const startCoin = (search: string, publicBuild: boolean): string => (onTestNetwork(search, publicBuild) ? "NEAR" : "USDC");

/** A test account's refusal names the field to change, from what the sheet showed when Post was tapped. */
export function testAccountFix(shown: { coin: string; network: string }): string {
  if (shown.coin !== "NEAR") return `The coin says ${shown.coin || "nothing"}. Change it to NEAR.`;
  return `The network says ${shown.network}. Change it to NEAR.`;
}

/** A plain decimal as an integer at 24 places (no float rounding at the edge), or null when it isn't one. */
function scaled(v: string): bigint | null {
  const m = /^(\d{1,30})(?:\.(\d{1,24}))?$/.exec(v.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 10n ** 24n + BigInt((m[2] ?? "").padEnd(24, "0") || "0");
}

/** Dead ends row 5 (3 Nov): NEAR's bridge never credits a payment under its least (Trade refuses the same, H07), so a
 *  request under it is never posted. The least in one line, or null when the amount is enough (or there's no least:
 *  NEAR itself, "0"). A dollar coin's least is rounded up to the cent, so asking what the line says always passes. */
export function underBridgeMinimum(asked: string, minAmount: string | undefined, coin: string): string | null {
  const min = minAmount ? scaled(minAmount) : null;
  if (min === null || min === 0n) return null;
  const n = scaled(asked);
  if (n !== null && n >= min) return null;
  if (/^USD[CT]$/.test(coin)) {
    const cent = 10n ** 22n;
    const cents = (min + cent - 1n) / cent;
    return `At least $${cents / 100n}.${String(cents % 100n).padStart(2, "0")} for NEAR's bridge.`;
  }
  return `At least ${minAmount!.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")} ${coin} for NEAR's bridge.`;
}

/** The beta's limit in dollars as the core's refusal names it ("the beta's $1,000 limit"), or null. */
const betaCap = (p: { whatHappened: string; more?: string }): string | null => /beta's \$([\d,]+) limit|holds up to \$([\d,]+)/.exec(`${p.whatHappened} ${p.more ?? ""}`)?.slice(1).find(Boolean) ?? null;

interface Refused { code: string; whatHappened: string; more?: string; next: { kind: string; screen?: string } }

/** Dead ends row 12 (3 Nov): a refusal whose fix is another coin or network stays on the request sheet, with the amount
 *  kept, as one line (Chat has no Receive screen: the Problem's "Choose another network" opened nothing). Null for
 *  anything else, which goes to the Problem screen as before. */
export function requestRefusal(p: Refused, shown: { coin: string; network: string }): string | null {
  let line: string;
  if (p.code === "ledger.token.unsupported") line = `${shown.coin} can't come to you on ${shown.network} yet. Pick another coin or network.`;
  else if (p.code === "ledger.chain.unsupported") line = `${shown.network} can't send coins to you yet. Pick another network.`;
  else if (p.code.startsWith("chat.request.")) line = p.more ? `${p.whatHappened} ${p.more}` : p.whatHappened;
  else if (p.next.kind === "open" && p.next.screen === "receive") line = `${p.whatHappened} Pick another network.`;
  // k-chat crawl (4 Nov, S3): the beta's limit went to the Problem screen, whose Go back closed the whole form, and it
  // spoke of adding money when this is only a request. It stays on the sheet, the amount kept, in a request's words.
  // The limit is read from the core's own words (security-problems.ts betaCapOver/betaCapReached carry capUsd), never
  // written here, so a new limit can't leave these lines wrong (the Copywriter's builder note, 4 Nov).
  else if (p.code === "security.beta.cap-over") {
    const room = /up to \$([\d,]+) more/.exec(p.more ?? "")?.[1];
    const cap = betaCap(p);
    line = room && cap ? `You can ask for up to $${room} now. In the beta, an account holds up to $${cap}.` : "That's more than the beta lets you hold. Ask for less.";
  } else if (p.code === "security.beta.cap") {
    const cap = betaCap(p);
    line = cap ? `Your account is at the beta's $${cap} limit. You can't ask for more now.` : "Your account is at the beta's limit. You can't ask for more now.";
  }
  else return null;
  return /nothing was (posted|asked|sent)/i.test(line) ? line : `${line} Nothing was asked.`;
}

/** Whether the address the bridge gave for your own request may be posted: really an address on `chain` (checked like
 *  anyone's, so a request no one can pay is never sent), or the Sim's sample, which its bridge marks (sd-chat crawl, 5 Nov,
 *  a: the Sim's addresses are unusable on purpose, and every Sim request was refused). Real's bridge never marks one. */
/** `sim`: this page is the public build's Sim (QA's SHOULD: the mark counts only there, so no Real path, even a
 *  future ledger's answer, skips the check on the person's own address). */
export function postableOwnAddress(r: { address: string; sample?: boolean }, chain: string, sim: boolean = simPage()): boolean {
  if (sim && r.sample === true) return /^\S{2,128}$/.test(r.address);
  const own = detect(r.address, chainName(chain));
  return "ok" in own && own.ok.kind === "one" && own.ok.chain === chain;
}
