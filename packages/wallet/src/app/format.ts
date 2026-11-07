// What the Wallet screens show, worked out from the ledger's rows. Pure, so it's tested without a screen.
//
// One line per coin: listed rows with the same symbol are one line, whatever networks and places they sit in. A coin
// 1Click doesn't list is never part of a listed coin's line (anyone can name a coin "USDC"); it gets its own line, no
// logo, no dollars, and isn't counted in the total. NEAR staked through Earn (earn.positions) is part of NEAR's line
// and the total, marked earning; it's never a ledger balance, so nothing can spend it by mistake.
import { fromUnits, toUnits, usdOf } from "../amount.ts";
import type { Balance, Chain, Movement, PrivatePocket, Token } from "../types.ts";
import { ThisDevice } from "@zerofee/shell-api/approval-words.ts";
import { shortId } from "./money/send-words.ts";
import { SERVICE_NAMES } from "@zerofee/core/services";
import { NEAR_SWAP_HEAD } from "../near-swap-words.ts";

/** USDC on NEAR: Trading's own coin (ledger.ts TRADING_USDC), so its Adds read in dollars. */
const USDC_ON_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export interface Line {
  key: string;
  symbol: string;
  name: string;
  icon: string;
  amount: string;
  usd?: string;
  /** Every part of it came over a bridge. */
  bridged: boolean;
  /** Where it sits, in a few words: "On NEAR, Solana and Base", "From Bitcoin". */
  where: string;
  parts: Balance[];
  listed: boolean;
  /** NEAR with validators (Earn): counted in `amount`, `usd` and the total, never spendable from here. */
  earning: EarnPart[];
}

/** NEAR with one validator, from Earn. */
export interface EarnPart {
  poolId: string;
  name: string;
  amount: string;
  /** earning: staked; back: asked back, still waiting; ready: asked back and ready to bring home (in Earn). */
  state: "earning" | "back" | "ready";
  usd?: string;
}

/** What Earn says each validator holds (earn.positions), as parts of NEAR's line, priced like NEAR. */
export function earnParts(positions: { poolId: string; name: string; staked: string; unstaked: string; canWithdraw: boolean }[], nearPriceUsd?: string): EarnPart[] {
  const out: EarnPart[] = [];
  for (const p of positions) {
    const part = (amount: string, state: EarnPart["state"]) => {
      if (!/^\d+(\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) return;
      const usd = usdOf(amount, nearPriceUsd);
      out.push({ poolId: p.poolId, name: p.name, amount, state, ...(usd !== undefined ? { usd } : {}) });
    };
    part(p.staked, "earning");
    part(p.unstaked, p.canWithdraw ? "ready" : "back");
  }
  return out;
}

const sum = (amounts: string[], decimals: number): string => fromUnits(amounts.reduce((s, a) => s + (toUnits(a, decimals) ?? 0n), 0n), decimals);
const decimalsOf = (amounts: string[]) => Math.max(0, ...amounts.map((a) => (a.split(".")[1] ?? "").length));

export function chainName(chains: Chain[], id: string): string {
  return chains.find((c) => c.id === id)?.name ?? id.toUpperCase();
}

/** "NEAR, Solana and Base". */
export function andList(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where one row sits, as its own line on the coin page. */
export function placeOf(b: Balance, chains: Chain[]): string {
  if (b.held === "account") return "On your account";
  // the Private pocket's part (its screen is "Private balance"): never a second "On NEAR" beside the Safe's (crawl, 5 Nov)
  if (b.held === "private") return "In Private";
  return b.bridged ? `From ${chainName(chains, b.chain)}` : `On ${chainName(chains, b.chain)}`;
}

export function lines(rows: Balance[], chains: Chain[], earning: EarnPart[] = []): { lines: Line[]; totalUsd: string; uncounted: boolean } {
  const listed = new Map<string, Balance[]>();
  const out: Line[] = [];
  for (const r of rows) {
    if (r.listed !== false) listed.set(r.symbol, [...(listed.get(r.symbol) ?? []), r]);
  }
  if (earning.length && !listed.has("NEAR")) listed.set("NEAR", []);
  for (const [symbol, parts] of listed) {
    const sorted = [...parts].sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0));
    const staked = symbol === "NEAR" ? earning : [];
    const all = [...sorted.map((p) => p.amount), ...staked.map((e) => e.amount)];
    const amount = sum(all, decimalsOf(all));
    const priced = [...sorted, ...staked].filter((p) => p.usd !== undefined);
    const usd = priced.length ? sum(priced.map((p) => p.usd!), 2) : undefined;
    const bridged = sorted.length > 0 && sorted.every((p) => p.bridged);
    const names = [...new Set(sorted.map((p) => (p.held === "account" ? "NEAR" : chainName(chains, p.chain))))];
    const earningNow = staked.filter((e) => e.state === "earning").map((e) => e.amount);
    const marks = [...(names.length ? [`${bridged ? "From" : "On"} ${andList(names)}`] : []), ...(earningNow.length ? [`${coins(sum(earningNow, decimalsOf(earningNow)))} earning`] : [])];
    out.push({
      key: `listed:${symbol}`,
      symbol,
      name: sorted[0]?.name ?? "NEAR",
      icon: sorted[0]?.icon ?? "near",
      amount,
      usd: usd === undefined ? undefined : fixed2(usd),
      bridged,
      where: marks.length ? marks.join(" · ") : "Coming back from staking",
      parts: sorted,
      listed: true,
      earning: staked,
    });
  }
  const unlisted = rows.filter((r) => r.listed === false);
  for (const r of unlisted) {
    out.push({ key: `unlisted:${r.tokenId}:${r.held}`, symbol: r.symbol, name: r.name, icon: "", amount: r.amount, bridged: r.bridged, where: `${claimOf(r.symbol)} · not counted`, parts: [r], listed: false, earning: [] });
  }
  out.sort((a, b) => Number(a.listed === false) - Number(b.listed === false) || Number(b.usd ?? 0) - Number(a.usd ?? 0) || a.symbol.localeCompare(b.symbol));
  const total = sum(out.filter((l) => l.usd !== undefined).map((l) => l.usd!), 2);
  return { lines: out, totalUsd: fixed2(total), uncounted: out.some((l) => l.usd === undefined) };
}

/**
 * The network to show when another app opens Wallet's Receive for a coin: openApp("wallet", "receive", link), where link is
 * the coin (a tokenId or a symbol, e.g. "nep141:usdt.tether-token.near" or "USDT"), or "coin=<…>&chain=<id>". The first
 * network that receives it, in Add money's order; null when none does (Receive then opens as it always does).
 */
export function receiveChainFor(link: string | undefined, chains: Chain[], tokens: Map<string, Token>): string | null {
  if (!link?.trim()) return null;
  const q = link.includes("=") ? new URLSearchParams(link) : null;
  const coin = (q ? q.get("coin") : link)?.trim() ?? "";
  const asked = q?.get("chain")?.trim();
  if (!coin && !asked) return null;
  if (coin === "near" || coin.toUpperCase() === "NEAR") return chains.some((c) => c.id === "near") ? "near" : null;
  const symbol = tokens.get(coin)?.symbol ?? coin;
  const takes = (c: Chain) => !coin || c.coins.includes(coin) || c.coins.some((id) => tokens.get(id)?.symbol.toUpperCase() === symbol.toUpperCase());
  const found = chains.find((c) => (!asked || c.id === asked) && takes(c));
  return found?.id ?? null;
}

/** Hidden's words (D27, Security's design; D108: the pot is "Hidden"), verbatim wherever the pocket is explained. */
/** Hidden in one line; the rest one tap down (product decision, 2 Nov: one-liners). */
export const PRIVATE_WORDS = "A wallet for private payments, up to $10,000 each.";
export const PRIVATE_MORE = ["Future computers could break its key. Your Safe's key is built so they can't.", "Keep only small amounts in it.", "It pays when you hold the button. No Face ID."];
/** What Private hides and from whom (audit P-1, gates grade 5 Nov; the Copywriter): the public, not the money going in
 *  or coming out (a payout lands on a public chain, PRIVATE_HOW; this line stands alone on the fill's sheet and the first
 *  win), and not NEAR Intents' solver, which sees every payment. Never "private from everyone". */
export const PRIVATE_SEEN = "Private from the public, except the money going in and coming out. NEAR Intents sees every payment.";
/** What a Send through it hides, and what it doesn't (privacy audit, 4 Nov; D137: no wait between the steps): the middle
 *  is hidden, the step in and the step out are public and close in time, and money that sat there a while hides best. */
export const PRIVATE_HOW = ["Only the middle of a send is hidden.", "Anyone can see money go in and come out, close in time.", "Money that sits here a while is the most private."];

/** What's in Private, in dollars (its priced rows). */
/** What the old wallets' money is doing (security audit 4 Nov, finding 2): every state that is true at once, each in the
 *  Copywriter's words (batch 4). */
export function oldWalletsLine(o: { moving: boolean; stuck: boolean; left: boolean; unread?: true }): string {
  return [
    o.moving ? "Moving to your new wallets." : "",
    o.stuck ? (o.moving ? "Some of it didn't move yet." : "It didn't move yet.") : "",
    o.left ? "Too small for the swap service to move. It stays there." : "",
    o.unread ? "Not all of it loaded, so this total may be low." : "",
  ].filter(Boolean).join(" ");
}

/** Private's dollars with the money still in the old wallets (audit 2): never invisible while it moves. */
export const privateAllUsd = (p: { rows: Balance[]; oldWords?: { rows: Balance[] } }): string => plusUsd(privateUsd(p.rows), privateUsd(p.oldWords?.rows ?? []));
export const privateUsd = (rows: Balance[]): string => fixed2(sum(rows.filter((r) => r.usd !== undefined && r.usd !== null).map((r) => String(r.usd)), 2));
/** Private's one figure (QA's test, MUST 3: Move said $33.86, a site's Add "$25.00 available", Send "$8.85"):
 *  every screen that says what Private holds reads it here, Home's Safe counting the same rows (safeLines). A screen that
 *  can pay only a part of it (a site's Add pays in USDC; Send pays one coin) says that part in its own line. Null: Private
 *  not read yet, or not set up on this phone. */
export const privateFigure = (pocket: Pick<PrivatePocket, "available" | "ready" | "rows"> | null | undefined): string | null => (pocket?.available && pocket.ready ? privateUsd(pocket.rows) : null);
/** Two dollar amounts added, to the cent. */
export const plusUsd = (a: string, b: string): string => fixed2(sum([a, b], 2));

/** The Safe's coins as every screen shows them (one source, the grade of 3 Nov: Details said 324.9 NEAR where Home said
 *  326.9): its own coins and, until the engine folds the pocket in, the pocket's (D128), counted under the Safe. */
export function safeLines(rows: Balance[], pocket: PrivatePocket | null, chains: Chain[], earning: EarnPart[] = []): ReturnType<typeof lines> {
  return lines([...rows, ...(pocket?.available ? pocket.rows : [])], chains, earning);
}

/**
 * One Safe coin, one figure, on every screen (product decision, 5 Nov; QA re-check, item 9: the Safe's USDC read
 * 1,290.60 on Home, 1,225.50 on Swap, 10 on Send; its NEAR 326.9 on Home, 2 on Send). The one selector, Home's own line
 * (lines(): every listed row of that symbol wherever the Safe holds it: NEAR Intents, the account itself, bridged from
 * another chain, Private under it (D128), NEAR's validators in NEAR's). Home, Send, Swap and the coin page read it. What a
 * flow can pay of it now is that flow's Max (Send's max, Swap's most, Sell's held), said in one quiet line when it is less,
 * never a second figure for the coin. Null: none held. A test row (worth nothing) is never counted.
 */
export function safeHeld(rows: readonly HeldPart[] | null | undefined, symbol: string, earning: readonly EarnPart[] = []): { amount: string; usd: string } | null {
  const mine = (rows ?? []).filter((b) => b.symbol === symbol && b.listed !== false && !b.test && Number(b.amount) > 0);
  const staked = symbol === "NEAR" ? earning.filter((e) => Number(e.amount) > 0) : [];
  if (!mine.length && !staked.length) return null;
  const all = [...mine.map((b) => b.amount), ...staked.map((e) => e.amount)];
  return { amount: sum(all, decimalsOf(all)), usd: fixed2(sum([...mine, ...staked].map((b) => b.usd ?? "0"), 2)) };
}
/** A Safe row as safeHeld reads it (a Balance, or the coin page's ledger.balances row). */
export type HeldPart = { tokenId: string; symbol?: string | undefined; amount: string; usd?: string | undefined; listed?: boolean | undefined; test?: boolean | undefined };

/**
 * The one total every app shows for "my money": each priced coin once (NEAR with validators counted in NEAR's line),
 * Private as a row of it when this phone can use it, and Spending (D52, spending.status's one number) when given.
 * Without Spending it is the Safe's figure.
 */
export function balanceTotal(balances: Balance[], chains: Chain[], earning: EarnPart[], pocket: PrivatePocket | null, spendingUsd?: string | null): string {
  const { totalUsd } = lines(balances, chains, earning);
  const withPrivate = pocket?.available ? plusUsd(totalUsd, privateAllUsd(pocket)) : totalUsd;
  return spendingUsd && /^\d+(\.\d+)?$/.test(spendingUsd) ? plusUsd(withPrivate, spendingUsd) : withPrivate;
}

/**
 * When Balance paints and when its figure is final (UI's robot pass F8: nothing to tap for 3 s). `settled`: the coins
 * have answered (balances, networks, prices) and the figure shows; Earn, Private and Trade are never waited for.
 * `complete`: every part is in; until then the figure says "Updating…", since a part may still join it.
 */
export function paintState(read: { balances: boolean; tokens: boolean; chains: boolean; positions: boolean; trading: boolean; pocket: boolean }): { settled: boolean; complete: boolean } {
  const settled = read.balances && read.tokens && read.chains;
  return { settled, complete: settled && read.positions && read.trading && read.pocket };
}

/** Add money's first networks: the one last used, then NEAR, Solana and Base, three in all ("More networks" has the rest). */
export function topNetworks(chains: Chain[], current: string | null): Chain[] {
  const ids = [...new Set([...(current ? [current] : []), "near", "sol", "base"])];
  return ids.map((id) => chains.find((c) => c.id === id)).filter((c): c is Chain => !!c).slice(0, 3);
}

/** The coins a network credits, in words: "ETH, USDC and USDT", or the first three "and 4 more". */
/**
 * Receive's lines under the address. For one coin the person came for (Pay's "Take money out", an amount asked for),
 * one sentence names it, "Send USDC here.", or none when the first line already did: never the other networks the
 * address works on, nor the network's other coins (UI's robot pass 4: jargon that invites the wrong network).
 */
export function receiveExtras(o: { coin?: string; said?: boolean; sharing: string[]; taken: string[] }): string[] {
  if (o.coin) return o.said ? [] : [`Send ${o.coin} here.`];
  const names = [...new Set(o.sharing)];
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return [...(names.length > 1 ? [`This same address works on ${list}.`] : []), ...(o.taken.length > 0 ? [`It takes ${coinsTaken(o.taken)}.`] : [])];
}

/** The coins people know, named first; a long list names only those, then a count (UX walk 2 Nov: "NEAR, USDC,
 *  BLACKDRAGON and 20 more" put an odd coin up front). */
const WELL_KNOWN = ["NEAR", "USDC", "USDT", "SOL", "ETH", "BTC"];
export function coinsTaken(symbols: string[]): string {
  const s = [...new Set(symbols)];
  if (s.length <= 3) return s.length < 2 ? s.join("") : `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}`;
  const known = WELL_KNOWN.filter((k) => s.includes(k)).slice(0, 2);
  const first = known.length ? known : s.slice(0, 2);
  return `${first.join(", ")} and ${s.length - first.length} more coins`;
}

/**
 * A bridge minimum to say aloud: at most 6 significant digits, rounded UP (never below the real minimum), as plain
 * decimal text (never scientific notation, never trailing zeros). "0.00123456789" gives "0.00123457".
 */
export function roundedMinimum(amount: string): string {
  const [w = "0", f = ""] = amount.split(".");
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f)) return amount;
  const scale = f.length;
  let full = BigInt(w + f);
  const drop = full.toString().length - 6;
  if (drop > 0) {
    const cut = 10n ** BigInt(drop);
    full = (full / cut + (full % cut > 0n ? 1n : 0n)) * cut;
  }
  return fromUnits(full, scale);
}

/**
 * Receive's "Send at least …" line: none when the minimum is worth under a cent (a 1-wei bridge minimum), else the
 * coin amount to 6 significant digits plus "(about $X.XX)" when a price is known.
 */
export function minimumLine(o: { amount: string; symbol: string; usd?: string }): string | null {
  if (o.usd !== undefined && Number(o.usd) < 0.01) return null;
  // No price: a minimum under a billionth of a coin is a bridge placeholder (1 wei), never worth a line.
  if (o.usd === undefined && Number(o.amount) < 1e-9) return null;
  return `Send at least ${roundedMinimum(o.amount)} ${o.symbol}${o.usd !== undefined ? ` (about $${Number(o.usd).toFixed(2)})` : ""}.`;
}

const fixed2 = (s: string) => {
  const [w, f = ""] = s.split(".");
  return `${w}.${f.padEnd(2, "0").slice(0, 2)}`;
};

const groupWhole = (w: string) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "$1,300.60". */
export function dollars(usd: string): string {
  const [w, f = "00"] = fixed2(usd).split(".");
  return `$${groupWhole(w)}.${f}`;
}

/** Coins people count in cents: shown with two decimals at least ("1,360.60 USDC"). */
const CENTS = new Set(["USDC", "USDT", "USDT0", "USDG", "USDe", "DAI", "xDAI", "EURe", "GBPe", "USD1", "PYUSD", "FDUSD"]);

/** How many decimals a coin always shows (trailing zeros kept). */
export const minDecimals = (symbol: string) => (CENTS.has(symbol) ? 2 : 0);

/** A coin amount for reading: thousands grouped, at least `min` and at most `max` decimals (cut, never rounded up). */
export function coins(amount: string, max = 6, min = 0): string {
  const [w, f = ""] = amount.split(".");
  const cut = f.slice(0, max).replace(/0+$/, "").padEnd(min, "0");
  if (w === "0" && !/[1-9]/.test(f.slice(0, max)) && /[1-9]/.test(f)) return `< 0.${"0".repeat(max - 1)}1`;
  return cut ? `${groupWhole(w)}.${cut}` : groupWhole(w);
}

/**
 * How many decimals a coin amount is read at (robot pass 10: "1,360.092631 USDC" on a Wallet row): a dollar-pegged
 * coin to the cent; any other coin to 4 significant decimals ("4.8213 SOL", "0.000123 BTC"); never more than the coin's
 * own decimals (`own`, when known).
 */
export function readDecimals(amount: string, symbol: string, own?: number): number {
  const f = amount.split(".")[1] ?? "";
  const lead = f.search(/[1-9]/);
  const want = CENTS.has(symbol) ? 2 : /^0*$/.test(amount.split(".")[0] ?? "") && lead >= 0 ? lead + 4 : 4;
  return own !== undefined && own >= 0 ? Math.min(want, own) : want;
}

/**
 * A coin amount for reading on Wallet's rows and in Activity, thousands grouped, cut (never rounded up), trailing zeros
 * trimmed: "1,360.09" for USDC, "4.8213" for SOL. Cents coins keep two decimals ("60.00") unless `min` says otherwise.
 * Where a person must copy an exact amount (Send's field, Receive's request), `exactOf` shows every decimal.
 */
export const amountOf = (amount: string, symbol: string, own?: number, min = minDecimals(symbol)) => coins(amount, readDecimals(amount, symbol, own), min);

/** Every decimal the amount has, grouped: for an amount a person copies (Receive's request). */
export const exactOf = (amount: string, symbol: string) => coins(amount, (amount.split(".")[1] ?? "").length, minDecimals(symbol));

/** How a coin is named in a heading. An unlisted coin's symbol is only its own claim, so it's never a heading. */
export const titleOf = (l: { listed: boolean; name: string; symbol: string }) => (l.listed ? l.name : "Unlisted coin");
export const claimOf = (symbol: string) => `Calls itself "${symbol}"`;

/** the copy review's words for ended rows (7 Nov). */
export const ACTIVITY_WORDS = {
  /** The Safe's top-up of Private (a move into Private, kind "private"). */
  intoPrivate: "Into Private from your Safe.",
  /** A leg paid from Private (a payment to the person's own wallet). */
  fromPrivate: "From Private.",
  /** A Send that came back (provisional, for 53): where it is now, by the leg's own record (whereNow). */
  cameBack: (place: string) => `Came back to ${place}.`,
} as const;

/** "now", "5 min", "3 h", "Yesterday", then the date. */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 2 * 86400) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A long address, shortened for a list in the core sheet's form (the copy review's ruling, 5 Nov: 6+6 everywhere; shortId):
 *  "7xKXtg…cYgAsU". Full addresses are always shown where they are copied. */
export function short(address: string): string {
  return address.length > 16 ? shortId(address) : address;
}

/**
 * A payee in words (Alpha metric 4): a name stays a name ("kiosk.near"); an address is itself, short, network named or
 * not (send-words.ts shortId: "0x5290aB…679EE7"; the copy review's ruling, 5 Nov: never "a Solana wallet", in job steps, Send's lines
 * and Activity alike).
 */
export function payeeWords(to: string): string {
  const [who, network] = split(to);
  if (!isAddress(who)) return network ? `${who} on ${network}` : who;
  // the address short, as Send's To box shows it ("0x5290aB…679EE7"; the copy review's rulings, 5 Nov), never "the address you gave",
  // never "a Solana wallet"
  return shortId(who);
}

/** A payee as the whole object of a chat sentence (AgentZero's answers only; the copy review's ruling, 5 Nov): an address on a network
 *  is its kind plus its short form, "a Solana wallet (0x5290aB…679EE7)"; a name stays a name; no network, the short address.
 *  Rows and receipts keep payeeWords (the bare short address). */
export function payeeInSentence(to: string): string {
  const [who, network] = split(to);
  if (!isAddress(who) || !network) return payeeWords(to);
  return `${/^[aeiou]/i.test(network) ? "an" : "a"} ${network} wallet (${shortId(who)})`;
}

/** A record's payee as [who, network]: "X on Solana" is ["X", "Solana"]; "X" is ["X", ""]. */
const split = (to: string): [string, string] => { const at = to.indexOf(" on "); return at < 0 ? [to.trim(), ""] : [to.slice(0, at).trim(), to.slice(at + 4).trim()]; };
/** An address as a key: a hex one matched in any case. */
const addrKey = (a: string) => (/^0x/i.test(a) ? a.toLowerCase() : a);

/** An address rather than a name: hex, or a long run of letters and digits with no dot (base58, or a NEAR account with no
 *  name, 64 hex: never its whole id on a row, mainnet rehearsal 3 Nov). */
const isAddress = (who: string): boolean => /^0x[0-9a-f]{6,}$/i.test(who) || (who.length >= 26 && !who.includes(".") && /^[0-9A-Za-z]+$/.test(who));

/** Who a move went to, as the person's own record keeps it: the name or the full address, without " on <network>". */
export const payeeOf = (m: Pick<Movement, "to">): string => split(m.to ?? "")[0];

/** Each row's word, and its network's name as a record writes it ("… on Solana"), for a move into the person's own row. */
const ROW_WORD: Record<string, [string, string]> = { sol: ["SOL", "Solana"], hood: ["ETH (RH)", "Robinhood Chain"], bsc: ["BNB", "BNB Chain"] };
/** The person's own rows by address (Spending's wallets: each network's wallet, and an older one), as [word, network].
 *  Read on this phone from what it already lists; nothing is asked. */
export type OwnRows = ReadonlyMap<string, readonly [string, string][]>;
export function ownRows(wallets: readonly { role: string; network: string; address: string }[] | null | undefined): OwnRows {
  const own = new Map<string, [string, string][]>();
  for (const w of wallets ?? []) {
    const row = ROW_WORD[w.network], k = addrKey(w.address ?? "");
    if (row && k && (w.role === "chain" || w.role === "older") && !own.get(k)?.includes(row)) own.set(k, [...(own.get(k) ?? []), row]);
  }
  return own;
}
/** "your SOL row" when a move went to one of the person's own rows; undefined otherwise. A record that names a network
 *  must name that row's ("X on Base" is never the BNB row, even at the same address); one that names none must match one
 *  row only (an address two rows share says neither), and only for a Hidden payment, whose coin the ledger checked is on
 *  the payee's own chain (a plain send always records " on <network>"; review L1: the same key on Ethereum is no row). */
export function ownRowOf(m: Pick<Movement, "to" | "private">, own: OwnRows | undefined): string | undefined {
  const [who, network] = split(m.to ?? "");
  const rows = who && own && (network || m.private) ? (own.get(addrKey(who)) ?? []).filter((r) => !network || r[1] === network) : [];
  return rows.length === 1 ? `your ${rows[0]![0]} wallet` : undefined;
}

/**
 * Where a Send's money LEFT (the audit's MUST, 7 Nov: the Safe sent $30.00 and Private paid bob.near $25.00, yet the row said
 * "From Private" while the job said "Leaving your Safe"): ONE rule for Activity's row (describe), the row's page and the
 * statement (statement.ts ledgerRow's From) and the job (live-steps sendTrack). A wallet's Send (hidden-row:) its wallet
 * (its coin as send-to.ts LANDS_AS names it); the Safe's Send that NEAR Confidential pays out (safe-send:) the Safe;
 * Private's own payment (pocket-send:, a payment from Private's balance: private-pay.ts pay:) Private; else the Safe.
 * `private` alone says it went through NEAR Confidential, never where it left. Pure: a table test.
 */
export const sendFrom = (m: Pick<Movement, "id" | "from" | "private">, f = m.from ?? ""): string => {
  const k = m.id.split(":")[0]!;
  if (k === "hidden-row") return /(sol|hood)[.-][0-9a-z]*\.?omft/.exec(f)?.[1] ?? (f.includes(":56_") ? "bsc" : "row");
  // the audit's M1 (7 Nov): a private record's place is its id's, from this table only; one it doesn't name says no place ("")
  return (m.private || k !== "pay") && SEND_FROM[k] ? SEND_FROM[k]! : f === "private" ? "private" : m.private ? "" : "safe";
};
/** Each id a private payment record is written with (safe-send.ts, hidden-row.ts, private-pay.ts, the Sim's MockBridge),
 *  and the place its money left: never a guess from `private` (the audit's M1, 7 Nov; send-from-truth.test.ts scans the writers). */
export const SEND_FROM: Record<string, string> = { "safe-send": "safe", "pocket-send": "private", pay: "private" };

/** Problems after which it may or may not have gone: the balance tells. */
const UNCONFIRMED = new Set(["ledger.send.unread", "ledger.hold.unknown"]);

/** Where money that came in landed, by the wallet's name (D124). */
const INTO_WORDS: Record<NonNullable<Movement["into"]>, string> = { safe: "Safe", sol: "SOL wallet", hood: "ETH (RH) wallet", near: "NEAR wallet", bsc: "BNB wallet" };

/**
 * Where the money is now, in plain words (Alpha metric 4): the last part of every Activity row. Never a promise the
 * ledger can't keep: "check your balance" when it can't see.
 */
export function whereNow(m: Movement, to: string): string {
  if (m.status === "waiting") return "nothing has moved yet";
  // Out of Private: a refund goes back to Private.
  if (m.kind === "private" && m.from === "private") return m.status === "moving" ? "on its way to your Safe" : m.status === "done" ? "in your Safe" : "still in Private";
  // S5: a payment from the private balance comes back there (its refund address, core private-pocket.ts), never the Safe
  if (m.status === "refunded") return m.kind === "trading" || (m.kind === "swap" && m.source === "private") ? "back in your NEAR wallet" : m.private && (m.kind === "pay" || m.kind === "transfer" || m.kind === "withdraw") ? "back in Private" : "back in your Safe";
  if (m.status === "problem" && UNCONFIRMED.has(m.problem?.code ?? "")) return "check your Safe";
  // a NEAR wallet swap: its own end, never the swap case's "still in your private balance" (audit, 6 Nov: that could be untrue)
  if (m.status === "problem" && (m.problem?.code === "ledger.swap.near-unread" || m.problem?.code === "ledger.swap.near-failed")) return "check your NEAR wallet";
  // the same end on a job kept before these words: it holds the old problem, and the row must not say where the money is
  if (m.status === "problem" && m.kind === "swap" && m.source === "private" && m.problem?.code === "ledger.convert.failed") return "check your NEAR wallet";
  // 1Click's FAILED: where to look, never where it is (audit, 6 Nov)
  if (m.status === "problem" && m.problem?.code === "ledger.convert.failed") return m.private || m.kind === "private" ? "check Private" : "check your Safe";
  if (m.status === "problem" && m.problem?.code === "ledger.topup.failed") return "check your NEAR wallet";
  if (m.status === "problem" && m.problem?.code === "ledger.transfer.part-returned") return "the rest is back in your Safe";
  if (m.kind === "trading" && m.from === "trading") return m.status === "moving" ? "on its way to your Safe" : m.status === "done" ? "in your Safe" : "still in your NEAR wallet";
  switch (m.kind) {
    case "deposit":
      // money that came in through an Add lands where it was asked for (received.ts): that wallet, by its name
      if (m.into && m.into !== "safe" && m.status === "done") return `in your ${INTO_WORDS[m.into]}`;
      return m.status === "moving" ? "on its way to your Safe" : m.status === "problem" ? "not in your Safe" : "in your Safe";
    case "private":
      return m.status === "moving" ? "on its way to Private" : m.status === "done" ? "in Private" : "still in your Safe";
    case "trading":
      // Always one of three places: the main balance, in flight, or Spending (a refund comes back to Spending).
      return m.status === "moving" ? "on its way to your NEAR wallet" : m.status === "done" ? "in your NEAR wallet" : "still in your Safe";
    // a swap in place (ledger.swap, kind "swap") is a conversion: its `to` is the coin's id, never a payee (Sim crawl
    // cut 7: "with nep141:zec.omft.near"); one in the NEAR wallet stays in the NEAR wallet (source "private" is its float, the copy review's ruling, 6 Nov)
    case "swap":
      if (m.source === "private") return m.status === "moving" ? `with ${SERVICE_NAMES.oneclick}, converting` : m.status === "done" ? "in your NEAR wallet" : "still in your NEAR wallet";
    // falls through: the Safe's
    case "convert":
      return m.status === "moving" ? `with ${SERVICE_NAMES.oneclick}, converting` : m.status === "done" ? "in your Safe" : `with ${SERVICE_NAMES.oneclick}`;
    default:
      // a record with no payee (never a bare "to"): where it is, without a name. A payee is "to" (the copy review's ruling, 5 Nov);
      // "with" is only a swap's partner
      return m.status === "moving" ? (to ? `on its way to ${to}` : "on its way") : m.status === "done" ? (to ? `to ${to}` : "") : "still in your Safe";
  }
}

/** An activity row, in plain words. A label is the asking app's text: shown as text, never as a checked name. */
/**
 * A row's dollars, first on the right of Wallet's Activity (grade 02h, H9: "Sent · 0.01 NEAR" with no $): the coin
 * amount at the coin list's price (NEAR at the core's one snapshot, H1), to the cent as the sheet rounds. None for a step
 * that moved no money, a Top up or Put away whose title already says its dollars, or a coin with no price.
 */
export function movementDollars(m: Movement, tokens: Map<string, Token>): string | null {
  if (m.kind === "account" || !m.amount) return null;
  if (m.kind === "trading" && (m.from === "trading" || m.from === USDC_ON_NEAR)) return null;
  const native = m.from === "near" || m.to === "near";
  const id = native ? "nep141:wrap.near" : m.kind === "deposit" || m.from === "trading" || m.from === "private" ? m.to ?? "" : m.from ?? "";
  const usd = usdOf(m.amount, tokens.get(id)?.priceUsd, true);
  if (usd === undefined || !(Number(m.amount) > 0)) return null;
  return Number(usd) < 0.01 ? "under $0.01" : dollars(usd);
}

/** A site wallet's Take out, by the site's name (crawl F6; one word for the move: Take out). */
export const siteOutTitle = (_status: Movement["status"], usd: string, site: string): string => `Take out ${usd} from your ${site} wallet`;
export function describe(m: Movement, tokens: Map<string, Token>, chains: Chain[], rows?: OwnRows): { title: string; detail: string } {
  const intoTo = m.kind === "deposit" || m.from === "trading" || m.from === "private" || m.from === "oldWords";
  const symbol = m.from === "near" || m.to === "near" ? "NEAR" : tokens.get(intoTo ? m.to ?? "" : m.from ?? "")?.symbol ?? "";
  // Trading's moves (the Add, the Take out) are dollars of USDC: in cents everywhere on the row ("14.47 USDC"), never
  // the 6 decimals a Take out lands with.
  const own = tokens.get(intoTo ? m.to ?? "" : m.from ?? "")?.decimals;
  // An Add paid in another coin than USDC (converted inside it) is in that coin.
  const dollarsOfUsdc = m.kind === "trading" && (m.from === "trading" || m.from === USDC_ON_NEAR);
  const amount = `${dollarsOfUsdc ? coins(m.amount, 2, 2) : amountOf(m.amount, symbol, symbol === "NEAR" ? 24 : own, 0)} ${symbol}`.trim();
  const to = m.to ? payeeWords(m.to) : "";
  const where = whereNow(m, to);
  // a row's figure is its dollars, said once, in the right column (movementDollars); its line never leads with the raw
  // coin ("200 USDC · …", the Activity walk, 6 Nov, item 5); the coin only where there is no price
  const coin = movementDollars(m, tokens) ? "" : amount;
  // where the money LEFT (sendFrom, the one rule the page and the job read too; the audit's MUST, 7 Nov), only on a Send through
  // NEAR Confidential: "From your Safe" for the Safe's Send, "From Private" for Private's own, never m.private's guess
  // (the copy review's "From Private." for a leg Private paid; "your Safe", "your SOL wallet": INTO_WORDS, the wallets' one name)
  const left = sendFrom(m), at = left === "private" ? "Private" : `your ${INTO_WORDS[left as "safe"] ?? "wallet"}`;
  const fromPlace = (w: string) => (m.private && left ? (w ? `${w} from ${at}` : `From ${at}`) : w);
  // A step from the account's record that moved no money (a rules change, a key): its own words, and which key signed,
  // as Security's Activity says it (grade 02f, item 4: one Activity, the same rows in both).
  if (m.kind === "account") {
    const by = m.by && m.by !== "Set-up" ? `by ${(m.by === "This phone" ? ThisDevice() : m.by).replace(/^./, (c) => c.toLowerCase())}` : "";
    return { title: m.label ?? "Your account", detail: [by, m.status === "problem" ? "didn't go through (only the fee was used)" : ""].filter(Boolean).join(" · ") };
  }
  if (m.status === "waiting") {
    const what = m.kind === "convert" ? `${amount} to ${tokens.get(m.to ?? "")?.symbol ?? ""}`.trim() : `${amount} to ${to}`;
    return { title: m.label ? `On hold · ${m.label}` : "On hold", detail: `${what} · ${where}` };
  }
  switch (m.kind) {
    case "deposit":
      // the money that opened the account says so; an Add says what the swaps kept on the way
      // what opening kept is spent (storage, fees), never "kept open"; at most 4 decimals (Copywriter, finding 10)
      if (m.opened) return { title: "Received", detail: m.openKept ? `${amount} · ${coins(m.openKept, 4)} NEAR of it paid to open your account` : `${amount} · opened your account` };
      return { title: m.status === "moving" ? "On its way" : m.status === "problem" ? "Didn't arrive" : "Received", detail: [m.from ? `${amount} from ${chainName(chains, m.from)}` : amount, where, ...(m.feeUsd && Number(m.feeUsd) >= 0.01 ? [`$${m.feeUsd} in fees`] : [])].join(" · ") };
    case "withdraw":
    case "transfer":
    case "pay": {
      // The status decides the word: "Sent" or "Paid" only once it's done.
      // Wallet's Send is "Sent" on its screen, here and in Security's log (grade 01d Q1); "Paid" is Pay's.
      const word = m.status === "done" ? (m.kind === "pay" && m.caller !== "wallet" ? "Paid" : "Sent") : m.status === "moving" ? "Sending" : m.status === "refunded" ? "Came back" : UNCONFIRMED.has(m.problem?.code ?? "") ? "Unconfirmed" : m.problem?.code === "ledger.transfer.part-returned" ? "Some came back" : "Not sent";
      // into the person's own row (a Swap from Hidden lands there): a move between their own places, never a payment
      const mine = ownRowOf(m, rows);
      // a leg paid from Private, ended (the copy review's words, 7 Nov): "From Private."
      if (mine && (m.status === "done" || m.status === "moving")) return { title: `${m.status === "done" ? "Moved" : "Moving"} to ${mine}`, detail: m.status === "done" && m.private && left && !coin ? `${fromPlace("")}.` : [fromPlace(coin), m.status === "moving" ? `on its way to ${mine}` : ""].filter(Boolean).join(" · ") };
      return { title: m.label ? `${word} · ${m.label}` : word, detail: [fromPlace(coin), where].filter(Boolean).join(" · ") };
    }
    case "private": {
      // Security audit 4 Nov, finding 2: the core's move from the old wallets (replaced backup words) into the new ones.
      if (m.from === "oldWords") {
        const what = m.usd && /^\d+(\.\d+)?$/.test(m.usd) ? dollars(m.usd) : amount;
        const into = m.into === "near" ? "your NEAR wallet" : "Private";
        return { title: `${m.status === "done" ? "Moved" : "Moving"} ${what} from your old wallets to ${into}`, detail: amount };
      }
      if (m.from === "private") {
        const title = m.status === "done" ? "Moved out of Private" : m.status === "moving" ? "Moving out of Private" : m.status === "refunded" ? "Came back to Private" : "Not moved";
        return { title, detail: [coin, where].filter(Boolean).join(" · ") };
      }
      // The move into Private (D27): visible on chain, which Activity says plainly.
      const title = m.status === "done" ? "Moved to Private" : m.status === "moving" ? "Moving to Private" : m.status === "refunded" ? "Came back" : "Not moved";
      // the title says where it went: the line never says it again ("in Private" under "Moved to Private")
      // the copy review's words (7 Nov): where it came from, plainly; never "anyone can see this move"
      return { title, detail: [coin, m.status === "done" ? "" : where, ACTIVITY_WORDS.intoPrivate].filter(Boolean).join(" · ") };
    }
    case "trading": {
      // Top up (ledger.toTrading) and Put away (D52): dollars of USDC, to the cent ("$14.47"), cut as Balance counts it.
      const usd = !dollarsOfUsdc ? amount : /^\d+(\.\d+)?$/.test(m.amount) ? dollars(m.amount) : `$${coins(m.amount, 2, 2)}`;
      // crawl F6: a site wallet's Take out on its last leg home names the site, never "Put away … from NEAR wallet"
      if (m.from === "trading" && m.site) return { title: siteOutTitle(m.status, usd, m.site), detail: `${amount} · ${where}` };
      if (m.from === "trading") return { title: m.status === "done" ? `Put away ${usd}` : m.status === "moving" ? `Putting away ${usd}` : "Not put away", detail: `${amount} · ${where}` };
      const title = m.status === "done" ? `Moved ${usd} to your NEAR wallet` : m.status === "moving" ? `Moving ${usd} to your NEAR wallet` : m.status === "refunded" ? "Came back to your NEAR wallet" : "Didn't move";
      return { title, detail: `${amount} · ${where}` };
    }
    case "swap":
    case "convert": {
      // a swap in place (kind "swap", ledger.swap) reads as a conversion
      const into = tokens.get(m.to ?? "")?.symbol;
      const title = m.status === "moving" ? "Converting" : m.status === "refunded" ? "Refunded" : m.status === "problem" ? (m.kind === "swap" ? NEAR_SWAP_HEAD : "Not converted") : "Converted";
      return { title, detail: `${into ? `${amount} to ${into}` : amount} · ${where}` };
    }
  }
}

/**
 * Private as this account may see it: a child's account (account.state's `kid`, the core's word, D30) has none, so
 * nothing offers it: no row on Balance, no step in the set-up journey, no "Add to Private".
 */
export function forChild(pocket: PrivatePocket, kid: boolean): PrivatePocket {
  return kid ? { available: false, ready: false, rows: [], defaultOn: false } : pocket;
}

/**
 * The money sheet's top line, in Home's words (D128, D129; home/words 3 Nov): the Safe (the private pocket's money counted
 * under it, as Home counts it, until the engine folds it in), then the wallets together ("updating…" while a part of them
 * isn't read, never a figure short by it). Never "Hidden", "Trading" or "Spending". The same figures as Home's.
 */
export function homePots(o: { safeUsd: string | null; pocket: PrivatePocket | null; trading: string | null; tradingPartial: boolean; spending: boolean }): { name: string; usd: string | null }[] {
  const hidden = o.pocket?.available ? privateAllUsd(o.pocket) : "0.00";
  return [
    { name: "Safe", usd: o.safeUsd === null ? null : dollars(plusUsd(o.safeUsd, hidden)) },
    ...(o.spending ? [{ name: "Wallets", usd: o.trading !== null && !o.tradingPartial ? dollars(o.trading) : "updating…" }] : []),
  ];
}
