// Request money, inside Add (D123, D127, D128; the Home plan §1.2): the pure half of "Ask someone to pay you", tested
// without a page. A request is dollars, an optional note, and the coin they pay in: a chain's own coin only (Add's rows,
// ADD_OPEN), never a token. It gives a ONE-TIME address from the core's own subwallet.add.quote (1Click's address on the
// coin's own chain; the money lands in the NEAR wallet's private balance, then goes on to the chain's wallet), and two
// ways to pay it: (a) a ZeroFee link + QR, which a ZeroFee payer's Send opens filled in (shown, editable, through Send's
// own guard); (b) the address + QR with the amount, for any outside wallet. No Plain: a person's own address is never
// handed out. Every figure on screen is the core's answer.
// The payer's half (requestTarget, rowPays, askOf, …) is Send's, kept here as it was.
import { addressFits, PAY_HOST, requestLink, requestProblem, requestWebLink, type PayRequest } from "@zerofee/pay/request";
import type { Problem } from "@zerofee/core/problem";
import { EVM_CHAIN_ID } from "@zerofee/core/evm";
import { ADD_LEAST_USD, ADD_OPEN, REQUEST_MOST_USD, type AddAddress, type AddChain } from "@zerofee/core/add-outside";
import type { PayTarget } from "@zerofee/pay/plan";
import type { Token } from "../../types.ts";
import { addRows, formatUnits, type AddRow } from "./add-coins.ts";

/** A request link is good for at most a day. */
export const REQUEST_LINK_MS = 24 * 3_600_000;
/** A request's link ends 30 minutes before its address's own end, so a payment still lands in time (review M1). */
export const HIDDEN_MARGIN_MS = 30 * 60_000;

/** "They pay in": Add's rows, a chain's own coin each (D123: no USDC, no USDT, nothing a wallet can't move). */
export const requestRows = (open: Readonly<Record<AddChain, boolean>> = ADD_OPEN): AddRow[] => addRows(open);

/** The words (copy F: short, a five-year-old can read; "ETH (RH)"; dollars first). */
export const REQUEST_WORDS = {
  title: "Request money",
  lead: "Ask someone to pay you",
  howMuch: "Dollars to ask for",
  note: "Add a note",
  payIn: "They pay in",
  tooMuch: `Ask for $${REQUEST_MOST_USD.toLocaleString("en-US")} or less at a time.`,
  tooLittle: `Ask for $${ADD_LEAST_USD} or more. Under that, most goes on fees.`,
  typeFirst: "Type how many dollars first.",
  /** Dollars typed, no coin tapped: the tap is the last step (UI audit, 5 Nov; copywriter). */
  pickCoin: "Tap a coin to make the request.",
  once: "Each address is new and works once.",
  asking: "Getting an address…",
  zerofee: "ZeroFee link",
  /** The address tab names its network, never "Any ETH wallet" (finding 55: a friend on Ethereum would lose the money). */
  outside: (network: string) => `${network} address`,
  linkLine: "A friend with ZeroFee opens this and pays.",
  copyLink: "Copy link",
  // the dollars are the headline above it: said once (integration walk)
  linkShown: (symbol: string) => `Your ZeroFee link, paid in ${symbol}.`,
  copyAddress: "Copy address",
  copied: "Copied",
  share: "Share",
  /** What Share hands over (test: a raw "zerofee:pay?…" line, no words): words, then ZeroFee's web link. */
  shareText: (usd: string, link: string) => `Pay me $${usd} on ZeroFee: ${link}\nIn ZeroFee, tap Send and paste this link.`,
  again: "Ask for another",
  ranOut: "This request ran out. Ask for another.",
  back: "Back to Add money",
  noAnswer: "NEAR Intents didn't answer. Nothing was asked. Try again.",
  noAddress: "NEAR Intents gave no address. Nothing was asked. Try again.",
  ask: (amount: string, symbol: string, name: string, good: string) => `Send ${amount} ${symbol} here. It goes to your ${name} wallet. ${good}.`,
  onlyThis: (symbol: string, network: string) => `Send only ${symbol} on ${network} to this address. ${symbol} sent on any other network won't arrive.`,
} as const;

/** "20", "19.5", "$20.00" → "20.00"; null for nothing, zero, or a figure no request could be. */
export function askedUsd(typed: string): string | null {
  const t = typed.replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(t) || !(Number(t) > 0)) return null;
  return Number(t).toFixed(2);
}
/** Over what the relay takes for one quote (REQUEST_MOST_USD, by 1Click's own dollars): the line says so before asking. */
export const tooMuch = (usd: string | null): boolean => usd !== null && Number(usd) > REQUEST_MOST_USD;
/** Why the coins can't be tapped yet, in one line; null when the dollars can be asked for: none typed, under the least
 *  worth its fees (ADD_LEAST_USD, the core refuses less), or over what one quote takes (REQUEST_MOST_USD). */
export function askLine(usd: string | null): string | null {
  if (usd === null) return REQUEST_WORDS.typeFirst;
  if (Number(usd) < ADD_LEAST_USD) return REQUEST_WORDS.tooLittle;
  if (tooMuch(usd)) return REQUEST_WORDS.tooMuch;
  return null;
}

/** The line under the coins: askLine, but nothing before anything is typed (a web test: "Type how many dollars
 *  first" nagged before any tap; the coins are still off, and the keypad is the one thing to do). */
export const shownAskLine = (typed: string): string | null => (typed.trim() ? askLine(askedUsd(typed)) : null);

/** The one line under the coins (every step says what's next): why the coins are off, else what went wrong, else that
 *  one is being asked, else, with dollars that can be asked, to tap a coin (UI audit, 5 Nov: $12 typed and no hint). */
export function requestHint(typed: string, line: string | null, busy: boolean): string | null {
  return shownAskLine(typed) ?? line ?? (busy ? REQUEST_WORDS.asking : askedUsd(typed) ? REQUEST_WORDS.pickCoin : null);
}

/** A valid address of each chain, only to run Pay's own link checks on a demo request whose made-up address fits none. */
const STAND_IN: Record<string, string> = { sol: "So11111111111111111111111111111111111111112", hood: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", bsc: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", near: "a".repeat(64) };

/**
 * The core's answer, before anything is shown: the chain asked, into the chain's wallet, the dollars asked, an amount,
 * an address that fits the coin's own chain, and an end still to come. A request's address only ever comes from here
 * (the core's own quote, checked against 1Click's signature), never from typed text: so a request can't name someone
 * else's address. The web demo's made-up address (sample) fits no chain by design; it is the only one let through.
 */
export function checkAsk(q: unknown, chain: AddChain, usd: string, nowMs: number): AddAddress | null {
  const x = q as Partial<AddAddress> | null;
  if (!x || x.chain !== chain || x.to !== "wallet" || typeof x.depositAddress !== "string" || x.usd !== usd) return null;
  if (!(x.sample === true ? /^[A-Za-z0-9]{20,100}$/.test(x.depositAddress) : addressFits(x.depositAddress, chain))) return null;
  if (typeof x.amountIn !== "string" || !/^\d{1,40}$/.test(x.amountIn) || BigInt(x.amountIn) === 0n || typeof x.decimals !== "number" || typeof x.symbol !== "string") return null;
  const end = typeof x.untilIso === "string" ? Date.parse(x.untilIso) : NaN;
  if (!Number.isFinite(end) || end <= nowMs) return null;
  return x as AddAddress;
}

/** Expiry words from the time left: "Good for 45 min", "Good for 24 h", "Good for 3 days"; "This ran out" past it. */
export function expiryWords(untilMs: number, nowMs: number): string {
  const left = untilMs - nowMs;
  if (!(left > 0)) return "This ran out";
  const min = Math.max(1, Math.round(left / 60_000));
  if (min < 90) return `Good for ${min} min`;
  const h = Math.round(left / 3_600_000);
  if (h < 48) return `Good for ${h} h`;
  return `Good for ${Math.round(left / 86_400_000)} days`;
}

/** Dollars → the coin's smallest units at 1Click's listed price, cut to 8 decimal places (the most a line shows). */
export function unitsForUsd(usd: string, coin: Pick<Token, "priceUsd" | "decimals">): string | null {
  const price = Number(coin.priceUsd);
  if (!(price > 0) || !(Number(usd) > 0)) return null;
  const [i, f = ""] = (Number(usd) / price).toFixed(Math.min(coin.decimals, 12)).split(".");
  const u = BigInt(i + f.padEnd(coin.decimals, "0").slice(0, coin.decimals));
  const cut = coin.decimals > 8 ? 10n ** BigInt(coin.decimals - 8) : 1n;
  const units = (u / cut) * cut;
  return units > 0n ? units.toString() : null;
}

/** The ZeroFee link for a request (a): its target, coin, amount, dollars and end; a bad one is a Problem, never a link.
 *  `sample`: the web demo's made-up address, checked by Pay's rules with a stand-in of its chain (it fits no chain). */
export function requestLinkFor(o: { target: string; coin: Pick<Token, "chain" | "assetId" | "decimals">; units: string; usd: string; note?: string; hidden: boolean; untilMs: number; nowMs: number; sample?: boolean }): { link: string; request: PayRequest } | { problem: Problem } {
  const note = o.note?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  // an EVM address as the core makes it, all lower case (no checksum to get wrong)
  const r: PayRequest = {
    to: /^0x[0-9a-fA-F]{40}$/.test(o.target) ? o.target.toLowerCase() : o.target, chain: o.coin.chain, token: o.coin.assetId, amount: formatUnits(o.units, o.coin.decimals), usd: o.usd,
    exp: Math.floor(Math.min(o.hidden ? o.untilMs - HIDDEN_MARGIN_MS : o.untilMs, o.nowMs + REQUEST_LINK_MS) / 1000), ...(o.hidden ? { hidden: true as const } : {}), ...(note ? { note } : {}),
  };
  // a whole amount that rounds to nothing in the link (formatUnits keeps 8 places) is no request
  if (r.amount === "0") return { problem: { code: "pay.amount.invalid", whatHappened: "That amount is too small to ask for.", money: { state: "safe", where: "in your balance" }, next: { kind: "nothing", label: "Go back" } } };
  const p = requestProblem(o.sample && STAND_IN[r.chain!] ? { ...r, to: STAND_IN[r.chain!]! } : r, o.nowMs);
  return p ? { problem: p } : { link: requestLink(r), request: r };
}

/** The request as Share hands it over: plain words and ZeroFee's https link (Pay's requestWebLink), never the raw line. */
export const shareTextFor = (usd: string, request: PayRequest): string => REQUEST_WORDS.shareText(usd, requestWebLink(request, PAY_HOST));

/** The link's coin amount and its dollars agree at 1Click's listed price (within 5%): a link whose dollars hide a bigger
 *  amount (review H1: "$20" with 1.3 SOL in it) is refused before Send opens. No price to check by: refused too. */
export function requestFigures(ask: { amount?: string; usd?: string }, priceUsd: string | undefined): boolean {
  if (!ask.amount || !ask.usd) return !ask.amount && !ask.usd;
  const worth = Number(ask.amount) * Number(priceUsd);
  return worth > 0 && Math.abs(worth - Number(ask.usd)) <= Number(ask.usd) * 0.05;
}

/**
 * The payer's side (Send): how much of the request's coin to deliver for what the payer chose to pay. Paid in that very
 * coin: the amount typed (its dollars shown by the payer's own coin). In another coin: the link's own amount only when
 * the payer kept the link's dollars AND that amount is worth them at 1Click's listed price; otherwise the payer's dollars
 * at that price (review H1: never the link's ratio, which an unsigned link controls). No price: null, nothing sent.
 */
export function requestAmount(ask: { tokenId: string; amount?: string; usd?: string }, payTokenId: string, typed: string, paidUsd: number | null, asked: Pick<Token, "decimals" | "priceUsd">): string | null {
  // the same coin: what was typed, or the link's exact amount when the form only rounded it (6 places): a one-time
  // address takes exactly its amount (review L2)
  if (payTokenId === ask.tokenId) return ask.amount && Math.abs(Number(typed) - Number(ask.amount)) <= 1e-6 ? ask.amount : Number(typed) > 0 ? typed : null;
  const price = Number(asked.priceUsd);
  if (paidUsd === null || !(paidUsd > 0) || !(price > 0)) return null;
  if (ask.amount && ask.usd && Math.abs(paidUsd - Number(ask.usd)) < 0.005 && requestFigures(ask, asked.priceUsd)) return ask.amount;
  const s = (paidUsd / price).toFixed(Math.min(asked.decimals, 8)).replace(/\.?0+$/, "");
  return Number(s) > 0 ? s : null;
}

/** The payer's Send pays a request's address exactly the coin it names (a one-time address takes nothing else),
 *  whatever coin pays, and only before the request's end; or the one line why not. */
export function requestTarget(ask: { chain: string; tokenId: string; amount?: string; usd?: string; exp?: number; hidden?: boolean }, payTokenId: string, typed: string, paidUsd: number | null, address: string, tokens: { byAsset: (id: string) => Token | undefined }, note?: string, nowMs: number = Date.now()): { ok: PayTarget } | { line: string } {
  if (ask.exp !== undefined && ask.exp * 1000 <= nowMs) return { line: REQUEST_RAN_OUT };
  const over = overHidden(ask, paidUsd, payTokenId === ask.tokenId ? typed : undefined);
  if (over) return { line: over };
  const asked = tokens.byAsset(ask.tokenId);
  const amount = asked ? requestAmount(ask, payTokenId, typed, paidUsd, asked) : null;
  if (!asked || !amount) return { line: "This request's coin has no price right now. Nothing was sent." };
  return { ok: { to: { kind: "chain", chain: ask.chain, address: address.trim() }, token: asked, amount, notes: [], ...(note ? { message: note } : {}) } };
}
export const REQUEST_RAN_OUT = "This request ran out. Nothing was sent.";
/** Is this still the request's own address? EVM letters in any case are one address (review L1). */
export const sameTarget = (a: string, b: string): boolean => (/^0x[0-9a-fA-F]{40}$/.test(a.trim()) ? a.trim().toLowerCase() === b.trim().toLowerCase() : a.trim() === b.trim());
/** Review L3: a one-time request's address takes what its quote asked for, so the payer's dollars stop at the request's
 *  own; the one line says so (null: within it, or not a one-time request). */
export function overHidden(ask: { usd?: string; hidden?: boolean; amount?: string }, paidUsd: number | null, sameCoin?: string): string | null {
  // in the request's own coin, by coin amounts (re-review High: a price that rose since must never refuse the exact
  // amount, and a coin with no price must never pass with no limit); in another coin, by dollars
  const over = sameCoin !== undefined && ask.amount ? Number(sameCoin) > Number(ask.amount) + 1e-6 : paidUsd !== null && paidUsd > Number(ask.usd) + 0.005;
  return ask.hidden && ask.usd && over ? `This request is for $${ask.usd}. Pay $${ask.usd} or less.` : null;
}

/** Send's request while the address is still its own (the person may have typed another); null otherwise. */
export function askOf<A>(p: { recipient: { kind: string; address?: string }; request?: A }, to: { kind: string; address?: string }): A | null {
  return p.request && to.kind === "address" && p.recipient.kind === "address" && sameTarget(to.address!, p.recipient.address!) ? p.request : null;
}
export const ranOut = (ask: { exp?: number }, nowMs: number = Date.now()): boolean => ask.exp !== undefined && ask.exp * 1000 <= nowMs;
/** A row pays a request only for its own coin, with the request's exact amount when the form only rounded it (L2). */
export function rowPays(ask: { tokenId: string; amount?: string; usd?: string; hidden?: boolean; exp?: number }, row: string, typed: string, tokens: { byAsset: (id: string) => Token | undefined } | undefined, paidUsd: number | null = null, nowMs: number = Date.now()): { amount: string } | { line: string } {
  if (ranOut(ask, nowMs)) return { line: REQUEST_RAN_OUT };
  const over = overHidden(ask, paidUsd, typed);
  if (over) return { line: over };
  if (ask.tokenId !== `nep141:${row}.omft.near`) return { line: rowCantPay(tokens?.byAsset(ask.tokenId)?.symbol) };
  return { amount: requestAmount(ask, ask.tokenId, typed, null, { decimals: 9 }) ?? typed };
}
/** A row sends only its own coin, so it can't pay a request for another. */
export const rowCantPay = (symbol: string | undefined): string => `This request asks for ${symbol ?? "another coin"}. Pick another coin to pay with.`;

/**
 * The outside wallet's QR (review M2): on an EVM chain, EIP-681 with the chain's id from the core's own table
 * (ethereum:0x…@4663 for Robinhood Chain, @56 for BNB Chain), so a wallet that reads it sends on that chain, never another
 * EVM chain where the address also exists; with the exact amount in wei when the request names one. Any other chain:
 * the bare address. The "Send only … on …" line stays under it.
 */
export function addressQr(address: string, chain: string, units?: string, contract: string | null = null): string {
  const id = (EVM_CHAIN_ID as Record<string, number>)[chain];
  // a token (USDC on BNB Chain) is no native transfer: its bare address, never a native value (re-review Low)
  if (!id || contract !== null || !/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  return `ethereum:${address}@${id}${units && /^\d+$/.test(units) ? `?value=${units}` : ""}`;
}
