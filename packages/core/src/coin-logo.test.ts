// A coin's logo (product decision, 3 Nov: MAMESUKE on Home was a plain "M"): one url per coin, by chain and address only,
// on the relay; the phone keeps the picture (capped, oldest out) so a cold open draws it with no network. No network here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coinLogoUrl, logoAddressOk } from "./coin-logo.ts";
import { createLogoBook, LOGO_BYTES_MAX, LOGO_STORE_KEY, parseLogos, trimLogos, type LogoEntry } from "./coin-logo-book.ts";

const RELAY = "https://quotes.example";
const MAMESUKE = "F9qqSFzRng9Kz6WfkRCr9qAAq9aGZACCS7AcsiLQYdj";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

test("the url names the coin by chain and address only, on the relay; an address the relay would refuse gets none", () => {
  assert.equal(coinLogoUrl(RELAY, "sol", MAMESUKE), `${RELAY}/v0/market/logo?c=sol&a=${MAMESUKE}`);
  assert.equal(coinLogoUrl(`${RELAY}/`, "hood", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), `${RELAY}/v0/market/logo?c=hood&a=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`);
  assert.equal(coinLogoUrl(RELAY, "near", "nep141:token.v2.ref-finance.near"), `${RELAY}/v0/market/logo?c=near&a=token.v2.ref-finance.near`, "a NEAR coin by its contract");
  assert.equal(coinLogoUrl(undefined, "sol", MAMESUKE), undefined, "no relay: no url (the letter)");
  assert.equal(coinLogoUrl(RELAY, "sol", "0OIl" + MAMESUKE.slice(4)), undefined, "not base58");
  assert.equal(coinLogoUrl(RELAY, "eth", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), undefined, "a chain the relay doesn't serve");
  assert.equal(coinLogoUrl(RELAY, "near", "Bad..near"), undefined);
  assert.ok(logoAddressOk("bsc", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed") && !logoAddressOk("bsc", "0x5aAe"), "control");
});

test("kept pictures: newest first, one too big dropped, at most N and a total, the oldest out", () => {
  const e = (k: string, at: number, n: number): LogoEntry => ({ k, at, d: "data:image/png;base64," + "A".repeat(n) });
  const kept = trimLogos([e("a", 1, 10), e("b", 3, 10), e("c", 2, 10), e("big", 4, 500)], { per: 100, keep: 2, total: 1000 });
  assert.deepEqual(kept.map((x) => x.k), ["b", "c"], "too big out; then the two newest; the oldest (a) out");
  assert.deepEqual(trimLogos([e("a", 1, 60), e("b", 2, 60)], { per: 200, keep: 9, total: 150 }).map((x) => x.k), ["b"], "the total holds");
  assert.deepEqual(parseLogos(JSON.stringify([e("a", 1, 4), { k: "x", at: 1, d: "data:image/svg+xml;base64,AAAA" }, { k: "y", at: 1, d: "javascript:1" }])).map((x) => x.k), ["a"], "only png/jpeg/webp/gif data urls are read back");
  assert.deepEqual(parseLogos("not json"), []);
});

function fakeBridge(start: Record<string, string> = {}) {
  const store = { ...start };
  const sets: [string, string | null][] = [];
  return {
    store, sets,
    call: async <T,>(m: string, p?: Record<string, unknown>) => {
      if (m === "device.store.get") return { ok: { value: store[String(p?.key)] ?? null } as T };
      if (m === "device.store.set") { sets.push([String(p?.key), p?.value as string | null]); if (p?.value === null) delete store[String(p?.key)]; else store[String(p?.key)] = String(p?.value); return { ok: { ok: true } as T }; }
      return { problem: { code: "x" } } as never;
    },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

test("the book: the relay's url first; once fetched the kept picture (sealed slot), asked of the relay by mint only and once", async () => {
  const b = fakeBridge();
  const asked: string[] = [];
  const f = (async (u: string) => { asked.push(String(u)); return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } }); }) as typeof fetch;
  const book = createLogoBook(b, { relay: RELAY, fetch: f, now: () => 1000 });
  await book.ready;
  assert.equal(book.src("sol", MAMESUKE), `${RELAY}/v0/market/logo?c=sol&a=${MAMESUKE}`, "before: the relay's url (the letter only while it loads)");
  let told = 0;
  book.subscribe(() => told++);
  book.want([{ chain: "sol", address: MAMESUKE }, { chain: "sol", address: MAMESUKE }]);
  await flush();
  assert.match(book.src("sol", MAMESUKE)!, /^data:image\/jpeg;base64,/, "after: the picture itself, no network on the next draw");
  assert.equal(told, 1);
  assert.deepEqual(asked, [`${RELAY}/v0/market/logo?c=sol&a=${MAMESUKE}`], "asked once, of the relay, naming the coin only");
  assert.equal(b.sets.at(-1)![0], LOGO_STORE_KEY);
  // a cold open: the kept copy, no fetch at all
  const again: string[] = [];
  const cold = createLogoBook(fakeBridge(b.store), { relay: RELAY, fetch: (async (u: string) => { again.push(u); return new Response(null, { status: 500 }); }) as typeof fetch });
  await cold.ready;
  cold.want([{ chain: "sol", address: MAMESUKE }]);
  await flush();
  assert.match(cold.src("sol", MAMESUKE)!, /^data:image\/jpeg;base64,/);
  assert.deepEqual(again, [], "a kept picture is never asked for again");
});

test("the book: a miss or a refusal keeps the relay url and isn't asked again for a while; a picture too big isn't kept", async () => {
  let t = 0;
  const asked: string[] = [];
  const f = (async (u: string) => { asked.push(u); return u.includes(MAMESUKE) ? new Response("{}", { status: 404, headers: { "content-type": "application/json" } }) : new Response(new Uint8Array(LOGO_BYTES_MAX), { status: 200, headers: { "content-type": "image/png" } }); }) as typeof fetch;
  const b = fakeBridge();
  const book = createLogoBook(b, { relay: RELAY, fetch: f, now: () => t });
  const BIG = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  book.want([{ chain: "sol", address: MAMESUKE }, { chain: "bsc", address: BIG }]);
  await flush();
  assert.equal(book.src("sol", MAMESUKE), `${RELAY}/v0/market/logo?c=sol&a=${MAMESUKE}`);
  assert.equal(book.src("bsc", BIG), `${RELAY}/v0/market/logo?c=bsc&a=${BIG}`, "too big to keep: still drawn from the relay");
  assert.equal(b.sets.length, 0, "nothing kept, nothing written");
  t += 60_000;
  book.want([{ chain: "sol", address: MAMESUKE }]);
  await flush();
  assert.equal(asked.length, 2, "not asked again within ten minutes");
  t += 10 * 60_000;
  book.want([{ chain: "sol", address: MAMESUKE }]);
  await flush();
  assert.equal(asked.length, 3, "control: asked again after");
  // no relay: nothing asked, no url
  const none = createLogoBook(fakeBridge(), { fetch: (async () => { throw new Error("no"); }) as typeof fetch });
  none.want([{ chain: "sol", address: MAMESUKE }]);
  await flush();
  assert.equal(none.src("sol", MAMESUKE), undefined);
});
