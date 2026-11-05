// a real-money run (3 Nov): the core's buy sheet said "Buy an unnamed coin with 0.0107 SOL". The core now
// names the coin from its own read of the mint (Token-2022's metadata, else Metaplex's), kept for the session, display
// only, and only on the sheet's path; never from the caller's word. And Trade's door before the tap (subwallet.cap.check).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import { fromBase58 } from "./sol/bytes.ts";
import { metaplexSymbol, token2022Symbol } from "./sol/coin-meta.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { POCKET_COIN, buy, pocketNode, sell } from "./testing/pocket-tx.ts";

const SITE = { origin: "https://app.example.com" };
const str = (s: string, pad = 0) => {
  const b = new TextEncoder().encode(s.padEnd(pad, "\u0000"));
  return [b.length & 0xff, (b.length >> 8) & 0xff, 0, 0, ...b];
};

test("a coin's symbol is read from the chain's own bytes: Metaplex's metadata account and Token-2022's metadata extension; anything that isn't plain is never said (controls)", () => {
  const key = new Array(32).fill(7);
  const metaplex = (symbol: string, k = 4) => Uint8Array.from([k, ...key, ...key, ...str("Pepe the coin", 32), ...str(symbol, 10), ...str("https://x", 200)]);
  assert.equal(metaplexSymbol(metaplex("PEPE")), "PEPE", "padded with NULs, trimmed");
  assert.equal(metaplexSymbol(metaplex("PEPE", 1)), null, "control: not a metadata account");
  assert.equal(metaplexSymbol(metaplex("PE PE")), null, "a space isn't a plain symbol");
  assert.equal(metaplexSymbol(metaplex("‮PEPE")), null, "a direction mark is never said");
  assert.equal(metaplexSymbol(metaplex("ABCDEFGHIJKLM")), null, "past 12 characters");
  const ext = (type: number, symbol: string) => {
    const v = [...key, ...key, ...str("Pump coin"), ...str(symbol), ...str("https://y")];
    return Uint8Array.from([...new Array(165).fill(0), 1, 3, 0, 2, 0, 0, 0, type, 0, v.length & 0xff, v.length >> 8, ...v]);
  };
  assert.equal(token2022Symbol(ext(19, "BONK2")), "BONK2", "after another extension, the metadata one");
  assert.equal(token2022Symbol(ext(18, "BONK2")), null, "control: no metadata extension");
  assert.equal(token2022Symbol(Uint8Array.from(new Array(82).fill(0))), null, "control: a mint with no extensions");
});

async function core(reads: { symbol: string | null; decimals: number | null }) {
  const shown: PlainWords[] = [];
  let asked = 0;
  const sol = { ...pocketNode(), executable: async (keys: string[]) => keys.map(() => false), mintSymbol: async () => (asked++, reads.symbol), mintDecimals: async () => reads.decimals } as SolChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (shown.push(words), false), emit: () => {} });
  return { w, shown, asked: () => asked };
}

test("the buy sheet names the coin by its own symbol as the core read it, kept for the session; never the caller's word (controls: no read, or a symbol copying a listed coin, stays unnamed)", async () => {
  const named = await core({ symbol: "PEPE", decimals: 6 });
  const own = await named.w.siteFor(SITE, "sol");
  for (let i = 0; i < 2; i++) assert.deepEqual(await named.w.signTx(own.id, buy(own.address, 10), "", "", undefined, SITE, "browser", "USDC"), { declined: true });
  assert.match(named.shown[0]!.title, /PEPE/, named.shown[0]!.title);
  assert.ok(!/unnamed coin/.test(named.shown[0]!.title));
  assert.ok(!JSON.stringify(named.shown[0]).includes("USDC"), "the caller's own word for the coin is never said");
  assert.equal(named.asked(), 1, "read once, then kept");
  // controls: nothing read, or a symbol that copies a listed coin's, is said as a coin ZeroFee can't name
  for (const reads of [{ symbol: null, decimals: 6 }, { symbol: "USDC", decimals: 6 }, { symbol: "PEPE", decimals: null }]) {
    const c = await core(reads);
    const w = await c.w.siteFor(SITE, "sol");
    await c.w.signTx(w.id, buy(w.address, 10), "", undefined, undefined, SITE, "browser");
    assert.match(c.shown[0]!.title, /unnamed coin/, JSON.stringify(reads));
  }
  assert.ok(fromBase58(POCKET_COIN).length === 32);
});

test("Trade's door before the tap (subwallet.cap.check): asks over $100 a tap or past what is left of the day's $500; read only, nothing counted (controls: inside both it doesn't ask; no figure asks)", async () => {
  const c = await core({ symbol: null, decimals: null });
  assert.deepEqual(await c.w.capCheck(40), { asks: false, leftTodayUsd: 500, perTapUsd: 100 });
  assert.deepEqual(await c.w.capCheck(40), { asks: false, leftTodayUsd: 500, perTapUsd: 100 }, "read only: asking counted nothing");
  assert.equal((await c.w.capCheck(150)).asks, true, "over $100 a tap");
  assert.equal((await c.w.capCheck("x")).asks, true, "no figure");
  // five no-sheet trades of $95 leave $25 of the day
  const t = await c.w.create("trade", "sol");
  for (let i = 0; i < 5; i++) assert.ok("signedTx" in (await c.w.signTx(t.id, buy(t.address, 95), "", undefined, "Trade", undefined, "trade")));
  const left = await c.w.capCheck(20);
  assert.equal(left.asks, false);
  assert.ok(left.leftTodayUsd > 20 && left.leftTodayUsd < 30, String(left.leftTodayUsd));
  assert.equal((await c.w.capCheck(30)).asks, true, "past what is left today");
});

test("a preflighted tap that must ask names the coin (phone test, 3 Nov: a sale's sheet said \"an unnamed coin\" for ANSEM): the preflight asks the name and never waits on it (control: the same tap with no name read says unnamed)", async () => {
  for (const name of ["ANSEM", null]) {
    const shown: PlainWords[] = [];
    const node = pocketNode();
    let named = 0;
    // one server's test run of a coin with no market price: a sale then asks ("Only one server could test it"; a priced
    // coin's sale one server checked is silent, the test, 4 Nov)
    const sol = { ...node, executable: async (keys: string[]) => keys.map(() => false), mintSymbol: async () => (named++, name), mintDecimals: async () => 6,
      simulate: async (tx: string, wallet: string, watch?: string[]) => ({ ...(await node.simulate(tx, wallet, watch)), agreed: false, servers: 1 }) } as SolChain;
    const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), marketPrice: async () => null, approve: async (words) => (shown.push(words), false), emit: () => {} });
    const t = await w.create("trade", "sol");
    const tx = sell(t.address, POCKET_COIN, 20);
    assert.deepEqual(await w.preflight(t.id, tx, "trade"), { ok: true });
    await new Promise((r) => setImmediate(r));
    const before = named;
    await w.signTx(t.id, tx, "", undefined, "Trade", undefined, "trade").catch(() => undefined);
    assert.equal(named, before, "the tap read no name itself");
    assert.equal(shown.length, 1, "the one-tap sheet asked");
    assert.match(shown[0]!.title, name ? /ANSEM/ : /unnamed coin/, shown[0]!.title);
  }
});

test("the names the preflight asks are display only: whatever a name read says (a name, a copy of USDC, nothing, or never an answer), a checked sale signs silently the same, and neither the preflight nor the tap waits on it", async () => {
  const hung = new Promise<string | null>(() => {});
  for (const read of [async () => "ANSEM", async () => "USDC", async () => null, () => hung, async () => { throw new Error("no node"); }]) {
    const shown: PlainWords[] = [];
    const sol = { ...pocketNode(), executable: async (keys: string[]) => keys.map(() => false), mintSymbol: read, mintDecimals: async () => 6 } as SolChain;
    const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), marketPrice: async () => 20, approve: async (words) => (shown.push(words), false), emit: () => {} });
    const t = await w.create("trade", "sol");
    const tx = sell(t.address, POCKET_COIN, 20);
    assert.deepEqual(await w.preflight(t.id, tx, "trade"), { ok: true }, "the preflight answers without the name");
    const r = await w.signTx(t.id, tx, "", undefined, "Trade", undefined, "trade");
    assert.ok("signedTx" in r, "signed silently");
    assert.equal(shown.length, 0, "no sheet");
  }
});
