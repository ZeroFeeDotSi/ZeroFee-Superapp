// Solana as a ChainEngine (types.ts): the engine's prepare, plus broadcast, status, the fill and holdings, all from the
// chain itself. A signed transaction is public data, so the service keeps it and re-sends the very same bytes until the
// chain proves it landed or expired: it can never fill twice.
import { BalanceMemory } from "../balances.ts";
import { TradeError } from "../errors.ts";
import type { ChainEngine, Fill, Holding, Prepared, TxStatus, TxStep } from "../types.ts";
import { base58, fromBase64 } from "./bytes.ts";
import { mintDecimals, tokenAmount } from "./codec.ts";
import type { SolDeps } from "./context.ts";
import { createSolEngine, type SolEngine } from "./engine.ts";
import { ataOf, PROGRAM, userVolumeAccumulator } from "./keys.ts";
import { createSolRpc, MAX_ACCOUNTS_PER_READ, readsAfter, type NodeAnswer } from "./rpc.ts";
import { isSolProxy } from "@zerofee/core/sol-proxy";
import { buildTx, decodeTx, transfer } from "./tx.ts";

export interface SolChain extends ChainEngine { readonly engine: SolEngine }

const okValues = (a: NodeAnswer[]) => a.filter((x): x is NodeAnswer & { ok: true } => x.ok).map((x) => x.value);
const landedStatus = (v: any): boolean => !!v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized");
/** Two nodes' statuses: "confirmed" or "failed" only when two agree; null: no verdict from these answers. */
export function statusVerdict(vals: readonly any[]): "confirmed" | "failed" | null {
  const landed = vals.filter(landedStatus);
  if (landed.filter((v) => !v.err).length >= 2) return "confirmed";
  if (landed.filter((v) => v.err).length >= 2) return "failed";
  return null;
}
/** How far back this wallet's own signature list is read, to prove a trade never landed. */
export const SIGNATURES_BACK = 1000;
/** A landing's block time may sit this far before the trade's own start (clocks differ). */
export const SINCE_SKEW_MS = 120_000;
/** The nodes that index a wallet's signatures for a keyless caller (core solana.ts SOL_INDEXED_NODES, checked 3 Nov). */
export const SOL_INDEXED = ["https://public.rpc.solanavibestation.com"];
/** A node whose signature list counts: the relay (its paid node) or one that indexes; never a pruned public node. */
const indexes = (node: string | undefined): boolean => !!node && (isSolProxy(node) || SOL_INDEXED.includes(node));
/** The nodes whose own block height (their answer in `heights`) is past `lastValid`: an indexer that has caught up. */
export const caughtUp = (heights: readonly NodeAnswer[], lastValid: number) => (node: string | undefined): boolean =>
  heights.some((x) => x.ok && x.node === node && Number((x as { value: unknown }).value) > lastValid);
/**
 * Does this wallet's signature list prove `hash` never landed? Only an indexing node's answer counts, only from a node
 * that has caught up past the trade's last valid height (`fresh`: the audit's MUST, a lagging indexer leaves a landed trade
 * out), and only one that reaches back before the trade: shorter than SIGNATURES_BACK (the wallet's whole history) or its
 * oldest entry before `since` (less the skew). Any such list naming it: no proof. None that counts: no proof.
 */
export function listProvesAbsent(answers: readonly NodeAnswer[], hash: string, since: number | undefined, fresh: (node: string | undefined) => boolean): boolean {
  const named = answers.some((x) => x.ok && Array.isArray((x as { value: unknown }).value) && (x as { value: any[] }).value.some((e) => e?.signature === hash));
  if (named) return false;
  const lists = answers.filter((x) => x.ok && indexes(x.node) && fresh(x.node) && Array.isArray((x as { value: unknown }).value)).map((x) => (x as { value: any[] }).value);
  if (!lists.length) return false;
  return lists.some((l) => {
    if (l.length < SIGNATURES_BACK) return true;
    const oldest = l[l.length - 1]?.blockTime;
    return since !== undefined && typeof oldest === "number" && oldest * 1000 < since - SINCE_SKEW_MS;
  });
}
/** How long this wallet's last landed trade's slot holds its reads, and the core's test runs, to state at or after it
 *  (as the core's SOL_SLOT_MS): by then every node is long past it. */
export const FRESH_SLOT_MS = 90_000;

/** Other doors for the same signed bytes, beside the public nodes (send speed, Security 28 Oct): `alsoSend` (Jito, jito.ts)
 *  never decides whether the trade was sent; `relaySend` (relay-send.ts) counts only when it answers this transaction's own
 *  signature. Both get a transaction's first send only; its rebroadcasts go to the public nodes. The public nodes are always asked. */
export function createSolChain(o: Omit<SolDeps, "rpc"> & { rpc?: SolDeps["rpc"]; alsoSend?: (signedTx: string) => Promise<void>; relaySend?: (signedTx: string, hash: string) => Promise<boolean>; behindStepMs?: number }): SolChain {
  const nodes = o.rpc ?? createSolRpc();
  const owner = o.owner;
  const now = o.now ?? Date.now;
  // the test real-money run (4 Nov): a sale ~1 s after its buy landed read, and was run on, a node that hadn't seen
  // the buy. The slot the landed check read the last trade in: every state read after it is at or after that slot
  // (readsAfter), the engine's quotes and the holdings included; send, status and the fill read the raw nodes
  let last: { slot: number; at: number } | undefined;
  const freshSlot = (): number | undefined => (last && now() - last.at <= FRESH_SLOT_MS && now() >= last.at ? last.slot : undefined);
  // a slot no node reaches (a code review, 4 Nov) costs one failed read, then is dropped: never 90 s of them
  const rpc = readsAfter(nodes, freshSlot, { ...(o.behindStepMs === undefined ? {} : { stepMs: o.behindStepMs }), stuck: () => { last = undefined; } });
  const engine = createSolEngine({ ...o, rpc });
  const seen = new Set<string>();
  /** A landed status's slot (getSignatureStatuses' value.slot): kept when it is the highest; the coins' pools are read again. */
  const noteSlot = (v: any) => {
    const s = v?.slot;
    if (typeof s !== "number" || !Number.isSafeInteger(s) || s <= 0) return;
    if (last && s < last.slot && freshSlot() !== undefined) return;
    last = { slot: s, at: now() };
    for (const m of seen) engine.poolChanged(m);
  };
  // the transactions already handed to the relay and Jito: a rebroadcast of the same bytes goes to the public nodes only
  // (Security, 28 Oct: one slow trade's 2 s re-sends would use up the relay's 10 a minute just when the next trade needs it)
  const extraSent: string[] = [];
  const accounts = async (keys: string[]) => {
    const out: any[] = [];
    for (let i = 0; i < keys.length; i += MAX_ACCOUNTS_PER_READ) out.push(...((await rpc.call("getMultipleAccounts", [keys.slice(i, i + MAX_ACCOUNTS_PER_READ), { encoding: "base64", commitment: "confirmed" }]))?.value ?? []));
    return out;
  };
  /** The signed transaction's own hash: its first signature. Throws when it isn't signed (then it can't land). */
  const txHash = (signedTx: string): string => {
    const sig = decodeTx(signedTx).signatures[0];
    if (!sig || sig.every((b) => b === 0)) throw new TradeError("unavailable", "The transaction isn't signed");
    return base58(sig);
  };
  /**
   * the audit's MUST (7 Nov, double pay): getSignatureStatuses without history searches only the cluster's recent status cache
   * (about two minutes), so a trade looked at later (the app reopened) read null on both nodes even when it had landed,
   * and was said "expired: nothing was traded" with Try again. Past its height, "expired" now needs BOTH: two nodes'
   * full history without it (history:true), and this wallet's own signature list, from a node that indexes it (the
   * relay's paid door or SOL_INDEXED), reaching back before the trade, without it. A pruned node's null alone, an error,
   * a list that doesn't reach back, or two answers that differ: "pending" (said unconfirmed, checked again, never Try again).
   */
  const provenAbsent = async (hash: string, lastValid: number, since?: number, twoPast = false): Promise<TxStatus> => {
    // the audit's MUST (7 Nov): this runs just past the trade's last valid height, when an indexer may still lag: an indexing
    // node's list counts only if that SAME node's own height, read before its list, is past the last valid height
    const [hist, heights] = await Promise.all([
      nodes.askNodes("getSignatureStatuses", [[hash], { searchTransactionHistory: true }], 2),
      nodes.askNodes("getBlockHeight", [{ commitment: "confirmed" }], 4),
    ]);
    const sigs = await nodes.askNodes("getSignaturesForAddress", [owner, { limit: SIGNATURES_BACK, commitment: "confirmed" }], 4);
    const hv = okValues(hist).map((v) => v?.value?.[0] ?? null);
    if (hv.length < 2) return "unknown";
    const verdict = statusVerdict(hv);
    if (verdict) { if (verdict === "confirmed") for (const v of hv) if (landedStatus(v)) noteSlot(v); return verdict; }
    if (!hv.every((v) => v === null)) return "pending";
    // the live re-check (recheck) comes here with no status() gate before it: two nodes past the last valid height, as there
    if (twoPast && okValues(heights).filter((h) => Number(h) > lastValid).length < 2) return "pending";
    return listProvesAbsent(sigs, hash, since, caughtUp(heights, lastValid)) ? "expired" : "pending";
  };
  return {
    chain: "sol", owner, engine,
    async prepare(side, coin, amount, opts) { seen.add(coin); return engine.prepare(side, coin, amount, opts); },
    txHash,
    async send(signedTx) {
      const hash = txHash(signedTx);
      // skipPreflight: the engine simulated it already; maxRetries 0: the service re-sends the same bytes itself
      const first = !extraSent.includes(hash);
      if (first) { extraSent.push(hash); if (extraSent.length > 100) extraSent.shift(); }
      if (first) void o.alsoSend?.(signedTx).catch(() => undefined);
      const viaRelay = first && o.relaySend ? o.relaySend(signedTx, hash).catch(() => false) : Promise.resolve(false);
      const a = await nodes.askNodes("sendTransaction", [signedTx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }], 2);
      if (a.some((x) => x.ok || /already been processed|AlreadyProcessed/i.test(x.error))) return hash;
      // no public node took it: the relay's paid node may have (it answered this very signature)
      if (await viaRelay) return hash;
      throw new TradeError("node", `No Solana node took the transaction: ${a.map((x) => (x.ok ? "" : x.error)).join("; ")}`);
    },
    async status(hash, step?: TxStep, since?: number): Promise<TxStatus> {
      // speed (Trade's 1 s bar): the first ask is the recent status cache only, as landed() is; history only on the branch below
      const a = await nodes.askNodes("getSignatureStatuses", [[hash], { searchTransactionHistory: false }], 2);
      const vals = okValues(a).map((v) => v?.value?.[0] ?? null);
      const verdict = statusVerdict(vals);
      if (verdict) { if (verdict === "confirmed") for (const v of vals) if (landedStatus(v)) noteSlot(v); return verdict; }
      if (vals.length >= 2 && vals.every((v) => v === null) && step?.lastValidBlockHeight !== undefined) {
        // both nodes say "never seen": it has expired only once both are past its last valid block height
        const h = okValues(await nodes.askNodes("getBlockHeight", [{ commitment: "confirmed" }], 2)).map(Number);
        if (h.length >= 2 && h.every((x) => x > step.lastValidBlockHeight!)) return provenAbsent(hash, step.lastValidBlockHeight, since);
      }
      return vals.length ? "pending" : "unknown";
    },
    /** The live re-check of an unconfirmed trade (types.ts): status()'s history branch alone, the same proof (two full
     *  histories, two nodes past its last valid height, a caught-up indexer's list without it). No cache read, no send. */
    async recheck(hash, step?: TxStep, since?: number): Promise<TxStatus> {
      if (step?.lastValidBlockHeight === undefined) return "unknown";
      return provenAbsent(hash, step.lastValidBlockHeight, since, true);
    },
    /** Speed (3 Nov): the first node that has it `confirmed` with no error says it landed, without waiting for the other
     *  (a confirmed status means a supermajority of the cluster voted on its block). status() stays the two-node verdict. */
    async landed(hash): Promise<"landed" | "pending"> {
      const ok = (x: NodeAnswer) => { const v = x.ok ? x.value?.value?.[0] : null; return !!v && !v.err && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized"); };
      const a = await nodes.askNodes("getSignatureStatuses", [[hash], { searchTransactionHistory: false }], 2, { until: ok });
      const hit = a.find(ok);
      if (!hit) return "pending";
      noteSlot(hit.ok ? hit.value?.value?.[0] : undefined);
      return "landed";
    },
    freshSlot,
    async fill(p: Prepared, hash: string): Promise<Fill | undefined> {
      const a = await nodes.askNodes("getTransaction", [hash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], 2, { until: (x) => x.ok && !!x.value?.meta });
      const mint = p.quote.coin;
      for (const t of okValues(a)) {
        const m = t?.meta;
        if (!m || m.err) continue;
        const keys: any[] = t.transaction?.message?.accountKeys ?? [];
        const i = keys.findIndex((k) => (k.pubkey ?? k) === owner);
        if (i < 0) continue;
        const tot = (xs: any[] | undefined): bigint => (xs ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((n: bigint, b: any) => n + BigInt(b.uiTokenAmount?.amount ?? "0"), 0n);
        const fee = BigInt(m.fee ?? 0), pre = BigInt(m.preBalances[i]), post = BigInt(m.postBalances[i]);
        const coinPre = tot(m.preTokenBalances), coinPost = tot(m.postTokenBalances);
        let got: bigint, spent: bigint, rentBack = 0n, rentPaid = 0n, setupPaid = 0n;
        if (p.quote.side === "buy") {
          // what the swap took: lamports out, less the fee and the rent of token accounts this transaction opened (refundable)
          for (const b of m.postTokenBalances ?? []) if (b.owner === owner && typeof b.accountIndex === "number" && BigInt(m.preBalances[b.accountIndex] ?? 0) === 0n) rentPaid += BigInt(m.postBalances[b.accountIndex] ?? 0);
          // and less pump.fun's one-time account for this wallet, opened by its first buy there (k-trade test, 4 Nov, MOGMAS:
          // 1,346,200 lamports to PumpSwap's user_volume_accumulator were booked as the coin's price, $1.13 for a $1.00 buy)
          const volume = new Set([userVolumeAccumulator(PROGRAM.pump, owner), userVolumeAccumulator(PROGRAM.pumpAmm, owner)]);
          keys.forEach((k, j) => { if (volume.has(k.pubkey ?? k) && BigInt(m.preBalances[j] ?? 0) === 0n) setupPaid += BigInt(m.postBalances[j] ?? 0); });
          got = coinPost - coinPre; spent = pre - post - fee - rentPaid - setupPaid;
        } else {
          // what the swap paid: lamports in, plus the fee, less the rent of the wallet's token accounts this transaction closed
          // (audit SOL-6: a full sale's closed coin account gave its rent back, about 0.002 SOL, and it was booked as proceeds)
          rentBack = 0n;
          for (const b of m.preTokenBalances ?? []) if (b.owner === owner && typeof b.accountIndex === "number" && BigInt(m.postBalances[b.accountIndex] ?? 0) === 0n) rentBack += BigInt(m.preBalances[b.accountIndex] ?? 0);
          got = post - pre + fee - rentBack; spent = coinPre - coinPost;
        }
        if (got <= 0n) continue;
        const at = now();
        engine.memory.settle(BalanceMemory.key(owner), post, at);
        engine.memory.settle(BalanceMemory.key(owner, mint), coinPost, at);
        engine.poolChanged(mint);
        return { txHash: hash, got: got.toString(), spent: spent.toString(), fee: fee.toString(), nativeAfter: post.toString(), coinAfter: coinPost.toString(), ...(rentBack > 0n ? { rentBack: rentBack.toString() } : {}), ...(rentPaid > 0n ? { rentPaid: rentPaid.toString() } : {}), ...(setupPaid > 0n ? { setupPaid: setupPaid.toString() } : {}) };
      }
      return undefined;
    },
    async holdings(coins) {
      const mints = [...new Set([...(coins ?? []), ...seen])];
      const bal = await rpc.call("getBalance", [owner, { commitment: "confirmed" }]);
      const native = engine.memory.fix(BalanceMemory.key(owner), BigInt(bal?.value ?? 0), now());
      if (!mints.length) return { native: native.toString(), coins: [] };
      const keys = mints.flatMap((m) => [m, ataOf(owner, m, PROGRAM.token), ataOf(owner, m, PROGRAM.token2022)]);
      const rows = await accounts(keys);
      const out: Holding[] = [];
      mints.forEach((m, i) => {
        const [mintRow, t1, t2] = [rows[3 * i], rows[3 * i + 1], rows[3 * i + 2]];
        if (!mintRow) return;
        const acct = mintRow.owner === PROGRAM.token2022 ? t2 : t1;
        const raw = engine.memory.fix(BalanceMemory.key(owner, m), acct ? tokenAmount(fromBase64(acct.data[0])) : 0n, now());
        out.push({ coin: m, raw: raw.toString(), decimals: mintDecimals(fromBase64(mintRow.data[0])) });
      });
      return { native: native.toString(), coins: out };
    },
    /** Every token account the wallet owns (both token programs), by the chain's own list; the ones above zero. */
    async tokenBalances() {
      const out: Holding[] = [];
      for (const program of [PROGRAM.token, PROGRAM.token2022]) {
        const r = await rpc.call("getTokenAccountsByOwner", [owner, { programId: program }, { encoding: "jsonParsed", commitment: "confirmed" }]);
        for (const row of r?.value ?? []) {
          const t = row?.account?.data?.parsed?.info?.tokenAmount;
          const mint = row?.account?.data?.parsed?.info?.mint;
          if (typeof mint === "string" && typeof t?.amount === "string" && /^\d+$/.test(t.amount) && BigInt(t.amount) > 0n) out.push({ coin: mint, raw: t.amount, decimals: Number(t.decimals) || 0 });
        }
      }
      return out;
    },
    /** SOL out of the trading wallet. "all" leaves exactly the fee, so the wallet ends at zero. */
    async transfer(to, raw) {
      const [bh, bal] = await Promise.all([rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }]), rpc.call("getBalance", [owner, { commitment: "confirmed" }])]);
      const have = BigInt(bal?.value ?? 0), fee = 5_000n;
      const lamports = raw === "all" ? have - fee : BigInt(raw);
      if (lamports <= 0n || lamports + fee > have) throw new TradeError("funds", "Not enough SOL to move and pay the fee", have === 0n ? "wallet-empty" : "sol-low");
      const tx = buildTx(owner, bh.value.blockhash, [transfer(owner, to, lamports)]);
      return {
        key: `transfer|sol|${to}|${lamports}`, at: now(), steps: [{ id: "swap", tx, lastValidBlockHeight: Number(bh.value.lastValidBlockHeight) }], ready: async () => {},
        quote: { side: "sell", chain: "sol", coin: "SOL", symbol: "SOL", decimals: 9, payRaw: lamports.toString(), payUsd: 0, getRaw: lamports.toString(), getUsd: 0, getMinRaw: lamports.toString(), feeRaw: fee.toString(), feeUsd: 0, route: "Transfer", slippageBps: 0, expiresAt: now() + 60_000 },
      };
    },
    poolChanged: (coin) => engine.poolChanged(coin),
  };
}
