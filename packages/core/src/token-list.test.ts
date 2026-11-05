// D145 (speed): 1Click's token list is read once per 20 s and once at a time, for a move's SOL/BNB/ETH price as for a swap's sheet
// (oneClickNativeUsd asked it afresh on every move: ~600 ms on the way to each top-up, take-out and Perps put-in sheet).
// A stand-in list only: no network. The clock is passed in, never read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOKEN_LIST_KEPT_MS, oneClickTokens } from "./demo-core.ts";

test("the list is asked once while kept, again after 20 s; reads at the same time share one ask; a failed read is never kept", async () => {
  let asks = 0;
  const list = [{ assetId: "nep141:sol.omft.near", price: 150, priceUpdatedAt: "2026-11-03T00:00:00Z" }];
  const get = async () => (asks++, list);
  const t0 = 1_000_000_000_000;
  const [a, b] = await Promise.all([oneClickTokens(t0, get), oneClickTokens(t0 + 1, get)]);
  assert.equal(asks, 1, "two reads at once: one ask");
  assert.equal(a, b);
  await oneClickTokens(t0 + TOKEN_LIST_KEPT_MS, get);
  assert.equal(asks, 1, "kept for 20 s");
  await oneClickTokens(t0 + TOKEN_LIST_KEPT_MS + 1, get);
  assert.equal(asks, 2, "control: asked again after 20 s");
  // a failed read: the next read asks again at once, never answers with the failure
  const t1 = t0 + 10 * TOKEN_LIST_KEPT_MS;
  await assert.rejects(oneClickTokens(t1, async () => { asks++; throw new Error("1Click down"); }));
  assert.deepEqual(await oneClickTokens(t1 + 1, get), list);
  assert.equal(asks, 4);
});

test("a move's native price and a coin's price read the same kept list (no fetch of their own)", () => {
  const src = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  const body = (name: string) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf("\n}\n", src.indexOf(`async function ${name}(`)));
  for (const f of ["oneClickNativeUsd", "oneClickTokenPrice"]) {
    assert.match(body(f), /oneClickTokens\(\)/, f);
    assert.doesNotMatch(body(f), /fetch\(/, `${f} never fetches the list itself`);
  }
  // NEAR's price is read afresh as before (its own one-minute snapshot, H1; a protection's limits, NF-09)
  assert.match(src, /async function oneClickNativeUsd\(chain: "sol" \| "bsc" \| "hood" \| "near", kept = chain !== "near"\)/);
});
