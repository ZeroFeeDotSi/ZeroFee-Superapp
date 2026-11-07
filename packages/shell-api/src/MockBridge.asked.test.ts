// the audit's MUST (7 Nov): the Sim's Safe sheet says approval.asked with its job's key just before it shows, and job.signed names
// the job, as the core does (dev-signer.ts onAsked, onSigned), so the Sim and the phone take one path. Controls: no job,
// no approval.asked; a no on the sheet, no job.signed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge, jobKeyOf } from "./MockBridge.ts";

const ok = <T,>(r: { ok: T } | { problem: unknown }): T => { assert.ok("ok" in r, JSON.stringify(r)); return (r as { ok: T }).ok; };
const JOB = "home-swap-0123456789abcdef01234567";

async function sim(approve = true) {
  const b = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "25", near: "0" }, safeFillOpen: true });
  const log: string[] = [];
  b.on<{ id: string }>("approval.needed", (p) => { log.push("sheet"); void b.call("approval.answer", { id: p.id, approve }); });
  b.on<{ jobKey?: string }>("approval.asked", (p) => log.push(`asked:${p.jobKey}`));
  b.on<{ jobKey?: string }>("job.signed", (p) => log.push(`signed:${p.jobKey ?? ""}`));
  const ws = ok(await b.call<{ id: string; chain: string; kind: string }[]>("subwallet.list", {}));
  return { b, log, sol: ws.find((w) => w.chain === "sol" && w.kind === "trade")! };
}

test("the Sim: a Move the Safe fills after all says approval.asked with its job's key just before the Safe's sheet, then job.signed with it (controls: no job, none asked; a no, nothing signed)", async () => {
  const s = await sim();
  ok(await s.b.call("ledger.moveFromPrivate", { app: "wallet", parts: [{ wallet: s.sol.id, usd: 50 }], job: JOB }));
  assert.deepEqual(s.log, [`asked:${JOB}`, "sheet", `signed:${JOB}`]);
  const none = await sim();
  ok(await none.b.call("ledger.moveFromPrivate", { app: "wallet", parts: [{ wallet: none.sol.id, usd: 50 }] }));
  assert.deepEqual(none.log, ["sheet", "signed:"], "no job: nothing asked by key");
  const no = await sim(false);
  await no.b.call("ledger.moveFromPrivate", { app: "wallet", parts: [{ wallet: no.sol.id, usd: 50 }], job: JOB });
  assert.deepEqual(no.log, [`asked:${JOB}`, "sheet"], "Not now: asked, never signed");
});

test("jobKeyOf: a request's job, a ledger call's job, well formed only", () => {
  const table: [string, Record<string, unknown>, string | undefined][] = [
    ["tx.request", { request: { job: JOB } }, JOB],
    ["tx.request", { job: JOB }, undefined],
    ["ledger.moveFromPrivate", { job: JOB }, JOB],
    ["ledger.moveFromPrivate", { job: "short" }, undefined],
    ["ledger.moveFromPrivate", { job: "has a space 0123456789abc" }, undefined],
    ["ledger.moveFromPrivate", { job: 42 }, undefined],
    ["ledger.toTrading", {}, undefined],
  ];
  for (const [m, p, want] of table) assert.equal(jobKeyOf(m, p), want, `${m} ${JSON.stringify(p)}`);
});
