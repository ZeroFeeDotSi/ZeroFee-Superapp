// S2 (real money, 4 Nov, zf-0000000a01.near, main@b9935fbf): on a release 9 account AgentZero offered "Turn on · $5 a
// day", and Approve ended on "This part of the app isn't ready yet. This account's rules don't have AgentZero."; the
// Pocket money row could stay on "Looking at your account…" for good. Turn on needs an ANSWERED read now; a failed or
// late read ends with a line and Try again; release 9 says AgentZero's own line, never a Problem screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { offersTurnOn, pocketFrom, readWithin } from "./pocket-read.ts";
import { NO_POCKET_LINE } from "../zero/jobs.ts";

const src = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
const problem = (code: string) => ({ problem: { code, whatHappened: "x", money: { state: "safe", where: "" }, next: { kind: "nothing", label: "Go back" } } }) as never;

test("S2: Turn on only after the read answered; a failed, late or release 9 read never offers it", () => {
  assert.equal(offersTurnOn(pocketFrom({ ok: null })), true, "control: answered, AgentZero off");
  assert.equal(offersTurnOn(pocketFrom({ ok: { budget: {} } })), true, "control: answered, on");
  assert.deepEqual(pocketFrom(problem("security.method.unknown")), { k: "none" });
  assert.equal(offersTurnOn(pocketFrom(problem("security.method.unknown"))), false, "release 9: no pocket money");
  // the old tab offered Turn on whenever the view wasn't exactly "method unknown" (a busy node's problem, a throw)
  assert.equal(offersTurnOn(pocketFrom(problem("security.partner.unreachable"))), false, "a failed read");
  assert.equal(offersTurnOn(pocketFrom("threw")), false);
  assert.equal(offersTurnOn(pocketFrom("late")), false);
  assert.equal(offersTurnOn({ k: "reading" }), false);
});

test("S2: a read that never answers ends (\"late\"), a throw is a failed read, an answer passes through", async () => {
  assert.equal(await readWithin(new Promise(() => {}), 20), "late");
  assert.equal(await readWithin(Promise.reject(new Error("x")), 1_000), "threw");
  assert.deepEqual(await readWithin(Promise.resolve({ ok: 1 }), 1_000), { ok: 1 });
});

test("S2: the tab: the row ends with an answer, retries on tap; Approve on release 9 says AgentZero's line", () => {
  // no read is awaited without a deadline, and the engine's refresh can't hold the view up
  assert.match(src, /readWithin\(bridge\.call\("account\.agent\.view"\)\)/);
  assert.match(src, /engine\.refresh\(\)\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(src, /agent === undefined \? "Looking at your account…"/, "the old row waited on agent, which a failed read never set");
  assert.match(src, /pocket\.k === "unread" \? void read\(\)/, "the unread row is the Try again");
  // a refusal for rules without AgentZero becomes the no-pocket line, never shell.showProblem's "isn't ready yet"
  const i = src.indexOf('if ((r.problem as Problem).code === "security.method.unknown") {');
  assert.ok(i > 0 && src.slice(i, i + 200).includes('setSheet({ kind: "said", line: NO_POCKET_LINE })'));
  assert.ok(src.indexOf("{noPocket && !pocketUpdate && (") > 0 && src.includes("<span className=\"d\">{NO_POCKET_LINE}</span>"), "no pocket money: one line says why");
  assert.equal(NO_POCKET_LINE, "Your rules don't give AgentZero its own wallet yet. Nothing left your Safe.", "the Copywriter's line");
  assert.match(src, /POCKET_UNREAD_LINE = "NEAR didn't answer\. Tap to try again\."/, "the Copywriter's line");
});
