// Request-money links: "pay me 12.50 USDC for dinner", as a link or a QR.
//
// Everything is inside the link itself, so no server is involved:
//   zerofee:pay?v=1&to=alex.near&amount=12.5&token=nep141:…&note=Dinner&ref=k3x9
// and, once ZeroFee has a domain, the same fields after a "#", which browsers never send to the server:
//   https://<domain>/pay#v=1&to=alex.near&…
// A link is not signed: anyone can make one naming any account. So the screen always shows the account in full, and
// the approval sheet shows it again.
//
// H-4 (Request money, D111: never NEAR-only): a request may name an address on any chain instead of a NEAR account
// (`chain`), the coin there (`token`, required with `chain`), the dollars asked (`usd`, what the payer's Send shows
// first, editable) and when it runs out (`exp`, unix seconds). `hidden=1` marks the address as a one-time 1Click address
// that lands in the requester's Hidden (the core's own subwallet.private.quoteIn: recipient and refund the requester's
// own Hidden). Such an address takes exactly its coin, so a hidden request needs the coin, its amount and its end, and
// can never name an account (a NEAR name is someone's account, never a one-time Hidden address).
import { isDecimal, isZero } from "./amount.ts";
import { chainsForAddress, evmChecksumOk, isNamedNearAccount, isNearAccount } from "./chains.ts";
import { clean } from "./codes/emv.ts";
import { payProblems } from "./pay-problems.ts";
import type { Problem } from "@zerofee/core/problem";

export interface PayRequest {
  /** The NEAR account to pay, inside its ledger; with `chain`, an address on that chain. */
  to: string;
  /** Decimal string; absent lets the payer choose. */
  amount?: string;
  /** Ledger token id (e.g. "nep141:…"); absent lets the payer choose. */
  token?: string;
  /** Up to 80 characters, shown as the requester's own words. */
  note?: string;
  /** The requester's own reference, carried with the payment so they can tell who paid what. */
  ref?: string;
  /** 1Click's chain id when `to` is an address on that chain ("sol", "hood", "bsc", "near", "btc"…). */
  chain?: string;
  /** The dollars asked, as the requester typed them: the payer's Send shows these first, and they can change them. */
  usd?: string;
  /** When the request runs out, in unix seconds. */
  exp?: number;
  /** `to` is a one-time address that lands in the requester's Hidden. */
  hidden?: true;
}

const TOKEN = /^(nep141|nep245):[A-Za-z0-9._:-]{2,120}$/;
const REF = /^[A-Za-z0-9_-]{1,32}$/;
const CHAIN = /^[a-z0-9]{2,12}$/;
const USD = /^\d{1,7}(\.\d{1,2})?$/;
/** A request is good for at most 7 days (1Click signs a one-time address for at most 4). */
const MAX_EXP_S = 7 * 86_400;

/** Does `to` fit `chain`'s own address shape? */
export function addressFits(to: string, chain: string): boolean {
  // Robinhood Chain, an EVM chain Pay's own list doesn't carry yet: its address is an EVM address
  if (chain === "hood") return /^0x[0-9a-fA-F]{40}$/.test(to) && evmChecksumOk(to);
  return chainsForAddress(to).includes(chain);
}

/** ZeroFee's own site: its https request links (requestWebLink) are read like the zerofee: ones. */
export const PAY_HOST = "zerofee.si";
export const PAY_HOSTS: readonly string[] = [PAY_HOST];

function query(r: PayRequest): string {
  const p = new URLSearchParams({ v: "1", to: r.to });
  // test: a shared link said "&hidden=1". A one-time address is written "once=1" (read back as `hidden`); a link
  // made before still reads.
  for (const k of ["chain", "amount", "token", "usd", "exp", "hidden", "note", "ref"] as const) {
    const v = k === "hidden" ? (r.hidden ? "1" : "") : r[k];
    if (v) p.set(k === "hidden" ? "once" : k, String(v));
  }
  return p.toString();
}

/** Checks a request before it is made into a link, so a bad one never leaves the phone. */
export function requestProblem(r: PayRequest, nowMs: number = Date.now()): Problem | null {
  if (r.chain === undefined ? !isNearAccount(r.to) : !CHAIN.test(r.chain) || !addressFits(r.to, r.chain)) return payProblems.recipientInvalid();
  if ((r.amount !== undefined && (!isDecimal(r.amount) || isZero(r.amount))) || (r.usd !== undefined && (!USD.test(r.usd) || Number(r.usd) <= 0))) return payProblems.amountInvalid();
  // broken: a token, ref or note out of shape; an address on a chain with no coin named (it is paid in one coin); an end
  // that isn't a time or is more than 7 days away; a Hidden address with no coin, amount or end, or naming someone's
  // account (a NEAR name is never a one-time Hidden address)
  if (
    (r.token !== undefined && !TOKEN.test(r.token)) || (r.ref !== undefined && !REF.test(r.ref)) || (r.note !== undefined && r.note.length > 80) ||
    (r.chain !== undefined && r.token === undefined) || (r.exp !== undefined && (!Number.isSafeInteger(r.exp) || r.exp * 1000 > nowMs + MAX_EXP_S * 1000)) ||
    (r.hidden && (r.chain === undefined || isNamedNearAccount(r.to) || r.amount === undefined || r.exp === undefined))
  ) return payProblems.requestInvalid();
  return r.exp !== undefined && r.exp * 1000 <= nowMs ? payProblems.requestExpired() : null;
}

/** The link as text: put it in a QR, or share it. */
export function requestLink(r: PayRequest): string {
  return `zerofee:pay?${query(r)}`;
}

/** The same request as a web link, for when ZeroFee has a domain. The fields stay after "#", off the server. */
export function requestWebLink(r: PayRequest, host: string): string {
  return `https://${host}/pay#${query(r)}`;
}

/**
 * Reads a request link. Null when the text isn't one at all; a Problem when it is one but is broken or has run out, so
 * the person is never sent somewhere half-understood.
 */
export function readRequest(text: string, hosts: readonly string[], nowMs: number = Date.now()): { ok: PayRequest } | { problem: Problem } | null {
  let fields: string | undefined;
  const app = /^zerofee:(?:\/\/)?pay\?(.*)$/i.exec(text);
  if (app) fields = app[1];
  else if (/^https:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (!hosts.includes(url.host) || url.pathname !== "/pay") return null;
    // the page itself, with no request after "#", is a web page, never a broken request (scan.test siteOf)
    if (url.hash.length <= 1) return null;
    fields = url.hash.slice(1);
  }
  if (fields === undefined) return null;

  const p = new URLSearchParams(fields);
  if (p.get("v") !== "1") return { problem: payProblems.requestInvalid() };
  const r: PayRequest = { to: p.get("to") ?? "" };
  for (const key of ["amount", "token", "ref", "chain", "usd"] as const) {
    const v = p.get(key);
    if (v !== null) r[key] = v;
  }
  const exp = p.get("exp"), hidden = p.get("once") ?? p.get("hidden");
  // a broken end is NaN, refused by requestProblem; hidden is "1" or the link is broken
  if (exp !== null) r.exp = /^\d{1,12}$/.test(exp) ? Number(exp) : NaN;
  if (hidden !== null && hidden !== "1") return { problem: payProblems.requestInvalid() };
  if (hidden) r.hidden = true;
  const note = clean(p.get("note") ?? undefined, 80);
  if (note) r.note = note;
  const problem = requestProblem(r, nowMs);
  return problem ? { problem } : { ok: r };
}
