// Audit 10's A4 (8 Nov): Send's Max on a Safe coin offered "$1,333.28 ready" that the Safe's own $500 rule refuses, and
// the refusal's "Protection" opened the rules UNDER the Send sheet (nothing changed on screen). Now "ready" and Max are
// capped at what the rules let go today (the core's figure, account.protection.get's sendLeftUsd), and the over-limit
// Problem sits above the Send sheet; its Protection closes the Send sheet first. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { readyUsd, ruleCap } from "./send-cap.ts";
import { sendable } from "./send-sources.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const near = { row: null, symbol: "NEAR", amount: "326.9", usd: "1448.16", max: "305.2", pocket: "2" };

test("ruleCap: a Safe coin's max comes down to what the rules let go today; ready (what Max pays) never says more than that figure (controls: a wallet, Private-only, no figure read, a rule over the whole coin)", () => {
  const per = 1448.16 / 326.9;
  const capped = ruleCap(near, 485.43);
  assert.ok(Number(capped.max) < Number(near.max), "capped");
  const ready = readyUsd(sendable(capped, 24), per)!;
  assert.ok(ready > 0 && ready <= 485.43, `ready $${ready}`);
  assert.ok(readyUsd(capped.max, per)! >= 485.43, "the fill bound holds the whole ask the rule lets go");
  assert.equal(ruleCap({ ...near, row: "sol" }, 10).max, "305.2", "a wallet: no Safe rule");
  assert.equal(ruleCap({ ...near, privateOnly: true }, 10).max, "305.2", "Private-only: no Safe rule");
  assert.equal(ruleCap(near, null).max, "305.2", "not read yet: unchanged");
  assert.equal(ruleCap(near, 100_000).max, "305.2", "the rule lets all of it go");
  assert.equal(ruleCap(near, 0).max, "2", "nothing left today: Private's own part still goes");
  const usdc = ruleCap({ row: null, symbol: "USDC", amount: "1385.6", usd: "1385.6", max: "1240.5" }, 485.43);
  assert.match(usdc.max, /^\d+(\.\d{1,6})?$/, "a dollar coin at its 6 places");
});

test("the Sim as the core: account.protection.get with room says what one Send can take today; Max at the capped figure goes, the old Max is refused, and a send lowers the figure (control: without room, no figure)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: { demoWaitSeconds: 120 }, hiddenStart: { usdc: "0", near: "0" } });
  const room = async () => ((await mock.call<{ sendLeftUsd?: number }>("account.protection.get", { room: true })) as { ok: { sendLeftUsd?: number } }).ok.sendLeftUsd;
  const plain = (await mock.call<{ sendLeftUsd?: number }>("account.protection.get", {})) as { ok: { sendLeftUsd?: number } };
  assert.equal(plain.ok.sendLeftUsd, undefined, "control: Protection's own read carries no figure");
  const left = await room();
  assert.ok(typeof left === "number" && left > 400 && left <= 500, `left $${left}`);
  const src = ruleCap({ row: null, symbol: "USDC", amount: "1385.6", usd: "1385.6", max: "1385.6" }, left);
  const go = (amount: string, upTo: string) => mock.call<Record<string, unknown>[]>("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount, upTo, to: { kind: "ledger", accountId: "bob.near" }, fill: true });
  const old = await go("1385.6", "1385.6");
  assert.ok("problem" in old && old.problem.code === "security.send.over-limit", "control: the uncapped Max is refused");
  const r = await go(src.max, src.max);
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
  const after = await room();
  assert.ok(typeof after === "number" && after < left, `the figure falls after a send: $${left} -> $${after}`);
});

test("the over-limit Problem shows above the Send sheet, and its Protection closes the Send sheet first (control: Send $Y keeps the sheet and refills it)", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const z = (text: string, sel: string) => Number(new RegExp(`\\${sel} \\{[^}]*z-index: (\\d+)`).exec(text)?.[1]);
  const problem = z(src("../../../../../apps/web/src/shell/apphost.css"), ".ah-problem"), sheet = z(src("../../../../design/src/sheet.css"), ".zf-sheet");
  assert.ok(problem > sheet, `the Problem layer (${problem}) is over the money sheet (${sheet})`);
  const host = src("../../../../../apps/web/src/shell/AppHost.tsx");
  assert.match(host, /showProblem: \(p\) => api\.current\.showProblem\(money\.at, p\)/, "the money sheet's Problems go to the shell's layer");
  const sheetSrc = src("./SendSheet.tsx");
  assert.match(sheetSrc, /if \(next\.kind === "open" && next\.screen === "security\/protection"\) \{ onClose\(false\); return ""; \}/, "Protection closes Send first");
  assert.match(sheetSrc, /return next\.kind === "open" && next\.screen\.startsWith\(SEND_UP_TO\) \? next\.screen\.slice\(SEND_UP_TO\.length\) : "";/, "control: Send $Y refills");
  assert.match(sheetSrc, /"account\.protection\.get", \{ room: true \}/, "Send reads the rule's figure");
  assert.match(sheetSrc, /\.map\(\(s\) => ruleCap\(s, leftUsd\)\)/, "each Safe coin capped");
});

test("A4 shots: Max at the capped figure goes as it pays (the Sim checked its raw upTo, whose whole fill step tipped over the rule: refused at $430.09 on its button) (control: a Send over the rule is still refused)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: {}, hiddenStart: { usdc: "25", near: "2" }, freshHistory: true });
  const left = ((await mock.call<{ sendLeftUsd?: number }>("account.protection.get", { room: true })) as { ok: { sendLeftUsd?: number } }).ok.sendLeftUsd!;
  const row = ((await mock.call<{ tokenId: string; held?: string; amount: string; usd: string }[]>("ledger.balances", {})) as { ok: { tokenId: string; held?: string; amount: string; usd: string }[] }).ok.find((b) => b.tokenId === "nep141:wrap.near" && b.held === "ledger")!;
  const cap = ruleCap({ row: null, symbol: "NEAR", amount: row.amount, usd: row.usd, max: row.amount }, left).max;
  const go = (amount: string, upTo?: string) => mock.call<Record<string, unknown>[]>("ledger.sendFromSafe", { app: "wallet", tokenId: "nep141:wrap.near", amount, ...(upTo ? { upTo } : {}), to: { kind: "ledger", accountId: "bob.near" }, fill: true });
  const over = await go(String(Number(cap) * 1.3));
  assert.ok("problem" in over && over.problem.code === "security.send.over-limit", "control: over the rule, refused");
  const r = await go(cap, cap);
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
});
