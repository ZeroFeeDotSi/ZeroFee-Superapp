// Is KYBER_EXECUTORS (core evm.ts) still KyberSwap's executor on BNB Chain and Robinhood Chain? Live, read-only:
//   1. KyberSwap's own /route/build, asked for a small native -> USDT swap, names its executor (the swap's callTarget);
//   2. each chain's two nodes hold code at that address, and agree on it.
// Exits 1 when the build names another executor, or a node disagrees. Nothing is signed or sent.
//   node tools/trade/kyber-executor-check.ts
import { sha256 } from "@noble/hashes/sha2.js";
import { KYBER_EXECUTORS } from "../../packages/core/src/evm.ts";
import { decodeCall, type AbiValue } from "../../packages/trade/src/evm/abi.ts";
import { SWAP, SWAP_GENERIC, SWAP_SIMPLE } from "../../packages/trade/src/evm/kyber.ts";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/** The public BIP-39 test phrase's address (abandon … about): never funded, only a sender for the build. */
const SENDER = "0x9858effd232b4033e47d90003d41ec34ecaeda94";
const CHAINS = {
  bsc: { slug: "bsc", usdt: "0x55d398326f99059ff775485246999027b3197955", nodes: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"] },
  hood: { slug: "robinhood", usdt: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", nodes: ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com"] },
} as const;
const json = async (url: string, init?: RequestInit) => (await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })).json() as Promise<any>;
const bytes = (h: string) => Uint8Array.from((h.slice(2).match(/../g) ?? []).map((x) => parseInt(x, 16)));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

let bad = 0;
for (const [chain, c] of Object.entries(CHAINS) as [keyof typeof CHAINS, (typeof CHAINS)[keyof typeof CHAINS]][]) {
  const known = [...KYBER_EXECUTORS[chain]];
  const route = await json(`https://aggregator-api.kyberswap.com/${c.slug}/api/v1/routes?tokenIn=${NATIVE}&tokenOut=${c.usdt}&amountIn=1000000000000000`);
  const build = await json(`https://aggregator-api.kyberswap.com/${c.slug}/api/v1/route/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routeSummary: route?.data?.routeSummary, sender: SENDER, recipient: SENDER, slippageTolerance: 50 }) });
  const data = String(build?.data?.data ?? "");
  let exec = "";
  for (const sig of [SWAP, SWAP_GENERIC]) { const a = decodeCall(sig, data); if (a) exec = String((a[0] as AbiValue[])[0]); }
  const simple = decodeCall(SWAP_SIMPLE, data); if (simple) exec = String(simple[0]);
  const named = known.includes(exec.toLowerCase());
  console.log(`${chain}: KyberSwap's build names executor ${exec || "(none)"}: ${named ? "the one ZeroFee knows" : "NOT the one ZeroFee knows"}`);
  if (!named) bad++;
  const codes = await Promise.all(c.nodes.map(async (n) => String((await json(n, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [known[0], "latest"] }) }))?.result ?? "0x")));
  const sums = codes.map((code) => `${(code.length - 2) / 2} bytes, sha256 ${hex(sha256(bytes(code))).slice(0, 16)}`);
  console.log(`  code on ${c.nodes.length} nodes: ${sums.join(" | ")}`);
  if (codes.some((x) => x.length <= 2 || x !== codes[0])) { console.log("  the nodes don't agree, or there is no code"); bad++; }
}
process.exit(bad ? 1 : 0);
