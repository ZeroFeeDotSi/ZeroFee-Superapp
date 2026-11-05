// The mainnet copy (product decision, 4 Nov; tools/fork/): agents walk the real app with real mainnet state (its programs, pools and
// coins) and fake money, on this Mac. A local web build made with VITE_FORK=1 sends every chain the copy has to this
// Mac's own node for it, from one fixed table (forkTable), and nothing else:
//   Solana http://127.0.0.1:8899 (tools/fork/sol)   BNB Chain http://127.0.0.1:8545 and Robinhood Chain http://127.0.0.1:8546
//   (tools/fork/evm, anvil)   NEAR mainnet http://127.0.0.1:3030 (tools/fork/near, near-sandbox)
//   Jupiter's API (off-chain) http://127.0.0.1:8897, a stand-in on the Solana copy (tools/fork/sol/jup.ts)
// Every node list in the code is written as onCopy(chain, [...its nodes]): that is the one override point. Off the copy it
// is the list as written (the same array); on it, the chain's local node in every slot, and a chain the copy doesn't have
// (Ethereum, Base, Arbitrum, Gnosis) gets no node at all, so nothing on the copy can reach a real network's node.
// NEAR testnet is not mainnet and stays as it is: the testnet page (`/`) makes its account with testnet's sponsor, and its
// trading wallets trade on the copy. `/?mainnet` runs NEAR on the copy too.
//
// Two-node rule: money reads ask two nodes and need them to agree (audit T-6, the core's test runs). On the copy both
// slots are answered by the one local node (as 127.0.0.1 and as localhost, so the checks that need two different
// nodes see two). That is allowed here, on the copy, and nowhere else: off the copy every list
// is its real operators, as before.
//
// One read goes past the copy, read-only and on the copy only: set-up's band prices read Ref's NEAR pool on real mainnet
// (demo-core.ts bandPriceChain), since the copy's NEAR can't hold Ref's state. Nothing is signed or sent there.
//
// 1Click (NEAR Intents) can't be copied: on the copy every cross-chain leg (a quote, an intent, a deposit status) is
// refused with one line (FORK_CROSS_CHAIN), never a hanging move.
//
// Never in a shipped build: the phone's (apps/ios/build-web.sh), the public site's (apps/web/deploy-app.sh) and the
// Chrome extension's (tools/extension/build-zip.sh) unset VITE_FORK, vite.config.ts refuses it beside any release target,
// and the phone's own core gets no VITE_FORK at all (apps/ios/core/build.mjs CORE_ENV). Off, forkTable is dropped from
// the bundle (no local address ships: speed-budget.test.ts and deploy-app.sh check it).
import type { Problem } from "./problem.ts";

/** Is this the copy's build? Set at build time only. Written as import.meta.env?.VITE_… so the bundler replaces it with
 *  its literal; under node (tests) it reads as off. */
export const FORK: boolean = false || import.meta.env?.VITE_FORK === "1";

/** The chains the copy has, by the core's own names, and "jup": Jupiter's quote API, which is off-chain, so the copy
 *  has a stand-in for it (tools/fork/sol/jup.ts) that builds each swap on the copy's own blockhash. */
export type ForkChain = "sol" | "bsc" | "hood" | "near" | "jup";
/** The copy's fixed table: one local node per chain. Read only through COPY (and by tests). */
export const forkTable = (): Readonly<Record<ForkChain, string>> => ({
  sol: "http://127.0.0.1:8899",
  bsc: "http://127.0.0.1:8545",
  hood: "http://127.0.0.1:8546",
  near: "http://127.0.0.1:3030",
  jup: "http://127.0.0.1:8897",
});
/** The table on the copy's build; null in every other build (the bundler drops forkTable with it). */
export const COPY: Readonly<Record<ForkChain, string>> | null = FORK ? forkTable() : null;

/** A copy node must be this Mac's: plain http to 127.0.0.1 or localhost, a port, nothing after it. */
export const LOOPBACK_NODE = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

/**
 * The one override point: a chain's node list as written, or on the copy the chain's local node in each of its slots
 * (`chain` null: nothing on the copy, for a chain it doesn't have or a live feed's sockets on real mainnet). A table entry that isn't loopback throws: the copy never
 * reaches past this Mac.
 */
export function onCopy<T extends readonly string[]>(chain: ForkChain | null, list: T, table: Readonly<Record<ForkChain, string>> | null = COPY): T {
  if (!table) return list;
  if (chain === null) return [] as unknown as T;
  const node = table[chain];
  if (!LOOPBACK_NODE.test(node)) throw new Error(`the mainnet copy's ${chain} node must be on this Mac (127.0.0.1 or localhost)`);
  // the same node under its two loopback names, slot by slot: the two-node checks (RpcChain needs two different nodes)
  // see two slots, and both are this one node (the two-node rule, on the copy only)
  const other = node.includes("127.0.0.1") ? node.replace("127.0.0.1", "localhost") : node.replace("localhost", "127.0.0.1");
  return list.map((_, i) => (i % 2 ? other : node)) as unknown as T;
}

/** The one line for a cross-chain leg on the copy (1Click can't be copied). Nothing moved. */
export const FORK_CROSS_CHAIN: Problem = {
  code: "security.copy.no-cross-chain",
  whatHappened: "This copy can't move money between chains. Nothing moved.",
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
};
