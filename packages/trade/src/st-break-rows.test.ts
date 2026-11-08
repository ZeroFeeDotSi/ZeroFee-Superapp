// ST break rows (the Browser tab's Add, engine side): Spending's real engine and service on the shell's MockBridge (its
// float answers as the core's), the planner's clock the test's. Rows: a leg failing while the other landed, a cancelled
// Approve, airplane mode between the two legs, the same Add asked twice. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, readyGapMs, type CoreFloatDeps } from "./float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function setup(o: { decline?: boolean; refuseOut?: boolean; floorOut?: boolean; failLater?: boolean; hang?: boolean; arrived?: number } = {}) {
  let clock = 1_000_000;
  // failLater: leg 2 stays on its way (a slow 1Click) until the test fails it
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: o.failLater ? 3000 : 10 } });
  const asked: { method: string; params: Record<string, unknown> }[] = [];
  let offline = false;
  const call: CoreFloatDeps["call"] = async (method, params) => {
    // airplane mode: every call fails as fetch does, before it reaches anything
    if (offline) throw new TypeError("Failed to fetch");
    if (method === "ledger.toTrading" || /^subwallet\.float\.(out|in|home)$/.test(method)) asked.push({ method, params });
    // a no on the core's Approve, as the real ledger answers it (docs/interfaces.md: a Problem ending in .declined)
    // an Approve sheet left open for ever (review M2)
    if (o.hang && method === "ledger.toTrading" && !hung++) return new Promise(() => {});
    if (o.decline && method === "ledger.toTrading") throw new ProblemError({ code: "ledger.signature.declined", whatHappened: "You said no, so nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } });
    if (o.refuseOut && method === "subwallet.float.out") throw new ProblemError({ code: "security.partner.unreachable", whatHappened: "1Click isn't answering.", money: { state: "safe", where: "in Trading" }, next: { kind: "retry", label: "Try again" }, service: "oneclick" });
    // finding 61: the core's own $2 floor (float.ts take), as it refuses: its general line, its reason in `more`
    if (o.floorOut && method === "subwallet.float.out") throw new ProblemError(securityProblems.requestNotAllowed("A move under $2 would mostly go on fees."));
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
    // 1Click took leg 2, then it failed while followed (review M1)
    if (o.failLater && method === "subwallet.float.out") outId = r.ok.id;
    if (o.failLater && outId && failing && (method === "subwallet.float.move" && params?.id === outId)) return { ...r.ok, status: "failed", where: "float" };
    if (o.failLater && outId && failing && method === "subwallet.float.moves" && Array.isArray(r.ok)) return r.ok.map((m: any) => (m.id === outId ? { ...m, status: "failed", where: "float" } : m));
    return r.ok;
  };
  let outId: string | undefined, failing = false, hung = 0;
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const site = (await call("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" })) as { id: string };
  let t = 1_000_000;
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ now: () => clock, engine: () => (o.arrived === undefined ? f : arrivedAs(f, o.arrived)) as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  /** Past the private gap after the Add landed, so leg 2 is due. */
  const leg2 = async (id: string) => { await settle(); await f.refresh(); s.t += readyGapMs(id) + 1; t = s.t; await f.refresh(); await settle(); await f.refresh(); };
  const s = { f, svc, asked, site, leg2, t, offline: (on: boolean) => { offline = on; }, failNow: () => { failing = true; }, later: (ms: number) => { clock += ms; } };
  return s;
}
/** The engine as one whose site Add delivered `usd` to the NEAR wallet (1Click's fees took the rest): its leg 2 rows say so. */
function arrivedAs<F extends { snapshot(): { moves: { kind?: string; usd: number }[] } }>(f: F, usd: number): F {
  return new Proxy(f, { get: (t, k) => (k === "snapshot" ? () => { const n = t.snapshot(); return { ...n, moves: n.moves.map((m) => (m.kind === "ready" || (m as { ready?: unknown }).ready ? { ...m, usd } : m)) }; } : (t as never)[k]) });
}
const outs = (s: { asked: { method: string; params: Record<string, unknown> }[] }) => s.asked.filter((a) => a.method === "subwallet.float.out").map((a) => a.params.to);

test("control: a site Add, one Approve, then leg 2 on to the site's own wallet (and only it)", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(s.asked.filter((a) => a.method === "ledger.toTrading").length, 1, "one Approve");
  await s.leg2(r.ok.id);
  assert.deepEqual(outs(s), [s.site.id]);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  assert.equal(rows.ok.find((a) => a.id === r.ok.id)!.words, "Add $10.00 to your pump.fun wallet", "control: a leg 2 that went keeps its words");
  assert.equal(rows.ok.find((a) => a.id === r.ok.id)!.stoppedShort, undefined, "control: finding 61's stop is never said of an Add that went on");
});

test("lap FAIL 4 (the Sim's top-up crawl, 5 Nov): a site Add's leg 2 is listed as the Add's own step (`of` its id), never a job of its own (control: the Add's row is the one record, its words unchanged)", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.leg2(r.ok.id);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const leg = rows.ok.find((a) => a.kind === "ready")!;
  assert.equal(leg.of, r.ok.id, "leg 2 is a step of the Add");
  // one word per move (browser-sites F14, the copywriter): the Add's row says Add, as its job does
  assert.equal(rows.ok.find((a) => a.id === r.ok.id)!.words, "Add $10.00 to your pump.fun wallet", "control: the Add's own words (pump.fun top-up, one row)");
});

test("F1: a leg failing while the other landed: leg 1 is in Trading, leg 2 refused by 1Click; the Add's own row says where the money is (never \"Topped up\"), nothing else moves", async () => {
  const s = await setup({ refuseOut: true });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.leg2(r.ok.id);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  // leg 2's own row: refused, shown, naming 1Click and where the money is (Trading), the site's wallet named
  const leg = rows.ok.find((a) => a.kind === "ready")!;
  assert.deepEqual([leg.status, leg.shown, leg.words], ["refused", true, "Adding $9.70 to your pump.fun wallet"], JSON.stringify(leg));
  assert.match(leg.note ?? "", /^1Click isn't answering\. · it's in your NEAR wallet$/);
  // F1 (QA High): the Add's own row says what happened and where the money is, never "Topped up $10.00 for …"
  const add = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.equal(add.words, "$10.00 is in your NEAR wallet. It didn't go on to your pump.fun wallet", JSON.stringify(add));
  assert.doesNotMatch(add.words, /Topped up/);
  assert.equal(add.note, "Your money is in your NEAR wallet. 1Click isn't answering.");
  // finding 61: the record says the Add ended short, so the site's page ends its "on its way" and its task now
  assert.equal(add.stoppedShort, true);
  assert.equal(add.site, "pump");
  // asked once, never again by itself into the site's wallet (it waits for the person)
  await s.leg2(r.ok.id);
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 1);
});

test("cancelled Approve: nothing moves, no leg 2, no row left moving", async () => {
  const s = await setup({ decline: true });
  const r = await s.svc.call<{ declined?: true } | SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r && "declined" in r.ok, JSON.stringify(r));
  await s.leg2("none");
  assert.deepEqual(outs(s), []);
  assert.deepEqual(s.f.snapshot().moves.filter((m) => m.status === "moving" || m.status === "waiting"), []);
});

test("airplane mode between the legs: the engine's reads fail quietly; back online leg 2 goes once, to the site's wallet", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  s.offline(true);
  await s.leg2(r.ok.id).catch(() => undefined);
  await s.f.refresh().catch(() => undefined);
  assert.deepEqual(outs(s), [], "nothing goes while offline");
  s.offline(false);
  await s.leg2(r.ok.id);
  await s.leg2(r.ok.id);
  assert.deepEqual(outs(s), [s.site.id], "once, to the site's own wallet");
});

test("F4: two Top ups at once never raise two Approves: the same key is the same move; another while one is with the person is refused; control: after it ends, a new one has its own Approve", async () => {
  const s = await setup();
  const k = "st-f4-key-0000000001";
  const [a, b] = await Promise.all([
    s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id, key: k }),
    s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id, key: k }),
  ]);
  assert.ok("ok" in a && "ok" in b && a.ok.id === b.ok.id, "the same move");
  assert.equal(s.asked.filter((x) => x.method === "ledger.toTrading").length, 1, "one Approve");
  // asked again later with its key: still the same move, no new Approve; with other fields: refused
  const again = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id, key: k });
  assert.ok("ok" in again && "ok" in a && again.ok.id === a.ok.id);
  const other = await s.svc.call("spending.topUp", { usd: "12", ready: s.site.id, key: k });
  assert.ok("problem" in other && other.problem.code === "security.request.invalid");
  // two without keys at once (two sheets): one Approve, the other refused by name, nothing moved for it
  const [c, d] = await Promise.all([s.svc.call("spending.topUp", { usd: "5", ready: s.site.id }), s.svc.call("spending.topUp", { usd: "6", ready: s.site.id })]);
  const refusedOne = [c, d].filter((r) => "problem" in r && r.problem.code === "spending.topup.busy");
  assert.equal(refusedOne.length, 1, JSON.stringify([c, d]));
  assert.equal(s.asked.filter((x) => x.method === "ledger.toTrading").length, 2);
  // control: after it ended, a new Top up gets its own Approve
  const e = await s.svc.call("spending.topUp", { usd: "7", ready: s.site.id, key: "st-f4-key-0000000002" });
  assert.ok("ok" in e, JSON.stringify(e));
  assert.equal(s.asked.filter((x) => x.method === "ledger.toTrading").length, 3);
});

test("F1 (review M1): leg 2 taken by 1Click, then failed while followed: the Add's row says so too, never \"Topped up\"", async () => {
  const s = await setup({ failLater: true });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.leg2(r.ok.id);
  const before = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in before);
  assert.doesNotMatch(before.ok.find((a) => a.id === r.ok.id)!.words, /is in Trading/, "still going: not failed yet");
  s.failNow();
  await s.leg2(r.ok.id);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const add = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.equal(add.words, "$10.00 is in your NEAR wallet. It didn't go on to your pump.fun wallet", JSON.stringify(rows.ok));
  assert.match(add.note ?? "", /^Your money is in your NEAR wallet\. /);
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 1, "not sent again");
});

test("F4 review: a sheet left open holds the others back 5 minutes at most; a no under a key can be asked again with it", async () => {
  const s = await setup({ hang: true });
  void s.svc.call("spending.topUp", { usd: "10", ready: s.site.id });
  await settle();
  const busy = await s.svc.call("spending.topUp", { usd: "5", ready: s.site.id });
  assert.ok("problem" in busy && busy.problem.code === "spending.topup.busy", JSON.stringify(busy));
  s.later(5 * 60_000 + 1);
  const next = await s.svc.call("spending.topUp", { usd: "5", ready: s.site.id });
  assert.ok("ok" in next, `after 5 minutes another goes: ${JSON.stringify(next)}`);
  // a no is not kept under its key: the same key asks again (its own Approve)
  const d = await setup({ decline: true });
  const k = "st-f4-key-0000000009";
  const no = await d.svc.call<{ declined?: true }>("spending.topUp", { usd: "10", ready: d.site.id, key: k });
  assert.ok("ok" in no && no.ok.declined);
  const askedBefore = d.asked.filter((x) => x.method === "ledger.toTrading").length;
  await d.svc.call("spending.topUp", { usd: "10", ready: d.site.id, key: k });
  assert.equal(d.asked.filter((x) => x.method === "ledger.toTrading").length, askedBefore + 1, "asked again");
});

test("finding 61: a leg the core refuses by its floor says the core's reason, never \"This app asked for something it isn't allowed\"", async () => {
  const s = await setup({ floorOut: true });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.leg2(r.ok.id);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const leg = rows.ok.find((a) => a.kind === "ready")!;
  assert.equal(leg.note, "A move under $2 would mostly go on fees. · it's in your NEAR wallet");
  const add = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.equal(add.note, "Your money is in your NEAR wallet. A move under $2 would mostly go on fees.");
  assert.equal(add.stoppedShort, true);
  assert.doesNotMatch(JSON.stringify(rows.ok), /isn't allowed/);
});

test("finding 61: a site's Add under $2.09 is refused before any sheet (its last step could stop); $2.09 goes (control)", async () => {
  const s = await setup();
  const two = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "2", ready: s.site.id });
  assert.ok("problem" in two, JSON.stringify(two));
  assert.equal(two.problem.whatHappened, "At least $2.09 from your Safe to a wallet. Nothing moved.");
  assert.equal(s.asked.filter((a) => a.method === "ledger.toTrading").length, 0, "nothing asked, no sheet");
  const ok = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "2.09", ready: s.site.id });
  assert.ok("ok" in ok, JSON.stringify(ok));
  // control: a Move to the NEAR wallet alone keeps its own $2 least
  const plain = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "2", key: "kplain000000000000000000" });
  assert.ok(!("problem" in plain) || plain.problem.code !== "spending.move.too-small", JSON.stringify(plain));
});

test("k-trade re-test (4 Nov): a Move's leg to Robinhood 1Click took, then failed: the Move's row says where the money is, never \"Moved … On its way\" over a leg that didn't go through", async () => {
  const s = await setup({ failLater: true });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 10, legs: [{ network: "hood", usd: 10 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.leg2(r.ok.id);
  const before = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in before);
  assert.equal(before.ok.find((a) => a.id === r.ok.id)!.stoppedShort, undefined, "control: still going, not stopped yet");
  s.failNow();
  await s.leg2(r.ok.id);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const move = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.equal(move.words, "$10.00 is in your NEAR wallet. It didn't go on to your Robinhood wallet", JSON.stringify(rows.ok));
  assert.equal(move.stoppedShort, true);
  assert.equal(move.parkedUsd, 10, "what is parked, as a number");
  assert.equal(s.asked.filter((a) => a.method === "subwallet.float.out").length, 1, "not sent again by itself");
});

test("a parked remainder under $2 goes home (review, 5 Nov: its only way out was a Put away that refused it): spending.putAway {parked} asks the core's move home with parked; control: a fresh Put away of the same dollars is still refused, nothing asked", async () => {
  // 1Click's fees left $1.80 of a $2.09 site Add in the NEAR wallet, and the core's floor refused its leg 2
  const s = await setup({ floorOut: true, arrived: 1.8 });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "2.09", ready: s.site.id });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.leg2(r.ok.id);
  const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const add = rows.ok.find((a) => a.id === r.ok.id)!;
  assert.equal(add.stoppedShort, true);
  const parked = add.parkedUsd!;
  assert.ok(parked > 0 && parked < 2, `parked under $2: ${parked}`);
  // control first: the same dollars as a plain Put away keep the floor
  const homes = () => s.asked.filter((a) => a.method === "subwallet.float.home");
  const fresh = await s.svc.call("spending.putAway", { usd: String(parked) });
  assert.ok("problem" in fresh, "a fresh Put away under $2 is refused");
  assert.equal(homes().length, 0, "nothing asked");
  // control: a row that didn't stop is no parked remainder
  const wrong = await s.svc.call("spending.putAway", { parked: "no-such-row" });
  assert.ok("problem" in wrong);
  assert.equal(homes().length, 0);
  const went = await s.svc.call<SpendingActivity>("spending.putAway", { parked: r.ok.id });
  assert.ok("ok" in went, JSON.stringify(went));
  await settle(); await s.f.refresh(); await settle();
  assert.equal(homes().length, 1, "one move home");
  assert.equal(homes()[0]!.params.parked, true);
  assert.equal(homes()[0]!.params.amount, String(Math.floor(parked * 1e6)), "exactly what is parked");
});
