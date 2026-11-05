// A site's two-factor secret stays in the vault; only the site's own https origin gets a code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryVault } from "./vault.ts";
import { SiteTwoFactor, siteOfOrigin } from "./site-2fa.ts";

const LINK = "otpauth://totp/GMGN:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GMGN";
const PUMP = "otpauth://totp/pump.fun:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=pump.fun";

test("only a site's own https origin is that site", () => {
  assert.equal(siteOfOrigin("https://gmgn.ai"), "gmgn");
  assert.equal(siteOfOrigin("https://www.gmgn.ai"), "gmgn");
  assert.equal(siteOfOrigin("https://pump.fun"), "pump.fun");
  assert.equal(siteOfOrigin("https://www.pump.fun"), "pump.fun");
  for (const bad of ["https://evil.pump.fun", "https://login.gmgn.ai", "https://a.www.gmgn.ai", "http://gmgn.ai", "https://gmgn.ai.evil.com", "https://evilgmgn.ai", "https://gmgn.ai:8443", "https://user@gmgn.ai", "https://pump.fun.example", "javascript:alert(1)", "gmgn.ai", ""]) {
    assert.equal(siteOfOrigin(bad), null, bad);
  }
});

test("a kept secret never comes back out; a code comes only for the site's own origin", async () => {
  const vault = new MemoryVault();
  const tf = new SiteTwoFactor(vault, () => 59_000);
  const view = await tf.add("gmgn", LINK);
  assert.deepEqual(Object.keys(view).sort(), ["account", "addedAt", "issuer", "site"]);
  assert.ok(!JSON.stringify(await tf.list()).includes("GEZDGNBV"), "no listing carries the secret");
  assert.deepEqual(await tf.codeFor("https://gmgn.ai"), { site: "gmgn", code: "287082", secondsLeft: 1 });
  assert.equal(await tf.codeFor("https://gmgn.ai.evil.com"), null, "a look-alike gets nothing");
  assert.equal(await tf.codeFor("https://pump.fun"), null, "another site with nothing kept gets nothing");
});

test("a link whose issuer isn't the site is refused unless the person confirmed it; the account part is never read", async () => {
  const tf = new SiteTwoFactor(new MemoryVault(), () => 59_000);
  const binance = "otpauth://totp/Binance:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Binance";
  await assert.rejects(tf.add("gmgn", binance), /does not name this site/);
  await assert.rejects(tf.add("pump.fun", LINK), /does not name this site/, "a GMGN code is not pump.fun's");
  const gmgnPumpName = "otpauth://totp/GMGN:pumpking?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GMGN";
  assert.equal((await tf.add("gmgn", gmgnPumpName)).account, "pumpking", "a GMGN account whose name contains pump is GMGN's");
  assert.equal((await tf.add("gmgn", binance, { confirmedMismatch: true })).issuer, "Binance", "the person's confirmed mismatch is kept");
});

test("an unknown site is refused, and removing forgets it", async () => {
  const tf = new SiteTwoFactor(new MemoryVault(), () => 59_000);
  await assert.rejects(tf.add("nowhere", PUMP), /unknown site/);
  await tf.add("pump.fun", PUMP);
  assert.equal((await tf.codeFor("https://pump.fun"))?.code, "287082");
  await tf.remove("pump.fun");
  assert.equal(await tf.codeFor("https://pump.fun"), null);
});
