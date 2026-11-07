// m3's open SHOULD (builder handoff, 7 Nov): a reopened starting job (job-start.ts reopenOf) went "unsure" ("Check
// Activity for where this is.") on ANY ledger movement since its start: money that came in, another payee's Send, a rules
// change. Now only a movement that could be its own: a Send's by its payee ("Send $5.00 to bob.near": a payment to
// bob.near, or the short form's head and tail), a Swap's or a Move's by its kinds; an unknown job, a row with no kind or
// no payee, or a ledger that won't answer still proves nothing (unsure). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_WORDS, endOrphans, jobMatches, reopenOf, startJob } from "@zerofee/shell-api/job-start.ts";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";

const tasks = () => taskStore().forApp("wallet");
const row = (id: string): Task | undefined => taskStore().list().find((t) => t.id === id);
const ledger = (rows: unknown[] | null): Pick<Bridge, "call"> => ({ call: (async (m: string) => (m === "ledger.activity" && rows ? { ok: rows } : { problem: { code: "x" } })) as never });
const reopen = async (bridge: Pick<Bridge, "call">) => { const text = JSON.stringify(taskStore().list()); endOrphans(text, await reopenOf(bridge, text)); };
const now = () => new Date().toISOString();
const EVM = "0x12345678901234567890123456789012345678ab";

test("a Send: another payee's payment and money that came in since its start are not its own: closed, as before M3 [before: unsure]", async () => {
  const s = startJob(tasks(), { title: "Send $5.00 to bob.near", usd: "$5.00", approve: true });
  await reopen(ledger([
    { id: "deposit:1", kind: "deposit", status: "done", to: "kid.near", startedAtIso: now() },
    { id: "safe-send:c", kind: "pay", status: "moving", to: "carol.near", startedAtIso: now() },
    { id: "acct:1", kind: "account", status: "done", startedAtIso: now() },
  ]));
  assert.equal(row(s.id)?.detail, JOB_WORDS.closed, `fails before: ${row(s.id)?.detail}`);
});

test("a Send: a payment to its own payee since its start (by name, or by the address its title shows short): unsure", async () => {
  const a = startJob(tasks(), { title: "Send $5.00 to bob.near", usd: "$5.00" });
  await reopen(ledger([{ id: "safe-send:b", kind: "pay", status: "moving", to: "Bob.near", startedAtIso: now() }]));
  assert.equal(row(a.id)?.detail, JOB_WORDS.mayHaveMoved);
  const b = startJob(tasks(), { title: "Send $5.00 to 0x1234…78ab", usd: "$5.00" });
  await reopen(ledger([{ id: "pocket-send:e", kind: "pay", status: "moving", to: EVM, startedAtIso: now() }]));
  assert.equal(row(b.id)?.detail, JOB_WORDS.mayHaveMoved);
});

test("a Swap and a Move by their own kinds: a payment or a deposit is not theirs (closed); a swap, a convert, a Top up, a Private move are (unsure)", () => {
  for (const kind of ["pay", "deposit", "account"]) {
    assert.equal(jobMatches("Swap $5.00 of SOL for USDC", { kind, to: "bob.near" }), false, `Swap ${kind}`);
    assert.equal(jobMatches("Move $30.00 to your SOL wallet", { kind, to: "bob.near" }), false, `Move ${kind}`);
    assert.equal(jobMatches("Add $10.00 to your pump.fun wallet", { kind }), false, `Add ${kind}`);
  }
  for (const kind of ["swap", "convert", "trading", "private"]) assert.equal(jobMatches("Swap $5.00 of SOL for USDC", { kind }), true, `Swap ${kind}`);
  for (const kind of ["trading", "private", "transfer"]) assert.equal(jobMatches("Move $30.00", { kind }), true, `Move ${kind}`);
});

test("controls: what proves nothing stays unsure: a row with no kind, a Send's row with no payee, a job of no known kind, a ledger that won't answer; a row from before its start: closed", async () => {
  assert.equal(jobMatches("Send $5.00 to bob.near", {}), true, "no kind");
  assert.equal(jobMatches("Send $5.00 to bob.near", { kind: "pay" }), true, "no payee");
  assert.equal(jobMatches("Pay the shop", { kind: "deposit" }), true, "a job of no known kind: any row");
  assert.equal(jobMatches("Send $5.00 to bob.near", { kind: "pay", to: "bob.near.evil" }), false, "the name whole, never a prefix");
  const c = startJob(tasks(), { title: "Send $2.00 to carol.near", usd: "$2.00" });
  await reopen(ledger(null));
  assert.equal(row(c.id)?.detail, JOB_WORDS.mayHaveMoved);
  const d = startJob(tasks(), { title: "Send $2.00 to dan.near", usd: "$2.00" });
  await reopen(ledger([{ id: "safe-send:old", kind: "pay", to: "dan.near", status: "done", startedAtIso: new Date(Date.now() - 60_000).toISOString() }]));
  assert.equal(row(d.id)?.detail, JOB_WORDS.closed);
});
