// QA crawl (web, 4 Nov): Trending died on a market 429 with "GeckoTerminal isn't answering" and no way on. Now
// a failed list read is asked again by itself, sooner first; the device's kept rows stay on screen meanwhile (a chain's
// Hot list it never kept paints that chain's rows of the All list); and the line has Try again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keptList, listRetryMs } from "./reads.ts";
import type { CoinRow } from "../market/types.ts";
import type { ListKind, Paint } from "../market/paint.ts";

const row = (chain: CoinRow["chain"], address: string): CoinRow => ({ chain, address, symbol: address, name: address, logoUrl: `https://x/${address}.png` });

test("a failed read is asked again sooner first: 2 s, 4 s, 8 s, 16 s, then every 30 s (control: no failure asks at once only from 2 s)", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 40].map(listRetryMs), [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  assert.equal(listRetryMs(0), 2_000, "control: never under the first wait");
});

test("a chain's Hot list never kept paints that chain's rows of the kept All list; its own kept list wins (control: none kept, nothing painted)", () => {
  const kept = new Map<string, { v: CoinRow[]; at: number }>([[JSON.stringify({ kind: "trending", chain: "all" }), { v: [row("sol", "a"), row("bsc", "b"), row("sol", "c")], at: 5 }]]);
  const paint: Pick<Paint, "list"> = { list: (k: ListKind) => kept.get(JSON.stringify(k)) };
  assert.deepEqual(keptList(paint, { kind: "trending", chain: "sol" })?.v.map((r) => r.address), ["a", "c"]);
  assert.equal(keptList(paint, { kind: "trending", chain: "sol" })?.at, 5, "with the All list's age");
  assert.equal(keptList(paint, { kind: "trending", chain: "hood" }), undefined, "no rows of that chain: nothing (the skeleton)");
  assert.equal(keptList(paint, { kind: "new", chain: "sol" }), undefined, "New is its own list");
  kept.set(JSON.stringify({ kind: "trending", chain: "sol" }), { v: [row("sol", "own")], at: 9 });
  assert.deepEqual(keptList(paint, { kind: "trending", chain: "sol" })?.v.map((r) => r.address), ["own"]);
  assert.equal(keptList({ list: () => undefined }, { kind: "trending", chain: "sol" }), undefined, "control");
});

test("the list's hook retries on its own with that backoff, keeps its rows, and Discover's line has Try again; Home's Trending retries too", () => {
  const rt = readFileSync(new URL("./runtime.tsx", import.meta.url), "utf8");
  assert.match(rt, /setTimeout\(\(\) => setN\(\(x\) => x \+ 1\), listRetryMs\(fails\)\)/);
  assert.match(rt, /failed: s\.rows === null, loading: false, fails: \(s\.fails \?\? 0\) \+ 1/, "a failure keeps the rows shown");
  assert.match(rt, /const p = k \? keptList\(paint, k\) : undefined;/);
  const dc = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");
  assert.match(dc, /GeckoTerminal isn't answering\. Trying again\."[^\n]*<button type="button" className="zf-link" onClick=\{list\.retry\} data-testid="list-retry">Try again<\/button>/);
  assert.doesNotMatch(dc, /RETRY_MS/, "one retry, the hook's (never a second fixed 15 s timer)");
  const home = readFileSync(new URL("./screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /setTimeout\(\(\) => trending\.reload\(\), listRetryMs\(\+\+trendFails\.current\)\)/);
});
