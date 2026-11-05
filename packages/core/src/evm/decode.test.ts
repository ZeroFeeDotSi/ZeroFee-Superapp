// The EVM sheet's words for an allowance (audit W-8): anything effectively unlimited says "no limit", and a huge amount
// is never shown as a modest number (by a coin that claims absurd decimals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { evmWords, type EvmDecoded } from "./decode.ts";

const TOKEN = "0x" + "a1".repeat(20), SPENDER = "0x" + "b2".repeat(20);
const approval = (amount: bigint): EvmDecoded => ({
  chain: "bsc", chainId: 56, to: TOKEN, nonce: 0, value: "0", gas: "60000", maxFee: "1000000000", maxPriorityFee: "0", selector: "0x095ea7b3",
  approve: { token: TOKEN, spender: SPENDER, amount: amount.toString(), spenderName: "the PancakeSwap v2 router" }, swaps: [], unknownTarget: false,
});
const permit = (amount: bigint): EvmDecoded => ({ ...approval(0n), approve: undefined, permit2: { token: TOKEN, spender: SPENDER, amount: amount.toString(), expiry: 2_000_000_000 } });
const usdc = (a: string) => (a === TOKEN ? { symbol: "USDC", decimals: 18 } : undefined);

test("W-8: an approval of 2^128 or more is 'no limit', not an exact number; below it, the exact amount", () => {
  for (const amount of [1n << 128n, 1n << 200n, (1n << 255n) - 1n, (1n << 256n) - 1n]) {
    assert.match(evmWords(approval(amount), usdc).lines.join(" | "), /ALL of your USDC, with no limit/, `2^${amount.toString(2).length - 1}`);
    assert.match(evmWords(permit(amount), usdc).lines.join(" | "), /ALL of your USDC, with no limit/, `Permit2, 2^${amount.toString(2).length - 1}`);
  }
  assert.match(evmWords(approval(1_500_000_000_000_000_000n), usdc).lines.join(" | "), /exactly 1\.5 USDC/);
  assert.match(evmWords(approval((1n << 128n) - 1n), usdc).lines.join(" | "), /exactly 340,282,366,920,938,463,463\.374607431768211455 USDC/);
});

test("W-8: a coin claiming absurd decimals can't make a huge amount look modest: it is an unnamed coin, its raw units one tap down", () => {
  // 10^38 raw with 36 "decimals" would read as "100 FAKE"
  const fake = (a: string) => (a === TOKEN ? { symbol: "FAKE", decimals: 36 } : undefined);
  const words = evmWords(approval(10n ** 38n), fake);
  const line = words.lines.join(" | ");
  assert.doesNotMatch(line, /exactly 100 FAKE/, line);
  assert.match(line, /exactly an amount of an unnamed coin/, line);
  assert.doesNotMatch(line, /units of|\d{13,}/, "the line is plain (UI-SIMPLICITY-RULES 3)");
  // Nothing approved is dropped: the exact raw amount and the coin's full address are the sheet's disclosure.
  const shown = (words.details ?? []).flatMap((d) => d.lines).join(" | ");
  assert.match(shown, /an amount ZeroFee can't read yet \(100000000000000000000000000000000000000 units\)/, shown);
  assert.ok(shown.includes(TOKEN), shown);
  // One coin, one name: a W-8 coin's symbol isn't used anywhere else on the sheet either (security review 2 Nov, Low 5).
  assert.doesNotMatch([words.title, ...words.lines].join(" | "), /FAKE/);
});

test("an unnamed coin's amount and id move to the disclosure, and two unnamed coins never blur", () => {
  const words = evmWords(approval(123n));
  assert.ok(words.lines.some((l) => l.includes("exactly an amount of an unnamed coin")), words.lines.join(" | "));
  assert.deepEqual(words.details, [{ label: "The unnamed coin", lines: [`An unnamed coin: its id is ${TOKEN}`, "An unnamed coin: an amount ZeroFee can't read yet (123 units)"] }]);
  assert.equal(evmWords(approval(123n), (a) => (a === TOKEN ? { symbol: "USDC", decimals: 6 } : undefined)).details, undefined, "a named coin has no disclosure");
});
