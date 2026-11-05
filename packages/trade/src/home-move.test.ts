// Home's Move and Swap on the one private engine (the Home plan §2, E5 and E7; §4's private gap). E5: one wallet's coin to
// another wallet (SOL → ETH (RH)) is ONE saved job: a move in to Trading's confidential balance, then a move out once the
// first landed and its gap passed. A restart resumes it from the journal; the same key gives no second job; a refund of the
// first leg lands in Trading's own balance and the second never starts. E7: the Safe's NEAR → USDC in the Safe is the Add
// (NEAR converted inside its own quote, one Face ID), then that USDC home after its gap, once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { LEG_GAP_MS } from "./float.ts";
import { NOT_STARTED } from "./float-jobs.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
// the mock's moves land on real 10 ms timers: 120 ms leaves room on a busy machine (a 40 ms wait failed once under load)
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const units = (chain: "sol" | "hood", usd: number) => (chain === "sol" ? BigInt(Math.round((usd / PX.sol) * 1e9)) : BigInt(Math.round((usd / PX.hood) * 1e9)) * 10n ** 9n);
const KEY = "home-move-0123456789ab";

type Asked = { method: string; params: Record<string, unknown> };
async function setup(o: { outcome?: "done" | "refunded" | "failed"; journal?: Map<string, unknown>; mock?: ReturnType<typeof createMockBridge>; asked?: Asked[]; drop?: { in?: boolean }; clock?: { t: number }; failWrite?: (key: string, value: unknown) => boolean; homeProof?: boolean } = {}) {
  const held = { "sw-trade-sol": units("sol", 60).toString(), "sw-trade-hood": units("hood", 30).toString() };
  const mock = o.mock ?? createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 5, held, ...(o.outcome ? { outcome: o.outcome } : {}) } });
  const asked = o.asked ?? [];
  const drop = o.drop ?? {};
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (/^ledger\.toTrading$|^subwallet\.float\.(out|in|home|swap)$/.test(method)) asked.push({ method, params });
    const r = await mock.call<any>(method, params);
    // the phone dies with the call made and its answer lost: the move may have been made
    if (method === "subwallet.float.in" && drop.in) { drop.in = false; throw new Error("the connection dropped"); }
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  if (!o.mock) for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const clock = o.clock ?? { t: 1_000_000 };
  const journal = o.journal ?? new Map<string, unknown>();
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(journal.get(k)), set: async (k, v) => { if (o.failWrite?.(k, v)) throw new Error("the phone's storage said no"); journal.set(k, structuredClone(v)); }, now: () => clock.t, every: () => () => undefined, rng: () => 0.5 });
  // E5 and E7 run as in the test proof build (review L9), unless a test shuts them
  const svc = createSpendingService({ homeProof: o.homeProof ?? true, engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  // one step of the engine as the app's follow loop takes it: the chain's moves land, then due legs go. It waits for the
  // exact state (no move of the core's still pending), never a fixed time: under a loaded test run 120 ms wasn't always
  // enough for the mock's 10 ms moves (E5 failed once in a full run, 4 Nov)
  const step = async () => { await landed(mock); await f.traded("sol"); };
  return { f, svc, mock, asked, journal, clock, step, later: (ms: number) => { clock.t += ms; } };
}
const coreMoves = async (mock: ReturnType<typeof createMockBridge>) => (await mock.call<{ kind: string; status: string }[]>("subwallet.float.moves", {}) as { ok: { kind: string; status: string }[] }).ok;
/** Until no move of the core's is pending (the mock's timers have ended each), a few event-loop turns at a time. */
async function landed(mock: ReturnType<typeof createMockBridge>): Promise<void> {
  for (;;) {
    if ((await coreMoves(mock)).every((m) => m.status !== "pending")) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("E5: SOL → ETH (RH) is one job: a move in from Solana's wallet, nothing out until it landed AND its private gap passed, then one move out to Robinhood's wallet sized from what arrived; one Activity row says the whole move", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(r.ok.id, KEY);
  assert.match(r.ok.words, /^Moving \$30\.00 from your SOL wallet to your ETH \(RH\) wallet$/);
  assert.deepEqual(s.asked.filter((a) => a.method === "subwallet.float.in").map((a) => [a.params.from, a.params.key]), [["sw-trade-sol", KEY]]);
  assert.equal(s.asked.filter((a) => a.method === "ledger.toTrading").length, 0, "no Safe sheet: money only moves between your own wallets");
  // Home's "On its way" (walk, 3 Nov: "Moving $0.00 to Robinhood Chain"): the move once, by its own words, never its
  // second leg alone, and no leg ever reads $0.00
  const st = await s.svc.call<{ onItsWay: SpendingActivity[] }>("spending.status", {});
  assert.ok("ok" in st);
  assert.deepEqual(st.ok.onItsWay.map((a) => a.id), [KEY]);
  const legs = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in legs && legs.ok.every((a) => a.usd !== "0.00"), JSON.stringify("ok" in legs && legs.ok.map((a) => [a.id, a.usd])));
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 0, "nothing out before the move in landed");
  await s.step();                                                         // D137: the move in landed, the move out goes now
  const outs = s.asked.filter((a) => a.method === "subwallet.float.out");
  assert.deepEqual(outs.map((a) => [a.params.chain, a.params.to, a.params.key]), [["hood", "sw-trade-hood", `${KEY}-2`]], "one move out, to Robinhood's own wallet, keyed from the job");
  // sized from what the move in delivered (the mock's 2 % fee), less the move out's fee room: never Trading's other cash
  const inMove = (await coreMoves(s.mock)).find((m) => m.kind === "in") as unknown as { expected: { amount: string } };
  const arrived = Number(inMove.expected.amount) / 1e6;
  const outUsd = (Number(outs[0]!.params.amount) / 1e18) * PX.hood;
  // D137: what arrived, less only the move out's fee room (no trim)
  assert.ok(outUsd <= arrived / 1.03 + 0.01 && outUsd >= arrived / 1.03 - 0.02, `${outUsd} vs ${arrived / 1.03}`);
  let rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const whole = rows.ok.find((a) => a.id === KEY)!;
  // exact state, never a race with the mock's 10 ms timer: on its way until its second leg lands, done once it has (the
  // wallet's read holding it, D140/D144, or 1Click's word)
  const outLanded = (await coreMoves(s.mock)).some((m) => m.kind === "out" && m.status === "done");
  if (!outLanded) assert.equal(whole.status, "on-its-way", "the move is on its way until its second leg lands");
  else assert.ok(whole.status === "on-its-way" || whole.status === "done", whole.status);
  await s.step(); await s.step();
  rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  assert.equal(rows.ok.find((a) => a.id === KEY)!.status, "done");
  assert.match(rows.ok.find((a) => a.id === KEY)!.words, /^Moved \$30\.00 from your SOL wallet to your ETH \(RH\) wallet$/);
  const { foldLegs } = await import("@zerofee/core/spending-fold");
  const one = foldLegs(rows.ok.filter((a) => a.shown));
  assert.equal(one.filter((a) => a.id === `${KEY}-2`).length, 0, "the second leg folds under the move's own row");
});

test("E5 restart: the phone dies with the move in sent and its answer lost; a fresh engine on the same journal asks again with the same key (the core answers with the same move), then sends the second leg once (control: an empty journal resumes nothing)", async () => {
  const journal = new Map<string, unknown>();
  const asked: Asked[] = [];
  const clock = { t: 1_000_000 };
  const a = await setup({ journal, asked, clock, drop: { in: true } });
  const r = await a.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  const saved = (journal.get("float.jobs.v1") as { id: string; state: string }[]).map((j) => [j.id, j.state]);
  assert.deepEqual(saved, [[KEY, "asked"], [`${KEY}-2`, "planned"]], "both legs saved before anything moved, the first as asked");
  // the app is gone; a new engine on the same journal and the same core
  const b = await setup({ journal, asked, clock, mock: a.mock });
  await b.step(); await b.step();
  const ins = asked.filter((x) => x.method === "subwallet.float.in");
  assert.equal(ins.length, 2, "asked again after the restart…");
  assert.ok(ins.every((x) => x.params.key === KEY), "…with the same key");
  assert.equal((await coreMoves(a.mock)).filter((m) => m.kind === "in").length, 1, "the core made the move in once");
  b.later(LEG_GAP_MS[1] + 1); await b.step(); await b.step();
  assert.equal(asked.filter((x) => x.method === "subwallet.float.out").length, 1, "the second leg went once");
  // control: the same death with no journal carried over resumes nothing (the journal is what carries the second leg)
  const askedC: Asked[] = [];
  const c1 = await setup({ asked: askedC, drop: { in: true } });
  await c1.svc.call("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  const c2 = await setup({ asked: askedC, mock: c1.mock, clock: c1.clock });
  for (let i = 0; i < 3; i++) { c2.later(LEG_GAP_MS[1] + 1); await c2.step(); }
  assert.equal(askedC.filter((x) => x.method === "subwallet.float.out").length, 0, "control: without the journal no second leg");
});

test("E5 refund: the first leg comes back to Trading's own balance (its refund address), so the second leg never starts; the move's row says where the money is, once (control: a first leg that lands sends the second)", async () => {
  const s = await setup({ outcome: "refunded" });
  const r = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  for (let i = 0; i < 4; i++) { s.later(LEG_GAP_MS[1] + 1); await s.step(); }
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 0, "the second leg never started");
  const bal = (await s.mock.call<{ tokens: { tokenId: string; amount: string }[] }>("subwallet.float.balance", {}) as { ok: { tokens: { tokenId: string; amount: string }[] } }).ok;
  assert.ok(bal.tokens.some((t) => t.tokenId === "nep141:sol.omft.near" && BigInt(t.amount) > 0n), "the refund is in Trading's own balance, as SOL");
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const mine = rows.ok.filter((a) => a.id === KEY || a.id === `${KEY}-2`);
  assert.deepEqual(mine.map((a) => a.status), ["refunded"], "one row, the move's own");
  // review L5: it says it didn't move, as a move of its own kind (control: a landed move says "Moved", the first test)
  assert.equal(mine[0]!.kind, "move");
  assert.match(mine[0]!.words, /^Didn't move \$30\.00 from your SOL wallet to your ETH \(RH\) wallet$/);
  assert.match(mine[0]!.note ?? "", /your NEAR wallet/);
  assert.doesNotMatch(mine[0]!.note ?? "", /Trading|Hidden|\brow\b|ETH on Robinhood/, "the Agent app's words");
  // the runner's own words for the leg that never started
  const second = (s.journal.get("float.jobs.v1") as { id: string; state: string; note?: string; stayed?: boolean }[]).find((j) => j.id === `${KEY}-2`)!;
  assert.deepEqual([second.state, second.stayed, second.note], ["failed", true, NOT_STARTED.refunded]);
  // control
  const c = await setup();
  await c.svc.call("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  for (let i = 0; i < 3; i++) { c.later(LEG_GAP_MS[1] + 1); await c.step(); }
  assert.equal(c.asked.filter((a) => a.method === "subwallet.float.out").length, 1, "control: a landed first leg sends the second");
});

test("E5 key: asking twice with the same key gives the same job, never a second one; the same key for another move is refused before anything moves (control: a new key is a new move)", async () => {
  const s = await setup();
  const one = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 20, key: KEY });
  const two = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 20, key: KEY });
  assert.ok("ok" in one && "ok" in two);
  assert.equal(two.ok.id, one.ok.id);
  for (let i = 0; i < 3; i++) { s.later(LEG_GAP_MS[1] + 1); await s.step(); }
  assert.equal((await coreMoves(s.mock)).filter((m) => m.kind === "in").length, 1, "one move in");
  assert.equal((await coreMoves(s.mock)).filter((m) => m.kind === "out").length, 1, "one move out");
  const other = await s.svc.call("spending.move", { from: "sol", to: "near", usd: 20, key: KEY });
  assert.ok("problem" in other && other.problem.code === "security.request.invalid", JSON.stringify(other));
  const c = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 5, key: "home-move-ffffffffffff" });
  assert.ok("ok" in c && c.ok.id !== one.ok.id, "control: another key, another move");
  await s.step();
  assert.equal((await coreMoves(s.mock)).filter((m) => m.kind === "in").length, 2);
});

test("E5 to and from the NEAR wallet: SOL → NEAR is the move in alone (it stays in Trading's cash); NEAR → SOL is one move out, keyed; the same wallet, a closed chain or under $2 is refused before anything moves", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "near", usd: 10, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  // the mock's move in lands on a real 10 ms timer: on a busy machine it may already have landed when the answer is
  // built ("Moved"), so only what this checks is asserted: the move named from and to (4 Nov: it failed 1 run in 4)
  assert.match(r.ok.words, /^Mov(?:ing|ed) \$10\.00 from your SOL wallet to your NEAR wallet$/);
  for (let i = 0; i < 3; i++) { s.later(LEG_GAP_MS[1] + 1); await s.step(); }
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 0);
  const back = await s.svc.call<SpendingActivity>("spending.move", { from: "near", to: "sol", usd: 4, key: "home-move-near-to-sol-01" });
  assert.ok("ok" in back, JSON.stringify(back));
  await s.f.settle();                                                  // its first step runs after the answer (product decision, 5 Nov)
  assert.deepEqual(s.asked.filter((a) => a.method === "subwallet.float.out").map((a) => [a.params.chain, a.params.key]), [["sol", "home-move-near-to-sol-01"]]);
  const n = s.asked.length;
  for (const [ask, code] of [
    [{ from: "sol", to: "sol", usd: 5, key: "home-move-same-wallet-1" }, "security.request.invalid"],
    [{ from: "sol", to: "bsc", usd: 5, key: "home-move-closed-chain-1" }, "spending.network.closed"],
    [{ from: "sol", to: "hood", usd: 1.5, key: "home-move-too-small-001" }, "spending.move.too-small"],
    // review M1: between two chains, the core's least, $2.65 (control: $30 goes, the move above)
    [{ from: "sol", to: "hood", usd: 2.64, key: "home-move-too-small-002" }, "spending.move.too-small"],
    [{ from: "sol", to: "hood", usd: 5, key: "short" }, "security.request.invalid"],
  ] as const) {
    const no = await s.svc.call("spending.move", ask);
    assert.ok("problem" in no && no.problem.code === code, `${JSON.stringify(ask)} → ${JSON.stringify(no)}`);
  }
  assert.equal(s.asked.length, n, "nothing asked of the core");
});

test("E7: the Safe's NEAR → USDC in the Safe is one Face ID (the Add, paid with NEAR, named a swap), then that USDC home after its private gap, once, keyed; never Trading's other cash (control: an Add without home stays in Trading)", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 6, swap: "NEAR", home: true });
  assert.ok("ok" in r, JSON.stringify(r));
  const add = s.asked.filter((a) => a.method === "ledger.toTrading");
  assert.equal(add.length, 1, "one Approve");
  assert.match(String(add[0]!.params.tokenId), /^(near|nep141:wrap\.near)$/, "paid with the Safe's NEAR");
  assert.match(String(add[0]!.params.label), /^Swap [\d.]+ NEAR for USDC in your Safe$/);
  assert.match(r.ok.words, /^Swapping \$6\.00 of NEAR for USDC in your Safe$/);
  // D137: home goes the moment the Add is in the NEAR wallet, no gap
  await s.step(); await s.f.refresh(); await s.step(); await s.f.refresh(); await s.step();
  const homes = s.asked.filter((a) => a.method === "subwallet.float.home");
  assert.equal(homes.length, 1, "one move home");
  const usd = Number(homes[0]!.params.amount) / 1e6;
  assert.ok(usd >= 2 && usd <= 6, `home sends what the Add brought, never Trading's own $5: ${usd}`);
  // asked again (a second look, a restart's refresh): still one
  for (let i = 0; i < 3; i++) { s.later(LEG_GAP_MS[1] + 1); await s.f.refresh(); await s.step(); }
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.home").length, 1, "never twice");
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  assert.match(rows.ok.find((a) => a.id === r.ok.id)!.words, /^Swapped \$6\.00 of NEAR for USDC in your Safe$/);
  // a swap in the Safe names NEAR, alone
  for (const bad of [{ usd: 6, home: true }, { usd: 6, swap: "NEAR", home: true, legs: [{ network: "sol", usd: 6 }] }, { usd: 6, swap: "NEAR", home: "yes" }]) {
    const no = await s.svc.call("spending.topUp", bad);
    assert.ok("problem" in no && no.problem.code === "security.request.invalid", JSON.stringify(no));
  }
  // control
  const c = await setup();
  await c.svc.call("spending.topUp", { usd: 6, swap: "NEAR" });
  for (let i = 0; i < 3; i++) { c.later(LEG_GAP_MS[1] + 1); await c.f.refresh(); await c.step(); }
  assert.equal(c.asked.filter((a) => a.method === "subwallet.float.home").length, 0, "control: a plain Top up stays in Trading");
});

test("Swap: the Safe's NEAR to a wallet is a Move paid with NEAR only (one Approve naming the leg), and a take-out's move home goes the moment the rows' moves in landed (D137)", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 6, swap: "NEAR", legs: [{ network: "sol", usd: 6 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  const add = s.asked.filter((a) => a.method === "ledger.toTrading");
  assert.match(String(add[0]!.params.tokenId), /^(near|nep141:wrap\.near)$/);
  assert.match(String(add[0]!.params.label), /^Move [\d.]+ NEAR from your Safe · SOL \$6\.00$/);
  const t = await setup();
  const out = await t.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "sol", usd: 10 }] });
  assert.ok("ok" in out, JSON.stringify(out));
  assert.equal(t.asked.filter((a) => a.method === "subwallet.float.home").length, 0, "home waits for its move in");
  await t.step(); await t.step();
  assert.equal(t.asked.filter((a) => a.method === "subwallet.float.in").length, 1);
  assert.equal(t.asked.filter((a) => a.method === "subwallet.float.home").length, 1, "and goes the moment it landed, no gap");
});

test("review M2: once both legs are saved, the move answers as made even if the next step fails (here the journal's next write), and asking again with its key adds no second move (control: the write really failed)", async () => {
  let failed = 0;
  // the first write that marks the move in as asked fails, once: the step after the legs were saved
  const s = await setup({ failWrite: (k, v) => k === "float.jobs.v1" && failed === 0 && Array.isArray(v) && v.some((j: { id: string; state: string }) => j.id === KEY && j.state === "asked") && ++failed === 1 });
  const r = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  assert.ok("ok" in r, `never "didn't go" for a move that was saved: ${JSON.stringify(r)}`);
  assert.equal(r.ok.id, KEY);
  assert.equal(failed, 1, "control: the write after the legs were saved did fail");
  const again = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  assert.ok("ok" in again && again.ok.id === KEY, "a retry with the same key is the same move");
  for (let i = 0; i < 3; i++) { s.later(LEG_GAP_MS[1] + 1); await s.step(); }
  assert.equal((await coreMoves(s.mock)).filter((m) => m.kind === "in").length, 1, "one move in, however many asks");
  assert.equal((await coreMoves(s.mock)).filter((m) => m.kind === "out").length, 1, "and one move out");
});

test("review L7: E7's move home failing to be saved (or its code failing to load) never stops the rest of a refresh; it is asked again next look (control: the write really failed once)", async () => {
  let failed = 0;
  const s = await setup({ failWrite: (k, v) => k === "float.jobs.v1" && failed === 0 && Array.isArray(v) && v.some((j: { id: string }) => j.id.startsWith("swaphome-")) && ++failed === 1 });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 6, swap: "NEAR", home: true });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.step(); await s.f.refresh();
  s.later(LEG_GAP_MS[1] + 1);
  await assert.doesNotReject(s.f.refresh(), "the refresh goes on");
  assert.equal(failed, 1, "control: the journal refused the move home once");
  await s.step(); await s.f.refresh(); await s.step();
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.home").length, 1, "asked again, once");
});

test("review L2: a Move's legs paid with the Safe's NEAR take only what that Add brought, each with its fee room, never the NEAR wallet's other cash (control: the leg as asked, less its trim, is more than that)", async () => {
  const s = await setup();                                                 // the NEAR wallet holds $5 of its own
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 6, swap: "NEAR", legs: [{ network: "sol", usd: 6 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  for (let i = 0; i < 3; i++) { await s.step(); await s.f.refresh(); s.later(100_000); }
  const outs = s.asked.filter((a) => a.method === "subwallet.float.out");
  assert.equal(outs.length, 1);
  const sent = (Number(outs[0]!.params.amount) / 1e9) * PX.sol;
  const brought = 6;                                                       // the sample's NEAR, changed at its own price
  assert.ok(sent * 1.03 <= brought + 0.02, `${sent} with its fee room fits in the $${brought} the Add brought`);
  assert.ok(6 * (1 - 0.025) > brought / 1.03, "control: the leg as asked, less even the largest trim, would take more");
});

test("review L9: until the $1 proof opens them (a release build), E5 between two chains' wallets and E7 are refused before anything moves; one leg to or from the NEAR wallet still goes (control: the proof build runs them, every test above)", async () => {
  const s = await setup({ homeProof: false });
  const pair = await s.svc.call("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  assert.ok("problem" in pair && pair.problem.code === "spending.move.not-open" && /\$1 test/.test(pair.problem.whatHappened), JSON.stringify(pair));
  const e7 = await s.svc.call("spending.topUp", { usd: 6, swap: "NEAR", home: true });
  assert.ok("problem" in e7 && e7.problem.code === "spending.move.not-open" && /\$1 test/.test(e7.problem.whatHappened), JSON.stringify(e7));
  assert.equal(s.asked.length, 0, "nothing asked of the core");
  const one = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "near", usd: 10, key: "home-move-sol-to-near-01" });
  assert.ok("ok" in one, JSON.stringify(one));
});

test("speed (D145): Move and Swap read the engine once before the first leg, never twice back to back (control: between() asked alone still reads first)", async () => {
  const s = await setup();
  await s.f.refresh();
  // each engine read asks for the NEAR wallet's balance once (refresh's read): count them up to the first leg
  const reads: string[] = [];
  const inner = s.mock.call.bind(s.mock);
  (s.mock as { call: typeof inner }).call = (async (m: string, p?: Record<string, unknown>) => { reads.push(m); return inner(m as never, p as never); }) as typeof inner;
  const upToLeg = () => reads.slice(0, reads.indexOf("subwallet.float.in") + 1).filter((m) => m === "subwallet.float.balance").length;
  const r = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "hood", usd: 30, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.f.settle();
  assert.ok(reads.includes("subwallet.float.in"), "the first leg went");
  assert.equal(upToLeg(), 1, `one read before the first leg: ${reads.join(", ")}`);
  // control: between() on its own (a caller that didn't just read) still reads first
  const c = await setup();
  await c.f.refresh();
  const creads: string[] = [];
  const cinner = c.mock.call.bind(c.mock);
  (c.mock as { call: typeof cinner }).call = (async (m: string, p?: Record<string, unknown>) => { creads.push(m); return cinner(m as never, p as never); }) as typeof cinner;
  await c.f.between({ from: "sol", to: "hood", usd: 30, key: KEY });
  await c.f.settle();
  assert.ok(creads.includes("subwallet.float.in"), creads.join(", "));
  assert.equal(creads.slice(0, creads.indexOf("subwallet.float.in")).filter((m) => m === "subwallet.float.balance").length, 1, "control: between() alone reads once itself");
});

test("product decision, 5 Nov (tap Move, the job is made at once): spending.move and Move's take-out answer once the job is saved, before its first step reaches the chain; the job is listed at once and its step runs after (control: settled, the step went)", async () => {
  const s = await setup();
  await s.f.refresh();
  // the chain's step is slow: it waits until the test lets it go
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const inner = s.mock.call.bind(s.mock);
  let stepAsked = 0;
  (s.mock as { call: typeof inner }).call = (async (m: string, p?: Record<string, unknown>) => { if (/^subwallet\.float\.(in|out|home)$/.test(m)) { stepAsked++; await gate; } return inner(m as never, p as never); }) as typeof inner;
  const told: number[] = [];
  s.f.subscribe(() => told.push(1));
  const r = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "near", usd: 10, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.ok(["on-its-way", "waiting"].includes(r.ok.status), r.ok.status);
  // answered while the chain's step is still held at the gate: the answer never waited on it
  assert.ok(told.length > 0, "the screens heard the job at once");
  const listed = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in listed && listed.ok.some((x) => x.id === r.ok.id), "the job is listed before its step ends");
  const out = await s.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "hood", usd: 10 }] });
  assert.ok("ok" in out, JSON.stringify(out));
  release();
  await s.f.settle();
  assert.ok(stepAsked > 0, "control: its step went after the answer");
});

test("QA (5 Nov): a Move answers once saved, so a second one tapped at once can't promise the same money: two of 60 % of the SOL wallet back to back, the second is refused before it saves (control: two of 40 % both save)", async () => {
  for (const [pct, both] of [[0.6, false], [0.4, true]] as const) {
    const s = await setup();
    await s.f.refresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const inner = s.mock.call.bind(s.mock);
    (s.mock as { call: typeof inner }).call = (async (m: string, p?: Record<string, unknown>) => { if (/^subwallet\.float\.(in|out|home)$/.test(m)) await gate; return inner(m as never, p as never); }) as typeof inner;
    const usd = Math.round(60 * pct * 100) / 100;
    const a = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "near", usd, key: "home-move-taken-first-01" });
    assert.ok("ok" in a, JSON.stringify(a));
    const b = await s.svc.call<SpendingActivity>("spending.move", { from: "sol", to: "near", usd, key: "home-move-taken-second-1" });
    if (both) assert.ok("ok" in b, `control: ${JSON.stringify(b)}`);
    else {
      assert.ok("problem" in b && b.problem.code === "trade.float.taken", JSON.stringify(b));
      const listed = await s.svc.call<SpendingActivity[]>("spending.activity", {});
      assert.ok("ok" in listed && !listed.ok.some((x) => x.id === "home-move-taken-second-1"), "nothing saved for the refused one");
    }
    release();
    await s.f.settle();
  }
});
