// C2 on the phone (the audit's required shape, 7 Nov): the page (Spending, the engine) and the core (the Sim's ledger and sheet,
// here playing the isolated core) are two JS realms, so the parts the page keeps are never the core's. spending.topUp
// sends them across (subwallet.moveOthers, whole cents), the core keeps them by its own read, and its one sheet says them;
// a part over the core's read (though under the page's) is not said; Not now ends them in the core too.
// Fails on b5f0022f9: nothing crosses, so the core's sheet is the Safe's side only ("Move $33.75 ..." never shows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService } from "@zerofee/core/spending";
import * as plan from "@zerofee/core/spending-move";
import type { PlainWords } from "@zerofee/core/signer";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "@zerofee/trade/float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];

// two realms: the store the core's code sees while the core runs, and the page's otherwise
const PAGE = new Map<string, unknown>(), CORE = new Map<string, unknown>();
let inCore = 0;
Object.defineProperty(globalThis, Symbol.for("zerofee.move-others"), { get: () => (inCore > 0 ? CORE : PAGE), set: () => {}, configurable: true });
const asCore = async <T,>(f: () => Promise<T>): Promise<T> => { inCore++; try { return await f(); } finally { inCore--; } };

async function phone(coreHoodUsd: number) {
  // The Sim's timed steps wait on the test's own clock, which never moves here: nothing these tests read needs a landing.
  // On the wall's clock a 10 or 20 ms step landed mid-Move on a busy machine; its engine reads run as the core (`inCore`),
  // so a page keep in that window went to the core's store (the land gate's full run, 7 Nov: :77 "the page's own keep").
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 20, timers: clock.timers, float: { moveMs: 10, timers: clock.timers, opening: { hood: "3000000000000000" } }, safeFillOpen: true, hiddenStart: { usdc: "8", near: "0" } }));
  for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
  const crossed: Record<string, unknown>[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  // the core's own read: the ETH (RH) wallet at what the core reads, not the page's engine
  const coreRead = async () => ({ reserveUsd: 0, chains: [{ chain: "hood", nativeUsd: coreHoodUsd, readyUsd: 0, coinsUsd: 0 }] });
  const call: CoreFloatDeps["call"] = async (method, params) => {
    // the core's sheet waits for a check still reading (subwallets othersSettled)
    if (method === "ledger.moveFromPrivate") await pending;
    const r = await asCore(() => mock.call<any>(method, params));
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok as never;
  };
  const kept = new Map<string, unknown>();
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5, fromPrivate: true });
  const host = async <T,>(m: string, p: Record<string, unknown>): Promise<T> => {
    if (m === "subwallet.moveOthers") {
      crossed.push(structuredClone(p));
      const job = String(p.job);
      const run = asCore(async () => (p.end === true ? (plan.endOthers(job), 0) : plan.keepInCore(job, p.others, coreRead)));
      pending = run;
      return { kept: await run } as T;
    }
    return (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T;
  };
  const svc = createSpendingService({ engine: () => f as never, call: host });
  let say = true;
  const sheets: PlainWords[] = [];
  mock.on<{ id: string; words: PlainWords }>("approval.needed", (a) => { sheets.push(a.words); void mock.call("approval.answer", { id: a.id, approve: say }); });
  await f.refresh();
  const hood = f.snapshot().chains.find((c) => c.chain === "hood")!;
  return { svc, crossed, sheets, quiet: clock.quiet, answer: (yes: boolean) => { say = yes; }, hoodUsd: hood.nativeUsd + hood.readyUsd + hood.coinsUsd };
}
const top = (s: Awaited<ReturnType<typeof phone>>, key: string, others?: unknown) => s.svc.call("spending.topUp", { usd: 30, legs: [{ network: "sol", usd: 20 }, { network: "near", usd: 10 }], key, caller: "wallet", ...(others ? { others } : {}) });
const block = (w: PlainWords) => [w.title, ...w.lines.slice(0, w.lines.indexOf("Anyone can see the Safe's part.") + 1)];

test("the phone: the page's parts cross to the core in whole cents under the Move's key, and the core's own sheet says the whole Move (control: honest parts)", async () => {
  const s = await phone(4);
  assert.ok(s.hoodUsd >= 4, `the Sim's Robinhood wallet holds ${s.hoodUsd}`);
  const A = "phone-move-a-0123456789";
  const r = await top(s, A, [{ from: "hood", to: "sol", usd: 2.5 }, { from: "hood", to: "near", usd: 1.25 }]);
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(s.crossed.at(-1), { job: A, others: [{ from: "hood", to: "sol", cents: "250" }, { from: "hood", to: "near", cents: "125" }] });
  const a = block(s.sheets.at(-1)!);
  assert.equal(a[0], "Move $33.75 to your SOL and NEAR wallets", a.join(" | "));
  assert.ok(a.includes("From Robinhood wallet · about $3.75"), a.join(" | "));
});

test("the phone: a part the page's engine would allow but over the core's own read is not said (the Safe's side only); a malformed part never crosses", async () => {
  const s = await phone(2);
  const r = await top(s, "phone-move-b-0123456789", [{ from: "hood", to: "sol", usd: 2.5 }]);
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(PAGE.has("phone-move-b-0123456789"), true, "the page's own keep took it (its engine reads more)");
  const b = block(s.sheets.at(-1)!);
  assert.equal(b[0], "Move $30.00 to your SOL and NEAR wallets", b.join(" | "));
  assert.ok(!b.some((l) => /Robinhood wallet|ETH \(RH\)/.test(l)), b.join(" | "));
  // malformed: crosses as none, the Safe's side only
  assert.ok("ok" in (await top(s, "phone-move-c-0123456789", [{ from: "hood", to: "sol", usd: "all" }])));
  assert.deepEqual(s.crossed.at(-1), { job: "phone-move-c-0123456789", others: null });
  assert.equal(block(s.sheets.at(-1)!)[0], "Move $30.00 to your SOL and NEAR wallets");
  // control: under the core's read, on the same phone, said
  assert.ok("ok" in (await top(s, "phone-move-d-0123456789", [{ from: "hood", to: "sol", usd: 1.5 }])));
  assert.ok(block(s.sheets.at(-1)!).includes("From Robinhood wallet · about $1.50"), block(s.sheets.at(-1)!).join(" | "));
});

test("the phone: Not now ends the parts in the core too (a leg there with the key is refused); no parts, nothing crosses", async () => {
  const s = await phone(4);
  s.answer(false);
  const K = "phone-move-e-0123456789";
  const r = await top(s, K, [{ from: "hood", to: "sol", usd: 2.5 }]);
  assert.ok("ok" in r && "declined" in (r.ok as object), JSON.stringify(r));
  // Not now's end crosses on its own (spending.ts end()): every bridge call answered, no 5 ms wall wait
  await s.quiet();
  assert.deepEqual(s.crossed.at(-1), { job: K, end: true });
  inCore++;
  try { assert.match(plan.legCap(K, "hood", "sol", 2.5) ?? "", /no longer has this Move's plan/); } finally { inCore--; }
  s.answer(true);
  const n = s.crossed.length;
  assert.ok("ok" in (await top(s, "phone-move-f-0123456789")));
  assert.equal(s.crossed.length, n, "a Move with no wallet parts sends nothing across");
});

test("(c) only Home's own Move says wallet parts: from AgentZero, Browser, a site's app, Chat or a call naming no one they're never kept or sent to the core, and the sheet is the Safe's side only (control: Home's)", async () => {
  const s = await phone(4);
  const parts = [{ from: "hood", to: "sol", usd: 2.5 }];
  for (const caller of ["agent", "browser", "social", "chat", "trade", undefined]) {
    const key = `phone-gate-${caller ?? "none"}-0123456789`;
    const n = s.crossed.length;
    const r = await s.svc.call("spending.topUp", { usd: 30, legs: [{ network: "sol", usd: 20 }, { network: "near", usd: 10 }], key, ...(caller ? { caller } : {}), others: parts });
    // refused by Spending's own gate (Wallet and Trade only), or gone ahead with the Safe's side only
    assert.ok("ok" in r || r.problem.code === "security.request.not-allowed", `${caller}: ${JSON.stringify(r)}`);
    assert.equal(s.crossed.length, n, `${caller}: nothing crosses`);
    assert.equal(PAGE.has(key), false, `${caller}: nothing kept in the page`);
    if ("ok" in r) assert.ok(!block(s.sheets.at(-1)!).some((l) => /Robinhood wallet|ETH \(RH\)/.test(l)), `${caller}: ${block(s.sheets.at(-1)!).join(" | ")}`);
  }
  assert.ok("ok" in (await top(s, "phone-gate-home-0123456789", parts)));
  assert.ok(block(s.sheets.at(-1)!).includes("From Robinhood wallet · about $2.50"), "control: Home's own Move");
});
