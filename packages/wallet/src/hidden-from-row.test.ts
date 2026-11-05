// V4 Send: Hidden FROM the SOL row (ledger.hiddenFromRow). Leg 2 is submitted ONLY after 1Click says leg 1 landed in
// Hidden with enough; back, short or slow: never submitted, the money is in your private balance, said in a line.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { createSendJobs, type SendJob } from "./send-job.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Movement } from "./types.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const RELAY = "https://quotes.example";
const SOL_IN = "nep141:sol.omft.near";
const PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const IN_DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OUT = "d".repeat(64);
const IN_TAG = "leg-one-status-tag-0001";

function setup(o: { leg1Status: string[]; landed?: string; leg2In?: string; minOut?: string; declined?: boolean; unsent?: boolean; unconfirmed?: string; noTag?: boolean }, ov: { submitIntent?: (via: string, signed: unknown) => Promise<{ intentHash: string }>; outStatus?: () => string; now?: () => number } = {}) {
  const core = fakeCore({ accountId: ME, subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const calls: { method: string; p: any }[] = [];
  const bridge: Bridge = {
    call: async (method: string, p?: any) => {
      if (method === "subwallet.private.quoteIn") return (calls.push({ method, p }), { ok: { depositAddress: IN_DEPOSIT, amountIn: p.amount, minAmountOut: o.minOut ?? ((BigInt(p.amount) * 99n) / 100n).toString(), deadlineIso: new Date(Date.now() + 86_400_000).toISOString(), ...(o.noTag ? {} : { statusTag: IN_TAG }) } });
      if (method === "subwallet.hiddenFromRow") {
        calls.push({ method, p });
        if (o.declined) return { ok: { declined: true } };
        if (o.unconfirmed) return { ok: { leg1: { status: "problem", problem: { code: o.unconfirmed, whatHappened: "Not confirmed yet.", money: { state: "moving" }, next: { kind: "nothing", label: "Go back" } } } } };
        return { ok: o.unsent ? { leg1: { status: "problem", problem: { code: "security.subwallet.not-sent", whatHappened: "Solana didn't take it.", money: { state: "safe" }, next: { kind: "nothing", label: "Go back" } } } } : { leg1: { status: "done", explorerUrl: "https://solscan.io/tx/x" }, signedData: { signature: "sig" } } };
      }
      return core.call(method, p);
    },
    on: core.on.bind(core),
  } as Bridge;
  const submitted: unknown[] = [];
  /** The payment's quotes as asked, and every leg 1 read and payment submit, in order. */
  const asked: any[] = [];
  const log: string[] = [];
  let leg1Read = 0;
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const apis: Apis = {
    ...base,
    // EXACT_INPUT (the normal Send): 1Click takes exactly the amount asked; EXACT_OUTPUT (a request): its price
    quote: async (req: any) => (asked.push(req), { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.swapType === "EXACT_INPUT" ? req.amount : (o.leg2In ?? "48000000"), amountOut: req.amount, minAmountOut: req.amount, ...(req.dry ? { amountInUsd: "3.00", amountOutUsd: req.depositType === "ORIGIN_CHAIN" ? "2.99" : "2.71" } : {}) }, zerofeeStatusTag: "tag-for-this-quote-0001" }) as any,
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: ov.submitIntent ?? (async (_via, signed) => (log.push("submit"), submitted.push(signed), { intentHash: "h" })),
    // as the relay answers (relay.mjs): the full record, what arrived included, only with the quote's own tag
    status: async (a: string, _via?: string, tag?: string) => {
      if (a === IN_DEPOSIT) {
        const s = o.leg1Status[Math.min(leg1Read++, o.leg1Status.length - 1)]!;
        log.push(`leg1:${s}`);
        return { status: s, ...(tag === IN_TAG ? { swapDetails: { amountOut: o.landed ?? "999999999999999999999999" } } : {}) } as any;
      }
      return { status: ov.outStatus ? ov.outStatus() : "SUCCESS" } as any;
    },
  };
  const make = () => createLedgerService({ bridge, chain: fakeNear(ME, { ledger: {} }), apis, routes: { intents: false, nearOrigin: true }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, ...(ov.now ? { now: ov.now } : {}) });
  const ledger = make();
  return { ledger, calls, submitted, asked, log, restart: make, core };
}
const ask = { chain: "sol", toTokenId: SOL_IN, to: { kind: "chain", chain: "sol", address: PAYEE }, amountOut: "0.05", caller: "wallet" };
const settled = (ledger: Bridge, id: string) => new Promise<Movement>((res) => ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => { if (movement.id === id && movement.status !== "moving") res(movement); }));
const wait = async (ledger: Bridge, id: string) => {
  for (let i = 0; i < 200; i++) {
    const r = await ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
    const m = "ok" in r ? r.ok.find((x) => x.id === id) : undefined;
    if (m && (m.status !== "moving" || m.problem)) return m;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error("never settled");
};
/** Activity, read until the Send's movement has this status (the follower's own ticks; no wall clock asserted). */
const settledTo = async (ledger: Bridge, id: string, status: Movement["status"]) => {
  for (let i = 0; i < 400; i++) {
    const r = await ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
    const m = "ok" in r ? r.ok.find((x) => x.id === id) : undefined;
    if (m?.status === status) return m;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error(`never ${status}`);
};

test("leg 1 lands, then leg 2 is submitted once and followed to done; leg 1 brings leg 2 and 3 % more", async () => {
  const { ledger, calls, submitted } = setup({ leg1Status: ["PENDING_DEPOSIT", "SUCCESS"] });
  const r = await ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.equal(calls[0]!.p.amount, ((48000000n * 10300n + 9999n) / 10000n).toString(), "leg 1 = leg 2's price + 3 %");
  assert.equal(calls[0]!.p.outside, true);
  assert.equal(calls[1]!.method, "subwallet.hiddenFromRow");
  assert.deepEqual([calls[1]!.p.inDeposit, calls[1]!.p.outDeposit], [IN_DEPOSIT, OUT]);
  const m = await wait(ledger, r.ok.id);
  assert.equal(m.status, "done");
  assert.deepEqual(submitted, [{ signature: "sig" }], "leg 2 submitted exactly once, after leg 1");
  void settled;
});

test("leg 1 comes back: leg 2 is never submitted; the line says the money is in your private balance", async () => {
  const { ledger, submitted } = setup({ leg1Status: ["PENDING_DEPOSIT", "REFUNDED"] });
  const r = await ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in r);
  const m = await wait(ledger, r.ok.id);
  assert.equal(m.status, "problem");
  assert.equal(m.problem?.whatHappened, "The SOL came back. Nothing was paid.");
  assert.deepEqual(submitted, []);
});

test("leg 1 lands short: leg 2 is never submitted; the money stays in your private balance, said (control: exactly enough goes)", async () => {
  const short = setup({ leg1Status: ["SUCCESS"], landed: "47999999" });
  const r = await short.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in r);
  const m = await wait(short.ledger, r.ok.id);
  assert.equal(m.problem?.whatHappened, "Less SOL arrived than the payment needs, so nothing was paid.");
  assert.deepEqual(short.submitted, []);
  const enough = setup({ leg1Status: ["SUCCESS"], landed: "48000000" });
  const e = await enough.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in e);
  assert.equal((await wait(enough.ledger, e.ok.id)).status, "done");
  assert.equal(enough.submitted.length, 1);
});

test("before any sheet: a leg 1 minimum short of leg 2 is refused (the core is never asked); a No, or leg 1 not sent, moves nothing", async () => {
  const tight = setup({ leg1Status: ["SUCCESS"], minOut: "47000000" });
  const r = await tight.ledger.call("ledger.hiddenFromRow", ask);
  assert.ok("problem" in r);
  assert.ok(!tight.calls.some((c) => c.method === "subwallet.hiddenFromRow"), "the core's sheet never rose");
  const no = setup({ leg1Status: ["SUCCESS"], declined: true });
  const n = await no.ledger.call("ledger.hiddenFromRow", ask);
  assert.ok("problem" in n && /declined/.test(n.problem.code));
  assert.deepEqual(no.submitted, []);
  const unsent = setup({ leg1Status: ["SUCCESS"], unsent: true });
  const u = await unsent.ledger.call("ledger.hiddenFromRow", ask);
  assert.ok("problem" in u && u.problem.whatHappened === "Solana didn't take it.");
  assert.ok(!unsent.calls.some((c) => c.method === "x"), "no movement left moving");
  assert.deepEqual(unsent.submitted, []);
  const other = setup({ leg1Status: ["SUCCESS"] });
  const p = await other.ledger.call("ledger.hiddenFromRow", { ...ask, caller: "pay" });
  assert.ok("problem" in p && p.problem.code === "ledger.caller.refused", "Wallet's own Send only");
});

test("security review H1: a restart follows the saved Send again, never 'nothing was paid'; one with no job left is unknown, never unpaid", async () => {
  const a = setup({ leg1Status: ["PENDING_DEPOSIT"] });
  const r = await a.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in r);
  assert.ok(JSON.parse(a.core.store.get("send-jobs")!)[r.ok.id], "the Send is a saved job on this device, its payment kept for the follower");
  // the same device storage, a fresh ledger (an app restart): the saved job is followed again, still on its way
  const again = await a.restart().call<Movement[]>("ledger.activity", { caller: "wallet" });
  const m = "ok" in again ? again.ok.find((x) => x.id === r.ok.id) : undefined;
  assert.equal(m?.status, "moving", "after a restart: still on its way, followed again");
  assert.doesNotMatch(JSON.stringify(m), /nothing was paid/i);
  assert.deepEqual(a.submitted, [], "leg 1 hasn't landed: the payment isn't handed over");
  // an older Send (its payment was kept in memory only): after a restart its outcome is unknown, and said so
  const b = setup({ leg1Status: ["PENDING_DEPOSIT"] });
  const s = await b.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in s);
  b.core.store.set("send-jobs", "{}");
  const later = await b.restart().call<Movement[]>("ledger.activity", { caller: "wallet" });
  const old = "ok" in later ? later.ok.find((x) => x.id === s.ok.id) : undefined;
  assert.deepEqual([old?.status, old?.problem?.whatHappened, old?.problem?.next.kind], ["moving", "It may have gone. Activity will say.", "wait"], "control: no job, so unknown: never 'nothing was paid', never Try again");
});

test("security review H1: the payment's submit errors after 1Click took it: never 'nothing was paid'; the payment's own status says how it ended", async () => {
  let outStatus = "PROCESSING";
  // 1Click takes it, but the answer never comes back (a timeout at the relay)
  const taken: unknown[] = [];
  const y = setup({ leg1Status: ["SUCCESS"], landed: "48000000" }, {
    submitIntent: async (_via: string, signed: unknown) => { taken.push(signed); throw new Error("timed out"); },
    outStatus: () => outStatus,
  });
  const r = await y.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in r);
  const m = await wait(y.ledger, r.ok.id);
  assert.deepEqual([m.status, m.problem?.whatHappened, m.problem?.next.kind], ["moving", "It may have gone. Activity will say.", "wait"]);
  assert.equal(JSON.parse(y.core.store.get("send-jobs")!)[r.ok.id]?.handed, true, "marked handed over on the device before the submit");
  assert.equal(taken.length, 1, "handed over once");
  // the payment's own status ends it: SUCCESS is paid
  outStatus = "SUCCESS";
  const done = await settledTo(y.ledger, r.ok.id, "done");
  assert.equal(done.problem, undefined);
  // control: refunded is "not paid", and only then
  const z = setup({ leg1Status: ["SUCCESS"], landed: "48000000" }, { submitIntent: async () => { throw new Error("timed out"); }, outStatus: () => "REFUNDED" });
  const q = await z.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in q);
  const notPaid = await settledTo(z.ledger, q.ok.id, "problem");
  assert.equal(notPaid.problem?.whatHappened, "It wasn't paid. The money came back to you.");
});

test("security review M2: the 'less arrived' check runs as the relay really answers: leg 1 is read with its own tag; a SUCCESS with no figure waits, never goes (control: with the tag it goes)", async () => {
  // the relay's real answer without the tag: { status } only (relay.mjs), so nothing says what arrived
  const stripped = setup({ leg1Status: ["SUCCESS"], noTag: true });
  const r = await stripped.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in r);
  await new Promise((res) => setTimeout(res, 40));
  const list = await stripped.ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
  assert.equal("ok" in list && list.ok.find((m) => m.id === r.ok.id)?.status, "moving", "still waiting for a figure");
  assert.deepEqual(stripped.submitted, [], "no figure, no payment: leg 2 never handed over on a bare SUCCESS");
  // control: the core gave leg 1's tag, the read carries it, the relay answers what arrived, and it goes
  const tagged = setup({ leg1Status: ["SUCCESS"] });
  const t = await tagged.ledger.call<Movement>("ledger.hiddenFromRow", ask);
  assert.ok("ok" in t);
  assert.equal((await wait(tagged.ledger, t.ok.id)).status, "done");
  assert.equal(tagged.submitted.length, 1);
  // the read itself: the tag goes as the header the relay checks, and only to the relay (never 1Click's own address)
  const seen: { url: string; tag?: string }[] = [];
  const apis = createApis((async (url: string, init?: RequestInit) => (seen.push({ url, tag: (init?.headers as Record<string, string> | undefined)?.["x-zerofee-status-tag"] }), new Response(JSON.stringify({ status: "SUCCESS" })))) as typeof fetch);
  await apis.status("addr", `${RELAY}/v0`, IN_TAG);
  await apis.status("addr", undefined, IN_TAG);
  assert.deepEqual(seen.map((s) => s.tag), [IN_TAG, undefined]);
});

test("D137: the payment is handed over in the same step that reads leg 1 landed, for exactly what leg 1 delivered (control: a job saved with the old wait goes at once too)", async () => {
  // the ledger's clock never moves here: a wait of ours could never end, so a payment that goes, went without one
  const FROZEN = Date.now();
  // 0.05 SOL in; leg 1's signed minimum is 99 % of it, and that is exactly what lands in the pocket
  const MIN = "49500000";
  const w = setup({ leg1Status: ["PENDING_DEPOSIT", "SUCCESS"], landed: MIN }, { now: () => FROZEN });
  const r = await w.ledger.call<Movement>("ledger.hiddenFromRow", { chain: "sol", toTokenId: SOL_IN, to: { kind: "chain", chain: "sol", address: PAYEE }, amountIn: "0.05", caller: "wallet" });
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual(w.asked.filter((q) => !q.dry).map((q) => [q.swapType, q.amount]), [["EXACT_INPUT", MIN]], "the payment is for exactly what leg 1 delivers, never trimmed");
  assert.equal((await settledTo(w.ledger, r.ok.id, "done")).status, "done");
  assert.deepEqual(w.log.slice(w.log.indexOf("leg1:SUCCESS")), ["leg1:SUCCESS", "submit"], "handed over in the step that read leg 1 landed: no second read, no wait");
  assert.deepEqual(w.submitted, [{ signature: "sig" }], "once");
  // control: a Send an older version saved with its random wait (and the time it may go, an hour ahead on the frozen
  // clock) is handed over on its first read that says leg 1 landed, too: the old wait no longer holds it
  const kv = new Map<string, string>();
  const old: SendJob & { delayMs: number; notBefore: number } = { id: "hidden-row:old", inDeposit: IN_DEPOSIT, inTag: IN_TAG, outDeposit: OUT, signedData: { signature: "old" }, coinId: SOL_IN, leg2In: MIN, coin: "SOL", startedAtIso: "", delayMs: 5 * 60_000, notBefore: FROZEN + 3_600_000 };
  kv.set("send-jobs", JSON.stringify({ [old.id]: old }));
  let movements = [{ id: old.id, kind: "pay", status: "moving", from: SOL_IN, to: PAYEE, amount: "0.05", startedAtIso: "", updatedAtIso: "", explorerUrls: [] } as unknown as Movement];
  const seen: string[] = [];
  const jobs = createSendJobs({
    apis: { status: async (a: string) => (a === IN_DEPOSIT ? (seen.push("leg1:SUCCESS"), { status: "SUCCESS", swapDetails: { amountOut: MIN } }) : { status: "SUCCESS" }), submitIntent: async () => (seen.push("submit"), { intentHash: "h" }) } as never,
    relayed: RELAY, remember: async (m) => void (movements = [m, ...movements.filter((y) => y.id !== m.id)]), note: async () => undefined, forget: async () => undefined,
    loadMovements: async () => movements, emit: () => undefined, stored: async (k) => kv.get(k) ?? null, store: async (k, v) => void kv.set(k, v), serially: (f) => f(), iso: () => "", now: () => FROZEN, trackMs: 1,
  });
  await jobs.resume(["hidden-row:"]);
  for (let i = 0; i < 200 && movements.find((m) => m.id === old.id)!.status === "moving"; i++) await new Promise((res) => setTimeout(res, 2));
  assert.deepEqual([movements.find((m) => m.id === old.id)!.status, seen.slice(0, 2)], ["done", ["leg1:SUCCESS", "submit"]], "control: the old wait is ignored");
});

// ETH (RH): the same follow, the row's coin a parameter (nep141:hood.omft.near), its lines in ETH.
const HOOD_IN = "nep141:hood.omft.near";
const hoodAsk = { chain: "hood", toTokenId: HOOD_IN, to: { kind: "chain", chain: "hood", address: "0x12345678901234567890123456789012345678ab" }, amountOut: "0.0019", caller: "wallet" };

test("ETH (RH): leg 1 is the row's ETH into Hidden (its own coin, its own chain), leg 2 submitted once after it lands", async () => {
  const { ledger, calls, submitted } = setup({ leg1Status: ["PENDING_DEPOSIT", "SUCCESS"], leg2In: "1950000000000000" });
  const r = await ledger.call<Movement>("ledger.hiddenFromRow", hoodAsk);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual([calls[0]!.method, calls[0]!.p.tokenId, calls[0]!.p.outside], ["subwallet.private.quoteIn", HOOD_IN, true]);
  assert.equal(calls[0]!.p.amount, ((1950000000000000n * 10300n + 9999n) / 10000n).toString(), "leg 1 = leg 2's price + 3 %");
  assert.equal(calls[1]!.p.chain, "hood");
  assert.equal(r.ok.from, HOOD_IN);
  assert.equal((await wait(ledger, r.ok.id)).status, "done");
  assert.deepEqual(submitted, [{ signature: "sig" }]);
});

test("ETH (RH): back, landed short (control: exactly enough goes), or after a restart: never submitted, said in ETH", async () => {
  const back = setup({ leg1Status: ["PENDING_DEPOSIT", "REFUNDED"] });
  const b = await back.ledger.call<Movement>("ledger.hiddenFromRow", hoodAsk);
  assert.ok("ok" in b);
  assert.equal((await wait(back.ledger, b.ok.id)).problem?.whatHappened, "The ETH came back. Nothing was paid.");
  assert.deepEqual(back.submitted, []);
  const short = setup({ leg1Status: ["SUCCESS"], landed: "47999999" });
  const s = await short.ledger.call<Movement>("ledger.hiddenFromRow", hoodAsk);
  assert.ok("ok" in s);
  assert.equal((await wait(short.ledger, s.ok.id)).problem?.whatHappened, "Less ETH arrived than the payment needs, so nothing was paid.");
  assert.deepEqual(short.submitted, []);
  const enough = setup({ leg1Status: ["SUCCESS"], landed: "48000000" });
  const e = await enough.ledger.call<Movement>("ledger.hiddenFromRow", hoodAsk);
  assert.ok("ok" in e);
  assert.equal((await wait(enough.ledger, e.ok.id)).status, "done");
  assert.equal(enough.submitted.length, 1);
  const a = setup({ leg1Status: ["PENDING_DEPOSIT"] });
  const r = await a.ledger.call<Movement>("ledger.hiddenFromRow", hoodAsk);
  assert.ok("ok" in r);
  const again = await a.restart().call<Movement[]>("ledger.activity", { caller: "wallet" });
  const m = "ok" in again ? again.ok.find((x) => x.id === r.ok.id) : undefined;
  assert.equal(m?.status, "moving", "after a restart: the saved Send is followed again (H1), never said unpaid");
  assert.equal(m?.problem, undefined);
  assert.deepEqual(a.submitted, []);
});

test("ETH (RH): a leg 1 minimum short of leg 2 is refused before the core is asked; a No or not sent moves nothing; other rows refused", async () => {
  const tight = setup({ leg1Status: ["SUCCESS"], minOut: "47000000" });
  assert.ok("problem" in (await tight.ledger.call("ledger.hiddenFromRow", hoodAsk)));
  assert.ok(!tight.calls.some((c) => c.method === "subwallet.hiddenFromRow"), "the core's sheet never rose");
  const no = setup({ leg1Status: ["SUCCESS"], declined: true });
  const n = await no.ledger.call("ledger.hiddenFromRow", hoodAsk);
  assert.ok("problem" in n && /declined/.test(n.problem.code));
  const unsent = setup({ leg1Status: ["SUCCESS"], unsent: true });
  assert.ok("problem" in (await unsent.ledger.call("ledger.hiddenFromRow", hoodAsk)));
  assert.deepEqual([no.submitted, unsent.submitted], [[], []]);
  const bnb = setup({ leg1Status: ["SUCCESS"] });
  const x = await bnb.ledger.call("ledger.hiddenFromRow", { ...hoodAsk, chain: "bsc" });
  assert.ok("problem" in x && /only from your SOL wallet or your ETH \(RH\) wallet/.test(JSON.stringify(x.problem)));
  assert.ok(!bnb.calls.length, "nothing asked of the core");
});

test("leg 1 sent but not seen done by both nodes (security review M): Activity keeps it, said plainly; leg 2 never submitted (control: not sent leaves no row)", async () => {
  for (const code of ["security.subwallet.unconfirmed", "security.nodes.disagree"]) {
    const x = setup({ leg1Status: ["SUCCESS"], unconfirmed: code });
    const r = await x.ledger.call("ledger.hiddenFromRow", hoodAsk);
    assert.ok("problem" in r && r.problem.code === "ledger.hidden-row.slow", code);
    const list = await x.ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
    const m = "ok" in list ? list.ok.find((y) => y.id.startsWith("hidden-row:")) : undefined;
    assert.equal(m?.status, "problem", `${code}: in Activity`);
    assert.match(m?.problem?.whatHappened ?? "", /the ETH reached your private balance, so nothing was paid\. Your money is there or on its way\.$/);
    assert.deepEqual(x.submitted, []);
  }
  const unsent = setup({ leg1Status: ["SUCCESS"], unsent: true });
  await unsent.ledger.call("ledger.hiddenFromRow", hoodAsk);
  const list = await unsent.ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
  assert.ok("ok" in list && !list.ok.some((y) => y.id.startsWith("hidden-row:")), "nothing left the row: no row in Activity");
});

test("a token from the SOL wallet (USDC): leg 1 is priced and sent as USDC, the core told its coin; an unpinned coin asks nothing (control: SOL)", async () => {
  const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
  const t = setup({ leg1Status: ["PENDING_DEPOSIT", "SUCCESS"] });
  const r = await t.ledger.call<Movement>("ledger.hiddenFromRow", { ...ask, coin: USDC_SOL, amountOut: undefined, amountIn: "5" });
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal(t.calls[0]!.p.tokenId, USDC_SOL, "leg 1 priced in USDC on Solana");
  assert.equal(t.calls[0]!.p.amount, "5000000", "5 USDC at 6 places");
  assert.equal(t.calls[1]!.p.coin, USDC_SOL, "the core is told the coin it sends");
  assert.equal(t.asked[0]!.originAsset, USDC_SOL, "leg 2 pays from the USDC leg 1 brings");
  const off = setup({ leg1Status: ["SUCCESS"] });
  const no = await off.ledger.call<Movement>("ledger.hiddenFromRow", { ...ask, coin: "nep141:sol-2dc7b64e5dd3c717fc85abaf51cdcd4b18687f09.omft.near", amountOut: undefined, amountIn: "5" });
  assert.ok("problem" in no && /Private can't take this yet/.test(JSON.stringify(no.problem)));
  assert.equal(off.calls.length, 0, "nothing priced, nothing asked of the core");
  const control = setup({ leg1Status: ["PENDING_DEPOSIT", "SUCCESS"] });
  assert.ok("ok" in (await control.ledger.call<Movement>("ledger.hiddenFromRow", ask)));
  assert.equal(control.calls[0]!.p.tokenId, SOL_IN);
  assert.equal(control.calls[1]!.p.coin, undefined, "the wallet's own coin: no coin named");
});

test("the fee before the tap (ledger.sendFee): both legs priced DRY as the Send would ask them, nothing signed, kept or sent; null when there is no private balance yet", async () => {
  const { ledger, calls, asked, submitted } = setup({ leg1Status: ["PENDING_DEPOSIT"] });
  const f = await ledger.call<{ inUsd: string; outUsd: string } | null>("ledger.sendFee", { caller: "wallet", chain: "sol", to: { kind: "chain", chain: "sol", address: PAYEE }, toTokenId: SOL_IN, amountIn: "0.03" });
  assert.deepEqual("ok" in f && f.ok, { inUsd: "3.00", outUsd: "2.71" }, "what leaves (leg 1) and what they get (leg 2), as 1Click says");
  assert.equal(asked.length, 2);
  assert.ok(asked.every((q) => q.dry === true), "both dry");
  const { DRY_POCKET, DRY_PAYEE } = await import("./hidden-row.ts");
  assert.deepEqual([asked[0].depositType, asked[0].originAsset, asked[0].destinationAsset, asked[0].recipientType], ["ORIGIN_CHAIN", SOL_IN, SOL_IN, "CONFIDENTIAL_INTENTS"], "leg 1: the wallet's coin into the private side");
  assert.deepEqual([asked[1].depositType, asked[1].amount], ["CONFIDENTIAL_INTENTS", asked[0].amount], "leg 2: leg 1's own amount out");
  // QA's MUST: no dry request carries the person's private balance or their payee, only the stand-ins
  const stand = new Set([DRY_POCKET, ...Object.values(DRY_PAYEE)]);
  for (const q of asked) {
    for (const k of ["recipient", "refundTo"]) assert.ok(stand.has(q[k]), `${k} ${q[k]} is a stand-in`);
    assert.doesNotMatch(JSON.stringify(q), new RegExp(`${POCKET}|${PAYEE}`), "neither the pocket nor the payee anywhere in it");
  }
  assert.equal(asked[1].recipient, DRY_PAYEE.sol);
  assert.equal(calls.length, 0, "nothing asked of the core (no quote kept, nothing signed)");
  assert.equal(submitted.length, 0);
  // controls: only Wallet asks; a coin the core doesn't pin, or nothing to send, is no figure
  assert.ok("problem" in (await ledger.call("ledger.sendFee", { caller: "trade", chain: "sol", to: { kind: "chain", chain: "sol", address: PAYEE }, amountIn: "0.03" })));
  for (const bad of [{ coin: "nep141:sol-2dc7b64e5dd3c717fc85abaf51cdcd4b18687f09.omft.near", amountIn: "1" }, { amountIn: "0" }]) {
    const r = await ledger.call("ledger.sendFee", { caller: "wallet", chain: "sol", to: { kind: "chain", chain: "sol", address: PAYEE }, ...bad });
    assert.equal("ok" in r && r.ok, null, JSON.stringify(bad));
  }
});

test("QA's MUST, the control: the real Send (after the tap) still asks with the real pocket and payee; every stand-in passes its chain's own check", async () => {
  const { ledger, asked } = setup({ leg1Status: ["PENDING_DEPOSIT"] });
  await ledger.call("ledger.hiddenFromRow", ask);
  const real = asked.filter((q) => q.dry === false);
  assert.ok(real.some((q) => q.recipient === PAYEE && q.refundTo === POCKET), "the payment: the real payee, refunds to the real pocket");
  const { DRY_POCKET, DRY_PAYEE } = await import("./hidden-row.ts");
  const { validSendAddress } = await import("./send-reach.ts");
  const { LANDS_AS } = await import("./send-to.ts");
  for (const c of Object.keys(LANDS_AS)) if (c !== "near") assert.ok(validSendAddress(c, DRY_PAYEE[c]!), `${c}: ${DRY_PAYEE[c]} is a real ${c} address`);
  assert.match(DRY_POCKET, /^[0-9a-f]{64}$/);
});
