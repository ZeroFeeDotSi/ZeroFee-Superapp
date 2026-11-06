// the copy review's walk of Send and Swap (5 Nov), the logic items: Swap's receipt says its time left (rule 2); one floor
// line with the route's own figure (under $2.09 the Safe → a wallet said "$2" and "$2.09"; S9: "Swap $7 or more" beside
// "start at $2.09"); Send's first payment names the wallet and the next step (rule 8). Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEG_SEC, TIME_WORDS, receiptLeft } from "@zerofee/shell-api/job-steps.ts";
import { SAFE_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { floorOf, routeSec, aboutTime, swapBlock, SWAP_WORDS, type SwapRoute, swapStays, PRIVATE_PAYS } from "./swap-corridor.ts";
import { firstPayLine } from "./send-guard.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("rule 2: Swap's receipt says the route's time left, from the same table as its 'About N' line (control: no estimate says so)", () => {
  const T = 1_000_000;
  const routes: [SwapRoute, number][] = [
    // the Safe -> a wallet swap is paid from Private, NEAR Intents swapping it on the way: LEG_SEC.privateSwap
    [{ kind: "topup", coin: "USDC", to: "sol" }, LEG_SEC.privateSwap],
    [{ kind: "topup", coin: "USDC", to: "near" }, 30],
    [{ kind: "move", from: "near", to: "sol" }, 30],
    [{ kind: "move", from: "sol", to: "hood" }, 60],
    [{ kind: "home", from: "sol" }, 60],
    [{ kind: "safe" }, 60],
  ];
  for (const [r, s] of routes) assert.equal(routeSec(r), s, JSON.stringify(r));
  assert.equal(aboutTime({ kind: "topup", coin: "USDC", to: "sol" }), "About 1 min.", "the sheet's line and the receipt read one figure");
  assert.equal(receiptLeft(T + routeSec({ kind: "topup", coin: "USDC", to: "sol" }) * 1000, T), "About 1 min left.");
  assert.equal(receiptLeft(T + 30_000, T), "About 30 s left.");
  assert.equal(receiptLeft(undefined, T), TIME_WORDS.receiptNone, "control: no estimate, said plainly");
  assert.equal(receiptLeft(T - 5_000, T), "Almost there.", "past it: a calm line, never a blame on the estimate");
  const sheet = src("./SwapSheet.tsx");
  assert.match(sheet, /etaSec: routeSec\(route\), safe,/, "the job's row counts down from the tap");
  assert.match(sheet, /<JobReceipt amount=\{made\} icon=\{<ActSwap \/>\} testid="swap-made" etaSec=\{route \? routeSec\(route\) : undefined\}/);
  const made = src("./JobMade.tsx");
  assert.match(made, /\{JOB_WORDS\.created\}[^]*?<TimeLeft etaSec=\{etaSec\} watch \/>/, "under Job created., above where to watch it");
  assert.match(src("../../../../shell-api/src/job-run.ts"), /\.\.\.\(a\.etaSec \? \{ etaSec: a\.etaSec \} : \{\}\)/, "runJob hands it to startJob");
});

test("the least, said only under it (the UI reviewer's ruling, 6 Nov): under $2.09 the Safe → a wallet refuses in the Safe's words; the NEAR wallet's own $2 is its control", () => {
  const safeOut: SwapRoute = { kind: "topup", coin: "USDC", to: "sol" };
  for (const usd of [1, 1.99, 2, 2.08]) {
    const said = swapBlock({ route: safeOut, usd, most: 100 })!;
    assert.equal(said, SWAP_WORDS.safeSwapLeast, `$${usd}`);
    assert.deepEqual(said.match(/\$\d+(\.\d+)?/g), [`$${SAFE_LEG_MIN_USD.toFixed(2)}`], "one figure only");
  }
  assert.equal(SWAP_WORDS.safeSwapLeast, "Swaps start at $2.09.", "the UI reviewer's ruling, 6 Nov");
  assert.equal(swapBlock({ route: { kind: "safe" }, usd: 2, most: 100 }), SWAP_WORDS.safeSwapLeast, "inside the Safe: the same words");
  assert.equal(swapBlock({ route: safeOut, usd: 2.09, most: 100 }), null, "control: at the least, no refusal");
  const nearOut: SwapRoute = { kind: "topup", coin: "USDC", to: "near" };
  assert.equal(swapBlock({ route: nearOut, usd: 1.5, most: 100 }), SWAP_WORDS.least, "control: the Safe → the NEAR wallet's least is $2, said as $2");
  assert.equal(floorOf(safeOut).under, SWAP_WORDS.safeSwapLeast);
  assert.ok(!("leastFromSafe" in SWAP_WORDS) && !("leastInSafe" in SWAP_WORDS), "the standing lines are gone");
});

test("rule 8: Send's first payment names who, the wallet it comes from, and the next step (the copy review's words; controls: another warn, a repeat)", () => {
  const sol = "First time paying this Solana address.";
  assert.equal(firstPayLine(sol, { place: "your Safe", safe: true }), "First payment to this Solana address. It comes from your Safe. Check the address, then approve.");
  assert.equal(firstPayLine(sol, { place: "your SOL wallet", safe: false }), "First payment to this Solana address, from your SOL wallet. Check the address; the next one will be quicker.");
  assert.equal(firstPayLine("First time paying this Robinhood Chain address.", { place: "your ETH (RH) wallet", safe: false }), "First payment to this Robinhood Chain address, from your ETH (RH) wallet. Check the address; the next one will be quicker.", "the chain and the wallet come from the data");
  assert.equal(firstPayLine("First time paying kim.near.", { place: "your Safe", safe: true }), "First payment to kim.near. It comes from your Safe. Check the address, then approve.");
  assert.equal(firstPayLine("First time paying kim.near.", { place: "your NEAR wallet", safe: false }), "First payment to kim.near, from your NEAR wallet. Check the address; the next one will be quicker.");
  assert.match(firstPayLine("First time paying kim.near. It runs code: it's an app, not a person's wallet.", { place: "your Safe", safe: true })!, /^First payment to kim\.near\. It runs code: it's an app, not a person's wallet\. It comes from your Safe\. Check the address, then approve\.$/);
  for (const safe of [true, false]) assert.doesNotMatch(firstPayLine(sol, { place: "x", safe })!, /paying this/, "never 'paying this address' once it's sent");
  assert.equal(firstPayLine("NEAR didn't answer, so AgentZero couldn't check kim.near.", { place: "your Safe", safe: true }), null, "control: another warn keeps its own words");
  assert.equal(firstPayLine("You've paid kim.near before. Nothing changed.", { place: "your Safe", safe: true }), null, "control: a repeat payment says nothing new");
  const sheet = src("./SendSheet.tsx");
  assert.match(sheet, /const first = firstPayLine\(check\.line, \{ place: a\.source\.place, safe: !a\.source\.row \}\);/);
  assert.match(sheet, /setWarn\(\{ text: first \?\? check\.line, kept: !!first && !!a\.source\.row \}\);/, "a wallet's line stays on the receipt; the Safe's goes once approved");
});

test("S2 (the build's trace): a refused swap clears \"Job created.\" and says the refusal; train 10's runJob decides the row (control: a No on the sheet makes nothing)", async () => {
  const sheet = src("./SwapSheet.tsx");
  assert.match(sheet, /made: \(\) => \{ sayWent\(""\); setMade\(said\); setBusy\(false\); \},/);
  assert.match(sheet, /if \("refused" in end\) \{ mark\("refused"\); setMade\(null\); return void \(saidOnSheet\(end\.refused\) \? setStopped\(end\.refused\) : problem\(end\.refused, onUsd\)\); \}/);
  assert.match(sheet, /if \("problem" in end\) \{ mark\("refused"\); setMade\(null\); return void \(saidOnSheet\(end\.problem\) \? setStopped\(end\.problem\) : problem\(end\.problem, onUsd\)\); \}/, "refused after the job existed: the row says why (runJob), and the sheet too");
  assert.match(sheet, /if \("declined" in end\) return setMade\(null\);/, "control: a No makes nothing");
  // train 10 wins (ask-first runJob): the sheet never makes a second row of its own; a refusal before the Safe's yes
  // takes the tap's job away, after it the row ends stopped with the refusal's words
  assert.doesNotMatch(sheet, /startJob\(/, "no second row from the sheet");
  const run = src("../../../../shell-api/src/job-run.ts");
  assert.match(run, /if \(made && a\.safe && !yes\) \{ made\.gone\(\); return \{ refused: r\.problem \}; \}/);
  assert.match(run, /if \(made\) \{ made\.failed\(/);
});

test("S2 (the build's trace): a Safe → wallet swap Private pays names Private, never \"leaves your Safe\" (control: the grid's own line on the public leg; E7 and the NEAR wallet say nothing)", () => {
  const sol: SwapRoute = { kind: "topup", coin: "USDC", to: "sol" };
  assert.equal(swapStays(sol, 25), "$25.00 leaves Private. If Private is short, your Safe covers the rest.");
  assert.doesNotMatch(swapStays(sol, 25, (u) => u + 1)!, /leaves your Safe/);
  assert.equal(swapStays(sol, 25, (u) => u + 1, false), "Your Safe sends $26.00. $1.00 stays in Private.", "control: the public leg's round-up (Move's line, the copy review's words)");
  assert.equal(swapStays({ kind: "topup", coin: "USDC", to: "near" }, 25), null, "control: into the NEAR wallet");
  assert.equal(swapStays({ kind: "safe" }, 25), null, "control: E7 pays from the Safe itself");
  assert.equal(PRIVATE_PAYS, true);
  assert.match(src("../../../../trade/src/runtime.ts"), /fromPrivate: true,/, "the app pays a Safe → wallet Add from Private (the data PRIVATE_PAYS mirrors)");
});

test("53: \"1Click\" is never said on screen; a NEAR Intents outage says its own name (control: the bridge keeps its name)", async () => {
  const { SERVICE_NAMES } = await import("@zerofee/core/services");
  assert.equal(SERVICE_NAMES.oneclick, "NEAR Intents");
  assert.equal(SERVICE_NAMES.bridge, "NEAR Intents' bridge");
});
