// the audit's rulings (6 Nov), after fix/move-stop-unknown: (a) a one-part Move that stopped with its money unknown still offered
// "Try again" (a re-tap pays again); (b) a stopped part counted as landed, so its landing step ticked "It's in your BNB
// wallet." with no chain read. The ledger's part carries `unsure`; Spending's row carries `unsure` and `missed`; the job
// reads the flags, never the words. Whole path: the real ledger, Trade's engine row (float-private), Spending, the job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, privLanded, privMissed, privUnsure, type EngineMove, type EngineSnapshot, type SpendingActivity, type SpendingEngine } from "@zerofee/core/spending";
import type { Bridge } from "@zerofee/core/bridge";
import { addFromPrivate, moved, type PrivateHost } from "@zerofee/trade/float-private.ts";
import type { MoveRow } from "@zerofee/trade/float-view.ts";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { moveTrack } from "./app/money/live-steps.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const FLOAT = "f0".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const BSC = "0x00000000000000000000000000000000deadbeef";
const JOB = "move-private-0123456789abcdef0456";
const WALLETS = [
  { kind: "private", id: "sw-private", chain: "near", address: POCKET },
  { kind: "trade", id: "sw-trade-sol", chain: "sol", address: SOL },
  { kind: "trade", id: "sw-trade-near", chain: "near", address: FLOAT },
  { kind: "trade", id: "sw-trade-bsc", chain: "bsc", address: BSC },
];
const TRY = "Try again";

/** The real ledger (as private-move-stop.test.ts): the `stopAt`-th signed quote throws `stop()`. */
function ledgerRig(stopAt: number, stop: () => unknown) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "20000000" }], subwallets: WALLETS as never });
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  let signed = 0;
  const apis: Apis = {
    ...base,
    quote: async (req: any) => {
      if (!req.dry && ++signed === stopAt) throw stop();
      return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any;
    },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async () => ({ status: "SUCCESS" }) as any,
  };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: true } as never);
  return { ledger, core };
}

/** Trade's engine row for the Move, paid by the real ledger (float-private addFromPrivate), as float-core keeps it. */
async function engineRow(stopAt: number, stop: () => unknown, legs: { chain: "sol" | "bsc"; usd: number }[]) {
  const l = ledgerRig(stopAt, stop);
  const ids: Record<string, string> = { sol: "sw-trade-sol", bsc: "sw-trade-bsc" };
  const usd = legs.reduce((n, x) => n + x.usd, 0);
  const r = { id: `mv-${JOB}`, kind: "add", usd, status: "waiting", where: "main", at: 0, legs: legs.map((x) => ({ ...x })) } as unknown as MoveRow;
  const h: PrivateHost = {
    d: {
      now: () => 1,
      async call<T>(m: string, p: Record<string, unknown>): Promise<T> {
        if (m === "subwallet.balances") return [] as T;
        const got = await l.ledger.call<T>(m, { ...p, caller: "trade" });
        if ("problem" in got) throw new ProblemError(got.problem);
        return got.ok;
      },
    },
    adds: [r], asking: new Set(), ensureChain: async () => undefined, current: (c) => ({ id: ids[c]! }), refresh: async () => undefined, saveAdds: async () => undefined,
    addRow: (x) => x, begin: () => undefined, base: () => undefined, hold: () => undefined, changed: () => undefined,
  };
  const got = await addFromPrivate(h, r, { usd, legs, label: "Move", asked: {}, job: JOB });
  assert.notEqual(got, "declined");
  return { r, l };
}

/** Spending's row of that engine row (spending.activity), and its job (live-steps moveTrack). */
async function jobOf(m: EngineMove) {
  const s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [m] };
  const e: SpendingEngine = {
    snapshot: () => s, subscribe: () => () => undefined, refresh: async () => undefined,
    async add(usd) { return { id: "a1", kind: "add", usd, status: "moving", at: 0 }; },
    async takeOut(usd) { return { id: "h1", kind: "home", usd: usd === "all" ? 0 : usd, status: "waiting", at: 0 }; },
    setCap() {}, async moveNow(chain, usd) { return { id: "s1", kind: "out", chain, usd, status: "moving", at: 0 }; },
  };
  const got = await createSpendingService({ engine: () => e, async call<T>(): Promise<T> { throw new Error("no call"); } } as never).call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in got, JSON.stringify(got));
  const row = got.ok.find((x) => x.id === m.id)!;
  return { row, job: moveTrack(row as never, undefined, undefined)! };
}
const tries = (t: { next?: { label: string }[] }) => (t.next ?? []).map((n) => n.label);
const lands = (t: { steps: { key: string; state: string; label: string }[] }) => t.steps.filter((s) => s.key === "land").map((s) => [s.label, s.state]);

test("(a) whole path: a one-part Move whose payment threw (money unknown) ends with Activity only, never Try again; the flag rides the ledger's record, its status read, the engine's row and Spending's row", async () => {
  const { r, l } = await engineRow(1, () => new Error("boom"), [{ chain: "sol", usd: 5 }]);
  const kept = JSON.parse(l.core.store.get("private-moves") as string)[JOB];
  assert.equal(kept.parts[0].unsure, true, "the ledger's record");
  const st = await l.ledger.call<{ parts: { unsure?: true }[] } | null>("ledger.privateMoveStatus", { job: JOB });
  assert.ok("ok" in st && st.ok && st.ok.parts[0]!.unsure === true, "its status read (a page closed mid-job)");
  assert.equal(r.priv!.parts[0]!.unsure, true, "the engine's row");
  assert.equal(r.status, "failed");
  const { row, job } = await jobOf(r as unknown as EngineMove);
  assert.equal(row.unsure, true, "Spending's row");
  assert.ok(job.end && !job.end.ok);
  assert.match(job.end.line, /Check Activity before you try again/);
  assert.ok(!tries(job).includes(TRY), "a re-tap would pay it again");
});

test("(a) control, whole path: a one-part Move that went and came back to Private keeps Try again (its money is known: back in Private)", async () => {
  const { r } = await engineRow(99, () => new Error("never"), [{ chain: "sol", usd: 5 }]);
  const id = r.priv!.parts[0]!.ids[0]!;
  assert.ok(id, "it went");
  moved(r, { id, status: "refunded" }, 2);
  assert.equal(r.status, "failed");
  const { row, job } = await jobOf(r as unknown as EngineMove);
  assert.equal(row.unsure, undefined);
  assert.ok(tries(job).includes(TRY), "Try again: nothing can pay twice");
});

test("(b) whole path: a two-part Move whose BNB part threw after the SOL part went: BNB's landing never ticks, on its way or after the SOL read showed Done; SOL's does (control)", async () => {
  const { r } = await engineRow(2, () => new Error("boom"), [{ chain: "sol", usd: 3 }, { chain: "bsc", usd: 5 }]);
  assert.deepEqual(r.priv!.parts.map((p) => [p.chain, !!p.stopped, p.unsure ?? null]), [["sol", false, null], ["bsc", true, true]]);
  const going = await jobOf(r as unknown as EngineMove);
  assert.deepEqual([going.row.landed, going.row.missed], [undefined, ["bsc"]], "on its way: nothing landed, BNB missed");
  assert.deepEqual(lands(going.job).map((x) => x[1]), ["waiting", "failed"], "SOL's landing still to come; BNB's failed, never ticked");
  // the SOL payment ends done; the engine's landed round's read shows it (float-core: Done, with the parts' note)
  moved(r, { id: r.priv!.parts[0]!.ids[0]!, status: "done" }, 2);
  assert.ok(r.priv!.landed, "every part over, some arrived");
  Object.assign(r, { status: "done", where: "chain", ...(r.priv!.landed!.note ? { note: r.priv!.landed!.note } : {}) });
  const done = await jobOf(r as unknown as EngineMove);
  assert.deepEqual([done.row.landed, done.row.missed], [["sol"], ["bsc"]]);
  assert.deepEqual(lands(done.job), [["It's in your SOL wallet.", "done"], ["BNB Chain is landing it in your BNB wallet.", "failed"]], "never \"It's in your BNB wallet.\"");
  assert.ok(done.job.end?.ok, "the row's end: Done for what went");
  assert.match(done.job.end!.line, /BNB Chain: ZeroFee hit a problem on its side\. Check Activity before you try again\./, "its line names BNB's stop: true");
  assert.ok(!tries(done.job).includes(TRY));
});

test("tables: privUnsure, privMissed, privLanded (pure)", () => {
  const P = (o: Record<string, unknown>) => ({ wallet: "w", chain: "sol", ids: ["pocket-send:a"], ...o });
  const m = (parts: Record<string, unknown>[], status: EngineMove["status"] = "moving", legs?: EngineMove["legs"]) => ({ status, priv: { parts: parts as never }, ...(legs ? { legs } : {}) });
  const unsure: [string, ReturnType<typeof m>, boolean][] = [
    ["a part flagged", m([P({ chain: "near" }), P({ stopped: "x", unsure: true })]), true],
    ["a lone part stopped, no flag (a record kept before it)", m([P({ ids: [], stopped: "x" })]), true],
    ["control: a lone part that came back", m([P({ ends: { "pocket-send:a": "refunded" } })]), false],
    ["control: a later part that never started, with no unknown part", m([P({}), P({ chain: "bsc", ids: [], stopped: "Didn't start. It's still in Private." })]), false],
    ["control: nothing stopped", m([P({})]), false],
    ["control: no parts", m([]), false],
  ];
  for (const [name, x, want] of unsure) assert.equal(privUnsure(x), want, name);
  const missed: [string, ReturnType<typeof m>, string[]][] = [
    ["stopped", m([P({ stopped: "x" }), P({ chain: "bsc" })]), ["sol"]],
    ["came back", m([P({ ends: { "pocket-send:a": "refunded" } })]), ["sol"]],
    ["a problem end", m([P({ ends: { "pocket-send:a": "problem" } })]), ["sol"]],
    ["the NEAR wallet's part", m([P({ chain: "near", stopped: "x" })]), ["near"]],
    ["control: paid", m([P({ ends: { "pocket-send:a": "done" } })]), []],
    ["control: no chain named", m([P({ chain: undefined, stopped: "x" })]), []],
  ];
  for (const [name, x, want] of missed) assert.deepEqual(privMissed(x), want, name);
  const landed: [string, ReturnType<typeof m>, string[]][] = [
    ["moving, a part stopped: never landed", m([P({ stopped: "x" }), P({ chain: "bsc" })]), []],
    ["moving, a part came back: never landed", m([P({ ends: { "pocket-send:a": "refunded" } })]), []],
    ["done, one stopped: only the other", m([P({}), P({ chain: "bsc", stopped: "x" })], "done"), ["sol"]],
    ["done, an older build's parts with no chain: its legs", m([P({ chain: undefined })], "done", [{ chain: "sol", usd: 6, sent: true }]), ["sol"]],
    ["done, a stopped part's leg too: never its leg", m([P({}), P({ chain: "bsc", stopped: "x" })], "done", [{ chain: "sol", usd: 3 }, { chain: "bsc", usd: 5 }]), ["sol"]],
    ["control: done, all paid", m([P({}), P({ chain: "bsc" })], "done"), ["sol", "bsc"]],
  ];
  for (const [name, x, want] of landed) assert.deepEqual(privLanded(x), want, name);
});

test("the job's own decisions (live-steps): no Try again on `unsure`; a `missed` landing step is failed beside a part that went, waiting once the row ended (controls)", () => {
  const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "mv-k", kind: "top-up", usd: "5.00", status: "failed", shown: true, atIso: new Date(0).toISOString(), words: "Didn't move $5.00 to your SOL wallet", goesTo: ["sol"], via: "private", note: "ZeroFee hit a problem on its side. Check Activity before you try again.", ...o } as SpendingActivity);
  assert.ok(!tries(moveTrack(row({ unsure: true }) as never, undefined, undefined)!).includes(TRY), "unsure: Activity only");
  assert.ok(tries(moveTrack(row({}) as never, undefined, undefined)!).includes(TRY), "control: no flag, as before");
  const two = (o: Partial<SpendingActivity>) => lands(moveTrack(row({ usd: "8.00", goesTo: ["sol", "bsc"], words: "Moving $8.00 to your wallets", ...o }) as never, undefined, undefined)!).map((x) => x[1]);
  assert.deepEqual(two({ status: "on-its-way", note: undefined, missed: ["bsc"] }), ["waiting", "failed"], "on its way: BNB's stop shows at once");
  assert.deepEqual(two({ status: "done", note: "BNB Chain: x", landed: ["sol"], missed: ["bsc"] }), ["done", "failed"], "done: never a tick on BNB");
  assert.deepEqual(two({ status: "failed", missed: ["sol", "bsc"] }), ["waiting", "waiting"], "ended: the paying step failed; nothing landed");
  assert.deepEqual(two({ status: "done", note: undefined, landed: ["sol", "bsc"] }), ["done", "done"], "control: both landed");
});
