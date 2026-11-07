// the audit's MUST (7 Nov): a done Send's job page said "Your money is here: your wallet" while the money was with the payee
// (job-face moneyLine's done branch took the place from the title's " to (your …)$", else "your wallet"); a Safe Swap's
// end the same. The done place now comes from the job's own record (donePlace), and nothing is said where nothing places
// it. the audit's SHOULD, same file: the core's unsure words name any place ("either in your Safe or still with NEAR Intents",
// convertFailed), never Private alone, so such an end never reads "on its way". Each table fails on the old job-face.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { problemLine } from "@zerofee/core/services";
import type { Movement } from "../../types.ts";
import { walletProblems } from "../../wallet-problems.ts";
import { moveTrack, rowWallets, sendTrack, startingTracks, type LiveTrack } from "./live-steps.ts";
import { donePlace, jobFace } from "./job-face.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";

const T0 = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
const mv = (o: Partial<Movement>): Movement => ({ id: "s1", kind: "pay", status: "done", amount: "5000000", startedAtIso: iso(T0), updatedAtIso: iso(T0 + 30_000), explorerUrls: ["https://nearblocks.io/txns/abc"], to: "payee.near", private: true, ...o });
const swap = (wallets: string[]): LiveTrack => ({ id: "swap:x", kind: "swap", title: "Swap $5.00 of SOL for USDC", wallets, startMs: T0, steps: [{ label: "NEAR Intents swapped it.", state: "done" }], end: { ok: true, line: "" } });

test("the audit's MUST: a done Send to an outside payee says \"Sent to payee.near.\", never \"your wallet\" (from the Safe, from a wallet, private or not)", () => {
  for (const [from, priv] of [["safe", true], ["safe", false], ["sol", true], ["private", true]] as const) {
    const t = sendTrack(mv({ private: priv }), from, "payee.near", "$5.00")!;
    const f = jobFace(t);
    assert.equal(f.state, "done", `${from} ${priv}`);
    // the copy review's words (7 Nov): the plain past, the payee in the place's slot (--ink, 600)
    assert.deepEqual(f.money, { lead: "Sent to ", place: "payee.near", after: "." }, `${from} ${priv}`);
    assert.equal(`${f.money!.lead}${f.money!.place}${f.money!.after}`, "Sent to payee.near.");
    assert.doesNotMatch(`${f.money!.lead}${f.money!.place}`, /your wallet|here|Your money is with/, `${from} ${priv}`);
  }
  // the address a person pasted (payeeWords' short form) is the place too
  assert.equal(jobFace(sendTrack(mv({ to: "0x7D06…7e3D" }), "safe", "0x7D06…7e3D", "$5.00")!).money?.place, "0x7D06…7e3D");
});

test("the audit's MUST: a done Swap names the one wallet it ran in (a Safe coin's Buy or Sell: your Safe; a swap in place: your NEAR wallet); none known, no money line", () => {
  assert.deepEqual(jobFace(swap(["safe"])).money, { lead: "Your money is here: ", place: "your Safe" });
  assert.deepEqual(jobFace(swap(["near"])).money, { lead: "Your money is here: ", place: "your NEAR wallet" });
  assert.deepEqual(jobFace(swap(["sol"])).money, { lead: "Your money is here: ", place: "your SOL wallet" });
  // nothing places it: no line at all (the old face said "your wallet")
  assert.equal(jobFace(swap([])).money, undefined);
  assert.equal(jobFace(swap(["sol", "near"])).money, undefined, "two wallets: the record doesn't say which, so no guess");
  // the starting rows say where they run, by their id (the page opened from Activity after a reload)
  const task = (app: Task["app"], id: string): Task => ({ app, id, title: "Swap $5.00 of SOL for USDC", steps: [], state: "pending", startedAt: T0 });
  assert.deepEqual(rowWallets(task("trade", "native-sell-nep141:sol.omft.near-1")), ["safe"]);
  assert.deepEqual(rowWallets(task("home", "swap:home-swap-ab")), ["near"]);
  assert.deepEqual(rowWallets(task("home", "move:mv-k1")), [], "control: a Move's row is placed by its title");
  assert.deepEqual(startingTracks([task("trade", "native-buy-nep141:sol.omft.near-1")], T0)[0]!.wallets, ["safe"]);
});

test("control: a done Move still says the wallet it went to (its record, and its starting row's title); an unplaced Move says nothing", () => {
  const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "r1", kind: "top-up", usd: "5", status: "done", shown: true, atIso: iso(T0), words: "Move $5.00 to your SOL wallet", ...o });
  const done = jobFace(moveTrack(row({ via: "private", goesTo: ["sol"], landed: ["sol"], paidDone: true, askedUsd: "5" }), undefined, undefined)!);
  assert.deepEqual([done.state, done.money], ["done", { lead: "Your money is here: ", place: "your SOL wallet" }]);
  const started: LiveTrack = { id: "move:mv-k1", kind: "move", title: "Move $5.00 to your SOL wallet", wallets: [], startMs: T0, steps: [], end: { ok: true, line: "" } };
  assert.deepEqual(donePlace(started), { lead: "Your money is here: ", place: "your SOL wallet" });
  assert.equal(donePlace({ ...started, title: "Move $5.00" }), undefined, "several wallets, no record placing it: no guess");
});

test("the audit's SHOULD: the core's unsure words for any place say that place, never \"on its way\" (convertFailed for the Safe and for Private); control: plain words still place it", () => {
  const table: [string, string, string][] = [
    [problemLine(walletProblems.convertFailed())!, "your Safe", "Check your Safe first."],
    [problemLine(walletProblems.convertFailed("Private", "payment"))!, "Private", "Check Private first."],
  ];
  for (const [line, place, reason] of table) {
    const t: LiveTrack = { id: "swap:y", kind: "swap", title: "Swap $5.00 of SOL for USDC", wallets: [], startMs: T0, steps: [{ label: "NEAR Intents is swapping it", state: "failed" }], end: { ok: false, line } };
    const f = jobFace(t);
    // the copy review (7 Nov): one sentence with a capital, the place in its slot
    assert.deepEqual(f.money, { lead: "Either in ", place, after: " or still with NEAR Intents." }, line);
    assert.equal(f.reason, reason, line);
    assert.notEqual(f.money?.place, "on its way", line);
  }
  const plain: LiveTrack = { id: "swap:z", kind: "swap", title: "Swap", wallets: [], startMs: T0, steps: [{ label: "x", state: "failed" }], end: { ok: false, line: "It came back. It's back in your Safe." } };
  assert.deepEqual(jobFace(plain).money, { lead: "Your money is here: ", place: "your Safe" });
});
