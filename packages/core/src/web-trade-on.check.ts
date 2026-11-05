// Run by web-wallet.test.ts under testing/web-trade-on.mjs (VITE_WEB_TRADE=1, as the deploy build sets it): not a
// *.test.ts, so a plain run never sees it with the flag unset.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "./bridge.ts";
import { WEB_TRADE, webAllows } from "./web-wallet.ts";
import { PASSWORD, WORDS, sendingCore, until } from "./testing/web-core.ts";

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) throw new Error(`${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");

test("WEB_TRADE=1: Trade's own signing is allowed, for Trade only", () => {
  assert.equal(WEB_TRADE, true);
  for (const m of ["subwallet.signTx", "subwallet.sign", "subwallet.session.start", "subwallet.preflight"]) {
    assert.equal(webAllows(m, { app: "trade" }), true, m);
    assert.equal(webAllows(m, { app: "wallet" }), false, m);
  }
});

test("WEB_TRADE=1: Trade's first session after the lock opened asks the password once on its sheet; after that, none", async () => {
  const { core, sheets } = sendingCore();
  ok(await core.call("account.web.import", { words: WORDS }));
  const ask = { app: "trade", perTxUsd: 50, totalUsd: 200, minutes: 30, why: "Trade" };
  const first = core.call("subwallet.session.start", ask);
  await until(() => sheets.length === 1);
  assert.deepEqual([sheets[0]!.words.title, sheets[0]!.password, sheets[0]!.words.asker], ["Trade from this browser", true, "trade"]);
  assert.equal(code(await core.call("approval.answer", { id: sheets[0]!.id, approve: true, password: "nope nope nope" })), "security.web.password");
  ok(await core.call("approval.answer", { id: sheets[0]!.id, approve: true, password: PASSWORD }));
  const r1 = await first;
  assert.notEqual(code(r1), "security.web.trade-declined");
  await core.call("subwallet.session.start", ask);
  assert.equal(sheets.length, 1, "once per unlock: the second start asks nothing");
  // a no on the first sheet: refused by name, nothing opened
  const other = sendingCore();
  ok(await other.core.call("account.web.import", { words: WORDS }));
  const no = other.core.call("subwallet.session.start", ask);
  await until(() => other.sheets.length === 1);
  ok(await other.core.call("approval.answer", { id: other.sheets[0]!.id, approve: false }));
  assert.equal(code(await no), "security.web.trade-declined");
});

test("WEB_TRADE=1, product decision, 4 Nov (one tap): Trade's tap starts no session, so the password gates every signature itself: a signTx or sign before it asks the password first, a preflight before it reads nothing; after it, a signature asks nothing more", async () => {
  const { core, sheets } = sendingCore();
  ok(await core.call("account.web.import", { words: WORDS }));
  const id = (ok(await core.call<{ id: string }[]>("subwallet.list", {})) as { id: string; chain: string }[]).find((w) => w.chain === "sol")!.id;
  assert.deepEqual(ok(await core.call("subwallet.preflight", { app: "trade", id, tx: "AA==" })), { ok: false }, "a preflight before the password: nothing read, nobody asked");
  assert.equal(sheets.length, 0);
  for (const method of ["subwallet.signTx", "subwallet.sign"]) {
    const other = sendingCore();
    ok(await other.core.call("account.web.import", { words: WORDS }));
    const wid = (ok(await other.core.call<{ id: string }[]>("subwallet.list", {})) as { id: string; chain: string }[]).find((w) => w.chain === "sol")!.id;
    const signing = other.core.call(method, { app: "trade", id: wid, tx: "AA==" });
    await until(() => other.sheets.length === 1);
    assert.deepEqual([other.sheets[0]!.words.title, other.sheets[0]!.password], ["Trade from this browser", true], `${method}: the password first`);
    ok(await other.core.call("approval.answer", { id: other.sheets[0]!.id, approve: false }));
    assert.equal(code(await signing), "security.web.trade-declined", `${method}: a no signs nothing`);
  }
  // control: the password once (Trade's open), then a signature asks no sheet for it (the bytes here are refused by the
  // core's own checks, by name: never the password again)
  const start = core.call("subwallet.session.start", { app: "trade", perTxUsd: 50, totalUsd: 200, minutes: 30 });
  await until(() => sheets.length === 1);
  ok(await core.call("approval.answer", { id: sheets[0]!.id, approve: true, password: PASSWORD }));
  await start;
  const after = await core.call("subwallet.signTx", { app: "trade", id, tx: "AA==" });
  assert.equal(sheets.length, 1, "no second password");
  assert.notEqual(code(after), "security.web.trade-declined");
});
