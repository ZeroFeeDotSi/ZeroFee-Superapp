// Speed (Trade, 3 Nov): the blockhash check on the signing path answers with the first node that says "valid", never
// waits for a slow node, and never calls a silent node's missing answer "expired". Event order only, no clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstValid, RpcSolChain } from "./solana.ts";

/** A promise the test settles by hand. */
function later<T>() {
  let set!: (v: T) => void;
  const p = new Promise<T>((r) => (set = r));
  return { p, set };
}
/** Grace timers the test fires by hand (no clock); `live()` counts the ones set and not cleared. */
function gate() {
  const set = new Map<number, () => void>();
  let id = 0;
  const timers = { set: (f: () => void) => (set.set(++id, f), id), clear: (t: unknown) => void set.delete(t as number) };
  return { wait: timers, open: () => { const fs = [...set.values()]; set.clear(); fs.forEach((f) => f()); }, count: () => set.size, live: () => set.size };
}
const tick = () => new Promise((r) => setImmediate(r));

test("the first node that says valid decides at once: the slow node is never waited for", async () => {
  const fast = later<boolean | null>(), slow = later<boolean | null>();
  let out: boolean | undefined;
  void firstValid([fast.p, slow.p], 400, gate().wait).then((v) => (out = v));
  fast.set(true);
  await tick();
  assert.equal(out, true, "answered before the slow node said anything");
});

test("a node that doesn't answer is not 'expired': the other node's yes is enough (old rule: refused)", async () => {
  assert.equal(await firstValid([Promise.resolve(null), Promise.resolve(true)], 400, gate().wait), true);
});

test("a 'no' from a node behind waits the grace for the other's 'yes'", async () => {
  const g = gate();
  const behind = later<boolean | null>(), ahead = later<boolean | null>();
  let out: boolean | undefined;
  void firstValid([behind.p, ahead.p], 400, g.wait).then((v) => (out = v));
  behind.set(false);
  await tick();
  assert.equal(out, undefined, "not decided on one no");
  ahead.set(true);
  await tick();
  assert.equal(out, true);
});

test("review L6: a 'yes' after a 'no' clears the grace timer (nothing left running)", async () => {
  const g = gate();
  const behind = later<boolean | null>(), ahead = later<boolean | null>();
  void firstValid([behind.p, ahead.p], 400, g.wait);
  behind.set(false);
  await tick();
  assert.equal(g.live(), 1, "the grace runs");
  ahead.set(true);
  await tick();
  assert.equal(g.live(), 0, "cleared once the yes decided");
});

test("a 'no' with no 'yes' within the grace is expired", async () => {
  const g = gate();
  const behind = later<boolean | null>(), silent = later<boolean | null>();
  let out: boolean | undefined;
  void firstValid([behind.p, silent.p], 400, g.wait).then((v) => (out = v));
  behind.set(false);
  await tick();
  assert.equal(g.count(), 1);
  g.open();
  await tick();
  assert.equal(out, false);
});

test("both nodes say no: expired (control)", async () => {
  assert.equal(await firstValid([Promise.resolve(false), Promise.resolve(false)], 400, gate().wait), false);
});

test("no node answers: a failed read, thrown, never 'expired'", async () => {
  await assert.rejects(firstValid([Promise.resolve(null), Promise.resolve(null)], 400, gate().wait), /neither Solana node answered/);
});

test("RpcSolChain.blockhashValid: one node down and one saying valid signs (control: both saying no refuses)", async () => {
  const real = globalThis.fetch;
  try {
    const answer = (byUrl: Record<string, boolean | "down">) => (async (url: string | URL | Request) => {
      const v = byUrl[String(url)];
      if (v === "down") throw new Error("connection refused");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: v } }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example"]);
    globalThis.fetch = answer({ "https://a.example": "down", "https://b.example": true });
    assert.equal(await chain.blockhashValid("11111111111111111111111111111111"), true);
    globalThis.fetch = answer({ "https://a.example": false, "https://b.example": false });
    assert.equal(await chain.blockhashValid("11111111111111111111111111111111"), false);
  } finally {
    globalThis.fetch = real;
  }
});
