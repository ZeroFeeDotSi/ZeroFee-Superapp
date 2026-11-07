// ?demo's sample coins nobody can sell back: found by their address, their page opens from the recordings, and Trade's
// own checks (run against the sample chain) say no holder could sell, so the coin page shows no Buy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "./index.ts";
import { createRecordedFetch } from "./recorded.ts";
import { RECORDED } from "./recorded-data.ts";
import { HONEYPOT_LOGO, SAMPLE_UNSELLABLE, sampleChecks, withSamples } from "./demo-samples.ts";
import { pageRefusal } from "../app/coin-refusal.ts";

const T = Date.parse("2026-10-26T00:00:00Z");
const market = () => createMarket({ fetch: createRecordedFetch(withSamples(RECORDED), () => T) as typeof fetch, now: () => T, storage: null, budget: { calls: 1e9, perMs: 60_000 }, burst: { calls: 1e9, perMs: 10_000 }, screenWaitMs: 0 });

for (const s of Object.values(SAMPLE_UNSELLABLE)) {
  test(`${s.chain}: the sample coin is found by its address, its page has a price, and its checks put Buy away`, async () => {
    const m = market();
    const rows = await m.search(s.address);
    assert.ok(rows.some((r) => r.chain === s.chain && r.address.toLowerCase() === s.address), JSON.stringify(rows.map((r) => [r.chain, r.symbol])));
    const d = await m.coin(s.chain, s.address);
    assert.equal(d.symbol, "NOSELL");
    // QA 16 (7 Nov): the list row's line is the coin's name like every other row's; "Not for sale" (where Buy was) is the
    // one place that says what it is, so the name never says it again ("Honeypot coin" did)
    assert.equal(d.name, "Lucky Frog");
    assert.doesNotMatch(d.name, /honey|pot|sale|sell|trap|stuck|scam/i);
    // every coin has a logo: this one is bundled, so no host the CSP refuses, with the relay on or off
    assert.equal(d.logoUrl, HONEYPOT_LOGO);
    const viaRelay = createMarket({ fetch: createRecordedFetch(withSamples(RECORDED), () => T) as typeof fetch, logoRelay: "https://quotes-seven-gamma.vercel.app", now: () => T, storage: null, budget: { calls: 1e9, perMs: 60_000 }, burst: { calls: 1e9, perMs: 10_000 }, screenWaitMs: 0 });
    assert.equal((await viaRelay.coin(s.chain, s.address)).logoUrl, HONEYPOT_LOGO);
    assert.ok((d.priceUsd ?? 0) > 0);
    const c = await sampleChecks(s.chain, s.address);
    assert.equal(c?.cantSell, true);
    assert.equal(c?.level, "warn");
    assert.ok(c?.notes.some((n) => /3 recent holders couldn't sell it/.test(n)), JSON.stringify(c?.notes));
    assert.equal(pageRefusal(s.chain, { checks: c }), "unsellable");
  });
}

test("every other ?demo coin has no checks (as before), and the recordings keep every coin they had", async () => {
  assert.equal(await sampleChecks("bsc", "0x91152b4ef635403efbae860edd0f8c321d7c035d"), undefined);
  assert.equal(await sampleChecks("sol", SAMPLE_UNSELLABLE.bsc.address), undefined);
  const withThem = withSamples(RECORDED);
  for (const k of Object.keys(RECORDED.coins)) assert.ok(k in withThem.coins, k);
  assert.equal(Object.keys(withThem.coins).length, Object.keys(RECORDED.coins).length + 2);
});

test("?demo's swaps as they land: one every 2 to 6 s around the coin's price, each its own transaction, whales among them; stop is final", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sampleLiveTrades } = await import("./demo-samples.ts");
  let i = 0; const seq = [0.1, 0.9, 0.5, 0.3, 0.05, 0.7, 0.2];          // the second swap a whale (0.05 < 1/6)
  const live = sampleLiveTrades(async () => 0.01, { random: () => seq[i++ % seq.length]!, now: () => 1_000 });
  const got: { usd: number; tx: string; priceUsd: number }[] = [];
  const stop = live("bsc", SAMPLE_UNSELLABLE.bsc.address, (x) => got.push(x));
  const flush = async () => { for (let k = 0; k < 5; k++) await Promise.resolve(); };
  for (let k = 0; k < 4; k++) { t.mock.timers.tick(6_000); await flush(); }
  assert.ok(got.length >= 3, `${got.length}`);
  assert.equal(new Set(got.map((x) => x.tx)).size, got.length);
  assert.ok(got.every((x) => Math.abs(x.priceUsd / 0.01 - 1) < 0.01));
  assert.ok(got.some((x) => x.usd >= 1_000), JSON.stringify(got.map((x) => x.usd)));
  stop();
  const n = got.length;
  t.mock.timers.tick(30_000); await flush();
  assert.equal(got.length, n, "nothing after stop");
});

test("?demo's Solana swaps go through B: marked unconfirmed first, then confirmed or dropped, each once; BNB's come confirmed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sampleLiveTrades, SAMPLE_CONFIRM_MS } = await import("./demo-samples.ts");
  let i = 0; const seq = [0.1, 0.9, 0.5, 0.3, 0.05, 0.7, 0.2, 0.01];
  const live = sampleLiveTrades(async () => 1, { random: () => seq[i++ % seq.length]!, now: () => 1_000 });
  const seen: string[] = [], dropped: string[] = [];
  const stop = live("sol", "So1anaSampleMint11111111111111111111111111", (x) => seen.push(`${x.tx}${x.unconfirmed ? "?" : ""}`), (tx) => dropped.push(tx));
  const flush = async () => { for (let k = 0; k < 5; k++) await Promise.resolve(); };
  for (let k = 0; k < 12; k++) { t.mock.timers.tick(1_000); await flush(); }
  stop();
  const first = seen.filter((x) => x.endsWith("?")).map((x) => x.slice(0, -1));
  assert.ok(first.length >= 2, seen.join(" "));
  for (const tx of first) {
    const solid = seen.filter((x) => x === tx).length, gone = dropped.filter((x) => x === tx).length;
    assert.ok(solid + gone <= 1, `${tx}: confirmed or dropped, once`);
    assert.ok(seen.indexOf(`${tx}?`) < (seen.indexOf(tx) === -1 ? Infinity : seen.indexOf(tx)), "marked before solid");
  }
  assert.ok(SAMPLE_CONFIRM_MS < 8_000, "inside the journey's window");
  const bsc: boolean[] = [];
  const stop2 = sampleLiveTrades(async () => 1, { random: () => 0.5 })("bsc", SAMPLE_UNSELLABLE.bsc.address, (x) => bsc.push(!!x.unconfirmed));
  for (let k = 0; k < 8; k++) { t.mock.timers.tick(1_000); await flush(); }
  stop2();
  assert.ok(bsc.length >= 1 && bsc.every((u) => !u));
});
