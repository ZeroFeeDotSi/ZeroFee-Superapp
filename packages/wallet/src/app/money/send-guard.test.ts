// The guard on the person's own Send (FLOW-V5 §5 item 5): packages/agent's judge, unitGuard and obfuscated, called on the
// Send sheet before any Approve. And D111 on Hidden: what Hidden holds pays any coin on any chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { judge, obfuscated } from "@zerofee/agent/guard/index";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { PayFlow } from "@zerofee/pay/pay";
import { GUARD_HIDES, guardFacts, guardFactsSoon, unitCheck, unitCheckIn } from "./send-guard.ts";

const SOL_ADDR = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const fake = (o: { info?: { exists: boolean; code: string | null } | "down"; paid?: string[] }) => ({
  call: async (method: string) => {
    if (method === "ledger.recipientInfo") return o.info === "down" || !o.info ? { problem: { code: "x" } } : { ok: { ...o.info, hasLedgerBalance: false } };
    if (method === "ledger.activity") return { ok: (o.paid ?? []).map((to, i) => ({ id: `m${i}`, kind: "pay", status: "done", to })) };
    return { problem: { code: "x" } };
  },
  on: () => () => {},
}) as unknown as Bridge;

test("judge on the Send sheet: a first payment warns (one line), a repeat says nothing, no such account blocks by name", async () => {
  const first = judge(SOL_ADDR, await guardFacts(fake({}), { kind: "address", chain: "sol", candidates: ["sol"], address: SOL_ADDR }), "sol");
  assert.deepEqual([first.verdict, first.line], ["warn", "First time paying this Solana address."]);
  const again = judge(SOL_ADDR, await guardFacts(fake({ paid: [SOL_ADDR] }), { kind: "address", chain: "sol", candidates: ["sol"], address: SOL_ADDR }), "sol");
  assert.equal(again.verdict, "allow", "control: paid before from here");
  const none = judge("nobody.near", await guardFacts(fake({ info: { exists: false, code: null } }), { kind: "near-wallet", accountId: "nobody.near" }));
  assert.deepEqual([none.verdict, none.line], ["block", "There's no nobody.near on NEAR."]);
});

test("unit guard before Approve: ten times off stops with both figures; a match, or no dollars shown, says nothing", () => {
  const c = (amount: string, decimals: number, priceUsd?: string, symbol = "SOL") => ({ target: { amount, token: { decimals, symbol, ...(priceUsd ? { priceUsd } : {}) } } });
  assert.equal(unitCheck(c("0.05", 9, "100"), 5), null, "0.05 SOL at $100 is the $5 shown");
  assert.match(unitCheck(c("50", 9, "100"), 5)!, /^That's \$5,000(\.00)?, not \$5(\.00)?\. Stopped\.$/, "a decimal slip");
  assert.equal(unitCheck(c("5", 6, undefined, "USDC"), 5), null, "a dollar coin with no listed price is a dollar");
  assert.equal(unitCheck(c("5", 9, undefined), 5), null, "no listed price: nothing independent to check, never a dead-end stop (review L4)");
  assert.equal(unitCheck(c("5", 9, "100"), null), null, "the coin amount typed itself: nothing to be off from");
});

test("obfuscated: a pasted address with hidden characters is refused; a plain one isn't (control)", () => {
  assert.equal(obfuscated(`${SOL_ADDR.slice(0, 10)}​${SOL_ADDR.slice(10)}`), true);
  assert.equal(obfuscated(SOL_ADDR), false);
  assert.equal(obfuscated("0x7d06e272b5305a4b9d40e872c7950d3437547e3d"), false);
  assert.equal(GUARD_HIDES, "That address or amount hides its words. Nothing was sent.");
});

test("the Send sheet calls the guard, then the unit guard, before any engine call or sheet (one path: every Send is private)", () => {
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const guardCode = codeGate\(\(\) => import\("\.\/send-guard\.ts"\)\);/, "loaded as the sheet opens; Send off until it is here (code-gate.test.ts)");
  assert.match(readFileSync(new URL("./send-guard.ts", import.meta.url), "utf8"), /export \{ judge, obfuscated \} from "@zerofee\/agent\/guard\/index";/, "called from packages/agent, never copied");
  const send = sheet.slice(sheet.indexOf("const send = async"));
  const order = ["const g = guardCode.here();", "if (!g || checking.current) return;", "obfuscated(to)", "facts = await (", "guardFactsSoon(shell.bridge, a.recipient)", "judge(to, facts", 'check.verdict === "block"', "const off = !a.exactOut && known ? g.unitCheck(", "if (off) {", '"ledger.hiddenFromRow"', '"ledger.sendFromSafe"'].map((x) => send.indexOf(x));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1]!)), `guard before any engine call: ${order}`);
  assert.doesNotMatch(sheet, /subwallet\.send|flow\.send\(|flow\.confirm\(|<Segmented/, "no plain path and no Hidden / Plain switch left on Home's Send (D128)");
  // the unit guard as the sheet runs it: Spending's dollars for 0.05 SOL against 1Click's SOL price
  const sol = { decimals: 9, symbol: "SOL", priceUsd: "100" };
  assert.equal(unitCheck({ target: { amount: "0.05", token: sol } }, 5), null, "the $5 shown is 0.05 SOL at $100");
  assert.match(unitCheck({ target: { amount: "0.05", token: sol } }, 50)!, /Stopped\.$/, "control: a price ten times off stops it");
  const agent = readFileSync(new URL("../../../../agent/src/guard/guard.ts", import.meta.url), "utf8");
  const mine = readFileSync(new URL("./send-guard.ts", import.meta.url), "utf8");
  assert.doesNotMatch(mine, /HIDDEN = |MORSE|B64_RUN|10 \*\* decimals/, "no logic copied out of packages/agent");
  assert.ok(agent.length > 0);
});

test("D111 on Hidden: the demo's 25 USDC on NEAR in Hidden pays 5 USDC to a Solana address (control: the Safe's path still needs the same coin)", async () => {
  const bridge = createMockBridge({ latencyMs: 0, settleMs: 5, hiddenStart: { usdc: "25", near: "2" } });
  const flow = new PayFlow({ bridge });
  assert.equal(await flow.warm(), null);
  const token = flow.tokens!.find("sol", { symbol: "USDC" })!;
  const target = { to: { kind: "chain" as const, chain: "sol", address: SOL_ADDR }, token, amount: "5", notes: [] };
  const step = await flow.send(target, undefined, { privateOnly: true });
  assert.equal(step.kind, "confirm", step.kind === "problem" ? step.problem.code : step.kind);
  if (step.kind === "confirm") assert.deepEqual([step.confirm.privacy?.on, step.confirm.source.balance.held, step.confirm.source.balance.chain], [true, "private", "near"]);
  flow.close();
});

test("review fixes: the guard on what leaves Hidden; the facts never wait forever; a flip while checking sends nothing", async () => {
  const c = (maxIn: string) => ({ maxIn, source: { balance: { amount: "2", usd: "8.86" } } });
  assert.equal(unitCheckIn(c("1.13"), 24, 5), null, "about $5 of NEAR leaves for $5 shown");
  assert.match(unitCheckIn(c("11.3"), 24, 5)!, /Stopped\.$/, "ten times the dollars leaving: stopped before Approve");
  assert.equal(unitCheckIn(c("11.3"), undefined, 5), null, "control: no decimals read, nothing claimed");
  const hung = { call: () => new Promise(() => {}), on: () => () => {} } as unknown as Bridge;
  const facts = await guardFactsSoon(hung, { kind: "address", chain: "sol", candidates: ["sol"], address: SOL_ADDR }, 20);
  assert.deepEqual(facts, { account: { exists: true, code: null }, paidBefore: false }, "a hung read goes on as a first payment (a warn line), never stuck");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /checking\.current = true;\n\s+setWarn\(null\);\n\s+setLine\(null\);\n\s+setBusy\(true\);/, "the form holds still (busy) while the facts are read: no second tap, no change");
  const pay = readFileSync(new URL("../../../../pay/src/pay.ts", import.meta.url), "utf8");
  assert.match(pay, /anyCoin: \(fromPrivate && this\.#privateOnly\) \|\| anyCoin/, "any coin only for a Hidden-only send; Plain's switch as before (review 1b)");
});
