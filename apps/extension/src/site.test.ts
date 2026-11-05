import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOL_NODES } from "@zerofee/trade/sol/rpc.ts";
import { JUP } from "@zerofee/trade/sol/jupiter.ts";
import { GT_BASE } from "@zerofee/trade/market/gt.ts";
import { CG_PRICE_URL } from "@zerofee/trade/market/price.ts";
import { WS_HOSTS } from "@zerofee/trade/market/ws-hosts.ts";
import { coinFromUrl, MATCHES, siteOf } from "./site.ts";

const MINT = "EHPugw1ghE46BeySAa7cHvoZHwYometbp1aK1Q7jpump";
const POOL = "GS1bQcY4W3ScfJMo5Ch9c1xggBUqNpvjoWY7Yc7pJGdL";
const EVM = "0x55d398326F99059fF775485246999027B3197955";

test("pump.fun: a coin page names the coin itself", () => {
  assert.deepEqual(coinFromUrl(`https://pump.fun/coin/${MINT}`), { site: "pump", chain: "sol", address: MINT, names: "coin" });
  assert.deepEqual(coinFromUrl(`https://pump.fun/coin/${MINT}/?include-nsfw=true#chat`)?.address, MINT);
});

test("pump.fun: pages that aren't one coin give nothing", () => {
  for (const path of ["/", "/board", "/profile/abc", `/coin`, `/coin/${MINT}/trades`, `/coin/${MINT}0OIl`, "/coin/short"]) {
    assert.equal(coinFromUrl(`https://pump.fun${path}`), null, path);
  }
});

test("Axiom: /meme/ may name a pool, so the panel resolves it; the chain comes from ?chain=", () => {
  assert.deepEqual(coinFromUrl(`https://axiom.trade/meme/${POOL}`), { site: "axiom", chain: "sol", address: POOL, names: "pool-or-coin" });
  assert.equal(coinFromUrl(`https://axiom.trade/meme/${POOL}?chain=sol`)?.chain, "sol");
  assert.deepEqual(coinFromUrl(`https://axiom.trade/meme/${EVM}?chain=bnb`), { site: "axiom", chain: "bsc", address: EVM.toLowerCase(), names: "pool-or-coin" });
  assert.equal(coinFromUrl(`https://axiom.trade/meme/${EVM}?chain=base`)?.chain, "base");
  assert.equal(coinFromUrl(`https://axiom.trade/meme/${EVM}?chain=tron`)?.chain, "other");
});

test("Axiom: other pages, and addresses that don't fit the chain, give nothing", () => {
  for (const href of ["https://axiom.trade/", "https://axiom.trade/pulse", "https://axiom.trade/discover", `https://axiom.trade/meme/${EVM}`, `https://axiom.trade/meme/${POOL}?chain=bnb`]) {
    assert.equal(coinFromUrl(href), null, href);
  }
});

// GMGN's token page, as GMGN links it (a real page, from a public listing of GMGN data; gmgn.ai itself turns scripts away)
const GMGN_MINT = "FyrBf5xKg5EwKZ9pHvSpJeLLuCWBicTpm3VvZcsibonk";

test("GMGN: /<chain>/token/<address> names the coin itself, on the chain in the path", () => {
  assert.deepEqual(coinFromUrl(`https://gmgn.ai/sol/token/${GMGN_MINT}`), { site: "gmgn", chain: "sol", address: GMGN_MINT, names: "coin" });
  assert.equal(coinFromUrl(`https://gmgn.ai/sol/token/${GMGN_MINT}?tab=holders#top`)?.address, GMGN_MINT);
  assert.deepEqual(coinFromUrl(`https://gmgn.ai/bsc/token/${EVM}`), { site: "gmgn", chain: "bsc", address: EVM.toLowerCase(), names: "coin" });
  assert.equal(coinFromUrl(`https://gmgn.ai/base/token/${EVM}`)?.chain, "base");
  assert.equal(coinFromUrl(`https://gmgn.ai/eth/token/${EVM}`)?.chain, "other");
  assert.equal(coinFromUrl(`https://gmgn.ai/tron/token/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`)?.chain, "other");
});

test("GMGN: a shared link's invite code before the address is left out", () => {
  assert.equal(coinFromUrl(`https://gmgn.ai/sol/token/AbC12xyZ_${GMGN_MINT}`)?.address, GMGN_MINT);
  assert.equal(coinFromUrl(`https://gmgn.ai/sol/token/AbC12xyZ_notanaddress`), null);
});

test("GMGN: other pages, and addresses that don't fit the chain, give nothing", () => {
  for (const path of ["/", "/trend", "/sol/token", `/sol/address/${GMGN_MINT}`, `/sol/token/${GMGN_MINT}/holders`, `/sol/token/${EVM}`, `/bsc/token/${GMGN_MINT}`, `/sol/token/${GMGN_MINT}0OIl`]) {
    assert.equal(coinFromUrl(`https://gmgn.ai${path}`), null, path);
  }
});

test("only the exact sites, over https", () => {
  for (const href of [`http://pump.fun/coin/${MINT}`, `https://pump.fun.example.com/coin/${MINT}`, `https://evilpump.fun/coin/${MINT}`, `https://www.pump.fun/coin/${MINT}`, `https://pump.fun:8443/coin/${MINT}`, `https://user@pump.fun/coin/${MINT}`, `https://gmgn.ai.example.com/sol/token/${MINT}`, `https://www.gmgn.ai/sol/token/${MINT}`, `http://gmgn.ai/sol/token/${MINT}`, "not a url"]) {
    assert.equal(siteOf(href), null, href);
    assert.equal(coinFromUrl(href), null, href);
  }
});

const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));

test("the manifest asks for storage and the side panel, and the named sites only", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "sidePanel"]);
  assert.deepEqual(manifest.host_permissions, MATCHES);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, MATCHES);
  for (const k of ["optional_permissions", "optional_host_permissions", "externally_connectable", "web_accessible_resources"]) assert.equal(manifest[k], undefined, k);
});

test("extension pages may reach exactly the nodes and market data Trade's engine uses", () => {
  const csp: string = manifest.content_security_policy.extension_pages;
  const directive = (name: string) => csp.split(";").map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1) ?? [];
  assert.deepEqual(directive("script-src"), ["'self'"]);
  const origin = (u: string) => new URL(u).origin;
  const needed = new Set([...[...SOL_NODES, JUP, GT_BASE, CG_PRICE_URL].map(origin), ...WS_HOSTS.sol]);
  assert.deepEqual(new Set(directive("connect-src")), needed);
  assert.ok(!directive("connect-src").some((t) => /^wss?:$/.test(t)), "no bare ws:/wss: token");
});
