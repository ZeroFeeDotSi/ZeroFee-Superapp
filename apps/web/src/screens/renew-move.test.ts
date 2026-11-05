// Dead ends row 8 (3 Nov), and security audit 4 Nov finding 2: "Move it now" after new words asks the core to move the
// old words' NEAR wallet and private pocket to the new words' ones (subwallet.oldWords.move), never the new pocket's own
// balance. A failed read or a coin that didn't start is named, the money is said to be still under the old words, and
// Try again is offered. "Nothing here needed moving." only when every read answered and found nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { moveOldHome } from "./renew-move.ts";

const NOPE = { problem: { code: "x", whatHappened: "x", money: { state: "not-involved" as const }, next: { kind: "nothing" as const, label: "Go back" } } };
type Answer = unknown | typeof NOPE;
const OLD = [{ kind: "trade", chain: "near", oldWords: true }, { kind: "private", chain: "near", oldWords: true }, { kind: "private", chain: "near" }];
const coin = (kind: string, state: string, tokenId = "usdc") => ({ kind, tokenId, amount: "7", state });

function fake(answers: Record<string, Answer>) {
  const calls: string[] = [];
  const bridge = {
    call: async (method: string) => {
      calls.push(method);
      const v = answers[method];
      return v && typeof v === "object" && "problem" in v ? v : { ok: v };
    },
  } as unknown as Pick<Bridge, "call">;
  return { bridge, calls };
}

test("audit 2: the tap asks the core to move the OLD words' wallets, never the new pocket's balance or the Safe's way home", async () => {
  const f = fake({ "subwallet.list": OLD, "subwallet.oldWords.move": { moving: 2, left: 0, coins: [coin("private", "moving"), coin("trade", "moving")] } });
  const out = await moveOldHome(f.bridge, "s");
  assert.deepEqual(f.calls, ["subwallet.list", "subwallet.oldWords.move"]);
  assert.equal(out.line, "Moving your private money and your NEAR wallet's money to your new wallets. Wallet's Details shows any others.");
  assert.equal(out.stuck, false);
});

test("a failed read is named with Try again, never 'Nothing here needed moving.' (controls: nothing old, nothing held)", async () => {
  for (const [answers, line] of [
    [{ "subwallet.list": NOPE }, "Your old wallets didn't load. Try again to see where their money is."],
    [{ "subwallet.list": OLD, "subwallet.oldWords.move": NOPE }, "Your old wallets didn't load. Try again to see where their money is."],
    [{ "subwallet.list": OLD, "subwallet.oldWords.move": { moving: 0, left: 1, coins: [], unread: true } }, "Some of your old wallets didn't load. It's still in your old wallets."],
  ] as const) {
    const out = await moveOldHome(fake(answers).bridge, "s");
    assert.deepEqual([out.line, out.stuck], [line, true]);
  }
  const none = await moveOldHome(fake({ "subwallet.list": [{ kind: "private", chain: "near" }] }).bridge, "s");
  assert.deepEqual([none.line, none.stuck], ["Nothing here needed moving. Wallet's Details shows any others.", false]);
  const empty = await moveOldHome(fake({ "subwallet.list": OLD, "subwallet.oldWords.move": { moving: 0, left: 0, coins: [] } }).bridge, "s");
  assert.deepEqual([empty.line, empty.stuck], ["Nothing here needed moving. Wallet's Details shows any others.", false]);
});

test("a coin that didn't start (out of tries, or waiting to be asked again) is named and offers Try again; a too-small one is said, never stuck", async () => {
  const some = await moveOldHome(fake({ "subwallet.list": OLD, "subwallet.oldWords.move": { moving: 1, left: 1, coins: [coin("private", "moving", "a"), coin("private", "stuck", "b")] } }).bridge, "s");
  assert.deepEqual([some.line, some.stuck], ["Moving your private money to your new wallets. Some of it didn't move yet. It's still in your old wallets.", true]);
  const none = await moveOldHome(fake({ "subwallet.list": OLD, "subwallet.oldWords.move": { moving: 0, left: 1, coins: [coin("trade", "waiting")] } }).bridge, "s");
  assert.deepEqual([none.line, none.stuck], ["Your old money didn't move yet. It's still in your old wallets.", true]);
  const dust = await moveOldHome(fake({ "subwallet.list": OLD, "subwallet.oldWords.move": { moving: 0, left: 1, coins: [coin("private", "left")] } }).bridge, "s");
  assert.deepEqual([dust.line, dust.stuck], ["A tiny bit is too small for the swap service to move. It stays in your old wallet. Wallet's Details shows any others.", false]);
});

test("the shell uses it, and its screen offers Try again while money is stuck", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const move = app.slice(app.indexOf("async function moveOld"), app.indexOf("async function stopRecovery"));
  assert.match(move, /moveOldHome\(shellBridge/);
  assert.doesNotMatch(move.replace(/\/\/.*/g, ""), /Nothing here needed moving|subwallet\./, "the line comes only from moveOldHome's reads");
  const screen = readFileSync(new URL("./Onboarding.tsx", import.meta.url), "utf8");
  const done = screen.slice(screen.indexOf("export function RenewDone"), screen.indexOf("export function MakeKey"));
  assert.match(done, /\(!moved \|\| stuck\)/);
  assert.match(done, /moved \? "Try again" : "Move it now"/);
  assert.doesNotMatch(done, /to your Safe/, "the money goes to the new words' wallets, not the Safe");
});
