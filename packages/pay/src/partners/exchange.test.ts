import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeLedger } from "../testing/fake-ledger.ts";
import { RECORDED_TOKENS } from "../testing/recorded-tokens.ts";
import { TokenDirectory } from "../tokens.ts";
import { answerExchangeArrived, keepTest, exchangeNetworks, exchangeProblem, exchangeTarget, loadExchange, rememberExchangeSend, saveExchange, testLeft } from "./exchange.ts";

const tokens = new TokenDirectory(RECORDED_TOKENS);
const BASE = "0x7c1a00000000000000000000000000000000009e";
const ledger = () => new FakeLedger({ accountId: "me.near", balances: {} });

test("your exchange is saved once: its name, the network, the address on that network", async () => {
  const l = ledger();
  assert.equal(await saveExchange(l, { name: " My exchange ", chain: "base", address: ` ${BASE} ` }), null);
  assert.deepEqual(await loadExchange(l), { name: "My exchange", chain: "base", address: BASE });
});

test("an address that isn't on the network picked, or a missing memo the network needs, is never saved", () => {
  assert.equal(exchangeProblem({ name: "X", chain: "sol", address: BASE })?.code, "pay.cashout.mismatch");
  assert.equal(exchangeProblem({ name: "X", chain: "xrp", address: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY" })?.code, "pay.exchange.memo-needed");
  assert.equal(exchangeProblem({ name: "X", chain: "xrp", address: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", memo: "12345" }), null);
  assert.ok(exchangeProblem({ name: " ", chain: "base", address: BASE }), "a name is needed");
});

test("networks offered are the ones where USDC is listed and a memo can be sent (never TON or Stellar)", () => {
  const nets = exchangeNetworks(tokens);
  assert.ok(nets.includes("base"));
  assert.ok(!nets.includes("ton") && !nets.includes("stellar"));
});

test("a send to the exchange is USDC on its network, to its address and memo, named as your own account", () => {
  const t = exchangeTarget({ name: "My exchange", chain: "base", address: BASE, confirmed: true }, "50", tokens);
  assert.ok("ok" in t);
  assert.deepEqual([t.ok.to, t.ok.token.symbol, t.ok.amount, t.ok.name], [{ kind: "chain", chain: "base", address: BASE }, "USDC", "50", "Your My exchange account"]);
});

test("after a send lands, the next starts from it and needs no Confirm first", async () => {
  const l = ledger();
  await saveExchange(l, { name: "My exchange", chain: "base", address: BASE });
  await rememberExchangeSend(l, "50");
  const e = await loadExchange(l);
  assert.deepEqual([e?.lastAmount, e?.used], ["50", true]);
});

test("the PEXX preset: its own networks only, its name, and its own words for what happens after", async () => {
  const { EXCHANGE_PRESETS, presetFor } = await import("./exchange.ts");
  const pexx = presetFor("pexx")!;
  assert.equal(pexx.label, "PEXX · an exchange registered in Australia");
  assert.ok(/^https:\/\//.test(pexx.site), "its page opens the D28 way, inside ZeroFee");
  assert.deepEqual(exchangeNetworks(tokens, "pexx").filter((n) => !pexx.chains.includes(n)), [], "never a network PEXX doesn't take");
  assert.ok(!exchangeNetworks(tokens, "pexx").includes("near"), "PEXX takes no NEAR deposits");
  assert.equal(exchangeProblem({ name: "PEXX", preset: "pexx", chain: "op", address: BASE })?.code, "pay.cashout.mismatch", "Optimism isn't one of PEXX's");
  const l = ledger();
  assert.equal(await saveExchange(l, { name: "PEXX", preset: "pexx", chain: "base", address: BASE }), null);
  const e = await loadExchange(l);
  assert.equal(e?.preset, "pexx");
  const t = exchangeTarget(e!, "20", tokens);
  assert.ok("ok" in t && t.ok.name === "Your PEXX account");
  assert.ok(EXCHANGE_PRESETS.every((p) => p.chains.length > 0 && /^https:\/\//.test(p.site) && p.label.startsWith(`${p.name} · `)), "every preset names its networks, its page and what it is");
  assert.equal(new Set(EXCHANGE_PRESETS.map((p) => p.id)).size, EXCHANGE_PRESETS.length);
});

test("a new exchange address is a test, up to $25 in total, until the person says a send arrived (UI, Security)", async () => {
  const l = ledger();
  await saveExchange(l, { name: "My exchange", chain: "base", address: BASE });
  let e = (await loadExchange(l))!;
  const code = (r: ReturnType<typeof exchangeTarget>) => ("problem" in r ? r.problem.code : "ok");
  assert.equal(code(exchangeTarget(e, "30", tokens)), "pay.exchange.over-test", "more than $25 on a first send: nothing sent");
  assert.equal(code(exchangeTarget(e, "20", tokens)), "ok");
  e = (await rememberExchangeSend(l, "20"))!;
  assert.equal(testLeft(e), "5", "the test is a total, not per send");
  assert.equal(code(exchangeTarget(e, "10", tokens)), "pay.exchange.over-test");
  e = (await rememberExchangeSend(l, "5"))!;
  assert.equal(code(exchangeTarget(e, "1", tokens)), "pay.exchange.waiting", "used up: nothing more until the person answers");
  assert.equal((await answerExchangeArrived(l, "not-yet"))?.confirmed, undefined);
  e = (await answerExchangeArrived(l, "yes"))!;
  assert.equal(testLeft(e), null);
  assert.equal(code(exchangeTarget(e, "100", tokens)), "ok", "Yes lifts the test");
  assert.equal(await answerExchangeArrived(l, "no"), null);
  assert.equal(await loadExchange(l), null, "No forgets the address: it may be a look-alike");
});

test("Security's MUST on 2cce8bd: the test's answer stays only for the same chain, address and memo", () => {
  const XRP = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
  const done = { name: "X", chain: "xrp", address: XRP, memo: "12345", used: true, confirmed: true, tested: "25" };
  assert.equal(keepTest(done, { name: "X", chain: "xrp", address: XRP, memo: " 12345 " }).confirmed, true, "the same account");
  const memo = keepTest(done, { name: "X", chain: "xrp", address: XRP, memo: "99999" });
  assert.equal(testLeft(memo), "25", "a changed memo is another account: a new $25 test");
  assert.equal(testLeft(keepTest(done, { name: "X", chain: "xrp", address: XRP })), "25", "a memo taken away, too");
  assert.equal(testLeft(keepTest(done, { name: "X", chain: "base", address: BASE })), "25", "a new address");
  assert.equal(testLeft(keepTest(null, { name: "X", chain: "base", address: BASE, confirmed: true })), "25", "a first save is never confirmed");
});
