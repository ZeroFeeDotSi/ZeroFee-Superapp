// A site's own wallet (site-wallets.ts, product decision, 2 Nov B15/B24): made from the words at the site's own place, one per site
// and network, and bound by the core to its own site's page: it approves nothing for another site, for Trade, Chat or
// ZeroFee's own screens. Each binding has a control that goes past it, so the test fails if the binding is lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hotPath, hotRoot, hotSecret } from "./hot-keys.ts";
import { SITE_WALLETS } from "./site-wallets.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { evmAddress } from "./evm.ts";
import { solAddress } from "./solana.ts";
import { base64, utf8 } from "./sol/bytes.ts";

async function setup(fill = 3) {
  const root = hotRoot(new Uint8Array(32).fill(fill));
  const vault = new MemoryVault();
  await vault.put("hot-root", root);
  const shown: { title?: string; lines?: string[] }[] = [];
  const w = new SubWallets({ vault, sol: {} as never, evm: {} as never, approve: async (words: unknown) => (shown.push(words as never), false), emit: () => {} });
  return { w, root, vault, shown };
}
const refused = (code: string) => (e: unknown) => (e as { problem?: { code?: string } }).problem?.code === code;
/** The binding's own refusal ("Your pump.fun wallet approves only for pump.fun"), told apart from a later one. */
const bound = (e: unknown) => /approves only for/.test(JSON.stringify((e as { problem?: unknown }).problem ?? ""));

test("a site's wallet has its own place on the key path: kind 4, the site's index; no other wallet shares it", () => {
  assert.equal(hotPath("site", "sol", 0)!.path, "m/44'/501'/64'/0'");
  assert.equal(hotPath("site", "sol", 1)!.path, "m/44'/501'/65'/0'");
  assert.equal(hotPath("site", "base", 1)!.path, "m/44'/60'/67'/0/1");
  const all = [
    ...["sol", "bsc", "hood"].flatMap((c) => [0, 1, 2, 3, 4].map((s) => hotPath("trade", c, s)!.path)),
    hotPath("browser", "sol")!.path, ...["eth", "base", "gnosis", "arb"].map((c) => hotPath("browser", c)!.path), hotPath("pay", "gnosis")!.path,
    ...SITE_WALLETS.flatMap((s) => s.chains.map((c) => hotPath("site", c, s.index)!.path)),
  ];
  assert.equal(new Set(all).size, all.length);
  // indexes are fixed for ever and never shared
  assert.equal(new Set(SITE_WALLETS.map((s) => s.index)).size, SITE_WALLETS.length);
  assert.ok(SITE_WALLETS.every((s) => s.index >= 0 && s.index < 16));
});

test("each site gets its own wallet from the words, one per network; asking again gives the same one", async () => {
  const { w, root } = await setup();
  const pump = await w.create("site", "sol", undefined, "pump");
  assert.equal(pump.address, solAddress(hotSecret(root, "site", "sol", 0)!));
  assert.deepEqual([pump.kind, pump.site, pump.label, pump.inWords], ["site", "pump", "pump.fun wallet", true]);
  assert.equal((await w.create("site", "sol", undefined, "pump")).id, pump.id);
  const gmgn = await w.create("site", "sol", undefined, "gmgn");
  assert.notEqual(gmgn.address, pump.address);
  const chain = await w.create("chain", "sol");
  assert.notEqual(chain.address, pump.address, "never the shared Solana wallet");
  const gmgnBase = await w.create("site", "base", undefined, "gmgn");
  assert.equal(gmgnBase.address, evmAddress(hotSecret(root, "site", "base", 1)!));
  const list = await w.list();
  assert.equal(list.filter((x) => x.kind === "site").length, 3);
  assert.equal(list.find((x) => x.id === pump.id)!.current, undefined, "never current or older: the planner never fills or drains it");
  await assert.rejects(w.create("site", "base", undefined, "pump"), refused("security.request.invalid"), "pump.fun has no Base wallet");
  await assert.rejects(w.create("site", "sol", undefined, "fomo"), refused("security.request.invalid"), "not a site with a wallet");
  await assert.rejects(w.create("site", "sol", 2, "pump"), refused("security.request.invalid"), "no slot");
});

test("no words on this phone: made here, still one per site and network", async () => {
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as never, evm: {} as never, approve: async () => false, emit: () => {} });
  const a = await w.create("site", "sol", undefined, "pump");
  assert.equal(a.inWords, undefined);
  assert.equal((await w.create("site", "sol", undefined, "pump")).id, a.id);
  assert.notEqual((await w.create("site", "sol", undefined, "gmgn")).id, a.id);
});

/** A plain Sign In With Solana for `domain` and `address`, fresh now. */
const siws = (domain: string, address: string) => base64(utf8(`${domain} wants you to sign in with your Solana account:\n${address}\n\nURI: https://${domain}\nVersion: 1\nChain ID: mainnet\nNonce: a1b2c3d4e5f6\nIssued At: ${new Date().toISOString()}`));
/** D143: a refusal past the binding, named, with nothing signed. */
const notSigned = (e: unknown) => !bound(e) && /Nothing was signed\.$/.test(String((e as { problem?: { more?: string } }).problem?.more));

test("the core binds a site's wallet to its own site: another site, or no site at all, is refused before anything is read", async () => {
  const { w, shown } = await setup();
  const pump = await w.create("site", "sol", undefined, "pump");
  const chain = await w.create("chain", "sol");
  // its own site, through Browser: a plain sign-in signs with no sheet (D143)
  assert.equal((await w.signMessage(pump.id, siws("pump.fun", pump.address), { origin: "https://pump.fun" }, "Browser")).signedIn, true);
  // its own site, words that aren't a sign-in: past the binding, refused for what they are
  await assert.rejects(w.signMessage(pump.id, base64(utf8("Sign in to the site")), { origin: "https://pump.fun" }, "Browser"), notSigned);
  // another site: refused by the binding, even with that site's own plain sign-in
  await assert.rejects(w.signMessage(pump.id, siws("gmgn.ai", pump.address), { origin: "https://gmgn.ai" }, "Browser"), bound);
  // audit C1: the shared Solana wallet signs no site's sign-in either; control: GMGN's own wallet signs GMGN's
  await assert.rejects(w.signMessage(chain.id, siws("gmgn.ai", chain.address), { origin: "https://gmgn.ai" }, "Browser"), (e: any) => e.problem.more === "This site can use only its own wallet.");
  const gmgn = await w.create("site", "sol", undefined, "gmgn");
  assert.equal((await w.signMessage(gmgn.id, siws("gmgn.ai", gmgn.address), { origin: "https://gmgn.ai" }, "Browser")).signedIn, true);
  // a transaction with no page (Trade, Chat, ZeroFee's own screens): refused before it is read
  await assert.rejects(w.signTx(pump.id, "AAAA", "a trade", undefined, "Trade", undefined, "trade"), bound);
  await assert.rejects(w.signTx(pump.id, "AAAA", "x", undefined, "Browser", { origin: "https://jup.ag" }, "browser"), bound);
  // control: on its own site the same bytes go past the binding (and are refused later, as bytes that aren't a transaction)
  await assert.rejects(w.signTx(pump.id, "AAAA", "x", undefined, "Browser", { origin: "https://pump.fun" }, "browser"), (e: unknown) => !bound(e));
  assert.equal(shown.length, 0, "no sheet, ever");
});

test("a restore finds a used site wallet; an unused one comes back when it is asked for", async () => {
  const root = hotRoot(new Uint8Array(32).fill(4));
  const vault = new MemoryVault();
  await vault.put("hot-root", root);
  const pumpAddr = solAddress(hotSecret(root, "site", "sol", 0)!);
  const sol = { balance: async (a: string) => (a === pumpAddr ? 5_000_000n : 0n) } as never;
  const evm = { nonce: async () => 0, read: async () => "0x0", tokenBalance: async () => 0n } as never;
  const w = new SubWallets({ vault, sol, evm, approve: async () => false, emit: () => {} });
  const found = await w.rediscover(["trade", "private", "browser", "pay", "site"]);
  assert.deepEqual(found.filter((x) => x.kind === "site").map((x) => `${x.site}/${x.chain}`), ["pump/sol"]);
  assert.equal(found.find((x) => x.kind === "site")!.address, pumpAddr);
  // not asked for (a child's account): none
  const kid = new SubWallets({ vault, sol, evm, approve: async () => false, emit: () => {} });
  assert.equal((await kid.rediscover(["trade"])).filter((x) => x.kind === "site").length, 0);
});

test("AgentZero's pocket (D90): its own place on the key path, from the words; it signs for no web page and no app's plain call", async () => {
  const { isAgentPocket } = await import("./site-wallets.ts");
  assert.equal(hotPath("site", "sol", 7)!.path, "m/44'/501'/71'/0'");
  assert.equal(isAgentPocket("agentzero"), true);
  assert.equal(isAgentPocket("pump"), false);
  const { w, root, shown } = await setup();
  const pocket = await w.create("site", "sol", undefined, "agentzero");
  assert.equal(pocket.label, "AgentZero's pocket");
  assert.equal(pocket.address, solAddress(hotSecret(root, "site", "sol", 7)!), "made from the words, so a restore brings it back");
  const msg = base64(utf8("Sign in"));
  const said = (e: unknown) => /AgentZero's pocket signs only for AgentZero's own trades/.test(JSON.stringify((e as { problem?: unknown }).problem ?? ""));
  for (const origin of ["https://pump.fun", "https://gmgn.ai", "https://zerofee.si"]) {
    await assert.rejects(w.signMessage(pocket.id, msg, { origin }), said, origin);
    // a plain sign-in for that page, through Browser, too
    await assert.rejects(w.signMessage(pocket.id, siws(new URL(origin).host, pocket.address), { origin }, "Browser"), said, `${origin}: a plain sign-in`);
  }
  await assert.rejects(w.signTx(pocket.id, "AAAA", "a trade", undefined, "Trade", undefined, "trade"), said);
  await assert.rejects(w.signTx(pocket.id, "AAAA", "x", undefined, "Browser", { origin: "https://pump.fun" }, "browser"), said);
  // Control: pump.fun's own wallet signs a plain sign-in for its own page, through Browser (D143: no sheet).
  const pump = await w.create("site", "sol", undefined, "pump");
  assert.equal((await w.signMessage(pump.id, siws("pump.fun", pump.address), { origin: "https://pump.fun" }, "Browser")).signedIn, true);
  assert.equal(shown.length, 0, "never reaches a sheet");
});
