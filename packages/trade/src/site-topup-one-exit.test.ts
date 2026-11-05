// A site's top-up, one exit (QA, 5 Nov), through the real engine and Spending on the Sim's ledger: from
// Private, exactly ONE exit to the site's wallet, no fill, no Face ID, never ledger.toTrading; from the Safe (Private
// short, the fill open), exactly ONE fill under ONE Face ID, then that ONE exit. The engine asks the ledger `whole`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { fillStepUsd } from "@zerofee/core/private-route";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";

const KEY = "site-topup-0123456789abcdef0123";
const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function phone(o: { pocketUsd: string; fillOpen?: boolean }) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 20, float: { moveMs: 10 }, hiddenStart: { usdc: o.pocketUsd, near: "0" }, ...(o.fillOpen ? { safeFillOpen: true } : {}) });
  // the Safe's sheets, each answered yes: one per Face ID
  const sheets: string[] = [];
  mock.on<{ id: string; words: { title: string } }>("approval.needed", (p) => { sheets.push(p.words.title); void mock.call("approval.answer", { id: p.id, approve: true }); });
  const kept = new Map<string, unknown>();
  const asked: { method: string; params: Record<string, unknown> }[] = [];
  for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (/^ledger\.(toTrading|moveFromPrivate)$/.test(method)) asked.push({ method, params });
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok as never;
  };
  const f = createCoreFloat({
    offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd),
    get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5, fromPrivate: true,
  });
  const host = async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T;
  const svc = createSpendingService({ engine: () => f as never, call: host });
  const site = ((await mock.call<any>("subwallet.site.forHost", { site: { origin: "https://pump.fun" }, chain: "sol", app: "browser" })) as any).ok as { id: string; address: string };
  const movements = async () => ((await mock.call<any>("ledger.activity", {})) as any).ok as { id: string; kind: string; to?: string; amount: string }[];
  return { svc, asked, sheets, site, movements };
}
const fills = (ms: { kind: string }[]) => ms.filter((m) => m.kind === "private");
const exitsTo = (ms: { id: string; to?: string }[], to: string) => ms.filter((m) => /^(pocket|safe)-send:/.test(m.id) && m.to === to);

test("(2) from Private: exactly one exit to the site's wallet, no fill, no Face ID, never ledger.toTrading; the ledger is asked `whole`", async () => {
  const s = await phone({ pocketUsd: "25" });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 10, ready: s.site.id, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(s.asked.map((x) => [x.method, x.params.parts, x.params.whole]), [["ledger.moveFromPrivate", [{ wallet: s.site.id, usd: 10 }], true]]);
  const ms = await s.movements();
  assert.equal(exitsTo(ms, s.site.address).length, 1);
  assert.deepEqual([fills(ms).length, s.sheets.length], [0, 0], "no fill, no Face ID");
});

test("from the Safe (Private short, the fill open): exactly one fill under one Face ID, then one exit; never toTrading (control: Private covers, no fill)", async () => {
  const s = await phone({ pocketUsd: "3", fillOpen: true });
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 20, ready: s.site.id, key: KEY });
  assert.ok("ok" in r, JSON.stringify(r));
  const ms = await s.movements();
  assert.equal(fills(ms).length, 1, "one fill");
  assert.equal(Number(fills(ms)[0]!.amount), fillStepUsd(20), "the whole $20 rounded up a step");
  assert.equal(s.sheets.length, 1, "one Face ID, on the fill");
  assert.equal(exitsTo(ms, s.site.address).length, 1, "one exit");
  assert.ok(!s.asked.some((x) => x.method === "ledger.toTrading"));
  const c = await phone({ pocketUsd: "50", fillOpen: true });
  assert.ok("ok" in (await c.svc.call<SpendingActivity>("spending.topUp", { usd: 20, ready: c.site.id, key: KEY })));
  const cm = await c.movements();
  assert.deepEqual([fills(cm).length, c.sheets.length, exitsTo(cm, c.site.address).length], [0, 0, 1], "Private covers it: no fill");
});
