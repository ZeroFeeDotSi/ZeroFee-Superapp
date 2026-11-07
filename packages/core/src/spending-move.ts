// spending.move (the Home plan §2, E5) and spending.makeReady (moved here as it was), loaded with their first use (Home's first load stays inside its budget): Home's Move
// and Swap between the person's own wallets. `from`'s own coin to `to`'s wallet (SOL → ETH (RH)), or between a wallet and
// the NEAR wallet's cash ("near"), through Trading's confidential balance on NEAR, as one saved job (the engine's
// between, packages/trade float-two.ts). No sheet: money only moves between the person's own wallets (the core's fee
// guard asks past its daily bound). `key` (16 to 62 letters, digits, - or _): asking again with it gives the same move.
// Types only from spending.ts: its values come in `lib` (the bundler then never splits spending.ts out of Home's chunk).
import type { EngineMove, EngineSnapshot, SpendingActivity, SpendingEngine, SpendingLib, SpendingNetwork } from "./spending.ts";
/**
 * C2 (the audit's five conditions, 7 Nov): a Move's wallet parts, kept for its one Safe sheet (move-plan.ts othersForSheet) and
 * to cap its wallet legs. Here, off Home's first load and with no import (an import would put a preload list in Home's
 * first load): the store is one per JS realm, by the symbol move-plan.ts OTHERS_STORE names.
 */
type Part = { from: string; to: string; cents: string };
type Kept = { parts: Part[]; atMs: number; dep?: string; used: Set<number> } | { ended: true; atMs: number };
const OTHERS_MS = 10 * 60_000;
const kept = (): Map<string, Kept> => ((globalThis as Record<symbol, Map<string, Kept>>)[Symbol.for("zerofee.move-others")] ??= new Map());
const WALLETS = ["sol", "hood", "near", "bsc"];
/** The page's parts against the engine's own read (EngineSnapshot): each from one wallet place to another, at least a
 *  cent, the parts from one wallet together at most what the read shows it holds (a chain's coins, cash and native; the
 *  NEAR wallet's cash). One part not so: null, none kept (the sheet says the Safe's side only). Pure: a table test. */
export function confirmOthers(raw: unknown, read: { reserveUsd: number; chains: readonly { chain: string; nativeUsd: number; readyUsd: number; coinsUsd: number; unread?: true; closed?: true }[] }): Part[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 6) return null;
  const out: Part[] = [];
  const from = new Map<string, number>();
  for (const x of raw as { from?: unknown; to?: unknown; usd?: unknown }[]) {
    const usd = Number(x?.usd);
    if (typeof x?.from !== "string" || typeof x.to !== "string" || !WALLETS.includes(x.from) || !WALLETS.includes(x.to) || x.from === x.to || typeof x.usd !== "number" || !(Number.isFinite(usd) && usd >= 0.01)) return null;
    const cents = Math.round(usd * 100);
    from.set(x.from, (from.get(x.from) ?? 0) + cents);
    out.push({ from: x.from, to: x.to, cents: String(cents) });
  }
  for (const [w, c] of from) {
    const ch = w === "near" ? null : read.chains.find((x) => x.chain === w);
    const has = w === "near" ? read.reserveUsd : ch && !ch.unread && !ch.closed ? ch.nativeUsd + ch.readyUsd + ch.coinsUsd : NaN;
    if (!(Number.isFinite(has) && c <= Math.round(has * 100))) return null;
  }
  return out;
}
/** Keeps the checked parts under the Move's key; null: none (and nothing older under it). */
export function keepOthers(job: string, parts: Part[] | null, now = Date.now()): void {
  for (const [k, v] of kept()) if (now - v.atMs > OTHERS_MS) kept().delete(k);
  if (parts?.length) kept().set(job, { parts, atMs: now, used: new Set() }); else kept().delete(job);
}
/** spending.topUp's keep: the page's parts checked against the engine's read, kept (none confirmed: none kept). */
export const keepFor = (job: string, raw: unknown, read: EngineSnapshot): void => keepOthers(job, raw === undefined ? null : confirmOthers(raw, read));
/** C2 on the phone (the audit's shape, 7 Nov): the page's parts as they cross to the core (subwallet.moveOthers), each its
 *  figure in whole cents; one not a figure: none cross. Pure: a table test. */
export function othersToCross(raw: unknown): Part[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 6) return null;
  const out = (raw as { from?: unknown; to?: unknown; usd?: unknown }[]).map((x) => ({ from: x?.from, to: x?.to, cents: typeof x?.usd === "number" && Number.isFinite(x.usd) && x.usd >= 0.01 ? String(Math.round(x.usd * 100)) : "" }));
  return othersWellFormed(out);
}
/** What the core takes (the phone's allow-list says the same, IsolatedCore.swift othersWellFormed): 1 to 6 parts, each
 *  exactly { from, to, cents }, two different wallet places and whole cents above 0; anything else: none. Pure. */
export function othersWellFormed(raw: unknown): Part[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 6) return null;
  const ok = raw.every((x) => !!x && typeof x === "object" && Object.keys(x).length === 3 && WALLETS.includes(x.from) && WALLETS.includes(x.to) && x.from !== x.to && typeof x.cents === "string" && /^\d{1,12}$/.test(x.cents) && BigInt(x.cents) > 0n);
  return ok ? (raw as Part[]).map((x) => ({ from: x.from, to: x.to, cents: x.cents })) : null;
}
/** The core's own keep (subwallet.moveOthers; on the phone, in the isolated core): the parts well formed, then checked
 *  against the core's OWN read of each wallet they come from (`read`), so the page's figures can only lower it. */
export async function keepInCore(job: string, raw: unknown, read: (from: string[]) => Promise<Parameters<typeof confirmOthers>[1]>): Promise<number> {
  const parts = othersWellFormed(raw), started = Date.now();
  const has = parts ? await read([...new Set(parts.map((x) => x.from))]).catch(() => null) : null;
  // ended while it was read (Not now before the read came back): it stays ended
  const was = kept().get(job);
  if (was && "ended" in was && was.atMs >= started) return 0;
  const ok = parts && has ? confirmOthers(parts.map((x) => ({ from: x.from, to: x.to, usd: Number(x.cents) / 100 })), has) : null;
  keepOthers(job, ok);
  return ok?.length ?? 0;
}
/** The Safe's step ended with no yes (Not now, Close, a refusal): the parts go, and a leg still carrying the key is refused. */
export function endOthers(job: string, now = Date.now()): void { kept().set(job, { ended: true, atMs: now }); }
/** move-plan.ts planLegRefusal's words (a table test holds them equal). */
export const LEG_CAP_WORDS = {
  gone: "This phone no longer has this Move's plan, so ZeroFee stopped this. Nothing moved.",
  none: "That wallet isn't in this Move's plan, so ZeroFee stopped this. Nothing moved.",
  more: "That wallet would get more than this Move planned, so ZeroFee stopped this. Nothing moved.",
} as const;
/** A wallet leg of a Move (spending.move with `job`): at most its kept part (that wallet to that wallet), each part once.
 *  Null: it goes as asked; a string: refused by name; a number: it goes as that many dollars. Nothing kept under the
 *  key: as before (the sheet named no part). "all" (a leg that empties its wallet, move-split's L3; the audit's MUST, 7 Nov):
 *  `held`, the wallet's dollars as the engine read it just now, at most its part plus the drift (2 % of the part, at least
 *  $0.50): "all" goes; more (a deposit or a trade landed since the sheet), or not read: exactly its part. */
export function legCap(job: unknown, from: string, to: string, usd: number | "all", held?: number, now = Date.now()): string | number | null {
  if (typeof job !== "string") return null;
  const k = kept().get(job);
  if (!k || now - k.atMs > OTHERS_MS) return null;
  if ("ended" in k) return LEG_CAP_WORDS.gone;
  const i = k.parts.findIndex((p, n) => p.from === from && p.to === to && !k.used.has(n));
  if (i < 0) return LEG_CAP_WORDS.none;
  const part = Number(k.parts[i]!.cents);
  if (usd !== "all" && Math.round(usd * 100) > part) return LEG_CAP_WORDS.more;
  k.used.add(i);
  if (k.used.size === k.parts.length) kept().delete(job);
  if (usd !== "all") return null;
  return held !== undefined && Number.isFinite(held) && Math.round(held * 100) <= part + Math.max(Math.ceil(part * 0.02), 50) ? null : part / 100;
}
// lap FAIL 2: spending.topUp's promised-money check rides this lazy part (spending-taken.ts)
export { taken } from "./spending-taken.ts";

const PLACES = ["sol", "hood", "bsc", "near"];
/** What Spending hands over: its engine, its readable check and its rows' words. */
type Ctx = { engine: () => SpendingEngine; readable: (e: SpendingEngine) => EngineSnapshot; activityOf: (m: EngineMove) => SpendingActivity; lib: SpendingLib; call<T>(method: string, params: Record<string, unknown>): Promise<T>; pairs?: boolean };

/**
 * The NEAR coin wallet (Rhea trades, 3 Nov; D153/D70) as a place of Spending's: "nearcoin". Only through NEAR
 * Confidential: Spending's cash ("near") → it is the core's confidential Make ready (subwallet.float.nearOut), it →
 * Spending's cash its Put away (subwallet.float.nearIn). Any other place reaches it through Spending's cash (two moves:
 * the Safe by a Top up first, a chain wallet by spending.move to "near" first), never by a public send.
 */
export const NEAR_COIN_PLACE = "nearcoin";
async function nearCoinMove(s: Ctx, dir: "in" | "out", usd: number | "all", key: string, why: "ready" | "asked"): Promise<SpendingActivity> {
  const m = await s.call<{ id: string; kind: string; status: string; usd: number; startedAtIso: string; reason?: string } | { declined: true }>(dir === "out" ? "subwallet.float.nearOut" : "subwallet.float.nearIn", { key, ...(usd === "all" ? { amount: "all" } : { usd }) });
  if ("declined" in m) throw new s.lib.ProblemError({ code: "spending.move.declined", whatHappened: "Nothing moved.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } });
  return nearCoinActivity(m, dir, why);
}
/** A NEAR coin wallet move as Spending's Activity says it ("Moving $2.00 to your NEAR coin wallet"). */
export function nearCoinActivity(m: { id: string; status: string; usd: number; startedAtIso: string; reason?: string }, dir: "in" | "out", why: "ready" | "asked"): SpendingActivity {
  const status: SpendingActivity["status"] = m.status === "pending" ? "on-its-way" : m.status === "done" ? "done" : m.status === "refunded" ? "refunded" : "failed";
  const usd = `$${m.usd.toFixed(2)}`, done = status === "done", ended = status === "failed" || status === "refunded";
  const words = dir === "out" ? `${ended ? "Didn't move" : done ? "Moved" : "Moving"} ${usd} to your NEAR coin wallet` : `${ended ? "Didn't bring" : done ? "Brought" : "Bringing"} ${usd} back from your NEAR coin wallet`;
  return { id: m.id, kind: dir === "out" ? (why === "ready" ? "ready" : "move") : "move", usd: m.usd.toFixed(2), status, shown: true, atIso: m.startedAtIso, words, place: NEAR_COIN_PLACE, ...(m.reason && ended ? { note: m.reason } : {}) };
}

export async function move(s: Ctx, p: Record<string, unknown>): Promise<SpendingActivity> {
  const { ProblemError, securityProblems, spendingProblems, NETWORK_NAME, SPENDING_MIN_MOVE_USD, PAIR_MIN_USD } = s.lib;
  const from = p.from, to = p.to;
  // the NEAR coin wallet: to and from Spending's cash only (each leg private); anything else goes through the cash
  if (from === NEAR_COIN_PLACE || to === NEAR_COIN_PLACE) {
    const other = from === NEAR_COIN_PLACE ? to : from;
    if (other !== "near") throw new ProblemError(securityProblems.requestInvalid("the NEAR coin wallet moves to and from your NEAR wallet's cash; other places go through it"));
    if (typeof p.key !== "string" || !/^[A-Za-z0-9_-]{16,62}$/.test(p.key)) throw new ProblemError(securityProblems.requestInvalid("key is this move's own id: 16 to 62 letters, digits, - or _"));
    const amount = p.usd === "all" ? "all" as const : Number(p.usd);
    if (amount === "all" ? to === NEAR_COIN_PLACE : !(Number.isFinite(amount) && amount >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
    return nearCoinMove(s, to === NEAR_COIN_PLACE ? "out" : "in", amount, p.key, "asked");
  }
  if (typeof from !== "string" || typeof to !== "string" || !PLACES.includes(from) || !PLACES.includes(to)) throw new ProblemError(securityProblems.requestInvalid("from and to are sol, hood, bsc or near"));
  if (from === to) throw new ProblemError(securityProblems.requestInvalid("from and to are two different wallets"));
  if (typeof p.key !== "string" || !/^[A-Za-z0-9_-]{16,62}$/.test(p.key)) throw new ProblemError(securityProblems.requestInvalid("key is this move's own id: 16 to 62 letters, digits, - or _"));
  const all = p.usd === "all";
  const usd = all ? "all" as const : Number(p.usd);
  if (usd !== "all" && !(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
  if (all && from === "near") throw new ProblemError(securityProblems.requestInvalid("the NEAR wallet's cash moves by an amount"));
  // between two chains' wallets (E5's two legs) only once the $1 proof opened it (review L9); to and from the NEAR
  // wallet is one leg and always goes
  if (from !== "near" && to !== "near" && !s.pairs) throw new ProblemError({ code: "spending.move.not-open", whatHappened: "Moves between two wallets open after their $1 test.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } });
  // between two chains, the least that still arrives (review M1): under it the second leg could stop in the NEAR wallet
  if (usd !== "all" && from !== "near" && to !== "near" && usd < PAIR_MIN_USD) throw new ProblemError({ ...spendingProblems.tooSmall(), whatHappened: `A move between two wallets starts at $${PAIR_MIN_USD.toFixed(2)}.` });
  const e = s.engine();
  if (!e.between) throw new ProblemError(spendingProblems.notReady());
  await e.refresh();
  const snap = s.readable(e);
  const shut = [from, to].find((c) => c !== "near" && snap.chains.find((x) => x.chain === c)?.closed);
  if (shut) throw new ProblemError(spendingProblems.networkClosed(NETWORK_NAME[shut as SpendingNetwork]));
  // C2 (the audit's condition 1 and MUST, 7 Nov): a Move's wallet leg carries its key, and is at most the part its Safe sheet
  // said, once; "all" goes only while the wallet, read just now, holds about that part, else exactly the part
  const w = snap.chains.find((x) => x.chain === from);
  const capped = p.job === undefined ? null : legCap(p.job, from, to, usd, w && !w.unread ? w.nativeUsd + w.readyUsd + w.coinsUsd : undefined);
  if (typeof capped === "string") throw new ProblemError(securityProblems.subwalletRefused(capped));
  // read once (the refresh above): between() takes this read, never a second one back to back (speed, D145)
  return s.activityOf(await e.between({ from: from as SpendingNetwork | "near", to: to as SpendingNetwork | "near", usd: typeof capped === "number" ? capped : usd as number | "all", key: p.key, refreshed: true }));
}

/** Make ready (D55): Spending's cash → that network's one wallet now, for Apps and Chat (no sheet: money between the
 *  person's own wallets, through Spending's private route). More than the cash: Top up first. */
export async function makeReady(s: Ctx, p: Record<string, unknown>): Promise<SpendingActivity> {
  const { ProblemError, securityProblems, spendingProblems, NETWORK_NAME, SPENDING_MIN_MOVE_USD, SPENDING_NETWORKS, isAgentPocket } = s.lib;
  const network = p.network as SpendingNetwork;
  // the NEAR coin wallet (Rhea trades): Spending's cash to it, through NEAR Confidential (subwallet.float.nearOut)
  if ((p.network as string) === NEAR_COIN_PLACE) {
    const usd = Number(p.usd);
    if (!(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
    return nearCoinMove(s, "out", usd, `ready-nearcoin-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, "ready");
  }
  if (!(SPENDING_NETWORKS as readonly string[]).includes(network)) throw new ProblemError(securityProblems.requestInvalid("network is sol, hood, bsc or nearcoin"));
  const usd = Number(p.usd);
  if (!(Number.isFinite(usd) && usd >= SPENDING_MIN_MOVE_USD)) throw new ProblemError(spendingProblems.tooSmall());
  const e = s.engine();
  await e.refresh();
  const snap = s.readable(e);
  if (snap.chains.find((c) => c.chain === network)?.closed) throw new ProblemError(spendingProblems.networkClosed(NETWORK_NAME[network]));
  if (usd > snap.reserveUsd) throw new ProblemError(spendingProblems.readyShort(snap.reserveUsd));
  // `wallet`: a site's own wallet on that network (its settings' Make ready), never one of replaced words; none: the
  // network's one wallet
  if (p.wallet !== undefined) {
    const w = (await s.call<{ id: string; kind: string; chain: string; oldWords?: boolean }[]>("subwallet.list", {})).find((x) => x.id === p.wallet);
    if (!w || w.kind !== "site" || w.chain !== network || w.oldWords) throw new ProblemError(securityProblems.subwalletUnknown());
    // Never AgentZero's pocket: Make ready asks no one, and the pocket is AgentZero's budget (D90; P1's review).
    if (isAgentPocket((w as { site?: string }).site)) throw new ProblemError(securityProblems.subwalletRefused("AgentZero's pocket is never filled. Its money moves to your SOL wallet."));
    return s.activityOf(await e.moveNow(network, usd, { wallet: w.id, why: "ready" }));
  }
  return s.activityOf(await e.moveNow(network, usd, { why: "ready" }));
}

/**
 * UI's AgentZero walk (3 Nov: a $20 Move passed Face ID, then stopped on the way): before the Approve, every leg on to a
 * wallet at its least after its fees (the Add brings at least 99 %, the move on keeps 3 %, and the core refuses a move
 * under $2: $2.09), and its coin's price read now, since the leg is sized at it when it goes on. `home`: a take-out's
 * legs home, each wallet's at least $2.59 (its move in brings at least leastIn(99 %), and a move home under $2
 * is refused in the NEAR wallet). Said with the least; nothing moved.
 */
export async function legsFit(lib: SpendingLib, legs: readonly { chain: SpendingNetwork | "near"; usd: number | "all" }[], home: boolean, price?: (c: SpendingNetwork) => Promise<number>, call?: <T>(method: string, params: Record<string, unknown>) => Promise<T>): Promise<void> {
  const least = home ? lib.HOME_LEG_MIN_USD : lib.SAFE_LEG_MIN_USD;
  if (legs.some((l) => l.chain !== "near" && l.usd !== "all" && l.usd < least - 0.004)) {
    throw new lib.ProblemError({ code: "spending.move.legs", whatHappened: `At least $${lib.usdText(least)} ${home ? "from a wallet to your Safe" : "from your Safe to a wallet"}. Nothing moved.`, money: { state: "safe", where: "where it was" }, next: { kind: "fix-input", label: "Change the amounts", field: "usd" } });
  }
  const chains = home || !price ? [] : [...new Set(legs.map((l) => l.chain))].filter((c): c is SpendingNetwork => c !== "near");
  if (!chains.length) return;
  // the core's own price (what its moves are held to), read only; a core from before it says none: no check here
  // both prices read at once (speed, 5 Nov), each leg still checked in order
  const [core, ...pxs] = await Promise.all([
    call ? call<{ prices?: Partial<Record<SpendingNetwork, number | null>> }>("subwallet.float.limits", { prices: true }).then((r) => r?.prices, () => undefined) : undefined,
    ...chains.map((c) => price!(c).catch(() => 0)),
  ]);
  for (const [i, c] of chains.entries()) {
    const px = pxs[i]!;
    const at = core ? core[c] : px;
    if (!(px > 0) || !(at !== null && at !== undefined && at > 0)) throw new lib.ProblemError({ ...lib.securityProblems.partnerUnreachable("the price service"), whatHappened: `${lib.NETWORK_NAME[c]}'s price isn't read yet. Nothing moved.` });
    // the leg is sized at the sheet's price and charged at the core's: further apart than the core's own bound (3 %), it
    // would stop on the way, so it never reaches Face ID
    if (at > px * lib.MAX_OVER || px > at * lib.MAX_OVER) throw new lib.ProblemError({ code: "spending.move.price", whatHappened: `${COIN[c]}'s price changed. Nothing moved. Try again.`, money: { state: "safe", where: "where it was" }, next: { kind: "retry", label: "Try again" } });
  }
}
const COIN: Record<SpendingNetwork, string> = { sol: "SOL", hood: "ETH", bsc: "BNB" };
