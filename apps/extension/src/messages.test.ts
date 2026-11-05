import { test } from "node:test";
import assert from "node:assert/strict";
import { readPageMessage, readPanelMessage, senderKind } from "./messages.ts";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const MINT = "EHPugw1ghE46BeySAa7cHvoZHwYometbp1aK1Q7jpump";
const panel = { id: ID, url: `chrome-extension://${ID}/panel.html` };
const page = { id: ID, url: `https://pump.fun/coin/${MINT}`, frameId: 0, tab: { id: 7 } };

test("only this extension's panel page, with no tab, counts as the panel", () => {
  assert.equal(senderKind(panel, ID), "panel");
  assert.equal(senderKind({ ...panel, url: `chrome-extension://${ID}/panel.html?x=1` }, ID), "panel");
  assert.equal(senderKind({ ...panel, url: `chrome-extension://${ID}/other.html` }, ID), null);
  assert.equal(senderKind({ ...panel, tab: { id: 1 } }, ID), null, "an extension page opened in a tab");
  assert.equal(senderKind({ ...panel, id: "someoneelse" }, ID), null, "another extension");
  assert.equal(senderKind({ id: ID, url: `chrome-extension://otherid/panel.html` }, ID), null);
});

test("a supported site's top frame counts as a page; frames and other sites don't", () => {
  assert.equal(senderKind(page, ID), "page");
  assert.equal(senderKind({ ...page, frameId: 3 }, ID), null);
  assert.equal(senderKind({ ...page, url: "https://example.com/" }, ID), null);
  assert.equal(senderKind({ ...page, tab: undefined }, ID), null);
});

test("a page may only say where it is, for its own site, and ask to open the panel", () => {
  assert.deepEqual(readPageMessage({ t: "open" }, page), { t: "open" });
  assert.deepEqual(readPageMessage({ t: "page", href: `https://pump.fun/coin/${MINT}` }, page), { t: "page", href: `https://pump.fun/coin/${MINT}` });
  assert.equal(readPageMessage({ t: "page", href: `https://axiom.trade/meme/${MINT}` }, page), null, "pump.fun can't speak for Axiom");
  assert.equal(readPageMessage({ t: "open", extra: 1 }, page), null);
  assert.equal(readPageMessage({ t: "vault.unlock", passcode: "x".repeat(12) }, page), null, "never a wallet message");
  assert.equal(readPageMessage(null, page), null);
});

test("panel messages are read strictly", () => {
  assert.deepEqual(readPanelMessage({ t: "vault.status" }), { t: "vault.status" });
  assert.deepEqual(readPanelMessage({ t: "vault.unlock", passcode: "a long passcode" }), { t: "vault.unlock", passcode: "a long passcode" });
  assert.equal(readPanelMessage({ t: "vault.unlock", passcode: 12 }), null);
  assert.deepEqual(readPanelMessage({ t: "vault.signSol", tx: "dHg=", purpose: { kind: "trade" } }), { t: "vault.signSol", tx: "dHg=", purpose: { kind: "trade" } });
  assert.equal(readPanelMessage({ t: "vault.signSol", tx: "dHg=", purpose: { kind: "drain" } }), null);
  assert.equal(readPanelMessage({ t: "vault.signSol", tx: "x".repeat(5000), purpose: { kind: "trade" } }), null);
  assert.equal(readPanelMessage({ t: "vault.limit", usd: -1 }), null);
  assert.deepEqual(readPanelMessage({ t: "vault.limit", usd: 80 }), { t: "vault.limit", usd: 80 });
  assert.deepEqual(readPanelMessage({ t: "vault.limit", usd: 80, passcode: "a long passcode" }), { t: "vault.limit", usd: 80, passcode: "a long passcode" });
  assert.equal(readPanelMessage({ t: "vault.limit", usd: 80, passcode: 12 }), null);
  assert.equal(readPanelMessage({ t: "vault.export" }), null);
  assert.deepEqual(readPanelMessage({ t: "vault.linkCode", passcode: "a long passcode", code: "7KQ2M-9XD4R" }), { t: "vault.linkCode", passcode: "a long passcode", code: "7KQ2M-9XD4R" });
  assert.equal(readPanelMessage({ t: "vault.linkCode", passcode: "a long passcode" }), null, "the link needs the phone's code");
  const b = Buffer.alloc(32, 7).toString("base64");
  assert.deepEqual(readPanelMessage({ t: "vault.unlockTouch", prf: b }), { t: "vault.unlockTouch", prf: b });
  assert.equal(readPanelMessage({ t: "vault.unlockTouch", prf: Buffer.alloc(16).toString("base64") }), null, "a PRF output is 32 bytes");
  assert.deepEqual(readPanelMessage({ t: "vault.touchOn", passcode: "a long passcode", credId: "AbCdEfGhIjKlMnOp_-12", salt: b, prf: b, extra: 1 }), { t: "vault.touchOn", passcode: "a long passcode", credId: "AbCdEfGhIjKlMnOp_-12", salt: b, prf: b });
  assert.equal(readPanelMessage({ t: "vault.touchOn", credId: "AbCdEfGhIjKlMnOp_-12", salt: b, prf: b }), null, "turning Touch ID on needs the passcode");
  assert.equal(readPanelMessage({ t: "vault.touchOff" }), null, "and so does turning it off");
});
