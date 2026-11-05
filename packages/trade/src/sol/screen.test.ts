// The screens' read of what Buy refuses: real mints from the fixtures (a pump.fun coin, PYUSD), and the same mint with a
// freeze authority. Ten mints a call, remembered, and never a throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromBase64 } from "./bytes.ts";
import { PROGRAM } from "./keys.ts";
import type { SolRpc } from "./rpc.ts";
import { createSolScreen } from "./screen.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const pump = load("sol-pump.json"), t22 = load("sol-token2022.json");
const PUMPE = pump.coins.pumpfun.mint;
const frozen = (() => { const b = fromBase64(pump.rows[PUMPE].data); b.set([1, 0, 0, 0], 46); return Buffer.from(b).toString("base64"); })();
const MINTS: Record<string, { owner: string; data: [string, string] } | null> = {
  [PUMPE]: { owner: pump.rows[PUMPE].owner, data: [pump.rows[PUMPE].data, "base64"] },
  [t22.mint]: { owner: t22.owner, data: [t22.data, "base64"] },
  FrozenCoin1111111111111111111111111111111111: { owner: PROGRAM.token2022, data: [frozen, "base64"] },
  NotAMint11111111111111111111111111111111111: { owner: PROGRAM.system, data: ["", "base64"] },
  Missing1111111111111111111111111111111111111: null,
};

/** Two nodes: honest unless `second` says otherwise for a mint; `oneNode`: the second doesn't answer. */
function fakeRpc(o: { fail?: boolean; oneNode?: boolean; second?: Record<string, { owner: string; data: [string, string] } | null> } = {}) {
  const calls: string[][] = [];
  const rpc: SolRpc = {
    async call() { throw new Error("the screen asks two nodes"); },
    async askNodes(method, params) {
      assert.equal(method, "getMultipleAccounts");
      const keys = (params as [string[]])[0];
      calls.push(keys);
      if (o.fail) return [{ ok: false, error: "HTTP 429" }, { ok: false, error: "HTTP 429" }];
      const first = { value: keys.map((k) => MINTS[k] ?? null) };
      if (o.oneNode) return [{ ok: true, value: first }, { ok: false, error: "HTTP 429" }];
      return [{ ok: true, value: first }, { ok: true, value: { value: keys.map((k) => (o.second && k in o.second ? o.second[k] : MINTS[k]) ?? null) } }];
    },
  };
  return { rpc, calls };
}

// Audit T-6: the screen was one node's word. A coin either node says Buy refuses is refused; clean needs both.
test("T-6: a node that hides a coin's freeze authority doesn't clear it; a coin one node alone calls clean is asked again", async () => {
  const lying = fakeRpc({ second: { FrozenCoin1111111111111111111111111111111111: MINTS[PUMPE]! } });
  assert.equal((await createSolScreen(lying.rpc)(["FrozenCoin1111111111111111111111111111111111"])).get("FrozenCoin1111111111111111111111111111111111"), "freezable");
  const lyingFirst = fakeRpc({ second: { [PUMPE]: MINTS.FrozenCoin1111111111111111111111111111111111! } });
  assert.equal((await createSolScreen(lyingFirst.rpc)([PUMPE])).get(PUMPE), "freezable", "either node's refusal counts");
  const one = fakeRpc({ oneNode: true });
  const screen = createSolScreen(one.rpc);
  await screen([PUMPE]);
  await screen([PUMPE]);
  assert.equal(one.calls.length, 2, "one node's 'clean' isn't remembered");
});

test("a list leaves out what Buy refuses: PYUSD (a permanent delegate) and a coin with a freeze authority; a new pump.fun coin stays", async () => {
  const { rpc } = fakeRpc();
  const refused = await createSolScreen(rpc)(Object.keys(MINTS));
  assert.deepEqual(Object.fromEntries(refused), { [t22.mint]: "delegated", FrozenCoin1111111111111111111111111111111111: "freezable" });
});

test("ten mints a call (the free node's cap), each remembered for 10 minutes", async () => {
  const { rpc, calls } = fakeRpc();
  const clock = { t: 0 };
  const screen = createSolScreen(rpc, () => clock.t);
  const many = [...Array.from({ length: 21 }, () => PUMPE).map((m, i) => (i < 11 ? `${m.slice(0, -2)}${String(i).padStart(2, "0")}` : m)), t22.mint];
  await screen(many);
  assert.ok(calls.every((c) => c.length <= 10));
  const n = calls.length;
  assert.deepEqual([...(await screen([PUMPE, t22.mint])).keys()], [t22.mint], "remembered");
  assert.equal(calls.length, n, "no call for what's remembered");
  clock.t += 600_000;
  await screen([PUMPE]);
  assert.equal(calls.length, n + 1, "asked again after 10 minutes");
});

test("a node that can't answer screens nothing out (Buy still checks the mint), and the mint is asked again next time", async () => {
  const failing = fakeRpc({ fail: true });
  const screen = createSolScreen(failing.rpc);
  assert.equal((await screen([t22.mint])).size, 0);
  await screen([t22.mint]);
  assert.equal(failing.calls.length, 2);
});

// T-3: the coin page's "Nobody can freeze your coins" rests only on this read (QA, 3 Nov)
test("clean(): true only after two nodes found the mint clean, within 10 minutes; never before, on one node, a failure or a refusal", async () => {
  let t = 1_000_000;
  const both = createSolScreen(fakeRpc().rpc, () => t);
  assert.equal(both.clean(PUMPE), false, "not read yet");
  await both([PUMPE, "FrozenCoin1111111111111111111111111111111111", t22.mint, "Missing1111111111111111111111111111111111111"]);
  assert.equal(both.clean(PUMPE), true, "control: two nodes' clean");
  assert.equal(both.clean("FrozenCoin1111111111111111111111111111111111"), false, "a freeze authority");
  assert.equal(both.clean(t22.mint), false, "a Token-2022 power");
  assert.equal(both.clean("Missing1111111111111111111111111111111111111"), false, "no such mint");
  t += 600_000;
  assert.equal(both.clean(PUMPE), false, "gone stale");
  const one = createSolScreen(fakeRpc({ oneNode: true }).rpc);
  await one([PUMPE]);
  assert.equal(one.clean(PUMPE), false, "one node's word");
  const failed = createSolScreen(fakeRpc({ fail: true }).rpc);
  await failed([PUMPE]);
  assert.equal(failed.clean(PUMPE), false, "no node answered");
});
