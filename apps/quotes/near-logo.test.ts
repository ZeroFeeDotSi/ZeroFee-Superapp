// A NEAR coin's logo from its own contract (re-check, 5 Nov: NEAR's New list showed one coin, WBTC, because the launchpad
// coins have no GeckoTerminal image and a list row without a logo is not shown). The relay's GET /v0/market/logo?c=near
// reads the contract's ft_metadata icon (a base64 webp/png/jpeg/gif, bytes checked) on FastNEAR, with the paid key when it
// has one. Controls: an svg icon, a lying type, no icon and a node error are each none, then GeckoTerminal's image is asked.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS
import { APP_ORIGINS, createRelay } from "./relay.mjs";
// @ts-ignore: plain JS
import { nearIconImage, resolveLogo } from "./logo.mjs";

// a real launchpad icon's first bytes (ams.v2-launchpad.justhoot.near answered "data:image/webp;base64,UklGR..." on 5 Nov)
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const icon = (type: string, b: Buffer) => `data:image/${type};base64,${b.toString("base64")}`;
const viewAnswer = (meta: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { result: [...Buffer.from(JSON.stringify(meta))], logs: [], block_height: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
const AMS = "ams.v2-launchpad.justhoot.near";

test("an icon is an image only when its bytes say so: webp, png yes; svg, a lying type, junk, nothing: none", () => {
  assert.deepEqual(nearIconImage(icon("webp", WEBP))?.type, "image/webp");
  assert.deepEqual(nearIconImage(icon("png", PNG))?.type, "image/png");
  assert.equal(nearIconImage(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`), undefined, "control: never an svg");
  assert.equal(nearIconImage(`data:image/svg+xml;utf8,<svg onload=alert(1)/>`), undefined);
  assert.equal(nearIconImage(icon("png", Buffer.from("<html>hi</html>"))), undefined, "control: the bytes must be an image");
  assert.equal(nearIconImage("https://example.com/a.png"), undefined, "never a url to fetch");
  assert.equal(nearIconImage(null), undefined);
  assert.equal(nearIconImage("data:image/png;base64," + "A".repeat(700_000)), undefined, "never past 400 KB");
});

test("resolveLogo near: the contract's icon on FastNEAR with the key, as a view (ft_metadata), before GeckoTerminal", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit) => { sent.push({ url, init }); return url.includes("fastnear") ? viewAnswer({ symbol: "AMS", icon: icon("webp", WEBP) }) : new Response("", { status: 404 }); };
  const r = await resolveLogo("near", AMS, f, { root: "https://gt.example", headers: {} }, { rpc: "https://rpc.mainnet.fastnear.com", headers: { authorization: "Bearer k" } });
  assert.equal(r.status, 200);
  assert.equal(r.type, "image/webp");
  assert.deepEqual([...r.body], [...WEBP]);
  const rpc = sent.find((s) => s.url.includes("fastnear"))!;
  const body = JSON.parse(String(rpc.init.body));
  assert.deepEqual([body.method, body.params.request_type, body.params.account_id, body.params.method_name], ["query", "call_function", AMS, "ft_metadata"]);
  assert.equal((rpc.init.headers as Record<string, string>).authorization, "Bearer k");
  assert.ok(!sent.some((s) => s.url.includes("gt.example")), "GeckoTerminal not asked when the contract had one");
});

test("control: an svg icon, no icon, or a node error falls to GeckoTerminal's image; all none is a 404", async () => {
  for (const ans of [() => viewAnswer({ icon: "data:image/svg+xml;base64,PHN2Zy8+" }), () => viewAnswer({ icon: null }), () => new Response("", { status: 500 })]) {
    const sent: string[] = [];
    const f = async (url: string) => { sent.push(url); return url.includes("fastnear") ? ans() : new Response("", { status: 404 }); };
    const r = await resolveLogo("near", AMS, f, { root: "https://gt.example", headers: {} });
    assert.equal(r.status, 404);
    assert.ok(sent.some((u) => u.startsWith("https://gt.example/networks/near/tokens/")), "GeckoTerminal asked next");
  }
});

test("the route: GET /v0/market/logo?c=near&a=<coin> answers the contract's icon as image/webp, sandboxed", async () => {
  const sent: string[] = [];
  const relay = createRelay({ key: "k-1234567890", secret: "s", origins: [...APP_ORIGINS], market: {}, fetchFn: async (url: string) => { sent.push(url); return url.includes("fastnear") ? viewAnswer({ icon: icon("webp", WEBP) }) : new Response("", { status: 404 }); } });
  const res = await relay(new Request(`https://quotes.example/v0/market/logo?c=near&a=${AMS}`), "203.0.113.7");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.match(res.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.ok(sent.some((u) => u.includes("fastnear")));
});
