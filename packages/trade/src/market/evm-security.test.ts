// The EVM coin checks: the sell check on a scripted chain (a honeypot can't be captured safely, so the verdicts are tested
// on scripted answers, Wallet V1's cases and numbers) and where a sale goes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChainSaid } from "../evm/rpc.ts";
import { evmSecurity, sellCheck, sellTarget } from "./evm-security.ts";

const TOKEN = "0x5dbde81fce337ff4bcaaee4ca3466c00aecae274", POOL = "0xd3cffc6b02a34dfc72f1350339031043a854599f";
const A = "0x" + "a1".repeat(20), B = "0x" + "b2".repeat(20), C = "0x" + "c3".repeat(20), CONTRACT = "0x" + "d4".repeat(20);
const topicOf = (a: string) => "0x" + a.slice(2).padStart(64, "0");
type Calls = { method: string; params: unknown[] }[];
function chain(o: { owner?: string | "reverts" | "node"; sellReverts?: boolean; sellNode?: boolean; balances?: Record<string, bigint>; noLogs?: boolean } = {}) {
  const calls: Calls = [];
  const call = async (_c: string, method: string, params: unknown[]): Promise<any> => {
    calls.push({ method, params });
    if (method === "eth_blockNumber") return "0x7d0";
    // newest last: the router contract, then the pool itself (a sale) are the newest recipients
    if (method === "eth_getLogs") return o.noLogs ? [] : [{ topics: ["0xddf", topicOf(POOL), topicOf(A)] }, { topics: ["0xddf", topicOf(A), topicOf(B)] }, { topics: ["0xddf", topicOf(POOL), topicOf(C)] }, { topics: ["0xddf", topicOf(POOL), topicOf(CONTRACT)] }, { topics: ["0xddf", topicOf(B), topicOf(POOL)] }];
    if (method === "eth_getCode") return params[0] === CONTRACT ? "0x6080" : "0x";
    if (method === "eth_call") {
      const p = params[0] as { from?: string; to: string; data: string };
      if (p.data === "0x8da5cb5b") {
        if (o.owner === "reverts") throw new ChainSaid("execution reverted", 3);
        if (o.owner === "node") throw new Error("fetch failed");
        return topicOf(o.owner ?? "0x" + "0".repeat(40));
      }
      if (p.data.startsWith("0x70a08231")) return "0x" + (o.balances ? o.balances["0x" + p.data.slice(34)] ?? 0n : 5_000_000n).toString(16).padStart(64, "0");
      if (p.data.startsWith("0xa9059cbb")) {
        if (o.sellNode) throw new ChainSaid("rate limited", 429);
        if (o.sellReverts) throw new ChainSaid("execution reverted: trading disabled", 3);
        return "0x" + "1".padStart(64, "0");
      }
    }
    throw new Error("unexpected " + method);
  };
  return { call, calls };
}
const text = (r: { notes: string[] }) => r.notes.join(" ");

describe("EVM coin checks", () => {
  it("recent holders (wallets, not contracts) send a thousandth to the pool: ok, said plainly, never 'safe'", async () => {
    const c = chain();
    const r = await evmSecurity(c.call, "bsc", TOKEN, POOL);
    assert.equal(r.level, "ok");
    assert.match(text(r), /gave up control/);
    assert.match(text(r), /3 of 3 recent holders could sell it \(a high sell tax wouldn't show here\)/);
    assert.doesNotMatch(text(r), /safe/i);
    const sims = c.calls.filter((x) => x.method === "eth_call" && (x.params[0] as { data: string }).data.startsWith("0xa9059cbb"));
    assert.equal(sims.length, 3);
    for (const s of sims) {
      const p = s.params[0] as { from: string; to: string; data: string };
      assert.equal(p.to, TOKEN);
      assert.ok([A, B, C].includes(p.from));
      assert.equal(p.data.slice(34, 74), POOL.slice(2));
      assert.equal(BigInt("0x" + p.data.slice(74)), 5000n);
    }
    assert.ok(c.calls.some((x) => x.method === "eth_getCode" && x.params[0] === CONTRACT), "contracts are skipped as holders");
    assert.ok(!c.calls.some((x) => x.method === "eth_call" && (x.params[0] as { data: string }).data === "0x70a08231" + POOL.slice(2).padStart(64, "0")), "the pool is never taken for a holder");
  });
  it("every holder's transfer to the pool reverts: a warning that names the trap", async () => {
    const r = await evmSecurity(chain({ sellReverts: true }).call, "bsc", TOKEN, POOL);
    assert.equal(r.level, "warn");
    assert.match(text(r), /3 recent holders couldn't sell it\. It's a common trap/);
    assert.equal(r.cantSell, true, "the coin page puts Buy away");
    assert.deepEqual([r.owner, r.sell], ["none", "fails"]);
  });
  it("a node's refusal is no verdict: unknown, never a false ok or a false alarm", async () => {
    const r = await evmSecurity(chain({ sellNode: true }).call, "bsc", TOKEN, POOL);
    assert.equal(r.level, "unknown");
    assert.match(text(r), /Selling it isn't tested: the network wouldn't run the test/);
    assert.equal(r.cantSell, undefined, "a node's refusal never puts Buy away");
    assert.equal(r.sell, "unknown");
  });
  it("no recent transfers, no pool, or no holder with a balance: unknown", async () => {
    assert.equal((await evmSecurity(chain({ noLogs: true }).call, "bsc", TOKEN, POOL)).level, "unknown");
    assert.equal((await evmSecurity(chain().call, "bsc", TOKEN, undefined)).level, "unknown");
    assert.deepEqual(await sellCheck(chain({ balances: {} }).call, "bsc", TOKEN, POOL), { ok: false, why: "no recent holder still holds it" });
  });
  it("an owner still in control is a warning even when the sell passes; no owner() function is fine; an unreadable one is unknown", async () => {
    const live = await evmSecurity(chain({ owner: "0x" + "9".repeat(40) }).call, "bsc", TOKEN, POOL);
    assert.equal(live.level, "warn");
    assert.equal(live.cantSell, undefined, "an owner is a warning, not a refusal");
    assert.deepEqual([live.owner, live.sell], ["held", "passes"]);
    assert.match(text(live), /still has an owner \(0x9999…9999\)/);
    assert.match(text(live), /3 of 3/);
    const none = await evmSecurity(chain({ owner: "reverts" }).call, "bsc", TOKEN, POOL);
    assert.equal(none.level, "ok");
    assert.match(text(none), /No owner/);
    assert.equal((await evmSecurity(chain({ owner: "node" }).call, "bsc", TOKEN, POOL)).level, "unknown");
  });
  it("a sale goes to a v2/v3 pool itself; a singleton pool id to the manager that holds the tokens", () => {
    assert.equal(sellTarget("bsc", POOL, "pancakeswap-v3-bsc"), POOL);
    assert.equal(sellTarget("bsc", "0x" + "ab".repeat(32), "pancakeswap-infinity-clmm"), "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b");
    assert.equal(sellTarget("bsc", "0x" + "ab".repeat(32), "uniswap-v4-bsc"), "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df");
    assert.equal(sellTarget("hood", "0x" + "ab".repeat(32), "pons-v2-dex"), "0x8366a39cc670b4001a1121b8f6a443a643e40951");
    assert.equal(sellTarget("hood", "nope", "x"), undefined);
  });
});
