// QA's Sim re-check (QA, 5 Nov, item 5 Jobs), the three MUSTs, each with its control. No wall clock: every
// time is an injected number.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../../types.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";
import { LEG_SEC, legsEndsAt, sendLegs, sendSec } from "@zerofee/shell-api/job-steps.ts";
import { earlierOf } from "@zerofee/shell-api/task-earlier.ts";
import { moveTrack, onLegs, sendTrack, swapCame, type Folded } from "./live-steps.ts";
import { withTrackSteps, spendingPage } from "../proof.ts";
import { activityRows, onScreen } from "../activity-rows.ts";

const T = Date.UTC(2026, 10, 5, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const swapRow = (o: Partial<SpendingActivity> = {}): SpendingActivity => ({ id: "mv-swap", kind: "top-up", usd: "10.00", status: "on-its-way", shown: true, atIso: iso(T), words: "Moving $10.00 to your SOL wallet", goesTo: ["sol"], via: "private", paid: ["pocket-send:a"], ...o });
const SWAP = "Swap $10 of USDC for SOL";

test("(a) a running Swap's job shows every step, the protocol named in its own voice, each waiting for its read (control: one step before)", () => {
  const t = moveTrack(swapRow() as Folded, SWAP, "0.0644 SOL")!;
  assert.deepEqual(t.steps.map((s) => [s.label, s.state]), [
    ["NEAR Intents is swapping it for SOL.", "doing"],
    ["Then Solana lands it in your SOL wallet.", "waiting"],
  ]);
  // never "Each chain": several wallets, one landing line per chain, each ticking on its own wallet's read
  const two = moveTrack(swapRow({ goesTo: ["sol", "hood"], paidDone: true, landed: ["hood"], words: "Moving $20.00 to your wallets", usd: "20.00" }) as Folded)!;
  assert.deepEqual(two.steps.map((s) => [s.label, s.state]), [["NEAR Confidential paid your wallets.", "done"], ["Solana is landing it in your SOL wallet.", "doing"], ["It's in your ETH (RH) wallet.", "done"]]);
  assert.ok(two.steps.every((s) => !/Each chain/.test(s.label)), "control");
  // NEAR Confidential's word that it paid ticks the swap, never the landing (that waits on the SOL wallet's read)
  const paid = moveTrack(swapRow({ paidDone: true }) as Folded, SWAP, "0.0644 SOL")!;
  assert.deepEqual(paid.steps.map((s) => s.state), ["done", "doing"]);
  assert.equal(paid.end, undefined, "no Done before the chain read");
  const done = moveTrack(swapRow({ status: "done", landed: ["sol"], paidDone: true }) as Folded, SWAP, "0.0644 SOL")!;
  assert.deepEqual(done.steps.map((s) => [s.label, s.state]), [["NEAR Intents swapped it for SOL.", "done"], ["It's in your SOL wallet.", "done"]]);
  assert.equal(done.end?.line, swapCame("0.0644 SOL", "your SOL wallet"));
  // a Move with the Safe's fill: three steps, in order
  const fill = moveTrack(swapRow({ fill: "doing", words: "Moving $50.00 to your SOL wallet", usd: "50.00" }) as Folded)!;
  assert.deepEqual(fill.steps.map((s) => [s.label, s.state]), [
    ["NEAR Confidential is moving money from your Safe to Private.", "doing"],
    ["Then NEAR Confidential pays your SOL wallet.", "waiting"],
    ["Then Solana lands it in your SOL wallet.", "waiting"],
  ]);
  // a stop names its step
  const back = moveTrack(swapRow({ status: "refunded", fill: "done", note: "NEAR Confidential sent it back" }) as Folded)!;
  assert.deepEqual(back.steps.map((s) => s.state), ["done", "failed", "waiting"]);
});

test("(a) the ended job's page lists the same steps (From / To / Finished, no steps); control: a one-step track keeps the page as it was", () => {
  const r = swapRow({ status: "done", landed: ["sol"], paidDone: true });
  const t = moveTrack(r as Folded, SWAP, "0.0644 SOL")!;
  const page = withTrackSteps(spendingPage(r), t);
  assert.deepEqual(page.steps.map((s) => s.label), ["NEAR Intents swapped it for SOL.", "It's in your SOL wallet."]);
  assert.ok(page.steps.every((s) => s.ended || s.end), "each step ticked");
  const one = withTrackSteps(spendingPage(r), { startMs: T, steps: [{ label: "x", state: "done" }] });
  assert.deepEqual(one.steps.map((s) => s.label), spendingPage(r).steps.map((s) => s.label), "control");
});

test("(a) the tracker never draws a period then the dots (\"wallet.…\")", async () => {
  const { readFileSync } = await import("node:fs");
  // the page's step labels are job-face.ts's now (the copy review's ruling, 6 Nov: each step once with its one word)
  const src = readFileSync(new URL("./job-face.ts", import.meta.url), "utf8");
  assert.match(src, /x\.state === "doing" && !word \? `\$\{x\.label\.replace\(\/\\\.\$\/, ""\)\}…`/);
});

const send = (o: Partial<Movement> = {}): Movement => ({ id: "pocket-send:s1", kind: "pay", status: "moving", from: "private", to: "bob.near", amount: "1.1286", startedAtIso: iso(T), updatedAtIso: iso(T), explorerUrls: [], private: true, ...o } as Movement);

test("(b) a Send to a NEAR account counts NEAR's own transfer, not a chain's payout (Sim: \"58 s left\", then Done at once); control: a chain payee keeps its route", () => {
  assert.equal(sendSec({ toNear: true }), LEG_SEC.privateNear);
  assert.ok(sendSec({ toNear: true }) <= 10, "a NEAR transfer");
  assert.equal(sendSec({ toNear: false }), LEG_SEC.safeToChain, "control");
  assert.equal(sendSec({ row: "sol", toNear: false }), LEG_SEC.safeToChain + LEG_SEC.chainIn, "control");
  assert.equal(sendLegs({ toNear: true }).reduce((n, s) => n + s, 0), sendSec({ toNear: true }), "one model: the receipt's time is the legs' sum");
});

test("(b) the Send's time left comes from its legs and its read: Done only on the read, the end re-counted from the last tick", () => {
  const going = onLegs(sendTrack(send({ from: "private" }), "private", "bob.near")!);
  assert.equal(going.endsAt, T + LEG_SEC.privateNear * 1000, "the receipt's figure at the start");
  assert.equal(going.end, undefined);
  assert.deepEqual(going.steps.map((s) => s.state), ["doing", "waiting"]);
  assert.deepEqual(going.steps.map((s) => s.label), ["Leaving Private", "Then NEAR Confidential pays bob.near."], "53: a step not begun says Then; J2-4: one paying step, never bare NEAR");
  // its first step ticked 3 s in (stamped): the end is counted from there
  const ticked = onLegs({ ...sendTrack(send({ explorerUrls: ["https://nearblocks.io/txns/abc"] }), "private", "bob.near")!, steps: [{ label: "Left", state: "done", atMs: 3000 }, { label: "NEAR Confidential is paying bob.near.", state: "doing" }] });
  assert.equal(ticked.endsAt, T + 3000 + (LEG_SEC.privateNear - 0) * 1000);
  const paying = sendTrack(send({ explorerUrls: ["https://nearblocks.io/txns/abc"], to: "0x7D06AaAAaAaaa5aAAAaAaAaAAAAAaaaaaAaA7E3D" }), "private", "0x7D06Aa…aA7E3D")!;
  assert.equal(paying.steps[1]!.label, "NEAR Confidential is paying 0x7D06Aa…aA7E3D.", "the copy review's Send line");
  const done = onLegs(sendTrack(send({ status: "done", updatedAtIso: iso(T + 2000) }), "private", "bob.near")!);
  assert.equal(done.end?.ok, true, "Done from the ledger's read");
  assert.equal(done.endsAt, undefined, "an ended job has no time left");
  // control: a movement with NEAR Intents' own quote keeps it
  const quoted = onLegs(sendTrack(send({ etaSeconds: 7 }), "private", "bob.near")!);
  assert.equal(quoted.endsAt, T + 7000);
});

test("(b) a Move paid from Private says what Private -> Solana takes (Sim: \"1 min\", done in 18-30 s) and shrinks as its steps tick", () => {
  assert.ok(LEG_SEC.privateOut <= 30, "never the old minute");
  const t = moveTrack(swapRow({ words: "Moving $50.00 to your SOL wallet", usd: "50.00" }) as Folded)!;
  assert.equal(onLegs(t).endsAt, T + LEG_SEC.privateOut * 1000, "the receipt's figure (move-split legTime)");
  // NEAR Confidential paid at 12 s: only the landing's read is left
  const paid = moveTrack(swapRow({ words: "Moving $50.00 to your SOL wallet", usd: "50.00", paidDone: true }) as Folded)!;
  const stamped = { ...paid, steps: paid.steps.map((s, i) => (i === 0 ? { ...s, atMs: 12_000 } : s)) };
  assert.equal(onLegs(stamped).endsAt, T + 12_000 + LEG_SEC.read * 1000);
  // control: legsEndsAt with nothing ticked is the start plus every leg
  assert.equal(legsEndsAt(T, [{ state: "doing" }, { state: "waiting" }], [5, 4]), T + 9000);
  assert.equal(legsEndsAt(NaN, [{ state: "doing" }], [5]), undefined);
});

test("(c) a running Swap is one row: its live card, not also a Money row; ended, the record row is back (control)", () => {
  const record = activityRows([], [swapRow({ atIso: iso(T) })]);
  assert.equal(record.spending.length, 1, "the record keeps it (the Statement)");
  assert.equal(onScreen(record, T + 5000).spending.length, 0, "going: its card is the one row");
  const ended = activityRows([], [swapRow({ status: "done", landed: ["sol"], paidDone: true })]);
  assert.equal(onScreen(ended, T + 5000).spending.length, 1, "control: ended, the row");
  // a Send going is its card too; done, its row
  assert.equal(onScreen({ ledger: [send()], spending: [] }, T + 1000).ledger.length, 0);
  assert.equal(onScreen({ ledger: [send({ status: "done" })], spending: [] }, T + 1000).ledger.length, 1, "control");
  // one gone slow leaves Now, so it stays a row
  assert.equal(onScreen(record, T + 16 * 60_000).spending.length, 1, "control: slow");
});

test("(c) a memecoin trade is one row: Trade's history row while it is drawn, not also an Ended card (control: Trade not drawn keeps the card)", () => {
  const trade: Task = { id: "buy-sol-abc", app: "trade", title: "Buy $5 of JEANPHIL", steps: [], state: "done", startedAt: T, endedAt: T + 500 };
  assert.deepEqual(earlierOf([trade], true, new Set(["trade"])).map((t) => t.id), [], "Trade's history drawn");
  assert.deepEqual(earlierOf([trade], true, new Set()).map((t) => t.id), ["buy-sol-abc"], "control");
  const failed = { ...trade, id: "buy-sol-bad", state: "failed" as const };
  assert.deepEqual(earlierOf([failed], true, new Set(["trade"])).map((t) => t.id), ["buy-sol-bad"], "one that didn't finish has no record there");
});

test("(c) Activity draws the screen's rows, and opens a going job's page from the whole record", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(src, /const record = activityRows\(activity, all, carriedJob\);\n\s+const \{ ledger, spending: moves \} = onScreen\(record, Date\.now\(\), ends, going\);/);
  assert.match(src, /record\.spending\.find\(\(x\) => x\.id === id \|\| !!x\.parts\?\.some\(\(p\) => p\.id === id\)\)/);
});

test("the copy review's words (5 Nov): a step not begun says Then, plainly; a Send's payee is its short address or its name, never \"a Solana wallet\" (control: a name stays a name)", async () => {
  const { JOB_STEP_WORDS, privateMoveSteps: pms } = await import("@zerofee/shell-api/job-steps.ts");
  const { payeeWords } = await import("../format.ts");
  assert.equal(pms(["sol"], { fill: true })[0]!.next, "Then your Safe fills Private.");
  assert.equal(JOB_STEP_WORDS.safe.next, "Then you approve on your iPhone.", "the web's (approveStep has the app's)");
  assert.equal(JOB_STEP_WORDS.checking.next, "Then NEAR confirms your Safe sent it.");
  const addr = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
  const payee = payeeWords(`${addr} on Solana`);
  assert.equal(payee, "0x7D06e2…547e3D");
  const t = sendTrack(send({ to: `${addr} on Solana`, toChain: "sol" }), "private", payee)!;
  assert.deepEqual(t.steps.slice(1).map((s) => s.label), ["Then NEAR Confidential pays 0x7D06e2…547e3D.", "Then Solana pays 0x7D06e2…547e3D."]);
  assert.ok(t.steps.every((s) => !/a Solana wallet| with /.test(s.label)), "never 'a Solana wallet', never 'with' (the swap word)");
  assert.equal(payeeWords("bob.near"), "bob.near", "control");
});

test("the copy review's ruling (5 Nov): the Safe's approval by device, Face ID in the iPhone app, \"on your iPhone\" on the web or a laptop (control: the device is read, never assumed)", async () => {
  const { approveStep, safeMoveSteps, startingStep } = await import("@zerofee/shell-api/job-steps.ts");
  const { onPhone } = await import("@zerofee/shell-api/approval-words.ts");
  const { JOB_WORDS } = await import("@zerofee/shell-api/job-start.ts");
  assert.deepEqual([approveStep(true).doing, approveStep(true).next], ["Approve with Face ID.", "Then you approve with Face ID."]);
  assert.deepEqual([approveStep(false).doing, approveStep(false).next], ["Approve on your iPhone.", "Then you approve on your iPhone."]);
  assert.equal(safeMoveSteps(["sol"], { phone: true })[0]!.doing, "Approve with Face ID.");
  assert.equal(startingStep(false), "Approve on your iPhone.");
  // control: the default reads the page (onPhone): node has no iPhone app host, so the web's words
  assert.equal(onPhone(), false);
  assert.equal(approveStep().doing, "Approve on your iPhone.");
  assert.equal(JOB_WORDS.approve, "Approve on your iPhone.");
  assert.equal(onPhone({ webkit: { messageHandlers: { zerofee: {} } } }), true, "the app's own host");
});

test("the copy review's ruling (5 Nov): AgentZero's sentence names a payee's kind and its short address; rows keep the bare short address (control: a name stays a name)", async () => {
  const { payeeInSentence, payeeWords } = await import("../format.ts");
  const addr = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
  assert.equal(payeeInSentence(`${addr} on Solana`), "a Solana wallet (0x7D06e2…547e3D)");
  assert.equal(payeeInSentence(`${addr} on Ethereum`), "an Ethereum wallet (0x7D06e2…547e3D)");
  assert.equal(payeeWords(`${addr} on Solana`), "0x7D06e2…547e3D", "rows and receipts: the bare short address");
  assert.equal(payeeInSentence(addr), "0x7D06e2…547e3D", "no network named: the short address");
  assert.equal(payeeInSentence("bob.near"), "bob.near", "control");
});
