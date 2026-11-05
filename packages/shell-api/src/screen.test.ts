import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScreen, routeScreen } from "./screen.ts";

test("<app>/<tab> names a place in the whole app", () => {
  assert.deepEqual(parseScreen("security/activity"), { app: "security", tab: "activity" });
  assert.deepEqual(parseScreen("wallet/"), { app: "wallet" });
});

test("a name with no slash, or a malformed one, is not a place the shell can open", () => {
  for (const s of ["receive", "ask", "", "/activity", "a/b/c"]) assert.equal(parseScreen(s), null, s);
});

test("routeScreen only routes to an app the shell hosts", () => {
  const ids = ["security", "wallet", "pay"];
  assert.deepEqual(routeScreen("security/activity", ids), { app: "security", tab: "activity" });
  assert.equal(routeScreen("nowhere/activity", ids), null);
  assert.equal(routeScreen("security", ids), null);
});
