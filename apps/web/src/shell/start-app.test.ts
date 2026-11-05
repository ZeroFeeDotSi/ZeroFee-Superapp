import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_START_APP, startAppIndex } from "./start-app.ts";

const ids = (...xs: string[]) => xs.map((id) => ({ id }));
const adult = ids("security", "wallet", "pay", "trade");

test("D31b: the app opens on Wallet by default; Security stays first in the swipe order, one swipe left of Wallet", () => {
  assert.equal(DEFAULT_START_APP, "wallet");
  assert.equal(adult[startAppIndex(adult)].id, "wallet");
  assert.equal(startAppIndex(adult), 1);
  assert.equal(adult[0].id, "security"); // the order is the caller's and is not changed here
  assert.equal(startAppIndex(adult, undefined), 1);
});

test("D31b: an explicit target (a hand-off, a deep link) still wins", () => {
  assert.equal(adult[startAppIndex(adult, { id: "pay" })].id, "pay");
  assert.equal(adult[startAppIndex(adult, { id: "security" })].id, "security");
  assert.equal(adult[startAppIndex(adult, { id: "trade" })].id, "trade");
});

test("D31b: a target this build doesn't show falls back to Wallet, and no Wallet means the first", () => {
  assert.equal(adult[startAppIndex(adult)].id, "wallet");
  assert.equal(startAppIndex(adult, { id: "nope" }), 1);
  assert.equal(startAppIndex(ids("security", "pay")), 0);
  assert.equal(startAppIndex([]), 0);
});
