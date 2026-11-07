// BNB Chain and Robinhood Chain as a ChainEngine (types.ts): one engine per chain and trading wallet. prepare() tries, in
// the old engine's order: the coin's launchpad curve (if it is still on one), the direct path (its pool on chain, the
// official quoter and router), then KyberSwap. Each returns unsigned EIP-1559 transactions (an exact approve first when a
// sell needs one, then the swap, at consecutive nonces) that the trade service signs and hands back to send().
//
// Guardrails (they override the old engine): every step goes to an allowlisted contract (chains.ts) and every approval is
// the exact amount sold, to an allowlisted spender (a Permit2 allowance: this sell's amount, for 30 minutes). The chain id is
// the chain's own and the nonce is the next one, from two nodes and never below one this engine already sent. Nothing here
// signs or holds a key.
import { buildKyber } from "./aggregator.ts";
import { BalanceMemory } from "../balances.ts";
import { decodeCall } from "./abi.ts";
import { bigOf, fromBase64, hexBig, isAddress, same, short, toHex, word } from "./bytes.ts";
import { CHAINS, FEE_CAPS, isAllowedSpender, isAllowedTarget, KYBER_ROUTER, MAX_APPROVE_GAS, MAX_TX_GAS, PERMIT2, V4, ZERO, type EvmChain } from "./chains.ts";
import { allowanceData, approveData, decodePermit2Allowance, permit2AllowanceData, permit2ApproveRouter } from "./v4.ts";
import {
  APPROVE_GAS_ASSUMED, ASSUMED_BUY_GAS, ASSUMED_SELL_GAS, ceilMul, ctxFor, DEADLINE_SEC, dmetaFor, dropCtx, feeFor, makeCtx, metaFor, newMemo, nonceOf, nonceFloor,
  priceFor, Refusal, revertKind, SPEED_DEN, SPEED_NUM, toNum, toTradeError, wei, NoGas, type Built, type Ctx, type EvmDeps, QUOTE_TTL_MS,
} from "./context.ts";
import { buildDirect, candidatesOf, directPools, directSellsBack, dustPools, gasOf, poolPriceUsd } from "./direct.ts";
import { TradeError } from "../errors.ts";
import { fillOf, receiptOf } from "./fill.ts";
import { buildNative, venueFor } from "./native.ts";
import { ChainSaid, createEvmRpc, type EvmRpc } from "./rpc.ts";
import { parseTx, txHashOf, unsignedTx } from "./tx.ts";
import type { Amount, ChainEngine, CoinMeta, Holding, Prepared, Side, TxStatus, TxStep } from "../types.ts";

/** A direct quote worth less than this share of the market price is checked against the aggregator before it is shown (a shallow pool nobody arbitrages can sit far off the market). */
const SUSPECT_SHARE = 0.7;
/** A proof (a simulation of the exact steps) is run the first time and then at most this often per side and coin. */
export const SIM_EVERY_MS = 4_000;
/** A route proven this recently is ready at once at the tap, unless its newest simulation already said no. */
export const PROOF_TRUST_MS = 30_000;
/** The re-quote after "the price moved" must clear the floor of the quote the user accepted, if that quote is this recent. */
const FLOOR_MEMORY_MS = 120_000;
/** A transaction no node knows any more, whose nonce is still free, is "expired" after this long: it was dropped and the service may build it again. */
export const DROPPED_EXPIRE_MS = 180_000;
/** An approval set back to 0 (an ERC-20 approve, or Permit2's): about 30k to 50k gas; this leaves room. */
const REVOKE_GAS = 80_000n;
const KNOWN = /already known|known transaction|already imported|already in (the )?(pool|mempool)|nonce too low/i;

/**
 * The guardrails, on what was built, whatever path built it: the swap goes to an allowlisted contract (or the Pons curve the
 * launcher named for this coin); an approve is the coin's own approve of an allowlisted spender, or Permit2's naming only the
 * UniversalRouter, and its amount is exactly what this sell moves. Throws "unavailable" otherwise: nothing is handed on.
 */
export function guardSteps(chain: EvmChain, b: Pick<Built, "router" | "pre" | "token" | "curve" | "payRaw" | "side">): void {
  if (!isAllowedTarget(chain, b.router, b.curve)) throw new TradeError("unavailable", "The route goes to a contract this wallet doesn't trade with");
  if (b.pre.length && b.side !== "sell") throw new TradeError("unavailable", "Only a sell approves anything");
  const ur = V4[chain].universalRouter;
  for (const p of b.pre) {
    const sp = p.spender.toLowerCase(), to = p.to.toLowerCase();
    const coinApprove = to === b.token.toLowerCase() && sp !== ur && isAllowedSpender(chain, sp, b.curve) && same(decodeCall("approve(address,uint256)", p.data)?.[0] as string, sp) && decodeCall("approve(address,uint256)", p.data)?.[1] === b.payRaw;
    const p2 = decodeCall("approve(address,address,uint160,uint48)", p.data);
    const permit2 = to === PERMIT2 && sp === ur && !!p2 && same(p2[0] as string, b.token) && same(p2[1] as string, ur) && p2[2] === b.payRaw;
    if (!coinApprove && !permit2) throw new TradeError("unavailable", "The route asks for an approval this wallet doesn't give");
  }
}

/**
 * An absolute cap on what a Trade transaction may pay for gas (audit T-11): the fee per gas and the tip under the chain's
 * FEE_CAPS, the swap's gas under MAX_TX_GAS and each approval's under MAX_APPROVE_GAS, whatever the nodes or a route said.
 */
export function guardFees(chain: EvmChain, fee: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }, gas: { swap: bigint; approvals?: readonly bigint[] }): void {
  const cap = FEE_CAPS[chain];
  if (fee.maxFeePerGas > cap.maxFee || fee.maxPriorityFeePerGas > cap.tip) throw new TradeError("node", `The network fee is far above normal right now (${fee.maxFeePerGas} wei per gas): nothing was built`);
  if (gas.swap > MAX_TX_GAS || (gas.approvals ?? []).some((g) => g > MAX_APPROVE_GAS)) throw new TradeError("unavailable", "The route needs far more gas than a trade does: refused");
}

export interface EvmEngine extends ChainEngine {
  readonly chain: EvmChain;
  /** The coin page opened: everything that doesn't depend on the amount is read now, so the first quote is one round trip. Never throws. */
  warm(coin: string): Promise<void>;
  /**
   * A swap the chain REVERTED, replayed with eth_call from the wallet at the block before its own (the latest block when no
   * node keeps that state): "moved" only for a floor revert, "refused" for anything else (an allowance, a hook, a paused
   * pool). Undefined = the replay passed or no node answered. The service's one re-quote is for "moved".
   */
  whyFailed(txHash: string, step: TxStep): Promise<"moved" | "refused" | undefined>;
  /** Balances settled by trades, so a lagging node's old balance is corrected. */
  readonly memory: BalanceMemory;
}

export interface EvmEngineOptions {
  chain: EvmChain;
  /** The trading wallet (0x…). */
  owner: string;
  /** The chain's native coin (BNB on BNB Chain, ETH on Robinhood) in dollars. */
  nativeUsd(): Promise<number>;
  meta?(coin: string): Promise<CoinMeta | undefined>;
  rpc?: EvmRpc;
  fetch?: typeof fetch;
  now?(): number;
  quoteTtlMs?: number;
}

export function createEvmEngine(o: EvmEngineOptions): EvmEngine {
  if (!isAddress(o.owner)) throw new Error("createEvmEngine: owner is not a 0x address");
  const chain = o.chain, info = CHAINS[chain];
  const rpc = o.rpc ?? createEvmRpc({ chain, ...(o.fetch ? { fetch: o.fetch } : {}) });
  const d: EvmDeps = {
    chain, rpc, owner: o.owner, nativeUsd: o.nativeUsd, ...(o.meta ? { meta: o.meta } : {}), ...(o.fetch ? { fetch: o.fetch } : {}),
    now: o.now ?? Date.now, quoteTtlMs: o.quoteTtlMs ?? QUOTE_TTL_MS,
  };
  const m = newMemo(), memory = new BalanceMemory();
  const c: Ctx = makeCtx(d, m, memory);
  const lost = new Map<string, number>();   // when status() first found a transaction known to no node

  async function build(side: Side, token: string, spec: Amount, kyberOnly = false, othersHeld = 0): Promise<Built> {
    const venueP = kyberOnly ? Promise.resolve(null) : venueFor(c, token).catch(() => null);
    // a buy of a coin not on a launchpad curve has its pools looked for at once, alongside the fee and balance reads (not
    // after them). A sell looks after its balance checks: one for more than is held is refused before any pool is read
    const early = !kyberOnly && side === "buy" && !("max" in spec);
    const poolsP = early ? venueP.then((v) => (v ? undefined : directPools(c, token))) : undefined;
    const [tmeta, dmeta, price, feeSnap] = await Promise.all([metaFor(c, token), dmetaFor(c, token), priceFor(c), feeFor(c)]);
    const ctxP = ctxFor(c, token, side);
    ctxP.catch(() => undefined);
    const balanceFirst = side === "sell" || !("usd" in spec || "raw" in spec);   // Max and a share of a holding need the balance to know the amount
    const ctx0 = balanceFirst ? await ctxP : undefined;
    const symbol = dmeta?.symbol ?? tmeta.symbol ?? short(token);
    const decimals = tmeta.decimals;
    const liquidity = dmeta?.liquidityUsd;
    const maxFee = ceilMul(feeSnap.maxFeePerGas, SPEED_NUM, SPEED_DEN);
    const tipFast = ceilMul(feeSnap.maxPriorityFeePerGas, SPEED_NUM, SPEED_DEN);
    const fee = { maxFeePerGas: maxFee, maxPriorityFeePerGas: tipFast > maxFee ? maxFee : tipFast };
    guardFees(chain, fee, { swap: 0n });                                         // before anything is sized at that fee (audit T-11)
    const baseFee = feeSnap.baseFee;
    const bal0 = ctx0?.nativeBal ?? 0n, tokBal0 = ctx0?.tokenBal ?? 0n;

    // each other coin the wallet holds keeps one sale's gas too, an approve and a swap at the engine's assumed units (fix
    // review RT-4: a near-all buy of a second coin kept only its own sale, so of the two only one could be sold)
    const othersGas = side === "buy" ? BigInt(Math.max(0, Math.floor(othersHeld))) * ceilMul((APPROVE_GAS_ASSUMED + ASSUMED_SELL_GAS) * maxFee, 3n, 2n) : 0n;
    // how much leaves the wallet
    let payRaw: bigint;
    let isMax = false;
    if ("raw" in spec) payRaw = BigInt(spec.raw);
    else if (side === "buy") {
      if ("usd" in spec) payRaw = wei(spec.usd, price);
      else if ("max" in spec) { isMax = true; payRaw = bal0 - ceilMul((ASSUMED_BUY_GAS + APPROVE_GAS_ASSUMED + ASSUMED_SELL_GAS) * maxFee, 3n, 2n) - othersGas; }
      else throw new Refusal("reverted", "A buy is an amount in dollars");
    } else {
      if ("max" in spec) payRaw = tokBal0;
      else if ("fraction" in spec && spec.fraction > 0 && spec.fraction <= 1) payRaw = spec.fraction === 1 ? tokBal0 : (tokBal0 * BigInt(Math.floor(spec.fraction * 1e6))) / 1_000_000n;
      else throw new Refusal("reverted", "A sell is a share of what you hold");
    }
    if (side === "sell" && tokBal0 === 0n) throw new Refusal("no-balance", `You don't hold any ${symbol}`);
    if (payRaw <= 0n) throw new NoGas(`balance ${bal0} does not cover the amount plus gas`, bal0 === 0n);
    if (side === "sell" && payRaw > tokBal0) throw new Refusal("no-balance", `You don't hold that much ${symbol}`);
    const base = { side, token, payRaw, isMax, price, fee, maxFee, baseFee, othersGas, symbol, decimals, ...(liquidity !== undefined ? { liquidity } : {}), ttl: d.quoteTtlMs };

    // a coin still on its launchpad curve trades ON the curve; a curve that refuses this trade gives way to the AMM, then the aggregator (whose "no route" gives way to the curve's reason)
    const venue = await venueP;
    let curveErr: unknown;
    if (venue) {
      try { return await buildNative(c, { ...base, ctxP, ...(dmeta?.priceUsd !== undefined ? { mktUsd: dmeta.priceUsd } : {}) }, venue); }
      catch (e) { if (e instanceof NoGas || !(e instanceof Refusal)) throw e; curveErr = e; }
    }
    const dr = kyberOnly ? undefined : await buildDirect(c, { ...base, ctxP, poolsP, dust: dustPools(dmeta?.pools) });
    if (dr) {
      // a direct quote far under the market price is checked against the aggregator once: the better of the two is kept
      const mkt = dmeta?.priceUsd;
      const fair = mkt && mkt > 0 ? (side === "buy" ? (dr.quote.payUsd / mkt) * 10 ** decimals : ((Number(dr.payRaw) / 10 ** decimals) * mkt / price) * 1e18) : 0;
      if (fair > 0 && Number(dr.quote.getRaw) < fair * SUSPECT_SHARE) {
        const k = await build(side, token, { raw: dr.payRaw.toString() }, true, othersHeld).catch(() => undefined);
        if (k && BigInt(k.quote.getRaw) > BigInt(dr.quote.getRaw)) return k;
      }
      return dr;
    }
    const ctx = ctx0 ?? await ctxP;
    // the aggregator's route is checked against a price of the coin's own (EVM-4): the market's, else its pools' on chain
    // (fix review RT-2a). With neither, a BUY has nothing independent to check it, and isn't offered; a sale still is (its
    // native coin out is the chain's own answer, and a coin nobody can sell is stuck)
    let mktUsd = dmeta?.priceUsd && dmeta.priceUsd > 0 ? dmeta.priceUsd : undefined;
    if (mktUsd === undefined && side === "buy") {
      const pools = await (poolsP ?? directPools(c, token)).catch(() => undefined);
      if (pools) mktUsd = await poolPriceUsd(c, token, side, payRaw, pools, price, decimals).catch(() => undefined);
    }
    if (mktUsd === undefined && side === "buy") throw curveErr ?? new Refusal("unpriced", "The price feed gave no price for this coin", "no market price and no pool to read it from");
    return buildKyber(c, { ...base, ctx, ...(mktUsd !== undefined ? { mktUsd } : {}), ...(curveErr ? { curveErr } : {}) });
  }

  /** The proof of a built trade: the exact steps simulated from the wallet. A revert at the floor is "moved"; any other revert is a refusal. */
  async function prove(b: Built): Promise<void> {
    const w = d.owner;
    const verdict = (reason: string) => { throw revertKind(reason) === "moved" ? new TradeError("moved", "The price moved") : new TradeError("unavailable", b.side === "buy" ? "This coin can't be bought right now" : "This coin can't be sold right now"); };
    if (!b.pre.length) {
      try { await c.rpc("eth_call", [{ from: w, to: b.router, value: hexBig(b.value), data: b.data }, "latest"]); }
      catch (e) {
        if (!(e instanceof ChainSaid)) throw new TradeError("node", "No node answered the simulation");
        if (/insufficient funds/i.test(e.message)) throw new TradeError("funds", "Not enough for this trade and its network fee", "sol-low");
        verdict(e.reason);
      }
      return;
    }
    const r = await c.sim([...b.pre.map((p) => ({ from: w, to: p.to, data: p.data })), { from: w, to: b.router, data: b.data, value: b.value }]).catch(() => undefined);
    if (!r) return;   // no node simulates: no verdict (the floor in the calldata still holds the amount)
    const last = r[r.length - 1]!;
    if (r.slice(0, -1).some((x) => x.status !== "0x1")) throw new TradeError("unavailable", "This coin can't be sold right now");
    if (last.status !== "0x1") verdict(String(last.error?.message ?? "reverted") + (last.returnData ? ` (${last.returnData})` : ""));
  }

  function toPrepared(b: Built, attempt: number): Prepared {
    guardSteps(chain, b);
    guardFees(chain, b.fee, { swap: b.swapGas, approvals: b.pre.map((p) => p.gas) });
    const q = b.quote, fkey = `${b.side}|${b.token}`;
    // the re-quote after the price moved: a fresh quote below the floor the user accepted is a price that really moved
    const last = m.floors.get(fkey);
    if (attempt >= 1 && last && c.now() - last.at < FLOOR_MEMORY_MS && last.pay > 0n && BigInt(q.getRaw) < (last.floor * b.payRaw) / last.pay) throw new TradeError("moved", "The price moved past the floor of the quote you accepted");
    if (attempt === 0) m.floors.set(fkey, { pay: b.payRaw, floor: BigInt(q.getMinRaw), at: c.now() });
    const steps: TxStep[] = [];
    let n = b.nonce;
    const tx = (to: string, value: bigint, gas: bigint, data: string, nonce: number) => unsignedTx({ chainId: info.chainId, nonce, maxPriorityFeePerGas: b.fee.maxPriorityFeePerGas, maxFeePerGas: b.fee.maxFeePerGas, gas, to, value, data });
    for (const p of b.pre) { steps.push({ id: "approve", tx: tx(p.to, 0n, p.gas, p.data, n), nonce: n }); n++; }
    steps.push({ id: "swap", tx: tx(b.router, b.value, b.swapGas, b.data, n), nonce: n });

    // proof: the exact steps simulated the first time and at most every SIM_EVERY_MS; a path that simulated them while building is proven already
    const simKey = fkey;
    let slot = m.sims.get(simKey);
    if (b.simulated) {
      slot = { at: c.now(), p: Promise.resolve(), ok: true };
      m.sims.set(simKey, slot); m.provedAt.set(simKey, c.now());
    } else if (!slot || c.now() - slot.at > SIM_EVERY_MS) {
      const s: { at: number; p: Promise<void>; ok?: boolean; failed?: unknown } = { at: c.now(), p: prove(b) };
      s.p.then(() => { s.ok = true; m.provedAt.set(simKey, c.now()); }, (e) => { s.failed = e; });
      slot = s; m.sims.set(simKey, s);
    }
    const proof = slot;
    return {
      key: `${b.side}|${chain}|${b.token}|${q.payRaw}|${q.getMinRaw}|${q.expiresAt}`, at: c.now(), quote: q, steps,
      // the tap only sends: a route proven in the last PROOF_TRUST_MS goes at once, unless its newest simulation said no; otherwise the tap waits for this proof
      ready: async () => {
        const proven = c.now() - (m.provedAt.get(simKey) ?? -Infinity) < PROOF_TRUST_MS;
        const refused = (e: unknown) => e instanceof TradeError && e.kind !== "node";
        if (proof.failed !== undefined && (refused(proof.failed) || !proven)) throw proof.failed;
        if (!proof.ok && proof.failed === undefined && !proven) await proof.p;
      },
    };
  }

  /** A signed transaction's fields and its own hash; throws when it isn't signed for this chain (then it can't land). */
  const signedOf = (signedTx: string) => {
    const bytes = fromBase64(signedTx);
    let t: ReturnType<typeof parseTx>;
    try { t = parseTx(bytes); } catch { throw new TradeError("unavailable", "Not an EIP-1559 transaction"); }
    if (!t.signature) throw new TradeError("unavailable", "The transaction isn't signed");
    if (t.chainId !== info.chainId) throw new TradeError("unavailable", `The transaction is for chain ${t.chainId}, not ${info.name}`);
    return { t, hash: txHashOf(bytes), raw: toHex(bytes) };
  };
  const engine: EvmEngine = {
    chain, owner: o.owner, memory,
    async prepare(side, coin, amount, opts) {
      if (!isAddress(coin)) throw new TradeError("unavailable", "Not a coin address on this chain");
      const token = coin.toLowerCase();
      m.seen.add(token);
      try {
        const b = await build(side, token, amount, false, opts?.othersHeld ?? 0);
        return toPrepared(b, opts?.attempt ?? 0);
      } catch (e) { throw toTradeError(e, side); }
    },

    txHash: (signedTx) => signedOf(signedTx).hash,
    async send(signedTx) {
      const { t, hash, raw } = signedOf(signedTx);
      const took = (x: { ok: boolean; value?: unknown; error?: string }) => (x.ok ? typeof x.value !== "string" || x.value.toLowerCase() === hash : KNOWN.test(String(x.error ?? "")));
      // send speed A3 (Security, 28 Oct): to every node of the chain at once, the same bytes; the first that takes it answers
      const a = await rpc.askNodes("eth_sendRawTransaction", [raw], Number.POSITIVE_INFINITY, { until: (x) => took(x as never) });
      if (a.some((x) => took(x as never))) {
        // a nonce handed to a sent transaction is never handed out again by a lagging node's count
        m.used = { n: Math.max(t.nonce + 1, nonceFloor(c)), at: c.now() };
        dropCtx(c);
        return hash;
      }
      const said = a.find((x) => !x.ok && x.said);
      if (said && !said.ok) {
        if (/insufficient funds/i.test(said.error)) throw new TradeError("funds", "Not enough for this trade and its network fee", "sol-low");
        throw new TradeError("unavailable", `The network refused the transaction: ${said.error}`);
      }
      throw new TradeError("node", `No ${info.name} node took the transaction`);
    },

    async status(hash, step): Promise<TxStatus> {
      const isMined = (v: any) => !!v?.blockNumber;
      const a = await rpc.askNodes("eth_getTransactionReceipt", [hash], 3, { until: (() => { let n = 0; return (x) => (x.ok && isMined(x.value) ? ++n >= 2 : false); })() });
      const ok = a.filter((x) => x.ok).map((x) => (x as { value: any }).value);
      const mined = ok.filter(isMined);
      if (mined.filter((r) => r.status === "0x1").length >= 2) return "confirmed";
      if (mined.filter((r) => r.status === "0x0").length >= 2) return "failed";
      if (mined.length) return "pending";
      if (ok.length < 2) return ok.length ? "pending" : "unknown";
      if (step?.nonce === undefined) return "pending";
      // no node has a receipt: is it still somewhere (a mempool), and is its nonce still free?
      const [known, counts] = await Promise.all([
        rpc.askNodes("eth_getTransactionByHash", [hash], 2),
        rpc.askNodes("eth_getTransactionCount", [o.owner, "latest"], 2),
      ]);
      const gone = known.filter((x) => x.ok && x.value === null).length >= 2;
      const latest = counts.filter((x) => x.ok).map((x) => { try { return Number(bigOf((x as { value: unknown }).value, "nonce")); } catch { return -1; } }).filter((x) => x >= 0);
      if (!gone || latest.length < 2) { lost.delete(hash); return "pending"; }
      // the nonce was taken by another transaction on two nodes: this one can never land
      if (latest.every((x) => x > step.nonce!)) { lost.delete(hash); return "expired"; }
      // dropped everywhere, its nonce still free: it could only land if someone sent it again; past DROPPED_EXPIRE_MS it is expired and may be built again
      const first = lost.get(hash) ?? c.now();
      lost.set(hash, first);
      return c.now() - first > DROPPED_EXPIRE_MS ? "expired" : "pending";
    },
    /** The live re-check of an unconfirmed trade (types.ts): status() itself, two nodes' receipts and the nonce (a receipt
     *  is history, never a short cache). Read only: nothing is sent again. */
    recheck: (hash, step) => engine.status(hash, step),

    /** Speed (3 Nov): the first node with a mined receipt of status 1 says it landed; status() stays the two-node verdict. */
    async landed(hash): Promise<"landed" | "pending"> {
      const good = (x: { ok: boolean; value?: any }) => x.ok && !!x.value?.blockNumber && x.value.status === "0x1";
      const a = await rpc.askNodes("eth_getTransactionReceipt", [hash], 3, { until: good as never });
      return a.some((x) => good(x as never)) ? "landed" : "pending";
    },

    fill: (p, hash) => fillOf(c, p, hash),

    async whyFailed(hash, step) {
      try {
        const t = parseTx(step.tx);
        const rc = await receiptOf(c, hash).catch(() => undefined);
        const call = { from: o.owner, to: t.to, data: t.data, value: hexBig(t.value), gas: hexBig(t.gas) };
        const tags = rc?.blockNumber ? [hexBig(bigOf(rc.blockNumber, "blockNumber") - 1n), "latest"] : ["latest"];
        for (const tag of tags) {
          try { await rpc.call("eth_call", [call, tag]); return undefined; }
          catch (e) {
            if (!(e instanceof ChainSaid)) continue;                                                      // that block's state is gone on every node: ask the latest
            if (/historical state|not available|missing trie|unknown state|archive/i.test(e.message)) continue;
            return revertKind(e.reason);
          }
        }
      } catch { /* a diagnosis never breaks the service */ }
      return undefined;
    },

    async holdings(coins) {
      const list = [...new Set([...(coins ?? []).filter(isAddress).map((x) => x.toLowerCase()), ...m.seen])];
      const [nativeRaw, ...raws] = await Promise.all([
        c.rpc("eth_getBalance", [o.owner, "latest"]).then((v: unknown) => bigOf(v, "eth_getBalance")),
        ...list.map((t) => c.rpc("eth_call", [{ to: t, data: "0x70a08231" + word(c.wallet) }, "latest"]).then((v: unknown) => (v === "0x" ? 0n : bigOf(v, "balanceOf")), () => undefined)),
      ]);
      const at = c.now();
      const native = memory.fix(BalanceMemory.key(c.wallet), nativeRaw as bigint, at);
      const out: Holding[] = [];
      await Promise.all(list.map(async (t, i) => {
        const r = raws[i];
        if (r === undefined) return;
        const meta = await metaFor(c, t).catch(() => undefined);
        if (!meta) return;
        out.push({ coin: t, raw: memory.fix(BalanceMemory.key(c.wallet, t), r as bigint, at).toString(), decimals: meta.decimals });
      }));
      out.sort((x, y) => list.indexOf(x.coin) - list.indexOf(y.coin));
      return { native: native.toString(), coins: out };
    },

    /**
     * After a sale that failed or expired (audit T-12): its approvals may have landed though the swap didn't. Each one still
     * open is set back to 0: Permit2's allowance for the UniversalRouter (amount 0, expiring now), and the coin's own to
     * Permit2 and to KyberSwap's router. Read on chain first, so nothing is sent when nothing is left.
     */
    async revokeLeft(coin) {
      if (!isAddress(coin)) return undefined;
      const token = coin.toLowerCase(), w = o.owner, UR = V4[chain].universalRouter;
      const allow = (spender: string) => c.rpc("eth_call", [{ to: token, data: allowanceData(w, spender) }, "latest"]).then((r: unknown) => bigOf(r, "allowance"), () => 0n);
      const [p2, toP2, toKyber, feeSnap, bal, nonce] = await Promise.all([
        c.rpc("eth_call", [{ to: PERMIT2, data: permit2AllowanceData(w, token, UR) }, "latest"]).then((r: unknown) => decodePermit2Allowance(r as string), () => ({ amount: 0n, expiration: 0 })),
        allow(PERMIT2), allow(KYBER_ROUTER), feeFor(c),
        c.rpc("eth_getBalance", [w, "latest"]).then((v: unknown) => bigOf(v, "eth_getBalance")), nonceOf(c),
      ]);
      const calls: { to: string; data: string }[] = [];
      if (p2.amount > 0n && p2.expiration > Math.floor(c.now() / 1000)) calls.push({ to: PERMIT2, data: permit2ApproveRouter(token, UR, 0n, 0) });
      if (toP2 > 0n) calls.push({ to: token, data: approveData(PERMIT2, 0n) });
      if (toKyber > 0n) calls.push({ to: token, data: approveData(KYBER_ROUTER, 0n) });
      if (!calls.length) return undefined;
      const maxFee = ceilMul(feeSnap.maxFeePerGas, SPEED_NUM, SPEED_DEN), tipFast = ceilMul(feeSnap.maxPriorityFeePerGas, SPEED_NUM, SPEED_DEN);
      const fee = { maxFeePerGas: maxFee, maxPriorityFeePerGas: tipFast > maxFee ? maxFee : tipFast };
      const gas = REVOKE_GAS;
      guardFees(chain, fee, { swap: 0n, approvals: calls.map(() => gas) });
      if (gas * maxFee * BigInt(calls.length) > bal) return undefined;
      let n = Math.max(nonce, nonceFloor(c));
      const steps: TxStep[] = calls.map((x) => { const s: TxStep = { id: "approve", tx: unsignedTx({ chainId: info.chainId, nonce: n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas, maxFeePerGas: fee.maxFeePerGas, gas, to: x.to, value: 0n, data: x.data }), nonce: n }; n++; return s; });
      const px = await priceFor(c).catch(() => 0), cost = gas * maxFee * BigInt(calls.length);
      return {
        key: `revoke|${chain}|${token}|${steps[0]!.nonce}`, at: c.now(), steps, ready: async () => {},
        quote: { side: "sell", chain, coin: token, symbol: info.native, decimals: 18, payRaw: "0", payUsd: 0, getRaw: "0", getUsd: 0, getMinRaw: "0", feeRaw: cost.toString(), feeUsd: toNum(cost) * px, route: "Approval set back to 0", slippageBps: 0, expiresAt: c.now() + 60_000 },
      };
    },

    /** The native coin out of the trading wallet. "all" leaves exactly the most the gas can cost; a plain send to an account is 21,000 gas (Robinhood adds its L1 data units, +25 %). */
    async transfer(to, raw) {
      if (!isAddress(to) || to.toLowerCase() === ZERO) throw new TradeError("unavailable", "Not an address on this chain");
      const [feeSnap, bal, nonce, est] = await Promise.all([
        feeFor(c), c.rpc("eth_getBalance", [o.owner, "latest"]).then((v: unknown) => bigOf(v, "eth_getBalance")), nonceOf(c),
        c.rpc("eth_estimateGas", [{ from: o.owner, to, value: "0x1" }]).then((v: unknown) => bigOf(v, "eth_estimateGas")).catch((e: unknown) => { throw e instanceof ChainSaid ? new TradeError("unavailable", "That address can't take a transfer") : new TradeError("node", "The network did not answer"); }),
      ]);
      const have = memory.fix(BalanceMemory.key(c.wallet), bal, c.now());
      const gas = est === 21_000n && chain !== "hood" ? est : ceilMul(est, chain === "hood" ? 125n : 120n, 100n);
      const maxFee = ceilMul(feeSnap.maxFeePerGas, SPEED_NUM, SPEED_DEN), tipFast = ceilMul(feeSnap.maxPriorityFeePerGas, SPEED_NUM, SPEED_DEN);
      const fee = { maxFeePerGas: maxFee, maxPriorityFeePerGas: tipFast > maxFee ? maxFee : tipFast };
      guardFees(chain, fee, { swap: gas });
      const maxGasCost = gas * maxFee;
      const value = raw === "all" ? have - maxGasCost : BigInt(raw);
      if (value <= 0n || value + maxGasCost > have) throw new TradeError("funds", `Not enough ${info.native} to move and pay the fee`, have === 0n ? "wallet-empty" : "sol-low");
      const n = Math.max(nonce, nonceFloor(c));
      const px = await priceFor(c).catch(() => 0);
      const paid = gas * (fee.maxFeePerGas < feeSnap.baseFee + fee.maxPriorityFeePerGas ? fee.maxFeePerGas : feeSnap.baseFee + fee.maxPriorityFeePerGas);
      const tx = unsignedTx({ chainId: info.chainId, nonce: n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas, maxFeePerGas: fee.maxFeePerGas, gas, to: to.toLowerCase(), value, data: "0x" });
      return {
        key: `transfer|${chain}|${to.toLowerCase()}|${value}|${n}`, at: c.now(), steps: [{ id: "swap", tx, nonce: n }], ready: async () => {},
        quote: { side: "sell", chain, coin: info.native, symbol: info.native, decimals: 18, payRaw: value.toString(), payUsd: toNum(value) * px, getRaw: value.toString(), getUsd: toNum(value) * px, getMinRaw: value.toString(), feeRaw: paid.toString(), feeUsd: toNum(paid) * px, route: "Transfer", slippageBps: 0, expiresAt: c.now() + 60_000 },
      };
    },

    poolChanged(coin) {
      const t = coin.toLowerCase();
      for (const p of m.pools.get(t)?.pools ?? []) m.spot.delete(p.id);
      for (const p of m.classic.get(t)?.pools ?? []) { m.spot.delete(p.address); m.reserves.delete(p.address); }
      m.venue.delete(t);
      for (const k of [...m.ctx.keys()]) if (k.startsWith(`${t}:`)) m.ctx.delete(k);
    },

    async warm(coin) {
      try {
        if (!isAddress(coin)) return;
        const token = coin.toLowerCase();
        const quiet = <T,>(x: Promise<T>) => x.catch(() => undefined);
        const [pools, ctx, price] = await Promise.all([
          quiet(directPools(c, token)), quiet(ctxFor(c, token, "buy")), quiet(priceFor(c)),
          quiet(metaFor(c, token)), quiet(dmetaFor(c, token)), quiet(feeFor(c)), quiet(venueFor(c, token)),
        ]);
        const v4 = pools?.v4 ?? [], classic = pools?.classic ?? [];
        if (!v4.length && !classic.length) return;
        // one probe swap per route (a dollar, or what the wallet can spare): its gas estimate, its spot price / reserves, are what every later amount reuses
        const probe = price && ctx ? (() => { const one = wei(1, price); const cap = ctx.nativeBal / 4n; return one < cap ? one : cap; })() : 0n;
        const deadline = Math.floor(c.now() / 1000) + DEADLINE_SEC;
        if (probe > 1_000_000_000_000n) {
          const cands = candidatesOf(c, token, "buy", probe, v4, classic);
          const qs = await Promise.all(cands.map((x) => quiet(Promise.all([x.quote(), gasOf(c, token, "buy", x, deadline)]))));
          // NEVER A BUY THAT CAN'T BE SOLD: the best pool's sell-back verdict is read now, so the first quote doesn't wait for it
          let bi = -1;
          qs.forEach((q, i) => { if (q && (bi < 0 || q[0].out > qs[bi]![0].out)) bi = i; });
          if (bi >= 0) await quiet(directSellsBack(c, token, cands[bi]!, cands[bi]!.call(1n, deadline), qs[bi]![0].out, deadline, classic));
        }
        // a coin the wallet already holds: its sell side (balance, Permit2 / router allowances) too
        const held = await quiet(c.rpc("eth_call", [{ to: token, data: "0x70a08231" + word(c.wallet) }, "latest"]));
        if (typeof held === "string" && held.length > 2 && BigInt(held) > 0n) await quiet(ctxFor(c, token, "sell"));
      } catch { /* the first quote does it again */ }
    },
  };
  return engine;
}
