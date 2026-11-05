// AgentZero acts on the person's own rows and Hidden (D117): one core Approve per job fixes what it may do (which kinds,
// which places, which payees, a 24-hour limit in dollars, an end within 24 h); inside that, each act runs with no sheet,
// counted against the day BEFORE anything is signed, over "Ask me first" refused by name, never from the Safe. Loaded only
// when AgentZero asks (Home's first load stays lean). The money moves are the core's existing ones; nothing here signs:
// - move: Spending → a row (float out), a row → Spending (float in), Spending → the Safe (float home), Hidden → the Safe;
// - swap: inside Spending (the float's own swap), covered by the job at the core's own price;
// - trade: on the SOL row, through the trading day (account.agent.pocketSign); the core only checks and counts here;
// - send, pay: not yet (no sheet-free path from a row exists): refused by name.
import { ASK_FIRST_CODE, readAskAbove } from "./agent-private.ts";
import { ACT_MAX_USD, AGENT_ACT, AGENT_ACT_OFF, AGENTZERO_WALLET } from "./agent-route.ts";
import { dryRun } from "./dry-run.ts";
import { CHAIN_COIN, FLOAT_USDC, type TradeChain } from "./float-moves.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords } from "./signer.ts";

export const ACT_KINDS = ["send", "swap", "move", "pay", "trade"] as const;
export type ActKind = (typeof ACT_KINDS)[number];
/** Where an act may take money from: a Home row, Spending (the trading layer's own pot) or Hidden. Never the Safe. */
export const ACT_PLACES = ["sol", "hood", "near", "bsc", "spending", "hidden"] as const;
/**
 * AgentZero's sandbox (AGENTZERO-WALLET.md §1, L8; on with AGENTZERO_WALLET): its acts use its own wallet only, and its
 * Solana trades run on its own leg (agent/sol). Every person's wallet above, and the Safe, is refused by name.
 */
export const AGENT_ACT_PLACES = ["agent"] as const;
export type ActPlace = (typeof ACT_PLACES)[number] | (typeof AGENT_ACT_PLACES)[number];
/** The places an act may name: AgentZero's own wallet only once its wallet is on; today's places until then. */
export const actPlaces = (wallet: boolean): readonly ActPlace[] => (wallet ? AGENT_ACT_PLACES : ACT_PLACES);
// D124/D128/D129: the product money words (Trading's cash is the NEAR wallet; every move is private, so no Hidden).
const PLACE_NAME: Record<ActPlace | "safe", string> = { agent: "AgentZero's wallet", sol: "your SOL wallet", hood: "your ETH (RH) wallet", near: "your NEAR wallet", bsc: "your BNB wallet", spending: "your NEAR wallet", hidden: "your NEAR wallet", safe: "your Safe" };
const MAX_DAY_USD = ACT_MAX_USD;
const SCOPE_KEY = "agent-act-scope"; // ACT_SCOPE_KEY below

export interface ActScope {
  kinds: ActKind[];
  places: ActPlace[];
  payees: string[];
  dayUsd: number;
  endsAt: number;
  spentUsd: number;
  /** The acts already counted, by their key: asking again with the same key never counts twice (review Low). */
  counted?: string[];
}

/** What the core lends this file: its vault, its sheet, D103's check, prices, and the trading layer's own moves. */
export interface ActHost {
  vault: { get(n: string): Promise<Uint8Array | null>; put(n: string, b: Uint8Array): Promise<void>; delete(n: string): Promise<void> };
  approve(w: PlainWords): Promise<boolean>;
  strong(): Promise<void>;
  price(chain: "sol" | "bsc" | "hood" | "near"): Promise<number | null>;
  wallets: {
    floatOut(chain: unknown, slot: unknown, amount: unknown, key: unknown): Promise<unknown>;
    floatIn(chain: unknown, slot: unknown, amount: unknown, key: unknown): Promise<unknown>;
    floatHome(amount: unknown, key: unknown): Promise<unknown>;
    privateHome(tokenId: unknown, amount: unknown, key: unknown): Promise<unknown>;
    agentSwap(side: unknown, coin: unknown, amount: unknown, atLeast: unknown, key: unknown, cover: (usd: number) => boolean): Promise<unknown>;
  };
  /** The core's Stop count (SubWallets'): a Stop or pause since the scope was set ends it at once. */
  stops(): number;
  /** Paused or stopped on this phone (demo-core's flag, set at once by pause and Stop, cleared by Resume). */
  stopped?(): boolean;
  now?(): number;
  /** AgentZero's own wallet is on (AGENTZERO_WALLET, the default): its acts use only that wallet (AGENT_ACT_PLACES). */
  wallet?: boolean;
}

const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
const invalid = (why: string) => new ProblemError(securityProblems.requestInvalid(why));
const dollars = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

/** Each core's job scope (by its vault): in memory with the Stop count it was set at, and in the vault for a restart (a
 *  Stop deletes it there too: demo-core's pause and revoke). An ended, past or stopped one is dropped. */
const mem = new WeakMap<object, { held: ActScope | null; stops: number; loaded: boolean }>();
export const ACT_SCOPE_KEY = SCOPE_KEY;
async function scopeOf(h: ActHost): Promise<ActScope | null> {
  let m = mem.get(h.vault);
  if (!m) mem.set(h.vault, (m = { held: null, stops: h.stops(), loaded: false }));
  if (!m.loaded) {
    m.loaded = true;
    m.stops = h.stops();
    const raw = await h.vault.get(SCOPE_KEY).catch(() => null);
    try {
      m.held = raw ? (JSON.parse(new TextDecoder().decode(raw)) as ActScope) : null;
    } catch {
      m.held = null;
    }
  }
  if (m.held && (m.stops !== h.stops() || (h.now ?? Date.now)() >= m.held.endsAt)) await setScope(h, null);
  return m.held;
}
async function setScope(h: ActHost, s: ActScope | null): Promise<void> {
  const m = mem.get(h.vault) ?? { held: null, stops: h.stops(), loaded: true };
  m.held = s;
  m.stops = h.stops();
  mem.set(h.vault, m);
  if (s) await h.vault.put(SCOPE_KEY, new TextEncoder().encode(JSON.stringify(s)));
  else await h.vault.delete(SCOPE_KEY).catch(() => undefined);
}

/** An act's spend saved back (review High): only while this very scope is still the held one (a Stop clears it, and a
 *  cleared scope is never written back), and never touching the Stop count it was approved at (only actScope sets that). */
async function saveSpent(h: ActHost, s: ActScope): Promise<void> {
  if (mem.get(h.vault)?.held !== s) return;
  await h.vault.put(SCOPE_KEY, new TextEncoder().encode(JSON.stringify(s)));
}

/** A trade act's ticket (review Medium): the act binds the coin, the side and its dollars; the signing it allows
 *  (account.agent.pocketSign with this ticket) is charged to the job at the core's own value, once, before it's signed. */
interface Ticket {
  h: ActHost;
  scope: ActScope;
  stops: number;
  side: "buy" | "sell";
  coin: string;
  ceilingUsd: number;
  ask: number | null;
  key: string;
  until: number;
  used: boolean;
}
const tickets = new Map<string, Ticket>();
const TICKET_MS = 2 * 60_000;

/**
 * Charges a ticketed trade to its job, synchronously, between the trading day's own count and the signature (agent-pocket
 * sign): the signed swap must be the ticket's coin and side; a buy no more than the act's dollars (plus $1 of fees); "Ask
 * me first" and the job's day at the core's own value. Throws by name otherwise, and nothing is signed.
 */
export function ticketCharge(id: string, valueUsd: number, decoded: { swaps: { side: string; coin?: string }[] }, askNow: number | null = null): void {
  const t = tickets.get(id);
  const now = (t?.h.now ?? Date.now)();
  if (!t || t.used || now >= t.until) throw refused("That trade isn't allowed. Nothing was signed.");
  // The job ended (second review, Low): its ticket ends with it.
  if (now >= t.scope.endsAt) throw refused("This job has ended. Nothing was signed.");
  // A key already charged never charges again (second review, Medium): one act, one signing.
  if (t.scope.counted?.includes(t.key)) throw refused("That trade was already made. Nothing was signed.");
  if (t.h.stopped?.() || t.h.stops() !== t.stops || mem.get(t.h.vault)?.held !== t.scope) throw refused("AgentZero was stopped. Nothing was signed.");
  const swap = decoded.swaps.length === 1 ? decoded.swaps[0]! : null;
  if (!swap || swap.side !== t.side || swap.coin !== t.coin) throw refused("That isn't the trade AgentZero was asked for. Nothing was signed.");
  if (!(Number.isFinite(valueUsd) && valueUsd > 0)) throw refused("Its amount couldn't be read. Nothing was signed.");
  if (t.side === "buy" && valueUsd > t.ceilingUsd + 1) throw refused(`It costs more than the ${dollars(t.ceilingUsd)} asked. Nothing was signed.`);
  // "Ask me first" at the lower of the ticket's and today's (third check, Low: lowering it after the ticket was made
  // holds at once, as a tightening should).
  const ask = t.ask === null ? askNow : askNow === null ? t.ask : Math.min(t.ask, askNow);
  if (ask !== null && valueUsd > ask) throw askFirstError(ask);
  countOn(t.scope, valueUsd, t.key);
  t.used = true;
  tickets.delete(id);
  void saveSpent(t.h, t.scope).catch(() => undefined);
}

export const askFirstError = (ask: number) => new ProblemError({ ...securityProblems.requestNotAllowed(ask === 0 ? "AgentZero asks you first for every payment." : `It's over your $${ask}. AgentZero asks you first.`), code: ASK_FIRST_CODE });

/** Counts `n` dollars on the job's day, once per act key; throws by name over the day. */
function countOn(s: ActScope, n: number, key: string): void {
  if (s.counted?.includes(key)) return;
  if (!(Number.isFinite(n) && n > 0)) throw refused("Its amount couldn't be read. Nothing moved.");
  if (s.spentUsd + n > s.dayUsd + 0.004) throw refused(`Today's ${dollars(s.dayUsd)} for this job is used up. Nothing moved.`);
  s.spentUsd += n;
  s.counted = [...(s.counted ?? []), key].slice(-64);
}

function readScope(x: unknown, now: number, places0: readonly ActPlace[] = ACT_PLACES): Omit<ActScope, "spentUsd"> {
  const o = (x ?? {}) as Record<string, unknown>;
  const kinds = Array.isArray(o.kinds) ? o.kinds : [];
  const places = Array.isArray(o.places) ? o.places : [];
  const payees = Array.isArray(o.payees) ? o.payees : [];
  const day = Number(o.dayUsd), min = Number(o.minutes);
  if (!kinds.length || !kinds.every((k) => (ACT_KINDS as readonly unknown[]).includes(k))) throw invalid(`kinds: some of ${ACT_KINDS.join(", ")}`);
  if (!places.length || !places.every((p) => (places0 as readonly unknown[]).includes(p))) throw invalid(`places: some of ${places0.join(", ")} (never the Safe)`);
  if (payees.length > 16 || !payees.every((p) => typeof p === "string" && p.length >= 2 && p.length <= 128 && /^[\x21-\x7e]+$/.test(p))) throw invalid("payees: at most 16 addresses or names");
  if (!(Number.isFinite(day) && day > 0 && day <= MAX_DAY_USD)) throw invalid(`dayUsd: above $0, at most $${MAX_DAY_USD}`);
  if (!(Number.isInteger(min) && min >= 1 && min <= 24 * 60)) throw invalid("minutes: 1 to 1,440");
  return { kinds: [...new Set(kinds)] as ActKind[], places: [...new Set(places)] as ActPlace[], payees: [...new Set(payees as string[])], dayUsd: day, endsAt: now + min * 60_000 };
}

/** The new scope does no more than the old: fewer or the same kinds, places and payees, a lower day, an earlier end. */
const narrower = (n: Omit<ActScope, "spentUsd">, o: ActScope) =>
  n.kinds.every((k) => o.kinds.includes(k)) && n.places.every((p) => o.places.includes(p)) && n.payees.every((p) => o.payees.includes(p)) && n.dayUsd <= o.dayUsd && n.endsAt <= o.endsAt;

const KIND_WORDS: Record<ActKind, string> = { send: "send", swap: "swap", move: "move money", pay: "pay", trade: "buy and sell" };

/**
 * The scope's sheet (A-12): the dry run first ("Here's what I'd do:", its steps, "3 steps, $10 most.", "Never your
 * Safe."), the day limit being the most it can cost; then the rest. Throws by name when a step can't be priced: no sheet,
 * no Approve.
 */
function scopeWords(s: Omit<ActScope, "spentUsd">): PlainWords {
  const until = new Date(s.endsAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const plan = dryRun(
    [
      { words: `When you ask, ${s.kinds.map((k) => KIND_WORDS[k]).join(", ")}: up to ${dollars(s.dayUsd)} in all.`, usd: s.dayUsd },
      { words: `Only from ${[...new Set(s.places.map((p) => PLACE_NAME[p]))].join(", ")}.`, usd: 0 },
      { words: `Stop at ${until}, or when you say.`, usd: 0 },
    ],
    { never: ["Never takes from your Safe.", ...(s.payees.length ? [`Never anyone but ${s.payees.join(", ")}.`] : [])] },
  );
  if (!plan.canApprove) throw refused(`${plan.lines.find((l) => l.startsWith("I can't tell")) ?? "I can't tell what it costs."} Nothing was allowed.`);
  return { title: "Let AgentZero act for you", lines: [...plan.lines, "Stop AgentZero any time."], warnings: [], effect: [] };
}

/** account.agent.actScope: read it; end it (at once); set it (narrower: at once; anything more: D103's check and the sheet). */
export async function actScope(p: Record<string, unknown>, h: ActHost): Promise<{ scope: ActScope | null } | { declined: true }> {
  const now = (h.now ?? Date.now)();
  const cur = await scopeOf(h);
  if (p.end) return await setScope(h, null), { scope: null };
  if (p.set === undefined) return { scope: cur };
  const next = readScope(p.set, now, actPlaces(h.wallet ?? AGENTZERO_WALLET));
  if (h.stopped?.()) throw refused("AgentZero is paused. Resume it first.");
  if (cur && narrower(next, cur)) {
    const s = { ...next, spentUsd: cur.spentUsd };
    await setScope(h, s);
    return { scope: s };
  }
  const stops = h.stops();
  await h.strong();
  if (!(await h.approve(scopeWords(next)).catch(() => false))) return { declined: true };
  if (h.stops() !== stops) throw refused("AgentZero was stopped. Nothing was allowed.");
  const s = { ...next, spentUsd: 0 };
  await setScope(h, s);
  return { scope: s };
}

const placeOf = (x: unknown, what: string, places: readonly ActPlace[]): ActPlace | "safe" => {
  if (x === "safe") return "safe";
  if ((places as readonly unknown[]).includes(x)) return x as ActPlace;
  // The sandbox (L8): a person's wallet is refused by its own name, never read as a bad input.
  if (places === AGENT_ACT_PLACES && (ACT_PLACES as readonly unknown[]).includes(x)) throw refused(`AgentZero uses only its own wallet, never ${PLACE_NAME[x as ActPlace]}. Nothing moved.`);
  throw invalid(`${what}: one of ${places.join(", ")}${what === "to" ? ", or safe" : ""}`);
};

/**
 * account.agent.act: one act inside the job's scope. Refused by name outside it, from the Safe, over "Ask me first" or
 * over the day; counted before any signature (a swap at the core's own price, inside the float's own swap).
 */
export async function act(p: Record<string, unknown>, h: ActHost): Promise<{ line: string; usd: number; done: unknown }> {
  const kind = p.kind as ActKind;
  // The Stop count as this act starts (review High): a Stop or pause any time before a move is made stops it.
  const stops0 = h.stops();
  const live = () => {
    if (h.stopped?.() || h.stops() !== stops0) throw refused("AgentZero was stopped. Nothing moved.");
  };
  if (!(ACT_KINDS as readonly unknown[]).includes(kind)) throw invalid(`kind: one of ${ACT_KINDS.join(", ")}`);
  // Never from the Safe, whatever else is asked (D117): before anything else is read.
  if (p.from === "safe") throw refused("AgentZero never takes money from your Safe. Nothing moved.");
  const places = actPlaces(h.wallet ?? AGENTZERO_WALLET);
  const from = placeOf(p.from, "from", places) as ActPlace;
  const to = kind === "move" ? placeOf(p.to, "to", places) : null;
  const usd = Number(p.usd);
  if (!(Number.isFinite(usd) && usd > 0)) throw invalid("usd: the act's worth in dollars, above $0");
  if (typeof p.key !== "string" || !/^[\w-]{8,64}$/.test(p.key)) throw invalid("key: the act's own id (8 to 64 letters), so asking again is safe");
  // Paused or stopped here: nothing, even before a saved scope is read back (security re-read: a Stop's vault delete is async).
  if (h.stopped?.()) throw refused("AgentZero is paused. Nothing moved.");
  const s = await scopeOf(h);
  if (!s) throw refused("AgentZero isn't allowed to act today. Open ZeroFee and approve a job.");
  if (!s.kinds.includes(kind)) throw refused(`This job doesn't let AgentZero ${kind}. Nothing moved.`);
  if (!s.places.includes(from)) throw refused(`This job doesn't let AgentZero use ${PLACE_NAME[from]}. Nothing moved.`);
  if (to && to !== "safe" && !s.places.includes(to)) throw refused(`This job doesn't let AgentZero use ${PLACE_NAME[to]}. Nothing moved.`);
  if (kind === "send" || kind === "pay") throw refused(`AgentZero can't ${kind} from ${PLACE_NAME[from]} yet. Nothing was sent.`);
  const ask = await readAskAbove(h.vault);
  // A move's dollars are what it moves (its units come from them at the core's price); a swap's and a trade's are checked
  // at the core's own value where they're counted (review Medium: a sale's dollars from the app mean nothing).
  if (ask !== null && kind === "move" && usd > ask) throw askFirstError(ask);
  live();
  const key = `act-${p.key}`;
  // Counted before anything is signed: two acts at once can't both pass on the same day's total; Stopped: nothing.
  const count = (n: number) => {
    live();
    countOn(s, n, key);
  };

  if (kind === "trade") {
    // On Solana: the SOL wallet today; with its own wallet on, AgentZero's own leg (agent/sol, agent-pocket's day).
    if (from !== (places === AGENT_ACT_PLACES ? "agent" : "sol")) throw refused("AgentZero trades on Solana for now. Nothing moved.");
    const side = p.side === "sell" ? "sell" : p.side === "buy" ? "buy" : null;
    if (!side || typeof p.coin !== "string" || !p.coin) throw invalid('side: "buy" or "sell"; coin: the coin\'s mint');
    // A key whose trade was already charged mints no new ticket (second review, Medium: reusing one key let five $4 buys
    // sign on a $5 job, each new ticket's charge skipping the count as "already counted").
    if (s.counted?.includes(key)) throw refused("That trade was already made. Nothing was signed.");
    // Not counted here: the signing this ticket allows is charged at the core's own value, before it's signed.
    const id = `tk-${p.key}`;
    tickets.set(id, { h, scope: s, stops: stops0, side, coin: p.coin, ceilingUsd: usd, ask, key, until: (h.now ?? Date.now)() + TICKET_MS, used: false });
    return { line: `${side === "sell" ? "Selling" : "Buying"} ${dollars(usd)} on Solana.`, usd, done: { go: true, ticket: id } };
  }

  if (kind === "swap") {
    if (from !== "spending") throw refused(`AgentZero swaps inside your NEAR wallet for now, not in ${PLACE_NAME[from]}. Nothing moved.`);
    const side = p.side === "sell" ? "sell" : p.side === "buy" ? "buy" : null;
    if (!side || typeof p.coin !== "string") throw invalid('side: "buy" or "sell"; coin: a NEAR coin\'s id');
    const units = side === "buy" ? String(Math.round(usd * 1e6)) : typeof p.amount === "string" ? p.amount : null;
    if (!units) throw invalid("amount: the coin's smallest units to sell, as text");
    const atLeast = typeof p.atLeast === "string" ? p.atLeast : "0";
    let counted = 0;
    // The job covers it at the core's own price (its ask), never the app's dollars: over the day it's refused.
    const done = await h.wallets.agentSwap(side, p.coin, units, atLeast, key, (real) => {
      // At the core's own price (review Medium): "Ask me first" and the day both read this, never the app's dollars.
      if (ask !== null && real > ask) throw askFirstError(ask);
      count(real);
      counted = real;
      return true;
    });
    await saveSpent(h, s);
    return { line: `Swapped ${dollars(Math.round((counted || usd) * 100) / 100)} inside your NEAR wallet.`, usd: counted || usd, done };
  }

  // move
  const chainMove = async (chain: TradeChain, dir: "out" | "in") => {
    const coin = CHAIN_COIN[chain];
    if (!coin.open) throw refused(`AgentZero can't move money on ${PLACE_NAME[chain]} yet. Nothing moved.`);
    const px = await h.price(chain).catch(() => null);
    live();
    if (!(typeof px === "number" && Number.isFinite(px) && px > 0)) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
    const units = BigInt(Math.floor((usd / px) * 10 ** Math.min(coin.decimals, 15))) * 10n ** BigInt(Math.max(0, coin.decimals - 15));
    if (units <= 0n) throw refused("That's too little to move. Nothing moved.");
    count(usd);
    await saveSpent(h, s);
    live();
    return dir === "out" ? h.wallets.floatOut(chain, undefined, units.toString(), key) : h.wallets.floatIn(chain, undefined, units.toString(), key);
  };
  // A Stop that landed while the move itself ran (second review, Low): the move had already started, and the line says so.
  const stoppedDuring = () => !!h.stopped?.() || h.stops() !== stops0;
  let done: unknown;
  if (from === "spending" && (to === "sol" || to === "hood" || to === "bsc")) done = await chainMove(to, "out");
  else if ((from === "sol" || from === "hood" || from === "bsc") && to === "spending") done = await chainMove(from, "in");
  else if (from === "spending" && to === "safe") {
    count(usd);
    await saveSpent(h, s);
    live();
    done = await h.wallets.floatHome(String(Math.round(usd * 1e6)), key);
  } else if (from === "hidden" && to === "safe") {
    count(usd);
    await saveSpent(h, s);
    live();
    done = await h.wallets.privateHome(FLOAT_USDC, String(Math.round(usd * 1e6)), key);
  } else throw refused(`AgentZero can't move from ${PLACE_NAME[from]} to ${PLACE_NAME[to!]} yet. Nothing moved.`);
  if (stoppedDuring()) return { line: `You stopped AgentZero while it was moving ${dollars(usd)} from ${PLACE_NAME[from]} to ${PLACE_NAME[to!]}. That move had already started. Check Activity.`, usd, done };
  return { line: `Moved ${dollars(usd)} from ${PLACE_NAME[from]} to ${PLACE_NAME[to!]}.`, usd, done };
}

/** The core's two doors (only the agent app and ZeroFee's own screens reach account.agent.*). */
export function actCall(method: string, p: Record<string, unknown>, h: ActHost, on = AGENT_ACT): Promise<unknown> {
  // Off until reviewed: both doors refuse by name and nothing moves (reading the scope included, so no screen offers it).
  if (!on) return Promise.reject(new ProblemError(securityProblems.requestNotAllowed(AGENT_ACT_OFF)));
  return method === "account.agent.actScope" ? actScope(p, h) : act(p, h);
}
