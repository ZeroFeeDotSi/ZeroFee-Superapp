import { test } from "node:test";
import assert from "node:assert/strict";
import { AT_LAUNCH, LAPTOP_SITE, LAPTOP_SITE_LIVE, LAPTOP_SOON, laptopPage, laptopWords, OPEN_ON_LAPTOP } from "./laptop-words.ts";
import { SECOND_DEVICE_SITE } from "../../mode.ts";
/** The product decision (5 Nov, A), for the tests of the flipped state. */
const PICK = SECOND_DEVICE_SITE;

test("the public demo says the app's own instruction, never an address", () => {
  for (const host of ["127.0.0.1:5181", "demo.zerofee.si", undefined]) {
    for (const mainnet of [false, true]) {
      const w = laptopWords(true, host, mainnet);
      assert.equal(w.open, OPEN_ON_LAPTOP);
      assert.equal(w.address, undefined);
      assert.doesNotMatch(`${w.open} ${w.where}`, /\?laptop|127\.0\.0\.1|localhost|\.si/);
    }
  }
});

test("H13: once the site serves it, on mainnet the phone names the second device's own site, whatever its own host is (the iPhone's is \"app\")", () => {
  for (const host of ["app", "localhost:5180", "superapp.zerofee.si", undefined]) {
    const w = laptopWords(false, host, true, PICK);
    assert.equal(w.open, `On your laptop, open ${PICK}`, String(host));
    assert.equal(w.address, PICK);
    assert.equal(w.where, `Your laptop shows it at ${PICK}.`);
    assert.doesNotMatch(`${w.open} ${w.where}`, /app\/|\?laptop|localhost/);
  }
  assert.equal(laptopPage(false, "app", true, PICK), PICK, "the product pick, whatever the phone's own host");
});

test("the product pick is live (check-laptop-site.sh passed): mainnet names laptop.zerofee.si and offers Add my laptop", () => {
  assert.equal(LAPTOP_SITE, "laptop.zerofee.si");
  assert.equal(LAPTOP_SITE_LIVE, true);
  for (const host of ["app", "localhost:5180", undefined]) {
    const w = laptopWords(false, host, true);
    assert.equal(w.address, "laptop.zerofee.si", String(host));
    assert.equal(w.later, undefined);
    assert.doesNotMatch(`${w.open} ${w.where}`, /superapp/);
  }
  // control: unset is the undo, one line, no address
  assert.deepEqual(laptopWords(false, "app", true, null), { open: LAPTOP_SOON, where: LAPTOP_SOON, later: true });
  assert.doesNotMatch(LAPTOP_SOON, /zerofee\.si|\//);
});

test("grade 01d P17, 02e E12: testnet names a laptop page that opens (a local one in another browser); the iPhone's says when there is one", () => {
  for (const host of ["localhost:5180", "127.0.0.1:5181", "[::1]:5180", "LOCALHOST:5216"]) {
    const w = laptopWords(false, host);
    assert.equal(w.address, `${host.toLowerCase()}/laptop`, host);
    assert.match(w.where, /in a different browser from this one\.$/, host);
  }
  for (const host of ["app", "app:80", undefined]) {
    const w = laptopWords(false, host);
    assert.deepEqual(w, { open: AT_LAUNCH, where: AT_LAUNCH, later: true }, String(host));
    assert.doesNotMatch(w.open + w.where, /npm|localhost|run dev/, "never a developer's command to the owner");
  }
  assert.equal(AT_LAUNCH, LAPTOP_SOON, "no address the operator hasn't picked (superapp.zerofee.si serves the Sim)");
  assert.doesNotMatch(AT_LAUNCH, /zerofee\.si|\//);
  for (const host of ["localhost:5180", "app", "x.y"]) assert.notEqual(laptopWords(false, host).open, OPEN_ON_LAPTOP, "never the dead instruction");
});

test("a real testnet deployment names its own laptop page", () => {
  assert.equal(laptopPage(false, "app.zerofee.si"), "app.zerofee.si/laptop");
  assert.match(laptopWords(false, "app.zerofee.si").open, /^On your laptop, open app\.zerofee\.si\/laptop$/);
});

test("control: the flip is one line; setting the site is all it takes on mainnet, and nothing else changes", () => {
  const before = laptopWords(false, "app", true, null);
  assert.equal(before.later, true);
  const after = laptopWords(false, "app", true, PICK);
  assert.equal(after.address, PICK);
  assert.equal(after.later, undefined, "Add my laptop is offered once the site is set");
  for (const site of [null, PICK]) {
    assert.deepEqual(laptopWords(true, "superapp.zerofee.si", true, site).address, undefined, "the public demo never names one");
    assert.equal(laptopWords(false, "app.zerofee.si", false, site).address, "app.zerofee.si/laptop", "testnet keeps its own host");
  }
});

test("the copy review's desktop audit (5 Nov): the page's own origin names its laptop page; a production build never names localhost (control: a development build still does, for another browser)", () => {
  // the origin as location.origin gives it: the scheme is never in the sentence
  assert.equal(laptopPage(false, "https://app.zerofee.si", false, PICK, true), "app.zerofee.si/laptop");
  assert.equal(laptopWords(false, "https://app.zerofee.si", false, PICK, true).open, "On your laptop, open app.zerofee.si/laptop");
  for (const origin of ["http://localhost:5209", "http://127.0.0.1:5181", "http://[::1]:5180", "localhost:5209"]) {
    const w = laptopWords(false, origin, false, PICK, true);
    assert.equal(w.address, undefined, origin);
    assert.doesNotMatch(`${w.open} ${w.where}`, /localhost|127\.0\.0\.1|\[::1\]|https?:/, origin);
    assert.deepEqual(w, { open: AT_LAUNCH, where: AT_LAUNCH, later: true }, "one true line, no address");
  }
  // control: the development build (Vite's dev server) still names it, for another browser on this computer
  const dev = laptopWords(false, "http://localhost:5209", false, PICK, false);
  assert.equal(dev.address, "localhost:5209/laptop");
  assert.match(dev.where, /in a different browser from this one\.$/);
  // the Sim (public build): its /laptop opens the Sim itself (mode.ts parseMode), so it keeps the app's own instruction
  assert.deepEqual(laptopWords(true, "https://superapp.zerofee.si", false, PICK, true).address, undefined);
  // mainnet: the laptop's own site, whatever the origin
  assert.equal(laptopWords(false, "http://localhost:5209", true, PICK, true).address, PICK);
});
