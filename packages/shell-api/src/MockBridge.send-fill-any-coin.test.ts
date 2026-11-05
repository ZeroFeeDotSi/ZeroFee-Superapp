// QA walk (5 Nov, MUST 1): the Sim filled a Send from the Safe only for USDC, so a $40 NEAR Send with 0.871326373 NEAR
// in Private was refused "Up to 0.871326373 NEAR can go now." The real ledger (wallet safe-send.ts fillUnits) fills ANY
// coin: a whole step in dollars at the coin's price, the extra kept in Private, one payout. The Sim mirrors it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";

const WNEAR = "nep141:wrap.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
type Row = { tokenId: string; amount: string; usd?: string; held?: string };
type Mock = ReturnType<typeof createMockBridge>;
const safeRow = async (mock: Mock, id: string) => ((await mock.call<Row[]>("ledger.balances", {})) as { ok: Row[] }).ok.find((b) => b.tokenId === id && b.held === "ledger")!;
const privRow = async (mock: Mock, id: string) => ((await mock.call<{ rows: Row[] }>("ledger.private", {})) as { ok: { rows: Row[] } }).ok.rows.find((r) => r.tokenId === id);
const send = (mock: Mock, tokenId: string, amount: string, fill = true) => mock.call<Record<string, unknown>[]>("ledger.sendFromSafe", { app: "wallet", tokenId, amount, to: { kind: "ledger", accountId: "bob.near" }, ...(fill ? { fill: true } : {}) });
const sim = (rules = false) => createMockBridge({ latencyMs: 0, settleMs: 5, safeFillOpen: true, ...(rules ? { mainnetRules: { demoWaitSeconds: 120 } } : {}), hiddenStart: { usdc: "0", near: "0.871326373" } });

test("QA walk MUST 1: a $40 NEAR Send from the Safe with Private short fills Private by the $50 step in NEAR, one payout, the extra in Private; the sheet says the split in dollars (control: USDC fills as before; without fill, refused in at most 4 places)", async () => {
  const mock = sim();
  const words: { title: string; lines: string[] }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (e) => { words.push(e.words); void mock.call("approval.answer", { id: e.id, approve: true }); });
  const asked = (40 / 4.43).toFixed(9);
  const before = Number((await safeRow(mock, WNEAR)).amount);
  const r = await send(mock, WNEAR, asked);
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
  assert.equal(r.ok.length, 1, "one job, one payout");
  assert.match(String(r.ok[0]!.id), /^safe-send:/);
  const step = 50 / 4.43;
  assert.ok(Math.abs(before - Number((await safeRow(mock, WNEAR)).amount) - step) < 1e-6, "the Safe gave the $50 step in NEAR");
  assert.ok(Math.abs(Number(r.ok[0]!.kept) - (step - Number(asked))) < 1e-6, "the $10 extra is kept");
  const priv = await privRow(mock, WNEAR);
  assert.ok(Math.abs(Number(priv!.amount) - 0.871326373 - (step - Number(asked))) < 1e-6, "the extra is in Private, Private's own NEAR untouched");
  const sheet = words[0]!;
  assert.equal(sheet.title, "Send $40.00 from your Safe");
  // the copy review's fill-sheet words (train 37): what they get first (coin, then its dollars), what the Safe sends, what stays
  // QA's Sim walk: the brackets are what the payee's coin is worth ($39.60), and the $0.40 is named, last
  assert.deepEqual(sheet.lines.filter((l) => /^(They get|Your Safe sends|Stays in Private|Network fees) · /.test(l)), ["They get · 8.939 wNEAR ($39.60)", "Your Safe sends · $50.00", "Stays in Private · $10.00", "Network fees · about $0.40"]);
  assert.ok(![sheet.title, ...sheet.lines].some((l) => /\d\.\d{5,}/.test(l)), "no coin figure past 4 places");
  // control: USDC as before ($25 → the $30 step)
  const u = await send(mock, USDC, "25");
  assert.ok("ok" in u && u.ok[0]!.kept === "5", JSON.stringify(u));
  // control: the fill not asked, refused before anything, the most in at most 4 places
  const shut = await send(sim(), WNEAR, asked, false);
  assert.ok("problem" in shut);
  assert.equal(shut.problem.whatHappened, "Up to 0.8713 NEAR can go now. The rest stays in your Safe.");
});

test("QA walk (c): the day's limit counts what leaves the Safe, the whole $50 step of a $40 NEAR Send (as the core's sendRoom): \"Send up to $436.89\" after it; a Send Private pays alone counts nothing (control)", async () => {
  const mock = sim(true);
  const p5 = await send(mock, WNEAR, (0.5).toFixed(9));
  assert.ok("ok" in p5 && String(p5.ok[0]!.id).startsWith("mv-"), "control: Private pays it, no fill");
  const r = await send(mock, WNEAR, (40 / 4.43).toFixed(9));
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
  const big = await send(mock, USDC, "900");
  assert.ok("problem" in big);
  assert.match(big.problem.whatHappened, /Send up to \$436\.89 now/, big.problem.whatHappened);
});

test("QA walk: after a $40 NEAR and a $40 USDC fill the day's limit has counted exactly the two $50 steps ($100): $400 is left, and the biggest Send whose step fits it is $388.34 (its step $400; $388.35 x 1.03 is past $400, so its step is $450). Control: $388.34 goes, $388.35 is refused", async () => {
  const run = async (last: string) => {
    const mock = sim(true);
    for (const [id, amount] of [[WNEAR, (40 / 4.43).toFixed(9)], [USDC, "40"]] as const) {
      const r = await send(mock, id, amount);
      assert.ok("ok" in r && String(r.ok[0]!.id).startsWith("safe-send:"), JSON.stringify(r));
    }
    return send(mock, USDC, last);
  };
  const over = await run("900");
  assert.ok("problem" in over);
  assert.match(over.problem.whatHappened, /Send up to \$388\.34 now/, over.problem.whatHappened);
  const fits = await run("388.34");
  assert.ok("ok" in fits, "problem" in fits ? fits.problem.whatHappened : "");
  const past = await run("388.35");
  assert.ok("problem" in past && past.problem.code === "security.send.over-limit", JSON.stringify(past));
});

test("QA walk: a $40 fill takes the whole $50 step out of the Safe's own row and the $10 extra lands in Private's row; Home's coin figure (safeHeld, D128: Private counted under the Safe) is the two together, so it falls $40, never $50 (control: the USDC fill the same)", async () => {
  for (const [id, amount, usdOf] of [[WNEAR, (40 / 4.43).toFixed(9), 4.43], [USDC, "40", 1]] as const) {
    const mock = sim();
    const safeUsd = async () => Number((await safeRow(mock, id)).amount) * usdOf;
    const privUsd = async () => Number((await privRow(mock, id))?.amount ?? 0) * usdOf;
    const [s0, p0] = [await safeUsd(), await privUsd()];
    const r = await send(mock, id, amount);
    assert.ok("ok" in r, JSON.stringify(r));
    const [s1, p1] = [await safeUsd(), await privUsd()];
    assert.equal(Math.round((s0 - s1) * 100) / 100, 50, `${id}: the Safe's row gave the $50 step`);
    assert.equal(Math.round((p1 - p0) * 100) / 100, 10, `${id}: Private's row holds the $10 extra`);
    assert.equal(Math.round((s0 + p0 - s1 - p1) * 100) / 100, 40, `${id}: together, $40 left`);
  }
});
