import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, presetForHost } from "./presets.ts";
import { lookAlike, siteRules, siteUrl } from "./sites.ts";

const RECIPES = [
  { name: "Gnosis Pay", hosts: ["app.gnosispay.com"], wallet: { kind: "pay", chains: ["gnosis"] } },
  { name: "Mt Pelerin", hosts: ["app.mtpelerin.com"], wallet: { kind: "browser", chains: ["base"] } },
];

test("presets and Browser-wallet recipes are known on their exact hosts; the card's recipe is never this engine's", () => {
  const rule = siteRules({ recipes: RECIPES });
  // pump.fun has its own wallet (core site-wallets.ts) on Solana
  // and its own site sees that wallet with no connect sheet (Social trading, 2 Nov: it opens signed in)
  assert.deepEqual(rule("pump.fun"), { host: "pump.fun", name: "pump.fun", chains: ["sol"], known: true, wallet: "pump", ownChains: ["sol"], preapproved: true });
  // ST6: GMGN's EVM side is hidden: its own wallet answers on Solana only (the hub fills and empties Solana's)
  assert.deepEqual(rule("gmgn.ai"), { host: "gmgn.ai", name: "GMGN", chains: ["sol"], known: true, wallet: "gmgn", ownChains: ["sol"], preapproved: true });
  assert.deepEqual(rule("APP.MTPELERIN.COM"), { host: "app.mtpelerin.com", name: "Mt Pelerin", chains: ["base"], known: true });
  assert.equal(rule("app.gnosispay.com")?.known, false, "Gnosis Pay's window is Pay's engine; here it is just a typed site");
  assert.equal(rule("www.pump.fun")?.known, false, "no wildcards");
  assert.equal(rule("pump.fun.evil.example")?.known, false);
});

test("a typed site gets the Browser wallet's chains, unknown and never pre-approved; a child's phone gets none", () => {
  const rule = siteRules({});
  const typed = rule("some-dex.example");
  assert.equal(typed?.known, false);
  assert.equal(typed?.preapproved, undefined);
  assert.deepEqual(typed?.chains, ["eth", "base", "arb", "gnosis", "sol"]);
  assert.equal(siteRules({ child: true })("pump.fun"), null);
});

test("presets: exact https hosts, the url on one of them, and fomo opens in its own app (no desktop page)", () => {
  for (const p of PRESETS) {
    const u = new URL(p.url);
    assert.equal(u.protocol, "https:", p.id);
    assert.ok(p.hosts.includes(u.host), `${p.id} opens on its own host`);
    for (const h of p.hosts) assert.match(h, /^[a-z0-9.-]+$/, `${p.id}: exact host, no wildcard or path`);
    assert.ok(p.chains.length > 0);
  }
  assert.equal(presetForHost("fomo.family")?.ownApp, true);
  assert.ok(PRESETS.every((p) => !p.desktop), "no preset asks for the computer page shrunk onto a phone");
  assert.deepEqual(PRESETS.filter((p) => p.ownApp).map((p) => p.hosts), [["fomo.family"]], "only fomo: the host opens fomo.family's app alone");
});

test("what a typed address opens: https only, a real host, no user@", () => {
  assert.deepEqual(siteUrl("pump.fun"), { url: "https://pump.fun/" });
  assert.deepEqual(siteUrl(" https://app.mtpelerin.com/x?y=1 "), { url: "https://app.mtpelerin.com/x?y=1" });
  assert.deepEqual(siteUrl("http://example.com"), { problem: "insecure", host: "example.com" });
  assert.deepEqual(siteUrl("https://me@example.com"), { problem: "invalid" });
  assert.deepEqual(siteUrl("javascript:alert(1)"), { problem: "invalid" });
  assert.deepEqual(siteUrl("pump fun"), { problem: "invalid" });
  assert.deepEqual(siteUrl("localhost"), { problem: "invalid" });
  assert.deepEqual(siteUrl(""), { problem: "invalid" });
});

test("look-alike hosts are spotted by their punycode labels", () => {
  assert.equal(lookAlike("xn--pmp-fun-xyz.com"), true);
  assert.equal(lookAlike("pump.fun"), false);
});
