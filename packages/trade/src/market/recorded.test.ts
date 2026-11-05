// ?demo's market: the recorded answers through the real market code, never the network, at any pace.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "./index.ts";
import { createRecordedFetch } from "./recorded.ts";
import { RECORDED } from "./recorded-data.ts";
import { createSwitchMarket } from "./switch.ts";
import type { ChainId } from "../types.ts";
import type { Range } from "./types.ts";

const T = Date.parse("2026-10-26T00:00:00Z");
const recorded = () => {
  const seen: string[] = [];
  const f = createRecordedFetch(RECORDED, () => T);
  const fetch = (async (u: RequestInfo | URL, i?: RequestInit) => { seen.push(String(u)); return f(u, i); }) as typeof globalThis.fetch;
  return { seen, m: createMarket({ fetch, now: () => T, storage: null, budget: { calls: 1e9, perMs: 60_000 }, burst: { calls: 1e9, perMs: 10_000 }, screenWaitMs: 0 }) };
};

describe("?demo's recorded market", () => {
  it("every chain's list, every coin page on it, its chart in every range: all answered, nothing refused for budget", async () => {
    const { m, seen } = recorded();
    for (const chain of ["sol", "hood", "bsc"] as ChainId[]) {
      const rows = await m.trending(chain);
      assert.ok(rows.length >= 8, `${chain}: ${rows.length} rows`);
      for (const row of rows.slice(0, 4)) {
        const d = await m.coin(chain, row.address);
        assert.ok(d.priceUsd && d.priceUsd > 0, `${chain} ${row.symbol}: a price`);
        for (const r of ["1H", "1D", "1W", "1M", "1Y", "ALL"] as Range[]) {
          const c = await m.candles(chain, row.address, r);
          assert.ok(c.length > 0, `${chain} ${row.symbol} ${r}: candles`);
          assert.ok(c.every((x, i) => x.c > 0 && x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && (i === 0 || x.t > c[i - 1]!.t)));
        }
        const last = (await m.candles(chain, row.address, "1D")).at(-1)!;
        assert.ok(Math.abs(last.c - d.priceUsd!) / d.priceUsd! < 1e-9, "the chart ends at the coin's own price");
      }
    }
    assert.ok((await m.trending()).length > 10, "All");
    assert.ok(seen.length > 0 && seen.every((u) => /geckoterminal\.com|coingecko\.com/.test(u)), "only the two hosts' URLs, answered from the recordings");
  });
  it("New works in the Sim on every chain (crawl, 5 Nov: it only said \"GeckoTerminal isn't answering\"): newest first, each coin's page and chart answer", async () => {
    const { m } = recorded();
    for (const chain of ["sol", "hood", "bsc", "near"] as ChainId[]) {
      const rows = await m.fresh!(chain);
      assert.ok(rows.length >= 3, `${chain}: ${rows.length} new rows`);
      assert.ok(rows.every((r, i) => r.chain === chain && r.createdAt! > 0 && (i === 0 || r.createdAt! <= rows[i - 1]!.createdAt!)), `${chain}: its own coins, newest first`);
      for (const row of rows.slice(0, 5)) {
        const d = await m.coin(chain, row.address);
        assert.ok(d.priceUsd && d.priceUsd > 0, `${chain} ${row.symbol}: a price`);
        assert.ok((await m.candles(chain, row.address, "1D")).length > 0, `${chain} ${row.symbol}: a chart`);
      }
      assert.equal(new Set(rows.map((r) => r.address)).size, rows.length, `${chain}: each coin once`);
    }
    // Solana's is its own recording (25 Oct)
    assert.equal(new Date((await m.fresh!("sol"))[0]!.createdAt!).toISOString().slice(0, 13), "2026-10-25T07");
  });
  it("control: a network with no pools recorded answers 404, never another network's coins", async () => {
    const f = createRecordedFetch(RECORDED, () => T);
    assert.equal((await f("https://api.geckoterminal.com/api/v2/networks/eth/new_pools")).status, 404);
    const sol = await (await f("https://api.geckoterminal.com/api/v2/networks/solana/new_pools")).json() as { data: { id: string }[] };
    assert.ok(sol.data.length > 0 && sol.data.every((p) => p.id.startsWith("solana_")));
  });
  it("the same coin and range draw the same sample chart every time", async () => {
    const a = await recorded().m.candles("sol", (await recorded().m.trending("sol"))[0]!.address, "1D");
    const b = await recorded().m.candles("sol", (await recorded().m.trending("sol"))[0]!.address, "1D");
    assert.deepEqual(a, b);
  });
  it("a recorded coin keeps its recorded stats (holders, top 10, score); search finds within the recordings; native prices are CoinGecko's recording", async () => {
    const { m } = recorded();
    const d = await m.coin("sol", "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump");
    assert.ok(d.holders && d.holders > 0 && d.top10Pct !== undefined);
    const found = await m.search("dope");
    assert.ok(found.some((r) => r.symbol === "DOPE"));
    assert.equal(await m.nativeUsd("sol"), 101.67);
    for (const c of ["sol", "bsc", "hood"] as ChainId[]) assert.ok((await m.checkedUsd(c)) > 0, `${c}: a session's caps can be set in the recorded prices`);
    await assert.rejects(m.coin("sol", "So11111111111111111111111111111111111111112x".slice(0, 44)));
  });
});

describe("the market switch", () => {
  it("waits for the pick, then sends everything to the market picked; a live price asked before the pick still arrives", async () => {
    let pick!: (m: ReturnType<typeof createMarket>) => void;
    const sw = createSwitchMarket(new Promise((r) => { pick = r; }));
    const prices: number[] = [];
    const off = sw.livePrice("sol", "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump", (p) => prices.push(p));
    const rows = sw.trending("sol");
    const { m } = recorded();
    pick(m);
    assert.ok((await rows).length > 0);
    assert.equal(typeof off, "function");
    off();
  });
});

describe("?demo's Latest trades", () => it("come from the coin's pool's sample trades, newest first, around its price, the same each time", async () => {
  const { m } = recorded();
  const [row] = await m.trending("sol");
  await m.coin("sol", row!.address);
  const t = await m.trades!("sol", row!.address);
  assert.ok(t.length >= 10, `${t.length}`);
  assert.ok(t.every((x, i) => i === 0 || x.t <= t[i - 1]!.t), "newest first");
  assert.ok(t.every((x) => Math.abs(x.priceUsd / row!.priceUsd! - 1) < 0.02 && x.usd >= 5 && x.usd <= 800));
  assert.deepEqual(JSON.stringify(await m.trades!("sol", row!.address)), JSON.stringify(t), "the same each time (seeded)");
}));

describe("?demo's Whales", () => it("trades of $1,000 and more, asked for by size (the relay's one query), newest first, the same each time", async () => {
  const { m, seen } = recorded();
  const [row] = await m.trending("bsc");
  await m.coin("bsc", row!.address);
  const w = await m.trades!("bsc", row!.address, 1_000);
  assert.ok(w.length >= 3, `${w.length}`);
  assert.ok(w.every((x) => x.usd >= 1_000 && x.usd <= 12_000), JSON.stringify(w.map((x) => x.usd)));
  assert.ok(w.every((x, i) => i === 0 || x.t <= w[i - 1]!.t), "newest first");
  assert.ok(seen.some((u) => /\/trades\?trade_volume_in_usd_greater_than=1000$/.test(u)), "the size goes in the ask");
  assert.deepEqual(JSON.stringify(await m.trades!("bsc", row!.address, 1_000)), JSON.stringify(w));
  const all = await m.trades!("bsc", row!.address);
  assert.ok(all.some((x) => x.usd < 1_000), "the plain list is every size");
}));

describe("a market-data trade as a tick", () => it("GeckoTerminal's / CoinGecko's trade rows: a buy at its price_to, a sell at its price_from; a broken row is dropped", async () => {
  const { tickOfTrade } = await import("./index.ts");
  const buy = { block_timestamp: "2026-10-27T10:25:35Z", kind: "buy", volume_in_usd: "61.2", price_to_in_usd: "0.0028", price_from_in_usd: "190.1", tx_hash: "4vcQ" };
  assert.deepEqual(tickOfTrade(buy), { t: Date.parse("2026-10-27T10:25:35Z"), side: "buy", usd: 61.2, priceUsd: 0.0028, tx: "4vcQ" });
  assert.equal(tickOfTrade({ ...buy, kind: "sell", price_from_in_usd: "0.0029" })?.priceUsd, 0.0029);
  assert.equal(tickOfTrade({ ...buy, kind: "swap" }), undefined);
  assert.equal(tickOfTrade({ ...buy, volume_in_usd: "0" }), undefined);
}));
