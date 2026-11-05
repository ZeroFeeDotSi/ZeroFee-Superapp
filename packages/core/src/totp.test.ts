// RFC 4226 Appendix D and RFC 6238 Appendix B test vectors, and the otpauth:// links sites show for two-factor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Decode, hotp, parseOtpAuth, totp } from "./totp.ts";

const ascii = (s: string) => new TextEncoder().encode(s);
const K20 = ascii("12345678901234567890");
const K32 = ascii("12345678901234567890123456789012");
const K64 = ascii("1234567890123456789012345678901234567890123456789012345678901234");

test("RFC 4226 Appendix D: HOTP for counters 0-9", () => {
  const want = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  want.forEach((code, c) => assert.equal(hotp(K20, c), code));
});

test("RFC 6238 Appendix B: TOTP, 8 digits, SHA1/SHA256/SHA512 at every listed time", () => {
  const rows: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [t, s1, s256, s512] of rows) {
    assert.equal(totp({ secret: K20, algorithm: "SHA1", digits: 8, period: 30 }, t * 1000).code, s1, `SHA1 @${t}`);
    assert.equal(totp({ secret: K32, algorithm: "SHA256", digits: 8, period: 30 }, t * 1000).code, s256, `SHA256 @${t}`);
    assert.equal(totp({ secret: K64, algorithm: "SHA512", digits: 8, period: 30 }, t * 1000).code, s512, `SHA512 @${t}`);
  }
});

test("seconds left in the code's window", () => {
  assert.equal(totp({ secret: K20, algorithm: "SHA1", digits: 6, period: 30 }, 59_000).secondsLeft, 1);
  assert.equal(totp({ secret: K20, algorithm: "SHA1", digits: 6, period: 30 }, 60_000).secondsLeft, 30);
});

test("base32 as authenticator links write it: case, spaces and padding ignored; other letters refused", () => {
  assert.deepEqual(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), K20);
  assert.deepEqual(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq===="), K20);
  assert.throws(() => base32Decode("GEZDGNBV1"), /not base32/);
  assert.throws(() => base32Decode(""), /empty/);
});

test("a site's otpauth link is read; the label's issuer and the issuer field agree", () => {
  const e = parseOtpAuth("otpauth://totp/GMGN:alice%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GMGN");
  assert.equal(e.issuer, "GMGN");
  assert.equal(e.account, "alice@example.com");
  assert.equal(e.digits, 6);
  assert.equal(e.period, 30);
  assert.equal(e.algorithm, "SHA1");
  assert.deepEqual(e.secret, K20);
  assert.equal(totp(e, 59_000).code, "287082");
});

test("links an authenticator must not take are refused", () => {
  assert.throws(() => parseOtpAuth("otpauth://hotp/X?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&counter=1"), /TOTP/);
  assert.throws(() => parseOtpAuth("https://gmgn.ai/?secret=GEZDGNBVGY3TQOJQ"), /TOTP/);
  assert.throws(() => parseOtpAuth("otpauth://totp/X?secret=GEZDGNBV"), /too short/);
  assert.throws(() => parseOtpAuth("otpauth://totp/X?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=MD5"), /algorithm/);
  assert.throws(() => parseOtpAuth("otpauth://totp/X?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=4"), /digits/);
  assert.throws(() => parseOtpAuth("otpauth://totp/X?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&period=1"), /period/);
  assert.throws(() => parseOtpAuth("not a link"), /not a link/);
});
