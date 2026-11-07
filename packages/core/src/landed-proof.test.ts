// the audit's MUST (7 Nov, double pay): the core's "none" (a move in's own transfer that never landed: float-moves ends the move
// "failed, the money still in your wallet") came from two nulls, and a null was also (a) Solana's recent status cache
// forgetting a transfer that landed (getSignatureStatuses without history keeps about two minutes; this check runs a day
// on) and (b) a node that didn't answer at all (both() and pair() give null for an error). Now an error is "unread",
// never an absence, and "none" needs proof: Solana, two full histories and the wallet's own indexed signature list without
// it; EVM, both nodes answered no receipt and the nonce it was signed with is still unused on both.
// Controls: a transfer that truly never landed still reads "none"; a landed one reads "ok".
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcSolChain, SIGNATURES_BACK, SINCE_SKEW_MS, signaturesProveAbsent, type SolChain } from "./solana.ts";
import { RpcEvmChain, type EvmChain } from "./evm.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const A = "https://a.example", B = "https://b.example";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SINCE = 1_800_000_000_000;
const LANDED = { slot: 9, confirmations: null, err: null, confirmationStatus: "finalized" };

type NodeAns = { cache?: unknown; history?: unknown; sigs?: unknown; down?: boolean; downOn?: string };
/** Each node by host: its answers; `down` fails every request, `downOn` one method. */
function stub(by: Record<string, NodeAns>) {
  const real = globalThis.fetch;
  const asked: { host: string; method: string; history: boolean }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const host = new URL(String(url)).origin;
    const n = by[host] ?? {};
    const history = params?.[1]?.searchTransactionHistory === true;
    asked.push({ host, method, history });
    if (n.down || n.downOn === method) return new Response("{}", { status: 503 });
    let result: unknown;
    if (method === "getSignatureStatuses") result = { context: { slot: 10 }, value: [history ? n.history ?? null : n.cache ?? null] };
    else if (method === "getSignaturesForAddress") result = n.sigs ?? [];
    else if (method === "eth_getTransactionReceipt") result = n.cache ?? null;
    else throw new Error(`not asked here: ${method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return { asked, restore: () => void (globalThis.fetch = real) };
}
const sol = () => new RpcSolChain([A, B], [A, B], undefined, undefined, undefined, () => []);

test("Solana status: a node that didn't answer is unread, never a null (main: [null, null] read as 'neither has it')", async () => {
  const s = stub({ [A]: {}, [B]: { down: true } });
  try {
    assert.deepEqual(await sol().status(SIG), [null, "unread"]);
    assert.ok(s.asked.every((a) => !a.history), "the status read is the recent cache only (speed)");
  } finally { s.restore(); }
});

test("EVM receipt: a node that didn't answer is unread, never 'no receipt'", async () => {
  const s = stub({ [A]: {}, [B]: { down: true } });
  try {
    assert.deepEqual(await new RpcEvmChain({ hood: [A, B] } as never).receipt("hood" as never, "0x" + "1".repeat(64)), [null, "unread"]);
  } finally { s.restore(); }
});

test("Solana absent: a transfer that landed, gone from the status cache, is found in history: not absent", async () => {
  const s = stub({ [A]: { history: LANDED }, [B]: { history: LANDED } });
  try { assert.equal(await sol().absent(SIG, WALLET, SINCE), false); } finally { s.restore(); }
});

test("Solana absent: a pruned node's null alone never proves it (the wallet's own list names it; or one history read fails; or the list fails)", async () => {
  for (const [what, by] of [
    ["the list names it", { [A]: { sigs: [{ signature: SIG, blockTime: SINCE / 1000 }] }, [B]: {} }],
    ["one history node down", { [A]: {}, [B]: { downOn: "getSignatureStatuses" } }],
    ["the list can't be read", { [A]: { downOn: "getSignaturesForAddress" }, [B]: { downOn: "getSignaturesForAddress" } }],
  ] as const) {
    const s = stub(by as Record<string, NodeAns>);
    try { assert.equal(await sol().absent(SIG, WALLET, SINCE), false, what); } finally { s.restore(); }
  }
});

test("control: Solana absent when two histories and the wallet's list have no trace of it", async () => {
  const s = stub({ [A]: { sigs: [{ signature: "other", blockTime: SINCE / 1000 }] }, [B]: {} });
  try { assert.equal(await sol().absent(SIG, WALLET, SINCE), true); } finally { s.restore(); }
});

test("a full signature list proves absence only when it reaches back before the move", () => {
  const full = (oldestMs: number) => Array.from({ length: SIGNATURES_BACK }, (_, i) => ({ signature: `s${i}`, blockTime: Math.floor((i === SIGNATURES_BACK - 1 ? oldestMs : SINCE + 60_000) / 1000) }));
  assert.equal(signaturesProveAbsent(full(SINCE - SINCE_SKEW_MS - 1_000), SIG, SINCE), true);
  assert.equal(signaturesProveAbsent(full(SINCE), SIG, SINCE), false);
  assert.equal(signaturesProveAbsent(full(SINCE - SINCE_SKEW_MS - 1_000), SIG), false, "no start: only the whole history proves");
  assert.equal(signaturesProveAbsent([], SIG, SINCE), true, "control: an empty list is the whole history");
});

// ---- the core's landed(): what float-moves reads a day past the deadline before ending a move in "failed, in the wallet"

type Seen = ("ok" | "failed" | null | "unread")[];
async function landedWith(o: { sol?: Partial<SolChain>; evm?: Partial<EvmChain>; chain: "sol" | "hood"; tried?: { nonce?: number } }) {
  const w = new SubWallets({
    vault: new MemoryVault(), sol: (o.sol ?? {}) as SolChain, evm: (o.evm ?? {}) as EvmChain,
    usdPrice: async () => 1, approve: async () => true, emit: () => {}, confirm: { everyMs: 1, forMs: 2 },
  });
  const made = await w.create("chain", o.chain);
  const d = (w as unknown as { floatMoves: { d: { landed: (c: string, t: string, p?: unknown) => Promise<string | null> } } }).floatMoves.d;
  return (proof: boolean) => d.landed(o.chain, SIG, proof ? { ref: { id: made.id }, since: SINCE, ...(o.tried ? { tried: o.tried } : {}) } : undefined);
}

test("Solana landed: two cache nulls are never 'none' without proof (main: 'none', and the move ended 'money in the wallet' though it paid)", async () => {
  let absentAsked = 0;
  const landed = await landedWith({ chain: "sol", sol: { status: async (): Promise<Seen> => [null, null], absent: async () => (absentAsked++, false) } });
  assert.equal(await landed(true), null, "history or the wallet's list has it, or can't say: unknown");
  assert.equal(await landed(false), null, "no proof asked: never none");
  assert.equal(absentAsked, 1);
});

test("Solana landed: a node that didn't answer is never 'none'", async () => {
  const landed = await landedWith({ chain: "sol", sol: { status: async (): Promise<Seen> => [null, "unread"], absent: async () => true } });
  assert.equal(await landed(true), null);
});

test("control: Solana landed reads 'none' when it provably never landed, and 'ok' when one node has it", async () => {
  assert.equal(await (await landedWith({ chain: "sol", sol: { status: async (): Promise<Seen> => [null, null], absent: async () => true } }))(true), "none");
  assert.equal(await (await landedWith({ chain: "sol", sol: { status: async (): Promise<Seen> => [null, "ok"], absent: async () => true } }))(true), "ok");
});

test("EVM landed: no receipt on both is 'none' only when the nonce it was signed with is still unused on both", async () => {
  const evm = (latest: number, pending = latest): Partial<EvmChain> => ({ receipt: async (): Promise<Seen> => [null, null], account: async () => [{ latest, pending, balance: 0n }, { latest, pending, balance: 0n }] });
  assert.equal(await (await landedWith({ chain: "hood", evm: evm(7), tried: { nonce: 7 } }))(true), "none", "control: nonce 7 still free");
  assert.equal(await (await landedWith({ chain: "hood", evm: evm(8), tried: { nonce: 7 } }))(true), null, "nonce used: maybe ours (an unindexed receipt)");
  assert.equal(await (await landedWith({ chain: "hood", evm: evm(7, 8), tried: { nonce: 7 } }))(true), null, "something waits at that nonce");
  assert.equal(await (await landedWith({ chain: "hood", evm: evm(7) }))(true), null, "no nonce kept: can't say");
  const down: Partial<EvmChain> = { receipt: async (): Promise<Seen> => [null, "unread"], account: async () => [{ latest: 7, pending: 7, balance: 0n }, null] };
  assert.equal(await (await landedWith({ chain: "hood", evm: down, tried: { nonce: 7 } }))(true), null, "a node down: never none");
});
