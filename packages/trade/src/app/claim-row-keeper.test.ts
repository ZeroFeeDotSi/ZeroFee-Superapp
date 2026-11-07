// A lost-and-found claim's Jobs row never stays pending when the app closes mid-claim (builder 4's open edge on the audit's T8,
// 8 Nov). JobCard makes "claim-<record>-<tap>" at the tap and ends it when the claim answers; a page closed in between
// left it "Asked Rhea" for good (no keeper swept "claim-" ids). Now the shared keeper (keepTradeTasks, started from Home)
// ends each one a closed page left, by its record: the coin came back, done; the claim went out and its end was never
// read, "Check Activity for where this is."; else "The app closed before it was sent. Nothing was spent.". Fails on t4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import type { TradeRecord } from "../service.ts";
import { CLAIM_PREFIX, CLOSED_WORDS, UNSURE_WORDS, claimRecord, keepTradeTasks } from "./trade-tasks.ts";

const tasks = taskStore().forApp("trade");
const task = (id: string) => taskStore().list().find((t) => t.id === id)!;
const STEPS = [{ label: "Asked Rhea", state: "doing" as const, at: 1_000 }, { label: "In your NEAR wallet", state: "waiting" as const }];
const KEPT_CODE = "trade.near.rhea-kept";
const kept = (id: string, o: Partial<TradeRecord> = {}): TradeRecord => ({ id, kind: "buy", chain: "near", symbol: "BLACKDRAGON", status: "failed", amountUsd: 5, hashes: ["h"], startedAt: 500, problem: { code: KEPT_CODE } as TradeRecord["problem"], kept: { wallet: "w.near", hash: "h", token: "blackdragon.tkn.near" }, ...o } as TradeRecord);
function fakeSvc(list: TradeRecord[]) {
  return { activity: async () => list, on: () => () => {} };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const claim = (rec: string, at: number) => { const id = `${CLAIM_PREFIX}${rec}-${at}`; tasks.publish({ id, title: "Get BLACKDRAGON back", steps: STEPS, startedAt: at }); return id; };

test("the claim's record id is read back from its row's id, a dash in the record's own id included", () => {
  const all = [kept("near-ab-12"), kept("other")];
  assert.equal(claimRecord(all, `${CLAIM_PREFIX}near-ab-12-1731000000000`)?.id, "near-ab-12");
  assert.equal(claimRecord(all, `${CLAIM_PREFIX}gone-1731000000000`), undefined);
});

test("a reload after the app closed mid-claim: nothing went, it ends with nothing spent; it went and its end is unread, Activity; it came back, done", async () => {
  const a = claim("ka", 1_000), b = claim("kb", 1_000), c = claim("kc", 1_000), d = claim("kd", 1_000);
  const svc = fakeSvc([
    kept("ka"),
    kept("kb", { kept: { wallet: "w.near", hash: "h", token: "blackdragon.tkn.near", claimSent: "claimhash" } }),
    { ...kept("kc", { status: "done", claimed: "claimhash" }), kept: undefined } as TradeRecord,
  ]);
  const stop = keepTradeTasks(svc, tasks, { now: () => 50_000 });
  await tick();
  assert.deepEqual([task(a).state, task(a).detail], ["stopped", CLOSED_WORDS]);
  assert.equal(CLOSED_WORDS, "The app closed before it was sent. Nothing was spent.");
  assert.deepEqual([task(b).state, task(b).detail], ["stopped", UNSURE_WORDS]);
  assert.equal(UNSURE_WORDS, "Check Activity for where this is.");
  assert.equal(task(c).state, "done");
  assert.deepEqual(task(c).steps.map((s) => s.state), ["done", "done"]);
  assert.deepEqual([task(d).state, task(d).detail], ["stopped", CLOSED_WORDS], "no record at all: nothing was sent");
  stop();
});

test("a claim made in this run is the card's to end, and an ended one is never touched", async () => {
  const live = claim("kl", 60_000);
  const ended = claim("ke", 1_000);
  tasks.end(ended, "failed", "Rhea said no to getting it back.");
  const svc = fakeSvc([kept("kl"), kept("ke")]);
  const stop = keepTradeTasks(svc, tasks, { now: () => 60_000 });
  await tick();
  assert.equal(task(live).state, "pending", "the tap's own card ends it when the claim answers");
  assert.deepEqual([task(ended).state, task(ended).detail], ["failed", "Rhea said no to getting it back."]);
  stop();
});

test("one source for the row's id: JobCard makes it from CLAIM_PREFIX, and the keeper runs from Home's start (trade-follow.ts)", () => {
  const card = readFileSync(new URL("./screens/JobCard.tsx", import.meta.url), "utf8");
  assert.match(card, /const task = `\$\{CLAIM_PREFIX\}\$\{k\.id\}-\$\{at\}`/);
  assert.doesNotMatch(card, /`claim-\$\{/);
  assert.match(readFileSync(new URL("./trade-follow.ts", import.meta.url), "utf8"), /keepTradeTasks\(svc/);
});
