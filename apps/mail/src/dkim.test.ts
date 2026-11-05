// DKIM on arrival: RFC 8463's own signed mail verifies with both its keys (Ed25519 and RSA), so the canonicalization is
// the RFC's, not only this repo's signer's. Then every way a "privy.io" mail can be forged or bent is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkDkim, type TxtResolver } from "./dkim.ts";
import { dkimSign, testDns, testSigner } from "./testing-dkim.ts";

// RFC 8463, Appendix A (A.2 keys, A.3 signed message).
const RFC_MAIL = [
  "DKIM-Signature: v=1; a=ed25519-sha256; c=relaxed/relaxed;",
  " d=football.example.com; i=@football.example.com;",
  " q=dns/txt; s=brisbane; t=1528637909; h=from : to :",
  " subject : date : message-id : from : subject : date;",
  " bh=2jUSOH9NhtVGCQWNr9BrIAPreKQjO6Sn7XIkfJVOzv8=;",
  " b=/gCrinpcQOoIfuHNQIbq4pgh9kyIK3AQUdt9OdqQehSwhEIug4D11Bus",
  " Fa3bT3FY5OsU7ZbnKELq+eXdp1Q1Dw==",
  "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;",
  " d=football.example.com; i=@football.example.com;",
  " q=dns/txt; s=test; t=1528637909; h=from : to : subject :",
  " date : message-id : from : subject : date;",
  " bh=2jUSOH9NhtVGCQWNr9BrIAPreKQjO6Sn7XIkfJVOzv8=;",
  " b=F45dVWDfMbQDGHJFlXUNB2HKfbCeLRyhDXgFpEL8GwpsRe0IeIixNTe3",
  " DhCVlUrSjV4BwcVcOF6+FF3Zo9Rpo1tFOeS9mPYQTnGdaSGsgeefOsk2Jz",
  " dA+L10TeYt9BgDfQNZtKdN1WO//KgIqXP7OdEFE4LjFYNcUxZQ4FADY+8=",
  "From: Joe SixPack <joe@football.example.com>",
  "To: Suzie Q <suzie@shopping.example.net>",
  "Subject: Is dinner ready?",
  "Date: Fri, 11 Jul 2003 21:00:37 -0700 (PDT)",
  "Message-ID: <20030712040037.46341.5F8J@football.example.com>",
  "",
  "Hi.",
  "",
  "We lost the game.  Are you hungry yet?",
  "",
  "Joe.",
  "",
].join("\r\n");
const RFC_KEYS: Record<string, string> = {
  "brisbane._domainkey.football.example.com": "v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=",
  "test._domainkey.football.example.com":
    "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDkHlOQoBTzWRiGs5V6NpP3idY6Wk08a5qhdR6wy5bdOKb2jLQiY/J16JYi0Qvx/byYzCNb3W91y3FutACDfzwQ/BC/e/8uBsCR+yz1Lxj+PL6lHvqMKrM3rG4hstT5QjvHO9PzoxZyVYLzBfO2EeC3Ip3G+2kryOTIKT+l/K4w3QIDAQAB",
};
const only = (selector: string): TxtResolver => async (n) => {
  if (!n.startsWith(`${selector}.`)) throw Object.assign(new Error("nx"), { code: "ENOTFOUND" });
  return [[RFC_KEYS[n]!]];
};

test("RFC 8463 Appendix A: the Ed25519 and the RSA signature each verify on their own", async () => {
  assert.deepEqual(await checkDkim(RFC_MAIL, { resolveTxt: only("brisbane") }), { ok: true, domain: "football.example.com" });
  assert.deepEqual(await checkDkim(RFC_MAIL, { resolveTxt: only("test") }), { ok: true, domain: "football.example.com" });
  // control: one changed word in the body and neither verifies
  const bent = RFC_MAIL.replace("hungry", "hungrY");
  for (const s of ["brisbane", "test"]) assert.equal((await checkDkim(bent, { resolveTxt: only(s) })).ok, false);
});

const PRIVY = readFileSync(new URL("../fixtures/privy-pumpfun.eml", import.meta.url), "utf8");
const privy = testSigner("privy.io");
const evil = testSigner("evil.example");
const dns = testDns(privy, evil);
const verdict = (raw: string, resolveTxt: TxtResolver = dns) => checkDkim(raw, { resolveTxt });

test("privy.io's own signature passes; every forgery and bend is refused", async () => {
  assert.deepEqual(await verdict(dkimSign(PRIVY, privy)), { ok: true, domain: "privy.io" });
  const no = async (raw: string, why: RegExp, temporary = false) => {
    const v = await verdict(raw);
    assert.ok(!v.ok && why.test(v.why) && v.temporary === temporary, `${JSON.stringify(v)} for ${why}`);
  };
  await no(PRIVY, /unsigned/);
  await no(dkimSign(PRIVY, privy).replace("482913", "111111"), /body changed/);
  await no(dkimSign(PRIVY, privy).replace("Your login code for pump.fun", "Your login code for pump.fun!"), /signature/);
  await no(dkimSign(PRIVY, evil), /From domain/);
  await no(dkimSign(PRIVY.replace("no-reply@privy.io", "no-reply@privy.io.evil.example"), privy), /From domain/);
  await no(dkimSign(PRIVY, privy, { tags: { l: "10" } }), /partly/);
  await no(dkimSign(PRIVY, privy, { tags: { a: "rsa-sha1" } }), /algorithm/);
  await no(dkimSign(PRIVY, privy, { tags: { x: "1000" } }), /expired/);
  await no(dkimSign(PRIVY, privy, { headers: ["to", "subject"] }), /From not signed/);
  await no(dkimSign(PRIVY, privy).replace("From: ", 'From: "pump.fun" <no-reply@privy.io>\r\nFrom: '), /single From/);
  // a key that isn't privy.io's (another key published under its selector) and a revoked one
  const stranger = testSigner("privy.io");
  assert.equal((await verdict(dkimSign(PRIVY, stranger))).ok, false);
  assert.equal((await verdict(dkimSign(PRIVY, privy), async () => [["v=DKIM1; k=ed25519; p="]])).ok, false);
  // DNS down: temporary, so the real sender tries again
  const down = await verdict(dkimSign(PRIVY, privy), async () => {
    throw Object.assign(new Error("servfail"), { code: "ESERVFAIL" });
  });
  assert.ok(!down.ok && down.temporary);
});
