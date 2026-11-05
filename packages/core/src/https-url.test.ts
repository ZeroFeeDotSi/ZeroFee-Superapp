// httpsOrigin against the WHATWG URL it stands in for (the phone's core has no URL: https-url.ts). The control is URL
// itself: whatever httpsOrigin accepts, URL must read as the same https origin and host, with the same path, query and
// fragment; and it refuses what the core's callers refused through URL (a user, another scheme, no host).
import { test } from "node:test";
import assert from "node:assert/strict";
import { httpsOrigin } from "./https-url.ts";
import { relayBase } from "./relay.ts";

const ACCEPTED = [
  "https://quotes-seven-gamma.vercel.app",
  "https://quotes-seven-gamma.vercel.app/",
  "https://RPC.Mainnet.FastNear.com",
  "https://rpc.intea.rs/",
  "https://example.com:443/",
  "https://example.com:8443",
  "https://example.com:0443/x",
  "https://a1.node",
  "https://app.gnosispay.com/path/to?x=1#frag",
  "https://1.2.3.4:8080/",
  "HTTPS://example.com",
  "https://xn--bcher-kva.example/",
];
const REFUSED = [
  "http://example.com/", "wss://example.com", "ftp://example.com", "https:example.com", "https:/example.com", "https://",
  "https://user@example.com", "https://user:pw@example.com/", "https://example.com:99999", "https://example.com:",
  "https://exa mple.com", " https://example.com", "https://example.com\\@evil.com", "https://example..com", "https://-a.com",
  "https://0x7f.0.0.1/", "https://127.1/", "https://1.2.3.04", "https://bücher.example/", "https://[::1]/", "javascript:alert(1)",
  "", 7, null, undefined, {},
];

test("what httpsOrigin accepts, URL reads the same way: origin, host and what follows", () => {
  for (const raw of ACCEPTED) {
    const got = httpsOrigin(raw);
    assert.ok(got, `accepted: ${raw}`);
    const u = new URL(raw);
    assert.equal(u.protocol, "https:", raw);
    assert.equal(got.origin, u.origin, raw);
    assert.equal(got.host, u.host, raw);
    assert.equal(got.rest || "/", `${u.pathname}${u.search}${u.hash}`, raw);
  }
});

test("a user, another scheme, no host, a space, a backslash, a bad port or an address URL would rewrite: refused", () => {
  for (const raw of REFUSED) assert.equal(httpsOrigin(raw), null, String(raw));
});

test("the relay's base reads as before, and as the phone build's relay-url.txt gives it", () => {
  assert.equal(relayBase("https://quotes-seven-gamma.vercel.app"), "https://quotes-seven-gamma.vercel.app");
  assert.equal(relayBase(" https://Quotes.Example:443/ "), "https://quotes.example");
  for (const bad of ["", "   ", "http://quotes.example", "https://quotes.example/v0", "https://quotes.example/?a", "https://quotes.example/#x", "https://u@quotes.example", undefined]) {
    assert.equal(relayBase(bad), undefined, String(bad));
  }
});

test("it needs no URL: with URL gone (as in JavaScriptCore) it answers the same", () => {
  const g = globalThis as { URL?: unknown };
  const had = g.URL;
  const before = ACCEPTED.map((r) => httpsOrigin(r));
  delete g.URL;
  try {
    assert.equal(typeof (globalThis as { URL?: unknown }).URL, "undefined", "the control: URL really is gone");
    assert.deepEqual(ACCEPTED.map((r) => httpsOrigin(r)), before);
    assert.equal(relayBase("https://quotes-seven-gamma.vercel.app"), "https://quotes-seven-gamma.vercel.app");
  } finally {
    g.URL = had;
  }
});
