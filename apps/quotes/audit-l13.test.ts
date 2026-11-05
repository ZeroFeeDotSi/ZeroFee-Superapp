// Audit D148 L13 (3 Nov): a market read with no Origin (a script) could reach CoinGecko on every new address and spend
// the app's whole day. Now such reads reach the source only within their own share of the day (a tenth); answers already
// kept serve them as they serve the app, and the app's own origin is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_ORIGINS, createRelay } from "./relay.mjs";

function market(dailyCalls: number, now: () => number) {
  const sent: string[] = [];
  const fetchFn = async (url: string) => { sent.push(url); return new Response(JSON.stringify({ data: [] }), { status: 200 }); };
  const relay = createRelay({ key: "partner-key", secret: "relay-tag-secret", origins: [...APP_ORIGINS], market: { gt: { key: "gt-key" }, cg: { key: "cg-key" }, dailyCalls }, fetchFn, now });
  const get = (path: string, origin: string | undefined, ip: string) => {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    return relay(new Request(`https://quotes.example${path}`, { method: "GET", headers }), ip);
  };
  return { sent, get };
}
const path = (i: number) => `/v0/market/gt/networks/solana/tokens/${"So1".padEnd(43, String(i % 10))}/info`;

test("no-Origin market misses stop at a tenth of the day; the app's own origin still reaches the source (control); a kept answer serves a no-Origin read without spending", async () => {
  let t = 0;
  const { sent, get } = market(30, () => t);
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) { statuses.push((await get(path(i), undefined, `198.51.100.${i}`)).status); t += 61_000; }
  assert.deepEqual(statuses, [200, 200, 200, 503, 503, 503], "the fourth no-Origin miss is refused (a tenth of 30)");
  assert.equal(sent.length, 3);
  assert.equal((await get(path(7), "zerofee-app://app", "198.51.100.40")).status, 200, "control: the app's own read still reaches the source");
  assert.equal(sent.length, 4);
  assert.equal((await get(path(7), undefined, "198.51.100.41")).status, 200, "the app's answer, still kept, serves a no-Origin read without spending");
  assert.equal(sent.length, 4);
});
