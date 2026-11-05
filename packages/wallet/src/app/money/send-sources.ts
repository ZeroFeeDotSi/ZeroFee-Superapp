// Where a Send can come from, and who gets it (the Home plan §1.3, E3, E4, D128). Plain functions, so tests read them
// without the sheet.
import { chainName } from "@zerofee/pay/chains";
import { maxSend } from "@zerofee/core/inflow-grid";
import { fromUnits, toUnits } from "../../amount.ts";
import { fourPlacesText } from "@zerofee/core/format";
import { SAFE_SEND_OPEN } from "../../send-open.ts";
import type { Balance, Payee } from "../../types.ts";
import type { SendAsk, SendSource } from "./SendForm.tsx";
import { HIDDEN_COINS, SOL_TOKEN_ACCOUNT_RENT } from "@zerofee/core/hidden-coins";
import { segwitLower } from "../../addresses.ts";
import type { HeldCoin } from "../trading.ts";
import type { SpendingWallet } from "@zerofee/core/spending";
import { SEND_ROWS, coinLabel, rowMax } from "./send-rows.ts";
import { SEND_CANT, SEND_PART } from "./send-words.ts";
import { privateRow } from "./send-cap.ts";
import { safeHeld, type EarnPart } from "../format.ts";
import { nearImplicitOf } from "../../send-reach.ts";

export { SAFE_SEND_OPEN };

/** Who gets it, as the ledger takes it: a NEAR name with money in NEAR Intents by INTENTS, any other by its chain. */
export function payeeOf(a: Pick<SendAsk, "recipient" | "network">): Payee {
  const r = a.recipient;
  if (r.kind === "ledger") return { kind: "ledger", accountId: r.accountId };
  if (r.kind === "near-wallet") return { kind: "chain", chain: "near", address: r.accountId };
  // a Bitcoin or Litecoin address in its QR form (all capitals) is paid in lower case (QA, 5 Nov); NEP-518 on
  // NEAR: the account's id is the lower-case address, its checksum checked first (send-reach nearImplicitOf)
  return { kind: "chain", chain: a.network, address: a.network === "near" ? nearImplicitOf(r.address) ?? r.address.trim() : segwitLower(r.address.trim()) };
}

/**
 * The Send sources, in the dropdown's order: each wallet (its coin, all of it but its fee room), then the Safe's coins
 * biggest first. A Safe coin is one amount on screen (D128: what sits in the pocket counts under the Safe), but only what
 * can go now is sendable: the pocket's share, plus the Safe's own once its route is open (ledger.sendFromSafe pays each
 * part from where it is). A coin that can't send anything now isn't offered (D125).
 */
export function sendSources(rows: readonly Balance[], safe: readonly Balance[], pocket: readonly Balance[], safeOpen: boolean = SAFE_SEND_OPEN, held: readonly HeldCoin[] | null = null, earning: readonly EarnPart[] = []): SendSource[] {
  const wallets: SendSource[] = rows.flatMap((r) => {
    const row = r.chain === "sol" || r.chain === "hood" ? r.chain : null;
    if (!row) return [];
    return [{ id: r.tokenId, row, tokenId: r.tokenId, label: `${SEND_ROWS[row].coin} · your ${SEND_ROWS[row].name}`, place: `your ${SEND_ROWS[row].name}`, symbol: r.symbol, icon: r.icon, chain: r.chain, amount: r.amount, ...(r.usd ? { usd: r.usd } : {}), max: rowMax(row, r.amount) }];
  });
  // `one`: the most one place of the Safe holds (NEAR Intents or the account): one send's leg 1 pays from one place
  // (convert.ts routeFor), never both added
  const coins = new Map<string, { b: Balance; safe: number; pocket: number; usd: number; at: Record<string, number>; one: number }>();
  for (const [list, part] of [[safe, "safe"], [pocket, "pocket"]] as const) {
    for (const b of list) {
      if (b.listed === false || !(Number(b.amount) > 0)) continue;
      const had = coins.get(b.tokenId) ?? { b, safe: 0, pocket: 0, usd: 0, at: {}, one: 0 };
      had[part] += Number(b.amount);
      if (part === "safe") { had.at[b.held] = (had.at[b.held] ?? 0) + Number(b.amount); had.one = Math.max(...Object.values(had.at)); }
      had.usd += Number(b.usd ?? 0);
      coins.set(b.tokenId, had);
    }
  }
  // one row per Safe coin (product decision, 5 Nov: one figure per Safe coin; QA re-check, item 9: Send said "10 USDC"
  // and "2 NEAR" under Home's 1,290.60 and 326.9): the row is Home's figure (format.ts safeHeld); it pays from the coin id
  // that can send the most of it now, and Max is that (`max`), said in one quiet line (`part`) when it is less
  type Held = { b: Balance; safe: number; pocket: number; usd: number; at: Record<string, number>; one: number };
  const bySymbol = new Map<string, { tokenId: string; can: number; c: Held; fills: boolean }>();
  for (const [tokenId, c] of coins) {
    // the Safe's own part only for a coin whose fill works end to end (route B: a coin native to NEAR, ledger.sendFromSafe
    // with `fill`); one send is paid from one place (Private, or the Safe through Private: one sheet, one payout). A
    // bridged coin (BTC, ETH, SOL on NEAR) can't fill Private: its row is the copy review's Private-only row (its figure in Private,
    // the keypad capped there, no standing line); nothing in Private, no row (drop, don't degrade)
    const fills = safeOpen && c.b.bridged !== true;
    const can = fills ? Math.max(c.pocket, c.one) : c.pocket;
    const best = bySymbol.get(c.b.symbol);
    if (can > 0 && (!best || can > best.can)) bySymbol.set(c.b.symbol, { tokenId, can, c, fills });
  }
  const safes: SendSource[] = [...bySymbol.values()].map(({ tokenId, can, c, fills }): SendSource => {
    const figure = safeHeld([...safe, ...pocket], c.b.symbol, earning);
    const amount = figure?.amount ?? String(can);
    const usd = Number(figure?.usd ?? c.usd);
    const per = Number(amount) > 0 && usd > 0 ? usd / Number(amount) : 0;
    // dollars with their thousands comma, as every money line says them ("$1,300.50")
    const most = per > 0 ? `$${(Math.floor(can * per * 100 + 1e-6) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${can} ${c.b.symbol}`;
    // the copy review's ruling (5 Nov): sent from Private only (the Safe's own part can't fill), the row carries Private's figure and no
    // standing line; the keypad caps at it (SendForm privateCap). The fill open for this coin: "Up to … can go in one
    // send." only as with the route open (the coin holds more than all its places), never for one send's one place: that
    // cap is said only when the typed amount is over it ("at most", finding 64), no extra standing text
    const part = fills && Number(amount) - (c.pocket + c.safe) > 1e-9 ? SEND_PART(false, most) : null;
    const fromPrivate = !fills ? { privateOnly: true as const, line: privateRow(c.b.symbol, most) } : {};
    // the row names the place it really pays from (QA test, MUST 3): Private's coins are "Private", never "your Safe"
    const place = fills ? "your Safe" : "Private";
    return { id: `safe:${tokenId}`, row: null, tokenId, label: `${c.b.chain === "near" && c.b.held !== "account" ? c.b.symbol : coinLabel({ ...c.b, held: c.b.held === "private" ? "ledger" : c.b.held }, chainName)} · ${place}`, place, symbol: c.b.symbol, icon: c.b.icon, chain: c.b.chain, amount, ...(usd > 0 ? { usd: usd.toFixed(2) } : {}), max: String(can), ...(c.pocket > 0 ? { pocket: String(c.pocket) } : {}), ...(part ? { part } : {}), ...fromPrivate };
  }).sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0));
  return [...wallets, ...tokenSources(held), ...safes];
}

/** A Solana token's send pays the rent of 1Click's new token account from the SOL wallet (core SOL_TOKEN_ACCOUNT_RENT),
 *  once, never back: said with its dollars at the SOL wallet's own price (QA's SHOULD, 5 Nov). Null otherwise. */
export function rentLine(s: Pick<SendSource, "coin" | "row" | "symbol">, sources: readonly SendSource[]): string | null {
  if (!s.coin || s.row !== "sol") return null;
  const sol = sources.find((x) => x.tokenId === "row:sol");
  const per = sol && Number(sol.amount) > 0 && Number(sol.usd) > 0 ? Number(sol.usd) / Number(sol.amount) : null;
  const usd = per === null ? null : (Number(SOL_TOKEN_ACCOUNT_RENT) / 1e9) * per;
  return SEND_CANT.rent(s.symbol, usd === null ? null : `$${(Math.ceil(usd * 100) / 100).toFixed(2)}`);
}

/** 1Click's id for a coin the core sends privately from a wallet (core hidden-coins.ts), by chain and mint or contract. */
const HIDDEN_BY_ADDRESS = new Map(Object.entries(HIDDEN_COINS).map(([id, c]) => [`${c.chain}:${c.chain === "hood" ? c.address.toLowerCase() : c.address}`, id]));
export const hiddenIdOf = (chain: string, address: string): string | null => HIDDEN_BY_ADDRESS.get(`${chain}:${chain === "hood" ? address.toLowerCase() : address}`) ?? null;

/**
 * Every other coin the wallets hold (the Send review, 5 Nov: "all the currencies"), biggest first, from Trade's own list
 * (trade.positions: SPL coins and memecoins on Solana, ERC-20s on Robinhood Chain, the NEAR wallet's coins). One the core
 * sends privately (hidden-coins.ts) goes as itself, all of it (the wallet's own coin pays the fee). Any other is listed,
 * never hidden, with its one reason (`cant`) and, on Solana and Robinhood Chain, Swap as its way on (`swap`).
 */
export function tokenSources(held: readonly HeldCoin[] | null): SendSource[] {
  return (held ?? []).flatMap((h): SendSource[] => {
    if (!(Number(h.amount) > 0) || !h.address) return [];
    const row = h.chain === "sol" || h.chain === "hood" ? h.chain : null;
    const coin = row ? hiddenIdOf(row, h.address) : null;
    const place = row ? `your ${SEND_ROWS[row].name}` : h.chain === "near" ? "your NEAR wallet" : "your BNB wallet";
    const cant = coin ? null : row ? SEND_CANT.swapFirst(h.symbol) : h.chain === "near" ? SEND_CANT.nearWallet : SEND_CANT.bnb;
    return [{
      id: `coin:${h.chain}:${h.address}`, row, tokenId: coin ?? `${h.chain}:${h.address}`, label: `${h.symbol} · ${place}`, place, symbol: h.symbol, chain: h.chain, amount: h.amount,
      ...(h.usd ? { usd: h.usd } : {}), max: coin ? h.amount : "0", ...(coin ? { coin } : {}), ...(cant ? { cant } : {}), ...(!coin && row ? { swap: row } : {}),
    }];
  }).sort((a, b) => Number(!!a.cant) - Number(!!b.cant) || Number(b.usd ?? 0) - Number(a.usd ?? 0));
}

/**
 * A site's own wallets (pump.fun, GMGN; the Send review, 5 Nov: "show all currencies held"): listed with their dollars,
 * never sendable here. Its key pays only on its site, so its money goes home first by Move back (two confidential legs,
 * SiteMoney.tsx), then Send pays from the Safe. Empty and unread wallets are left out.
 */
export function siteSources(wallets: readonly SpendingWallet[] | null): SendSource[] {
  return (wallets ?? []).flatMap((w): SendSource[] => {
    if (w.role !== "site" || w.unread) return [];
    const usd = Number(w.cashUsd ?? 0) + Number(w.coinsUsd ?? 0);
    if (!(usd > 0)) return [];
    const name = w.label.replace(/ wallet$/, "");
    return [{
      id: `site:${w.id}`, row: null, tokenId: `site:${w.id}`, label: `your ${w.label}`, place: `your ${w.label}`, symbol: name, chain: w.network, amount: "0",
      usd: usd.toFixed(2), max: "0", line: `$${usd.toFixed(2)}`, cant: SEND_CANT.siteWallet, back: { wallet: w.id, name },
    }];
  });
}

/** Max's words (privacy audit, 4 Nov): Max sends a grid amount and keeps the grid's gap, so the sheet says exactly what
 *  goes to the payee and that the rest stays in the private balance. Null when Max isn't picked or nothing is rounded;
 *  `decimals` unknown: the same line without the figure. */
export function maxSendLine(s: Pick<SendSource, "max" | "symbol" | "pocket">, amount: string, decimals: number | undefined): string | null {
  if (!(Number(s.max) > 0) || !(Number(amount) >= Number(s.max))) return null;
  if (decimals === undefined) return "Some of it stays in Private.";
  const upTo = toUnits(s.max, decimals), pocket = s.pocket ? toUnits(s.pocket, decimals) ?? 0n : 0n;
  const m = upTo === null || upTo <= pocket ? null : maxSend(upTo, pocket);
  // no inflow (the pocket alone pays): what's left is the Safe's own part, and it stays there
  // the figure at most 4 decimals, rounded down (QA's Sim walk, 5 Nov: raw coin figures), never more than goes
  return m ? `${fourPlacesText(`${fromUnits(m.pays, decimals)} ${s.symbol}`)} goes to them. The rest stays in ${m.asked > 0n ? "Private" : "your Safe"}.` : null;
}

/**
 * The source Send opens on for Home's wallet preset (Send from a wallet's own page): "sol" and "hood" their wallet, "safe"
 * the Safe's first coin that can go. With no preset (Home's own Send), D70: a send goes from Private, so the Safe's coin
 * that can send the most dollars now (its private part, ledger.sendFromSafe); none: the dropdown's first (a web test
 * 16:43: Send opened on the SOL wallet). A wallet Send can't send from yet (NEAR, BNB): the same.
 */
export function startSource(wallet: string | null | undefined, sources: readonly SendSource[], coin?: string): string | null {
  const canUsd = (s: SendSource) => { const a = Number(s.amount), u = Number(s.usd); return a > 0 && u > 0 ? (Number(s.max) * u) / a : 0; };
  // a coin's own page (QA's Sim crawl, 5 Nov: its Send opened on USDC): that coin, the place that can
  // send the most dollars of it now; none of it can go: the rules below
  const its = coin ? sources.filter((s) => s.symbol === coin && Number(s.max) > 0).sort((a, b) => canUsd(b) - canUsd(a))[0] : undefined;
  if (its) return its.id;
  if (wallet === "sol" || wallet === "hood") return sources.find((s) => s.row === wallet)?.id ?? null;
  if (wallet === "safe") return sources.find((s) => s.row === null)?.id ?? null;
  const best = sources.filter((s) => s.row === null && Number(s.max) > 0).sort((a, b) => canUsd(b) - canUsd(a))[0];
  return best?.id ?? null;
}

/**
 * What a Safe coin sends, in that coin: the form's amount; or, for a request or link that names a coin and amount, the
 * same dollars in this coin (the Safe's route pays what leaves, never an exact amount out). "" when it has no price.
 * Six places at most, down: every coin the Safe holds has at least six.
 */
export function safeAmount(a: Pick<SendAsk, "source" | "amountIn" | "usd" | "exactOut">): string {
  if (!a.exactOut) return a.amountIn;
  const per = Number(a.source.usd) / Number(a.source.amount);
  if (a.usd === null || !(a.usd > 0) || !(per > 0)) return "";
  return (Math.floor((a.usd / per) * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, "");
}
