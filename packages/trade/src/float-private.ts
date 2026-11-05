// Move and a site's Add paid from Private (the product's HARD RULE: every money move confidential, NEAR Confidential):
// each leg is one payment from Private straight to its wallet (the ledger's ledger.moveFromPrivate, safe-send.ts's own
// payment), never the public Safe → NEAR wallet leg (ledger.toTrading). The Move's row is the one saved before anything
// was asked (float-core.ts add(), `mv-<key>`): it follows the ledger's movements to their end, by event and, after a
// page closed mid-job, by the ledger's own record of the job's payments (ledger.privateMoveStatus, by the job's key).
// Loaded with its first use, never in Home's first load; types only from the engine (its values come in the host).
import { ProblemError } from "@zerofee/core/problem";
import { LANDED_MISSES, LANDED_UNREAD, privateBack } from "@zerofee/core/private-route";
import type { FloatChain, MoveRow } from "./float-view.ts";

type Priv = NonNullable<MoveRow["priv"]>;
type Part = Priv["parts"][number];
/** The engine's own pieces (float-core.ts privHost): its rows, the ones it asks now, and its steps. */
export interface PrivateHost {
  d: { call<T>(method: string, params: Record<string, unknown>): Promise<T>; now(): number };
  adds: MoveRow[];
  asking: Set<string>;
  ensureChain(chain: FloatChain): Promise<unknown>;
  current(chain: FloatChain): { id: string } | undefined;
  refresh(): Promise<void>;
  saveAdds(): Promise<void>;
  addRow(r: MoveRow): MoveRow;
  /** The split becomes the person's once money really moves (float-core beginSplit). */
  begin(): void;
  /** The float's count as the row started (float-core addBase). */
  base(r: MoveRow): unknown;
  /** The person's own top-up on that chain stays there (float-core topUps). */
  hold(chain: FloatChain): unknown;
  changed(): void;
  /** Home's last known figure of that wallet's own coin, in its units (the engine's wallet list, kept over a failed
   *  read: float-core takeWallets); none: never read there (a site's wallet isn't in it). */
  known?(wallet: string): string | undefined;
}
export interface PrivateAdd {
  usd: number;
  from?: { tokenId: string; amount: string; symbol: string };
  ready?: { wallet: string; name: string; site?: string };
  legs?: { chain: FloatChain | "near"; usd: number }[];
  label: string;
  asked: { for?: string };
  job?: string;
}

/** Asked of the ledger this often while a payment is open (events come first; this is for a page that was closed). */
export const PRIV_CHECK_MS = 15_000;
/** A row saved before anything went, whose ledger record never came (it never reached a payment): gone after this. */
export const PRIV_ORPHAN_MS = 2 * 60_000;
const ENDED = new Set(["done", "problem", "refunded"]);
const NAME: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain", near: "NEAR wallet" };
/** The core's floor for one leg (float-core FLOAT_MIN_ADD_USD): a smaller one isn't paid. */
const LEG_MIN_USD = 2;

/** The chain's current wallet id, made first when there's none (the core makes it once; asking again gives the same). */
async function walletOf(h: PrivateHost, c: FloatChain): Promise<string> {
  await h.ensureChain(c);
  if (!h.current(c)) await h.refresh();
  const w = h.current(c);
  if (!w) throw new ProblemError({ code: "trade.float.no-wallet", whatHappened: `Your ${NAME[c]} wallet isn't ready yet. Nothing moved.`, money: { state: "safe", where: "in Private" }, next: { kind: "nothing", label: "Go back" } });
  return w.id;
}

/** The legs as payments: a site's wallet, each chosen wallet, or the NEAR wallet alone (a plain Add). */
async function partsOf(h: PrivateHost, a: PrivateAdd): Promise<{ wallet: string; chain: FloatChain | "near"; usd: number; amount?: string }[]> {
  const legs = a.legs?.filter((l) => l.usd >= LEG_MIN_USD);
  const asked = a.ready ? [{ chain: "sol" as const, usd: a.usd, wallet: a.ready.wallet }] : legs?.length ? legs.map((l) => ({ chain: l.chain, usd: l.usd })) : [{ chain: "near" as const, usd: a.usd }];
  const out: { wallet: string; chain: FloatChain | "near"; usd: number; amount?: string }[] = [];
  for (const l of asked) {
    const wallet = "wallet" in l && l.wallet ? l.wallet : l.chain === "near" ? "near" : await walletOf(h, l.chain);
    // paid with a coin that isn't dollars: its share of the coin's amount (spending sized the whole at `usd`)
    const amount = a.from ? (Math.floor((Number(a.from.amount) * l.usd / a.usd) * 1e6) / 1e6).toFixed(6) : undefined;
    out.push({ wallet, chain: l.chain, usd: l.usd, ...(amount ? { amount } : {}) });
  }
  return out;
}

/** float-core add()'s route from Private: the Move's row (`pre`, saved before anything, or one made here), paid, followed.
 *  A refusal before anything went takes the row away and is thrown; a No is "declined". */
export async function privAdd(h: PrivateHost, pre: MoveRow | undefined, a: PrivateAdd): Promise<MoveRow | "declined"> {
  const r: MoveRow = pre ?? { id: `pv-${h.d.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, kind: "add", usd: a.usd, status: "waiting", where: "main", at: h.d.now(), ...(a.ready ? { ready: { ...a.ready } } : {}) };
  if (!pre) { h.adds.unshift(r); h.base(r); h.asking.add(r.id); }
  const forget = () => { h.asking.delete(r.id); const i = h.adds.indexOf(r); if (i >= 0) h.adds.splice(i, 1); void h.saveAdds(); };
  let got: MoveRow | "declined";
  try { got = await addFromPrivate(h, r, a); } catch (e) { forget(); throw e; }
  if (got === "declined") { forget(); return "declined"; }
  h.asking.delete(r.id);
  h.begin();
  h.changed();
  void h.refresh();
  return h.addRow(r);
}

/** Pays the Move from Private on its row (`r`). A refusal before anything went: thrown. */
export async function addFromPrivate(h: PrivateHost, r: MoveRow, a: PrivateAdd): Promise<MoveRow | "declined"> {
  const parts = await partsOf(h, a);
  // a site's top-up (QA): Private pays it in ONE exit; short, the Safe fills Private once (`whole`), then that exit
  // the legs as payments, kept on the row before anything is asked: a page closed mid-job reads them back by their order
  r.priv = { parts: parts.map((p) => ({ wallet: p.wallet, chain: p.chain, usd: p.usd, ids: [] })) };
  // the audit (5 Nov): each chain wallet's own coin before it is paid, read at once beside the ledger's call (never before it:
  // the tap waits on nothing), so its Done waits for a read that SHOWS the money (chainShown)
  const baseP = Promise.all(parts.map((p) => (p.chain === "near" ? Promise.resolve(null) : nativeOf(h, p.wallet))));
  await h.saveAdds();
  let res: { parts: { wallet: string; usd: number; ids: string[]; stopped?: string; minOut?: string }[] };
  try {
    res = await h.d.call("ledger.moveFromPrivate", { parts: parts.map(({ wallet, usd, amount }) => ({ wallet, usd, ...(amount ? { amount } : {}) })), ...(a.from ? { tokenId: a.from.tokenId } : {}), label: a.label, ...a.asked, ...(a.job ? { job: a.job } : {}), ...(a.ready ? { whole: true } : {}) });
  } catch (e) {
    if (e instanceof ProblemError && /declin/i.test(e.problem.code)) return "declined";
    throw e;
  }
  // the tap's read failed: Home's last known figure of that wallet (or this engine's own last read of it) is the base, so
  // a wallet that already held the least never ticks at once; none known: the whole balance must hold it (shows)
  const base = (await baseP).map((b, i) => (b !== null || parts[i]!.chain === "near" ? b : knownOf(h, parts[i]!.wallet)));
  r.priv = { parts: parts.map((p, i) => ({ wallet: p.wallet, chain: p.chain, usd: p.usd, ids: res.parts[i]?.ids ?? [], ...(res.parts[i]?.stopped ? { stopped: res.parts[i]!.stopped } : {}), ...(base[i] != null ? { base: base[i]! } : {}), ...(UNITS.test(res.parts[i]?.minOut ?? "") ? { minOut: res.parts[i]!.minOut! } : {}) })) };
  delete r.signing;
  Object.assign(r, { status: "moving", where: "in-flight" });
  // the legs never go on from the NEAR wallet: each was paid straight to its wallet
  if (r.legs) for (const l of r.legs) l.sent = true;
  if (r.ready) r.ready.sent = true;
  for (const p of r.priv.parts) if (p.chain !== "near" && p.ids.length) h.hold(p.chain);
  settle(r, h.d.now());
  h.changed();
  return r;
}

/** One movement of a paid row ended (or moved on): its row says so once every part is over. */
export function moved(r: MoveRow, m: { id: string; status: string }, now: number = Date.now()): boolean {
  const p = r.priv?.parts.find((x) => x.ids.includes(m.id));
  if (!p) return false;
  (p.ends ??= {})[m.id] = m.status;
  settle(r, now);
  return true;
}

const over = (p: Part) => !!p.stopped || (p.ids.length > 0 && p.ids.every((id) => ENDED.has(p.ends?.[id] ?? "")));
const ok = (p: Part) => !p.stopped && p.ids.length > 0 && p.ids.every((id) => p.ends?.[id] === "done");

/** The row from its parts: on its way until each is over; what came back says it's in Private (its refund address),
 *  never "failed". What arrived is not Done yet (QA's lap, 5 Nov: "Done in 26 s" while the NEAR wallet read
 *  $0.01 for 2.5 more minutes): it is `landed`, and float-core makes it Done in the round whose balance read shows it
 *  (arrivedRead, rule 11), so Done and the arrival come in the same frame. */
export function settle(r: MoveRow, now: number = Date.now()): void {
  const parts = r.priv?.parts ?? [];
  const fill = fillOf(r);
  if (fill) r.priv!.fill = fill;
  if (!parts.length || !parts.every(over)) return;
  const back = parts.filter((p) => !ok(p));
  const said = back.map((p) => `${NAME[p.chain] ?? "Your wallet"}: ${p.stopped ?? privateBack(p.usd)}`);
  if (back.length === parts.length) Object.assign(r, { status: "failed", where: "main", note: parts.length === 1 ? back[0]!.stopped ?? privateBack(back[0]!.usd) : said.join(" · ") });
  else if (r.status !== "done") r.priv!.landed ??= { at: now, ...(said.length ? { note: said.join(" · ") } : {}) };
}

/**
 * Whether this round's reads show a `landed` row's arrival (rule 11: Done only from a fresh read, never a timer; 83, 5 Nov):
 * every read began after the ledger said it landed (`roundAt`), and the NEAR wallet's own figure holds at least half of
 * what was paid there (its count when the row started, `base`, plus it; 1Click's floors give far more). A chain wallet's
 * part: a read of its wallet in that round showed the money (chainShown, `chain`). `nearUsd` undefined: the NEAR wallet's figure wasn't read.
 */
export function arrivedRead(r: MoveRow, o: { roundAt: number; nearUsd: number | undefined; base: number; /** chainShown's answer this round */ chain?: boolean }): boolean {
  const l = r.priv?.landed;
  if (!l) return false;
  if (o.roundAt < l.at) return false;
  if (o.chain === false) return false;
  const near = (r.priv?.parts ?? []).filter((p) => p.chain === "near" && ok(p)).reduce((n, p) => n + p.usd, 0);
  return near <= 0 || (o.nearUsd !== undefined && o.nearUsd - o.base >= near * 0.5);
}

/** This round's fresh reads didn't show a `landed` row (arrivedRead false, `roundAt` after the landing): one miss more;
 *  LANDED_MISSES in a row, its row says LANDED_UNREAD until a read shows it (then Done). Answers whether it changed. */
export function missedRead(r: MoveRow, roundAt: number): boolean {
  const l = r.priv?.landed;
  if (!l || roundAt < l.at || r.status === "done" || r.status === "failed") return false;
  l.misses = (l.misses ?? 0) + 1;
  if (l.misses < LANDED_MISSES || r.note === LANDED_UNREAD) return false;
  r.note = LANDED_UNREAD;
  return true;
}

/** The Safe → Private step's state, for the job's steps: only a part paid through the Safe's fill has one. */
export function fillOf(r: MoveRow): "doing" | "done" | undefined {
  const ids = (r.priv?.parts ?? []).flatMap((p) => p.ids.filter((id) => id.startsWith("safe-send:")).map((id) => ({ id, end: p.ends?.[id] })));
  if (!ids.length) return undefined;
  return ids.every((x) => x.end && ENDED.has(x.end)) ? "done" : "doing";
}

/** Rows paid from Private still open (a page closed mid-job included): the ledger's own record of each, by its key. */
export async function checkOpen(h: PrivateHost): Promise<void> {
  const { adds, asking } = h;
  const now = h.d.now();
  for (const r of [...adds]) {
    if (!r.priv || asking.has(r.id) || (r.status !== "moving" && r.status !== "waiting") || now - (r.priv.checkedAt ?? 0) < PRIV_CHECK_MS) continue;
    const job = r.id.startsWith("mv-") ? r.id.slice(3) : undefined;
    if (!job) continue;
    r.priv.checkedAt = now;
    const st = await h.d.call<{ parts: { wallet: string; stopped?: string; moves: { id: string; status: string }[] }[] } | null>("ledger.privateMoveStatus", { job }).catch(() => undefined);
    if (st === undefined) continue;
    // nothing kept by the ledger: it never reached a payment (refused, or the page closed before it): the row goes
    if (st === null) {
      if (!r.priv.parts.some((p) => p.ids.length) && now - r.at > PRIV_ORPHAN_MS) { adds.splice(adds.indexOf(r), 1); h.changed(); }
      continue;
    }
    // a page closed mid-job: the payments as the ledger kept them, each with its status now
    if (r.signing) { delete r.signing; Object.assign(r, { status: "moving", where: "in-flight" }); if (r.legs) for (const l of r.legs) l.sent = true; if (r.ready) r.ready.sent = true; }
    r.priv.parts = st.parts.map((s, i) => {
      const was = r.priv!.parts[i];
      // a status that names no wallet keeps the one the row was paid to (never blanked: its job names it and ends on it)
      // what the tap read of its wallet and the quote's least, kept (audit: its Done waits for a read that shows the money)
      return { wallet: s.wallet || was?.wallet || "", chain: was?.chain ?? "near", usd: was?.usd ?? 0, ids: s.moves.map((m) => m.id), ends: Object.fromEntries(s.moves.filter((m) => ENDED.has(m.status)).map((m) => [m.id, m.status])), ...(s.stopped ? { stopped: s.stopped } : {}), ...(was?.base !== undefined ? { base: was.base } : {}), ...(was?.minOut !== undefined ? { minOut: was.minOut } : {}) };
    });
    settle(r, now);
    h.changed();
  }
}

/**
 * the audit (5 Nov), folded into the landed round (arrivedRead): a `landed` row's parts paid to a chain's wallet (a site's wallet
 * too, which the engine's wallet list doesn't hold) are in only when a read of that wallet, begun in this round, SHOWS
 * the money: its own coin up by at least the payout's quoted least (`minOut`, the quoted out less slippage) over what it
 * held at the tap (`base`; none known: the whole balance must hold it). A read that merely answers after the done is no
 * arrival. A part with no quoted least (an older build's row, the Sim's ledger) is in on an answered read. A failed read
 * shows nothing: the round is a miss (missedRead), and LANDED_MISSES in a row say LANDED_UNREAD; no time ends it.
 */
export async function chainShown(h: PrivateHost, r: MoveRow): Promise<boolean> {
  const parts = (r.priv?.parts ?? []).filter((p) => p.chain !== "near" && ok(p));
  if (!parts.length) return true;
  const seen = await Promise.all(parts.map(async (p) => { const got = await nativeOf(h, p.wallet); return got !== null && shows(p, got); }));
  return seen.every(Boolean);
}

const UNITS = /^\d{1,40}$/;
/** The read shows the money: up by at least the quoted least over the tap's balance (none quoted: any answer, as before). */
export function shows(p: Pick<Part, "base" | "minOut">, now: string): boolean {
  if (p.minOut === undefined) return true;
  return BigInt(now) - BigInt(p.base ?? "0") >= BigInt(p.minOut);
}
/** That wallet's own coin, in its units (subwallet.balances' "native" row); null: the read failed or said nothing. */
async function nativeOf(h: PrivateHost, wallet: string): Promise<string | null> {
  const got = await h.d.call<unknown>("subwallet.balances", { id: wallet }).catch(() => null);
  if (!Array.isArray(got)) return null;
  const n = (got as { token?: unknown; amount?: unknown }[]).find((x) => x?.token === "native")?.amount;
  const v = typeof n === "string" && UNITS.test(n) ? n : "0";
  lastRead.set(wallet, v);
  return v;
}
/** This engine's own last good read of each wallet (a site's wallet too, which Home's wallet list doesn't hold). */
const lastRead = new Map<string, string>();
/** The base when the tap's read failed: Home's last known figure, else this engine's last read; null: none known. */
export function knownOf(h: Pick<PrivateHost, "known">, wallet: string): string | null {
  const k = h.known?.(wallet);
  if (k !== undefined && UNITS.test(k)) return k;
  return lastRead.get(wallet) ?? null;
}
