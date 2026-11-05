// NEAR coins at chain speed (product decision, 3 Nov; amends D96): a buy or a sale is ONE public transaction from the NEAR coin wallet
// straight into one Rhea pool, measured on chain at 1.03-1.21 s for a direct swap. The core builds and signs it from the
// ask (subwallet.near.trade: no bytes from here); this engine quotes it, sends the signed bytes to the first node with
// wait_until EXECUTED_OPTIMISTIC (every receipt executed), calls it landed only when the swap used all it was given and the
// coin reached the wallet (nearOutcome), and has a second node's FINAL answer book it in the background.
// Under 2 s (the hard rule, 5 Nov; core near-rhea.ts): once the person has readied their NEAR (one tap, "Ready NEAR
// for trading"), the wallet's wNEAR and the coins it buys stay in its OWN account in Rhea (Ref's internal balances; only
// its key moves them, ZeroFee holds nothing), and a buy or a sale is ONE `swap` call there: one receipt, no wrap, no
// token hop. Landed = that receipt's success (the amount out, at least the least) AND the wallet's new Rhea balance read.
// Holdings and the wallet's total read Rhea's balances too (get_deposits), so nothing looks missing.
// The pool is the coin's deepest Rhea pool the market names ("refv1-<id>"), checked on chain to be a plain pool of exactly
// the coin and wNEAR; a coin with none isn't bought (product decision, 5 Nov: the chain's own protocols only, never 1Click's layer).
import { ProblemError } from "@zerofee/core/problem";
import { WNEAR, nearOutcome, type NearTradeAsk } from "@zerofee/core/near-trade";
import type { NearRpc } from "../market/near.ts";
import { nearProblems } from "./problems.ts";
import type { Amount, ChainEngine, CoinMeta, Fill, Prepared, Quote, Side } from "../types.ts";

export const REF = "v2.ref-finance.near";
/** How far the price may move between the quote and the tap: the least is the pool's answer less this (the core refuses
 *  a least more than 5 % under the pool's answer at the tap). */
export const RHEA_SLIPPAGE_BPS = 300;
/** NEAR kept in the wallet for gas and storage: a buy with Max never spends it. */
export const NEAR_GAS_RESERVE = 50_000_000_000_000_000_000_000n;   // 0.05 NEAR
/** A swap's gas, in NEAR, for the fee line (180 Tgas at NEAR's 100 Mgas price ≈ 0.0018 NEAR; about half is refunded). */
const SWAP_GAS_NEAR = 0.0018;
/** How long the tap waits for the first node to say it executed, before reading it by hash. */
export const RHEA_LAND_MS = 20_000;
/** How long ready() waits, after a coin's account opened, for both nodes' FINAL block to show it: the core builds the trade
 *  at a final block two nodes agree on, so an account seen only optimistically would be refused at the tap. */
export const RHEA_REGISTER_FINAL_MS = 8_000;
/** A coin the market's full answer gives no plain Rhea pool is asked again after this (a new pool may be listed). */
const NO_POOL_MS = 60_000;
const QUOTE_MS = 20_000;
const YOCTO = 10n ** 24n;
const POOL_ID = /^refv1-(\d{1,9})$/;

export interface RheaDeps {
  /** The app's bridge call: its answer, or a ProblemError. */
  call<T>(method: string, params: Record<string, unknown>): Promise<T>;
  /** The first node: reads, the send, the executed outcome. */
  rpc: NearRpc;
  /** Another node: the FINAL answer that books it. */
  rpc2: NearRpc;
  meta?(coin: string): Promise<CoinMeta | undefined>;
  /** The coin's every pool, the market's full answer waited for (meta's quick answer can be a list row's one pool, NEAR
   *  Intents', or none yet: 4 Nov, the speed run's RHEA buy found no Rhea pool). A throw: not known, asked again. */
  pools?(coin: string): Promise<CoinMeta["pools"]>;
  /** NEAR in dollars (the market's checked price). */
  nearUsd(): Promise<number>;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  /** The wrap-and-send buy (3-5 Nov, about 3.8 s) for a wallet never readied, in place of the one tap: never in the
   *  app (nearEngines leaves it off); the earlier shape's own tests. A coin the wallet itself holds sells that way always. */
  twoStepBuys?: boolean;
}

/** The wallet's own account in Rhea (Ref's get_deposits, get_user_storage_state). */
export interface RheaBalances { open: boolean; deposits: Map<string, bigint>; roomYocto: bigint }
/** Room Ref needs for a coin the wallet's Rhea account hasn't held yet (core near-rhea.ts RHEA_COIN_ROOM_YOCTO). */
const COIN_ROOM_YOCTO = 2_000_000_000_000_000_000_000n;
/** How long the tap waits, after the swap's receipt, for the first node to show the new Rhea balance. */
export const RHEA_BALANCE_MS = 1_500;

const b64json = (o: unknown) => btoa(JSON.stringify(o));
const fromBytes = (r: any): unknown => {
  if (!Array.isArray(r?.result)) return undefined;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result as number[]))); } catch { return undefined; }
};
const big = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : null);

export interface RheaEngine extends ChainEngine {
  /** The coin's Rhea pool (checked on chain), or undefined: none, and the 1Click engine trades it. */
  poolOf(coin: string): Promise<{ id: number; feeBps: number } | undefined>;
  /** What the NEAR coin wallet holds of a coin (smallest units): in the wallet and in its Rhea account. */
  heldOf(coin: string): Promise<bigint>;
  /** The wallet's own account in Rhea, read at final on the first node. */
  rheaOf(): Promise<RheaBalances>;
  /** "Ready NEAR for trading" (the person's one tap): all the wallet can move goes into its own account in Rhea. */
  readyNear(): Promise<void>;
}

export function createRheaEngine(d: RheaDeps): RheaEngine {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let wallet: Promise<string> | undefined;
  const walletOf = () => (wallet ??= d.call<{ address: string }>("subwallet.near.wallet", {}).then((w) => w.address).catch((e) => { wallet = undefined; throw e; }));
  const view = async (contract: string, method: string, args: Record<string, unknown>, rpc: NearRpc = d.rpc): Promise<unknown> =>
    fromBytes(await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: b64json(args) }));
  const pools = new Map<string, { at: number; ttl: number; pool: Promise<{ id: number; feeBps: number } | undefined> }>();
  const rheaPools = (list: CoinMeta["pools"]) => (list ?? [])
    .filter((p) => /rhea|ref-finance/i.test(p.dex) && POOL_ID.test(p.address))
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
    .slice(0, 3);

  /** The coin's Rhea pool: undefined only when the market's answer names none that is a plain pool of the coin and wNEAR
   *  on chain (kept a minute). A pool unread (a node down, the market not answering) throws and is never kept. */
  async function poolOf(coin: string): Promise<{ id: number; feeBps: number } | undefined> {
    const kept = pools.get(coin);
    if (kept && now() - kept.at < kept.ttl) return kept.pool;
    const pool = (async () => {
      const meta = await d.meta?.(coin).catch(() => undefined);
      let listed = rheaPools(meta?.pools);
      if (!listed.length && d.pools) listed = rheaPools(await d.pools(coin));
      let unread = 0;
      // every door down (doors.ts NearDoorsDown, NearRelayDown): that outage's one line (trade.near.down, or
      // trade.near.relay-down), passed on unchanged; rhea-unread only for a pool unread any other way
      let down: ProblemError | undefined;
      for (const p of listed) {
        const id = Number(POOL_ID.exec(p.address)![1]);
        // rule 9: one node's bad answer is a silent read on the other NEAR node; only both failing is Rhea unreachable
        const got = await view(REF, "get_pool", { pool_id: id }).catch(() => view(REF, "get_pool", { pool_id: id }, d.rpc2)).catch((e: unknown) => {
          unread++;
          if (e instanceof ProblemError && (e.problem.code === "trade.near.down" || e.problem.code === "trade.near.relay-down")) down = e;
          return undefined;
        }) as { pool_kind?: unknown; token_account_ids?: unknown; total_fee?: unknown } | undefined;
        const ids = Array.isArray(got?.token_account_ids) ? got!.token_account_ids as unknown[] : [];
        if (got?.pool_kind === "SIMPLE_POOL" && ids.length === 2 && ids.includes(coin) && ids.includes(WNEAR)) return { id, feeBps: typeof got.total_fee === "number" ? got.total_fee : 30 };
      }
      if (down) throw down;
      if (unread) throw new ProblemError(nearProblems.rheaUnread(meta?.symbol ?? coin.split(".")[0]!.toUpperCase().slice(0, 12)));
      return undefined;
    })();
    const entry = { at: now(), ttl: 10 * 60_000, pool };
    pools.set(coin, entry);
    pool.then((p) => { if (p === undefined) entry.ttl = NO_POOL_MS; }, () => { if (pools.get(coin) === entry) pools.delete(coin); });
    return pool;
  }

  async function walletHeld(coin: string): Promise<bigint> {
    return big(await view(coin, "ft_balance_of", { account_id: await walletOf() })) ?? 0n;
  }
  async function rheaOf(rpc: NearRpc = d.rpc, at?: { finality: string }): Promise<RheaBalances> {
    const w = await walletOf();
    const q = (method: string) => rpc("query", { request_type: "call_function", ...(at ?? { finality: "final" }), account_id: REF, method_name: method, args_base64: b64json({ account_id: w }) }).then(fromBytes);
    const [deps, state] = await Promise.all([q("get_deposits"), q("get_user_storage_state")]);
    const deposits = new Map<string, bigint>();
    if (deps && typeof deps === "object" && !Array.isArray(deps)) for (const [k, v] of Object.entries(deps as Record<string, unknown>)) { const n = big(v); if (n !== null) deposits.set(k, n); }
    const st = state as { deposit?: unknown; usage?: unknown } | null | undefined;
    const dep = big(st?.deposit), use = big(st?.usage);
    return { open: dep !== null && use !== null, deposits, roomYocto: dep !== null && use !== null && dep > use ? dep - use : 0n };
  }
  async function heldOf(coin: string): Promise<bigint> {
    const [w, r] = await Promise.all([walletHeld(coin), rheaOf().then((x) => x.deposits.get(coin) ?? 0n, () => 0n)]);
    return w + r;
  }
  /** The core moves the wallet's NEAR into its own Rhea account ("all", or "0": only the room for a new coin). */
  async function rheaAdd(amount: "all" | "0"): Promise<void> {
    await d.call<{ hashes: string[]; amount: string }>("subwallet.near.rheaAdd", { amount });
  }
  async function nativeOf(): Promise<bigint> {
    const r = await d.rpc("query", { request_type: "view_account", finality: "final", account_id: await walletOf() }).catch(() => null);
    return big(r?.amount) ?? 0n;
  }

  /** A coin's (or wNEAR's) account in the wallet, opened by the core and sent here, landed before the trade goes on. The
   *  core opens one only for a coin Rhea trades (its pool, review M2). */
  async function register(coin: string, poolId?: number): Promise<void> {
    const r = await d.call<{ signedTx: string; hash: string } | { declined: true }>("subwallet.near.register", { coin, ...(coin === WNEAR ? {} : { poolId }) });
    if ("declined" in r) throw new ProblemError(nearProblems.nearNothingMoved(coin));
    const out = await d.rpc("send_tx", { signed_tx_base64: r.signedTx, wait_until: "EXECUTED_OPTIMISTIC" });
    if (!out?.status || "Failure" in out.status) throw new ProblemError(nearProblems.nearNothingMoved(coin));
    // the core builds the trade at a FINAL block two nodes agree on: the account must be there on both first, or the tap
    // is refused ("needs its account") and a second open is refused as done today (before the tap, never in its time)
    const w = await walletOf();
    const t0 = now();
    for (;;) {
      const seen = await Promise.all([d.rpc, d.rpc2].map((rpc) => view(coin, "storage_balance_of", { account_id: w }, rpc).then((x) => x !== null && x !== undefined, () => false)));
      if (seen.every(Boolean)) return;
      if (now() - t0 >= RHEA_REGISTER_FINAL_MS) throw new ProblemError(nearProblems.rheaPending(coin === WNEAR ? "NEAR" : coin.split(".")[0]!.toUpperCase().slice(0, 12)));
      await sleep(400);
    }
  }

  /**
   * Re-review M: the coin out, read on BOTH nodes at ONE final block at or past the trade's own last receipt, against
   * what the core read before it at its agreed build block (two nodes, given with the bytes). At least the least more:
   * landed (the smaller rise). Less: the coin didn't arrive (decided, never "refunded"). Anything unread, or the nodes
   * apart: null (pending, never a verdict).
   */
  async function byFinalBalance(token: string, wallet: string, before: bigint, minOut: string, final: any): Promise<{ landed: true; got: bigint } | { notArrived: true } | null> {
    const hashes = [...new Set((Array.isArray(final?.receipts_outcome) ? final.receipts_outcome : []).map((ro: any) => ro?.block_hash).filter((h: unknown): h is string => typeof h === "string"))];
    if (!hashes.length) return null;
    const heights = await Promise.all(hashes.map((h) => d.rpc("block", { block_id: h }).then((b: any) => Number(b?.header?.height), () => NaN)));
    if (heights.some((h) => !Number.isFinite(h))) return null;
    const txHeight = Math.max(...heights);
    // one final block both nodes have, at or past the trade's last receipt
    let at = 0;
    for (let i = 0; i < 20; i++) {
      const [a, b] = await Promise.all([d.rpc, d.rpc2].map((rpc) => rpc("block", { finality: "final" }).then((x: any) => Number(x?.header?.height), () => NaN)));
      if (Number.isFinite(a) && Number.isFinite(b) && Math.min(a, b) >= txHeight) { at = Math.min(a, b); break; }
      await sleep(500);
    }
    if (!at) return null;
    const read = (rpc: NearRpc) => rpc("query", { request_type: "call_function", block_id: at, account_id: token, method_name: "ft_balance_of", args_base64: b64json({ account_id: wallet }) }).then((r: any) => big(fromBytes(r)), () => null);
    const [x, y] = await Promise.all([read(d.rpc), read(d.rpc2)]);
    if (x === null || y === null || x !== y) return null;
    const got = x - before;
    return got >= BigInt(minOut) ? { landed: true, got } : { notArrived: true };
  }
  /** One Rhea trade at a time for the NEAR coin wallet, whatever the coin (final read: per wallet, never per coin; the
   *  core's Put away signs in the same wallet's one turn): another trade's coin or NEAR never counts for this one. */
  let walletTurn: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(run: () => Promise<T>): Promise<T> {
    const next = walletTurn.then(run, run);
    walletTurn = next.catch(() => undefined);
    return next;
  }

  /**
   * The one-call trade, when it applies: a sale of a coin the wallet holds in Rhea; a buy once the wallet is readied
   * (its Rhea account is open), its NEAR outside Rhea moved in before the tap when Rhea's alone is short (the person said
   * yes once). A wallet never readied: the person's one tap (nearProblems.rheaReady). Undefined: the earlier shape (a
   * coin the wallet itself holds, sold the way it was bought; or twoStepBuys).
   */
  async function prepareFast(side: Side, coin: string, amount: Amount, pool: { id: number; feeBps: number }, meta: CoinMeta | undefined, symbol: string): Promise<Prepared | undefined> {
    const tokenIn = side === "buy" ? WNEAR : coin, tokenOut = side === "buy" ? coin : WNEAR;
    // the wallet's Rhea account first: the earlier shape reads nothing more here
    const rh = await rheaOf();
    if (side === "buy" ? !rh.open && d.twoStepBuys : (rh.deposits.get(coin) ?? 0n) <= 0n) return undefined;
    const [px, decimals, outside] = await Promise.all([
      d.nearUsd(),
      meta?.decimals ?? view(coin, "ft_metadata", {}).then((m) => (m as { decimals?: number } | undefined)?.decimals ?? 18, () => 18),
      side === "buy" ? Promise.all([nativeOf(), view(WNEAR, "ft_balance_of", { account_id: await walletOf() }).then(big, () => null)]).then(([n, wn]) => (n > NEAR_GAS_RESERVE ? n - NEAR_GAS_RESERVE : 0n) + (wn ?? 0n)) : Promise.resolve(0n),
    ]);
    const inside = rh.deposits.get(tokenIn) ?? 0n;
    let units: bigint, topUp = false;
    if (side === "buy") {
      if (!rh.open) {
        if (d.twoStepBuys) return undefined;
        // never readied: the person's one tap, before any buy (nothing moved)
        if (outside > 0n) throw new ProblemError(nearProblems.rheaReady());
        throw new ProblemError(nearProblems.rheaShort(0));
      }
      const all = inside + outside;
      units = "usd" in amount ? BigInt(Math.floor((amount.usd / px) * 1e6)) * (YOCTO / 1_000_000n) : "raw" in amount ? BigInt(amount.raw) : all;
      if (units <= 0n || units > all) throw new ProblemError(nearProblems.rheaShort((Number(all) / 1e24) * px));
      topUp = units > inside;
    } else {
      // a coin the wallet itself holds (bought before it was readied) sells the earlier way
      if (inside <= 0n) return undefined;
      units = "fraction" in amount ? (amount.fraction >= 1 ? inside : (inside * BigInt(Math.round(amount.fraction * 1e6))) / 1_000_000n) : "raw" in amount ? BigInt(amount.raw) : inside;
      if (units > inside) units = inside;
      if (units <= 0n) throw new ProblemError(nearProblems.nearNotHeld(symbol));
    }
    const out = big(await view(REF, "get_return", { pool_id: pool.id, token_in: tokenIn, amount_in: units.toString(), token_out: tokenOut }));
    if (!out || out <= 0n) throw new ProblemError(nearProblems.rheaNoPrice(symbol));
    const nearIn = side === "buy" ? Number(units) / 1e24 : Number(out) / 1e24;
    const coinUnits = Number(side === "buy" ? out : units) / 10 ** decimals;
    const nearUsdAmount = nearIn * px;
    const coinUsd = meta?.priceUsd ? coinUnits * meta.priceUsd : nearUsdAmount;
    const payUsd = side === "buy" ? nearUsdAmount : coinUsd;
    const getUsd = side === "buy" ? coinUsd : nearUsdAmount;
    const quote: Quote = {
      side, chain: "near", coin, symbol, decimals,
      payRaw: units.toString(), payUsd, getRaw: out.toString(), getUsd,
      getMinRaw: ((out * BigInt(10_000 - RHEA_SLIPPAGE_BPS)) / 10_000n).toString(),
      // the pool's own fee and one call's gas (about a third of the earlier shape's), said as one fee
      feeRaw: "0", feeUsd: Math.round((payUsd * (pool.feeBps / 10_000) + (SWAP_GAS_NEAR / 3) * px) * 100) / 100,
      route: "Rhea", slippageBps: RHEA_SLIPPAGE_BPS, expiresAt: now() + QUOTE_MS,
    };
    const ask: NearTradeAsk = { side, coin, poolId: pool.id, amountIn: quote.payRaw, minOut: quote.getMinRaw };
    // before the tap, never in its time: the wallet's NEAR outside Rhea goes in (a buy past Rhea's own), and room for a
    // coin its Rhea account hasn't held (Ref refuses a swap without it)
    const needRoom = !rh.deposits.has(tokenOut) && rh.roomYocto < COIN_ROOM_YOCTO;
    let readied: Promise<void> | undefined;
    const ready = (): Promise<void> => (readied ??= (async () => {
      if (topUp) await rheaAdd("all");
      else if (needRoom) await rheaAdd("0");
    })().catch((e: unknown) => { readied = undefined; throw e; }));
    return { key: `rheaf|${side}|${coin}|${units}|${out}`, at: now(), quote, steps: [], ready, ...({ ask, fast: true } as object) } as Prepared;
  }

  /** What a one-call swap's answer says: its amount out (Ref's swap returns it), Rhea's refusal (nothing moved: the call
   *  is the swap, all of it or none), or null (not executed yet). */
  function swapOutcome(r: any, ask: NearTradeAsk): { got: bigint } | { refused: string } | null {
    const status = r?.status;
    if (!status || typeof status !== "object" || !("SuccessValue" in status || "Failure" in status)) return null;
    if ("Failure" in status) return { refused: "Rhea refused it." };
    if ((Array.isArray(r?.receipts_outcome) ? r.receipts_outcome : []).some((ro: any) => ro?.outcome?.status && typeof ro.outcome.status === "object" && "Failure" in ro.outcome.status)) return { refused: "Rhea refused it." };
    let got: bigint | null = null;
    try { got = big(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(status.SuccessValue)), (c) => c.charCodeAt(0))))); } catch { got = null; }
    if (got === null) return { refused: "Its answer can't be read." };
    if (got < BigInt(ask.minOut)) return { refused: "Less came back than the least." };
    return { got };
  }

  async function settleFast(p: Prepared, onMove?: (id: string) => void) {
    const ask = (p as Prepared & { ask: NearTradeAsk }).ask;
    const q = p.quote;
    const tokenOut = q.side === "buy" ? q.coin : WNEAR;
    return oneAtATime(async () => {
      type Signed = { signedTx: string; hash: string; signerId: string; beforeOut?: string };
      const sign = () => d.call<Signed | { declined: true }>("subwallet.near.rheaSwap", { ask });
      const r = await sign().catch(async (e: unknown) => {
        // Rhea needs room for this coin (ready() didn't get to it): the core tops it up, then signs once more
        const prob = e instanceof ProblemError ? e.problem : undefined;
        if (prob?.code !== "security.near.rhea" || prob.more !== "room") throw e;
        await rheaAdd("0");
        return sign();
      });
      if ("declined" in r) return { declined: true as const };
      const signedAt = now();
      const before = big(r.beforeOut);
      onMove?.(r.hash);
      // one receipt: the first node's executed answer is the swap's
      let out: any = await d.rpc("send_tx", { signed_tx_base64: r.signedTx, wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => undefined);
      const t0 = now();
      while (!swapOutcome(out, ask) && now() - t0 < RHEA_LAND_MS) {
        await sleep(150);
        out = await d.rpc("tx", { tx_hash: r.hash, sender_account_id: r.signerId, wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => undefined)
          ?? await d.rpc2("tx", { tx_hash: r.hash, sender_account_id: r.signerId, wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => undefined);
      }
      const o = swapOutcome(out, ask);
      if (!o) throw new ProblemError(nearProblems.rheaPending(q.symbol));
      if ("refused" in o) throw new ProblemError({ ...nearProblems.rheaRefunded(q.symbol), money: { state: "safe", where: "in your NEAR wallet" }, more: o.refused });
      // and the wallet's new Rhea balance, read (the receipt's own block, then the next): at least what the swap gave
      if (before !== null) {
        const t1 = now();
        for (;;) {
          const after = await rheaOf(d.rpc, { finality: "optimistic" }).then((x) => x.deposits.get(tokenOut) ?? 0n, () => null);
          if (after !== null && after - before >= o.got) break;
          if (now() - t1 >= RHEA_BALANCE_MS) throw new ProblemError(nearProblems.rheaPending(q.symbol));
          await sleep(150);
        }
      }
      const landedAt = now();
      const fill: Fill = { txHash: r.hash, got: o.got.toString(), spent: q.payRaw, fee: "0" };
      // booked on another node's FINAL answer, the same amount out (behind the receipt, never in the tap's wait)
      const verify = d.rpc2("tx", { tx_hash: r.hash, sender_account_id: r.signerId, wait_until: "FINAL" }).then((f) => {
        const v = swapOutcome(f, ask);
        return v ? "got" in v && v.got === o.got : undefined;
      }, () => undefined);
      return { fill, timing: { signedAt, sentAt: signedAt, landedAt }, verify };
    });
  }

  const engine: RheaEngine = {
    chain: "near",
    owner: "",
    poolOf,
    heldOf,
    rheaOf: () => rheaOf(),
    readyNear: () => rheaAdd("all"),

    async prepare(side: Side, coin: string, amount: Amount): Promise<Prepared> {
      const pool = await poolOf(coin);
      const meta = await d.meta?.(coin).catch(() => undefined);
      const symbol = meta?.symbol ?? coin.split(".")[0]!.toUpperCase().slice(0, 12);
      if (!pool) throw new ProblemError(nearProblems.rheaNoPool(symbol));
      const w = await walletOf();
      const fast = await prepareFast(side, coin, amount, pool, meta, symbol);
      if (fast) return fast;
      // the coin's account (a buy) or wNEAR's (a sale), read now beside the rest: ready() then waits for nothing when it is
      // there (the tap's own ready() never reads it again)
      const target = side === "buy" ? coin : WNEAR;
      const reg = view(target, "storage_balance_of", { account_id: w }).catch(() => undefined);
      const [decimals, px, bal] = await Promise.all([
        meta?.decimals ?? view(coin, "ft_metadata", {}).then((m) => (m as { decimals?: number } | undefined)?.decimals ?? 18, () => 18),
        d.nearUsd(),
        side === "buy" ? Promise.all([nativeOf(), view(WNEAR, "ft_balance_of", { account_id: w }).then(big, () => null)]) : walletHeld(coin).then((h) => [h, null] as const),
      ]);
      let units: bigint;
      if (side === "buy") {
        const [native, wnear] = bal;
        const spendable = (native > NEAR_GAS_RESERVE ? native - NEAR_GAS_RESERVE : 0n) + (wnear ?? 0n);
        units = "usd" in amount ? BigInt(Math.floor((amount.usd / px) * 1e6)) * (YOCTO / 1_000_000n) : "raw" in amount ? BigInt(amount.raw) : spendable;
        if (units <= 0n || units > spendable) throw new ProblemError(nearProblems.nearShort((Number(spendable) / 1e24) * px));
      } else {
        const have = bal[0];
        if (have <= 0n) throw new ProblemError(nearProblems.nearNotHeld(symbol));
        units = "fraction" in amount ? (amount.fraction >= 1 ? have : (have * BigInt(Math.round(amount.fraction * 1e6))) / 1_000_000n) : "raw" in amount ? BigInt(amount.raw) : have;
        if (units > have) units = have;
        if (units <= 0n) throw new ProblemError(nearProblems.nearNotHeld(symbol));
      }
      const [tokenIn, tokenOut] = side === "buy" ? [WNEAR, coin] : [coin, WNEAR];
      const out = big(await view(REF, "get_return", { pool_id: pool.id, token_in: tokenIn, amount_in: units.toString(), token_out: tokenOut }));
      if (!out || out <= 0n) throw new ProblemError(nearProblems.rheaNoPrice(symbol));
      const nearIn = side === "buy" ? Number(units) / 1e24 : Number(out) / 1e24;
      const coinUnits = Number(side === "buy" ? out : units) / 10 ** decimals;
      const nearUsdAmount = nearIn * px;
      const coinUsd = meta?.priceUsd ? coinUnits * meta.priceUsd : nearUsdAmount;
      const payUsd = side === "buy" ? nearUsdAmount : coinUsd;
      const getUsd = side === "buy" ? coinUsd : nearUsdAmount;
      const quote: Quote = {
        side, chain: "near", coin, symbol, decimals,
        payRaw: units.toString(), payUsd, getRaw: out.toString(), getUsd,
        getMinRaw: ((out * BigInt(10_000 - RHEA_SLIPPAGE_BPS)) / 10_000n).toString(),
        // the pool's own fee and the network's gas, said as one fee
        feeRaw: "0", feeUsd: Math.round((payUsd * (pool.feeBps / 10_000) + SWAP_GAS_NEAR * px) * 100) / 100,
        route: "Rhea", slippageBps: RHEA_SLIPPAGE_BPS, expiresAt: now() + QUOTE_MS,
      };
      const ask: NearTradeAsk = { side, coin, poolId: pool.id, amountIn: quote.payRaw, minOut: quote.getMinRaw };
      // once: the sheet's ready() and the tap's are the same answer (a failure is asked again, freshly read)
      let readied: Promise<void> | undefined;
      let first: Promise<unknown> | undefined = reg;
      const ready = (): Promise<void> => (readied ??= (async () => {
        const r = await (first ?? view(target, "storage_balance_of", { account_id: w }).catch(() => undefined));
        first = undefined;
        if (r === null) await register(target, pool.id);
      })().catch((e: unknown) => { readied = undefined; first = undefined; throw e; }));
      return {
        key: `rhea|${side}|${coin}|${units}|${out}`, at: now(), quote, steps: [],
        // the button waits for the coin's account in the wallet (a buy's first time) or wNEAR's (a sale's): opened now,
        // never at the tap
        ready,
        ...({ ask } as object),
      } as Prepared;
    },

    async settle(p: Prepared, _key: string, onMove?: (id: string) => void) {
      if ((p as Prepared & { fast?: boolean }).fast) return settleFast(p, onMove);
      const ask = (p as Prepared & { ask: NearTradeAsk }).ask;
      const q = p.quote;
      const tokenOut = q.side === "buy" ? q.coin : WNEAR;
      return oneAtATime(async () => {
        type Signed = { signedTx: string; hash: string; signerId: string; beforeOut?: string; atHeight?: number };
        const sign = () => d.call<Signed | { declined: true }>("subwallet.near.trade", { ask });
        const r = await sign().catch(async (e: unknown) => {
          // the coin's account isn't there yet (ready() didn't get to it): opened, then signed once more
          const prob = e instanceof ProblemError ? e.problem : undefined;
          if (prob?.code !== "security.near.register" || typeof prob.more !== "string") throw e;
          await register(prob.more, ask.poolId);
          return sign();
        });
        if ("declined" in r) return { declined: true as const };
        const signedAt = now();
        const before = big(r.beforeOut);
        onMove?.(r.hash);
        // the bytes leave now; the wait is the chain's: every receipt executed on the first node
        let out: any = await d.rpc("send_tx", { signed_tx_base64: r.signedTx, wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => undefined);
        const sentAt = signedAt;
        // no answer from the send: asked by its hash, on either node, until it executed (bounded)
        const t0 = now();
        while (!nearOutcome(out, ask, r.signerId) && now() - t0 < RHEA_LAND_MS) {
          await sleep(250);
          out = await d.rpc2("tx", { tx_hash: r.hash, sender_account_id: r.signerId, wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => undefined)
            ?? await d.rpc("tx", { tx_hash: r.hash, sender_account_id: r.signerId, wait_until: "EXECUTED_OPTIMISTIC" }).catch(() => undefined);
        }
        const o = nearOutcome(out, ask, r.signerId);
        if (!o) throw new ProblemError(nearProblems.rheaPending(q.symbol));
        if ("refunded" in o) throw new ProblemError(nearProblems.rheaRefunded(q.symbol));
        if ("failed" in o) throw new ProblemError({ ...nearProblems.rheaRefunded(q.symbol), more: o.failed });
        let got: bigint;
        if ("unproven" in o) {
          // no transfer line says where the coin went: NEAR's FINAL answer, then the balance at a final block past it,
          // on both nodes, decide; until then it is pending (re-review M), never "refunded"
          const final = await d.rpc2("tx", { tx_hash: r.hash, sender_account_id: r.signerId, wait_until: "FINAL" }).catch(() => undefined)
            ?? await d.rpc("tx", { tx_hash: r.hash, sender_account_id: r.signerId, wait_until: "FINAL" }).catch(() => undefined);
          const f = final ? nearOutcome(final, ask, r.signerId) : null;
          if (f && "landed" in f) got = f.got;
          else if (f && "refunded" in f) throw new ProblemError(nearProblems.rheaRefunded(q.symbol));
          else if (f && "unproven" in f && before !== null) {
            const v = await byFinalBalance(tokenOut, r.signerId, before, ask.minOut, final);
            if (!v) throw new ProblemError(nearProblems.rheaPending(q.symbol));
            if ("notArrived" in v) throw new ProblemError(nearProblems.rheaNotArrived(q.symbol));
            got = v.got;
          } else throw new ProblemError(nearProblems.rheaPending(q.symbol));
        } else got = o.got;
        const landedAt = now();
        const fill: Fill = { txHash: r.hash, got: got.toString(), spent: q.payRaw, fee: "0" };
        // booked on another node's FINAL answer, the same outcome (behind the receipt, never in the tap's wait)
        const signerId = r.signerId;
        const verify = d.rpc2("tx", { tx_hash: r.hash, sender_account_id: signerId, wait_until: "FINAL" }).then(async (f) => {
          let v = nearOutcome(f, ask, signerId);
          if (v && "unproven" in v) {
            if (before === null) return undefined;
            const b = await byFinalBalance(tokenOut, signerId, before, ask.minOut, f);
            if (!b) return undefined;
            return "landed" in b && b.got === got;
          }
          if (!v) return undefined;
          return "landed" in v && v.got === got;
        }, () => undefined);
        return { fill, timing: { signedAt, sentAt, landedAt }, verify };
      });
    },

    async holdings(coins?: string[]) {
      // the wallet's own and its Rhea account's (every coin there, listed or not), so nothing looks missing; its NEAR in
      // Rhea counts as its NEAR
      const rh = await rheaOf().catch(() => undefined);
      const list = [...new Set([...(coins ?? []), ...[...(rh?.deposits.keys() ?? [])].filter((c) => c !== WNEAR)])];
      const [native, held] = await Promise.all([nativeOf(), Promise.all(list.map(async (coin) => ({ coin, raw: ((await walletHeld(coin).catch(() => 0n)) + (rh?.deposits.get(coin) ?? 0n)).toString(), decimals: (await d.meta?.(coin).catch(() => undefined))?.decimals ?? 18 })))]);
      return { native: (native + (rh?.deposits.get(WNEAR) ?? 0n)).toString(), coins: held.filter((h) => BigInt(h.raw) > 0n) };
    },

    // the core signs and this engine sends inside settle(); nothing for the service's own send path
    async send() { throw new Error("NEAR coin trades are sent by the Rhea engine itself"); },
    txHash() { throw new Error("NEAR coin trades are named by the core's own hash"); },
    async status() { return "unknown"; },
    async fill() { return undefined; },
    poolChanged(coin: string) { pools.delete(coin); },
  };
  return engine;
}
