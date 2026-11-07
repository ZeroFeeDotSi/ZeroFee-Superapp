// One Face ID per Safe action (bug report, 6 Nov, his phone: "Job created." before any signature; two Face ID popups;
// prompt, success, prompt). the audit's approved design ($ZEROFEE_HOME/sim-crawls/2026-11-06-one-faceid/DESIGN.md): a Safe job is
// made only once its last signature is made (the core's job.signed, before anything is sent); "Check this" is up at the
// tap; a Move whose Private share pays part folds into the Safe's one sheet while Private stays under its buffer (R2); a
// closed money sheet stops the Safe's sheet of a Send or Move too; a job Private pays whole says why no Face ID (W1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { closedSince } from "@zerofee/core/money-closed";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { runJob, type Answer, type onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { closePending, hostSheets, onPending, pendingShown, refusingClosed, type Pending } from "@zerofee/shell-api/approval-answered.ts";
import { JOB_WORDS, startJob } from "@zerofee/shell-api/job-start.ts";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { foldsWhole, PRIVATE_BUFFER_USD } from "./safe-send.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import { moneyClosed } from "@zerofee/core/money-closed";

const store = taskStore();
const tasks = store.forApp("wallet");
const rows = () => store.list().filter((t) => t.id.startsWith("job:"));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const flush = () => new Promise((r) => setTimeout(r, 0));
function slow<T>() {
  let answer!: (r: Answer<T>) => void;
  const p = new Promise<Answer<T>>((r) => { answer = r; });
  return { call: () => p, answer };
}
/** The streams the test drives: yes(…) answers a sheet; signed() is the core's job.signed. */
function streams() {
  const s: { yes?: (y: boolean) => void; signed?: () => void } = {};
  const onApproval = ((fn: (y: boolean) => void) => { s.yes = fn; return () => { s.yes = undefined; }; }) as typeof onOwnApproval;
  const onSigned = (fn: () => void) => { s.signed = fn; return () => { s.signed = undefined; }; };
  return { s, onApproval, onSigned };
}

test("T1: a Safe job where the shell never hears the sheet (the iPhone): no \"Job created.\" at the tap; made at once on job.signed, its row Approved (control: a hot wallet's job is made at the tap)", async () => {
  clear();
  const off = hostSheets({ safe: false });
  const c = slow<{ id: string }>();
  const { s, onApproval, onSigned } = streams();
  const made: string[] = [];
  const end = runJob({ tasks, title: "Send $25.00 to them", safe: true, money: ["safe"], call: c.call, declined: () => false, made: () => { made.push("safe"); }, onApproval, onSigned });
  assert.deepEqual(made, [], "nothing at the tap: no signature yet");
  assert.equal(rows().length, 0, "no row before the signature");
  s.signed?.();
  assert.deepEqual(made, ["safe"], "made in the same turn as the signature, before the core's answer (no network wait)");
  assert.equal(rows()[0]?.steps[0]?.label, "Approved");
  c.answer({ ok: { id: "s" } });
  await end;
  assert.equal(made.length, 1, "once");
  // control: a hot wallet's job, no Face ID, at the tap
  const hot = slow<{ id: string }>();
  const at: string[] = [];
  const h = runJob({ tasks, title: "Swap $10.00 of SOL for ETH", safe: false, money: ["row:sol"], call: hot.call, declined: () => false, made: () => { at.push("hot"); } });
  assert.deepEqual(at, ["hot"]);
  hot.answer({ ok: { id: "h" } }); await h;
  off();
});

test("T2: a call that asks two sheets: neither yes makes the job; only its signature does (control: a No makes nothing at all)", async () => {
  clear();
  const off = hostSheets({ safe: true });
  const c = slow<{ id: string }>();
  const { s, onApproval, onSigned } = streams();
  let made = 0;
  const end = runJob({ tasks, title: "Send $25.00 to them", safe: true, money: ["safe"], call: c.call, declined: () => false, made: () => { made++; }, onApproval, onSigned });
  await flush();
  s.yes?.(true);
  assert.equal(made, 0, "the first yes is not a signature: no success, no buzz, no Job created");
  s.yes?.(true);
  assert.equal(made, 0, "the second yes neither");
  s.signed?.();
  assert.equal(made, 1, "made on the last signature");
  c.answer({ ok: { id: "s" } }); await end;
  // control: a No
  const n = slow<{ declined: true }>();
  const t = streams();
  let none = 0;
  const e2 = runJob({ tasks, title: "Send", safe: true, money: ["safe"], call: n.call, declined: (r) => "ok" in r && "declined" in r.ok, made: () => { none++; }, onApproval: t.onApproval, onSigned: t.onSigned });
  await flush(); t.s.yes?.(false); n.answer({ ok: { declined: true } });
  assert.deepEqual(await e2, { declined: true, after: false });
  assert.equal(none, 0);
  off();
});

test("W2 + R5: \"Check this\" is up at the tap with the headline; its Close is a No: the money sheet's close (money-closed), a later money sheet of the call refused unseen, no job (control: the call's answer takes it down)", async () => {
  clear();
  const seen: (Pending | null)[] = [];
  const offP = onPending((p) => seen.push(p));
  const c = slow<{ declined: true }>();
  const { onApproval, onSigned } = streams();
  const started = Date.now();
  let made = 0;
  const end = runJob({ tasks, title: "Move $135.00 to your SOL wallet", safe: true, money: ["safe"], call: c.call, declined: (r) => "ok" in r && "declined" in r.ok, made: () => { made++; }, onApproval, onSigned });
  assert.equal(pendingShown()?.headline, "Move $135.00 to your SOL wallet", "up in the tap's own turn");
  closePending();
  assert.equal(pendingShown(), null);
  assert.ok(closedSince(started), "the money sheet's close: the ledger signs nothing after it");
  assert.equal(refusingClosed(), true, "a money sheet its call still asks is answered No unseen");
  c.answer({ ok: { declined: true } });
  assert.deepEqual(await end, { declined: true, after: false });
  assert.equal(made, 0);
  assert.equal(refusingClosed(), false, "ended with its call");
  // control: answered, it goes
  const d = slow<{ id: string }>();
  const t = streams();
  const e2 = runJob({ tasks, title: "Swap $10.00", safe: true, money: ["safe"], call: d.call, declined: () => false, made: () => {}, onApproval: t.onApproval, onSigned: t.onSigned });
  assert.ok(pendingShown());
  d.answer({ ok: { id: "x" } }); await e2;
  assert.equal(pendingShown(), null);
  offP();
});

test("R2: the fold keeps Private at or under its $500 buffer (Private's share plus the fill's step), a table near the cap", () => {
  const usdc = { symbol: "USDC", decimals: 6, priceUsd: "1" };
  const u = (usd: number) => BigInt(Math.round(usd * 1e6));
  assert.equal(PRIVATE_BUFFER_USD, 500);
  // the step (fillStepUsd): $30 fills $40, $480 fills $500, $600 fills $700
  const rows: [number, number, boolean][] = [[12.5, 30, true], [400, 600, true], [400.01, 600, false], [480, 480, true], [480.01, 480, false], [480, 600, false], [520, 700, false], [0, 30, true]];
  for (const [share, wanted, folds] of rows) assert.equal(foldsWhole(u(share), u(wanted), usdc), folds, `share $${share}, Move $${wanted}`);
  assert.equal(foldsWhole(u(10), u(30), { symbol: "NEAR", decimals: 24, priceUsd: "0" }), false, "no price: no fold");
});

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const FLOAT = "f0".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SITE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const WALLETS = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "trade", id: "sw-trade-near", chain: "near", address: FLOAT }, { kind: "site", id: "sw-site-pump", chain: "sol", address: SITE, site: "pump" }];
function ledgerFor(pocketUnits: string, onQuote?: (req: any) => void) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: pocketUnits }], subwallets: WALLETS as never });
  const asked: any[] = [];
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const apis: Apis = {
    ...base,
    quote: async (req: any) => { asked.push(req); onQuote?.(req); return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any; },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async (_a: string, _via?: string, tag?: string) => ({ status: "SUCCESS", ...(tag ? { swapDetails: { amountOut: "999999999999999999999999" } } : {}) } as any),
  };
  const chain = fakeNear(ME, { ledger: { [USDC]: "900000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } });
  const ledger = createLedgerService({ bridge: core as Bridge, chain, apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true });
  return { ledger, core, asked };
}
const move = (s: ReturnType<typeof ledgerFor>, usd: number) => s.ledger.call<{ parts: { wallet: string; ids: string[] }[] }>("ledger.moveFromPrivate", { parts: [{ wallet: "sw-site-pump", usd }], job: "one-faceid-0123456789abcdef01", caller: "wallet" });

test("T3: a Move from the Safe whose Private share pays part asks ONE sheet: the fill pays it whole, one exit, Private's share stays (control: past the $500 buffer Private's own part pays first, no Face ID, then the Safe's one sheet)", async () => {
  const s = ledgerFor("12500000");
  const r = await move(s, 30);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(r.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["safe-send"], "one job: the fill and its exit, no pocket part first");
  assert.equal(s.core.signed.length, 1, "one Safe sheet, one Face ID");
  assert.equal(s.core.privatePays.filter((p: any) => p.send === true).length, 0, "Private's own part asked nothing");
  // control: Private already holds $520: no fold, Private's part first (a hot key, no Face ID), then the Safe's one sheet
  const big = ledgerFor("520000000");
  const two = await move(big, 600);
  assert.ok("ok" in two, "problem" in two ? `${two.problem.code} ${two.problem.whatHappened}` : "");
  assert.deepEqual(two.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["pocket-send", "safe-send"]);
  assert.equal(big.core.signed.length, 1, "still one Face ID: Private's part is a hot key");
});

test("T5: the money sheet closed while a Move from the Safe got ready: the Safe's sheet never comes, nothing signed (control: left open, it signs once)", async () => {
  const s = ledgerFor("12500000", (req) => { if (!req.dry && req.recipient === SITE) moneyClosed(); });
  const r = await move(s, 30);
  assert.equal(s.core.signed.length, 0, "no Safe sheet after the close");
  assert.ok("problem" in r || ("ok" in r && r.ok.parts.every((p) => p.ids.length === 0)), JSON.stringify(r));
  const open = ledgerFor("12500000");
  await flush();
  const ok = await move(open, 30);
  assert.ok("ok" in ok);
  assert.equal(open.core.signed.length, 1);
});

test("T6 (the copy review's W1): a job Private pays whole says why there is no Face ID, on its row and its page; never \"no signature\" (control: a Safe job's first step is its approval)", () => {
  clear();
  const h = startJob(tasks, { title: "Swap $25.00", fromPrivate: true });
  const row = rows().find((t) => t.id === h.id)!;
  assert.equal(row.steps[0]?.label, "From Private, so no Face ID.");
  assert.equal(row.detail, "Private money is already set up to spend, so it pays without Face ID. The Safe always asks.");
  assert.ok(!/no signature/i.test(JSON.stringify(JOB_WORDS)));
  const safe = startJob(tasks, { title: "Send $25.00", approve: true });
  assert.notEqual(rows().find((t) => t.id === safe.id)!.steps[0]?.label, JOB_WORDS.fromPrivate);
  // the callers that pay from Private whole say it: Swap's signs === false, Move's Private-only Safe side
  const swap = readFileSync(new URL("./app/money/SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(swap, /signs === false \? \{ fromPrivate: true \}/);
});

test("R5: the chip's unlock is never reused: touchIDAuthenticationAllowableReuseDuration stays 0 on every context that signs", () => {
  const swift = readFileSync(new URL("../../../apps/ios/ZeroFee/ChipKey.swift", import.meta.url), "utf8");
  const set = swift.match(/touchIDAuthenticationAllowableReuseDuration\s*=\s*([^\s;]+)/g) ?? [];
  assert.ok(set.length >= 2, "set on the signing context and the approval key's");
  for (const s of set) assert.match(s, /=\s*0$/);
  assert.match(swift, /func signMany\(hashes: \[Data\]\)/);
});

test("T12 (the audit's MUST a-c, the follower): a sealed Send's job keeps no signature on the page; the core is asked to hand leg 2 only after leg 1 reads SUCCESS with enough, and to delete it when the job ends or is discarded (control: an unsealed job submits its own signature)", async () => {
  const { createSendJobs, SEND_JOBS } = await import("./send-job.ts");
  const rig = (sealed: boolean, legs: { status: string; amountOut?: string }[]) => {
    const kv = new Map<string, string>();
    const calls: string[] = [];
    let i = 0;
    let moving = true;
    const sj = createSendJobs({
      apis: {
        status: (async (dep: string) => {
          if (dep === "in-dep") { const s = legs[Math.min(i++, legs.length - 1)]!; calls.push(`leg1 ${s.status}`); return { status: s.status, ...(s.amountOut ? { swapDetails: { amountOut: s.amountOut } } : {}) }; }
          return { status: "SUCCESS" };
        }) as never,
        submitIntent: (async (_via: string, data: unknown) => { calls.push(`page submit ${JSON.stringify(data)}`); return {}; }) as never,
      },
      relayed: "relay",
      remember: async (m) => { if (m.status !== "moving" && m.status !== "waiting") moving = false; }, note: async () => {}, forget: async () => {},
      loadMovements: async () => [{ id: "sealed-1", status: moving ? "moving" : "done" }] as never,
      emit: () => {}, stored: async (k) => kv.get(k), store: async (k, v) => kv.set(k, v),
      serially: (f) => f(), iso: () => new Date(0).toISOString(), now: () => 0, trackMs: 1,
      pairHand: async (d) => (calls.push(`core hand ${d}`), { handed: true }),
      pairEnd: async (d) => calls.push(`core end ${d}`),
    });
    const job = { id: "sealed-1", inDeposit: "in-dep", outDeposit: "out-dep", coinId: "nep141:usdc", leg2In: "100", coin: "USDC", startedAtIso: new Date(0).toISOString(), ...(sealed ? { signedData: null, sealed: true as const } : { signedData: { signature: "page-sig" } }) };
    return { sj, kv, calls, job };
  };
  const settle = async (calls: string[], what: RegExp) => { for (let n = 0; n < 500 && !calls.some((c) => what.test(c)); n++) await new Promise((r) => setTimeout(r, 1)); };
  const s = rig(true, [{ status: "PENDING_DEPOSIT" }, { status: "PROCESSING" }, { status: "SUCCESS", amountOut: "150" }]);
  await s.sj.keep(s.job, { id: "sealed-1", status: "moving" } as never);
  await s.sj.start(s.job);
  await settle(s.calls, /^core end/);
  assert.ok(!/signature|page-sig/.test(s.kv.get(SEND_JOBS) ?? ""), "no signature in the page's storage, ever");
  assert.deepEqual(s.calls, ["leg1 PENDING_DEPOSIT", "leg1 PROCESSING", "leg1 SUCCESS", "core hand in-dep", "core end in-dep"], "handed by the core only after leg 1's SUCCESS; deleted at the job's end; never submitted from the page");
  // leg 1 short of the payment: never handed, deleted at its end
  const short = rig(true, [{ status: "SUCCESS", amountOut: "50" }]);
  await short.sj.start(short.job);
  await settle(short.calls, /^core end/);
  assert.deepEqual(short.calls, ["leg1 SUCCESS", "core end in-dep"]);
  // leg 1 came back: never handed, deleted
  const back = rig(true, [{ status: "REFUNDED" }]);
  await back.sj.start(back.job);
  await settle(back.calls, /^core end/);
  assert.deepEqual(back.calls, ["leg1 REFUNDED", "core end in-dep"]);
  // discarded before leg 1 (a No, a refusal): the core deletes it too
  const d = rig(true, [{ status: "PENDING_DEPOSIT" }]);
  await d.sj.keep(d.job, { id: "sealed-1", status: "moving" } as never);
  await d.sj.discard(d.job.id);
  assert.deepEqual(d.calls, ["core end in-dep"]);
  // control: an unsealed job (an older core's answer) submits its own signature, and asks the core nothing
  const c = rig(false, [{ status: "SUCCESS", amountOut: "150" }]);
  await c.sj.start(c.job);
  await settle(c.calls, /^page submit/);
  assert.ok(c.calls.includes('page submit {"signature":"page-sig"}'));
  assert.ok(!c.calls.some((x) => x.startsWith("core")));
});
