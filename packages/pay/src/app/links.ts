// A payment link another app hands Pay (openApp("pay", "send", link),): read like a scanned
// code, it fills in Send's recipient, and the amount if the link names one. The person still checks and confirms.
// Anything Send can't use comes back as the Problem to show: never a silent ignore. A link that names everything (who,
// how much, the coin, and its reference) skips Send and opens on Confirm (fullyNamed).
import type { Problem } from "@zerofee/core/problem";
import { fromUnits } from "../amount.ts";
import { isNearAccount, chainName } from "../chains.ts";
import { readPayCode } from "../codes/parse.ts";
import { addressFits, PAY_HOSTS, readRequest } from "../request.ts";
import { targetFor } from "../pay.ts";
import { payProblems } from "../pay-problems.ts";
import type { Recipient } from "../send.ts";
import type { TokenDirectory } from "../tokens.ts";
import type { Balance } from "@zerofee/wallet/types.ts";
import type { SendIntent } from "./screens/Send.tsx";

export interface Prefill {
  recipient: Recipient;
  /** The name the link gives itself. Unchecked: Confirm shows it as "The code says it's …", never as a contact. */
  label?: string;
  amount?: string;
  /** The coin the link asks for, when it names one the ledger lists. */
  tokenId?: string;
  /** The requester's own words, e.g. "Into Trip". */
  note?: string;
  /** The request's own reference, sent with the payment so the requester can match it. */
  ref?: string;
  /**
   * H-4: a request to an address on a chain (request.ts `chain`). That address takes exactly this coin, so whatever the
   * payer pays with, what arrives is this coin; the amount and dollars are only a start the payer sees and can change.
   * `hidden`: a one-time address that lands in the requester's Hidden.
   */
  request?: { chain: string; tokenId: string; amount?: string; usd?: string; exp?: number; hidden: boolean };
}

const NOT_LISTED = "The link asks for a coin ZeroFee can't send.";
/** The account's own NEAR, as Wallet's balance row names it (wallet catalogue.ts NATIVE_NEAR). */
const OWN_NEAR = "near";

/**
 * Another ZeroFee app's send, handed to Wallet's Send (openApp("wallet", "send", link)): `zerofee:send?v=1&to=<address
 * or NEAR account>&chain=<network id>&coin=<symbol>&amount=<decimal>&back=<app>`. ZeroFee Chat makes it from the
 * person's own typed "send 5 USDC to …" (D55). Every field is only a prefill: Send shows them, and the core's approval
 * sheet decodes what will really be signed. `chain` is required: the asking app already settled it with the person.
 */
export interface SendLink {
  to: string;
  chain: string;
  coin?: string;
  amount?: string;
  /** The app to go back to when the send is done (it reads the result from Activity itself). */
  back?: string;
}

const SEND_LINK = /^zerofee:send\?(.*)$/;
/** Apps a send goes back to: Chat, and Agent (a payment over its daily limit is the person's own send, release 10). */
const SEND_BACK = new Set(["chat", "agent"]);

export function sendLink(l: SendLink): string {
  const p = new URLSearchParams({ v: "1", to: l.to, chain: l.chain, ...(l.coin ? { coin: l.coin } : {}), ...(l.amount ? { amount: l.amount } : {}), ...(l.back ? { back: l.back } : {}) });
  return `zerofee:send?${p.toString()}`;
}

/** The send link's fields, or null when `text` isn't one (a broken one is a Problem). */
export function readSendLink(text: string): { ok: SendLink } | { problem: Problem } | null {
  const m = SEND_LINK.exec(text.trim());
  if (!m) return null;
  const p = new URLSearchParams(m[1]);
  const to = p.get("to") ?? "";
  const chain = p.get("chain") ?? "";
  const coin = p.get("coin") ?? undefined;
  const amount = p.get("amount") ?? undefined;
  const back = p.get("back") ?? undefined;
  if (p.get("v") !== "1" || !to || !/^[a-z0-9]{2,12}$/.test(chain)) return { problem: payProblems.codeUnreadable() };
  if (coin !== undefined && !/^[A-Za-z0-9.]{1,12}$/.test(coin)) return { problem: payProblems.codeUnreadable() };
  if (amount !== undefined && !/^\d+(\.\d+)?$/.test(amount)) return { problem: payProblems.codeUnreadable() };
  if (back !== undefined && !SEND_BACK.has(back)) return { problem: payProblems.codeUnreadable() };
  return { ok: { to, chain, ...(coin ? { coin } : {}), ...(amount ? { amount } : {}), ...(back ? { back } : {}) } };
}

/** A send link as Send's prefill: the recipient on its one network, and the coin there when the ledger lists it. */
function prefillFromSendLink(l: SendLink, tokens: TokenDirectory | undefined, self?: string): { ok: Prefill } | { problem: Problem } {
  if (l.chain === "near") {
    if (!isNearAccount(l.to)) return { problem: payProblems.recipientInvalid() };
    if (l.to === self) return { problem: payProblems.recipientSelf() };
  } else if (!addressFits(l.to, l.chain)) return { problem: payProblems.recipientInvalid() };
  // "NEAR" on NEAR is the account's own NEAR, the balance row Wallet names "near" (tokens.ts byAsset), never the listed
  // wrapped NEAR: Send matched the link's coin against the person's rows by id, found no "nep141:wrap.near" row on a
  // test account holding 7.16 NEAR, and said "This needs NEAR on NEAR, and you don't hold enough of it" (grade 02g, G1).
  const ownNear = l.chain === "near" && l.coin?.toUpperCase() === "NEAR";
  const token = l.coin && tokens ? (ownNear ? tokens.byAsset(OWN_NEAR) : tokens.find(l.chain, { symbol: l.coin })) : undefined;
  if (l.coin && tokens && !token) return { problem: payProblems.coinUnsupported(`${l.coin.toUpperCase()} can't be sent on ${chainName(l.chain)}.`) };
  const recipient: Recipient = l.chain === "near" ? { kind: "near-wallet", accountId: l.to } : { kind: "address", chain: l.chain, candidates: [l.chain], address: l.to };
  // An amount only ever in the coin it names: no coin, no amount (the person types it).
  return { ok: { recipient, ...(token ? { tokenId: ownNear ? OWN_NEAR : token.assetId, ...(l.amount ? { amount: l.amount } : {}) } : {}) } };
}

export function prefillFromLink(text: string, tokens: TokenDirectory | undefined, self?: string, nowMs: number = Date.now()): { ok: Prefill } | { problem: Problem } {
  const send = readSendLink(text);
  if (send) return "problem" in send ? send : prefillFromSendLink(send.ok, tokens, self);
  // H-4: a request read here first, so one that ran out says so (a scan only knows "broken")
  const asked = readRequest(text.trim(), PAY_HOSTS, nowMs);
  if (asked && "problem" in asked && asked.problem.code === "pay.request.expired") return asked;
  if (asked && "ok" in asked && asked.ok.chain) return prefillFromChainRequest(asked.ok as typeof asked.ok & { chain: string; token: string }, tokens, self);
  const code = readPayCode(text);
  if (code.kind === "request") {
    const r = code.request;
    if (r.to === self) return { problem: payProblems.recipientSelf() };
    // An amount is only ever in the coin the link asks for (USDC when it names none, as a scan of it reads).
    const token = r.token ? tokens?.byAsset(r.token) : r.amount ? tokens?.find("near", { symbol: "USDC" }) : undefined;
    if ((r.token || r.amount) && !token) return { problem: payProblems.coinUnsupported(NOT_LISTED) };
    return { ok: { recipient: { kind: "ledger", accountId: r.to }, amount: r.amount, tokenId: token?.assetId, note: r.note, ref: r.ref } };
  }
  if (code.kind === "crypto") {
    if (code.chain === "near" && code.address === self) return { problem: payProblems.recipientSelf() };
    const token = code.chain && tokens ? tokens.find(code.chain, code.token) : undefined;
    // A coin the ledger doesn't list is refused; never its amount filled in some other coin (Wallet's review).
    if (code.chain && !token) return { problem: payProblems.coinUnsupported(NOT_LISTED) };
    // With no network named, the coin isn't known either, so its amount isn't used: the person types one.
    const amount = !code.amount || !token ? undefined : "decimal" in code.amount ? code.amount.decimal : fromUnits(BigInt(code.amount.units), token.decimals);
    const recipient: Recipient = code.chain === "near"
      ? { kind: "near-wallet", accountId: code.address }
      : { kind: "address", chain: code.chain, candidates: code.candidates, address: code.address, ...(code.memo ? { memo: code.memo } : {}) };
    return { ok: { recipient, label: code.label, amount, tokenId: token?.assetId, note: code.message } };
  }
  if (code.kind === "web") return { problem: payProblems.codeUnsupported("It's a web page, not a payment link.") };
  // Bank codes, damaged or unsupported codes, broken requests: the same Problem a scan of it would show.
  const found = tokens ? targetFor(code, tokens, {}, self) : null;
  if (found && "problem" in found) return { problem: found.problem };
  if (found && "bank" in found) return { problem: payProblems.codeUnsupported("It's a bank code. Scan it in Pay to pay it.") };
  return { problem: payProblems.codeUnreadable() };
}

/** H-4: a request to an address on a chain. Its coin must be listed on that very chain (an address takes one coin: never
 *  USDC on Solana for a SOL address); the requester's own account or address is refused. */
function prefillFromChainRequest(r: { to: string; chain: string; token: string; amount?: string; usd?: string; exp?: number; hidden?: true; note?: string }, tokens: TokenDirectory | undefined, self?: string): { ok: Prefill } | { problem: Problem } {
  if (r.to === self) return { problem: payProblems.recipientSelf() };
  const token = tokens?.byAsset(r.token);
  if (!token || token.chain !== r.chain) return { problem: payProblems.coinUnsupported(NOT_LISTED) };
  // its coin amount and its dollars must agree at 1Click's listed price (within 5%): "$20" can't hide 1.3 SOL (review H1)
  if (r.amount && r.usd) {
    const worth = Number(r.amount) * Number(token.priceUsd);
    if (!(worth > 0) || Math.abs(worth - Number(r.usd)) > Number(r.usd) * 0.05) return { problem: payProblems.requestInvalid() };
  }
  const recipient: Recipient = r.chain === "near" && isNearAccount(r.to) ? { kind: "near-wallet", accountId: r.to } : { kind: "address", chain: r.chain, candidates: [r.chain], address: r.to };
  return {
    ok: {
      recipient, tokenId: token.assetId, ...(r.amount ? { amount: r.amount } : {}), ...(r.note ? { note: r.note } : {}),
      request: { chain: r.chain, tokenId: token.assetId, ...(r.amount ? { amount: r.amount } : {}), ...(r.usd ? { usd: r.usd } : {}), ...(r.exp !== undefined ? { exp: r.exp } : {}), hidden: r.hidden === true },
    },
  };
}

/** Send's one line over a request (H-4): the dollars, the warning, the requester's note last (review M4). */
export const requestLine = (p: Prefill): string | null => (p.request ? `A request${p.request.usd ? ` for $${p.request.usd}` : ""}. Anyone can make a link, so pay only people you know.${p.note ? ` Their note: “${p.note}”` : ""}` : null);

/**
 * A link that names who, how much, the coin and its reference, in a coin the person holds: the
 * send itself, so Pay opens on Confirm, which shows all of it before Face ID. Send would only ask the same question again
 * (ALPHA metric 2). Anything less (no amount, no coin, a coin not held) still fills Send in for the person to finish.
 */
export function fullyNamed(p: Prefill, balances: Balance[]): SendIntent | null {
  if (!p.amount || !p.tokenId || !p.ref) return null;
  const coin = balances.find((b) => b.tokenId === p.tokenId && b.listed !== false);
  if (!coin) return null;
  return { recipient: p.recipient, label: p.label, coin, amount: p.amount, askedTokenId: p.tokenId, note: p.note, ref: p.ref };
}
