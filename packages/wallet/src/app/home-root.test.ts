// Home listens for the shell's zf:home-root and returns to its root by its own closes (a-nav-5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./WalletApp.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("./money/send.css", import.meta.url)), "utf8");

test("Home closes its sheet and sub-page on zf:home-root for its own app only", () => {
  assert.match(src, /addEventListener\("zf:home-root", back\)/);
  assert.match(src, /removeEventListener\("zf:home-root", back\)/);
  assert.match(src, /detail\?\.app !== "wallet"\) return;\s*setSheet\(null\);\s*setView\(\{ kind: "tabs" \}\);/);
});

test("Send's network chips fade at the right edge and keep the last chip reachable", () => {
  const rule = css.match(/\.wl-send2__nets \.wl-chips \{[^}]*\}/)![0];
  assert.match(rule, /overflow-x: auto/);
  assert.match(rule, /padding-right: 24px/);
  assert.match(rule, /mask-image: linear-gradient\(to right, #000 calc\(100% - 24px\), transparent\)/);
});

test("Request money: a 200 px QR card, Ask for another a quiet capsule, the note and Move's amount draw no white inset ring on focus", () => {
  const sheet = readFileSync(fileURLToPath(new URL("./money/RequestSheet.tsx", import.meta.url)), "utf8");
  const wallet = readFileSync(fileURLToPath(new URL("./wallet.css", import.meta.url)), "utf8");
  assert.match(sheet, /wl-req-share wl-req-again" onClick=\{\(\) => setMade\(null\)\}>\{W\.again\}/);
  assert.match(wallet, /\.wl-qr-big \{ box-sizing: border-box; max-width: 232px;/);
  assert.match(wallet, /\.wl-request-note:focus \{ box-shadow: none; background: var\(--fill-2\); outline: none; \}/);
  const move = readFileSync(fileURLToPath(new URL("./money/move-swap.css", import.meta.url)), "utf8");
  assert.match(move, /\.wl-mv-type:focus \{ outline: none; box-shadow: none; border-bottom: 1px solid var\(--ink\); \}/);
});

test("zf:home-root only declines or hides: a money sheet closes by its own Close (not now, sealed), never an approve", () => {
  const host = readFileSync(fileURLToPath(new URL("./money/MoneyHost.tsx", import.meta.url)), "utf8");
  const at = host.indexOf('addEventListener("zf:home-root", hear)');
  const hear = host.slice(host.lastIndexOf("const hear", at), at);
  assert.match(hear, /detail\?\.app === asker\) endRef\.current\(\{ went: false \}\)/, "the one thing it does: the Close path, not now");
  assert.doesNotMatch(hear, /went: true|approve|sign|answer\(/i, "a page script that sends the event cannot approve or sign");
  // the Close path seals the sheet (nothing unsigned is signed after it) and says nothing failed
  assert.match(host, /if \(!e\.went\) \{\s*gone\.current = true;\s*moneyClosed\(\);/);
});

test("a sheet past signing only hides: its job and rows carry on, nothing is cancelled, failed or ended", () => {
  const host = readFileSync(fileURLToPath(new URL("./money/MoneyHost.tsx", import.meta.url)), "utf8");
  // a Close after an Approve says the move is on its way (the core's now); it only stops a later signature
  assert.match(host, /sayWent\(approved\.current \? "It's on its way\." : "", "went"\)/);
  const closed = readFileSync(fileURLToPath(new URL("../../../core/src/money-closed.ts", import.meta.url)), "utf8");
  assert.match(closed, /a step already signed, or a move already on its way, carries on as it was/);
  // Home's own reset: its listener hides a sheet and a page (setSheet, setView), and calls no cancel or end of any job
  const body = src.slice(src.indexOf('const back = (e: Event)'), src.indexOf('removeEventListener("zf:home-root", back)'));
  assert.match(body, /setSheet\(null\);\s*setView\(\{ kind: "tabs" \}\);/);
  assert.doesNotMatch(body, /cancel|fail|stop|end\(|bridge\.call|shell\./i);
  // the Activity page leaving only clears its own overlay; the job's row is the ledger's and stays
  const act = readFileSync(fileURLToPath(new URL("./screens/Activity.tsx", import.meta.url)), "utf8");
  assert.match(act, /useEffect\(\(\) => \(\) => slot\?\.release\(\), \[slot\]\);/);
});

// ---- a Move on its way when the Home tab is tapped again (QA): the event hides the sheet and only that.
// No DOM harness mounts the whole sheet here, so the two halves are pinned apart, each by what it can prove: the money
// half runs on the REAL core (the Sim's mock bridge, createCoreFloat, createSpendingService: the same engine the Move
// sheet drives; the sheet's Approve is exactly spending.topUp), the sheet half is pinned above (MoneyHost's listener is
// the Close path, "not now", never an approve). The join: nothing outside the shell and the two hosts listens for the event.
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "../../../trade/src/float-core.ts";
import { everyLanded, runOf, type Run } from "./screens/move-split.ts";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;

async function engine() {
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 5, timers: clock.timers, float: { moveMs: 10, timers: clock.timers } }));
  /** A round's 40 ms of the test's own time: the engine's calls answered, then the Sim's steps due by then land in order. */
  const settle = async () => { await clock.quiet(); await clock.advance(40); };
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  /** The engine's own timers (its rounds and its follow each second), run by hand: the app runs them while it's open. */
  const ticks: (() => void)[] = [];
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: (fn) => { ticks.push(fn); return () => undefined; }, rng: () => 0.5 });
  f.start();
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const rows = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return r.ok; };
  return { svc, rows, ticks, f, step: async () => { for (const tick of ticks) tick(); await settle(); await f.refresh(); t += 5_000; } };
}

test("a Move Safe → SOL on its way: zf:home-root leaves the job, its Home row and its landing untouched (the receipt arrives)", async () => {
  const e = await engine();
  const add = await e.svc.call<SpendingActivity>("spending.topUp", { usd: 3.5, legs: [{ network: "sol", usd: 3.5 }] });
  assert.ok("ok" in add, JSON.stringify(add));
  const id = add.ok.id;
  const follow = { leg: { from: "safe", to: "sol", usd: 3.5 }, id, by: "topup" } as const;
  const state = async () => { const r = (await e.rows()).find((x) => x.id === id); assert.ok(r, "the Home row for the Move exists"); return r!; };
  // on its way: created, not yet landed (no round of the engine has run)
  const before = await state();
  const runBefore = runOf(follow, await e.rows());
  assert.notEqual(runBefore.state, "done", "on its way, not landed yet");
  // the shell's event, as AppHost sends it, on a real EventTarget with the engine live
  const target = new EventTarget();
  let heard = 0;
  target.addEventListener("zf:home-root", () => { heard++; });
  target.dispatchEvent(new CustomEvent("zf:home-root", { detail: { app: "wallet" } }));
  assert.equal(heard, 1);
  const after = await state();
  assert.deepEqual([after.id, after.status ?? after.state], [before.id, before.status ?? before.state], "job state unchanged by the event");
  assert.equal((await e.rows()).filter((x) => x.id === id).length, 1, "its Home row still exists, once");
  // later it lands, with its receipt
  let runs: Run[] = [];
  for (let i = 0; i < 40; i++) { await e.step(); runs = [runOf(follow, await e.rows())]; if (everyLanded(runs, 1)) break; }
  assert.deepEqual(runs.map((r) => r.state), ["done"], "the Move landed after the event");
  assert.ok((await state()).id === id, "and its row is the same job, now with its receipt");
});

test("join: only the shell sends zf:home-root; only the Wallet's Home and the money host hear it; no core, trade, agent or bridge code does", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const hits: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { if (n === "node_modules" || n.startsWith(".") || n === "dist") continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && readFileSync(p, "utf8").includes("zf:home-root")) hits.push(p.slice(root.length)); } };
  walk(join(root, "packages")); walk(join(root, "apps"));
  assert.deepEqual(hits.sort(), ["apps/web/src/shell/AppHost.tsx", "packages/wallet/src/app/WalletApp.tsx", "packages/wallet/src/app/money/MoneyHost.tsx"]);
});
