// the audit's MUST (7 Nov, double pay): a Solana trade looked at after its status left the cluster's recent status cache (about
// two minutes: the app closed and reopened) read null on both nodes without history, its height was past, and it was
// said "expired: nothing was traded" with Try again, though it had landed. "Expired" now needs two nodes' full history
// without it AND the wallet's own signature list, from a node that indexes it and reaching back before the trade,
// without it. Anything less (a pruned node, an error, a short reach, a disagreement) is not expired.
// Controls: a truly absent trade past its height still reads expired; a normal confirm and landed() never ask history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSolChain, listProvesAbsent, SIGNATURES_BACK, SINCE_SKEW_MS, SOL_INDEXED } from "./chain.ts";
import type { NodeAnswer, SolRpc } from "./rpc.ts";

const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const HASH = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const LAST_VALID = 300_000_000;
const STEP = { id: "swap" as const, tx: "", lastValidBlockHeight: LAST_VALID };
const SINCE = 1_800_000_000_000;
const PUB = "https://solana-rpc.publicnode.com", POCKET = "https://solana.api.pocket.network", INDEXED = SOL_INDEXED[0]!;
const CONFIRMED = { slot: 310_000_000, confirmations: null, err: null, confirmationStatus: "finalized" };

type Answer = unknown | Error;
interface FakeNode {
  url: string;
  /** getSignatureStatuses: without history (the cache) and with it */
  cache?: Answer;
  history?: Answer;
  height?: number;
  /** getSignaturesForAddress */
  sigs?: Answer;
}
const val = (a: Answer) => { if (a instanceof Error) throw a; return a; };

function fake(nodes: FakeNode[]) {
  const asked: { method: string; params: unknown[]; node: string }[] = [];
  const one = (n: FakeNode, method: string, params: unknown[]): unknown => {
    asked.push({ method, params, node: n.url });
    if (method === "getSignatureStatuses") {
      const hist = (params[1] as { searchTransactionHistory?: boolean } | undefined)?.searchTransactionHistory === true;
      return { context: { slot: 1 }, value: [val(hist ? n.history ?? null : n.cache ?? null)] };
    }
    if (method === "getBlockHeight") return n.height ?? LAST_VALID + 10;
    if (method === "getSignaturesForAddress") {
      if (n.sigs === undefined) throw new Error("Indexed requests require a personal token");
      return val(n.sigs);
    }
    throw new Error(`not asked here: ${method}`);
  };
  const rpc: SolRpc = {
    async call(method, params = []) { return one(nodes[0]!, method, params); },
    async askNodes(method, params, max = 2) {
      return nodes.slice(0, max).map((n): NodeAnswer => { try { return { ok: true, value: one(n, method, params), node: n.url }; } catch (e) { return { ok: false, error: (e as Error).message, node: n.url }; } });
    },
  };
  return { rpc, asked, history: () => asked.filter((a) => a.method === "getSignatureStatuses" && (a.params[1] as { searchTransactionHistory?: boolean })?.searchTransactionHistory === true).length };
}
const chainOn = (rpc: SolRpc) => createSolChain({ rpc, owner: OWNER, solUsd: async () => 150 });
const status = (nodes: FakeNode[]) => { const f = fake(nodes); return chainOn(f.rpc).status(HASH, STEP, SINCE).then((s) => ({ s, f })); };
const sig = (signature: string, blockTime: number) => ({ signature, slot: 1, err: null, blockTime });

test("a trade that landed, read after it left the status cache, is confirmed, never expired (main: expired, so Try again paid twice)", async () => {
  const { s } = await status([{ url: PUB, history: CONFIRMED }, { url: POCKET, history: CONFIRMED }, { url: INDEXED, sigs: [sig(HASH, SINCE / 1000)] }]);
  assert.equal(s, "confirmed");
});

test("a landed trade whose two history nodes differ (one pruned: null; one has it) is pending, never expired", async () => {
  const { s } = await status([{ url: PUB, history: null }, { url: POCKET, history: CONFIRMED }, { url: INDEXED, sigs: [] }]);
  assert.equal(s, "pending");
});

test("pruned nodes' null alone never makes expired: the wallet's own list names the trade, so it is pending", async () => {
  const { s } = await status([{ url: PUB, history: null }, { url: POCKET, history: null }, { url: INDEXED, sigs: [sig(HASH, SINCE / 1000)] }]);
  assert.equal(s, "pending");
});

test("a signature list from a node that doesn't index counts for nothing (no indexed answer: pending)", async () => {
  // publicnode and Pocket both answer a list (pruned, empty); the indexed node fails
  const { s } = await status([{ url: PUB, history: null, sigs: [] }, { url: POCKET, history: null, sigs: [] }, { url: INDEXED, sigs: new Error("timed out") }]);
  assert.equal(s, "pending");
});

test("an error is never a null: a history read that fails on one node is unknown (said unconfirmed, no Try again)", async () => {
  const { s } = await status([{ url: PUB, history: null }, { url: POCKET, history: new Error("HTTP 503") }, { url: INDEXED, sigs: [] }]);
  assert.equal(s, "unknown");
});

test("control: a trade truly absent past its height (two histories null, the indexed list without it) still reads expired", async () => {
  const { s } = await status([{ url: PUB, history: null }, { url: POCKET, history: null }, { url: INDEXED, sigs: [sig("other", SINCE / 1000 - 5)] }]);
  assert.equal(s, "expired");
});

test("the audit's MUST: a lagging indexer (its own height not yet past the trade's last valid height) proves nothing: pending, never expired", async () => {
  const { s } = await status([{ url: PUB, history: null }, { url: POCKET, history: null }, { url: INDEXED, sigs: [], height: LAST_VALID - 3 }]);
  assert.equal(s, "pending");
});

test("control: the same indexer once caught up past the last valid height proves it: expired", async () => {
  const { s } = await status([{ url: PUB, history: null }, { url: POCKET, history: null }, { url: INDEXED, sigs: [], height: LAST_VALID + 1 }]);
  assert.equal(s, "expired");
});

test("a full list proves absence only when it reaches back before the trade (less the skew)", () => {
  const fresh = () => true;
  const full = (oldestMs: number) => [{ ok: true as const, node: INDEXED, value: Array.from({ length: SIGNATURES_BACK }, (_, i) => sig(`s${i}`, Math.floor((i === SIGNATURES_BACK - 1 ? oldestMs : SINCE + 60_000) / 1000))) }];
  assert.equal(listProvesAbsent(full(SINCE - SINCE_SKEW_MS - 1_000), HASH, SINCE, fresh), true, "reaches back: proven");
  assert.equal(listProvesAbsent(full(SINCE), HASH, SINCE, fresh), false, "starts after the trade: no proof");
  assert.equal(listProvesAbsent(full(SINCE - SINCE_SKEW_MS - 1_000), HASH, undefined, fresh), false, "no start time: only a short list proves");
  assert.equal(listProvesAbsent([{ ok: true, node: PUB, value: [] }], HASH, SINCE, fresh), false, "a pruned public node's empty list: no proof");
  assert.equal(listProvesAbsent([{ ok: true, node: INDEXED, value: [] }], HASH, SINCE, fresh), true, "control: an indexed empty list is the whole history");
  assert.equal(listProvesAbsent([{ ok: true, node: INDEXED, value: [] }], HASH, SINCE, () => false), false, "an indexer not caught up: no proof");
  assert.equal(listProvesAbsent([{ ok: true, node: INDEXED, value: [] }, { ok: true, node: PUB, value: [sig(HASH, 1)] }], HASH, SINCE, fresh), false, "any list naming it: no proof");
});

test("speed: a normal confirm asks the status cache only, and landed() never asks history", async () => {
  const f = fake([{ url: PUB, cache: CONFIRMED }, { url: POCKET, cache: CONFIRMED }]);
  const chain = chainOn(f.rpc);
  assert.equal(await chain.status(HASH, STEP, SINCE), "confirmed");
  assert.equal(await chain.landed!(HASH, STEP), "landed");
  assert.equal(f.history(), 0, "no history read on the hot path");
  assert.ok(!f.asked.some((a) => a.method === "getSignaturesForAddress"));
  // still pending (not past its height): no history read either
  const g = fake([{ url: PUB, height: LAST_VALID - 5 }, { url: POCKET, height: LAST_VALID - 5 }]);
  assert.equal(await chainOn(g.rpc).status(HASH, STEP, SINCE), "pending");
  assert.equal(g.history(), 0);
});

// The live re-check (QA and the audit's MUST, 7 Nov): recheck() is status()'s history branch alone, with the same proof
// and the same gate (two nodes past the last valid height); it never reads the cache or sends.
const recheck = (nodes: FakeNode[]) => { const f = fake(nodes); return chainOn(f.rpc).recheck!(HASH, STEP, SINCE).then((s) => ({ s, f })); };
test("recheck: a trade that landed is confirmed from history (no cache read)", async () => {
  const { s, f } = await recheck([{ url: PUB, history: CONFIRMED }, { url: POCKET, history: CONFIRMED }, { url: INDEXED, sigs: [sig(HASH, SINCE / 1000)] }]);
  assert.equal(s, "confirmed");
  assert.ok(!f.asked.some((a) => a.method === "getSignatureStatuses" && (a.params[1] as { searchTransactionHistory?: boolean })?.searchTransactionHistory === false), "no cache read");
  assert.ok(!f.asked.some((a) => a.method === "sendTransaction"), "no send");
});
test("recheck: proven absent (two histories null, two nodes past its height, a caught-up indexer without it) is expired", async () => {
  const { s } = await recheck([{ url: PUB, history: null }, { url: POCKET, history: null }, { url: INDEXED, sigs: [] }]);
  assert.equal(s, "expired");
});
test("recheck: the same, with only one node past the last valid height, is pending (status()'s gate kept)", async () => {
  const { s } = await recheck([{ url: PUB, history: null, height: LAST_VALID - 2 }, { url: POCKET, history: null, height: LAST_VALID - 2 }, { url: INDEXED, sigs: [], height: LAST_VALID + 1 }]);
  assert.equal(s, "pending");
});
test("recheck: a lagging indexer proves nothing (pending); no last valid height: unknown", async () => {
  assert.equal((await recheck([{ url: PUB, history: null }, { url: POCKET, history: null }, { url: INDEXED, sigs: [], height: LAST_VALID - 3 }])).s, "pending");
  const f = fake([{ url: PUB }, { url: POCKET }]);
  assert.equal(await chainOn(f.rpc).recheck!(HASH, { id: "swap", tx: "" }, SINCE), "unknown");
  assert.equal(f.asked.length, 0);
});
