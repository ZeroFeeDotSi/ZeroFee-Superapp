// Test, 4 Nov (QA, "Pump", a coin in two pools): the list said −72.3 % and the page −50 %, and the live figures
// flipped between the two pools. ONE pool per coin, its deepest: the list's row, the page, the chart and the live price.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "./index.ts";
import { fx, replay } from "./testing.ts";

const DOPE = "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump";
const DEEP = "6iep3EgqksbZwgzMBCyAJtiVtVYkCgL9BnPBEwLR8AGQ";     // token-sol's deepest pool ($239k, +5.03 %)
const THIN = "FpRcdzEgiHLpo4LPTWDkhq86fCuwoejFXnmoH9cSZZ6Q";     // its second ($184k)

/** The Solana trending answer with DOPE's pool swapped for `pools` (each a copy of its own, at that address and change). */
function trendingWith(pools: { address: string; h24: string; reserve: string }[]): any {
  const j = structuredClone(fx("trending-solana"));
  const dope = j.data[0];
  assert.match(dope.relationships.base_token.data.id, new RegExp(DOPE));
  j.data.splice(0, 1, ...pools.map((p) => {
    const c = structuredClone(dope);
    c.id = `solana_${p.address}`; c.attributes.address = p.address; c.attributes.reserve_in_usd = p.reserve;
    c.attributes.price_change_percentage = { ...c.attributes.price_change_percentage, h24: p.h24 };
    return c;
  }));
  return j;
}
const routes = (trending: () => unknown): [string, unknown][] => [
  ["networks/solana/trending_pools", trending], [`networks/solana/tokens/${DOPE}/info`, fx("info-sol")], [`networks/solana/tokens/${DOPE}?`, fx("token-sol")],
];

test("a coin in two of the list's pools: its row is its deepest pool's, at the place it first came", async () => {
  const r = replay(routes(() => trendingWith([{ address: THIN, h24: "-72.3", reserve: "1000" }, { address: DEEP, h24: "-50", reserve: "239098" }])) as any);
  const rows = await createMarket({ fetch: r.fetch, now: r.now, screenWaitMs: 0 }).trending("sol");
  assert.equal(rows[0]!.address, DOPE);
  assert.equal(rows[0]!.change24hPct, -50);
  assert.equal(rows.filter((x) => x.address === DOPE).length, 1);
});

test("the list ranked it in a thinner pool than its page's: the row says what the page says", async () => {
  const r = replay(routes(() => trendingWith([{ address: THIN, h24: "-72.3", reserve: "184184" }])) as any);
  const m = createMarket({ fetch: r.fetch, now: r.now, screenWaitMs: 0 });
  assert.equal((await m.trending("sol"))[0]!.change24hPct, -72.3);   // control: before the page, the list's own pool
  const d = await m.coin("sol", DOPE);
  assert.equal(d.change24hPct, 5.03);
  r.clock.t += 10 * 60_000;
  const row = (await m.trending("sol")).find((x) => x.address === DOPE)!;
  assert.equal(row.change24hPct, d.change24hPct);
  assert.equal(row.priceUsd, d.priceUsd);
});

test("the live reads stay on the deepest pool when the list names a thinner one again", async () => {
  const asked: string[] = [];
  const solRpc = async (method: string, params: unknown[]): Promise<any> => { asked.push(`${method} ${JSON.stringify(params)}`); throw new Error("offline"); };
  const r = replay(routes(() => trendingWith([{ address: THIN, h24: "-72.3", reserve: "184184" }])) as any);
  const m = createMarket({ fetch: r.fetch, now: r.now, screenWaitMs: 0, solRpc, evmRpc: async () => { throw new Error("offline"); } } as any);
  await m.trending("sol");
  await m.coin("sol", DOPE).catch(() => undefined);
  r.clock.t += 10 * 60_000;
  await m.trending("sol");
  asked.length = 0;
  await m.trades?.("sol", DOPE).catch(() => undefined);
  const pools = asked.filter((x) => x.includes(DEEP) || x.includes(THIN));
  assert.ok(pools.length > 0, `the pool was read: ${asked.join(" | ")}`);
  assert.ok(pools.every((x) => x.includes(DEEP)), pools.join(" | "));
});
