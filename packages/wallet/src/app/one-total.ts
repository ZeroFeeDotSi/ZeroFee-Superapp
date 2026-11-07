// One total everywhere (the copy review's A2-3, 8 Nov: set-up said $5,515.49, Home Safe $5,288.01 + Hot $172.54, the Move sheet
// "All your wallets $5,460.55"). The figure is Home's two pills added: format.ts balanceTotal over the Safe (Private
// inside it) and Hot (trading.ts tradingUsd: the chain wallets, the coins in them, the site wallets, AgentZero's). Set-up
// reads it through balance-parts.ts, Home's kept copy through home-keep.ts totalOf, and the Move sheet here, so all three
// are the one sum. The Move sheet's rows are the places a Move can take from or give to (cash only, move-split.ts
// placesNow); what Hot holds outside them is named in one still row, so the rows add up to the headline.
import type { SpendingWallet } from "@zerofee/core/spending";
import type { Balance, Chain, PrivatePocket } from "../types.ts";
import { balanceTotal, type EarnPart } from "./format.ts";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";

/** Home's one total from the wallet's reads, or null while Hot is still missing a part (Home says "Updating…" then too). */
export function oneTotal(v: { balances: Balance[] | null; chains: Chain[]; earning: EarnPart[]; pocket: PrivatePocket | null; trading: string | null; tradingPartial: boolean }): string | null {
  if (!v.balances || v.trading === null || v.tradingPartial) return null;
  return balanceTotal(v.balances, v.chains, v.earning, v.pocket, v.trading);
}

/** What Hot holds that a Move doesn't take, named: the site wallets and AgentZero's by name, then the rest (coins held in
 *  the wallets, money on its way) as "coins in your wallets". */
export interface OutsideMove { usd: number; names: string[] }

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The Move sheet's headline and its still row. `all`: oneTotal (null: not read, the headline is the places' own sum as
 * before). `places`: the sum of the sheet's rows. The still row is the difference, only when it is a cent or more; its
 * names come from the wallets' list (each site once, GMGN's two wallets one name).
 */
export function moveHead(all: string | null, places: number, wallets: readonly SpendingWallet[] | null): { total: number; outside: OutsideMove | null } {
  const whole = all === null ? null : Number(all);
  if (whole === null || !Number.isFinite(whole) || whole - places < 0.005) return { total: cents(places), outside: null };
  const usd = cents(whole - places);
  const named = new Map<string, number>();
  for (const w of wallets ?? []) {
    if ((w.role !== "site" && w.role !== "agent") || w.unread) continue;
    const v = (Number(w.cashUsd) || 0) + (Number(w.coinsUsd) || 0);
    if (v < 0.005) continue;
    const name = w.label.replace(/ wallet$/, "");
    named.set(name, (named.get(name) ?? 0) + v);
  }
  const sites = [...named.values()].reduce((a, b) => a + b, 0);
  const names = [...named.keys(), ...(usd - sites >= 0.005 ? [OUTSIDE_WORDS.coins] : [])];
  return { total: cents(whole), outside: { usd, names } };
}

/** the copy review's B+ grade (8 Nov): one figure per name. Wherever "Safe" is said with a figure, it is Home's Safe figure (Private
 *  inside it, format.ts balanceTotal); Private is named as part of it. `own`: the Safe's own coins; `priv`: Private. */
export const safeRowFigure = (own: number, priv: number): number => cents(own + Math.max(0, priv));

/** The still row's words and Private's (the copy review's, 8 Nov). */
export const OUTSIDE_WORDS = {
  title: "Not moved",
  coins: "coins in your wallets",
  /** "pump.fun and GMGN wallets stay where they are." / "pump.fun wallet and coins in your wallets stay where they are." */
  line: (names: readonly string[]) => {
    const sites = names.filter((n) => n !== OUTSIDE_WORDS.coins), coins = names.includes(OUTSIDE_WORDS.coins);
    const siteWords = sites.length ? `${listed(sites)} ${sites.length === 1 ? "wallet" : "wallets"}` : "";
    const all = [siteWords, ...(coins ? [OUTSIDE_WORDS.coins] : [])].filter(Boolean);
    const one = all.length === 1 && sites.length === 1 && !coins;
    const said = all.join(" and ");
    return `${said[0] === "c" ? said[0].toUpperCase() + said.slice(1) : said} ${one ? "stays where it is" : "stay where they are"}.`;
  },
};
/** Under Private wherever it sits inside the Safe's total (the audit's MUST, the copy review's words, 8 Nov): counted in the total, never
 *  "part of your Safe": Private isn't guarded by the Safe's rules or its Face ID. A browser has no Face ID: nothing to
 *  approve there. */
export const privateOfLine = (phone: boolean = onPhone()): string => `Counted in your Safe's total. ${phone ? "No Face ID." : "Nothing to approve."}`;
function listed(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
