// the copy review's receipt items (7 Nov, GRADES-A row 12 and 22, GRADES-B row 11, GRADES-C rows 20-22): the receipt says "Job created."
// once the Safe has signed (the owner's word), then what happened to the person from the job's own figures;
// a landed job says how long it took ("Done in under a second."), never "Landed early."; AgentZero's funding page puts
// the amounts first, its sheet says the amount, and its receipt says the money is in AgentZero's wallet only once a read
// shows it. Each table has its control; no wall clock (fixed figures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addWords, addedLine, agentFundLine, moveWhere, movingLine, receiptSaid, sendWords, sentLine, swappedLine, swappingLine } from "./receipt-said.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { TIME_WORDS, doneIn, receiptLeft, receiptStateOf } from "@zerofee/shell-api/job-steps.ts";
import { agentSheetTitle } from "@zerofee/shell-api/MockBridge.ts";
import { FROM_SAFE_LINE, FUND_READ_EVERY_MS, FUND_READ_SLACK_MS, fundLines, fundPage, fundShows, fundSlowLine, FUND_DETAILS_LABEL, readUntilShown } from "../../../../agent/src/app/fund-words.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const T = 1_800_000_000_000;

test("item 1: the line under \"Job created.\" is what happened, the copy review's words (control: an unpriced swap never makes a figure up)", () => {
  assert.equal(JOB_WORDS.created, "Job created.", "the owner's word stands (QA's relay, 7 Nov)");
  // changed pins (the audit's M8): the figure is the hero, said once
  assert.equal(sentLine("bob.near"), "Sent to bob.near.");
  assert.equal(swappedLine("0.2419 SOL", "your SOL wallet"), "About 0.2419 SOL is in your SOL wallet.");
  assert.equal(addedLine("$10.00", "pump.fun"), "Added $10.00 to your pump.fun wallet.");
  assert.equal(addedLine("$10.00", "GMGN", "Solana"), "Added $10.00 to your GMGN Solana wallet.");
  assert.equal(swappedLine(undefined, "your SOL wallet"), "It's in your SOL wallet.", "control: no figure");
  for (const l of [sentLine("bob.near"), swappedLine("0.2419 SOL", "your SOL wallet"), addedLine("$10.00", "pump.fun"), agentFundLine("$25.00", true), agentFundLine("$25.00", false)]) {
    assert.doesNotMatch(l, /NEAR Confidential|Solana lands|Job created|Landed/, l);
  }
});

test("item 1: each receipt's line is the job's own words: Send's payee, Swap's priced figure and wallet, the site's name (control: the head is still JOB_WORDS)", () => {
  const send = src("./SendSheet.tsx");
  assert.match(send, /setSentSaid\(sendWords\(toWho\)\); setFlying\(shown\);/, "Send: whom, as its job says it (the figure is the hero's alone, the audit's M8)");
  assert.match(send, /title: `Send \$\{said\}`/, "control: the same figures as the job's title");
  assert.match(send, /<JobReceipt amount=\{flying\} icon=\{<ActSend \/>\} testid="send-sent" etaSec=\{etaSec\} said=\{sentSaid\?\.going\} landedSaid=\{sentSaid\?\.landed\} job=\{flyingJob\} onDone=\{madeDone\} \/>/);
  assert.match(src("./SwapSheet.tsx"), /setMadeSaid\(\{ going: swappingLine\(SWAP_COIN\[pay\.place\]\.label, SWAP_COIN\[get\]\.label\), landed: swappedLine\(lands, SWAP_COIN\[get\]\.where\) \}\)/, "Swap: going, then the figure the sheet priced and where it lands");
  assert.match(src("../screens/MoveSheet.tsx"), /\{movingLine\(madeTo\(legs\.map\(\(l\) => l\.to\)\), job\.state === "landed"\)\}/, "Move: J5's line");
  assert.match(src("./SiteMoney.tsx"), /<SaidLine testid="site-add-said" \{\.\.\.addWords\(made, name, network\)\} job=\{madeJob\} \/>/);
  assert.match(src("./JobMade.tsx"), /<p className="zf-receipt__head">\{JOB_WORDS\.created\}<\/p>/);
});

test("item 3: a landed job says how long it took, early or late; never \"Landed early.\" (controls: still going, the time left; no start known, the old past-estimate words)", () => {
  assert.equal(doneIn(430), "Done in under a second.");
  assert.equal(doneIn(999), "Done in under a second.");
  assert.equal(doneIn(1_000), "Done in 1 second.");
  assert.equal(doneIn(12_300), "Done in 13 seconds.");
  assert.equal(doneIn(150_000), "Done in 3 min.");
  assert.equal(TIME_WORDS.underSecond, "Done in under a second.");
  assert.ok(!Object.values(TIME_WORDS).includes("Landed early." as never), "the word is gone");
  const endsAt = T + 240_000;
  assert.equal(receiptLeft(endsAt, T + 600_000, T, T + 430), "Done in under a second.", "landed early");
  assert.equal(receiptLeft(endsAt, T + 600_000, T, T + 270_000), "Done in 5 min.", "landed late: how long, never a frozen \"Almost there.\"");
  assert.equal(receiptLeft(endsAt, T + 60_000, T, undefined), "About 3 min left.", "control: still going");
  assert.equal(receiptLeft(T + 30_000, T), "About 30 seconds left.", "the copy review's J5: seconds in words");
  assert.equal(receiptLeft(T + 1_000, T), "About 1 second left.");
  assert.equal(receiptLeft(endsAt, T + 600_000, T, undefined), TIME_WORDS.slow, "control: still going at twice its estimate");
  assert.equal(receiptLeft(endsAt, T + 600_000, undefined, T + 270_000), TIME_WORDS.almost, "control: no start known");
});

test("item 5: AgentZero's funding says it is in its wallet only once a read shows it (controls: unread, less, nothing asked)", () => {
  assert.equal(fundShows(25, 25), true);
  assert.equal(fundShows(50, 50.001), true);
  assert.equal(fundShows(25, 20), false, "the read shows less: capped by the Safe's USDC");
  assert.equal(fundShows(25, null), false, "unread");
  assert.equal(fundShows(25, undefined), false, "unread");
  assert.equal(fundShows(0, 0), false, "nothing asked");
  assert.equal(agentFundLine("$25.00", true), "$25.00 is in AgentZero's wallet.");
  assert.equal(agentFundLine("$25.00", false), "Adding $25.00 to AgentZero's wallet.", "control: going, not yet read: never the past");
  const app = src("../../../../agent/src/app/AgentApp.tsx");
  assert.match(app, /const seen = await read\(\);\n[^\n]*\n\s*if \(f\) void readUntilShown\(usd, seen\?\.limitUsd, /, "landed on the read, never the answer alone");
  assert.doesNotMatch(app, /if \("ok" in r && r\.ok\.status === "done"\) fundedLanded\(\);/, "control: the old landed-on-the-answer");
  assert.match(app, /data-testid="az-fund-said">\{funded\.slow \? fundSlowLine\(funded\.amount\) : agentFundLine\(funded\.amount, funded\.landedAt !== undefined\)\}/);
});

test("item 5: the Sim's AgentZero sheet's headline is the amount it adds (controls: a list change adds nothing, the old words)", () => {
  assert.equal(agentSheetTitle("account.agent.set", 25, 0), "Add $25.00 to AgentZero's wallet");
  assert.equal(agentSheetTitle("account.agent.setBudget", 50, 25), "Add $25.00 to AgentZero's wallet");
  assert.equal(agentSheetTitle("account.agent.setBudget", 25, 25), "Add money to AgentZero's wallet", "control: adds nothing");
  assert.equal(agentSheetTitle("account.agent.set", Number.NaN, 0), "Turn on AgentZero", "control: no figure");
});

test("item 5: the funding page: the amounts first, three plain lines, the rest one tap away and nothing lost (control: every old line is in the details)", () => {
  const w = fundPage();
  assert.deepEqual(w.lines, ["AgentZero spends only what you put here.", "A job usually costs under $0.06.", "You can take it back any time."]);
  assert.equal(FUND_DETAILS_LABEL, "How is this priced?");
  const old = fundLines();
  for (const l of [old.what[2]!, ...old.cost.slice(1), ...old.who]) assert.ok(w.details.includes(l), l);
  const app = src("../../../../agent/src/app/AgentApp.tsx");
  const page = app.slice(app.indexOf('{sheet?.kind === "pocket" && ('), app.indexOf("{/* funding is a job"));
  const chips = page.indexOf('role="radiogroup" aria-label="How much"'), lines = page.indexOf('data-testid="ag-fund-lines"'), more = page.indexOf("<More label={FUND_DETAILS_LABEL}");
  assert.ok(chips > 0 && lines > chips && more > lines, "the chips, then the three lines, then the details");
  assert.doesNotMatch(page, /What a job costs|Who you pay/, "control: no three screens of text");
});

test("the copy review's J5: Swap says it is swapping while it goes, swapped once landed; Move names where it goes (controls: one place, the Safe, Private)", () => {
  assert.equal(swappingLine("USDC", "SOL"), "Swapping USDC for SOL.");
  assert.equal(movingLine(moveWhere(["SOL", "ETH (RH)"]), false), "Moving it to your SOL and ETH (RH) wallets.");
  assert.equal(movingLine(moveWhere(["SOL", "ETH (RH)", "NEAR"]), false), "Moving it to your SOL, ETH (RH) and NEAR wallets.");
  assert.equal(moveWhere(["SOL", "SOL"]), "your SOL wallet", "control: one wallet");
  assert.equal(moveWhere(["Safe"]), "your Safe", "control: the Safe");
  assert.equal(moveWhere(["Private"]), "Private", "control: never \"your Private wallet\"");
  assert.equal(moveWhere([]), "your wallets", "control: none known");
  assert.equal(movingLine("your Safe", true), "Moved to your Safe.");
});

test("the copy review (7 Nov): where the Safe pays, the details say so, never \"never spends from your Safe\" (control: a real account's NEAR wallet fill keeps the wallet's own rule)", () => {
  assert.equal(FROM_SAFE_LINE, "You add money from your Safe. AgentZero spends only what is in its own wallet.");
  assert.equal(fundPage(true).details[0], FROM_SAFE_LINE);
  assert.ok(!fundPage(true).details.some((l) => /never spends from your Safe/.test(l)));
  assert.equal(fundPage(false).details[0], fundLines().what[2], "control");
  assert.match(src("../../../../agent/src/app/AgentApp.tsx"), /const w = fundPage\(pocketHere\);/);
});

test("the audit's SHOULD: the fund receipt reads again until its estimate plus the slack: shown on try 2, done; never shown, the slow face, bounded (control: shown at once, no second read)", async () => {
  const run = async (reads: (number | null)[], first: number | null) => {
    let now = 0, n = 0;
    const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
    const r = await readUntilShown(25, first, async () => reads[n++] ?? null, 10_000, clock);
    return { r, n, now };
  };
  assert.deepEqual(await run([25], null), { r: "shown", n: 1, now: FUND_READ_EVERY_MS }, "try 2 shows it");
  const never = await run([], null);
  assert.equal(never.r, "slow", "never shown: the slow face");
  assert.ok(never.now <= 10_000 + FUND_READ_SLACK_MS && never.now > 10_000 + FUND_READ_SLACK_MS - 2 * FUND_READ_EVERY_MS, `bounded: stops by the estimate plus the slack (${never.now} ms)`);
  assert.equal(never.n, never.now / FUND_READ_EVERY_MS, "one read per wait");
  assert.deepEqual(await run([], 25), { r: "shown", n: 0, now: 0 }, "control: the first read shows it");
  assert.equal(fundSlowLine("$25.00"), "$25.00 isn't in AgentZero's wallet yet. Home shows where your money is.");
  const app = src("../../../../agent/src/app/AgentApp.tsx");
  assert.match(app, /\{watchShown\(funded\.landedAt\) && !funded\.slow && /, "the slow face drops \"It keeps going\"");
  assert.match(app, /funded\.slow \? TIME_WORDS\.slow : receiptLeft/);
});

test("QA's MUST: the line's tense follows the job's chain read: going, the present; landed, the past; stopped or unsure, the present and its own stop words, never the past", () => {
  const send = sendWords("bob.near"), add = addWords("$10.00", "pump.fun");
  const swap = { going: swappingLine("USDC", "SOL"), landed: swappedLine("0.2419 SOL", "your SOL wallet") };
  const table: [typeof send, Parameters<typeof receiptSaid>[1], string][] = [
    [send, { state: "going" }, "Sending it to bob.near."],
    [send, { state: "landed" }, "Sent to bob.near."],
    [send, { state: "stopped", words: "NEAR said no. Your money is in your Safe." }, "Sending it to bob.near. NEAR said no. Your money is in your Safe."],
    [send, { state: "unsure", words: "Your money is either in Private or still with NEAR Intents." }, "Sending it to bob.near. Your money is either in Private or still with NEAR Intents."],
    [send, { state: "stopped" }, "Sending it to bob.near."],
    [add, { state: "going" }, "Adding $10.00 to your pump.fun wallet."],
    [add, { state: "landed" }, "Added $10.00 to your pump.fun wallet."],
    [add, { state: "stopped", words: "Solana said no." }, "Adding $10.00 to your pump.fun wallet. Solana said no."],
    [swap, { state: "going" }, "Swapping USDC for SOL."],
    [swap, { state: "landed" }, "About 0.2419 SOL is in your SOL wallet."],
    [swap, { state: "unsure", words: "x" }, "Swapping USDC for SOL. x"],
  ];
  for (const [w, s, want] of table) assert.equal(receiptSaid(w, s), want, `${s.state}`);
  for (const [w, s] of table) if (s.state !== "landed") assert.doesNotMatch(receiptSaid(w, s), /^(Sent|Added)|swapped:/, "control: never the past before landed");
});

test("QA's MUST: the receipt's state is its rows' own: all done, landed; one failed or stopped, its words (unsure when they say either place); else going (controls: the tap's handed-over row, an old row)", () => {
  const T = 1_800_000_000_000;
  const job = { id: "job:abc", state: "done", startedAt: T, endedAt: T + 1_000 };
  assert.deepEqual(receiptStateOf([job], T), { state: "going" }, "only the handed-over starting row: going");
  assert.deepEqual(receiptStateOf([job, { id: "move:a", state: "pending", startedAt: T + 900 }], T), { state: "going" });
  assert.deepEqual(receiptStateOf([job, { id: "move:a", state: "done", startedAt: T + 900, endedAt: T + 9_000 }], T), { state: "landed", at: T + 9_000 });
  assert.deepEqual(receiptStateOf([job, { id: "move:a", state: "failed", startedAt: T + 900, endedAt: T + 9_000, detail: "NEAR said no." }], T), { state: "stopped", words: "NEAR said no." });
  assert.deepEqual(receiptStateOf([job, { id: "move:a", state: "failed", startedAt: T + 900, endedAt: T + 9_000, detail: "Your money is either in Private or still with NEAR Intents." }], T), { state: "unsure", words: "Your money is either in Private or still with NEAR Intents." });
  assert.deepEqual(receiptStateOf([{ id: "job:abc", state: "failed", startedAt: T, endedAt: T + 400, detail: "Not enough in Private." }], T), { state: "stopped", words: "Not enough in Private." }, "a refusal before the core answered");
  assert.deepEqual(receiptStateOf([job, { id: "move:a", state: "done", startedAt: T + 900, endedAt: T + 9_000 }, { id: "move:b", state: "failed", startedAt: T + 900, endedAt: T + 9_500 }], T), { state: "stopped" }, "one part stopped: never landed");
  assert.deepEqual(receiptStateOf([{ id: "move:old", state: "failed", startedAt: T - 60_000, endedAt: T - 1_000 }], T), { state: "going" }, "control: a row from before the receipt");
});
