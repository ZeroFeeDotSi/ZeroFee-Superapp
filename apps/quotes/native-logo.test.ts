// GET /v0/market/logo?cg=<n>/<size>/<file> (Trade's native coins, 5 Nov): a NEAR Intents coin's logo is CoinGecko's own
// image, asked by its path alone on a fixed host. Controls: the old ?c=&a= route still answers as before, and anything that
// isn't such a path (another host, "..", an extra name, svg) is refused before any fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS
import { APP_ORIGINS, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { cgImageOk } from "./logo.mjs";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const png = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
const none = () => new Response("", { status: 404 });
function relayWith(answer: (url: string) => Response) {
  const sent: string[] = [];
  const relay = createRelay({ key: "k-1234567890", secret: "s", origins: [...APP_ORIGINS], market: {}, fetchFn: async (url: string) => { sent.push(url); return answer(url); } });
  const get = (path: string, origin?: string) => relay(new Request(`https://quotes.example${path}`, { headers: origin ? { origin } : {} }), "203.0.113.7");
  return { sent, get };
}

test("cg logo: CoinGecko's image by its path, its small twin first; a week at the edge; sandboxed", async () => {
  const { sent, get } = relayWith((url) => (url === "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png" ? png() : none()));
  const r = await get("/v0/market/logo?cg=1/large/bitcoin.png", "zerofee-app://app");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("cache-control"), "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
  assert.equal(r.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...PNG]);
  assert.deepEqual(sent, ["https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png"]);
  // as Vercel rewrites it
  assert.equal((await get("/api/relay?route=market&src=logo&mpath=&cg=1/large/bitcoin.png")).status, 200);
});

test("cg logo: no image is a 404 kept ten minutes; svg bytes are never served", async () => {
  const missing = relayWith(none);
  const r = await missing.get("/v0/market/logo?cg=99/large/x.png");
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "public, max-age=600, s-maxage=600");
  const svg = relayWith(() => new Response("<svg/>", { status: 200, headers: { "content-type": "image/png" } }));
  assert.equal((await svg.get("/v0/market/logo?cg=1/small/x.png")).status, 404);
});

test("cg logo: anything but such a path is refused before any fetch", async () => {
  const { sent, get } = relayWith(png);
  for (const q of ["cg=../../x.png", "cg=1/large/../x.png", "cg=1/huge/x.png", "cg=1/large/x.svg", "cg=x/large/a.png", "cg=1/large/a.png&u=https://evil.example/a.png", "cg=1/large/a.png&cg=2/large/b.png", "cg=https://evil.example/1/large/a.png", "cg=1/large/a.png&c=sol"]) {
    assert.equal((await get(`/v0/market/logo?${q}`)).status, 400, q);
  }
  assert.equal(sent.length, 0);
  assert.equal(cgImageOk("1/large/a.png"), true);
  assert.equal(cgImageOk("1/large/a..png"), false);
});

test("control: the address route is unchanged (a bad address is still a 400, a good one asks its sources)", async () => {
  const { sent, get } = relayWith(none);
  assert.equal((await get("/v0/market/logo?c=bsc&a=0x12")).status, 400);
  assert.equal(sent.length, 0);
  assert.equal((await get("/v0/market/logo?c=near&a=wrap.near")).status, 404);
  assert.ok(sent.length > 0, "the NEAR coin's sources were asked");
});
