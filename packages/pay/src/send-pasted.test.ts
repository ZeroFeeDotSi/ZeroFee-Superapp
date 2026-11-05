// Grade 02g, G19: a nearblocks address page and `near:guest-book.testnet?amount=0.01` both got "That isn't a name or
// address we recognise". F21: "guest-bok.testnet" got no suggestion.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { didYouMean, findRecipient, readPasted } from "./send.ts";

const ok = (r: ReturnType<typeof readPasted>) => (r && "ok" in r ? r.ok : assert.fail(`expected ok, got ${JSON.stringify(r)}`));
const problem = (r: ReturnType<typeof readPasted>) => (r && "problem" in r ? r.problem.code : assert.fail(`expected a problem, got ${JSON.stringify(r)}`));

test("G19: an explorer's address page gives its account; a pay link gives its target and a near: link's amount", () => {
  assert.deepEqual(ok(readPasted("https://testnet.nearblocks.io/address/guest-book.testnet")), { text: "guest-book.testnet" });
  assert.deepEqual(ok(readPasted("https://nearblocks.io/address/Bob.near?tab=tokens")), { text: "Bob.near" });
  assert.deepEqual(ok(readPasted("near:guest-book.testnet?amount=0.01")), { text: "guest-book.testnet", amount: "0.01" });
  assert.deepEqual(ok(readPasted("near:guest-book.testnet")), { text: "guest-book.testnet" });
  assert.deepEqual(ok(readPasted("ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@1?value=1e18")), { text: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" });
  assert.deepEqual(ok(readPasted("https://solscan.io/account/7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV")), { text: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV" });
});

test("G19: a link to a payment, or with nothing in it, says so; plain text is not a link", () => {
  assert.equal(problem(readPasted("https://testnet.nearblocks.io/txns/BS5eWRJkHU1Yd3yKkXLB9Eb5p8LZo8cBCNQ4zG7fVq2A")), "pay.send.recipient-payment-link");
  assert.equal(problem(readPasted("https://example.com/hello")), "pay.send.recipient-link");
  assert.equal(readPasted("guest-book.testnet"), null);
  assert.equal(readPasted("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), null);
});

test("security review 2 Nov: a coin's own page (token, contract, NFT, mint) is never the recipient: money sent there is lost", async () => {
  for (const link of [
    "https://solscan.io/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "https://nearblocks.io/token/usdt.tether-token.near",
    "https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48?a=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "https://basescan.org/contract/0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "https://solscan.io/nft/7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
    "https://explorer.example/Mint/7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
  ]) assert.equal(problem(readPasted(link)), "pay.send.recipient-coin-link", link);
  const { payProblems } = await import("./pay-problems.ts");
  assert.match(payProblems.recipientCoinLink().whatHappened, /^That's a coin's page, not a person's address/);
  // control: the same explorers' address pages still give the person
  assert.deepEqual(ok(readPasted("https://solscan.io/account/7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV")), { text: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV" });
  assert.deepEqual(ok(readPasted("https://nearblocks.io/address/usdt.tether-token.near")), { text: "usdt.tether-token.near" });
  // and findRecipient never asks about the coin, never pays it
  const asked: unknown[] = [];
  const bridge = { call: async (_m: string, p: unknown) => (asked.push(p), { ok: { exists: true, hasLedgerBalance: false } }) } as unknown as Bridge;
  const r = await findRecipient(bridge, "https://nearblocks.io/token/usdt.tether-token.near");
  assert.equal("problem" in r && r.problem.code, "pay.send.recipient-coin-link");
  assert.deepEqual(asked, []);
});

test("security review 2 Nov: a pay link with a broken escape (near:%E0) is a plain line, never a throw that leaves Paste doing nothing", async () => {
  assert.doesNotThrow(() => readPasted("near:%E0"));
  assert.equal(problem(readPasted("near:%E0")), "pay.send.recipient-link-unreadable");
  assert.equal(problem(readPasted("solana:%E0%A4?amount=1")), "pay.send.recipient-link-unreadable");
  const r = await findRecipient({ call: async () => assert.fail("nothing is asked") } as unknown as Bridge, "near:%E0");
  assert.ok("problem" in r && /The account in that link can't be read/.test(r.problem.whatHappened));
  // control: a good escape still reads
  assert.deepEqual(ok(readPasted("near:guest%2Dbook.testnet")), { text: "guest-book.testnet" });
});

test("G19: findRecipient pays the account read out of a pasted link, and says where it came from", async () => {
  const asked: unknown[] = [];
  const bridge = { call: async (_m: string, p: unknown) => (asked.push(p), { ok: { exists: true, hasLedgerBalance: false } }) } as unknown as Bridge;
  const r = await findRecipient(bridge, "https://testnet.nearblocks.io/address/guest-book.testnet");
  assert.ok("ok" in r);
  assert.deepEqual(r.ok.recipient, { kind: "near-wallet", accountId: "guest-book.testnet" });
  assert.deepEqual(r.ok.fromLink, { text: "guest-book.testnet" });
  assert.deepEqual(asked, [{ accountId: "guest-book.testnet" }]);
});

test("F21: a name with no account gets the closest one they already know, never a stranger's", () => {
  assert.equal(didYouMean("guest-bok.testnet", ["guest-book.testnet", "alice.testnet"]), "guest-book.testnet");
  assert.equal(didYouMean("gustbok.testnet", ["guest-book.testnet"]), null, "control: three letters off is not a guess");
  assert.equal(didYouMean("guest-bok.testnet", []), null);
});
