// The Sim's Send from the Safe (product decision, 5 Nov: Send works for every coin, Safe money included, through NEAR
// Confidential): as the real ledger's safe-send.ts. Private short and `fill`, the Safe fills Private by a whole step and
// one payout of the whole Send goes from there, the extra kept in Private; over the band it waits. Without `fill`, as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const STRANGER = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
type Row = { tokenId: string; amount: string; held?: string };
const safeUsdc = async (mock: ReturnType<typeof createMockBridge>) => Number(((await mock.call<Row[]>("ledger.balances", {})) as { ok: Row[] }).ok.find((b) => b.tokenId === USDC && b.held === "ledger")?.amount ?? 0);
const privUsdc = async (mock: ReturnType<typeof createMockBridge>) => Number(((await mock.call<{ rows: Row[] }>("ledger.private", {})) as { ok: { rows: Row[] } }).ok.rows.find((r) => r.tokenId === USDC)?.amount ?? 0);
const send = (mock: ReturnType<typeof createMockBridge>, amount: string, fill = true) => mock.call<Record<string, unknown>[]>("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount, to: { kind: "chain", chain: "sol", address: STRANGER }, ...(fill ? { fill: true } : {}) });

test("the Sim: Send from the Safe with Private short fills Private by a whole step, ONE movement pays the whole Send, the extra stays in Private (control: without fill, refused before anything moves)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "0", near: "0" } });
  const before = await safeUsdc(mock);
  const closed = await send(mock, "25", false);
  assert.ok("problem" in closed, "no fill: refused");
  assert.equal(await safeUsdc(mock), before, "control: nothing left the Safe");
  const r = await send(mock, "25");
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
  assert.equal(r.ok.length, 1, "one job, one payout");
  assert.match(String(r.ok[0]!.id), /^safe-send:/);
  assert.deepEqual([r.ok[0]!.status, r.ok[0]!.amount, r.ok[0]!.kept], ["moving", "25", "5"], "the $30 step: $25 to them, $5 kept");
  assert.equal(Math.round((before - (await safeUsdc(mock))) * 100) / 100, 30, "the Safe gave the $30 step");
  assert.equal(await privUsdc(mock), 5, "the extra is in Private");
});

test("the audit (5 Nov): the Sim as the real core: a Send from the Safe whose fill is over the day's Face ID limit is refused BEFORE the sheet, in the copy review's words, never \"waits 1 day\"; nothing leaves, nothing is held (control: under it, the sheet and on its way)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: { demoWaitSeconds: 120 }, hiddenStart: { usdc: "0", near: "0" } });
  const asked: unknown[] = [];
  mock.on("approval.needed", (e) => void asked.push(e));
  const before = await safeUsdc(mock);
  const big = await send(mock, "900");
  assert.ok("problem" in big, "refused");
  const p = big.problem;
  assert.equal(p.code, "security.send.over-limit", "the core's own code (security-problems sendOverLimit)");
  assert.match(p.whatHappened, /^That's over your Safe's limit of \$500\.00 today, so ZeroFee didn't send it\. Send up to \$\d[\d,]*\.\d\d now, or change the limit in Protection\.$/, p.whatHappened);
  assert.equal(p.next.kind === "open" && p.next.label, p.whatHappened.match(/Send up to (\$[\d,.]+) now/)![1] && `Send ${p.whatHappened.match(/Send up to (\$[\d,.]+) now/)![1]}`, "the lit button: Send $Y");
  assert.deepEqual(p.next2, { label: "Protection", kind: "open", screen: "security/protection" });
  assert.doesNotMatch(`${p.whatHappened} ${p.next.label} ${p.next2?.label}`, /wait/i, "never a wait");
  assert.deepEqual([asked.length, await safeUsdc(mock)], [0, before], "no sheet, nothing left the Safe");
  assert.equal(((await mock.call<unknown[]>("account.waiting", {})) as { ok: unknown[] }).ok.length, 0, "nothing held");
  const fresh = createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: { demoWaitSeconds: 120 }, hiddenStart: { usdc: "0", near: "0" } });
  const small = await send(fresh, "5");
  assert.ok("ok" in small, "problem" in small ? JSON.stringify(small.problem) : "");
  assert.equal(small.ok[0]!.status, "moving", "control: under the limit, on its way");
});

test("the Sim's fill sheet as every outside sheet (the audit's D37 condition, the copy review's words): the FULL address first, unfolded, then \"Public on <network>.\", then the split; never a short form or a fold (control: the plain Send keeps its landed line)", async () => {
  const sheetOf = async (amount: string, fill: boolean) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: fill ? "0" : "50", near: "0" } });
    let words: { lines: string[]; details?: { lines: string[] }[] } | null = null;
    mock.on<{ id: string; words: { lines: string[] } }>("approval.needed", (e) => { words = e.words; void mock.call("approval.answer", { id: e.id, approve: false }); });
    await send(mock, amount, fill);
    return words as unknown as { lines: string[]; details?: { lines: string[] }[] };
  };
  const w = await sheetOf("25", true);
  assert.deepEqual(w.lines.slice(0, 2), [`To ${STRANGER}`, "Public on Solana. Anyone can see the Safe's part on NEAR."], w.lines.join(" | ")); // the copy review (6 Nov): one public line
  // the UI lead's rulings (5 Nov), as the real core's sheet: what they get once (the coin, then the dollars), then what
  // the Safe sends, then what stays
  assert.deepEqual(w.lines.filter((l) => /^(They get|Your Safe sends|From your Safe|Private keeps the rest|Stays in Private|Together) · /.test(l)), ["They get · 0.2432 SOL (about $24.75)", "From your Safe · $30.00", "Private keeps the rest · about $5.00"], w.lines.join(" | "));
  assert.equal(w.lines.filter((l) => /They get/.test(l)).length, 1, `"They get" said exactly once: ${w.lines.join(" | ")}`);
  assert.ok(!w.lines.some((l) => l.includes("…")) && w.details === undefined, "no short form, no fold");
  const plain = await sheetOf("5", false);
  assert.equal(plain.lines[0], "To 13Qkxh…r6gjRK on Solana. Public on Solana.", "control: the plain Send's landed line");
});

test("the audit's ruling (5 Nov), the Sim as the real core: a fill whose payout coin the Sim can't name or price is refused BEFORE the sheet, never a dollars-only \"They get · $25.00\"; nothing leaves (control: a named, priced coin shows \"They get · <coin> (about $25.00)\")", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "0", near: "0" } });
  const asked: unknown[] = [];
  mock.on<{ id: string }>("approval.needed", (e) => { asked.push(e); void mock.call("approval.answer", { id: e.id, approve: false }); });
  const before = await safeUsdc(mock);
  // the payout's coin one the Sim can't name (no symbol, no price)
  const r = await mock.call<Record<string, unknown>[]>("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount: "25", to: { kind: "chain", chain: "sol", address: STRANGER }, toTokenId: "nep141:mystery.omft.near", fill: true });
  assert.ok("problem" in r, JSON.stringify(r));
  assert.equal(r.problem.code, "security.send.coin-unknown");
  assert.deepEqual([r.problem.whatHappened, r.problem.more], ["ZeroFee couldn't tell which coin they would get, so it stopped. Nothing left your Safe.", "Try again in a moment, or send a coin from the list."]);
  assert.deepEqual([r.problem.next, r.problem.next2], [{ kind: "retry", label: "Try again" }, { label: "Pick a coin", kind: "open", screen: "send-pick-coin" }]);
  assert.deepEqual([asked.length, await safeUsdc(mock)], [0, before], "no sheet, nothing left the Safe");
  const named = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "0", near: "0" } });
  let lines: string[] = [];
  named.on<{ id: string; words: { lines: string[] } }>("approval.needed", (e) => { lines = e.words.lines; void named.call("approval.answer", { id: e.id, approve: false }); });
  await send(named, "25");
  assert.match(lines.find((l) => l.startsWith("They get"))!, /^They get · \d[\d.]* SOL \(about \$24\.75\)$/, lines.join(" | "));
});
