// Move and a site's Add paid from Private (the product's HARD RULE: every money move confidential, NEAR Confidential), on
// the Sim's own ledger (MockBridge) and the real engine and Spending: each leg one payment from Private straight to its
// wallet, never the public Safe → NEAR wallet leg; the job saved before anything is asked, under the one row id it keeps
// (move:mv-<key>), found again by a page opened mid-job; Private short with the fill closed refused before anything;
// open, the Safe fills Private first by a whole step and the extra stays there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { LANDED_UNREAD, PRIVATE_BACK } from "@zerofee/core/private-route";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { privateMoveSteps } from "@zerofee/shell-api/job-steps.ts";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { PRIV_CHECK_MS, arrivedRead, chainShown, knownOf, missedRead, moved, settle, shows } from "./float-private.ts";
import type { MoveRow } from "./float-view.ts";

const KEY = "move-private-0123456789abcdef0123";
const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const tick = () => new Promise((r) => setTimeout(r, 5));
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

async function phone(o: { pocketUsd?: string; pocketNear?: string; fillOpen?: boolean; fromPrivate?: boolean } = {}) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 20, float: { moveMs: 10 }, hiddenStart: { usdc: o.pocketUsd ?? "50", near: o.pocketNear ?? "0" }, safeFillOpen: o.fillOpen ?? false });
  const kept = new Map<string, unknown>();
  const asked: { method: string; params: Record<string, unknown>; savedAt?: unknown }[] = [];
  let t = 1_000_000;
  for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
  const savedRow = () => ((kept.get("float.adds.v1")) as { r: MoveRow }[] | undefined)?.map((x) => x.r).find((r) => r.id === `mv-${KEY}`);
  /** `reads`: false, every wallet's chain read fails (a busy node), as a SOL node that hasn't answered yet. */
  /** `balance`: the SOL wallets' own coin as the chain answers (null: the read fails); `minOut`: the payout quote's least the
   *  real ledger names on each part (the Sim's ledger names none). */
  function page(pg: { reads?: () => boolean; balance?: () => string | null; minOut?: string } = {}) {
    const call: CoreFloatDeps["call"] = async (method, params) => {
      if (method === "subwallet.balances" && pg.reads && !pg.reads()) throw new Error("the node didn't answer");
      if (method === "subwallet.balances" && pg.balance) { const b = pg.balance(); if (b === null) throw new Error("the node didn't answer"); return [{ token: "native", symbol: "SOL", decimals: 9, amount: b }] as never; }
      if (method === "ledger.moveFromPrivate" && pg.minOut) { asked.push({ method, params, savedAt: structuredClone(savedRow()) }); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return { ...r.ok, parts: r.ok.parts.map((x: object) => ({ ...x, minOut: pg.minOut })) } as never; }
      // what was kept on the device at the moment each money call was made (the job before anything is asked)
      if (/^ledger\.(toTrading|moveFromPrivate)$/.test(method)) asked.push({ method, params, savedAt: structuredClone(savedRow()) });
      const r = await mock.call<any>(method, params);
      if ("problem" in r) throw new ProblemError(r.problem);
      return r.ok as never;
    };
    const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => t, every: () => () => undefined, rng: () => 0.5, fromPrivate: o.fromPrivate ?? true });
    const host = async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T;
    const svc = createSpendingService({ engine: () => f as never, call: host });
    const rows = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return r.ok; };
    return { f, svc, rows, row: async (id: string) => (await rows()).find((a) => a.id === id) };
  }
  const pocket = async () => Number(((await mock.call<any>("ledger.private", {})) as any).ok.rows.find((r: { tokenId: string }) => r.tokenId === USDC)?.amount ?? 0);
  const safe = async () => Number(((await mock.call<any>("ledger.balances", {})) as any).ok.find((r: { tokenId: string; held: string }) => r.tokenId === USDC && r.held === "ledger")?.amount ?? 0);
  const movements = async () => ((await mock.call<any>("ledger.activity", {})) as any).ok as { id: string; kind: string; status: string; to?: string; amount: string; private?: boolean }[];
  return { mock, asked, kept, page, savedRow, pocket, safe, movements, later: (ms: number) => { t += ms; } };
}
const until = async (ok: () => Promise<boolean>, what: string) => {
  for (let i = 0; i < 400; i++) { if (await ok()) return; await tick(); }
  throw new Error(`never: ${what}`);
};

test("a Move from the Safe pays from Private: one payment straight to the SOL wallet's own address, never the public Safe → NEAR wallet leg; the job is kept before it is asked and ends done (control: the old engine still asks ledger.toTrading)", async () => {
  const s = await phone();
  const a = s.page();
  const sol = (await bridgeWallets(async (m, p) => (await s.mock.call<any>(m, p)).ok, nativeUsd)).find((w) => w.chain === "sol")!;
  const pocket0 = await s.pocket(), safe0 = await s.safe();
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(s.asked.map((x) => x.method), ["ledger.moveFromPrivate"], "Private pays: no ledger.toTrading");
  const call = s.asked[0]!;
  assert.deepEqual(call.params.parts, [{ wallet: sol.id, usd: 6 }]);
  assert.equal(call.params.job, KEY);
  assert.equal(call.savedAt?.id, `mv-${KEY}`, "the job is on the device before the payment is asked");
  assert.deepEqual(call.savedAt?.priv?.parts.map((p) => [p.chain, p.usd]), [["sol", 6]], "with its legs, so a page closed mid-job reads them back");
  assert.equal(r.ok.id, `mv-${KEY}`);
  assert.equal(r.ok.via, "private");
  const m = (await s.movements()).find((x) => x.id.startsWith("pocket-send:"))!;
  assert.deepEqual([m.kind, m.private, m.to, m.amount], ["pay", true, (await s.mock.call<any>("subwallet.list", {}) as any).ok.find((w: { id: string }) => w.id === sol.id).address, "6.00"]);
  assert.equal(await s.safe(), safe0, "nothing left the Safe");
  assert.equal(Math.round((pocket0 - (await s.pocket())) * 100) / 100, 6, "Private paid the leg");
  // the engine's follow reads again while it waits (float-core privReadWaits); here each try is one refresh
  await until(async () => { await a.f.refresh(); return (await a.row(`mv-${KEY}`))?.status === "done"; }, "the row ends done");
  const done = (await a.row(`mv-${KEY}`))!;
  assert.match(done.words, /SOL wallet|Solana/);
  // S5 (the copy review's Sim walk): the move's row carries its payment from Private, so Activity shows the move once, never the
  // payment's own "Came back · 6 USDC" row beside it
  assert.deepEqual(done.paid, [m.id]);
  // control: the old engine (no fromPrivate) asks the Safe's public leg, as before
  const c = await phone({ fromPrivate: false });
  const r2 = await c.page().svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok("ok" in r2);
  assert.deepEqual(c.asked.map((x) => x.method), ["ledger.toTrading"]);
  assert.equal(r2.ok.paid, undefined, "control: no payment from Private, nothing to fold");
});

test("Private short and the fill closed (VITE_SAFE_FILL_OPEN off): refused before anything is saved or signed, with the line naming why; nothing moved (control: a Move Private covers goes)", async () => {
  const s = await phone({ pocketUsd: "3" });
  const a = s.page();
  const safe0 = await s.safe();
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok("problem" in r);
  assert.deepEqual([r.problem.code, r.problem.whatHappened, r.problem.next.label], ["ledger.private.short", "Nothing moved. Private has $3.00, and this needs $6.00.", "Move less"]);
  assert.equal(s.savedRow(), undefined, "no job kept");
  assert.deepEqual([await s.safe(), await s.pocket()], [safe0, 3], "nothing moved");
  assert.ok(!(await s.movements()).some((m) => /^(pocket|safe)-send:/.test(m.id)), "nothing paid");
  assert.ok(!s.asked.some((x) => x.method === "ledger.toTrading"), "never the public leg instead");
  const ok = await phone({ pocketUsd: "6" });
  assert.ok("ok" in (await ok.page().svc.call("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY })));
});

test("the proof (5 Nov, rule 1): with the fill closed, Move's sheet and Spending count the same coins, Private's own: \"A Move can use $8.86 from Private\" (its NEAR) and a $7 Move goes, paid with Private's NEAR, never refused after the tap (control: Private's $3 of USDC alone, the sheet offers $3 and a $7 Move is refused before the ledger is asked)", async () => {
  const { safeCoinMost } = await import("@zerofee/wallet/app/screens/move-split.ts");
  const s = await phone({ pocketUsd: "3", pocketNear: "2" });
  const rows = [...((await s.mock.call<any>("ledger.balances", {})) as any).ok, ...((await s.mock.call<any>("ledger.private", {})) as any).ok.rows];
  assert.equal(safeCoinMost(rows, false), 8.86, "the sheet's promise: Private's NEAR");
  const a = s.page();
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 7, legs: [{ network: "sol", usd: 7 }], key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  const asked = s.asked.find((x) => x.method === "ledger.moveFromPrivate")!;
  assert.equal(asked.params.tokenId, "nep141:wrap.near", "paid with the coin the sheet counted");
  // Activity says the NEAR that left, not the dollars as NEAR ($7 at $4.43 a NEAR is 1.580135 NEAR, never "7.00")
  const paid = ((await s.mock.call<any>("ledger.activity", {})) as any).ok.find((m: { kind: string; from: string }) => m.kind === "pay" && m.from === "nep141:wrap.near");
  assert.equal(paid.amount, "1.580135");
  assert.notEqual(paid.amount, "7.00");
  // control: only Private's USDC: the sheet offers $3, and Spending refuses $7 before the ledger is asked
  const c = await phone({ pocketUsd: "3" });
  const crows = [...((await c.mock.call<any>("ledger.balances", {})) as any).ok, ...((await c.mock.call<any>("ledger.private", {})) as any).ok.rows];
  assert.equal(safeCoinMost(crows, false), 3);
  const no = await c.page().svc.call<SpendingActivity>("spending.topUp", { usd: 7, legs: [{ network: "sol", usd: 7 }], key: KEY });
  assert.ok("problem" in no, "refused");
  assert.equal(c.asked.filter((x) => x.method === "ledger.moveFromPrivate").length, 0, "before the ledger is asked");
});

test("the fill open: the Safe fills Private first by a whole step over what was short (fill ≠ payout), the extra stays in Private, then Private pays; the job's steps show the fill then the payment", async () => {
  const s = await phone({ pocketUsd: "3", fillOpen: true });
  const a = s.page();
  const safe0 = await s.safe();
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 20, legs: [{ network: "sol", usd: 20 }], key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  // Private's $3 folds (the audit's R2, the ledger's foldsWhole; the Sim's mirror, 7 Nov): the fill is a whole $10 step over the
  // $20 and its 3 % gap, $30, never the $17 short or the $20 payout's figure; Private's $3 stays with the extra
  const fill = Math.round((safe0 - (await s.safe())) * 100) / 100;
  assert.equal(fill, 30);
  assert.notEqual(fill, 17);
  assert.equal(await s.pocket(), 13, "Private keeps its $3 and the extra: $3 + $30 - $20");
  assert.equal(r.ok.fill, "doing");
  const paid = (await s.movements()).find((m) => m.id.startsWith("safe-send:"))!;
  assert.equal(paid.amount, "20.00");
  await until(async () => { await a.f.refresh(); return (await a.row(`mv-${KEY}`))?.status === "done"; }, "paid");
  assert.equal((await a.row(`mv-${KEY}`))!.fill, "done");
  assert.deepEqual(privateMoveSteps(["sol"], { fill: true }).map((w) => w.doing), ["NEAR Confidential is moving money from your Safe to Private.", "NEAR Confidential is paying your SOL wallet.", "Solana is landing it in your SOL wallet."]);
  // several chains: one landing line per chain, each named (the copy review's ruling, 5 Nov: never "Each chain")
  assert.deepEqual(privateMoveSteps(["sol", "hood"]).map((w) => w.done), ["NEAR Confidential paid your wallets.", "It's in your SOL wallet.", "It's in your ETH (RH) wallet."], "Private covered: no fill");
  assert.deepEqual(privateMoveSteps(["sol", "hood"]).map((w) => w.next), ["Then NEAR Confidential pays your wallets.", "Then Solana lands it in your SOL wallet.", "Then Robinhood Chain lands it in your ETH (RH) wallet."]);
});

test("a page closed mid-job finds the Move again under the same row id and follows it to its end by the ledger's own record of its payments", async () => {
  const s = await phone();
  const a = s.page();
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok("ok" in r);
  // the page closes now; another opens on the same device before the payment lands (its events never heard)
  const b = s.page();
  await b.f.refresh();
  const again = await b.row(`mv-${KEY}`);
  assert.ok(again, "the same row, by its id");
  assert.equal(again!.via, "private");
  await until(async () => (await s.movements()).filter((m) => m.id.startsWith("pocket-send:")).every((m) => m.status === "done"), "landed");
  s.later(PRIV_CHECK_MS + 1);
  await b.f.refresh();
  assert.equal((await b.row(`mv-${KEY}`))!.status, "done", "read back from the ledger's record, never lost");
  assert.equal((await b.rows()).filter((x) => x.id === `mv-${KEY}`).length, 1, "never two");
});

test("a payout that came back: the job says the money is in Private, never \"failed\"; a part that landed stays where it went", () => {
  const r: MoveRow = { id: "mv-x", kind: "add", usd: 10, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: "sw-trade-sol", chain: "sol", usd: 6, ids: ["pocket-send:a"] }, { wallet: "near", chain: "near", usd: 4, ids: ["pocket-send:b"] }] } };
  assert.equal(moved(r, { id: "pocket-send:a", status: "refunded" }, 0), true);
  assert.equal(r.status, "moving", "one part still open");
  moved(r, { id: "pocket-send:b", status: "done" }, 1_000);
  // landed: Done (with its note) in the round whose read shows it (float-private arrivedRead, rule 11); the copy review's words, the part's own figure
  assert.deepEqual([r.status, r.priv!.landed], ["moving", { at: 1_000, note: "Solana: The $6.00 is back in Private." }]);
  const one: MoveRow = { id: "mv-y", kind: "add", usd: 6, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: "sw-trade-sol", chain: "sol", usd: 6, ids: ["safe-send:c"] }] } };
  settle(one, 0);
  assert.equal(one.priv!.fill, "doing");
  moved(one, { id: "safe-send:c", status: "problem" }, 0);
  assert.deepEqual([one.status, one.note, one.priv!.fill], ["failed", "The $6.00 is back in Private.", "done"]);
  assert.doesNotMatch(PRIVATE_BACK, /fail/i);
});

test("rule 11 (the prover, 5 Nov: \"Moved $5.20 to your SOL wallet\" ticked 60 s early): a Move paid from Private stays Moving, on its way, after the ledger says its payment is done, until the SOL wallet's own chain read; then Moved, done, `landed` (controls: a failed read is no read; kept on the device meanwhile)", async () => {
  const s = await phone();
  let reads = true;
  const a = s.page({ reads: () => reads });
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  // paid; from here the SOL node doesn't answer (its read fails)
  reads = false;
  await until(async () => (await s.movements()).filter((m) => m.id.startsWith("pocket-send:")).every((m) => m.status === "done") && s.savedRow()?.priv?.landed !== undefined, "the ledger says the payment is done");
  await a.f.refresh();
  await a.f.refresh();
  const going = (await a.row(`mv-${KEY}`))!;
  assert.equal(going.status, "on-its-way", "the ledger's done is no chain read: no tick");
  assert.match(going.words, /^Moving \$\d+\.\d\d to your SOL wallet$/);
  assert.equal(going.landed, undefined);
  assert.deepEqual([s.savedRow()!.status, !!s.savedRow()!.priv!.landed], ["moving", true], "kept waiting on the device: a page closed now waits for the same read");
  reads = true;
  await a.f.refresh();
  const done = (await a.row(`mv-${KEY}`))!;
  assert.equal(done.status, "done", "its wallet's chain read answered after the end: done");
  assert.match(done.words, /^Moved \$\d+\.\d\d to your SOL wallet$/);
  assert.deepEqual(done.landed, ["sol"]);
});

test("a site's Add pays the site's own wallet straight from Private (never through the NEAR wallet)", async () => {
  const s = await phone();
  const w = (await s.mock.call<any>("subwallet.site.forHost", { site: { origin: "https://pump.fun" }, chain: "sol", app: "browser" }) as any).ok as { id: string; address: string };
  const a = s.page();
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 6, ready: w.id, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(s.asked.map((x) => [x.method, x.params.parts]), [["ledger.moveFromPrivate", [{ wallet: w.id, usd: 6 }]]]);
  assert.equal((await s.movements()).find((m) => m.id.startsWith("pocket-send:"))!.to, w.address);
});

test("every sheet that starts a Move or an Add asks ledger.moveFromPrivate, never ledger.toTrading: Home's Move (move-run.ts, one leg and two), Home's Spending Add and Trade's Add (AddTakeOut.tsx), as each sends it; the app's one engine is this one (runtime.ts fromPrivate, spending-host.ts runtimeFor)", async () => {
  const sheets: [string, Record<string, unknown>][] = [
    ["Home's Move, one leg (move-run.ts)", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY }],
    ["Home's Move, two legs (move-run.ts)", { usd: 10, legs: [{ network: "sol", usd: 6 }, { network: "hood", usd: 4 }], key: KEY }],
    ["Home's Spending Add (Spending.tsx)", { usd: "6.00" }],
    ["Trade's Add (AddTakeOut.tsx)", { usd: 6 }],
  ];
  for (const [what, params] of sheets) {
    const s = await phone();
    const r = await s.page().svc.call<SpendingActivity>("spending.topUp", params);
    assert.ok("ok" in r, `${what}: ${JSON.stringify(r)}`);
    assert.deepEqual([...new Set(s.asked.map((x) => x.method))], ["ledger.moveFromPrivate"], what);
  }
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(src("./runtime.ts"), /createCoreFloat\(\{[\s\S]{0,400}\n\s*fromPrivate: true,/, "the app's engine pays from Private");
  assert.match(src("./spending-host.ts"), /runtimeFor\(tradeBridge\(\)\)[\s\S]{0,200}return rt\.float;/, "Spending's engine is the runtime's float");
  for (const f of ["../../wallet/src/app/screens/move-run.ts", "./app/screens/AddTakeOut.tsx", "../../wallet/src/app/screens/Spending.tsx", "../../wallet/src/app/money/SiteMoney.tsx"]) assert.doesNotMatch(src(f), /ledger\.toTrading/, `${f} never asks the public leg itself`);
});

test("the audit (5 Nov): a landed part to a chain's wallet is Done only when this round's read of that wallet SHOWS the money, its coin up by at least the quoted least (minAmountOut) over the tap's balance; a read that merely answers after the done is no arrival (control: a payment with no quoted least is in on an answered read, as before)", async () => {
  let bal: string | null = "1000";
  const r: MoveRow = { id: "mv-q", kind: "add", usd: 6, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: "sw-site-pump", chain: "sol", usd: 6, ids: ["pocket-send:q"], base: "1000", minOut: "500" }] } };
  moved(r, { id: "pocket-send:q", status: "done" }, 100);
  assert.ok(r.priv!.landed, "the ledger's done: landed, not Done");
  const host = { d: { now: () => 200, call: async () => { if (bal === null) throw new Error("the node didn't answer"); return [{ token: "native", symbol: "SOL", decimals: 9, amount: bal }]; } }, adds: [r], asking: new Set<string>(), changed: () => {} } as never;
  const round = async () => arrivedRead(r, { roundAt: 200, nearUsd: undefined, base: 0, chain: await chainShown(host, r) });
  assert.equal(await round(), false, "the read answered after the done, the money not in it: no Done");
  bal = "1499";
  assert.equal(await round(), false, "1 unit short of the quoted least");
  bal = "1500";
  assert.equal(await round(), true, "up by the quoted least: it shows the money");
  // control: no quoted least (an older build's row, the Sim's ledger): an answered read is the arrival
  const old: MoveRow = { id: "mv-o", kind: "add", usd: 6, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: "sw-site-pump", chain: "sol", usd: 6, ids: ["pocket-send:o"] }] } };
  moved(old, { id: "pocket-send:o", status: "done" }, 100);
  assert.equal(await chainShown({ d: { now: () => 200, call: async () => [{ token: "native", amount: "0" }] } } as never, old), true);
});

test("the copy review (5 Nov): a landed part whose wallet's reads fail is a miss each round (one time model: train 10's missedRead); 3 in a row say exactly LANDED_UNREAD, never \"Still checking\", and no time ends it; a read that shows it ends it Done (control: 2 misses say nothing yet)", async () => {
  let up = false;
  const r: MoveRow = { id: "mv-f", kind: "add", usd: 6, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: "sw-site-pump", chain: "sol", usd: 6, ids: ["pocket-send:f"], base: "0", minOut: "10" }] } };
  moved(r, { id: "pocket-send:f", status: "done" }, 100);
  const host = { d: { now: () => 200, call: async () => { if (!up) throw new Error("the node didn't answer"); return [{ token: "native", amount: "10" }]; } } } as never;
  const round = async () => { if (!arrivedRead(r, { roundAt: 200, nearUsd: undefined, base: 0, chain: await chainShown(host, r) })) missedRead(r, 200); };
  await round(); await round();
  assert.equal(r.note, undefined, "control: 2 misses, nothing said");
  await round();
  assert.equal(r.note, LANDED_UNREAD);
  assert.equal(LANDED_UNREAD, "Can't read this right now. Your money is safe; it shows when the read works.");
  for (let i = 0; i < 20; i++) await round();
  assert.equal(r.status, "moving", "no time ends it");
  up = true;
  assert.equal(arrivedRead(r, { roundAt: 200, nearUsd: undefined, base: 0, chain: await chainShown(host, r) }), true, "a read that shows it: the round makes it Done");
});

test("the audit's not-MUST (5 Nov): an older build's landed part with no chain (and a status that blanked its wallet) is never \"On its way\" for good: its wallet's read is asked each round, 3 misses say LANDED_UNREAD; a wallet that answers ends it Done (control)", async () => {
  const r: MoveRow = { id: "mv-n", kind: "add", usd: 6, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: "", usd: 6, ids: ["pocket-send:n"] } as never] } };
  moved(r, { id: "pocket-send:n", status: "done" }, 100);
  assert.ok(r.priv!.landed, "landed on the ledger's word");
  const host = { d: { now: () => 200, call: async (_m: string, p: { id?: string }) => { if (!p.id) throw new Error("no such wallet"); return [{ token: "native", amount: "5" }]; } } } as never;
  const round = async () => { if (!arrivedRead(r, { roundAt: 200, nearUsd: undefined, base: 0, chain: await chainShown(host, r) })) missedRead(r, 200); };
  await round(); await round(); await round();
  assert.equal(r.note, LANDED_UNREAD, "3 rounds unread: \"Can't read this right now…\", never a bare On its way");
  // control: the same older row whose wallet is named answers its read: Done in that round
  const named: MoveRow = { id: "mv-n2", kind: "add", usd: 6, status: "moving", where: "in-flight", at: 0, priv: { parts: [{ wallet: "sw-trade-sol", usd: 6, ids: ["pocket-send:n2"] } as never] } };
  moved(named, { id: "pocket-send:n2", status: "done" }, 100);
  assert.equal(arrivedRead(named, { roundAt: 200, nearUsd: undefined, base: 0, chain: await chainShown(host, named) }), true);
});

test("the audit (5 Nov): the tap's balance read failed, so Home's last known figure of the wallet is the base: a SOL wallet that already held the quoted least does NOT tick at once, only when a read shows the money (control: with no figure known, the whole balance holding the least would tick)", async () => {
  const s = await phone();
  let bal: string | null = "5000000";
  const a = s.page({ balance: () => bal, minOut: "1000000" });
  await a.f.refresh();                                            // Home read the SOL wallet: 0.005 SOL
  bal = null;                                                     // the tap's read fails
  const r = await a.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }], key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(s.savedRow()?.priv?.parts[0]?.base, "5000000", "the base is Home's last known figure");
  await until(async () => (await s.movements()).filter((m) => m.id.startsWith("pocket-send:")).every((m) => m.status === "done") && s.savedRow()?.priv?.landed !== undefined, "the ledger says the payment is done");
  bal = "5000000";                                                // the read works; the money isn't in yet
  await a.f.refresh();
  await a.f.refresh();
  assert.equal((await a.row(`mv-${KEY}`))!.status, "on-its-way", "it already held the least: no tick at once");
  bal = "6000000";                                                // up by the least: it shows the money
  await a.f.refresh();
  assert.equal((await a.row(`mv-${KEY}`))!.status, "done");
  // control: nothing known of a wallet, the whole balance must hold it: 0.005 SOL holding the least would tick
  assert.equal(knownOf({ known: () => undefined }, "sw-never-read"), null);
  assert.equal(shows({ minOut: "1000000" }, "5000000"), true, "control: no base, the whole balance");
  assert.equal(shows({ base: "5000000", minOut: "1000000" }, "5000000"), false);
});
