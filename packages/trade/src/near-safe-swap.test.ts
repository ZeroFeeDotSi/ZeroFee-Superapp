// T-F (the UI reviewer's walk, 6 Nov, B-9/B-10): Home, Safe, Swap from NEAR for $25 with Private holding $8.86 of NEAR.
// The sheet said "If Private is short, your Safe covers the rest", then the tap was refused "Nothing moved. Private has
// $8.86, and this needs $25.00." (the Sim filled Private only from the Safe's USDC). The same Swap from USDC went. Here
// the Swap's exact ask (SwapSheet askOf: spending.topUp { swap, legs }) runs on the Sim's ledger through the real engine
// and the real Spending, and what the sheet promised before the tap (swap-cover.ts swapCover, read from the same ledger)
// must be what happens, for NEAR and USDC, Private short and not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SafeCoin } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { swapCover } from "../../wallet/src/app/money/swap-cover.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const WNEAR = "nep141:wrap.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

async function phone(o: { pocketUsd: string; pocketNear: string }) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 20, float: { moveMs: 10 }, hiddenStart: { usdc: o.pocketUsd, near: o.pocketNear }, safeFillOpen: true });
  for (const chain of ["sol", "hood", "bsc"]) await mock.call("subwallet.create", { kind: "trade", chain });
  const kept = new Map<string, unknown>();
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok as never;
  };
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async (k) => structuredClone(kept.get(k)), set: async (k, v) => { kept.set(k, structuredClone(v)); }, now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5, fromPrivate: true });
  const host = async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T;
  const svc = createSpendingService({ engine: () => f as never, call: host });
  const safe = async () => ((await mock.call<any>("ledger.balances", {})) as any).ok as SafeCoin[];
  const pocket = async () => ((await mock.call<any>("ledger.private", {})) as any).ok.rows as SafeCoin[];
  const amount = async (rows: Promise<SafeCoin[]>, id: string, held?: string) => Number((await rows).find((r) => r.tokenId === id && (!held || r.held === held))?.amount ?? 0);
  return { mock, svc, safe, pocket, amount };
}

/** The Swap's tap, as SwapSheet askOf makes it: the Safe's coin to the SOL wallet. */
const swap = (svc: { call: (m: string, p: Record<string, unknown>) => Promise<any> }, coin: "NEAR" | "USDC", usd: number, key: string) => svc.call("spending.topUp", { usd, swap: coin, legs: [{ network: "sol", usd }], key });

for (const c of [
  { coin: "NEAR" as const, pocketNear: "2", pocketUsd: "0", usd: 25, want: "cover", what: "NEAR, Private short ($8.86 of $25): the Safe's NEAR fills it" },
  { coin: "NEAR" as const, pocketNear: "10", pocketUsd: "0", usd: 25, want: "plain", what: "NEAR, Private covers ($44.30): no fill (control)" },
  { coin: "USDC" as const, pocketNear: "2", pocketUsd: "5", usd: 25, want: "cover", what: "USDC, Private short ($5 of $25): the Safe's USDC fills it (control: as before)" },
  { coin: "USDC" as const, pocketNear: "0", pocketUsd: "50", usd: 25, want: "plain", what: "USDC, Private covers: no fill (control)" },
]) {
  test(`T-F: the sheet's promise is what the tap does: ${c.what}`, async () => {
    const p = await phone({ pocketUsd: c.pocketUsd, pocketNear: c.pocketNear });
    const id = c.coin === "NEAR" ? WNEAR : USDC;
    const said = swapCover({ coin: c.coin, usd: c.usd, safe: await p.safe(), pocket: await p.pocket(), fillOpen: true });
    assert.deepEqual(said, { kind: c.want }, "what the sheet says before the tap");
    const safeBefore = await p.amount(p.safe(), id, "ledger");
    const r = await swap(p.svc, c.coin, c.usd, "home-swap-0123456789abcdef01234567");
    assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
    const fell = safeBefore - (await p.amount(p.safe(), id, "ledger"));
    if (c.want === "cover") assert.ok(fell > 0, `the Safe's ${c.coin} filled Private (fell ${fell})`);
    else assert.ok(Math.abs(fell) < 1e-9, `nothing from the Safe (fell ${fell})`);
  });
}

test("T-F, fixed (audit, 6 Nov): NEAR on the account fills Private in the Sim, as the real core now takes that fill (real-core-paths T-F, fixed): the account's NEAR falls, the filled part is the ledger's safe-send: job, the Safe's wNEAR in NEAR Intents untouched (control: wNEAR in NEAR Intents is filled from its own row)", async () => {
  const p = await phone({ pocketUsd: "0", pocketNear: "2" });
  const [acct, intents] = [await p.amount(p.safe(), "near", "account"), await p.amount(p.safe(), WNEAR, "ledger")];
  const r = await p.mock.call<any>("ledger.moveFromPrivate", { app: "trade", parts: [{ wallet: "near", usd: 25 }], tokenId: "near" });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.ok(r.ok.parts[0].ids.some((x: string) => x.startsWith("safe-send:")), "the filled part is the ledger's safe-send: job");
  assert.ok(acct - (await p.amount(p.safe(), "near", "account")) > 0, "the account's NEAR filled Private");
  assert.equal(await p.amount(p.safe(), WNEAR, "ledger"), intents, "NEAR Intents' wNEAR untouched");
  const q = await phone({ pocketUsd: "0", pocketNear: "2" });
  const acct2 = await q.amount(q.safe(), "near", "account");
  const ok = await q.mock.call<any>("ledger.moveFromPrivate", { app: "trade", parts: [{ wallet: "near", usd: 25 }], tokenId: WNEAR });
  assert.ok("ok" in ok, JSON.stringify(ok));
  assert.ok(ok.ok.parts[0].ids.some((x: string) => x.startsWith("safe-send:")), "control: the wNEAR fill as before");
  assert.equal(await q.amount(q.safe(), "near", "account"), acct2, "control: the account's NEAR untouched there");
});
