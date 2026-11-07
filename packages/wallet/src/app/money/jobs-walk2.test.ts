// the copy review's walk of Activity (8 Nov), J2-4: the job pages' truth items, each with its control. No wall clock: every time is
// an injected number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../../types.ts";
import { moveTrack, sendTrack, type Folded, type LiveTrack } from "./live-steps.ts";
import { jobFace } from "./job-face.ts";
import * as paidFromMod from "./paid-from.ts";

const T = Date.UTC(2026, 10, 8, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const send = (o: Partial<Movement> = {}): Movement => ({ id: "safe-send:s1", kind: "pay", status: "moving", from: "nep141:usdc", to: "alice.near", amount: "25", startedAtIso: iso(T), updatedAtIso: iso(T), explorerUrls: [], private: true, ...o } as Movement);
const swapRow = (o: Partial<SpendingActivity> = {}): SpendingActivity => ({ id: "mv-swap", kind: "top-up", usd: "200.00", status: "on-its-way", shown: true, atIso: iso(T), words: "Moving $200.00 to your SOL wallet", goesTo: ["sol"], via: "private", paid: ["pocket-send:a"], ...o });
const SWAP = "Swap $200.00 of USDC for SOL";

test("J2-4: a Send to a NEAR account is one paying step, its payer named (never \"Then NEAR pays alice.near.\"); control: to another chain, that chain's own step stays", () => {
  const t = sendTrack(send(), "safe", "alice.near", "$25.00")!;
  const labels = t.steps.map((s) => s.label);
  assert.deepEqual(labels, ["Leaving your Safe", "Then NEAR Confidential pays alice.near."], "fails before: a third step \"Then NEAR pays alice.near.\"");
  assert.ok(labels.every((l) => !/(^|\s)NEAR (pays|is paying)\b/.test(l)), "bare NEAR never");
  const paid = sendTrack(send({ status: "done", updatedAtIso: iso(T + 6000) }), "safe", "alice.near", "$25.00")!;
  assert.deepEqual(paid.steps.map((s) => [s.label, s.state]), [["Left your Safe", "done"], ["Paid to alice.near", "done"]]);
  assert.equal(paid.steps[1]!.atMs, 6000, "its done time is the ledger's own");
  const sol = sendTrack(send({ toChain: "sol" } as Partial<Movement>), "safe", "7xKX…AsU", "$25.00")!;
  assert.equal(sol.steps.length, 3, "control");
  assert.equal(sol.steps[2]!.label, "Then Solana pays 7xKX…AsU.", "control: Solana pays it on");
});

test("J2-4: a Send's page says it once: bar \"Activity\", the figure, \"Send to alice.near\"; control: a stopped Send keeps its own bar and title, a Move keeps \"Move\"", () => {
  const f = jobFace(sendTrack(send(), "safe", "alice.near", "$25.00")!);
  assert.equal(f.bar, "Activity", "fails before: \"Send\" in the bar");
  assert.equal(f.figure, "$25.00");
  assert.equal(f.what, "Send to alice.near", "fails before: \"Send $25.00 to alice.near\" under \"$25.00\"");
  const problem = { code: "x", whatHappened: "1Click didn't pay it.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } };
  const stopped = jobFace(sendTrack(send({ status: "problem", explorerUrls: ["https://nearblocks.io/txns/abc"], problem: problem as never }), "safe", "alice.near", "$25.00")!);
  assert.equal(stopped.bar, "Send stopped", "control");
  assert.equal(stopped.what, "Send $25.00 to alice.near", "control");
  const move: LiveTrack = { id: "move:m", kind: "move", title: "Move $5.00 to your SOL wallet", wallets: ["safe", "sol"], startMs: T, steps: [{ label: "x", state: "doing" }] };
  assert.equal(jobFace(move).bar, "Move", "control");
  assert.equal(jobFace(move).what, "Move $5.00 to your SOL wallet", "control");
});

test("J2-4: a done Send's or Move's page says \"Done in N seconds.\" from its own start and end; control: going, or an end not its own, none", () => {
  const done = { ...sendTrack(send({ status: "done", updatedAtIso: iso(T + 6000) }), "safe", "alice.near", "$25.00")!, endMs: T + 6000 };
  assert.equal(jobFace(done).took, "Done in 6 seconds.", "fails before: no time on the done page");
  const move: LiveTrack = { id: "move:m", kind: "move", title: "Move $5.00 to your SOL wallet", wallets: ["safe", "sol"], startMs: T, endMs: T + 6000, steps: [{ label: "In your SOL wallet", state: "done" }], end: { ok: true, line: "In your SOL wallet." } };
  assert.equal(jobFace(move).took, "Done in 6 seconds.");
  assert.equal(jobFace({ ...move, endMs: -Infinity }).took, undefined, "control: a track first seen ended has no made-up time");
  assert.equal(jobFace(sendTrack(send(), "safe", "alice.near", "$25.00")!).took, undefined, "control: going");
  const page = src("./LiveTrack.tsx");
  assert.match(page, /\{f\.took && <p className="lv-job__left" data-testid="job-took">\{f\.took\}<\/p>\}/);
});

test("J2-4: a done Swap's money line says what came in, \"about\" with the quote (its record has no landed figure); control: no quote, the plain place line", () => {
  const done = moveTrack(swapRow({ status: "done", landed: ["sol"], paidDone: true }) as Folded, SWAP, "0.12 SOL")!;
  assert.deepEqual(done.got, { figure: "0.12 SOL", about: true }, "never a figure the record didn't land");
  assert.deepEqual(jobFace(done).money, { lead: "You got about ", place: "0.12 SOL", after: ". It's in your SOL wallet." }, "fails before: no result line");
  const landed: LiveTrack = { ...done, got: { figure: "0.12 SOL", about: false } };
  assert.deepEqual(jobFace(landed).money, { lead: "You got ", place: "0.12 SOL", after: ". It's in your SOL wallet." }, "a landed figure: no about");
  const noQuote = moveTrack(swapRow({ status: "done", landed: ["sol"], paidDone: true }) as Folded, SWAP)!;
  assert.equal(noQuote.got, undefined, "control: never invented");
  assert.deepEqual(jobFace(noQuote).money, { lead: "Your money is here: ", place: "your SOL wallet" }, "control");
  const going = moveTrack(swapRow({ paidDone: true }) as Folded, SWAP, "0.12 SOL")!;
  assert.notEqual(jobFace(going).money?.lead, "You got about ", "control: only once done");
});

test("J2-4: a Swap's first step names the payer its record shows: the Safe's fill only with a safe-send in the record; control: Private's own payment, no Safe step", () => {
  const filled = moveTrack(swapRow({ fill: "doing", paid: ["pocket-send:a", "safe-send:b"] }) as Folded, SWAP, "0.12 SOL")!;
  assert.equal(filled.steps[0]!.label, "NEAR Confidential is moving money from your Safe to Private.");
  const own = moveTrack(swapRow() as Folded, SWAP, "0.12 SOL")!;
  assert.ok(own.steps.every((s) => !/your Safe/.test(s.label)), "control: Private paid, the Safe is never named");
  assert.equal(own.steps[0]!.label, "NEAR Intents is swapping it for SOL.");
});

test("J2-4: the Swap receipt's \"From Private, so no Face ID.\" only when the job's record shows Private paid; the Safe's fill or no record: none", () => {
  const line = (paidFromMod as { receiptPaidLine?: (a: boolean, b: boolean | undefined, r: Pick<SpendingActivity, "fill" | "paid"> | null) => string | null }).receiptPaidLine;
  assert.equal(typeof line, "function", "fails before: the receipt said it on the fill rule's guess at the tap");
  const rows: [Pick<SpendingActivity, "fill" | "paid"> | null, boolean | undefined, string | null][] = [
    [{ paid: ["pocket-send:a"] }, false, "From Private, so no Face ID."],
    [{ paid: ["pocket-send:a", "safe-send:b"] }, false, null],
    [{ paid: ["pocket-send:a"], fill: "done" }, false, null],
    [{ paid: [] }, false, null],
    [null, false, null],
    [{ paid: ["pocket-send:a"] }, true, null],
  ];
  for (const [r, signs, want] of rows) assert.equal(line!(true, signs, r), want, JSON.stringify(r));
  assert.equal(line!(false, false, { paid: ["pocket-send:a"] }), null, "control: a wallet's own swap");
  const swap = src("./SwapSheet.tsx");
  assert.doesNotMatch(swap, /setPaidLine\(receiptPrivate\(/, "never at the tap");
});

test("J2-4: \"You can close this. It keeps going.\" never under \"Done in 6 seconds.\": Move's receipt draws it through TimeLeft's landing; the job page only while going", () => {
  const move = src("../screens/MoveSheet.tsx");
  assert.doesNotMatch(move, /\{job\.state === "away" && <p className="zf-receipt__line">\{JOB_WORDS\.watch\}<\/p>\}/, "fails before: its own line, deaf to the landing");
  assert.match(move, /watch job=\{madeJob\} \/>/);
  assert.match(src("./LiveTrack.tsx"), /\{f\.state === "going" && <p className="zf-small lv-tracker__note">Each step shows the moment it's done\. You can close this\. It keeps going\.<\/p>\}/, "control");
});

test("J2-3 (MUST): every amount chip, network chip, the QR's Copy and \"Who can see this?\" a 44 pt tap; the chosen network chip scrolled whole into view; the keypad's keys never under 56 pt", () => {
  const send = src("./send.css"), swap = src("./move-swap.css"), wallet = src("../wallet.css");
  const last = (css: string, sel: string) => { const i = css.lastIndexOf(sel); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
  assert.match(last(send, ".wl-chip, .wl-send2__nets .wl-chip, .wl-send2__chips .zf-chip {"), /height: 44px; min-height: 44px/, "fails before: 32 px");
  assert.match(last(send, ".wl-send2 .zf-keypad button, .wl-send2:has(.wl-send2__nets) .zf-keypad button {"), /height: 56px; min-height: 56px/, "fails before: 42 px, then a shared-out minmax(0, 1fr)");
  assert.match(last(send, ".wl-send2 .zf-keypad, .wl-send2:has(.wl-send2__nets) .zf-keypad {"), /flex: none; min-height: 224px; grid-auto-rows: 56px/);
  assert.match(last(swap, ".wl-swap-chips .zf-chip, .wl-swap-chips .zf-chip.wl-swap-all {"), /height: 44px; min-height: 44px/);
  assert.match(last(swap, ".wl-swap2__who {"), /min-height: 44px/, "fails before: an 18 px link");
  assert.match(last(swap, ".wl-swap2__scroll > .zf-keypad button {"), /height: 56px; min-height: 56px/);
  assert.match(last(wallet, ".zf-btn.wl-qrfull__copy {"), /height: 44px; min-height: 44px/, "fails before: 32 px");
  assert.match(last(send, ".wl-send2__nets .wl-chips { scroll-padding-inline"), /scroll-padding-inline: 24px/, "the chosen chip stops clear of the 24 px fade");
  const form = src("./SendForm.tsx");
  assert.match(form, /querySelector<HTMLElement>\('\[aria-checked="true"\]'\)\?\.scrollIntoView\?\.\(\{ inline: "nearest", block: "nearest" \}\)/, "fails before: the chosen chip under the fade");
  assert.match(form, /<div className="wl-chips" ref=\{netsRow\}>/);
});

test("J2-4: the open job page follows the core's own track before a starting row of the same id (a Swap's starting row has no money line or figure); control: Home's rows prefer it the same way", () => {
  const page = src("./LiveTrack.tsx");
  assert.match(page, /keptTrack\(o, \[\.\.\.tracks, \.\.\.starting\]\.find\(\(t\) => t\.id === o\.id\)\)/, "fails before: [...starting, ...tracks], the starting copy won and the done Swap page had no money line");
  assert.match(page, /openTrackOf\(openId, \[\.\.\.tracks, \.\.\.starting\]\)/);
  assert.match(src("./live-steps.ts"), /export const homeRows = \(starting: readonly LiveTrack\[\], tracks: readonly LiveTrack\[\]\): LiveTrack\[\] => starting\.filter\(\(s\) => !s\.end\?\.ok && !tracks\.some\(\(t\) => t\.id === s\.id\)\)/, "control");
});
