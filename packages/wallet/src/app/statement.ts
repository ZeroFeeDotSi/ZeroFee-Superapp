// H-3, the statement: every move Activity shows for one month, as a CSV file the person keeps (master plan Part 1 §1).
// Built on this phone from what Activity already reads (ledger.activity, spending.activity, merged as Activity merges
// them); a Hidden row comes only from what this phone recorded. The file leaves the phone only by the person's own share
// (the iPhone's share sheet, device.shareFile) or, in a browser, their own download. Nothing is sent by ZeroFee.
// "Dollars" is filled only where the move was in dollars when it happened (a dollar coin, or Trading's own dollars),
// never priced from today's price; there is no fee column, because no record here carries the fee.
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Chain, Movement, Token } from "../types.ts";
import { chainName, describe, ownRowOf, type OwnRows } from "./format.ts";
import { shortId } from "./money/send-words.ts";
import { activityRows } from "./activity-rows.ts";
import { unfoldLegs } from "@zerofee/core/spending-fold";
import { isUsdStable } from "@zerofee/pay/tokens";

export interface StatementRow {
  /** The phone's own time: "2026-11-03 14:05". */
  date: string;
  /** Activity's own words for it ("Sent", "Received", "Topped up $25.00"). */
  type: string;
  details: string;
  coin: string;
  /** The coin amount exactly as recorded (every decimal). */
  amount: string;
  /** Dollars at the time, "25.00", or "" when the move wasn't in dollars. */
  dollars: string;
  from: string;
  /** The full address or name (never shortened: this is the person's record). */
  to: string;
  hidden: "yes" | "no";
  status: string;
  link: string;
  /** Money in (+1), out (−1), or between the person's own places (0): for the summary only. */
  way: 1 | -1 | 0;
}

export const COLUMNS = ["Date (this phone's time)", "Type", "Details", "Coin", "Amount", "Dollars", "From", "To", "Private", "Status", "Link"] as const;

const two = (n: number) => String(n).padStart(2, "0");
const localTime = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const cents = (x: string) => (/^\d+(\.\d+)?$/.test(x) ? Number(x).toFixed(2) : "");
const STATUS: Record<Movement["status"], string> = { done: "Done", moving: "On its way", waiting: "On hold", refunded: "Came back", problem: "Didn't go through" };

/** A month in the phone's own time: from its first day at 00:00 to the next month's. */
export function monthBounds(year: number, month: number): { from: number; to: number } {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

/** The coin a movement moved, as its Activity row names it (format.ts describe's own rule; kept here so Home's first
 *  load doesn't carry it); "" when not known. */
const movementSymbol = (m: Movement, tokens: Map<string, Token>): string =>
  m.from === "near" || m.to === "near" ? "NEAR" : tokens.get(m.kind === "deposit" || m.from === "trading" || m.from === "private" ? m.to ?? "" : m.from ?? "")?.symbol ?? "";

/** One Activity move as a statement row (null: it moved no money). H-2 (AgentZero's "Ask your money") reads the same rows. */
export function ledgerRow(m: Movement, tokens: Map<string, Token>, chains: Chain[], mine?: OwnRows): StatementRow | null {
  if (m.kind === "account" || !m.amount) return null; // a rules change or a key moved no money
  const { title, details } = (({ title, detail }) => ({ title, details: detail }))(describe(m, tokens, chains, mine));
  const coin = movementSymbol(m, tokens);
  const hidden = m.private === true || m.kind === "private" || m.id.startsWith("hidden-row:");
  const own = m.private ? "Private balance" : m.kind === "swap" && m.source === "private" ? "NEAR wallet" : "Safe";
  let from = own, to = "", way: StatementRow["way"] = 0;
  if (m.kind === "deposit") { from = m.from ? chainName(chains, m.from) : ""; to = m.into && m.into !== "safe" ? WALLET[m.into]! : "Safe"; way = 1; }
  // a send or pay into the person's own row (a Swap from Hidden) moved money between their own places: not "went out"
  else if ((m.kind === "withdraw" || m.kind === "transfer" || m.kind === "pay") && ownRowOf(m, mine)) to = `${ownRowOf(m, mine)!.replace(/^y/, "Y")} (${m.to})`; // where it went, whole (review L3)
  else if (m.kind === "withdraw" || m.kind === "transfer" || m.kind === "pay") { to = m.to ?? ""; way = -1; }
  else if (m.kind === "private") [from, to] = m.from === "private" ? ["Private balance", "Safe"] : m.from === "oldWords" ? ["Old wallets", m.into === "near" ? "NEAR wallet" : "Private balance"] : ["Safe", "Private balance"];
  // crawl F6: a site wallet's Take out came from that wallet, never "From NEAR wallet"
  else if (m.kind === "trading") [from, to] = m.from === "trading" ? [m.site ? `Your ${m.site} wallet` : "NEAR wallet", "Safe"] : ["Safe", "NEAR wallet"];
  else if (m.kind === "convert") to = `Safe, as ${tokens.get(m.to ?? "")?.symbol ?? "another coin"}`;
  return {
    date: localTime(m.updatedAtIso), type: title, details, coin, amount: m.amount,
    // money that came in carries its dollars from when it landed (received.ts), so "came in" counts every coin
    dollars: m.usd ? cents(m.usd) : coin && isUsdStable(coin) ? cents(m.amount) : "",
    from, to, hidden: hidden ? "yes" : "no", status: STATUS[m.status], link: m.explorerUrls.at(-1) ?? "", way: m.status === "done" ? way : 0,
  };
}

const SPENDING_STATUS: Record<SpendingActivity["status"], string> = { "waiting-for-you": "Waiting for you", waiting: "On hold", "on-its-way": "On its way", done: "Done", refused: "Didn't go through", refunded: "Came back", failed: "Didn't go through" };

/** E5's wallets by name, for a statement's From and To. */
const WALLET: Record<string, string> = { sol: "SOL wallet", hood: "ETH (RH) wallet", bsc: "BNB wallet", near: "NEAR wallet" };

/** A Spending row's two ends, by name: a move between the person's own wallets (E5) names both. */
function spendingEnds(s: SpendingActivity): { from: string; to: string } {
  const toTrading = s.kind === "top-up" || s.kind === "ready";
  const move = s.kind === "move" && s.network && s.to;
  // a move or swap from the Safe on to one wallet (D137, goesTo) ends in that wallet, never "NEAR wallet", the way through
  // (Sim test: a swap into SOL said "To / NEAR wallet"); several: each is its own leg's page
  const onTo = toTrading && s.goesTo?.length === 1 ? WALLET[s.goesTo[0]!] : undefined;
  return { from: move ? WALLET[s.network!]! : toTrading ? "Safe" : "NEAR wallet", to: move ? WALLET[s.to!]! : s.site ? `Your ${s.siteName ?? s.site} wallet` : onTo ?? (toTrading ? "NEAR wallet" : "Safe") };
}

function spendingRow(s: SpendingActivity): StatementRow {
  const usd = cents(s.usd.replace(/^\$/, "").replace(/,/g, ""));
  return {
    date: localTime(s.atIso), type: s.words, details: s.note ?? "", coin: "USDC", amount: usd, dollars: usd,
    ...spendingEnds(s),
    hidden: "no", status: SPENDING_STATUS[s.status], link: "", way: 0,
  };
}

/** One line of a row's page (Activity, product decision, 3 Nov): From, To and Fee. `copy`: the whole address a short value stands for. */
export interface Fact { label: string; value: string; copy?: string }

const ADDRESS = /^[0-9A-Za-z._-]{25,}$/;
// the core sheet's short form, 6+6 (the copy review's ruling, 5 Nov; send-words.ts shortId)
const shortAddress = (a: string) => shortId(a);
/** An end as the page shows it: a long address shortened (Copy has it whole), "Your SOL wallet (address)" as its name. */
function endFact(label: string, end: string): Fact | null {
  if (!end) return null;
  const own = /^(.*) \(([^()]+)\)$/.exec(end);
  if (own) return { label, value: own[1]!, copy: own[2]! };
  return ADDRESS.test(end) ? { label, value: shortAddress(end), copy: end } : { label, value: end };
}
const feeFact = (usd: string | undefined): Fact | null => (usd !== undefined && /^\d+(\.\d+)?$/.test(usd) ? { label: "Fee", value: `$${Number(usd).toFixed(2)}` } : null);

/** A ledger row's page lines: where it came from, where it went, and its fee when the record kept one. None: it moved no money. */
export function movementFacts(m: Movement, tokens: Map<string, Token>, chains: Chain[], mine?: OwnRows): Fact[] {
  const r = ledgerRow(m, tokens, chains, mine);
  if (!r) return [];
  return [endFact("From", r.from), endFact("To", r.to), feeFact(m.feeUsd)].filter((f): f is Fact => !!f);
}

/** A Spending row's page lines: its two ends (the engine's record keeps no fee). */
export function spendingFacts(s: SpendingActivity): Fact[] {
  const e = spendingEnds(s);
  return [endFact("From", e.from), endFact("To", e.to)].filter((f): f is Fact => !!f);
}

/** Every move Activity shows that happened in the month, oldest first (a statement reads down the month). */
export function statementRows(ledger: Movement[], spending: SpendingActivity[], tokens: Map<string, Token>, chains: Chain[], year: number, month: number, own?: OwnRows): StatementRow[] {
  const { from, to } = monthBounds(year, month);
  const inMonth = (iso: string) => { const t = Date.parse(iso); return t >= from && t < to; };
  const merged = activityRows(ledger, spending);
  const rows: { at: string; row: StatementRow }[] = [];
  for (const m of merged.ledger) if (inMonth(m.updatedAtIso)) { const r = ledgerRow(m, tokens, chains, own); if (r) rows.push({ at: m.updatedAtIso, row: r }); }
  // every leg its own line: a statement is the record, one move's legs each with their own dollars
  for (const s of unfoldLegs(merged.spending)) if (inMonth(s.atIso)) rows.push({ at: s.atIso, row: spendingRow(s) });
  return rows.sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.row);
}

/** One CSV cell: always quoted, and never a formula a spreadsheet would run. A quote mark goes before =, +, -, @, a tab
 *  or a return wherever a cell could start: at the start (after spaces), and after a comma, a semicolon, a tab or a new
 *  line inside it, because a spreadsheet set to split on semicolons (German, French) splits inside quotes too. */
export function cell(v: string): string {
  const safe = v.replace(/(^|[,;\t\r\n])( *)([=+\-@\t\r])/g, "$1$2'$3");
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Activity is read newest first, up to `limit` moves: when the read is full and the month starts before its oldest move,
 *  that month may be missing moves, and the sheet says so (never a statement short without a word). */
export function mayBeShort(ledger: Movement[], limit: number, year: number, month: number): boolean {
  if (ledger.length < limit) return false;
  const oldest = Math.min(...ledger.map((m) => Date.parse(m.updatedAtIso)));
  return monthBounds(year, month).from < oldest;
}

export function toCsv(rows: StatementRow[]): string {
  const lines = [COLUMNS.map(cell).join(","), ...rows.map((r) => [r.date, r.type, r.details, r.coin, r.amount, r.dollars, r.from, r.to, r.hidden, r.status, r.link].map(cell).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (year: number, month: number) => `${MONTHS[month]} ${year}`;
export const fileName = (year: number, month: number) => `ZeroFee statement ${year}-${two(month + 1)}.csv`;

/** The sheet's summary, only from dollars known at the time (grade 5). */
export function summaryLine(rows: StatementRow[], year: number, month: number): string {
  if (!rows.length) return `Nothing moved in ${monthName(year, month)}.`;
  const sum = (w: 1 | -1) => rows.filter((r) => r.way === w && r.dollars).reduce((n, r) => n + Number(r.dollars), 0);
  const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const moves = `${rows.length} ${rows.length === 1 ? "move" : "moves"} in ${monthName(year, month)}.`;
  // a side with no dollars known is left unsaid, never "$0.00 came in" when BTC came in
  const parts = [...(sum(1) > 0 ? [`${usd(sum(1))} came in`] : []), ...(sum(-1) > 0 ? [`${usd(sum(-1))} went out`] : [])];
  return parts.length ? `${moves} ${parts.join(", ")}.` : moves;
}

/** Hand the file over: on the iPhone, its share sheet (the person picks where it goes); in a browser, a download. */
export async function saveStatement(bridge: Bridge, name: string, text: string, phone: boolean, download: (name: string, text: string) => void): Promise<{ saved: "shared" | "closed" | "downloaded" } | { line: string }> {
  if (!phone) { download(name, text); return { saved: "downloaded" }; }
  const r = await bridge.call<{ shared?: boolean }>("device.shareFile", { name, text, mime: "text/csv" });
  if ("problem" in r) return { line: r.problem.whatHappened || "The statement didn't open. Try again." };
  return { saved: r.ok?.shared ? "shared" : "closed" };
}

/** A browser's own download of the file, made on this device (a Blob URL, gone right after). */
export function browserDownload(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
