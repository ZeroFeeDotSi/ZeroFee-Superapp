// Phone test, 5 Nov ("GeckoTerminal is busy since …"), rule 9: market data asks the paid door (the relay, the
// GeckoTerminal key) first, the public API behind it, and serves the last answer quietly with its time when both fail.
// Each door is killed mid-list here, with a control. No clock waits: the clock is a number the test moves.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGt } from "./gt.ts";
import { createRelayFetch } from "./relay.ts";
import { GT_BASE } from "./gt.ts";

const R = "https://quotes.example";
const LIST = "networks/solana/trending_pools?page=1";
const ok = (from: string) => new Response(JSON.stringify({ data: [], from }), { status: 200, headers: { "content-type": "application/json" } });
const status = (n: number) => new Response(JSON.stringify({ code: "x" }), { status: n, headers: { "content-type": "application/json" } });
const corsBlocked = () => { throw new TypeError("Failed to fetch"); };
const aborted = () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); };

type Door = () => Response | Promise<Response>;
function doors(o: { relay: Door; pub: Door }, storage: Map<string, string> | null = null, t = { now: 1_000_000 }) {
  const asked: string[] = [];
  const f = (async (u: RequestInfo | URL) => { const s = String(u); asked.push(s.startsWith(R) ? "relay" : "public"); return s.startsWith(R) ? o.relay() : o.pub(); }) as typeof fetch;
  const store = storage ? { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } : null;
  const gt = createGt({ fetch: createRelayFetch(R, f), now: () => t.now, storage: store, budget: { calls: 120, perMs: 60_000 }, burst: { calls: 30, perMs: 10_000 } });
  return { gt, asked, t };
}
const from = async (p: Promise<unknown>) => ((await p) as { from: string }).from;

describe("market doors (rule 9: paid first, a second door, the kept answer with its time)", () => {
  it("the paid door answers: the public one is never asked (control for every case below)", async () => {
    const d = doors({ relay: () => ok("relay"), pub: () => ok("public") });
    assert.equal(await from(d.gt.get(LIST, 30_000)), "relay");
    assert.deepEqual(d.asked, ["relay"]);
  });
  it("dead paid door mid-list: the public door answers the same call, nothing shown", async () => {
    const o = { relay: (() => ok("relay")) as Door, pub: () => ok("public") };
    const d = doors(o);
    await d.gt.get(LIST, 30_000);
    o.relay = corsBlocked; d.t.now += 31_000;
    assert.equal(await from(d.gt.get(LIST, 30_000)), "public");
  });
  it("our relay's 429 or 503 with the public door CORS-blocked: the kept answer, with its time, and NO pause on the paid door (control: it answers the next call)", async () => {
    for (const n of [429, 503, 502]) {
      const o = { relay: (() => ok("relay")) as Door, pub: corsBlocked as Door };
      const d = doors(o);
      await d.gt.get(LIST, 30_000);
      const at = d.t.now;
      o.relay = () => status(n); d.t.now += 31_000;
      assert.equal(await from(d.gt.get(LIST, 30_000)), "relay", `${n}: the kept answer`);
      assert.equal(d.gt.servedAt(LIST), at, `${n}: served with its own time`);
      o.relay = () => ok("relay-back"); d.t.now += 31_000;
      if (n !== 429) assert.ok(d.gt.room() > 0, `${n}: the paid door isn't paused by the public door's failed fetch`);
      if (n !== 429) assert.equal(await from(d.gt.get(LIST, 30_000)), "relay-back", `${n}: control, the paid door answers at once`);
    }
  });
  it("slow paid door (its time limit): the kept answer at once, never a second wait on the public door", async () => {
    const o = { relay: (() => ok("relay")) as Door, pub: () => ok("public") };
    const d = doors(o);
    await d.gt.get(LIST, 30_000);
    o.relay = aborted; d.t.now += 31_000;
    assert.equal(await from(d.gt.get(LIST, 30_000)), "relay");
    assert.deepEqual(d.asked, ["relay", "relay"], "the public door isn't asked after the time limit");
  });
  it("offline (every door fails): the kept answer with its time; empty (nothing kept) rejects, so the screen says so once (control)", async () => {
    const o = { relay: (() => ok("relay")) as Door, pub: () => ok("public") };
    const d = doors(o);
    await d.gt.get(LIST, 30_000);
    o.relay = corsBlocked; o.pub = corsBlocked; d.t.now += 31_000;
    assert.equal(await from(d.gt.get(LIST, 30_000)), "relay");
    const empty = doors({ relay: corsBlocked, pub: corsBlocked });
    await assert.rejects(empty.gt.get(LIST, 30_000));
  });
  it("reload mid-outage: the answer kept on the device is served after a reload with every door dead (control: no storage, nothing to serve)", async () => {
    const storage = new Map<string, string>();
    const t = { now: 1_000_000 };
    await doors({ relay: () => ok("relay"), pub: () => ok("public") }, storage, t).gt.get(LIST, 30_000);
    t.now += 31_000;
    const after = doors({ relay: corsBlocked, pub: corsBlocked }, storage, t);
    assert.equal(await from(after.gt.get(LIST, 30_000)), "relay");
    assert.equal(after.gt.servedAt(LIST), 1_000_000);
    await assert.rejects(doors({ relay: corsBlocked, pub: corsBlocked }, null, t).gt.get(LIST, 30_000));
  });
  it("the URL asked of the paid door is the public one's path and query, unchanged", async () => {
    const seen: string[] = [];
    const f = (async (u: RequestInfo | URL) => (seen.push(String(u)), ok("relay"))) as typeof fetch;
    await createRelayFetch(R, f)(`${GT_BASE}/${LIST}`);
    assert.deepEqual(seen, [`${R}/v0/market/gt/${LIST}`]);
  });
});
