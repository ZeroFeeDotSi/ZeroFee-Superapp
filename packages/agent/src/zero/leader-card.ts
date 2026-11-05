// ST-C (master plan Part 1 §5): the leader's report card. Before a person copies a wallet, its last 30 days of pump.fun
// trades, read from Solana's own record (the same nodes and the same pump.fun / PumpSwap filter as the copy job's watch),
// never guessed. Each figure that can't be read says "Not known". Read-only: no key, no signature, no new host, no
// analytics service (the nodes Trade already uses see the address, as the copy job's watch does).
//
// What counts:
// - A trade: a transaction that touched pump.fun or PumpSwap in which the wallet's balance of ONE coin moved one way and
//   its SOL (lamports plus wrapped SOL) the other way. Anything else (a transfer, several coins at once) is not a trade.
// - A coin won or lost: one it bought AND sold all of inside the window; won when the SOL back beat the SOL in (fees
//   included: they left the wallet). A coin bought before the window, or still held, has no result here: "Not known".
// - The result: SOL back minus SOL in over those closed coins. Dollars first, at today's SOL price, and said so: Solana's
//   record has no dollar price for a past day.
// - The nodes are shared with the trade path (B36): a refusal (429) or no answer BACKS OFF (1 s, 2 s, 4 s) and after the
//   third the card stops with "Solana didn't answer." Never more than MAX_TXS transactions; 10 at once until the first
//   refusal, then one at a time.
import type { RpcCall } from "./copy-watch.ts";

export const CARD_DAYS = 30;
/** The most transactions one card reads (public nodes: 10 at once, a few seconds in all). */
export const MAX_TXS = 300;
const PAGE = 100;
const AT_ONCE = 10;
/** The pause between batches of reads (review M5): 300 transactions take about 8 s, never a burst. */
export const PACE_MS = 250;
const DAY = 86_400_000;
const PUMP = new Set(["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"]);
const WSOL = "So11111111111111111111111111111111111111112";

export interface LeaderMove { mint: string; side: "buy" | "sell"; /** the coin's units in (+) or out (−) */ units: bigint; /** SOL in lamports: out (−) on a buy, back (+) on a sale */ lamports: bigint; t?: number }

/** One parsed transaction (jsonParsed) read as the wallet's pump.fun trade, with its amounts, or null. The wallet must
 *  have signed it and a pump.fun or PumpSwap instruction must have run in it (review M1: a program merely listed, or a
 *  transaction someone else signed, is no trade of the wallet's). `fallbackT`: the signature's time, when the
 *  transaction has none. */
export function readMove(tx: any, wallet: string, fallbackT?: number): LeaderMove | null {
  const meta = tx?.meta;
  if (!meta || meta.err) return null;
  const raw: any[] = tx.transaction?.message?.accountKeys ?? [];
  const keys: string[] = raw.map((k: any) => (typeof k === "string" ? k : k?.pubkey));
  const i = keys.indexOf(wallet);
  if (i < 0 || raw[i]?.signer !== true) return null;
  const ran = [...(tx.transaction?.message?.instructions ?? []), ...(meta.innerInstructions ?? []).flatMap((x: any) => x?.instructions ?? [])];
  if (!ran.some((ix: any) => PUMP.has(ix?.programId))) return null;
  const big = (v: unknown): bigint | null => { try { return typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)) ? BigInt(v) : null; } catch { return null; } };
  const preL = big(meta.preBalances?.[i]), postL = big(meta.postBalances?.[i]);
  if (preL === null || postL === null) return null;
  const sum = (list: any[]) => {
    const m = new Map<string, bigint>();
    for (const b of list ?? []) {
      if (b?.owner !== wallet || typeof b.mint !== "string") continue;
      const a = big(b.uiTokenAmount?.amount);
      if (a === null) return null;
      m.set(b.mint, (m.get(b.mint) ?? 0n) + a);
    }
    return m;
  };
  const pre = sum(meta.preTokenBalances), post = sum(meta.postTokenBalances);
  if (!pre || !post) return null;
  const lamports = postL - preL + ((post.get(WSOL) ?? 0n) - (pre.get(WSOL) ?? 0n));
  const moved = [...new Set([...pre.keys(), ...post.keys()])].filter((m) => m !== WSOL).map((mint) => ({ mint, units: (post.get(mint) ?? 0n) - (pre.get(mint) ?? 0n) })).filter((x) => x.units !== 0n);
  if (moved.length !== 1) return null; // several coins at once (or none): not a trade this card can price
  const { mint, units } = moved[0]!;
  const t = typeof tx.blockTime === "number" ? tx.blockTime * 1000 : fallbackT;
  if (units > 0n && lamports < 0n) return { mint, side: "buy", units, lamports, ...(t ? { t } : {}) };
  if (units < 0n && lamports > 0n) return { mint, side: "sell", units, lamports, ...(t ? { t } : {}) };
  return null;
}

export interface Card {
  /** pump.fun trades read in the window */
  trades: number;
  won: number;
  lost: number;
  /** SOL back minus SOL in, lamports, over the coins won or lost; null when there are none */
  resultLamports: bigint | null;
  /** every coin it traded in what was read */
  coins: number;
  /** coins bought in the window and still held (no result yet) */
  stillHeld: number;
  /** coins sold in the window but bought before it (no result) */
  boughtBefore: number;
  /** the reads reach back the whole 30 days */
  full: boolean;
  /** when they don't: the time of the oldest transaction read (ms), if any */
  fromMs?: number;
  /** transactions the nodes didn't give back: the figures are then "Not known" */
  unread: number;
}

/** The card from the wallet's moves in the window. `cover`: how far back the reads reach; `unread`: transactions not read. */
export function summarize(moves: LeaderMove[], cover: { full: boolean; fromMs?: number }, unread: number): Card {
  const by = new Map<string, { in: bigint; out: bigint; solIn: bigint; solBack: bigint; firstSide: "buy" | "sell" }>();
  // the moves come newest first: reversed before a stable sort, a buy and its sale in the same second stay in order
  for (const m of [...moves].reverse().sort((a, b) => (a.t ?? 0) - (b.t ?? 0))) {
    const c = by.get(m.mint) ?? { in: 0n, out: 0n, solIn: 0n, solBack: 0n, firstSide: m.side };
    if (m.side === "buy") { c.in += m.units; c.solIn += -m.lamports; } else { c.out += -m.units; c.solBack += m.lamports; }
    by.set(m.mint, c);
  }
  let won = 0, lost = 0, stillHeld = 0, boughtBefore = 0, result = 0n, closed = 0;
  for (const c of by.values()) {
    if (c.firstSide === "sell" || c.out > c.in) { boughtBefore++; continue; } // some of it was bought before the window
    if (c.out < c.in) { stillHeld++; continue; }
    closed++;
    const r = c.solBack - c.solIn;
    result += r;
    if (r > 0n) won++; else lost++;
  }
  return { trades: moves.length, won, lost, resultLamports: closed ? result : null, coins: by.size, stillHeld, boughtBefore, full: cover.full, ...(cover.fromMs !== undefined ? { fromMs: cover.fromMs } : {}), unread };
}

export const NOT_KNOWN = "Not known";
export const NO_ANSWER_LINE = "Solana didn't answer. Try again in a moment.";
/** With sample money the wallet to copy is a sample one: there is nothing real to read (the agent package's note). */
export const SAMPLE_LINE = "Sample money: no real wallet to check.";
/** A read stopped because the card was left (never shown). */
export const STOPPED = "stopped";
export const NEXT_LINE = "Past trades don't say what it does next.";
/** QA: the card's honest limit, on every card: a wallet's trades with itself are real trades on chain. */
export const SELF_TRADE_LINE = "A wallet can trade with itself to look good. This can't tell.";
/** The waits after a refusal, then the card stops (QA: never hammer the nodes the trade path shares). */
export const BACKOFF_MS = [1_000, 2_000, 4_000] as const;
const sol = (l: bigint) => {
  const neg = l < 0n, a = neg ? -l : l;
  const whole = a / 1_000_000_000n, frac = (a % 1_000_000_000n).toString().padStart(9, "0").slice(0, 2);
  return `${neg ? "−" : "+"}${whole.toLocaleString("en-US")}.${frac} SOL`;
};
const dollars = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The card's rows, plain words. `solUsd`: SOL's price today (Trade's market), or undefined. */
export function cardRows(c: Card, solUsd: number | undefined): { label: string; value: string }[] {
  // a trade not read, or no time at all for what was read: every figure Not known (review M3)
  const partial = c.unread > 0 || (!c.full && c.fromMs === undefined);
  const rows = [
    { label: "Trades", value: partial ? NOT_KNOWN : String(c.trades) },
    { label: "Coins won", value: partial ? NOT_KNOWN : String(c.won) },
    { label: "Coins lost", value: partial ? NOT_KNOWN : String(c.lost) },
  ];
  let result = NOT_KNOWN;
  if (!partial && c.resultLamports !== null) {
    const l = c.resultLamports;
    const usd = typeof solUsd === "number" && Number.isFinite(solUsd) && solUsd > 0 ? (Number(l) / 1e9) * solUsd : undefined;
    // dollars first, at today's SOL price (the note says so); SOL alone when that price can't be read
    result = usd === undefined ? sol(l) : `about ${l < 0n ? "−" : "+"}${dollars(usd)} (${sol(l)})`;
  }
  // the result's scope in its own label (review M2): "Result on 2 of 50 coins", never a whole-wallet look
  const closed = c.won + c.lost;
  rows.push({ label: !partial && c.resultLamports !== null && closed < c.coins ? `Result on ${closed} of ${c.coins} coins` : "Result", value: result });
  return rows;
}

const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** The card's title: the window the figures are for (review M3). */
export function cardTitle(c: Card | null): string {
  if (!c) return "This wallet";
  return c.full ? `This wallet, last ${CARD_DAYS} days` : c.fromMs !== undefined ? `This wallet, since ${when(c.fromMs)}` : "This wallet";
}

/** The lines under the rows: what was read, what wasn't. */
export function cardNotes(c: Card, solUsd: number | undefined): string[] {
  const out: string[] = [];
  if (!c.full && c.fromMs === undefined) out.push("Its trades couldn't be read from Solana, so these figures are Not known.");
  else {
    out.push(c.full ? `Read from Solana: its pump.fun trades in the last ${CARD_DAYS} days.` : `Read from Solana: only its trades since ${when(c.fromMs!)} could be read. Older ones: Not known.`);
    if (c.unread) out.push(`${c.unread === 1 ? "One trade" : `${c.unread} trades`} couldn't be read, so these figures are Not known.`);
    else {
      if (c.resultLamports !== null) out.push(`The result counts coins it bought and sold all of. ${solUsd ? "Dollars are at today's SOL price." : "SOL's price can't be read right now, so it's in SOL."}`);
      if (c.stillHeld) out.push(`${c.stillHeld === 1 ? "One coin" : `${c.stillHeld} coins`} still held: result Not known.`);
      if (c.boughtBefore) out.push(`${c.boughtBefore === 1 ? "One coin" : `${c.boughtBefore} coins`} bought before then: result Not known.`);
    }
  }
  out.push(NEXT_LINE, SELF_TRADE_LINE);
  return out;
}

/**
 * Read the card: the wallet's signatures back to 30 days ago (at most MAX_TXS), then those transactions, 10 at once with
 * a pause between (PACE_MS). `rpc` throws when the node refused or didn't answer: that backs off (BACKOFF_MS) and asks
 * again; after the last wait the card stops: Error(NO_ANSWER_LINE). `rpc` answering null (not found, or an error the node
 * gave as its answer) is a transaction not read (`unread`), never "no trade". The window is whole only when a signature
 * older than 30 days was SEEN: a short list proves nothing (review H2: a node may keep only one day of history and say so
 * by giving less).
 */
export async function readCard(o: { rpc: RpcCall; wallet: string; now?: () => number; wait?: (ms: number) => Promise<void>; pause?: (ms: number) => Promise<void>; stopped?: () => boolean }): Promise<Card> {
  /** The card was left (the address changed, the sheet closed): no more reads. */
  const check = () => { if (o.stopped?.()) throw new Error(STOPPED); };
  const now = (o.now ?? Date.now)();
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pause = o.pause ?? wait;
  let backoffs = 0;
  /** One back-off, or the end of the card when they're spent. */
  const backOff = async () => { if (backoffs >= BACKOFF_MS.length) throw new Error(NO_ANSWER_LINE); await wait(BACKOFF_MS[backoffs++]!); };
  const since = now - CARD_DAYS * DAY;
  const sigs: { signature: string; blockTime: number; err?: unknown }[] = [];
  const seen = new Set<string>();
  let before: string | undefined;
  let full = false; // whole only when a signature from before the window was seen
  for (;;) {
    let page: unknown;
    for (;;) {
      check();
      try { page = await o.rpc("getSignaturesForAddress", [o.wallet, { limit: PAGE, ...(before ? { before } : {}), commitment: "confirmed" }]); }
      catch { page = undefined; }
      if (Array.isArray(page)) break;
      await backOff(); // refused, no answer, or no list (null): asked again after a wait
    }
    const list = page as { signature?: unknown; blockTime?: unknown; err?: unknown }[];
    let stop = false;
    for (const s of list) {
      if (typeof s?.signature !== "string" || seen.has(s.signature)) continue; // a repeat is never counted twice
      // no time on a signature: its place in the window is not known, so nothing older is read
      if (typeof s.blockTime !== "number") { stop = true; break; }
      if (s.blockTime * 1000 < since) { full = true; stop = true; break; }
      if (sigs.length >= MAX_TXS) { stop = true; break; }
      seen.add(s.signature);
      sigs.push({ signature: s.signature, blockTime: s.blockTime, err: s.err });
    }
    const last = list[list.length - 1]?.signature;
    if (stop || list.length < PAGE || typeof last !== "string" || last === before) break;
    before = last;
  }
  const ok = sigs.filter((s) => !s.err);
  const moves: LeaderMove[] = [];
  let unread = 0;
  const REFUSED = Symbol("refused");
  // 10 at once, a pause between, until a refusal; then one at a time, each refusal a back-off (QA: never hammer the
  // nodes the trade path shares)
  let width = AT_ONCE;
  const queue = [...ok];
  while (queue.length) {
    check();
    const batch = queue.splice(0, width);
    const txs = await Promise.all(batch.map((s) => o.rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]).catch(() => REFUSED)));
    const again: typeof batch = [];
    txs.forEach((tx, j) => {
      if (tx === REFUSED) { again.push(batch[j]!); return; }
      if (!tx) { unread++; return; }
      const m = readMove(tx, o.wallet, batch[j]!.blockTime * 1000);
      if (m) moves.push(m);
    });
    if (again.length) { queue.unshift(...again); width = 1; await backOff(); } // only the refused ones are asked again
    else if (queue.length) await pause(PACE_MS);
  }
  const oldest = sigs.length ? sigs[sigs.length - 1]!.blockTime * 1000 : undefined;
  return summarize(moves, full ? { full } : { full, ...(oldest !== undefined ? { fromMs: oldest } : {}) }, unread);
}
