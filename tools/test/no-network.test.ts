// The hermetic guard (no-network.ts) can fire: a unit test that reaches a live service is refused at the socket and its
// file fails at exit; this machine (loopback) stays open; and every unit test file runs under it (package.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { local, refused } from "./no-network.ts";

test("a unit test can't reach a live service: 1Click is refused at the socket, named, and counted against the file", async () => {
  const e = await fetch("https://1click.chaindefuser.com/v0/tokens").then(() => null, (err: unknown) => err as Error & { cause?: { code?: string } });
  assert.ok(e, "the fetch failed");
  assert.equal(e!.cause?.code, "ZF_NO_NETWORK");
  assert.ok(refused.includes("1click.chaindefuser.com"));
  // this test's own planted call is the control; clear it so the file itself passes
  refused.splice(0, refused.length);
});

test("this machine stays open (vite's middleware, a tool's relay on loopback), and only it", () => {
  for (const h of ["localhost", "127.0.0.1", "::1", "[::1]", undefined, ""]) assert.ok(local(h), String(h));
  for (const h of ["1click.chaindefuser.com", "bridge.chaindefuser.com", "rpc.mainnet.fastnear.com", "10.0.0.1", "example.localhost.evil.com"]) assert.ok(!local(h), h);
});

test("every unit test file runs under the guard (npm test loads it first)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.test, /^node --import \.\/tools\/test\/no-network\.ts --test /);
});
