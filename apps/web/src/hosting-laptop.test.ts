// laptop.zerofee.si (QA's MUST, QA's ruling, 5 Nov): the laptop page's own origin, a strict CSP,
// no third-party script, no worker or service worker. Control: the app's own CSP allows far more (it isn't the laptop's).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAR_MAINNET_NODES } from "@zerofee/core/chain";
import { LAPTOP_CONNECT, csp, laptopCsp, laptopVercelConfig } from "./hosting.ts";
import { SECOND_DEVICE_SITE } from "./mode.ts";

const dir = (p: string, name: string) => p.split("; ").find((d) => d.startsWith(`${name} `))?.slice(name.length + 1);

test("the pick is its own origin, laptop.zerofee.si (never the website's zerofee.si, never the Sim's superapp)", () => {
  assert.equal(SECOND_DEVICE_SITE, "laptop.zerofee.si");
  assert.doesNotMatch(SECOND_DEVICE_SITE, /\//, "a host of its own, not a path on another site");
});

test("the laptop's CSP: scripts from itself only, no worker of any kind, never framed, only the NEAR nodes it reads", () => {
  const p = laptopCsp();
  assert.equal(dir(p, "default-src"), "'none'");
  assert.equal(dir(p, "script-src"), "'self'");
  assert.equal(dir(p, "worker-src"), "'none'");
  assert.equal(dir(p, "frame-ancestors"), "'none'");
  assert.equal(dir(p, "object-src"), "'none'");
  assert.equal(dir(p, "base-uri"), "'none'");
  assert.equal(dir(p, "connect-src"), `'self' ${LAPTOP_CONNECT.join(" ")}`);
  for (const n of NEAR_MAINNET_NODES) assert.ok(LAPTOP_CONNECT.includes(n), `${n}: the core reads the chain there`);
  assert.equal(LAPTOP_CONNECT.length, NEAR_MAINNET_NODES.length + 2, "the nodes plus FastNEAR's key and tx indexes, nothing more");
  assert.doesNotMatch(p, /chaindefuser|jup\.ag|testnet|unsafe-eval|\*/, "no swap host, no testnet, no eval, no wildcard");
});

test("laptop.zerofee.si's vercel.json: the laptop CSP and the app's other security headers on every path, the page never kept", () => {
  const c = laptopVercelConfig();
  const all = c.headers.find((h) => h.source === "/(.*)")!.headers;
  const get = (k: string) => all.find((h) => h.key === k)?.value;
  assert.equal(get("Content-Security-Policy"), laptopCsp());
  assert.equal(get("X-Frame-Options"), "DENY");
  assert.match(get("Strict-Transport-Security") ?? "", /max-age=63072000/);
  assert.equal(get("Cross-Origin-Opener-Policy"), "same-origin");
  assert.equal(all.filter((h) => h.key === "Content-Security-Policy").length, 1);
  assert.equal(c.headers.find((h) => h.source === "/")?.headers[0]?.value, "no-store");
  assert.equal((c as { rewrites?: unknown }).rewrites, undefined, "nothing proxied: the page is this project's own files");
});

test("control: the app's CSP is not the laptop's (it reaches the relay, prices and swaps; it allows workers)", () => {
  const app = csp(["https://1click.chaindefuser.com", "https://lite-api.jup.ag"], "https://relay.example");
  assert.notEqual(app, laptopCsp());
  assert.equal(dir(app, "worker-src"), "'self'");
  assert.match(dir(app, "connect-src") ?? "", /relay\.example/);
});
