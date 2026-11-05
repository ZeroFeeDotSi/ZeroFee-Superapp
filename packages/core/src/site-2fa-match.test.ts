// The code ZeroFee makes for pump.fun and GMGN is the one the site checks: computed here a second way, with node's own
// HMAC (as a site's server does, RFC 6238 with the link's settings), at many moments, and given only to the site's own
// https page. The secret never comes back out of the core: no answer and no vault read outside it holds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { SiteTwoFactor } from "./site-2fa.ts";
import { MemoryVault } from "./vault.ts";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32 = (b: Uint8Array) => {
  let bits = 0, v = 0, out = "";
  for (const x of b) {
    v = (v << 8) | x;
    bits += 8;
    while (bits >= 5) out += B32[(v >>> (bits -= 5)) & 31];
  }
  return bits ? out + B32[(v << (5 - bits)) & 31] : out;
};
/** A site's own check, written apart from totp.ts: RFC 6238 over node:crypto. */
const siteCode = (secret: Buffer, atMs: number, digits = 6, period = 30, alg = "sha1") => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / period)));
  const mac = createHmac(alg, secret).update(msg).digest();
  const o = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
};

for (const [site, origin, issuer, extra, digits, period, alg] of [
  ["pump.fun", "https://pump.fun", "pump.fun", "", 6, 30, "sha1"],
  ["gmgn", "https://gmgn.ai", "GMGN", "", 6, 30, "sha1"],
  ["gmgn", "https://www.gmgn.ai", "GMGN.AI", "&digits=8&period=60&algorithm=SHA256", 8, 60, "sha256"],
] as const) {
  test(`${site}: the code matches the site's own check at every moment, for ${origin} only`, async () => {
    const secret = randomBytes(20);
    let now = Date.UTC(2026, 10, 5, 7, 0, 0);
    const vault = new MemoryVault();
    const codes = new SiteTwoFactor(vault, () => now);
    const view = await codes.add(site, `otpauth://totp/${encodeURIComponent(issuer)}:me@example.com?secret=${base32(secret)}&issuer=${encodeURIComponent(issuer)}${extra}`);
    assert.ok(!JSON.stringify(view).includes(secret.toString("hex")) && !JSON.stringify(view).includes(base32(secret)), "the view never holds the secret");
    for (let i = 0; i < 40; i++) {
      now += 7_919 * (i + 1);
      const got = await codes.codeFor(origin);
      assert.equal(got?.code, siteCode(secret, now, digits, period, alg), `at ${new Date(now).toISOString()}`);
      assert.ok(got!.secondsLeft >= 1 && got!.secondsLeft <= period);
      assert.ok(!JSON.stringify(got).includes(secret.toString("hex")), "an answer never holds the secret");
    }
    for (const look of [origin.replace("https:", "http:"), `${origin}:8443`, origin.replace("://", "://evil."), `${origin}.evil.example`, "https://pumpfun.example", "https://gmgn.ai.evil.example"]) {
      assert.equal(await codes.codeFor(look), null, `${look} got a code`);
    }
  });
}

test("a code from the wrong site's link is refused unless the person confirmed it; removed means no code", async () => {
  const codes = new SiteTwoFactor(new MemoryVault());
  const link = `otpauth://totp/Binance:me?secret=${base32(randomBytes(20))}&issuer=Binance`;
  await assert.rejects(codes.add("pump.fun", link), /issuer/);
  assert.equal(await codes.codeFor("https://pump.fun"), null);
  await codes.add("pump.fun", `otpauth://totp/pump.fun:me?secret=${base32(randomBytes(20))}&issuer=pump.fun`);
  assert.notEqual(await codes.codeFor("https://pump.fun"), null);
  await codes.remove("pump.fun");
  assert.equal(await codes.codeFor("https://pump.fun"), null);
});
