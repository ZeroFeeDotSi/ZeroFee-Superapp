import { test } from "node:test";
import assert from "node:assert/strict";
import { backLink, readBack } from "./back-to.ts";

test("a step another app handed over names where it goes back to, and only a real app and a plain page", () => {
  assert.deepEqual(readBack(backLink({ app: "social", tab: "pumpfun" })), { app: "social", tab: "pumpfun" });
  assert.deepEqual(readBack(backLink({ app: "chat" })), { app: "chat" });
  assert.equal(readBack(undefined), null);
  assert.equal(readBack("back=security"), null, "not an app");
  assert.equal(readBack("tab=pumpfun"), null);
  assert.deepEqual(readBack("back=social&tab=..%2Fx"), { app: "social" }, "a strange page name is dropped, the app kept");
});
