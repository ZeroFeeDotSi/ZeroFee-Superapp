// H-5 Scan to pay: what the camera read, turned into Send filled in, or one plain line. Pure: no network, no camera.
// Scanning never sends: the answer is only ever a prefill the person sees on Send (and edits, and approves), or a line. It loads with the scan sheet on the first tap of Send's scan glyph, never in Home's first load.
//
// Before Send opens, the code passes the same guard the Send sheet runs (packages/agent, through send-guard.ts):
// hidden words (obfuscated), a look-alike site (siteOf), the block list (judge), and an amount ten times off what the
// code's own words say (unitGuard). Send then runs its full guard again on the person's own tap.
import { readPayCode, siteOf, type PayCode, type UnsupportedWhat } from "@zerofee/pay/codes/parse";
import { chainsForAddress } from "@zerofee/pay/chains";
import { prefillFromLink, readSendLink, type Prefill } from "@zerofee/pay/app/links.ts";
import { BANK_TILE_ON } from "@zerofee/pay/bank-tile";
import type { TokenDirectory } from "@zerofee/pay/tokens";
import { guardTarget, judge, linkUnitOff, obfuscated } from "./send-guard.ts";
export { saysDollars } from "./send-guard.ts";

/** The one line on the camera. */
export const SCAN_LINE = "Point at a wallet's or a shop's code";
export const SCAN_HIDES = "This code hides its words. Nothing was sent.";
export const CANT_BANK = "ZeroFee can't pay bank codes.";
export const CANT_YET = "ZeroFee can't pay this yet.";
const SAYS: Record<UnsupportedWhat, string> = {
  lightning: `It's a Lightning invoice. ${CANT_YET}`,
  walletconnect: `It links a wallet to a website. ${CANT_YET}`,
  "solana-transaction": `It's a Solana Pay checkout. ${CANT_YET}`,
  "evm-call": `It asks to run an app, not to pay. ${CANT_YET}`,
  "ens-name": "It gives a .eth address. Ask for the 0x address instead.",
  network: "Its network isn't in ZeroFee yet.",
};
export const WEB_LINE = "This code opens a web page, not a payment.";
export const LOOKALIKE_LINE = "This code opens a site with look-alike letters. Nothing was sent.";
export const UNREADABLE = "This code can't be read. Try again, a little closer.";
export const SHOP_TILL = `It's a shop's till code. ${CANT_YET}`;

/** With a live bank partner in Pay: where to pay it (no tap ever jumps apps for money: the one-sheet rule). */
export const BANK_IN_PAY = "Pay this bank code in Pay: open Pay and scan it there.";

/** Send filled in, or a line on Send (nothing filled). Never a send, never another app. */
export type ScanResult = { prefill: Prefill } | { line: string };

/** Each piece of the code on its own (a URL's parts, a bank code's lines), decoded: a name in another alphabet next to
 *  "label=" is not a look-alike; hidden letters inside one piece are. */
function hides(raw: string): boolean {
  if (obfuscated(raw.replace(/[^\u0000-ɏ\s]/g, "")) && obfuscated(raw)) return true;
  return raw.split(/[?&=#/\r\n]+/).some((part) => {
    let p = part;
    try {
      p = decodeURIComponent(part.replace(/\+/g, " "));
    } catch {
      // a stray "%": the piece as written
    }
    return obfuscated(p);
  });
}

export function readScan(text: string, o: { tokens: TokenDirectory | undefined; self?: string; bankLive?: boolean }): ScanResult {
  const raw = text.trim();
  if (!raw) return { line: UNREADABLE };
  const code: PayCode = readPayCode(raw);
  // a bank code is never filled into Send, so its shop's own name (in any alphabet, next to the code's tags) is not read
  // here: only a live bank partner in Pay pays it (D77: Mt Pelerin's tile is off); never a dead end, the form stays
  if (code.kind === "bank") return { line: (o.bankLive ?? BANK_TILE_ON) ? BANK_IN_PAY : CANT_BANK };
  // hidden letters next, before anything in the code is read as a name or an amount
  if (hides(raw)) return { line: SCAN_HIDES };
  switch (code.kind) {
    case "unsupported":
      return { line: SAYS[code.what] };
    case "web":
      return { line: siteOf(code.url).lookalike ? LOOKALIKE_LINE : WEB_LINE };
    case "damaged":
      return { line: "This code looks damaged or changed, so it wasn't used." };
    case "bad-request":
      return { line: "This payment link is broken. Ask for a new one." };
    case "unknown":
      // ZeroFee's own send link (Chat's "send 5 USDC to …") reads like a request; anything else can't be read
      if (!readSendLink(raw)) return { line: UNREADABLE };
  }
  // a shop's till that watches for its own reference key (Solana Pay): a payment from Send can't carry it, so the till
  // would never see it and the person might pay twice (security review M2)
  if (code.kind === "crypto" && code.notes.includes("shop-may-not-see-it")) return { line: SHOP_TILL };
  if (!o.tokens) return { line: "Your coins are still loading. Scan again in a second." };
  // "ethereum:0x…" with no "@<chain id>": wallets print it for every EVM chain, so Ethereum is a guess that can send on
  // the wrong one. It asks which network, as a bare 0x address does; with no network the coin (a contract is one chain's)
  // isn't known either, so neither is its amount: the person picks and types them (review L7)
  const guessed = code.kind === "crypto" && /^ethereum:(?:pay-)?0x[0-9a-f]{40}(?:[/?]|$)/i.test(raw);
  const r = guessed ? { ok: { recipient: { kind: "address" as const, chain: null, candidates: chainsForAddress(code.address), address: code.address } } } : prefillFromLink(raw, o.tokens, o.self);
  if ("problem" in r) return { line: r.problem.whatHappened };
  let p: Prefill = r.ok;
  if (code.kind === "crypto" && !guessed) {
    const ownNear = o.tokens.find("near", { native: true })?.assetId;
    // NEAR's own coin is the Safe's "near" row (as links.ts reads a send link), never wrapped NEAR the person doesn't hold
    if (p.tokenId && p.tokenId === ownNear) p = { ...p, tokenId: "near" };
    // a bare address names no coin and no amount: like a pasted one, the person picks the coin
    if ("native" in code.token && !code.amount) {
      const { tokenId: _named, ...rest } = p;
      p = rest;
    }
  }
  // the block list (judge), before Send opens; Send's own tap reads the account itself and runs judge again
  const to = guardTarget(p.recipient);
  const where = p.recipient.kind === "address" ? (p.recipient.chain ?? "other") : "near";
  const check = judge(to, { account: null, paidBefore: true }, where);
  // judge names Solana, BNB Chain and Robinhood Chain; any other network's address is just "This address"
  if (check.verdict === "block") return { line: `${check.line.replace("This other chain address", "This address")} Nothing was sent.` };
  // the code's words name dollars, its amount is ten times off them: the unit guard stops it (as a paste and a link do)
  const off = linkUnitOff(p, o.tokens, code.kind === "crypto" ? code.memo : undefined);
  if (off) return { line: off };
  return { prefill: p };
}
