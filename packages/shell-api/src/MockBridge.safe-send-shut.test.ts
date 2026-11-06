// QA test (5 Nov): MUST 3, the Sim gave no named refusal for a Send from the Safe (the real ledger refuses a Send's fill
// to an outside payee by name while it is shut: wallet ledger.ts, QA's MUST); 042, a Solana outside sheet had
// no "Public on Solana." (the core's outside sheet always says where it lands: subwallets.ts OUTSIDE_WORDS.seen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAFE_SEND_FILL_OPEN } from "@zerofee/core/safe-send-fill-open";
import { walletProblems } from "../../wallet/src/wallet-problems.ts";
import { SAFE_SEND_SHUT, createMockBridge } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const STRANGER = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
type Row = { tokenId: string; amount: string; held?: string };

const sim = (o: { safeFillOpen?: boolean } = {}) => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "20", near: "0" }, ...o });
  const asked: unknown[] = [];
  mock.on<{ id: string }>("approval.needed", (e) => { asked.push(e); void mock.call("approval.answer", { id: e.id, approve: true }); });
  const money = async () => {
    const safe = ((await mock.call<Row[]>("ledger.balances", {})) as { ok: Row[] }).ok.find((b) => b.tokenId === USDC && b.held === "ledger")?.amount;
    const priv = ((await mock.call<{ rows: Row[] }>("ledger.private", {})) as { ok: { rows: Row[] } }).ok.rows.find((r) => r.tokenId === USDC)?.amount;
    return [safe, priv];
  };
  const send = (amount: string, to: object, fill: boolean) => mock.call<unknown[]>("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount, to, ...(fill ? { fill: true } : {}) });
  return { mock, asked, money, send };
};

test("MUST 3: while the Safe's Send is shut (or this build's fill switch is off), the Sim refuses a Send's fill to an outside payee by name, before any sheet, nothing moved, in the real ledger's own words (controls: a Send from Private still goes; a fill to the person's own wallet is never refused as shut)", async () => {
  assert.deepEqual(SAFE_SEND_SHUT, walletProblems.safeSendShut(), "the real ledger's words, word for word");
  // shut: main's constant, or (with the constant open) a build whose fill switch is off
  const shutHere = (o: { safeFillOpen?: boolean }) => !(SAFE_SEND_FILL_OPEN && (o.safeFillOpen ?? true));
  for (const o of [{ safeFillOpen: false }, ...(SAFE_SEND_FILL_OPEN ? [] : [{ safeFillOpen: true }])]) {
    assert.ok(shutHere(o));
    for (const to of [{ kind: "chain", chain: "sol", address: STRANGER }, { kind: "ledger", accountId: "bob.near" }]) {
      const s = sim(o);
      const before = await s.money();
      const r = await s.send("2", to, true);
      assert.ok("problem" in r, JSON.stringify(r));
      assert.equal(r.problem.code, "ledger.safe-send.shut");
      assert.equal(r.problem.whatHappened, "Sending from your Safe opens soon. Your money is still in your Safe.");
      assert.deepEqual([s.asked.length, await s.money()], [0, before], "no sheet, nothing moved");
    }
  }
  // control: a Send from Private (no fill) goes as before, shut or not
  const p = sim({ safeFillOpen: false });
  const went = await p.send("2", { kind: "chain", chain: "sol", address: STRANGER }, false);
  assert.ok("ok" in went, JSON.stringify(went));
  // control: a fill to the person's own trading wallet is not the shut path
  const own = sim({ safeFillOpen: false });
  const list = ((await own.mock.call<{ kind: string; chain: string; address: string }[]>("subwallet.list")) as { ok: { kind: string; chain: string; address: string }[] }).ok;
  const sol = list.find((w) => w.kind === "trade" && w.chain === "sol")!;
  const mine = await own.send("2", { kind: "chain", chain: "sol", address: sol.address }, true);
  assert.ok(!("problem" in mine) || mine.problem.code !== "ledger.safe-send.shut", "their own wallet: never refused as shut");
});

test("042: every Sim outside sheet says where it lands, as the core's (\"Public on Solana.\"), the coin figure at most 4 decimals (control: the full address stays first)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  const seen: { lines: string[] }[] = [];
  mock.on<{ id: string; words: { lines: string[] } }>("approval.needed", (e) => { seen.push(e.words); void mock.call("approval.answer", { id: e.id, approve: false }); });
  await mock.call("ledger.hiddenFromRow", { app: "wallet", chain: "sol", to: { kind: "chain", chain: "sol", address: STRANGER }, toTokenId: "nep141:sol.omft.near", amountIn: "0.052526348" });
  const w = seen[0]!;
  assert.equal(w.lines[0], `To ${STRANGER}`, "control: the full address first");
  assert.ok(w.lines.includes("Public on Solana."), w.lines.join(" | "));
  const fees = w.lines.findIndex((l) => l.startsWith("Fees · about"));
  if (fees >= 0) assert.equal(w.lines[fees + 1], "NEAR Intents and the network keep this. ZeroFee takes nothing.", "the copy review's fee line: who keeps it, under the figure");
  assert.equal(w.lines[fees >= 0 ? fees + 2 : 1], "Public on Solana.", "after the fee, as the core's outsideLines");
  assert.ok(!w.lines.some((l) => /\d\.\d{5,}/.test(l)), `no raw coin figure: ${w.lines.join(" | ")}`);
  assert.ok(w.lines.some((l) => l.includes("0.0525 SOL")), w.lines.join(" | "));
});
