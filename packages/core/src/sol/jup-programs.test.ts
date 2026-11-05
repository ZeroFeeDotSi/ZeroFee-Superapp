// The test real buy on the phone (3 Nov): "It routes through an app ZeroFee doesn't know. Nothing was signed."
// A memecoin's Jupiter route went through an AMM outside the six programs listed by hand. Jupiter's own list is pinned now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { JUPITER_ROUTE_PROGRAMS, JUPITER_ROUTE_SHA256 } from "./jup-programs.ts";
import { KNOWN_ROUTE_PROGRAMS, type SolDecoded } from "./decode.ts";
import { routeProgramsRefusal } from "./payout.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

test("Jupiter's list is pinned by its hash: any change to it is seen (control: one label changed breaks the pin)", () => {
  const canon = (o: Readonly<Record<string, string>>) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}:${v}\n`).join("");
  assert.equal(hex(sha256(new TextEncoder().encode(canon(JUPITER_ROUTE_PROGRAMS)))), JUPITER_ROUTE_SHA256);
  assert.equal(Object.keys(JUPITER_ROUTE_PROGRAMS).length, 110);
  const changed = { ...JUPITER_ROUTE_PROGRAMS, "9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp": "Something else" };
  assert.notEqual(hex(sha256(new TextEncoder().encode(canon(changed)))), JUPITER_ROUTE_SHA256, "control");
  assert.ok(Object.isFrozen(JUPITER_ROUTE_PROGRAMS));
});

test("the route check knows every AMM Jupiter routes through, and still refuses a program Jupiter doesn't list (control)", async () => {
  const route = (accounts: string[]) => ({ routeAccounts: accounts } as unknown as SolDecoded);
  const anyIsAProgram = async (keys: string[]) => keys.map(() => true);
  for (const id of ["9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp", "SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"]) {
    assert.equal(await routeProgramsRefusal(route([id]), anyIsAProgram), null, `${JUPITER_ROUTE_PROGRAMS[id]} inside a route signs`);
  }
  const stranger = "Stranger1111111111111111111111111111111111";
  assert.notEqual(await routeProgramsRefusal(route(["9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp", stranger]), anyIsAProgram), null, "control: a program no list names is still refused");
  assert.equal(await routeProgramsRefusal(route([stranger]), async (k) => k.map(() => false)), null, "control: an account two nodes say isn't a program is a plain account");
  // the hand-listed six stay, asked nothing of the nodes
  let asked = 0;
  assert.equal(await routeProgramsRefusal(route(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"]), async (k) => { asked++; return k.map(() => true); }), null);
  assert.equal(asked, 0);
  assert.ok(Object.hasOwn(KNOWN_ROUTE_PROGRAMS, "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"));
});
