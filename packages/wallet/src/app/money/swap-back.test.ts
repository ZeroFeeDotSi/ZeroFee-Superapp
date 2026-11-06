// A UI test (4 Nov, QA, S2 and S3): a $2.20 Move from the Safe to the SOL wallet left $2.13 there, and a
// wallet → Safe move needs $2.59, so the money could not come back, and nothing said so before. And "Hold to swap" at $0
// did nothing and said nothing. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOME_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { SWAP_WORDS, backLine, saidOnSheet } from "./swap-corridor.ts";
import { securityProblems } from "@zerofee/core/security-problems";
import { backLines, MOVE_WORDS, type PlaceNow } from "../screens/move-split.ts";

const least = `$${HOME_LEG_MIN_USD.toFixed(2)}`;

test("Swap: the Safe's money to a wallet that would hold under the least a swap back can be says so before the hold", () => {
  const sol = { kind: "topup", coin: "USDC", to: "sol" } as const;
  assert.equal(backLine(sol, 2.11, 0), SWAP_WORDS.noWayBack, "$2.11 to an empty SOL wallet: it can't come back");
  assert.match(SWAP_WORDS.noWayBack, new RegExp(`You'll need \\${least} `));
  // controls: enough there after it lands, a wallet that already holds money, a wallet's own move, no amount
  assert.equal(backLine(sol, 10, 0), null);
  assert.equal(backLine(sol, 2.11, 5), null);
  assert.equal(backLine({ kind: "topup", coin: "USDC", to: "near" }, 2.11, 0), null, "the NEAR wallet's money goes home from $2");
  assert.equal(backLine({ kind: "move", from: "near", to: "sol" }, 2.11, 0), null);
  assert.equal(backLine(sol, 0, 0), null);
});

test("Move: a Safe → wallet leg that leaves the wallet under the least a move home can be says so before the tap", () => {
  const now: PlaceNow[] = [{ place: "safe", usd: 62, lo: 0 }, { place: "sol", usd: 0, lo: 0 }, { place: "near", usd: 0, lo: 0 }];
  assert.deepEqual(backLines(now, [{ from: "safe", to: "sol", usd: 2.2 }]), [MOVE_WORDS.noWayBack(least, "your SOL wallet")]);
  assert.equal(MOVE_WORDS.noWayBack(least, "your SOL wallet"), `You'll need ${least} in your SOL wallet to move it back to your Safe.`);
  // controls: a bigger move, a wallet that already holds enough, a move into the NEAR wallet, a move home
  assert.deepEqual(backLines(now, [{ from: "safe", to: "sol", usd: 10 }]), []);
  assert.deepEqual(backLines([{ place: "safe", usd: 62, lo: 0 }, { place: "sol", usd: 4, lo: 0 }], [{ from: "safe", to: "sol", usd: 2.2 }]), []);
  assert.deepEqual(backLines(now, [{ from: "safe", to: "near", usd: 2.2 }]), []);
  assert.deepEqual(backLines(now, [{ from: "sol", to: "safe", usd: 3 }]), []);
});

test("the Swap and Move sheets show those lines, and \"Hold to swap\" at $0 says \"Pick an amount.\" when pressed", () => {
  const swap = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(readFileSync(new URL("./swap-corridor.ts", import.meta.url), "utf8"), /id: "swap-back"/);
  assert.match(swap, /swapSub\(\{ back,/);
  assert.match(readFileSync(new URL("./swap-corridor.ts", import.meta.url), "utf8"), /o\.block !== SWAP_WORDS\.amount \|\| o\.tried/, "the amount line shows once a press asked for it");
  assert.match(swap, /if \(on\.tap === "swap" && block === SWAP_WORDS\.amount\) return setTried\(true\);/, "a tap at $0 is heard, not swallowed by a disabled button");
  const move = readFileSync(new URL("../screens/MoveSheet.tsx", import.meta.url), "utf8");
  // the Move sheet's one note (footNote): "move-back" is its first kind
  assert.match(move, /footNote\(\{ back: shortLeg\(legs\) \|\| strandLeg\(now, legs\) \? \[\] : back,/);
  assert.match(move, /data-testid=\{foot\.kind\}/);
});

test("QA (4 Nov): \"Solana's price isn't read yet\" is said on the Swap sheet with its Try again, never on the shell's screen behind it", () => {
  const price = { ...securityProblems.partnerUnreachable("the price service"), whatHappened: "Solana's price isn't read yet. Nothing moved." };
  assert.equal(saidOnSheet(price), true);
  // controls: a service's Problem is the sheet's own line already; one that opens another screen goes to the shell
  assert.equal(saidOnSheet({ ...price, service: "oneclick" }), false);
  assert.equal(saidOnSheet({ ...price, next: { kind: "open", label: "Finish my new rules", screen: "held/7" } }), false);
  const swap = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(swap, /saidOnSheet\(end\.refused\) \? setStopped\(end\.refused\) : problem\(end\.refused, onUsd\)/, "said on the sheet, never pushed behind it");
  assert.match(swap, /const refused = stopped && !busy && !block \? stoppedLine\(stopped\) : null;/);
  assert.match(swap, /data-testid="swap-stopped">\{refused\}<\/p>/);
  assert.doesNotMatch(swap, /swap-stopped-next/, "its Try again is the one button (swap-floor.test.ts), asking again, the price with it");
  assert.match(swap, /<MoneySheet [^>]*onClose=\{made !== null \? finish : onClose\}/, "Close leaves (on the receipt, as Done)");
});

test("QA's real-money lap (5 Nov): a $2.10 Move from the Safe into an empty SOL wallet is refused before the tap (it could never come back: the core's $2 floor for a move home, float.ts FLOAT_MIN_USD, needs $2.59 there), with one line and the Leave tap; controls: enough, a wallet that already holds money, the NEAR wallet, a move home", async () => {
  const { moveBlock, strandLeg, leastOf } = await import("../screens/move-split.ts");
  const now: PlaceNow[] = [{ place: "safe", usd: 10.06, lo: 0 }, { place: "sol", usd: 0, lo: 0 }, { place: "near", usd: 0, lo: 0 }];
  const legs = [{ from: "safe", to: "sol", usd: 2.1 }] as const;
  const s = strandLeg(now, legs)!;
  assert.ok(s, "refused");
  assert.ok(leastOf({ from: "safe", to: "sol", usd: s.least }) >= HOME_LEG_MIN_USD - 0.004, "the least said is enough to come back");
  assert.ok(leastOf({ from: "safe", to: "sol", usd: s.least - 0.01 }) < HOME_LEG_MIN_USD - 0.004, "and a cent less is not");
  assert.equal(moveBlock(legs, 10.06, true, now), `Move at least $${s.least.toFixed(2)}, so your SOL wallet can send it back to your Safe later.`, "the copy review's words");
  // controls
  assert.equal(moveBlock([{ from: "safe", to: "sol", usd: s.least }], 10.06, true, now), null, "the least goes");
  assert.equal(moveBlock(legs, 10.06, true, [{ place: "safe", usd: 10.06, lo: 0 }, { place: "sol", usd: 1, lo: 0 }]), null, "a wallet holding $1 gets back over $2.59");
  assert.equal(moveBlock([{ from: "safe", to: "near", usd: 2.1 }], 10.06, true, now), null, "the NEAR wallet's money goes home from $2");
  assert.equal(moveBlock([{ from: "sol", to: "safe", usd: 3 }], 10.06, true, [{ place: "safe", usd: 7, lo: 0 }, { place: "sol", usd: 3, lo: 0 }]), null, "a move home");
  assert.equal(moveBlock(legs, 10.06, true), null, "no places given: as before");
  const sheet = readFileSync(new URL("../screens/MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /moveBlock\(legs, total, HOME_PROOF, now\)/, "the sheet blocks it");
  assert.match(sheet, /const short = running \? null : shortLeg\(legs\) \?\? strandLeg\(now, legs\);/, "with its Leave tap");
});
