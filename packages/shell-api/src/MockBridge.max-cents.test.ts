// Builder 3 (7 Nov, on QA 16's Send Max shots v2): the Sim's Check this for a Send at Max rounded twice. Its title
// floored maxSend's 1165.048543 to $1,165.04 while the rest row and the fee took it rounded ($1,165.05): "From your Safe ·
// $1,200.00", "Private keeps the rest · about $34.95", "Fees · about $11.65", and They get in coins ("about 1,153.4
// USDC"). Now one cent figure, the title's: Private keeps From less it, they get its share (dollars, to the cent) and the
// fee the difference, so From - keeps = title = They get + Fees. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
type Row = { tokenId: string; amount: string; held?: string };
const c = (line: string) => Math.round(Number(/\$([\d,]+\.\d\d)/.exec(line)![1]!.replace(/,/g, "")) * 100);

async function sheet(amountOf: (max: string) => string, upTo = true) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "0", near: "0" } });
  const max = ((await mock.call<Row[]>("ledger.balances", {})) as { ok: Row[] }).ok.find((b) => b.tokenId === USDC && b.held === "ledger")!.amount;
  let words: { title: string; lines: string[] } | null = null;
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (e) => { words = e.words; void mock.call("approval.answer", { id: e.id, approve: true }); });
  const r = await mock.call<Record<string, unknown>[]>("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount: amountOf(max), ...(upTo ? { upTo: max } : {}), to: { kind: "ledger", accountId: "bob.near" }, toTokenId: USDC, fill: true });
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
  return words as unknown as { title: string; lines: string[] };
}
function sums(w: { title: string; lines: string[] }) {
  const row = (head: string) => w.lines.find((l) => l.startsWith(head));
  const gets = row("They get")!, from = row("From your Safe")!, keeps = row("Private keeps the rest"), fees = row("Fees")!;
  assert.match(gets, /^They get · about \$[\d,]+\.\d\d$/, "a dollar coin: its dollars, to the cent, once");
  return { title: c(w.title), from: c(from), keeps: keeps ? c(keeps) : 0, gets: c(gets), fees: c(fees) };
}

test("Max: From your Safe - Private keeps the rest = the title = They get + Fees, to the cent", async () => {
  const s = sums(await sheet((m) => m));
  assert.equal(s.from - s.keeps, s.title, JSON.stringify(s));
  assert.equal(s.gets + s.fees, s.title, JSON.stringify(s));
});

test("controls: a typed $25 and a typed half-cent figure close the same way", async () => {
  for (const amount of ["25", "37.125", "99.995"]) {
    const s = sums(await sheet(() => amount, false));
    assert.equal(s.from - s.keeps, s.title, `${amount} ${JSON.stringify(s)}`);
    assert.equal(s.gets + s.fees, s.title, `${amount} ${JSON.stringify(s)}`);
  }
});
