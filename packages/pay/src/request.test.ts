import { test } from "node:test";
import assert from "node:assert/strict";
import { readRequest, requestLink, requestProblem, requestWebLink } from "./request.ts";
import type { PayRequest } from "./request.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

test("a request survives the round trip through a link", () => {
  const r: PayRequest = { to: "alex.near", amount: "12.5", token: USDC, note: "Dinner, split 4 ways", ref: "k3x9" };
  const link = requestLink(r);
  assert.match(link, /^zerofee:pay\?v=1&to=alex\.near&/);
  assert.deepEqual(readRequest(link, []), { ok: r });
});

test("the web form keeps every field after #, so no server ever sees them", () => {
  const r: PayRequest = { to: "alex.near", amount: "3" };
  const link = requestWebLink(r, "pay.example");
  assert.equal(link, "https://pay.example/pay#v=1&to=alex.near&amount=3");
  assert.deepEqual(readRequest(link, ["pay.example"]), { ok: r });
  assert.equal(readRequest(link, []), null, "a host that isn't ZeroFee's is just a web page");
});

test("a broken request is refused with its own Problem", () => {
  for (const bad of [
    "zerofee:pay?v=2&to=alex.near",
    "zerofee:pay?v=1&to=Not%20A%20Name",
    "zerofee:pay?v=1&to=alex.near&amount=-5",
    "zerofee:pay?v=1&to=alex.near&amount=0",
    "zerofee:pay?v=1&to=alex.near&token=0xdeadbeef",
    "zerofee:pay?v=1&to=alex.near&ref=has%20spaces",
  ]) {
    const r = readRequest(bad, []);
    assert.ok(r && "problem" in r, bad);
  }
  assert.equal(readRequest("bitcoin:bc1q…", []), null);
});

test("notes are cleaned and capped, never shown raw", () => {
  const r = readRequest(`zerofee:pay?v=1&to=alex.near&note=${encodeURIComponent("hi\u0000 " + "x".repeat(200))}`, []);
  assert.ok(r && "ok" in r);
  assert.ok(r.ok.note!.length <= 80);
  assert.ok(!r.ok.note!.includes("\u0000"));
});

test("a bad request never becomes a link", () => {
  assert.equal(requestProblem({ to: "alex.near" }), null);
  assert.equal(requestProblem({ to: "ALEX" })?.code, "pay.send.recipient-invalid");
  assert.equal(requestProblem({ to: "alex.near", amount: "1e3" })?.code, "pay.amount.invalid");
});
