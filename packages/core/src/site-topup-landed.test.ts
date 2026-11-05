// Sim crawl (5 Nov, fix/move-rest on main): a pump.fun top-up paid from Private in ONE exit landed in the site's wallet,
// but its row (and Home's job) said "Putting $10.00 in your pump.fun wallet", on its way, for good: readyLanded only knew
// leg 2's job of the old two-leg path. A one-exit top-up is done once its payment to the site's own wallet ended done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpendingService, type EngineMove, type EngineSnapshot, type SpendingEngine } from "./spending.ts";

const SITE = "sw-site-pump-sol";
function rig(moves: EngineMove[]) {
  const s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves };
  const e: SpendingEngine = {
    snapshot: () => s, subscribe: () => () => undefined, refresh: async () => undefined,
    async add(usd) { return { id: "a1", kind: "add", usd, status: "moving", at: 0 }; },
    async takeOut(usd) { return { id: "h1", kind: "home", usd: usd === "all" ? 0 : usd, status: "waiting", at: 0 }; },
    setCap() {}, async moveNow(chain, usd) { return { id: "s1", kind: "out", chain, usd, status: "moving", at: 0 }; },
  };
  return createSpendingService({ engine: () => e, async call<T>(): Promise<T> { throw new Error("no call"); } } as never);
}
const add = (ends: Record<string, string>, extra: Partial<EngineMove> = {}): EngineMove => ({
  id: "mv-1", kind: "add", usd: 10, status: "done", at: 0, ready: { wallet: SITE, name: "pump.fun", site: "pump", sent: true },
  priv: { parts: [{ wallet: SITE, ids: ["pocket-send:1"], ends }] }, ...extra,
} as EngineMove);
const row = async (m: EngineMove) => {
  const r = await rig([m]).call<{ status: string; words: string }[]>("spending.activity", {});
  assert.ok("ok" in r, JSON.stringify(r));
  return r.ok[0]!;
};

test("a one-exit top-up whose payment to the site's wallet ended done is done: \"Add $10.00 to your pump.fun wallet\", the status carrying the state (control: still moving, it is on its way)", async () => {
  // one word per move in every state (browser-sites F14, the copy review): the words stay the asked form, the status says where it is
  const done = await row(add({ "pocket-send:1": "done" }));
  assert.equal(done.status, "done");
  assert.equal(done.words, "Add $10.00 to your pump.fun wallet");
  const going = await row(add({}));
  assert.equal(going.status, "on-its-way", "control: no end read yet");
  assert.equal(going.words, "Add $10.00 to your pump.fun wallet");
});

test("a payment that ended refunded or failed is never 'done' in the site's wallet (control: the old two-leg path still waits for leg 2's job)", async () => {
  assert.equal((await row(add({ "pocket-send:1": "refunded" }))).status, "on-its-way");
  const twoLeg = { id: "mv-2", kind: "add", usd: 10, status: "done", at: 0, ready: { wallet: SITE, name: "pump.fun", site: "pump", sent: true, job: "j2" } } as EngineMove;
  assert.equal((await row(twoLeg)).status, "on-its-way", "leg 2 not landed");
  const leg2 = { id: "j2", kind: "out", chain: "sol", usd: 10, status: "done", at: 0 } as EngineMove;
  const r = await rig([twoLeg, leg2]).call<{ id: string; status: string }[]>("spending.activity", {});
  assert.ok("ok" in r && r.ok.find((x) => x.id === "mv-2")!.status === "done", "control: leg 2 landed → done");
});

test("one row, one state: a one-exit top-up to the site's Solana wallet is done only once the engine's landed round showed it (train 10's arrivedRead + the audit's chainShown), never on the ledger's done alone (control: the engine's Done, done)", async () => {
  const sol = (status: "moving" | "done") => add({ "pocket-send:1": "done" }, { status, priv: { parts: [{ wallet: SITE, chain: "sol", ids: ["pocket-send:1"], ends: { "pocket-send:1": "done" } }] } });
  assert.equal((await row(sol("moving"))).status, "on-its-way", "the ledger's done, the round not shown it yet: on its way");
  assert.equal((await row(sol("done"))).status, "done", "control: the round's read showed it");
});

test("one row, one figure: a site's Add says what was asked, never a second legs figure (control: a Move from the Safe whose legs are less keeps legsUsd)", async () => {
  const site = await rig([add({ "pocket-send:1": "done" }, { legs: [{ chain: "sol", usd: 9.4 }] } as Partial<EngineMove>)]).call<{ usd: string; legsUsd?: string }[]>("spending.activity", {});
  assert.ok("ok" in site);
  assert.deepEqual([site.ok[0]!.usd, site.ok[0]!.legsUsd], ["10.00", undefined]);
  const move = await rig([{ id: "mv-2", kind: "add", usd: 10, status: "moving", at: 0, legs: [{ chain: "sol", usd: 9.4 }] } as EngineMove]).call<{ usd: string; legsUsd?: string }[]>("spending.activity", {});
  assert.ok("ok" in move);
  assert.equal(move.ok[0]!.legsUsd, "9.40", "control");
});

test("the audit's not-MUST (5 Nov): an older build's Move paid from Private whose parts name no chain, kept Done by the restore path, lists every wallet it went to as landed: never \"On its way\" for good beside a Done job (control: the engine still moving, nothing landed)", async () => {
  const old = (status: "moving" | "done"): EngineMove => ({ id: "mv-old", kind: "add", usd: 6, status, at: 0, legs: [{ chain: "sol", usd: 6, sent: true }], priv: { parts: [{ wallet: "sw-trade-sol", ids: ["pocket-send:old"], ends: { "pocket-send:old": "done" } }] } } as EngineMove);
  const done = await row(old("done")) as unknown as { status: string; goesTo?: string[]; landed?: string[] };
  assert.deepEqual([done.status, done.goesTo, done.landed], ["done", ["sol"], ["sol"]], "the engine's Done is the read: its SOL wallet landed");
  const going = await row(old("moving")) as unknown as { status: string; landed?: string[] };
  assert.deepEqual([going.status, going.landed], ["on-its-way", undefined], "control: not Done, nothing landed");
});
