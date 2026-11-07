// the copy review's words for separate steps on one sheet (fix/safe-steps-one-faceid, 7 Nov, graded C before): each step one line,
// the rule, the fee in dollars with the deposit that comes back, the Safe's coin after with no arrow and no NEAR row, no
// "Wallet says:", never an account id or "the swap service". Control: any other set says its steps as a chain does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase58 } from "@fastnear/utils";
import { SoftwareKey } from "./device-key.ts";
import { serialize } from "./tx-build.ts";
import type { CoreAction } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";
import { APART_WORDS, plainWordsApart, plainWordsMany } from "./words.ts";
import type { WordsContext } from "./words.ts";

const key = SoftwareKey.generate();
const NEAR = 10n ** 24n;
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "d".repeat(64);
const decoded = (actions: CoreAction[], receiverId: string) =>
  decodeTransaction(serialize({ signerId: "alice.near", publicKey: key.publicKey, nonce: 7n, receiverId, blockHash: toBase58(new Uint8Array(32).fill(9)), actions }));
const call = (method: string, args: object, deposit = 1n, gas = 30_000_000_000_000n): CoreAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas, depositYocto: deposit });
const coins = { pools: new Map(), coins: new Map([[USDC, { symbol: "USDC", decimals: 6 }]]) };
const ctx: WordsContext = { network: "mainnet", balanceYocto: 10n * NEAR, gasPriceYocto: 100_000_000n, knownRecipients: new Set(), nearUsd: 3, coins };
const room = decoded([call("storage_deposit", { account_id: DEPOSIT, registration_only: true }, 1_250_000_000_000_000_000_000n, 10_000_000_000_000n)], USDC);
const pay = decoded([call("ft_transfer", { receiver_id: DEPOSIT, amount: "135000000" })], USDC);
const outerOf = (...txs: ReturnType<typeof decoded>[]) => ({ ...txs[0]!, actions: txs.flatMap((t) => t.actions) });

test("the copy review's words: the Safe's two steps, each one line, the rule, the fee in dollars; no NEAR row, no app line, no ids", () => {
  const w = plainWordsApart([{ tx: room, ctx }, { tx: pay, ctx }], outerOf(room, pay), { ...ctx, hint: "Wallet says: Move it" });
  assert.deepEqual(w.lines, ["1. Your Safe lets NEAR Intents take $135.00 in USDC.", "2. Your Safe sends it.", "Step 2 runs only if step 1 worked.", w.lines[3]]);
  assert.match(w.lines[3]!, /^Fee · (about \$0\.\d\d|under \$0\.01)\. A small NEAR deposit comes back to your Safe later\.$/);
  assert.equal(w.hint, undefined, "no Wallet says: line");
  assert.ok(!w.effect.some((e) => e.token === "NEAR"), "the NEAR row goes");
  assert.ok(w.effect.every((e) => e.token === APART_WORDS.after && e.before === "" && /^\$[\d,]+\.\d\d in USDC$/.test(e.after)), JSON.stringify(w.effect));
  for (const line of w.lines) assert.doesNotMatch(line, /alice\.near|d{6}|swap service|0\.00125/, line);
});

test("no NEAR price: the fee in NEAR (provisional); NEAR Intents' ft_withdraw pays the same way", () => {
  const w = plainWordsApart([{ tx: room, ctx: { ...ctx, nearUsd: null } }, { tx: pay, ctx: { ...ctx, nearUsd: null } }], outerOf(room, pay), { ...ctx, nearUsd: null });
  assert.match(w.lines[3]!, /^Fee · at most [\d.]+ NEAR\. A small NEAR deposit comes back to your Safe later\.$/);
  const withdraw = decoded([call("ft_withdraw", { token: USDC, receiver_id: DEPOSIT, amount: "135000000" })], "intents.near");
  const intents = { codeMatches: true, tokens: new Map([[USDC, { symbol: "USDC", decimals: 6 }]]), balances: new Map([[`nep141:${USDC}`, 1_225_500_000n], [USDC, 1_225_500_000n]]), quotes: new Map(), ownWallets: new Map() } as unknown as NonNullable<WordsContext["intents"]>;
  const v = plainWordsApart([{ tx: room, ctx }, { tx: withdraw, ctx: { ...ctx, intents } }], outerOf(room, withdraw), ctx);
  assert.equal(v.lines[0], "1. Your Safe lets NEAR Intents take $135.00 in USDC.");
  assert.deepEqual(v.effect, [{ token: "Your Safe after", before: "", after: "$1,090.50 in USDC" }], "the Safe's USDC after, to the cent, no arrow, no NEAR row");
});

test("control: a set that isn't room-then-pay-that-address says its steps as a chain does, without the app's line", () => {
  const elsewhere = decoded([call("ft_transfer", { receiver_id: "e".repeat(64), amount: "135000000" })], USDC);
  const w = plainWordsApart([{ tx: room, ctx }, { tx: elsewhere, ctx }], outerOf(room, elsewhere), { ...ctx, hint: "Wallet says: Move it" });
  const chain = plainWordsMany([{ tx: room, ctx }, { tx: elsewhere, ctx }], outerOf(room, elsewhere), ctx);
  assert.deepEqual(w.lines, chain.lines);
  assert.equal(w.hint, undefined);
});
