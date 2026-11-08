// Builder QA's item 8 (audit 15's SA-2, audit 16's S4, Activity + Account graded C+): in the Sim, Activity → Account said
// "Nothing yet." after the account was made, its words checked and three moves done. A new account's set-up is on its
// record (the real core reads its key and its backup words off the set-up transaction, core activity.ts), so the Sim's
// Account tab has those rows, once, through ?demo's own filter (Screens.tsx demoActivity keeps sample-change rows only).
// And the tab's reading line names who does it, with no ellipsis. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "@zerofee/core/bridge";
import { createMockBridge } from "./MockBridge.ts";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};
type Row = { title: string; txHash: string; by?: string; ok?: boolean };
/** Screens.tsx demoActivity's filter: the Sim's own rows only, never the gallery's samples. */
const demoOwn = (rows: Row[]) => rows.filter((r) => /^sample-(agent|change)/.test(String(r.txHash ?? "")));

test("item 8: the account made, Activity → Account has its set-up rows, newest first, once", async () => {
  const m = createMockBridge({ latencyMs: 0, mainnetRules: {}, freshHistory: true });
  assert.deepEqual(demoOwn(ok(await m.call<Row[]>("account.activity", { limit: 50 }))), [], "control: before the account, nothing");
  ok(await m.call("account.create", {}));
  ok(await m.call("account.create", {})); // the Sim's boot asks again
  const rows = demoOwn(ok(await m.call<Row[]>("account.activity", { limit: 50 })));
  assert.deepEqual(rows.map((r) => r.title), ["Added your backup words", "Gave this device its key"]);
  assert.ok(rows.every((r) => r.ok === true && r.by === "This device"));
});

test("item 8: the same with the Sim's default options", async () => {
  const m = createMockBridge({ latencyMs: 0 });
  ok(await m.call("account.create", {}));
  const rows = demoOwn(ok(await m.call<Row[]>("account.activity", { limit: 50 })));
  assert.equal(rows.length, 2);
});

test("item 8: the Account tab's reading line says who, with no ellipsis", () => {
  const src = readFileSync(new URL("../../../apps/web/src/apps/security/SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(src, /export const ACCOUNT_READING = "NEAR is sending what your account did\.";/);
  assert.ok(!src.includes("Reading your account's history…"));
});
