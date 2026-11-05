// QA's condition on 079591dd (4 Nov): a head the relay gives (its upstream is FastNEAR) counts only with a second
// operator that is neither FastNEAR nor the relay. With every other operator down, the head fails closed ("NEAR is busy"),
// never agreed by the relay alone. A guard on what chain.ts already does (askTwo's second slot: dRPC or standInsOf, never
// FastNEAR; commonBlockNow's check skips both heads' own nodes). The clock never moves here.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NODES, NodePace, RpcChain, proxySafe, standInsOf } from "./chain.ts";
import { setNearProxy } from "./near-proxy.ts";

const SAFE = "zf-0000000a04.near";
const BLOCK = { hash: "11111111111111111111111111111111", height: 10 };
const view = { amount: "3000000000000000000000000", storage_usage: 182, code_hash: "11111111111111111111111111111111" };
const answer = (v: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: v }), { status: 200 });

async function withoutTheClock<T>(p: Promise<T>): Promise<T | "waited on the clock"> {
  const stuck = new Promise<"waited on the clock">((r) => {
    let turns = 0;
    const turn = () => (++turns > 400 ? r("waited on the clock") : setImmediate(turn));
    setImmediate(turn);
  });
  return Promise.race([p, stuck]);
}

test("no FastNEAR host ever stands in for the second operator", () => {
  assert.ok(!NODES.mainnet[1]!.includes("fastnear") && standInsOf(NODES.mainnet).every((u) => !u.includes("fastnear")));
});

test("the relay never confirms its own head: with every other operator down, the head fails closed", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    mock.timers.reset();
    setNearProxy(null);
    proxySafe(null);
  });
  setNearProxy("https://relay.example/v0/near");
  proxySafe(SAFE);
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const host = new URL(url).host;
    asked.push(`${host} ${JSON.parse(init.body).method}`);
    if (host !== "relay.example") throw new TypeError("Failed to fetch");
    return JSON.parse(init.body).method === "block" ? answer({ header: BLOCK }) : answer(view);
  }) as unknown as typeof fetch;
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  await c.account(SAFE, BLOCK).catch(() => undefined); // the Safe is being read through the relay
  const got = await withoutTheClock(c.commonBlock().then(() => "agreed", (e) => e?.problem?.code));
  assert.equal(got, "security.nodes.unreachable");
  assert.ok(asked.includes("relay.example block"), "the relay was asked in FastNEAR's slot, and still not enough alone");
});
