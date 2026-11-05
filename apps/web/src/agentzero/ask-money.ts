// H-2 "Ask your money" (master plan Part 1 §1), the phone's half: AgentZero answers from Activity's real rows. This
// file reads the person's own moves (Wallet's Activity, ledger.activity) on the phone and works out every figure here;
// Claude gets only what each move was, its day, its coin, a {{fN}} mark for each figure and a stand-in for each payee
// ("p1"), never a name or an address (QA, 3 Nov; the agent package's activityText strips any that slip). Each mark comes back as
// a ChatFact: the figure as the phone worked it out (`shown`) and the Activity rows it came from (`rows`), so every figure
// on screen opens its rows. Dollars only where the record carries them (a dollar coin when it moved: statement.ts's own
// rule), never priced from today's price; "Not known" otherwise. A move that didn't go through, or is still on its way,
// is listed but never counted. Pure, so node tests it (ask-money.test.ts). Read-only: nothing here signs or moves.
import type { ChatFact, ActivityAsk } from "@zerofee/agent/chat/turn";
import type { Chain, Movement, Token } from "@zerofee/wallet/types.ts";
import type { SpendingActivity } from "@zerofee/core/spending";
import { ledgerRow } from "@zerofee/wallet/app/statement.ts";
import { activityRows } from "@zerofee/wallet/app/activity-rows.ts";
import { unfoldLegs } from "@zerofee/core/spending-fold";
import { describe, dollars, coins, ownRowOf, payeeInSentence, type OwnRows } from "@zerofee/wallet/app/format.ts";

/** One Activity move, as this file reads it (the phone keeps it; only `kind`, the day, the coin and marks leave). */
export interface MoneyRow {
  id: string;
  atIso: string;
  /** What it was, in a word Claude may read ("sent", "received"): never a label, a name or a figure. */
  kind: string;
  /** Activity's own words for the rows sheet (title and detail, as Activity shows them; on the phone only). */
  title: string;
  detail: string;
  coin: string;
  /** Exact, as recorded. */
  amount: string;
  /** Dollars when it moved ("25.00"), or "" when it wasn't in dollars. */
  dollars: string;
  /** Out (−1), in (+1), or between the person's own places (0). */
  way: 1 | -1 | 0;
  /** Counted in a total: only a move that went through. */
  done: boolean;
  /** Who it went to, in Activity's words ("kim.near", a shop's name, "a Base wallet (0x7D06…7e3D)"; never a whole address); "" when
   *  not a payment out. */
  payee: string;
  /** One payee, however it is shown: the recipient (and its label). */
  payeeKey: string;
  /** The words a typed name is matched against: the payee's shown words and a NEAR name's parts (never a raw
   *  address: review M3). Never sent. */
  match: string[];
  hidden: boolean;
  url: string;
}

/** Another app's label for a move, as a payee's name: a short plain name only. One with a figure, a link or past 32
 *  characters is never shown as a checked chip (review L5): the payee is then named by Activity's own words. */
export function labelOf(label: string | undefined): string {
  const l = (label ?? "").normalize("NFKC").trim();
  return l && l.length <= 32 && !/\d|[$€£¥₹₩₿฿%]|:\/\/|www\.|\.[a-z]{2,}\b/i.test(l) ? l : "";
}

/** Whole words, lower case (a name is matched word by word, never as any slice of text). */
export const wordsOf = (t: string): string[] => t.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);

const KIND: Record<Movement["kind"], string> = { deposit: "received", withdraw: "sent", transfer: "sent", pay: "paid", private: "moved", trading: "moved", convert: "converted", swap: "swapped", account: "account" };

/** Activity's moves → the rows this file reads (a step that moved no money is left out, as the statement leaves it).
 *  `spending`: Spending's own rows (Top up, Put away, Move), merged as Activity merges them; `own`: the person's own
 *  wallets, so a move into one of them is between their own places (Activity's and the statement's rule), never "out". */
export function moneyRows(ledger: readonly Movement[], tokens: Map<string, Token>, chains: Chain[], spending: readonly SpendingActivity[] = [], own?: OwnRows): MoneyRow[] {
  const out: MoneyRow[] = [];
  const merged = activityRows([...ledger], [...spending]);
  for (const m of merged.ledger) {
    const r = ledgerRow(m, tokens, chains, own);
    if (!r) continue;
    const { title, detail } = describe(m, tokens, chains, own);
    const outward = (m.kind === "withdraw" || m.kind === "transfer" || m.kind === "pay") && !ownRowOf(m, own);
    const to = m.to ?? "";
    const name = to.includes(" on ") ? to.slice(0, to.indexOf(" on ")) : to;
    const label = labelOf(m.label);
    // the payee as the answer's sentence names it: "a Solana wallet (0x7D06…7e3D)", a name as itself (copy review, 5 Nov)
    const payee = !outward ? "" : label || (to ? payeeInSentence(to) : "the address you gave");
    const nearName = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/i.test(name) && /\.(?:near|tg|testnet)$/i.test(name) ? name : "";
    out.push({
      id: m.id, atIso: m.updatedAtIso, kind: KIND[m.kind], title, detail, coin: r.coin, amount: r.amount, dollars: r.dollars,
      way: outward ? -1 : m.kind === "deposit" ? 1 : 0, done: m.status === "done", payee, payeeKey: outward ? `${to}|${m.label ?? ""}` : "", match: outward ? wordsOf(`${payee} ${nearName.replace(/\./g, " ")}`) : [],
      hidden: r.hidden === "yes", url: r.link,
    });
  }
  // Spending's rows, each leg its own (the statement's rule): between the person's own places, in dollars of USDC
  for (const s of unfoldLegs(merged.spending)) {
    const usd = s.usd.replace(/^\$/, "").replace(/,/g, "");
    out.push({
      id: `spending:${s.id}`, atIso: s.atIso, kind: "moved", title: s.words, detail: s.note ?? "", coin: "USDC", amount: NUM.test(usd) ? usd : "",
      dollars: NUM.test(usd) ? usd : "", way: 0, done: s.status === "done", payee: "", payeeKey: "", match: [], hidden: false, url: "",
    });
  }
  return out.sort((a, b) => b.atIso.localeCompare(a.atIso));
}

/** Home's Activity rows from the account's own record that the ledger gives Wallet only (ledger.ts activity, fromChain:
 *  a NEAR send the Safe signed, not already one of the ledger's rows), the same movement Wallet builds (chainMovement). */
export interface ChainSend { atIso: string; ok: boolean; txHash: string; explorerUrl: string; by?: string; sent?: { to: string; near: string } }
export function chainSends(record: readonly ChainSend[], ledger: readonly Movement[]): Movement[] {
  const ours = (r: ChainSend) => ledger.some((m) => m.id.endsWith(r.txHash) || m.explorerUrls.some((u) => u.includes(r.txHash)));
  return record.filter((r) => r.sent && typeof r.txHash === "string" && r.txHash && !ours(r)).map((r) => ({
    id: `chain:${r.txHash}`, kind: "transfer", status: r.ok ? "done" : "problem", from: "near", to: r.sent!.to, amount: r.sent!.near,
    startedAtIso: r.atIso, updatedAtIso: r.atIso, explorerUrls: r.explorerUrl ? [r.explorerUrl] : [], caller: "wallet", ...(r.by ? { by: r.by } : {}),
  }) as Movement);
}

/** A part this account or build doesn't have (the core's "this part isn't ready", the sample demo's "not available"):
 *  none, as Home's Activity reads it; any other failure is a read that failed, and is said. */
export const NOT_HERE: ReadonlySet<string> = new Set(["security.method.unknown", "mock.unknown"]);

/** What Activity doesn't list (said with every read that asks what came in): an Add's one-time address and the money that
 *  opened the account leave no row in Activity, so "nothing came in" would be false (product decision, 3 Nov). */
export const NOT_IN_RECORD = "Not in this record: money added with Add (its one-time address) and the money that opened the account. Activity doesn't list those yet. So never say no money came in or that the person didn't fund a wallet: say Activity doesn't list Adds yet, and use read_holdings for what each wallet holds now.";

/** Does this read hold Home's lasting "Received" rows (99c53aa7: each Add that ended, the money that opened the account,
 *  money sent straight to the Safe; each carries its dollars, where it landed or "opened")? Then Activity lists money
 *  that came in, and NOT_IN_RECORD is no longer said. */
export const receivedListed = (ledger: readonly Movement[]): boolean => ledger.some((m) => m.kind === "deposit" && (m.opened === true || m.usd !== undefined || m.into !== undefined));

/** Exact decimal sums (no floats): "0.1" + "0.2" = "0.3". */
export function addDecimal(a: string, b: string): string {
  const [aw, af = ""] = a.split("."), [bw, bf = ""] = b.split(".");
  const n = Math.max(af.length, bf.length);
  const s = (BigInt(aw || "0") * 10n ** BigInt(n) + BigInt(af.padEnd(n, "0") || "0")) + (BigInt(bw || "0") * 10n ** BigInt(n) + BigInt(bf.padEnd(n, "0") || "0"));
  const str = s.toString().padStart(n + 1, "0");
  const w = str.slice(0, str.length - n), f = n ? str.slice(-n).replace(/0+$/, "") : "";
  return f ? `${w}.${f}` : w;
}

const two = (n: number) => String(n).padStart(2, "0");
/** A day in the phone's own time: "2026-11-03". */
export const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const startOf = (day: string) => new Date(`${day}T00:00:00`).getTime();
const NUM = /^\d+(\.\d+)?$/;

/** A total of some rows: the dollars of the rows that carry them, and each other coin by itself (never priced). */
function totals(rows: readonly MoneyRow[]): { usd: { shown: string; rows: string[] } | null; coins: { shown: string; rows: string[] }[] } {
  const inUsd = rows.filter((r) => r.dollars && NUM.test(r.dollars));
  const usd = inUsd.length ? { shown: dollars(inUsd.reduce((s, r) => addDecimal(s, r.dollars), "0")), rows: inUsd.map((r) => r.id) } : null;
  const byCoin = new Map<string, MoneyRow[]>();
  for (const r of rows) if (!(r.dollars && NUM.test(r.dollars)) && NUM.test(r.amount)) byCoin.set(r.coin || "an unnamed coin", [...(byCoin.get(r.coin || "an unnamed coin") ?? []), r]);
  return { usd, coins: [...byCoin].map(([coin, rs]) => ({ shown: `${coins(rs.reduce((s, r) => addDecimal(s, r.amount), "0"))} ${coin}`, rows: rs.map((r) => r.id) })) };
}

/** A move's own figure: its dollars, else its coin amount. */
const figure = (r: MoneyRow) => (r.dollars && NUM.test(r.dollars) ? dollars(r.dollars) : NUM.test(r.amount) ? `${coins(r.amount)} ${r.coin}`.trim() : "Not known");
const moves = (n: number) => `${n} ${n === 1 ? "move" : "moves"}`;

export interface MoneyAnswer {
  /** For Claude: kinds, days, coins, marks and stand-ins only. */
  text: string;
  facts: ChatFact[];
  /** The marks a ZeroFee-written answer uses (the sample demo's): each group's total, coins and count; the top payee. */
  marks: { total?: string; coins: string[]; count?: string; who?: string; whoTotal?: string };
}

export const ROWS_SENT = 25;
export const PAYEES_SENT = 6;
/** turn.ts keeps at most this many facts from one read. */
export const MAX_FACTS = 50;

/**
 * The answer to one read_activity ask. `said`: the person's own words this turn (a `who` is matched only when the person
 * typed it, as whole words); `mark`: the conversation's counter ("f1", "f2", …, never re-used); `full`: the read hit its
 * limit, so moves older than the oldest read may be missing.
 */
/** `received`: the read holds Home's Received rows (receivedListed), so money that came in is all listed. */
export function answerAsk(all: readonly MoneyRow[], q: ActivityAsk, o: { said: string; mark: ReturnType<typeof markCounter>; full: boolean; now: number; received?: boolean }): MoneyAnswer {
  const facts: ChatFact[] = [];
  const fact = (shown: string, rows: string[]) => { const mark = o.mark.next(); facts.push({ mark, shown, rows }); return `{{${mark}}}`; };
  const marks: MoneyAnswer["marks"] = { coins: [] };
  // a chat that has used its marks reads no more: a new chat starts them again (never a mark used twice)
  if (o.mark.left() < MAX_FACTS) return { text: "This chat can't read the person's activity again. Ask them to start a new chat.", facts, marks };
  const lines: string[] = ["The person's own moves, read on their phone. Days are the phone's days. Each figure is a {{fN}} mark: write the mark, never a figure. A payee is a stand-in (p1, p2): write its who mark, never the stand-in."];
  const from = q.from ? startOf(q.from) : -Infinity;
  const to = q.to ? startOf(q.to) + 86_400_000 : Infinity;
  const way = q.way ?? "all";
  lines.push(`Asked: ${q.from ? `from ${q.from}` : "from the start"} to ${q.to ?? dayOf(new Date(o.now).toISOString())}${way === "all" ? "" : `, ${way}`}${q.coin ? `, ${q.coin.toUpperCase()} only` : ""}.`);
  let rows = all.filter((r) => { const t = Date.parse(r.atIso); return t >= from && t < to; });
  if (way !== "all") rows = rows.filter((r) => r.way === (way === "out" ? -1 : 1));
  if (q.coin) rows = rows.filter((r) => r.coin.toLowerCase() === q.coin!.toLowerCase());
  if (q.who) {
    // only a name the person typed in this question (QA), as whole words of 3 letters or more (review M3: never a slice
    // like "e", which would let repeated reads spell out who was paid); matched word by word, by the word or its start
    const who = wordsOf(q.who);
    const said = new Set(wordsOf(o.said));
    if (!who.length || who.some((w) => w.length < 3 || !said.has(w))) return { text: `${lines.join("\n")}\nThat name isn't in the person's question, so nothing was matched. Ask them who they mean.`, facts: [], marks };
    rows = rows.filter((r) => who.every((w) => r.match.some((x) => x === w || x.startsWith(w))));
  }
  // what Activity doesn't list, said only while its Received rows aren't in the read (an older core, or a part not read)
  if (way !== "out" && o.received !== true) lines.push(NOT_IN_RECORD);
  if (!rows.length) {
    lines.push("No moves match.");
    if (o.full && from < Math.min(...all.map((r) => Date.parse(r.atIso)))) lines.push("Older moves may be missing from this read.");
    return { text: lines.join("\n"), facts, marks };
  }
  const groups: [string, MoneyRow[]][] = way === "all" ? [["Out", rows.filter((r) => r.way === -1 && r.done)], ["In", rows.filter((r) => r.way === 1 && r.done)]] : [[way === "out" ? "Out" : "In", rows.filter((r) => r.done)]];
  for (const [name, counted] of groups) {
    if (!counted.length) { lines.push(`${name}: nothing went through.`); continue; }
    const t = totals(counted);
    const usd = t.usd ? fact(t.usd.shown, t.usd.rows) : fact("Not known", counted.map((r) => r.id));
    const cs = t.coins.map((c) => fact(c.shown, c.rows));
    const n = fact(moves(counted.length), counted.map((r) => r.id));
    if (!marks.total) { marks.total = usd.slice(2, -2); marks.coins = cs.map((c) => c.slice(2, -2)); marks.count = n.slice(2, -2); }
    lines.push(`${name}: in dollars ${usd}${cs.length ? `; not in dollars ${cs.join(", ")}` : ""}; ${n}.`);
  }
  // payees: who the money went to, most first (dollars, then how many moves); each a stand-in, its name only in a chip
  const outs = rows.filter((r) => r.way === -1 && r.done && r.payeeKey);
  const byPayee = new Map<string, MoneyRow[]>();
  for (const r of outs) byPayee.set(r.payeeKey, [...(byPayee.get(r.payeeKey) ?? []), r]);
  const usdOf = (rs: MoneyRow[]) => rs.reduce((s, r) => s + (r.dollars && NUM.test(r.dollars) ? Number(r.dollars) : 0), 0);
  const ranked = [...byPayee].sort((a, b) => usdOf(b[1]) - usdOf(a[1]) || b[1].length - a[1].length);
  const stand = new Map<string, string>();
  ranked.forEach(([p], i) => stand.set(p, `p${i + 1}`));
  if (ranked.length) {
    const parts = ranked.slice(0, PAYEES_SENT).map(([p, rs], i) => {
      const t = totals(rs);
      const shown = [t.usd?.shown, ...t.coins.map((c) => c.shown)].filter(Boolean).join(" + ") || "Not known";
      const who = fact(rs[0]!.payee, rs.map((r) => r.id)), total = fact(shown, rs.map((r) => r.id));
      if (i === 0) { marks.who = who.slice(2, -2); marks.whoTotal = total.slice(2, -2); }
      return `${stand.get(p)}: who ${who}, total ${total}`;
    });
    lines.push(`Payees, most first: ${parts.join("; ")}${ranked.length > PAYEES_SENT ? "; and others" : ""}.`);
  }
  lines.push("Moves, newest first (only moves that went through count above):");
  // at most 50 facts reach the screen (turn.ts cleanFacts): the moves get what the totals and payees left
  const listed = rows.slice(0, Math.max(0, Math.min(ROWS_SENT, MAX_FACTS - facts.length)));
  for (const r of listed) {
    const status = r.done ? "went through" : "didn't go through or not yet";
    lines.push(`${dayOf(r.atIso)} ${r.kind} ${r.coin || "a coin"} ${fact(figure(r), [r.id])}${r.payeeKey ? ` to ${stand.get(r.payeeKey) ?? "someone"}` : ""}, ${status}`);
  }
  if (rows.length > listed.length) lines.push("More moves are not listed; the totals above count them all.");
  if (rows.some((r) => r.done && r.way !== 0 && !(r.dollars && NUM.test(r.dollars)))) lines.push("Some moves weren't in dollars: their dollars are not known, so they are given in their own coin.");
  if (o.full && from < Math.min(...all.map((r) => Date.parse(r.atIso)))) lines.push("Older moves may be missing from this read.");
  return { text: lines.join("\n"), facts, marks };
}

/** A running mark counter for one conversation: f1, f2, … f999, never re-used (review M4: a wrapped counter would put a new
 *  figure under an old answer's mark). `left()`: how many marks remain. */
export function markCounter(): { next: () => string; left: () => number } {
  let n = 0;
  return { next: () => `f${(n = Math.min(n + 1, 999))}`, left: () => 999 - n };
}
