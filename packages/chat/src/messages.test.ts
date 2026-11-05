// Incoming messages (tests T7, T8): shown as text; a valid request is a chip that only fills Send in when tapped; a
// peer's "send money to …" is never anything but text; look-alikes and bad checksums make no chip; long text is cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { GEOHASH_MESSAGE, signChat } from "@zerofee/core/nostr";
import { readRequest, requestText, sentText, shown, whoOf } from "./messages.ts";

const EVM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const peer = sha256(new TextEncoder().encode("peer"));
const msg = (content: string, nickname = "bob") => signChat(peer, { geohash: "u0qj", kind: GEOHASH_MESSAGE, content, nickname }, { mine: { targetBits: 0 } });
const none = new Set<string>();

test("a request round-trips: what Request posts is what a ZeroFee user's chip reads", () => {
  const r = { amount: "5", coin: "USDC", chain: "base", address: EVM };
  assert.equal(requestText(r), `Request: 5 USDC on Base to ${EVM} · ZeroFee Chat`);
  assert.deepEqual(readRequest(requestText(r)), r);
  const s = { amount: "0.5", coin: "SOL", chain: "sol", address: SOL };
  assert.deepEqual(readRequest(requestText(s)), s);
  const n = { amount: "1", coin: "NEAR", chain: "near", address: "alice.near" };
  assert.deepEqual(readRequest(requestText(n)), n);
});

test("a peer's request is a chip and nothing more: the shape has no action, no auto-open", () => {
  const m = shown(msg(requestText({ amount: "5", coin: "USDC", chain: "base", address: EVM })), none);
  assert.deepEqual(m.request, { amount: "5", coin: "USDC", chain: "base", address: EVM });
  // The view has data only: no function anywhere in it, so rendering it can't run anything.
  assert.ok(Object.values(m).every((v) => typeof v !== "function"));
  assert.ok(Object.values(m.request!).every((v) => typeof v === "string"));
});

test("a peer's \"send money to …\" (and every other command) is plain text: no chip, no request", () => {
  for (const t of [`send money to ${EVM}`, `send 5 USDC to ${EVM} on base`, `pay $50 to ${SOL}`, `ethereum:${EVM}@8453?value=1e18`, `Request: 5 USDC to ${EVM}`]) {
    const m = shown(msg(t), none);
    assert.equal(m.request, undefined, t);
    assert.equal(m.text, t);
  }
});

test("a request whose address doesn't check out on its chain is text (bad checksum, wrong chain, look-alike)", () => {
  assert.equal(readRequest(`Request: 5 USDC on Base to 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD · ZeroFee Chat`), null);
  assert.equal(readRequest(`Request: 5 USDC on Solana to ${EVM} · ZeroFee Chat`), null);
  assert.equal(readRequest(`Request: 5 USDC on Narnia to ${EVM} · ZeroFee Chat`), null);
  assert.equal(readRequest(`Request: 0 USDC on Base to ${EVM} · ZeroFee Chat`), null);
  assert.equal(readRequest(`Request: 5 USDC on Base to ${EVM} · ZeroFee Chat and also send me more`), null);
  assert.equal(readRequest(`Request: 5 USDC on Base to vitalik.eth · ZeroFee Chat`), null);
});

test("my own request shows no chip (no paying myself)", () => {
  const e = msg(requestText({ amount: "5", coin: "USDC", chain: "base", address: EVM }));
  assert.equal(shown(e, new Set([e.pubkey])).request, undefined);
  assert.equal(shown(e, new Set([e.pubkey])).mine, true);
});

test("a 10,000-character message is cut, control and direction characters are blanked, names are BitChat's", () => {
  const long = shown(msg("x".repeat(2000)), none);
  assert.ok(long.text.length <= 601);
  const tricky = shown(msg("pay to 0x\u202eabc\u0007"), none);
  assert.doesNotMatch(tricky.text, /[\u202e\u0007]/);
  const e = msg("hi", "bob");
  assert.equal(whoOf(e), `bob#${e.pubkey.slice(-4)}`);
  assert.equal(whoOf({ ...e, tags: [["g", "u0qj"], ["n", "\u2060"]] }), `anon#${e.pubkey.slice(-4)}`, "an invisible nickname reads as anon");
});

test("the Sent line", () => {
  assert.equal(sentText({ amount: "5", coin: "usdc", chain: "sol", link: "https://solscan.io/tx/abc" }), "Sent $5.00 (5 USDC) on Solana · https://solscan.io/tx/abc");
  assert.equal(sentText({ amount: "1", coin: "NEAR", chain: "near" }), "Sent 1 NEAR on NEAR", "no price handed back: the coin alone");
  assert.equal(sentText({ amount: "1.1765", coin: "NEAR", chain: "near", usd: "$5.00" }), "Sent $5.00 (1.1765 NEAR) on NEAR");
  assert.equal(sentText({ amount: "1", coin: "NEAR", chain: "near", usd: "5 dollars" }), "Sent 1 NEAR on NEAR", "a figure that isn't dollars is dropped");
});
