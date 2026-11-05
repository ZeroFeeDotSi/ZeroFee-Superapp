import { test } from "node:test";
import assert from "node:assert/strict";
import { askDeviceNext, devicesLine, offerLaptop, refillName } from "./devices.ts";

test("after the laptop is added, its yes for big payments is offered until a band asks it (grade 1 Nov, item 2)", () => {
  const laptop = [{ handle: "h", kind: "laptop" as const }];
  assert.equal(askDeviceNext(laptop, ["faceid", "wait"], false), "laptop");
  assert.equal(askDeviceNext(laptop, ["faceid", "both"], false), null, "a band already asks it");
  assert.equal(askDeviceNext(laptop, ["faceid", "wait"], true), null, "a rules change is already waiting");
  assert.equal(askDeviceNext([], ["faceid", "wait"], false), null, "no laptop yet");
  assert.equal(askDeviceNext(laptop, null, false), null, "rules not read yet: nothing claimed");
  assert.equal(askDeviceNext([{ handle: "g", kind: "guardian" }], ["faceid"], false), "guardian");
});

test("who can sign besides this phone, in a line", () => {
  assert.equal(devicesLine([], true), "Only this phone");
  assert.equal(devicesLine([{ handle: "a", kind: "laptop" }], true), "Phone + laptop");
  assert.equal(devicesLine([{ handle: "a", kind: "guardian" }], true), "Phone + guardian");
  assert.equal(devicesLine([{ handle: "a", kind: "laptop" }, { handle: "b", kind: "guardian" }], true), "Phone + laptop + guardian");
  assert.equal(devicesLine([{ handle: "a", kind: "laptop" }, { handle: "b", kind: "laptop" }], true), "Phone + laptop");
  // grade 1 Nov, D17: a browser is never "this phone"
  assert.equal(devicesLine([], false), "Only this device");
  assert.equal(devicesLine([{ handle: "a", kind: "laptop" }], false), "This device + laptop");
});

test("the laptop card: over $5,000 in the main balance, no second device, not just put off", () => {
  assert.equal(offerLaptop(5_000.01, [], false), true);
  assert.equal(offerLaptop(5_000, [], false), false);
  assert.equal(offerLaptop(9_000, [{ handle: "a", kind: "laptop" }], false), false);
  assert.equal(offerLaptop(9_000, [], true), false);
});

test("which second device to refill, in words", () => {
  assert.equal(refillName([{ handle: "a", kind: "laptop" }]), null);
  assert.equal(refillName([{ handle: "a", kind: "laptop", needsRefill: true }]), "laptop");
  assert.equal(refillName([{ handle: "a", kind: "second device", needsRefill: true }]), "second device");
  assert.equal(refillName([{ handle: "a", kind: "laptop", needsRefill: true }, { handle: "b", kind: "guardian", needsRefill: true }]), "second devices");
});
