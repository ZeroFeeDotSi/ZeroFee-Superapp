// QA 16's Send Max shots (7 Nov, (d)): the Sim paid a Max Send's raw max ($1,240.50) where the core's Max path pays
// maxSend ($1,165.04), so Check this, the done Jobs row and Activity said another figure than the form. Now the Sim pays
// as the core (safe-send.ts: a Send's fill pays maxSend over upTo, nothing from Private's share), its sheet's title says
// that figure to the cent, down, with its commas, and "They get" says a dollar coin once ((b): never "1228.1 USDC (about
// $1,228.10)"). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maxSend } from "@zerofee/core/inflow-grid";
import { theyGet } from "@zerofee/core/private-route";
import { createMockBridge } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
type Row = { tokenId: string; amount: string; held?: string };
const units = (s: string) => { const [w, f = ""] = s.split("."); return BigInt(w! + f.padEnd(6, "0").slice(0, 6)); };

async function maxSendSheet(amountOf: (max: string) => string) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "0", near: "0" } });
  const max = ((await mock.call<Row[]>("ledger.balances", {})) as { ok: Row[] }).ok.find((b) => b.tokenId === USDC && b.held === "ledger")!.amount;
  let words: { title: string; lines: string[] } | null = null;
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (e) => { words = e.words; void mock.call("approval.answer", { id: e.id, approve: true }); });
  const r = await mock.call<Record<string, unknown>[]>("ledger.sendFromSafe", { app: "wallet", tokenId: USDC, amount: amountOf(max), upTo: max, to: { kind: "ledger", accountId: "bob.near" }, toTokenId: USDC, fill: true });
  return { max, words: words as unknown as { title: string; lines: string[] }, r };
}

test("(d) a Max Send from the Safe pays the core's maxSend, and its sheet's title says it to the cent, down, with commas", async () => {
  const { max, words, r } = await maxSendSheet((m) => m);
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
  const pays = maxSend(units(max), 0n)!.pays;
  const paysText = `${pays / 1_000_000n}.${(pays % 1_000_000n).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
  assert.equal(String(r.ok[0]!.amount), paysText, `the movement pays maxSend over ${max}, never the raw max`);
  const cents = Number(pays / 10_000n) / 100;
  const said = `$${cents.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  assert.equal(words.title, `Send ${said} to bob.near`, words.lines.join(" | "));
  // (b) a dollar coin's "They get" says one figure, its dollars to the cent (builder 3, max-cents)
  const gets = words.lines.find((l) => l.startsWith("They get"))!;
  assert.match(gets, /^They get · about \$[\d,]+\.\d\d$/, gets);
  assert.doesNotMatch(words.lines.join(" | "), /\d{4}\.\d/, "every figure over 999 has its comma");
});

test("(b) the core's one \"They get\" rule, which its sheet and the Sim's both say (control: any other coin keeps its dollars)", () => {
  assert.equal(theyGet("1,165.04 USDC", "$1,165.04"), "They get · about $1,165.04");
  assert.equal(theyGet("12 USDT", "$12.00"), "They get · about $12.00");
  assert.equal(theyGet("1.2345 SOL", "$247.50"), "They get · 1.2345 SOL (about $247.50)", "control");
  assert.equal(theyGet("1.2345 SOL"), "They get · about 1.2345 SOL", "control: no dollars known");
  const core = readFileSync(new URL("../../core/src/intents.ts", import.meta.url), "utf8");
  assert.match(core, /const gets = theyGet\(coinGets, sent\.gets\);/);
});

test("(d) controls: under Max, the Sim pays what was asked, as before", async () => {
  const { r } = await maxSendSheet(() => "25");
  assert.ok("ok" in r, "problem" in r ? JSON.stringify(r.problem) : "");
  assert.equal(String(r.ok[0]!.amount), "25");
});
