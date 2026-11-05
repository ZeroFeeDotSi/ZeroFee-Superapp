// The test real-money run (4 Nov): selling all of a coin ~1 s after its buy landed was refused ("Solana's test run of it
// didn't go through") and went through a few seconds later: a node a slot or two behind still had the balance from
// before the buy. Once the landed check reads the slot a trade landed in, every state read of this wallet (the engine's
// quotes, the holdings) is at or after it, and the core is told it (freshSlot -> minSlot). Controls: no landed trade,
// nothing changes; a node that answered is never asked again; a node behind is asked again only briefly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSolChain } from "./chain.ts";
import { base64 } from "./bytes.ts";
import { ataOf, PROGRAM } from "./keys.ts";
import { BEHIND_TRIES, readsAfter, type NodeAnswer, type SolRpc } from "./rpc.ts";

const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const LANDED = 465_000_000;
const minOf = (params: unknown[]): number | undefined => (params.at(-1) as { minContextSlot?: number } | undefined)?.minContextSlot;
const behind = () => new Error("Minimum context slot has not been reached");

/** One node at `slot`, one slot further each time it is asked. Before LANDED it has the wallet before the buy (1 SOL, no
 *  coin account); from LANDED, after it (0.9 SOL, 5,000,000 coins). Asked for a slot it hasn't reached: -32016. */
function node(start: number) {
  let slot = start;
  const asked: { method: string; params: unknown[] }[] = [];
  const mint = new Uint8Array(82); mint[44] = 6; mint[45] = 1;
  const coins = new Uint8Array(165); new DataView(coins.buffer).setBigUint64(64, 5_000_000n, true);
  const answer = (method: string, params: unknown[]): unknown => {
    asked.push({ method, params });
    const now = slot++;
    if (method === "getSignatureStatuses") return { context: { slot: LANDED + 2 }, value: [{ slot: LANDED, confirmations: 0, err: null, confirmationStatus: "confirmed" }] };
    const min = minOf(params);
    if (min !== undefined && now < min) throw behind();
    const after = now >= LANDED;
    if (method === "getBalance") return { context: { slot: now }, value: after ? 900_000_000 : 1_000_000_000 };
    if (method === "getMultipleAccounts") {
      const keys = params[0] as string[];
      return { context: { slot: now }, value: keys.map((k) => (k === MINT ? { data: [base64(mint), "base64"], owner: PROGRAM.token, lamports: 1 } : after && k === ataOf(OWNER, MINT, PROGRAM.token) ? { data: [base64(coins), "base64"], owner: PROGRAM.token, lamports: 2_039_280 } : null)) };
    }
    throw new Error(`not asked here: ${method}`);
  };
  const rpc: SolRpc = {
    async call(method, params = []) { return answer(method, params); },
    async askNodes(method, params) { try { return [{ ok: true, value: answer(method, params) }]; } catch (e) { return [{ ok: false, error: (e as Error).message }]; } },
  };
  return { rpc, asked };
}
const chainOn = (rpc: SolRpc) => createSolChain({ rpc, owner: OWNER, solUsd: async () => 150, behindStepMs: 1 });

test("after a landed trade, the holdings are read at or after its slot: a node behind it is asked again until it is there, and the sale's amount is the post-buy balance (control: no landed trade, read as before)", async () => {
  const n = node(LANDED - 3);
  const chain = chainOn(n.rpc);
  // control: no landed trade yet: no slot asked, and this node's answer (before the buy) is what it says
  const before = await chain.holdings([MINT]);
  assert.equal(before.coins[0]!.raw, "0");
  assert.ok(n.asked.every((a) => minOf(a.params) === undefined), "nothing changes without a landed trade");
  assert.equal(chain.freshSlot!(), undefined);
  assert.equal(await chain.landed("hash"), "landed");
  assert.equal(chain.freshSlot!(), LANDED, "the slot the landed check read");
  const after = await chain.holdings([MINT]);
  assert.equal(after.coins[0]!.raw, "5000000", "the coins the buy brought, never the balance from before it");
  assert.equal(after.native, "900000000");
  assert.ok(n.asked.filter((a) => a.method === "getBalance" || a.method === "getMultipleAccounts").slice(-2).every((a) => minOf(a.params) === LANDED), "minContextSlot sent");
});

test("readsAfter: minContextSlot only on state reads (never on a send or a status); with no slot, the params as asked", async () => {
  const seen: { method: string; params: unknown[] }[] = [];
  const raw: SolRpc = { async call(method, params = []) { seen.push({ method, params }); return 1; }, async askNodes(method, params) { seen.push({ method, params }); return [{ ok: true, value: 1 }]; } };
  let slot: number | undefined;
  const r = readsAfter(raw, () => slot, { stepMs: 1 });
  const cfg = { commitment: "confirmed" };
  await r.call("getBalance", [OWNER, cfg]);
  assert.deepEqual(seen.at(-1)!.params, [OWNER, cfg], "control: no slot");
  slot = LANDED;
  for (const m of ["getBalance", "getAccountInfo", "getMultipleAccounts", "getTokenAccountsByOwner", "simulateTransaction"]) {
    await r.askNodes(m, ["x", cfg], 2);
    assert.equal(minOf(seen.at(-1)!.params), LANDED, m);
  }
  for (const m of ["sendTransaction", "getSignatureStatuses", "getLatestBlockhash", "getTransaction"]) {
    await r.call(m, ["x", cfg]);
    assert.equal(minOf(seen.at(-1)!.params), undefined, m);
  }
  assert.deepEqual(cfg, { commitment: "confirmed" }, "the caller's config is never changed");
});

test("readsAfter: every node behind is asked again at most BEHIND_TRIES times, then fails as before; a node that answered is never asked again", async () => {
  let asks = 0;
  const allBehind: SolRpc = { async call() { asks++; throw behind(); }, async askNodes() { asks++; return [{ ok: false, error: behind().message }]; } };
  const r = readsAfter(allBehind, () => LANDED, { stepMs: 1 });
  await assert.rejects(r.call("getBalance", [OWNER, {}]), /Minimum context slot/);
  assert.equal(asks, 1 + BEHIND_TRIES);
  asks = 0;
  const a = await r.askNodes("getMultipleAccounts", [[OWNER], {}], 2);
  assert.equal(asks, 1 + BEHIND_TRIES);
  assert.equal(a[0]!.ok, false, "never an old balance: no answer");
  // one node behind, the other answered: that answer, at once
  asks = 0;
  const mixed: SolRpc = { async call() { return 1; }, async askNodes(): Promise<NodeAnswer[]> { asks++; return [{ ok: false, error: behind().message }, { ok: true, value: 7 }]; } };
  const got = await readsAfter(mixed, () => LANDED, { stepMs: 1 }).askNodes("getBalance", [OWNER, {}], 2);
  assert.equal(asks, 1);
  assert.ok(got.some((x) => x.ok && x.value === 7));
  // any other error isn't asked again
  asks = 0;
  const other: SolRpc = { async call() { asks++; throw new Error("HTTP 500"); }, async askNodes() { return []; } };
  await assert.rejects(readsAfter(other, () => LANDED, { stepMs: 1 }).call("getBalance", [OWNER, {}]));
  assert.equal(asks, 1);
});

test("a code review: a slot no node reaches costs one failed read, then is dropped: the next read is as before (control: readsAfter says stuck only when every try was behind)", async () => {
  const n = node(LANDED - 3);
  const chain = chainOn(n.rpc);
  // a landed status whose slot no node reaches
  const far = { ...n.rpc, async askNodes(method: string, params: unknown[]) { return method === "getSignatureStatuses" ? [{ ok: true as const, value: { value: [{ slot: 900_000_000_000, err: null, confirmationStatus: "confirmed" }] } }] : n.rpc.askNodes(method, params); } };
  const c2 = createSolChain({ rpc: far as SolRpc, owner: OWNER, solUsd: async () => 150, behindStepMs: 1 });
  assert.equal(await c2.landed("hash"), "landed");
  assert.equal(c2.freshSlot!(), 900_000_000_000);
  await assert.rejects(c2.holdings([MINT]), /Minimum context slot/, "this read fails, never an old balance");
  assert.equal(c2.freshSlot!(), undefined, "dropped");
  assert.ok((await c2.holdings([MINT])).native, "the next read as before");
  assert.equal(minOf(n.asked.at(-1)!.params), undefined);
  // control: a node that catches up never drops the slot
  assert.equal(await chain.landed("hash"), "landed");
  await chain.holdings([MINT]);
  assert.equal(chain.freshSlot!(), LANDED);
  let stuck = 0;
  const r = readsAfter({ async call() { throw behind(); }, async askNodes() { return [{ ok: false as const, error: behind().message }]; } }, () => LANDED, { stepMs: 1, stuck: () => stuck++ });
  await assert.rejects(r.call("getBalance", [OWNER, {}]));
  await r.askNodes("getBalance", [OWNER, {}], 2);
  assert.equal(stuck, 2);
});
