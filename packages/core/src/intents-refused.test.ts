// QA 16's MUST (7 Nov, after the audit's way-home M9): the Move, Swap, Send and Add paths added the service's raw text to the
// person's words ("NEAR Intents said no. Nothing moved. fetch failed"): float-moves (8 sites), safe-swap, subwallets
// privateQuoteIn and sendPrivateNow, float-perps. Now each says what failed by name, where the money is by place, and the
// next tap; every field of the refusal agrees; the raw text only on the error's cause. Fails on main (the raw tail).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { refusalFace } from "@zerofee/shell-api/refusal-face.ts";
import { INTENTS_REFUSED, intentsNotTaken, intentsRefused } from "./intents-refused.ts";
import { createSafeSwaps } from "./safe-swap.ts";
import { TEST_QUOTE_KEY } from "./quote-test-key.ts";

const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
const machine = /fetch failed|HTTP \d|ECONN|TypeError|[{}]|nep\d{3}:|0x[0-9a-f]{6}|undefined/i;
const shown = (p: any): string[] => [p.whatHappened, "where" in p.money ? p.money.where : "", p.more ?? "", p.next.label];

test("a relay that never answered: by name, the place, the next tap; never its text (the cause keeps it); every field agrees", () => {
  const e = intentsRefused(new TypeError("fetch failed"), "in your Safe") as any;
  assert.equal(e.problem.code, "security.subwallet.refused", "the same code: every reader of it keeps working");
  assert.equal(e.problem.more, "NEAR Intents didn't answer. Nothing moved. Your money is still in your Safe. Try again in a minute.");
  assert.deepEqual(refusalFace(e.problem), { head: "NEAR Intents didn't answer.", body: "Nothing moved. Your money is still in your Safe. Try again in a minute." });
  assert.deepEqual([e.problem.whatHappened, e.problem.money], ["NEAR Intents didn't answer. Nothing moved.", { state: "safe", where: "in your Safe" }]);
  for (const w of shown(e.problem)) assert.ok(!machine.test(w) && !/can't approve this|that wallet/.test(w), w);
  assert.equal(e.cause.message, "fetch failed");
});

test("1Click's own no (the relay's refused mark): \"NEAR Intents said no.\", its message never shown; after a signature: unsure, Activity", () => {
  const no = intentsRefused(Object.assign(new Error("HTTP 400 {\"message\":\"Amount is too low for bridge\"}"), { refused: true }), "in your Solana wallet") as any;
  assert.match(no.problem.more, /^NEAR Intents said no\. Nothing moved\. Your money is still in your Solana wallet\. Try again in a minute\.$/);
  for (const w of shown(no.problem)) assert.ok(!machine.test(w) && !/too low/.test(w), w);
  const late = intentsNotTaken(Object.assign(new Error("HTTP 409 nonce used 0xdeadbeef"), { refused: true }), "in your NEAR wallet, or on its way") as any;
  assert.equal(late.problem.more, `${INTENTS_REFUSED.notTaken} ${INTENTS_REFUSED.check}`);
  assert.equal(late.problem.money.state, "unsure");
  for (const w of shown(late.problem)) assert.ok(!machine.test(w), w);
});

test("a real path: the Safe's swap quote with the relay down says it plainly, the money in the Safe", async () => {
  const swaps = createSafeSwaps({ relay: { quote: async () => { throw new TypeError("fetch failed"); } }, status: async () => null, quoteKey: TEST_QUOTE_KEY, account: async () => "kim.near" });
  const e: any = await swaps.quote("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "nep141:wrap.near", "10000000", "2900000000000000000000000").catch((x) => x);
  assert.equal(e.problem.more, "NEAR Intents didn't answer. Nothing moved. Your money is still in your Safe. Try again in a minute.");
});

test("no site appends a service's text any more; each names its place (controls: the helper is what they call)", () => {
  for (const f of ["float-moves.ts", "safe-swap.ts", "subwallets.ts", "float-perps.ts"]) assert.doesNotMatch(read(f), /\$\{String\(\(e as Error\)\??\.message( \?\? e)?\)\.slice\(0, 120\)\}/, f);
  const fm = read("float-moves.ts");
  for (const w of ["`in your ${CHAIN_NAME[c.chain]} wallet`", '"in your NEAR coin wallet"', '"in your Safe"', '"in your NEAR wallet"']) assert.ok(fm.includes(`intentsRefused(e, ${w})`), w);
  assert.equal((fm.match(/intentsNotTaken\(e, "in your NEAR wallet, or on its way"/g) ?? []).length, 2);
  assert.match(read("subwallets.ts"), /throw intentsRefused\(e, outside \? "where it was" : "in your Safe"\);/);
  assert.match(read("subwallets.ts"), /throw intentsRefused\(e, `in your \$\{row\.row\}`\);/);
  assert.match(read("float-perps.ts"), /intentsRefused\(e, "in Perps"\)/);
});

// QA 16's SHOULD (7 Nov): a move's reason line (Activity) said a node's own text after "Didn't go:" / "Not sent from".
import { stopWords } from "./intents-refused.ts";
test("stopWords: a Problem's words; the core's own words up to the node's text; else who didn't take it, by name (raw text never)", () => {
  const P = Object.assign(new Error("x"), { problem: { whatHappened: "Robinhood Chain's fee is very high right now, so nothing was sent." } });
  assert.equal(stopWords(P, "Robinhood Chain didn't take it"), "Robinhood Chain's fee is very high right now, so nothing was sent");
  assert.equal(stopWords(new Error("neither node took it: gas required exceeds allowance (21000)"), "x"), "neither node took it");
  assert.equal(stopWords(new Error("no Solana node answered"), "x"), "no Solana node answered");
  assert.equal(stopWords(new Error("the two Solana nodes didn't agree on a recent blockhash (asked 3 times)"), "x"), "the two Solana nodes didn't agree on a recent blockhash (asked 3 times)");
  assert.equal(stopWords(new Error("its price ran out before it was signed"), "x"), "its price ran out before it was signed");
  for (const raw of ["fetch failed", "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1", "HTTP 503", "request timed out", "invalid json response body", "", "nonce too low 0xab12"]) {
    assert.equal(stopWords(new Error(raw), "Solana didn't take it"), "Solana didn't take it", raw);
  }
  assert.equal(stopWords("a thrown string", "Hyperliquid didn't take it"), "Hyperliquid didn't take it");
  const fm = read("float-moves.ts"), fp = read("float-perps.ts");
  assert.match(fm, /const said = stopWords\(e, `\$\{CHAIN_NAME\[c\.chain\]\} didn't take it`\);/);
  assert.match(fm, /reason: `Didn't go: \$\{said\} · the money is still in your \$\{CHAIN_NAME\[c\.chain\]\} wallet`/);
  assert.match(fm, /k\.move\.reason = `Not sent from your NEAR coin wallet: \$\{stopWords\(e, "NEAR didn't take it"\)\}`;/);
  assert.match(fp, /`Not confirmed by Hyperliquid yet: \$\{stopWords\(e, "Hyperliquid didn't answer"\)\}`/);
  assert.match(fp, /reason: `Not sent from Perps: \$\{stopWords\(e, "Hyperliquid didn't take it"\)\}`/);
  assert.doesNotMatch(fm + fp, /reason = `[^`]*\$\{k\.payError\}|reason: `[^`]*\$\{k\.payError\}/, "no reason line says payError");
});
