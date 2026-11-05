// A BNB Chain or Robinhood Chain coin's own checks for its page (Wallet V1's market/security.ts at 52d44eb). The page's
// words, and one verdict: a sell check that every recent holder failed (`cantSell`) puts the coin page's Buy away, as a
// Solana coin Buy would refuse does. Never a trade's gate by itself (the engine refuses a buy whose sell reverts in
// simulation, whatever this says).
//   owner(): renounced, no such function, or someone who may still change how the coin works.
//   A SELL CHECK: an eth_call of transfer(pool, a little) FROM a recent holder. A honeypot's usual trap is a transfer that
//   reverts when the receiver is the pool, so a recent buyer that can't send to it means nobody can sell. It can't see a
//   high sell tax or a router's limit, so a pass is said as "recent holders can send it to the pool", never as "safe".
import type { EvmChain } from "../evm/chains.ts";
import { ChainSaid } from "../evm/rpc.ts";
import type { EvmCall } from "./onchain.ts";
import { isPoolId, managerKind, MANAGERS } from "./swaps.ts";

export type Level = "ok" | "warn" | "unknown";
/** `cantSell`: recent holders tried and none could send it to its pool (the chain said so; a node that wouldn't answer is never this). */
/** `owner`: "none" (no owner() or given up), "held" (someone still has it), "unknown" (not read). `sell`: what recent holders'
 *  sends to the pool did ("passes", "fails", "unknown" when it couldn't run). The coin page's strip reads these. */
export interface EvmSecurity { level: Level; notes: string[]; cantSell?: true; owner?: "none" | "held" | "unknown"; sell?: "passes" | "fails" | "unknown" }
export type SellCheck = { ok: true; tried: number; passed: number } | { ok: false; why: string };

const ZERO = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SEL = { balanceOf: "0x70a08231", transfer: "0xa9059cbb", owner: "0x8da5cb5b" };
/** Blocks of Transfer logs looked through for recent holders, a refused range tried smaller (free nodes cap eth_getLogs). */
export const HOLDER_SPANS: Record<EvmChain, number[]> = { bsc: [2000, 500], hood: [6000, 1500] };
const pad = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const big = (h: unknown) => (typeof h === "string" && /^0x[0-9a-f]*$/i.test(h) && h.length > 2 ? BigInt(h) : 0n);

/** The chain's verdict (the call reverted), as against a node that couldn't or wouldn't answer. */
const reverted = (e: unknown) => e instanceof ChainSaid && (e.code === 3 || /revert/i.test(e.message));

/** Where a sale sends the coin: a v2/v3 pool is its own address; a singleton pool id (Uniswap v4, PancakeSwap Infinity,
 *  Pons v2) is the manager that holds the tokens. */
export function sellTarget(chain: EvmChain, pool: string, dex: string): string | undefined {
  if (!isPoolId(pool)) return /^0x[0-9a-fA-F]{40}$/.test(pool) ? pool : undefined;
  return MANAGERS[chain][managerKind(dex)];
}

/** owner(): its address, null when the coin has no such function (it reverts), undefined when it couldn't be asked. */
export async function ownerOf(call: EvmCall, chain: EvmChain, token: string): Promise<string | null | undefined> {
  try {
    const r = await call(chain, "eth_call", [{ to: token, data: SEL.owner }, "latest"]);
    return typeof r === "string" && r.length >= 66 ? "0x" + r.slice(26, 66).toLowerCase() : null;
  } catch (e) { return reverted(e) ? null : undefined; }
}

/** Up to `max` recent holders (plain wallets that still hold some) each send a thousandth of what they hold to `to` (the
 *  pool, or a singleton pool's manager), simulated. A revert is a verdict; a node's refusal is not. */
export async function sellCheck(call: EvmCall, chain: EvmChain, token: string, to: string, max = 3): Promise<SellCheck> {
  const t = token.toLowerCase(), dest = to.toLowerCase();
  let holders: string[] = [];
  try {
    const head = Number(big(await call(chain, "eth_blockNumber", [])));
    for (const span of HOLDER_SPANS[chain]) {
      try {
        const logs = await call(chain, "eth_getLogs", [{ address: token, topics: [TRANSFER_TOPIC], fromBlock: "0x" + Math.max(0, head - span).toString(16), toBlock: "0x" + head.toString(16) }]) as { topics: string[] }[];
        const seen = new Set<string>();
        for (const l of logs.slice(-300).reverse()) {
          const a = "0x" + (l.topics[2] ?? "").slice(26).toLowerCase();
          if (a.length === 42 && a !== ZERO && a !== dest && a !== t) seen.add(a);
        }
        holders = [...seen];
        if (holders.length) break;
      } catch { /* a node that limits the range: the smaller span */ }
    }
  } catch { return { ok: false, why: "its recent transfers aren't read yet" }; }
  if (!holders.length) return { ok: false, why: "no recent holder found" };
  const usable: { a: string; bal: bigint }[] = [];
  const cand = holders.slice(0, 36);
  for (let i = 0; i < cand.length && usable.length < max; i += 6) {
    const batch = await Promise.allSettled(cand.slice(i, i + 6).map(async (a) => {
      const bal = big(await call(chain, "eth_call", [{ to: token, data: SEL.balanceOf + pad(a) }, "latest"]));
      if (bal <= 0n) return undefined;
      const code = await call(chain, "eth_getCode", [a, "latest"]);
      return code && code !== "0x" ? undefined : { a, bal };
    }));
    for (const r of batch) if (r.status === "fulfilled" && r.value && usable.length < max) usable.push(r.value);
  }
  if (!usable.length) return { ok: false, why: "no recent holder still holds it" };
  const results = await Promise.all(usable.map(async (h) => {
    const amount = h.bal > 1000n ? h.bal / 1000n : h.bal;                 // a thousandth: under any per-transaction limit
    try { await call(chain, "eth_call", [{ from: h.a, to: token, data: SEL.transfer + pad(to) + amount.toString(16).padStart(64, "0") }, "latest"]); return "pass" as const; }
    catch (e) { return reverted(e) ? "revert" as const : "node" as const; }
  }));
  if (results.includes("node")) return { ok: false, why: "the network wouldn't run the test" };
  return { ok: true, tried: usable.length, passed: results.filter((r) => r === "pass").length };
}

/** The page's rows: what the owner can do, and whether recent holders can sell. `sellTo` absent: no pool to test against. */
export async function evmSecurity(call: EvmCall, chain: EvmChain, token: string, sellTo?: string): Promise<EvmSecurity> {
  const notes: string[] = [];
  let level: Level = "ok", ownerIs: EvmSecurity["owner"];
  const owner = await ownerOf(call, chain, token);
  if (owner === undefined) { level = "unknown"; ownerIs = "unknown"; notes.push("Its owner isn't checked yet"); }
  else if (owner === null) { ownerIs = "none"; notes.push("No owner: nobody controls the coin's code"); }
  else if (owner === ZERO) { ownerIs = "none"; notes.push("Its owner gave up control"); }
  else { level = "warn"; ownerIs = "held"; notes.push(`It still has an owner (${owner.slice(0, 6)}…${owner.slice(-4)}), who could change how it works`); }
  if (!sellTo) { if (level === "ok") level = "unknown"; notes.push("Selling it isn't tested: it has no market to sell into"); return { level, notes, owner: ownerIs, sell: "unknown" }; }
  const s = await sellCheck(call, chain, token, sellTo).catch((): SellCheck => ({ ok: false, why: "the network wouldn't run the test" }));
  if (!s.ok) { if (level === "ok") level = "unknown"; notes.push(`Selling it isn't tested: ${s.why}`); return { level, notes, owner: ownerIs, sell: "unknown" }; }
  if (s.passed === 0) { level = "warn"; notes.push(`${s.tried === 1 ? "A recent holder" : `${s.tried} recent holders`} couldn't sell it. It's a common trap`); return { level, notes, owner: ownerIs, sell: "fails", cantSell: true }; }
  notes.push(`${s.passed} of ${s.tried} recent holders could sell it (a high sell tax wouldn't show here)`);
  return { level, notes, owner: ownerIs, sell: "passes" };
}
