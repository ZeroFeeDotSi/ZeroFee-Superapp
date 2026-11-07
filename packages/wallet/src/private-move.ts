// Move and a site's top-up paid from Private (the product's HARD RULE: every money move confidential, NEAR Confidential).
// Each leg is ONE payment from Private straight to the person's own wallet (its SOL, ETH (RH) or BNB address, the NEAR
// wallet's private balance, a site's SOL wallet): one confidential hop, never the public Safe → NEAR wallet leg
// (ledger.toTrading). Every payment is safe-send.ts's own (sendFromSafe: the pocket's NEP-413, one tap under the caps),
// never a second copy. Private short: with the fill closed (VITE_SAFE_FILL_OPEN off, private-route.ts) the whole Move
// is refused before anything is saved or signed; open, the short leg's job fills Private from the Safe first (the
// Safe's own sheet, Face ID), and its payout goes only once 1Click says the fill landed with enough (send-job.ts).
// Loaded with its first use, never in Home's first load; the ledger hands over what it needs.
import { moneyMayHaveMoved } from "@zerofee/core/money-calls";
import { ProblemError } from "@zerofee/core/problem";
import type { Bridge } from "@zerofee/core/bridge";
import { PRIVATE_KEEP_MS, privateShort } from "@zerofee/core/private-route";
import { fromUnits, toUnits } from "./amount.ts";
import type { Catalogue } from "./catalogue.ts";
import type { createSafeSend } from "./safe-send.ts";
import type { Movement, Payee } from "./types.ts";
import { PartWent, pocketPartWent, walletProblems } from "./wallet-problems.ts";

type Caller = string;
/** One leg: a wallet of the person's own by its id ("near": the NEAR wallet's private balance), its dollars, and the
 *  coin's own amount when the Safe pays with another coin than USDC. */
export interface PrivatePart { wallet: string; usd: number; amount?: string }
export interface PrivateMoveDeps {
  core: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  catalogue: () => Promise<Catalogue>;
  sends: () => Promise<Pick<ReturnType<typeof createSafeSend>, "sendFromSafe" | "pocketShare" | "fillRoute" | "payOwn" | "fillMove">>;
  originAsset: (tokenId: string) => string;
  /** The Move route's fill switch (VITE_SAFE_FILL_OPEN), read once by the ledger. */
  fillOpen: boolean;
  usdc: string;
  stored: (key: string) => Promise<string | null | undefined>;
  store: (key: string, value: string) => Promise<unknown>;
  /** One write to the kept list at a time (the ledger's serially). */
  serially: <T>(job: () => Promise<T>) => Promise<T>;
  loadMovements: () => Promise<Movement[]>;
  /** Sends a restart left on their way are followed again (the ledger's resumeSends). */
  resume: () => Promise<void>;
  /** A payment that ended slow: leg 1's own status read again, its Problem said in Private once 1Click says it arrived
   *  (send-job.ts settleLate, 83, 6 Nov). */
  settleLate?: (id: string) => Promise<unknown>;
  now: () => number;
  notForChild: () => Promise<void>;
  /** The apps Spending asks for (ledger.ts SPENDING_FOR): Trade names one, so the Safe's sheet (a fill) is that app's (D146). */
  spendingFor: ReadonlySet<string>;
  /** The person's chain wallets as Trade sees them (subwallet.list as "trade": its own and the sites'). Wallet's own list
   *  holds only Private, so a Move's "trade-sol-…" wallet was never found there (QA's proof lap, 5 Nov). */
  trade: () => Pick<Bridge, "call">;
}
/** A Move's payments by its job's key, kept on this device as each is made, so a page closed mid-job finds them again.
 *  `paying`: its legs are still being made; `fillAt`: when the Safe last filled Private for it (the sweep's hold). */
/** A part's `unsure`: it stopped with its money unknown (partMayHaveGone): its row offers no Try again, only Activity, as a
 *  re-tap could pay it twice (the audit's ruling, 6 Nov). Never on a part that didn't start: its money is still in Private. */
type KeptPart = { wallet: string; usd: number; ids: string[]; stopped?: string; unsure?: true; minOut?: string };
type Kept = Record<string, { at: number; parts: KeptPart[]; paying?: true; fillAt?: number }>;
const KEY = "private-moves";
/** After a fill, Private's extra (the step's rounding) stays this long: never swept home to the Safe (QA's
 *  MUST: a sweep right after would put Safe −$20 … Safe +$10 side by side on public NEAR, pointing at the $9.95). */
export const FILL_HOLD_MS = 86_400_000;
/** A Move whose legs are still being made, past this, is a page that closed mid-way: it holds the sweep no longer. */
const PAYING_MS = 10 * 60_000;

/** Where an unreadable record was first seen: the sweep waits 24 h from then (QA's SHOULD: fail closed). */
const BAD_KEY = "private-moves-unread";

/** Whether the ledger's sweep home (M5, ledger.ts sweepHome) waits: the payment that just ended is a Move's or a site
 *  top-up's (their end never sweeps), a Move is still being paid, or the Safe filled Private in the last 24 h. A record
 *  that can't be read holds it 24 h from the first read that found it so (it may have held a fill), then lets it go. */
export async function sweepHeld(raw: string | null | undefined, ended: string | undefined, now: number, kv: Pick<PrivateMoveDeps, "stored" | "store">): Promise<boolean> {
  let all: Kept;
  try {
    all = JSON.parse(raw ?? "{}") as Kept;
    if (!all || typeof all !== "object" || Array.isArray(all)) throw new Error("not a record");
  } catch {
    const seen = Number((await kv.stored(BAD_KEY)) ?? NaN);
    if (!Number.isFinite(seen)) { await kv.store(BAD_KEY, String(now)); return true; }
    return now - seen < FILL_HOLD_MS;
  }
  if (await kv.stored(BAD_KEY)) await kv.store(BAD_KEY, "");
  return Object.values(all).some((r) => (ended !== undefined && r.parts?.some((p) => p.ids?.includes(ended))) || (r.paying === true && now - r.at < PAYING_MS) || (typeof r.fillAt === "number" && now - r.fillAt < FILL_HOLD_MS));
}
/** Whether a part's stop leaves its money unknown, or some of it gone: never "nothing went yet", which forgets the Move's
 *  record and lets the sheet pay it again (audit, 6 Nov). A plain throw proves nothing; a refusal says so by its one step
 *  (Activity), by where the money is, or by its code (as float-core's MAYBE_SENT). Pure: a table test. */
export function partMayHaveGone(e: unknown): boolean {
  return !(e instanceof ProblemError) || moneyMayHaveMoved(e.problem);
}
/** A part that never started because one before it stopped with its money unknown (audit, 6 Nov): nothing of it left. */
export const NOT_STARTED = { private: "Didn't start. It's still in Private.", fill: "Didn't start. It's still in Private and your Safe." } as const;
/** The parts after a stop whose money is unknown (`at`, its place in `order`): none of them starts, and each says where
 *  its money is: Private, or Private and the Safe when Private's share at the start (`share`) couldn't pay it with every
 *  part before it (each such part would have needed a fill of its own, more than one when Private is short by more than
 *  the last part). Pure: a table test. */
export function notStarted(order: readonly number[], units: readonly bigint[], share: bigint, at: number): { part: number; stopped: string }[] {
  let sum = 0n;
  const out: { part: number; stopped: string }[] = [];
  order.forEach((i, k) => {
    sum += units[i] ?? 0n;
    if (k > at) out.push({ part: i, stopped: sum <= share ? NOT_STARTED.private : NOT_STARTED.fill });
  });
  return out;
}
/** The payments of a Move's record whose money is on its way to Private (send-job's slow end, `ledger.send.slow`): the
 *  ones a status read asks about again, so the hold ends once the money is there (audit, 6 Nov). Pure: a table test. */
export function lateIds(parts: readonly { ids: readonly string[] }[], ms: readonly Pick<Movement, "id" | "status" | "problem">[]): string[] {
  return parts.flatMap((p) => p.ids).filter((id) => { const m = ms.find((v) => v.id === id); return m?.status === "problem" && m.problem?.code === "ledger.send.slow" && m.problem.money.state === "on-the-way"; });
}
const filled = (ids: readonly string[]) => ids.some((id) => id.startsWith("safe-send:"));
const JOB = /^[A-Za-z0-9_-]{16,64}$/;
const KEEP_MS = PRIVATE_KEEP_MS;
const FLOAT_CHAINS = new Set(["sol", "hood", "bsc"]);

export function createPrivateMove(x: PrivateMoveDeps) {
  const kept = async (): Promise<Kept> => {
    try { return JSON.parse((await x.stored(KEY)) ?? "{}") as Kept; } catch { return {}; }
  };
  const keep = (job: string, rec: Kept[string]): Promise<void> => x.serially(async () => {
    const all = await kept();
    for (const [k, v] of Object.entries(all)) if (x.now() - v.at > KEEP_MS) delete all[k];
    all[job] = rec;
    await x.store(KEY, JSON.stringify(all));
  });

  /** A Send's own fill (ledger.sendFromSafe with `fill`): its extra stays in Private the same 24 h. */
  const noteFill = async (ms: readonly Movement[]): Promise<void> => {
    const ids = ms.map((m) => m.id);
    if (filled(ids)) await keep(`send-${ids[0]}`, { at: x.now(), parts: [{ wallet: "send", usd: 0, ids }], fillAt: x.now() });
  };

  const drop = (job: string): Promise<void> => x.serially(async () => {
    const all = await kept();
    delete all[job];
    await x.store(KEY, JSON.stringify(all));
  });

  /** Each wallet as the core lists it, as the payee a payment from Private pays: only the person's own. */
  async function payees(parts: readonly PrivatePart[]): Promise<{ to: Payee; toTokenId?: string }[]> {
    const r = await x.trade().call<{ id: string; kind: string; chain: string; address?: string; oldWords?: boolean }[]>("subwallet.list", {});
    if ("problem" in r) throw new ProblemError(r.problem);
    // never a wallet the replaced backup words open (security audit 4 Nov, finding 2; QA's MUST on 97b7cdd8c):
    // after new words the new float is listed after the old one, and a stale or resumed id can still name an old one
    const list = r.ok.filter((w) => !w.oldWords);
    return parts.map((p) => {
      if (p.wallet === "near") {
        const float = list.find((w) => w.kind === "trade" && w.chain === "near" && typeof w.address === "string");
        if (!float) throw new ProblemError(walletProblems.recipientInvalid());
        return { to: { kind: "ledger", accountId: float.address!, confidential: true }, toTokenId: x.usdc };
      }
      const w = list.find((v) => v.id === p.wallet);
      if (!w || w.kind === "private" || !FLOAT_CHAINS.has(w.chain) || typeof w.address !== "string") throw new ProblemError(walletProblems.recipientInvalid());
      return { to: { kind: "chain", chain: w.chain, address: w.address } };
    });
  }

  /**
   * `p`: { parts: PrivatePart[] (1 to 4), tokenId? (the Safe's coin that fills Private when it is short; USDC by
   * default), label?, job? (the Move's key: its payments are kept under it), whole? (a site's top-up: a short leg is
   * filled whole, one fill and one exit) }. Answers each part's movements in the
   * order asked; a part that stopped after an earlier one went says why (`stopped`), the ones before it still go. A part
   * whose stop leaves its money unknown (partMayHaveGone) ends the Move there: no part after it starts, and each says so.
   */
  async function moveFromPrivate(p: Record<string, unknown>, asker: Caller): Promise<{ parts: KeptPart[] }> {
    await x.notForChild();
    // D146, as toTrading: Spending's engine asks as Trade for the app that asked it
    const caller: Caller = asker === "trade" && typeof p.for === "string" && x.spendingFor.has(p.for) ? p.for : asker;
    const raw = Array.isArray(p.parts) ? (p.parts as unknown[]) : [];
    const parts: PrivatePart[] = raw.map((r) => r as PrivatePart).filter((r) => r && typeof r.wallet === "string" && Number.isFinite(r.usd) && r.usd > 0 && (r.amount === undefined || /^\d{1,12}(\.\d{1,18})?$/.test(String(r.amount))));
    if (!parts.length || parts.length !== raw.length || parts.length > 4) throw new ProblemError(walletProblems.amountInvalid());
    const tokenId = typeof p.tokenId === "string" && p.tokenId ? p.tokenId : x.usdc;
    const job = typeof p.job === "string" && JOB.test(p.job) ? p.job : undefined;
    const label = typeof p.label === "string" ? p.label.slice(0, 120) : undefined;
    // a site's top-up (QA): Private short, one fill of the whole then one exit, never Private's part beside it
    const whole = p.whole === true;
    // Home's Swap paid through Private (the copy review's (c), 7 Nov): the Safe's sheet is titled as the Swap (the core checks the coin)
    const swap = p.swap === true;
    const [cat, s, to] = await Promise.all([x.catalogue(), x.sends(), payees(parts)]);
    const coin = cat.coin(x.originAsset(tokenId));
    if (!coin) throw new ProblemError(walletProblems.quoteUnavailable("That coin isn't listed."));
    const amountOf = (r: PrivatePart) => r.amount ?? r.usd.toFixed(2);
    const units = parts.map((r) => toUnits(amountOf(r), coin.decimals) ?? 0n);
    if (units.some((u) => u <= 0n)) throw new ProblemError(walletProblems.amountInvalid());
    const need = units.reduce((n, u) => n + u, 0n);
    // a dollar coin at $1 each, as every sheet says it; any other at its price
    const px = /^USD[CT]$/i.test(coin.symbol) || !(Number(coin.priceUsd) > 0) ? 1 : Number(coin.priceUsd);
    const usdOf = (u: bigint) => Number(fromUnits(u, coin.decimals)) * px;
    const short = (have: bigint, needed: bigint) => privateShort(usdOf(have), usdOf(needed));
    // Private short and the fill closed: the whole Move is refused here, before anything is kept or signed
    const share = await s.pocketShare(x.originAsset(tokenId));
    if (share < need && !x.fillOpen) throw new ProblemError(short(share, need));
    const at = x.now();
    // kept even with no job key: its payments' ends never sweep, and a fill holds the sweep (sweepHeld)
    const key = job ?? `pm-${at.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // the plan (the audit's ruling, 7 Nov: ONE fill for the whole Move, one Safe sheet, one Face ID): the core works it out from
    // these parts and Private's share and keeps it under this Move's key; every payment below is checked against it there.
    // The smallest parts first: Private pays each it covers whole; the rest are paid by the one fill
    const plan = (safeHas?: string) => x.core<{ fill: string; parts: { fromPrivate: string; viaFill: string; at: number }[] }>("subwallet.movePlan", { job: key, tokenId: x.originAsset(tokenId), parts: parts.map((r, i) => ({ wallet: r.wallet, units: units[i]!.toString() })), share: share.toString(), price: px, decimals: coin.decimals, ...(whole ? { whole: true } : {}), ...(safeHas ? { safeHas } : {}) });
    let split = await plan();
    // the Safe's route for the fill, read before anything is paid: a Safe that can't cover the step gets the fill sized
    // down to exactly what it pays (the plan made again, nothing taken from it yet); still too much, refused here
    let route = BigInt(split.fill) > 0n ? await s.fillRoute(tokenId, BigInt(split.fill)).catch((e) => {
      if (e instanceof ProblemError && e.problem.code === "ledger.balance.low") return null;
      throw e;
    }) : null;
    if (BigInt(split.fill) > 0n && !route) {
      split = await plan("0");
      route = await s.fillRoute(tokenId, BigInt(split.fill));
    }
    const order = parts.map((_, i) => i).sort((a, b) => split.parts[a]!.at - split.parts[b]!.at);
    const out = parts.map((r): KeptPart => ({ wallet: r.wallet, usd: r.usd, ids: [] }));
    let fillAt: number | undefined;
    await keep(key, { at, parts: out, paying: true });
    const pay = { tokenId, ...(label ? { label } : {}), job: key };
    /** A stop: where its money is (unsure: no Try again), and the parts after it said not started (audit, 6 Nov). */
    const stop = async (e: unknown, i: number, k: number): Promise<"thrown" | "halt" | "on"> => {
      const unknown = partMayHaveGone(e);
      // nothing went yet: the Problem as it is (the Move's job says it; nothing moved)
      if (!unknown && !out.some((r) => r.ids.length)) { await drop(key); return "thrown"; }
      if (e instanceof PartWent) out[i]!.ids = e.went.map((m) => m.id);
      // a fill may be among what went, so its extra stays in Private the 24 h (sweepHeld); a refused Safe's part brought none
      if (unknown && !(e instanceof ProblemError && e.problem.code === "ledger.send.part-went")) fillAt = x.now();
      out[i]!.stopped = e instanceof ProblemError ? e.problem.whatHappened : walletProblems.unexpectedMoney("").whatHappened;
      if (unknown) out[i]!.unsure = true;
      if (unknown) { for (const n of notStarted(order, units, share, k)) out[n.part]!.stopped = n.stopped; return "halt"; }
      return "on";
    };
    // Private's own payments first (no Safe sheet: a hot key), the smallest first: each part it pays whole, and its share
    // of the first part the fill pays
    let halted = false;
    for (const [k, i] of order.entries()) {
      const mine = BigInt(split.parts[i]!.fromPrivate);
      if (mine <= 0n) continue;
      try {
        const m = await s.payOwn({ ...pay, units: mine, to: to[i]!.to, ...(to[i]!.toTokenId ? { toTokenId: to[i]!.toTokenId } : {}) }, caller);
        out[i]!.ids.push(m.id);
        if (m.minOut) out[i]!.minOut = m.minOut;
      } catch (e) {
        const r = await stop(e, i, k);
        if (r === "thrown") throw e;
        // a part paid in pieces whose Private share stopped: the fill doesn't pay the rest of it
        split.parts[i]!.viaFill = "0";
        if (r === "halt") { halted = true; break; }
      }
      await keep(key, { at, parts: out, paying: true });
    }
    // then ONE fill for every part left: one leg 1, every leg 2 held for the Safe's one sheet
    const filling = order.filter((i) => BigInt(split.parts[i]!.viaFill) > 0n && !out[i]!.stopped);
    if (!halted && route && filling.length) {
      try {
        const ms = await s.fillMove({ ...pay, route, legs: filling.map((i) => ({ to: to[i]!.to, ...(to[i]!.toTokenId ? { toTokenId: to[i]!.toTokenId } : {}), units: BigInt(split.parts[i]!.viaFill) })), ...(parts.length > 1 ? { plan: units.map(String) } : {}), ...(swap ? { swap: true as const } : {}) }, caller);
        filling.forEach((i, n) => {
          const m = ms[n]!;
          out[i]!.ids.push(m.id);
          // what the wallet is promised, at least (audit, 5 Nov): its tick waits for a read that shows it
          const least = [out[i]!.minOut, m.minOut].reduce((t, v) => (v && /^\d{1,40}$/.test(v) ? t + BigInt(v) : t), 0n);
          if (least > 0n) out[i]!.minOut = least.toString();
        });
        fillAt = x.now();
      } catch (e) {
        // the fill's legs are one step: a stop says the same for each part it was to pay
        const unknown = partMayHaveGone(e);
        if (!unknown && !out.some((r) => r.ids.length)) { await drop(key); throw e; }
        if (unknown) fillAt = x.now();
        for (const i of filling) {
          // a part Private paid a share of keeps that payment: said as a part that went (pocketPartWent)
          const went = out[i]!.ids.length > 0;
          const p = e instanceof ProblemError ? (went ? pocketPartWent(e.problem) : e.problem) : walletProblems.unexpectedMoney("");
          out[i]!.stopped = p.whatHappened;
          if (unknown) out[i]!.unsure = true;
        }
      }
    }
    await keep(key, { at, parts: out, ...(fillAt ? { fillAt } : {}) });
    return { parts: out };
  }

  /** A Move's payments by its key, each with its movement's status now (a restart's Sends followed again first). Null:
   *  none kept (it never reached a payment). */
  async function privateMoveStatus(p: Record<string, unknown>): Promise<{ parts: { wallet: string; usd: number; stopped?: string; unsure?: true; moves: { id: string; status: string; problem?: string; money?: string }[] }[] } | null> {
    const job = typeof p.job === "string" && JOB.test(p.job) ? p.job : undefined;
    const rec = job ? (await kept())[job] : undefined;
    if (!rec) return null;
    await x.resume().catch(() => undefined);
    let ms = await x.loadMovements();
    // a payment whose money was on its way to Private: leg 1 read again, so its part says back in Private once it's there
    // (audit, 6 Nov); a read that fails or still says on its way keeps the hold
    const late = x.settleLate ? lateIds(rec.parts, ms) : [];
    if (late.length) {
      const changed = await Promise.all(late.map((id) => x.settleLate!(id).catch(() => false)));
      if (changed.some(Boolean)) ms = await x.loadMovements();
    }
    return { parts: rec.parts.map((r) => ({ wallet: r.wallet, usd: r.usd, ...(r.stopped ? { stopped: r.stopped } : {}), ...(r.unsure === true ? { unsure: true as const } : {}), moves: r.ids.map((id) => { const m = ms.find((v) => v.id === id); return { id, status: m?.status ?? "moving", ...(m?.problem ? { problem: m.problem.code, money: m.problem.money.state } : {}) }; }) })) };
  }

  return { moveFromPrivate, privateMoveStatus, noteFill };
}
