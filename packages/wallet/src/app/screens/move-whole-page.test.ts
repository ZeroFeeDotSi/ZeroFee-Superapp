// C2 on the page (the audit's conditions 1, 3 and 5, 7 Nov): Move's tap sends its wallet parts with the Safe's step
// (spending.topUp `others`, each leg's own figure, "all" too) and each wallet leg carries the Move's key (spending.move
// `job`), so the core caps it; a no on the Safe's sheet starts no wallet leg. And the bypass pin: the sheet's wallet parts
// are kept only by spending.topUp, and ledger.moveFromPrivate (which never takes them) has one caller, the engine's
// Private add that topUp starts. Fails on f7c52792d: no `others`, no `job`, no keepOthers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import type { Problem } from "@zerofee/core/problem";
import { runMove, type MoveRunIo } from "./move-run.ts";
import { planOf, type Leg } from "./move-split.ts";

const tasks = taskStore().forApp("wallet");
const ok = (id: string) => ({ ok: { id, kind: "move", usd: "5.00", status: "on-its-way", shown: true, atIso: new Date(0).toISOString(), words: "" } });
function io(answers: unknown[]) {
  const called: { m: string; p: Record<string, unknown> }[] = [];
  const o: MoveRunIo = {
    call: async <T,>(m: string, p: Record<string, unknown>) => { called.push({ m, p }); return answers[called.length - 1] as { ok: T } | { problem: Problem }; },
    tasks, keyFor: (w) => `home-move-${w.replace(/[^a-z0-9]/gi, "").slice(0, 20).padEnd(16, "x")}`, fills: false,
    onApproval: () => () => {}, say: () => {}, asking: () => {}, made: () => {}, refused: () => {}, declined: () => {},
  };
  return { o, called };
}
// the owner's Move: the Safe to the NEAR and SOL wallets, the ETH (RH) wallet's $3.94 to SOL and $5.52 to NEAR
const LEGS: Leg[] = [{ from: "safe", to: "near", usd: 101.48 }, { from: "safe", to: "sol", usd: 8.39 }, { from: "hood", to: "sol", usd: 3.94 }, { from: "hood", to: "near", usd: 5.52 }];

test("the Safe's step carries the Move's wallet parts, each its own figure; each wallet leg carries the Move's key", async () => {
  const { o, called } = io([ok("t"), ok("a"), ok("b")]);
  await runMove(LEGS, planOf(LEGS), o);
  assert.deepEqual(called.map((c) => c.m), ["spending.topUp", "spending.move", "spending.move"]);
  const key = called[0]!.p.key;
  assert.equal(typeof key, "string");
  assert.deepEqual(called[0]!.p.others, [{ from: "hood", to: "sol", usd: 3.94 }, { from: "hood", to: "near", usd: 5.52 }]);
  assert.deepEqual(called.slice(1).map((c) => c.p.job), [key, key], "each wallet leg names its Move");
  // control: a Move with no wallet part sends none
  const safeOnly: Leg[] = [{ from: "safe", to: "sol", usd: 20 }];
  const c2 = io([ok("u")]);
  await runMove(safeOnly, planOf(safeOnly), c2.o);
  assert.equal(c2.called[0]!.p.others, undefined);
});

test("the audit's condition 3 on the page: Not now on the Safe's sheet starts no wallet leg", async () => {
  const { o, called } = io([{ ok: { declined: true } }, ok("a"), ok("b")]);
  assert.equal(await runMove(LEGS, planOf(LEGS), o), null);
  assert.deepEqual(called.map((c) => c.m), ["spending.topUp"]);
  assert.equal((called[0]!.p.others as unknown[] | undefined)?.length, 2, "the parts went with the step the no ended (the core ends them)");
});

test("the audit's condition 5, the bypass pin: wallet parts are kept only by spending.topUp; ledger.moveFromPrivate's one caller is the engine's Private add (tools read, never edited; tools/realmoney, walk and mainnet left out by rule)", () => {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const f = join(d, n); if (n === "node_modules" || n.startsWith(".") || n === "dist" || /^tools\/(realmoney|walk|mainnet)$/.test(relative(root, f))) continue; const st = statSync(f); if (st.isDirectory()) walk(f); else if (/\.(ts|tsx|mjs)$/.test(n) && !/\.test\.(ts|tsx|mjs)$/.test(n)) files.push(f); } };
  for (const d of ["packages", "apps/web/src", "tools"]) walk(join(root, d));
  const rel = (f: string) => relative(root, f);
  const callsLedger = files.filter((f) => /\.call(<[^>]*>)?\(\s*"ledger\.moveFromPrivate"/.test(readFileSync(f, "utf8"))).map(rel).sort();
  assert.deepEqual(callsLedger, ["packages/trade/src/float-private.ts"], "a new caller of ledger.moveFromPrivate: say whether it has wallet legs (then through spending.topUp)");
  const keeps = files.filter((f) => /\bkeep(Others|For)\(/.test(readFileSync(f, "utf8"))).map(rel).sort();
  assert.deepEqual(keeps, ["packages/core/src/spending-move.ts", "packages/core/src/spending.ts"]);
  // the engine's call never carries wallet parts; the ledger never reads them
  assert.doesNotMatch(readFileSync(join(root, "packages/trade/src/float-private.ts"), "utf8"), /others/);
  assert.doesNotMatch(readFileSync(join(root, "packages/wallet/src/private-move.ts"), "utf8"), /\bothers\b/);
});
