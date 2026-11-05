import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { PlainWords } from "./signer.ts";
import { fromBase58 } from "./sol/bytes.ts";
import { decodeTx } from "./sol/wire.ts";
import { solAddress } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { buy, pocketNode } from "./testing/pocket-tx.ts";
import { HOT_ROOT, hotPath, hotRoot, hotSecret } from "./hot-keys.ts";
import { hostIndex, siteWallet } from "./site-hosts.ts";

// Audit C1 (3 Nov): every connected site gets its own wallet, never a shared chain wallet.

const ROOT = hotRoot(new Uint8Array(32).fill(7));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const evmAddress = (secret: Uint8Array) => `0x${hex(keccak_256(secp256k1.getPublicKey(secret, false).slice(1)).slice(-20))}`;
const SITE = { origin: "https://app.example.com" };

async function core() {
  const shown: PlainWords[] = [];
  let answer = true;
  const vault = new MemoryVault();
  await vault.put(HOT_ROOT, ROOT.slice());
  const sol = { ...pocketNode(), executable: async (keys: string[]) => keys.map(() => false) };
  const w = new SubWallets({ vault, sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (shown.push(words), answer), emit: () => {} });
  return { w, shown, say: (yes: boolean) => (answer = yes) };
}

test("audit C1: each connected host gets its own wallet from the words, made on first connect and the same one after; a listed site gets its fixed one (controls: another host, another chain, a page that isn't plain https)", async () => {
  const { w } = await core();
  const a = await w.siteFor(SITE, "sol");
  assert.equal(a.kind, "site");
  assert.equal(a.site, "host:app.example.com");
  assert.equal(a.label, "app.example.com wallet");
  const at = hostIndex("app.example.com");
  assert.equal(hotPath("host", "sol", at)!.path, `m/44'/501'/1000'/${at}'`);
  assert.equal(a.address, solAddress(hotSecret(ROOT, "host", "sol", at)!), "from the words, at the host's own place");
  assert.equal((await w.siteFor(SITE, "sol")).id, a.id, "the same wallet on the next connect");
  assert.equal((await w.list()).filter((x) => x.kind === "site").length, 1, "made once");
  // control: another host is another wallet, and another chain is another key
  assert.notEqual((await w.siteFor({ origin: "https://other.example.com" }, "sol")).address, a.address);
  assert.equal(hotPath("host", "base", at)!.path, `m/44'/60'/1003'/0/${at}`);
  assert.equal(hotPath("host", "bsc", at)!.path, `m/44'/60'/1000'/0/${at}`, "BNB Chain too");
  assert.equal(hotPath("host", "near", at), null, "never NEAR");
  assert.equal((await w.siteFor(SITE, "base")).address, evmAddress(hotSecret(ROOT, "host", "base", at)!));
  // never a shared chain wallet
  assert.notEqual(a.address, (await w.create("chain", "sol")).address);
  // a listed site's own: pump.fun's page gets the pump.fun wallet
  const pump = await w.siteFor({ origin: "https://pump.fun" }, "sol");
  assert.equal(pump.site, "pump");
  assert.equal(pump.id, (await w.create("site", "sol", undefined, "pump")).id);
  // no page, or one that isn't plain https, is refused; so is a chain a site wallet isn't on
  for (const bad of [undefined, { origin: "http://app.example.com" }, { origin: "https://app.example.com/path" }, "https://app.example.com"]) {
    await assert.rejects(w.siteFor(bad, "sol"), (x: any) => x.problem?.code === "security.request.invalid", JSON.stringify(bad));
  }
  await assert.rejects(w.siteFor(SITE, "near"), (x: any) => x.problem?.code === "security.request.invalid");
  assert.equal(siteWallet("host:app.example.com")?.host, true);
  assert.equal(siteWallet("host:not a host"), undefined);
});

test("audit C1: a site's request on a shared chain wallet is refused by name; an unlisted host's own wallet asks on its own page, one tap (never Face ID), and is refused on any other (controls: the person's own flow on the chain wallet, and a listed site's own wallet on its own page, sign with no sheet)", async () => {
  const { w, shown, say } = await core();
  const chain = await w.create("chain", "sol");
  await assert.rejects(w.signTx(chain.id, buy(chain.address, 10), "", undefined, undefined, SITE, "browser"), (x: any) => x.problem?.code === "security.subwallet.refused" && x.problem.more === "This site can use only its own wallet.");
  assert.equal(shown.length, 0, "refused, never asked");
  // control: the same trade from the person's own flow (no site) signs with no sheet
  assert.ok("signedTx" in (await w.signTx(chain.id, buy(chain.address, 10), "", undefined, undefined, undefined, "browser")));
  assert.equal(shown.length, 0);
  // an unlisted host's own wallet: asked, the host named; a no signs nothing
  const own = await w.siteFor(SITE, "sol");
  say(false);
  assert.deepEqual(await w.signTx(own.id, buy(own.address, 10), "", undefined, undefined, SITE, "browser"), { declined: true });
  assert.equal(shown.at(-1)!.warnings[0]?.text, "app.example.com isn't a site ZeroFee knows, so ZeroFee asks you.");
  assert.equal(shown.at(-1)!.tap, true, "one tap, never Face ID");
  say(true);
  const out = await w.signTx(own.id, buy(own.address, 10), "", undefined, undefined, SITE, "browser");
  assert.ok("signedTx" in out);
  const signed = decodeTx(out.signedTx);
  assert.ok(ed25519.verify(signed.signatures[0]!, signed.message, fromBase58(own.address)));
  assert.equal(shown.length, 2);
  // on another host's page, or with no page, it is refused
  await assert.rejects(w.signTx(own.id, buy(own.address, 10), "", undefined, undefined, { origin: "https://evil.example.com" }, "browser"), (x: any) => x.problem?.code === "security.subwallet.refused");
  await assert.rejects(w.signTx(own.id, buy(own.address, 10), "", undefined, undefined, undefined, "browser"), (x: any) => x.problem?.code === "security.subwallet.refused");
  assert.equal(shown.length, 2);
  // control: pump.fun's own wallet on pump.fun signs its checked buy with no sheet
  const pump = await w.siteFor({ origin: "https://pump.fun" }, "sol");
  assert.ok("signedTx" in (await w.signTx(pump.id, buy(pump.address, 10), "", undefined, undefined, { origin: "https://pump.fun" }, "browser")));
  assert.equal(shown.length, 2, "no sheet for a listed site's own wallet");
});

// Audit pass 2, item 1: an unlisted host's place is 31 bits of sha256(host), so a page can search for a host whose place
// is a popular site's. The lookup then matched the address alone and handed that site's wallet to the page.
test("audit pass 2: a host whose key lands on another site's wallet never gets that wallet", async () => {
  const { w } = await core();
  const mine = await w.siteFor({ origin: "https://attacker.example" }, "sol");
  // as if a popular site's wallet held this same address (a found collision): rename the stored record's site
  const vault = (w as unknown as { o: { vault: MemoryVault } }).o.vault;
  const list = JSON.parse(new TextDecoder().decode((await vault.get("subwallets"))!)) as { site: string; id: string }[];
  list.find((x) => x.id === mine.id)!.site = "host:popular.example";
  await vault.put("subwallets", new TextEncoder().encode(JSON.stringify(list)));
  await assert.rejects(w.siteFor({ origin: "https://attacker.example" }, "sol"), (x: any) => x.problem?.code === "security.request.invalid");
  // control: another host still gets its own wallet, never the renamed record
  assert.notEqual((await w.siteFor({ origin: "https://other.example" }, "sol")).address, mine.address);
});
