// A coin's swaps read from the chain itself: its pool's recent swaps (wallet v1's market/live/recent.ts), and the swaps that
// land while its page is open (v1's sol-live.ts / evm-live.ts). Each swap is decoded with swaps.ts and priced in dollars
// with the quote's price: a stablecoin is 1, the native coin its own price, anything else the market data's last price of it.
// Followed over the chain's shared websocket (hub.ts, feed.ts) when a socket factory is given, polling behind it when no
// socket opens or the line goes quiet; by polling alone otherwise:
//  Solana: socket, logsSubscribe mentioning the pool at "processed" (+ slots as the heartbeat), decoded from the logs; a pool
//          whose program logs no event (DLMM, AMM v4) has its transaction read at "confirmed", TX_READ_AFTER_MS later, at most
//          MAX_TX_PER_ROUND every POLL_MS.sol. "processed" is about a second sooner than "confirmed", but its block can still be
//          skipped: a swap decoded from it is marked unconfirmed and checked against the confirmed chain (getSignaturesForAddress)
//          CONFIRM_AFTER_MS later; one that the check doesn't find, or that no check has found UNCONFIRMED_MAX_MS later, is taken
//          back (onRetract), so the live price never rests on a swap the chain doesn't have (Security, 28 Oct).
//          Polling, every 3 s: the pool's signatures since the last one seen, then the new transactions (at most
//          MAX_TX_PER_ROUND a round, the newest; the price needs only them), decoded from its logs or its vaults.
//  BNB Chain and Robinhood Chain: socket, eth_subscribe to the pool's Swap logs (+ newHeads as the heartbeat). Polling,
//          every 2 s: eth_getLogs of the pool's Swap topic (or the PoolManager's, filtered by the pool id) from the last
//          block seen: every swap in one call.
// A message from the socket is checked for shape (hex, base58, sizes) before it reaches a decoder, and its swaps take the
// same path as the polled ones: the same decoders, the same dedupe, then the market's PRICE SANITY (index.ts follow()).
// Display only: the chart's newest candle and the live price. Only the socket's swap subscription is "processed": every read
// from a node (signatures, transactions, the polling behind the socket, every quote) stays "confirmed".
import type { ChainId } from "../types.ts";
import { selectorOf } from "../evm/abi.ts";
import { coinIs0, decodeEvmLog, decodeLogs, decodeTx, isPoolId, managerKind, MANAGERS, slim, T, TX_OPTS, type EvmCtx, type EvmLog, type SolCtx, type Swap } from "./swaps.ts";
import { solPoolCtx, type SpotEnv, type SpotPool } from "./spot.ts";
import { NATIVE_SENTINEL, quoteKindOf, ZERO_ADDRESS } from "./map.ts";
import { FEED_HOSTS, type Subscription, type WsFactory } from "./hub.ts";
import { openFeed, type Feed, type FeedState } from "./feed.ts";
import { solPaidDoors } from "@zerofee/core/sol-proxy";

/**
 * Rules 3 and 9 (the branch rules), QA's Sim crawl (5 Nov): the coin page's Solana socket is a free node
 * (solanavibestation) that answered the handshake 429 67 times on one walk. With the relay's paid door up (sol-proxy.ts:
 * Helius, then Alchemy), a Solana pool is followed by polling through that door instead, and no free socket is opened.
 * No relay (the free build, the mainnet copy, a resting relay): the socket as before.
 */
export const freeSocketFor = (chain: ChainId, paidDoors: () => readonly string[] = solPaidDoors): boolean => chain !== "sol" || paidDoors().length === 0;

/** One swap: when (ms; the block's time for a recent one, arrival for a live one), the coin's dollar price in it, its size in dollars.
 *  `unconfirmed`: decoded from a "processed" socket notification and not yet seen by a confirmed read (Solana only): it may
 *  move the live price, nothing else, and is taken back if the confirmed chain doesn't have it. */
export interface Tick { t: number; priceUsd: number; side: "buy" | "sell"; usd: number; trader?: string; tx?: string; unconfirmed?: true }

/** Blocks to look back per chain (about 10-15 minutes): free nodes cap eth_getLogs ranges, so a refused span is tried smaller (v1's). */
export const SPANS: Record<"bsc" | "hood", number[]> = { bsc: [2000, 600, 200], hood: [6000, 2000, 600] };
/** A polling round reads at most this many new Solana transactions, the newest: the price needs only them, and the
 *  follower shares its nodes (and their rate limits) with the engine's quotes. */
export const MAX_TX_PER_ROUND = 2;
/** How often the follower asks: Solana's rounds cost a signature list and up to MAX_TX_PER_ROUND reads, an EVM one 1-2 calls. */
export const POLL_MS: Record<ChainId, number> = { sol: 3_000, bsc: 2_000, hood: 2_000, near: 3_000 };
/** And a polling round never looks back more than this many blocks. */
export const MAX_POLL_BLOCKS = 200;
/** No heartbeat for this long and the socket is quiet (wallet v1: Solana 6 s, EVM 5 s, about 10 blocks). */
export const STALE_MS: Record<ChainId, number> = { sol: 6_000, bsc: 5_000, hood: 5_000, near: 6_000 };
/** A socket's notification is at most this many log lines (a swap is a few dozen; the 64 KB message cap is hub.ts's). */
export const MAX_LOG_LINES = 400;
/** A swap the Solana socket showed at "processed" is looked for in a confirmed read this long after it arrived: Solana confirms
 *  about a second after "processed", so a confirmed read this late has it unless its block was skipped. */
export const CONFIRM_AFTER_MS = 3_000;
/** Whatever the reads did (a node down, a hidden page, a list too busy to cover it), an unconfirmed swap is taken back this long
 *  after it arrived if no confirmed read has seen it. */
export const UNCONFIRMED_MAX_MS = 30_000;
/** The confirmed read: the pool's newest signatures, this many (about 3 s of a busy pool's swaps, twice over). */
export const CONFIRM_LIMIT = 50;
/** At most this many swaps wait for their confirmed read; past it the oldest is taken back (a socket can't fill memory). */
export const MAX_UNCONFIRMED = 200;
/** A transaction the socket names (a pool whose program logs no event) is read at "confirmed": this long after its "processed"
 *  notification, and once more a round later if the node doesn't have it confirmed yet. */
export const TX_READ_AFTER_MS = 1_000;

type Target =
  | { chain: "sol"; ctx: SolCtx; owner: string; quote: QuoteSide }
  | { chain: "bsc" | "hood"; address: string; topics: (string | string[])[]; ctx: EvmCtx; quote: QuoteSide };
interface QuoteSide { kind?: "native" | "stable"; snapshot?: number }

const isNativeAddr = (a: string): boolean => { const x = a.toLowerCase(); return x === ZERO_ADDRESS || x === NATIVE_SENTINEL; };
const kindOf = (chain: ChainId, p: SpotPool): QuoteSide["kind"] => p.quote.kind ?? (chain !== "sol" && isNativeAddr(p.quote.address) ? "native" : quoteKindOf(chain, p.quote.address));

async function decimalsEvm(env: SpotEnv, chain: ChainId, token: string): Promise<number> {
  if (isNativeAddr(token)) return 18;
  const h = await env.rpc(chain, "eth_call", [{ to: token, data: selectorOf("decimals()") }, "latest"]);
  if (typeof h !== "string" || h === "0x") throw new Error("no decimals()");
  return Number(BigInt(h));
}

/** What following this pool takes: the decoder's context and where its swaps are logged. Undefined: a pool type no decoder reads. */
export async function targetOf(env: SpotEnv, chain: ChainId, coin: string, p: SpotPool): Promise<Target | undefined> {
  const quote: QuoteSide = { ...(kindOf(chain, p) ? { kind: kindOf(chain, p)! } : {}), ...(p.quote.priceUsd ? { snapshot: p.quote.priceUsd } : {}) };
  if (chain === "sol") {
    const cd = p.coin.decimals ?? (await env.rpc("sol", "getAccountInfo", [coin, { encoding: "jsonParsed", commitment: "confirmed" }]))?.value?.data?.parsed?.info?.decimals;
    if (typeof cd !== "number") return undefined;
    const s = await solPoolCtx(env, coin, p, cd);
    return s ? { chain, ctx: s.ctx, owner: s.owner, quote } : undefined;
  }
  if (chain !== "bsc" && chain !== "hood") return undefined;
  const where = evmWhere(chain, p);
  if (!where) return undefined;
  const [cd, qd] = await Promise.all([p.coin.decimals ?? decimalsEvm(env, chain, coin), p.quote.decimals ?? decimalsEvm(env, chain, p.quote.address)]);
  const ctx: EvmCtx = { coin: coin.toLowerCase(), coinDecimals: cd, quoteDecimals: qd, coinIs0: coinIs0(coin, p.quote.address), ...(where.poolId ? { poolId: where.poolId } : {}) };
  return { chain: chain as "bsc" | "hood", address: where.address, topics: where.topics, ctx, quote };
}

/** Where an EVM pool's swaps are logged: the pool itself, or the singleton manager filtered by the pool id. Undefined: no decoder reads it. */
function evmWhere(chain: "bsc" | "hood", p: SpotPool): { address: string; topics: (string | string[])[]; poolId?: string } | undefined {
  if (isPoolId(p.pool)) {
    const which = managerKind(p.dex);
    const address = MANAGERS[chain]?.[which];
    if (!address) return undefined;
    return { address, topics: [[which === "v4" ? T.v4 : which === "infCL" ? T.infCL : T.infBin], p.pool.toLowerCase()], poolId: p.pool.toLowerCase() };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.pool)) return undefined;
  return { address: p.pool.toLowerCase(), topics: [[T.v2, T.v3, T.pv3]] };
}

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/, HEXQ = /^0x[0-9a-fA-F]{1,16}$/, HEXDATA = /^0x(?:[0-9a-fA-F]{2}){0,1024}$/;
/** The subscriptions that follow this pool over a socket (the pool's address and topics only: public data, no key). Undefined: none. */
export function subsOf(chain: ChainId, p: SpotPool): Subscription[] | undefined {
  if (chain === "sol") {
    if (!SOL_ADDR.test(p.pool)) return undefined;
    // "processed": the swap about a second sooner (28 Oct, Solana's median 1.7 s after the block at "confirmed"). Display only,
    // and checked against the confirmed chain after (followSwaps): this one subscription is the only "processed" read in Trade.
    return [{ tag: "swap", method: "logsSubscribe", params: [{ mentions: [p.pool] }, { commitment: "processed" }] }, { tag: "beat", method: "slotSubscribe", params: [] }];
  }
  if (chain !== "bsc" && chain !== "hood") return undefined;              // NEAR: no socket of its own (the market data polls)
  const w = evmWhere(chain, p);
  if (!w) return undefined;
  return [{ tag: "swap", method: "eth_subscribe", params: ["logs", { address: w.address, topics: w.topics }] }, { tag: "beat", method: "eth_subscribe", params: ["newHeads"] }];
}
/** A socket's Solana logs notification, if it has the shape of one: a signature, no error, a bounded list of text lines; and
 *  its slot when the node gave a sane one. */
export function solLogsOf(result: unknown): { signature: string; logs: string[]; slot?: number } | undefined {
  const r = result as { context?: { slot?: unknown }; value?: { signature?: unknown; err?: unknown; logs?: unknown } } | undefined;
  const v = r?.value;
  if (!v || typeof v !== "object" || v.err || typeof v.signature !== "string" || !SOL_SIG.test(v.signature)) return undefined;
  if (!Array.isArray(v.logs) || v.logs.length > MAX_LOG_LINES || !v.logs.every((l) => typeof l === "string")) return undefined;
  const slot = r?.context?.slot;
  return { signature: v.signature, logs: v.logs as string[], ...(Number.isSafeInteger(slot) && (slot as number) > 0 ? { slot: slot as number } : {}) };
}
/** A socket's EVM log, if it has the shape of one and is the followed pool's: hex everywhere, the pool's address and topic. */
export function evmLogOf(tg: { address: string; topics: (string | string[])[] }, result: unknown): EvmLog | undefined {
  const l = result as Record<string, unknown> | undefined;
  if (!l || typeof l !== "object" || l.removed === true) return undefined;
  const { topics, data, transactionHash, logIndex, address, blockNumber } = l as Record<string, unknown>;
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > 4 || !topics.every((t) => typeof t === "string" && HEX32.test(t))) return undefined;
  if (typeof data !== "string" || !HEXDATA.test(data) || typeof transactionHash !== "string" || !HEX32.test(transactionHash)) return undefined;
  if (typeof logIndex !== "string" || !HEXQ.test(logIndex) || typeof address !== "string" || address.toLowerCase() !== tg.address) return undefined;
  if (blockNumber !== undefined && (typeof blockNumber !== "string" || !HEXQ.test(blockNumber))) return undefined;
  const wanted = tg.topics[0] as string[], t0 = (topics[0] as string).toLowerCase();
  if (!wanted.includes(t0)) return undefined;
  if (typeof tg.topics[1] === "string" && (topics[1] as string | undefined)?.toLowerCase() !== tg.topics[1]) return undefined;
  return { topics: (topics as string[]).map((t) => t.toLowerCase()), data, transactionHash: transactionHash.toLowerCase(), logIndex: logIndex.toLowerCase(), address: address.toLowerCase(), ...(blockNumber ? { blockNumber: blockNumber as string } : {}) };
}

/** Dollars per quote unit now: 1, the native coin's price, or the market data's last price of the quote. Undefined: none. */
async function quoteUsd(env: SpotEnv, chain: ChainId, q: QuoteSide): Promise<number | undefined> {
  if (q.kind === "stable") return 1;
  if (q.kind === "native") { try { const v = await env.nativeUsd(chain); if (v > 0) return v; } catch { /* the snapshot */ } }
  return q.snapshot && q.snapshot > 0 ? q.snapshot : undefined;
}
const tickOf = (s: Swap, usd: number, t: number, tx?: string, unconfirmed?: boolean): Tick | undefined => {
  const priceUsd = (s.price ?? s.quote / s.coin) * usd;
  return Number.isFinite(priceUsd) && priceUsd > 0 ? { t, priceUsd, side: s.side, usd: s.quote * usd, ...(s.trader ? { trader: s.trader } : {}), ...(tx ? { tx } : {}), ...(unconfirmed ? { unconfirmed: true as const } : {}) } : undefined;
};

/** The pool's last `n` swaps, oldest first, with their blocks' times. Never throws for "nothing recent" ([]). */
export async function recentSwaps(env: SpotEnv, chain: ChainId, coin: string, p: SpotPool, n = 30, now: () => number = Date.now): Promise<Tick[]> {
  const tg = await targetOf(env, chain, coin, p);
  if (!tg) return [];
  const usd = await quoteUsd(env, chain, tg.quote);
  if (!usd) return [];
  if (tg.chain === "sol") {
    const sigs = ((await env.rpc("sol", "getSignaturesForAddress", [tg.ctx.pool, { limit: Math.min(40, n * 3), commitment: "confirmed" }])) ?? []) as { signature: string; err: unknown; blockTime?: number | null }[];
    const ok = sigs.filter((s) => !s.err).slice(0, Math.min(14, n + 4));          // a failed transaction is no swap; 14 reads is the budget
    const out: Tick[] = [];
    for (let i = 0; i < ok.length && out.length < n; i += 2) {                      // two at a time: free nodes rest a node that is asked too fast
      await Promise.all(ok.slice(i, i + 2).map(async (sg) => {
        const r = await env.rpc("sol", "getTransaction", [sg.signature, TX_OPTS]).catch(() => null);
        if (!r) return;
        const { tx, logs } = slim(r);
        (decodeLogs(tg.ctx, logs) ?? decodeTx(tg.ctx, tx, logs)).forEach((s, k) => {
          const tk = tickOf(s, usd, ((sg.blockTime ?? r.blockTime ?? 0) * 1000) || now(), sg.signature + (k ? `:${k}` : ""));
          if (tk) out.push(tk);
        });
      }));
    }
    return out.sort((a, b) => a.t - b.t).slice(-n);
  }
  const head = Number(BigInt(await env.rpc(tg.chain, "eth_blockNumber", [])));
  let logs: EvmLog[] | undefined;
  for (const span of SPANS[tg.chain]) {
    try { logs = await env.rpc(tg.chain, "eth_getLogs", [{ address: tg.address, topics: tg.topics, fromBlock: "0x" + Math.max(0, head - span).toString(16), toBlock: "0x" + head.toString(16) }]); break; } catch { /* the node limits the range: a smaller one */ }
  }
  if (!logs) return [];
  const swaps = logs.filter((l) => !l.removed).map((l) => ({ l, s: decodeEvmLog(tg.ctx, l) })).filter((x): x is { l: EvmLog; s: Swap } => !!x.s).slice(-n);
  const blocks = [...new Set(swaps.map((x) => x.l.blockNumber!).filter(Boolean))];
  const ts = new Map<string, number>();
  await Promise.all(blocks.map(async (b) => { try { const r = await env.rpc(tg.chain, "eth_getBlockByNumber", [b, false]); ts.set(b, Number(BigInt(r.timestamp)) * 1000); } catch { /* an estimate below */ } }));
  const headTs = ts.size ? Math.max(...ts.values()) : now();
  return swaps.map(({ l, s }) => tickOf(s, usd, ts.get(l.blockNumber!) ?? headTs, l.transactionHash)).filter((x): x is Tick => !!x);
}

/** How a follower runs. `ws`: the chain's socket (hub.ts); none, or a chain with no feed host: polling only. */
export interface FollowOpts {
  pollMs: number; now?: () => number;
  /** The page is hidden: no node is asked and no socket is held. */
  paused?: () => boolean;
  ws?: WsFactory;
  onStatus?: (s: FeedState) => void;
  /** An unconfirmed swap (Tick.unconfirmed, by its tx) that a confirmed read has now seen: it stays. */
  onSettle?: (tx: string) => void;
  /** An unconfirmed swap the confirmed chain doesn't have (its block skipped): every tick of that tx is to be forgotten. */
  onRetract?: (tx: string) => void;
  /** For the tests: the hub's reconnect jitter. */
  random?: () => number;
}

/**
 * Follows the pool: its new swaps, oldest first, each once, from the socket when one is given and working, else every
 * `pollMs` from the nodes. The first polling round only marks where the chain is (no flood of history). Returns the stop.
 * A round that fails is simply the next round's work. A Solana swap from the socket is shown at "processed", marked
 * unconfirmed, and then either settled (onSettle) or taken back (onRetract) by a confirmed read.
 */
export function followSwaps(env: SpotEnv, chain: ChainId, coin: string, p: SpotPool, onTick: (t: Tick) => void, o: FollowOpts): () => void {
  const now = o.now ?? Date.now;
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, txTimer: ReturnType<typeof setTimeout> | undefined, feed: Feed | undefined;
  let marked = false, lastSig: string | undefined, lastBlock: number | undefined;
  const seen = new Set<string>(), order: string[] = [];
  /** Shows the swap unless it was shown already; true when a tick went out. */
  const emit = (key: string, s: Swap, usd: number, unconfirmed = false): boolean => {
    if (seen.has(key)) return false;
    seen.add(key); order.push(key);
    if (order.length > 600) seen.delete(order.shift()!);
    const tk = tickOf(s, usd, now(), key.split(":")[0], unconfirmed);
    if (!tk || stopped) return false;
    onTick(tk);
    return true;
  };

  // ---- Solana's unconfirmed swaps (shown from the "processed" socket), each kept until a confirmed read has it or doesn't.
  // A skipped slot's transaction never reaches "confirmed": the check after CONFIRM_AFTER_MS doesn't find it and takes it
  // back, and UNCONFIRMED_MAX_MS is the backstop when no check could be made.
  const pending = new Map<string, { at: number; slot?: number; n: number }>();
  let confirmTimer: ReturnType<typeof setTimeout> | undefined, checkedAt = -Infinity;
  const settle = (sig: string) => { if (pending.delete(sig)) o.onSettle?.(sig); };
  const retract = (sig: string) => {
    const w = pending.get(sig);
    if (!w) return;
    pending.delete(sig);
    // its keys go too: the same transaction landing in a later block comes as a new notification, and is shown (and checked) again
    for (let i = 0; i < w.n; i++) seen.delete(`${sig}:${i}`);
    o.onRetract?.(sig);
  };
  const confirm = async (tg: Extract<Target, { chain: "sol" }>): Promise<void> => {
    const asked = now();
    if ([...pending.values()].some((w) => asked - w.at >= CONFIRM_AFTER_MS)) {
      checkedAt = asked;                                        // one read per CONFIRM_AFTER_MS at most, made or not
      const list = o.paused?.() ? undefined : await env.rpc("sol", "getSignaturesForAddress", [tg.ctx.pool, { limit: CONFIRM_LIMIT, commitment: "confirmed" }]).catch(() => undefined) as { signature?: unknown; err?: unknown; slot?: unknown }[] | undefined;
      if (stopped) return;
      if (Array.isArray(list)) {
        const ok = new Set(list.filter((x) => !x.err).map((x) => x.signature));
        // the read covers a swap's block when it holds every signature since (fewer than asked for), or reaches back past it
        const oldest = list[list.length - 1]?.slot;
        const covers = (w: { slot?: number }) => list.length < CONFIRM_LIMIT || (typeof oldest === "number" && w.slot !== undefined && oldest < w.slot);
        for (const [sig, w] of [...pending]) {
          if (ok.has(sig)) settle(sig);
          // due and covered, and not there (or there as a failed transaction): its block was skipped
          else if (asked - w.at >= CONFIRM_AFTER_MS && covers(w)) retract(sig);
        }
      }
    }
    const t = now();
    for (const [sig, w] of [...pending]) if (t - w.at >= UNCONFIRMED_MAX_MS) retract(sig);
  };
  const scheduleConfirm = (tg: Extract<Target, { chain: "sol" }>) => {
    if (stopped || confirmTimer || !pending.size) return;
    const first = Math.min(...[...pending.values()].map((w) => w.at));
    const at = Math.max(first, checkedAt) + CONFIRM_AFTER_MS;
    confirmTimer = setTimeout(() => { confirmTimer = undefined; void confirm(tg).catch(() => undefined).then(() => scheduleConfirm(tg)); }, Math.max(1, at - now()));
    (confirmTimer as { unref?: () => void }).unref?.();
  };
  const awaitConfirm = (tg: Extract<Target, { chain: "sol" }>, sig: string, n: number, slot?: number) => {
    if (pending.has(sig)) return;
    while (pending.size >= MAX_UNCONFIRMED) retract(pending.keys().next().value!);   // never more than this unchecked: the oldest goes
    pending.set(sig, { at: now(), n, ...(slot !== undefined ? { slot } : {}) });
    scheduleConfirm(tg);
  };
  const targetP = targetOf(env, chain, coin, p).catch(() => undefined);
  const readTx = async (tg: Extract<Target, { chain: "sol" }>, sig: string, usd: number, logs?: string[]): Promise<boolean> => {
    const r = await env.rpc("sol", "getTransaction", [sig, TX_OPTS]).catch(() => null);
    if (!r || stopped) return false;
    const s = slim(r);
    (decodeLogs(tg.ctx, s.logs) ?? decodeTx(tg.ctx, s.tx, logs ?? s.logs)).forEach((x, i) => emit(`${sig}:${i}`, x, usd));
    return true;
  };
  const round = async (): Promise<void> => {
    const tg = await targetP;
    if (!tg || stopped) return;
    const usd = await quoteUsd(env, chain, tg.quote);
    if (!usd) return;
    if (tg.chain === "sol") {
      const sigs = ((await env.rpc("sol", "getSignaturesForAddress", [tg.ctx.pool, { limit: 12, commitment: "confirmed", ...(lastSig ? { until: lastSig } : {}) }])) ?? []) as { signature: string; err: unknown }[];
      if (!marked) { marked = true; lastSig = sigs[0]?.signature ?? lastSig; return; }
      if (sigs[0]) lastSig = sigs[0].signature;
      for (const s of sigs) if (!s.err) settle(s.signature);   // a confirmed list that has a socket's swap settles it
      const fresh = sigs.filter((s) => !s.err).slice(0, MAX_TX_PER_ROUND).reverse();
      for (const s of fresh) await readTx(tg, s.signature, usd);
      return;
    }
    const head = Number(BigInt(await env.rpc(tg.chain, "eth_blockNumber", [])));
    if (lastBlock === undefined) { lastBlock = head; return; }
    const from = Math.max(lastBlock + 1, head - MAX_POLL_BLOCKS);
    if (from > head) return;
    const logs = ((await env.rpc(tg.chain, "eth_getLogs", [{ address: tg.address, topics: tg.topics, fromBlock: "0x" + from.toString(16), toBlock: "0x" + head.toString(16) }])) ?? []) as EvmLog[];
    lastBlock = head;
    for (const l of logs) { if (l.removed) continue; const s = decodeEvmLog(tg.ctx, l); if (s) emit(`${String(l.transactionHash).toLowerCase()}:${String(l.logIndex).toLowerCase()}`, s, usd); }
  };
  const stop = () => { stopped = true; clearTimeout(timer); clearTimeout(txTimer); clearTimeout(confirmTimer); feed?.stop(); };

  const subs = o.ws && FEED_HOSTS[chain]?.length && freeSocketFor(chain) ? subsOf(chain, p) : undefined;
  if (!o.ws || !subs) {
    const loop = () => {
      if (stopped) return;
      const run = o.paused?.() ? Promise.resolve() : round();
      void run.catch(() => undefined).then(() => { if (!stopped) { timer = setTimeout(loop, o.pollMs); (timer as { unref?: () => void }).unref?.(); } });
    };
    loop();
    return stop;
  }

  // ---- over the socket. Solana transactions to read (a pool whose program logs no event): the newest, on the polling budget.
  // They are read at "confirmed", so each waits TX_READ_AFTER_MS after its "processed" notification, and one the node doesn't
  // have yet is asked once more on a later round; a skipped slot's transaction is never found, and never shown.
  const txq: { sig: string; due: number; again: boolean }[] = [], started: number[] = [];
  const pump = (tg: Extract<Target, { chain: "sol" }>, usd: number) => {
    if (stopped) return;
    const t = now();
    while (started.length && t - started[0]! >= POLL_MS.sol) started.shift();
    for (let i = txq.length - 1; i >= 0 && started.length < MAX_TX_PER_ROUND; i--) {
      const q = txq[i]!;
      if (q.due > t) continue;
      txq.splice(i, 1); started.push(t);
      void readTx(tg, q.sig, usd).then((ok) => { if (!ok && !stopped && !q.again) queueTx(tg, usd, { sig: q.sig, due: now(), again: true }); }).catch(() => undefined);
    }
    if (txq.length && !txTimer) {
      const free = started.length < MAX_TX_PER_ROUND ? t : started[0]! + POLL_MS.sol;
      const next = Math.max(free, Math.min(...txq.map((q) => q.due)));
      txTimer = setTimeout(() => { txTimer = undefined; pump(tg, usd); }, Math.max(1, next - t));
    }
  };
  const queueTx = (tg: Extract<Target, { chain: "sol" }>, usd: number, q: { sig: string; due: number; again: boolean }) => {
    txq.push(q);
    while (txq.length > MAX_TX_PER_ROUND) txq.shift();
    pump(tg, usd);
  };
  let inFlight = 0;
  const onNote = async (tag: string, result: unknown): Promise<void> => {
    const tg = await targetP;
    if (!tg || stopped) return;
    if (tg.chain === "sol") {
      if (tag !== "swap") return;
      const v = solLogsOf(result);
      if (!v) return;
      lastSig = v.signature; marked = true;                    // a fallback poll starts after what the socket saw
      const usd = await quoteUsd(env, chain, tg.quote);
      if (!usd || stopped) return;
      const fast = decodeLogs(tg.ctx, v.logs);
      if (fast) {
        // read at "processed": shown now, unconfirmed, and checked against the confirmed chain CONFIRM_AFTER_MS later
        let shown = false;
        fast.forEach((x, i) => { if (emit(`${v.signature}:${i}`, x, usd, true)) shown = true; });
        if (shown) awaitConfirm(tg, v.signature, fast.length, v.slot);
        return;
      }
      if (!v.logs.some((l) => l.startsWith(`Program ${tg.owner} invoke`))) return;   // a transaction that only reads the pool
      queueTx(tg, usd, { sig: v.signature, due: now() + TX_READ_AFTER_MS, again: false });
      return;
    }
    if (tag === "beat") {
      const n = (result as { number?: unknown } | undefined)?.number;
      if (typeof n === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(n) && lastBlock !== undefined) lastBlock = Math.max(lastBlock, Number(BigInt(n)));
      return;
    }
    const l = evmLogOf(tg, result);
    if (!l) return;
    const usd = await quoteUsd(env, chain, tg.quote);
    if (!usd || stopped) return;
    const s = decodeEvmLog(tg.ctx, l);
    if (s) emit(`${l.transactionHash}:${l.logIndex}`, s, usd);
  };
  feed = openFeed({
    chain, make: o.ws, wants: subs, beatTag: "beat", staleMs: STALE_MS[chain], pollEveryMs: o.pollMs, poll: round, now,
    ...(o.paused ? { paused: o.paused } : {}), ...(o.onStatus ? { onState: o.onStatus } : {}), ...(o.random ? { random: o.random } : {}),
    onMessage: (tag, result) => {
      if (inFlight >= 200) return;                              // the decoder's setup is still being read: a bounded backlog
      inFlight++;
      void onNote(tag, result).catch(() => undefined).finally(() => { inFlight--; });
    },
  });
  // the polling fallback's starting point, marked once (one call) unless the page is hidden
  if (!o.paused?.()) void round().catch(() => undefined);
  return stop;
}

/** One-minute candles from swaps (oldest first): what the chart draws of a coin the market data has no candles for. */
export function candlesOfTicks(ticks: Tick[], bucketMs = 60_000): { t: number; o: number; h: number; l: number; c: number; v: number }[] {
  const out: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
  for (const tk of [...ticks].sort((a, b) => a.t - b.t)) {
    const t = Math.floor(tk.t / bucketMs) * bucketMs, last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, tk.priceUsd); last.l = Math.min(last.l, tk.priceUsd); last.c = tk.priceUsd; last.v += tk.usd; }
    else out.push({ t, o: last ? last.c : tk.priceUsd, h: Math.max(tk.priceUsd, last ? last.c : tk.priceUsd), l: Math.min(tk.priceUsd, last ? last.c : tk.priceUsd), c: tk.priceUsd, v: tk.usd });
  }
  return out;
}
