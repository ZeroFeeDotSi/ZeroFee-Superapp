// The public ?demo's MockBridge behaves as the real account contract and core (robot findings 4, 5, 9, 14; the rules in
// contracts/account-policy/src/lib.rs): payment bands over a rolling 24 hours, a partner's price that can't wait, every
// change held for the change wait, a recovery's freeze, a sample key, and no testnet word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge, PUBLIC_SAMPLE_ACCOUNT_ID, SAMPLE_KEY, SAMPLE_LAPTOP_CODE, waitWords } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const demo = (extra = {}) => createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: { demoWaitSeconds: 120 }, ...extra });
const send = (mock: ReturnType<typeof demo>, amount: string) => mock.call<{ status: string; held?: { id: string; readyAtIso: string } }>("ledger.transfer", { toAccountId: "bob.near", amount, tokenId: USDC });
type Waiting = { id: string; title: string; lines: string[]; readyAtIso: string };

test("bands: up to $500 in 24 hours runs at once; the payment that takes the day past $500 is held with the real wait said, cancellable", async () => {
  const mock = demo();
  const small = await send(mock, "300");
  assert.ok("ok" in small && small.ok.status === "moving", "under the first band: runs");
  const second = await send(mock, "150");
  assert.ok("ok" in second && second.ok.status === "moving", "$450 in the day: still under $500");
  const third = await send(mock, "100");
  assert.ok("ok" in third && third.ok.status === "waiting" && third.ok.held, "$550 in the day: held, as the contract counts 24 hours (splitting doesn't dodge it)");
  const waiting = await mock.call<Waiting[]>("account.waiting");
  assert.ok("ok" in waiting);
  const h = waiting.ok.find((w) => w.id === third.ok.held!.id)!;
  assert.match(h.lines.join(" "), /it waits 1 day\. You can cancel it until then\./, "the real wait, in the product's own words");
  assert.doesNotMatch(h.lines.join(" "), /sample|demo|real app/i);
  const left = Date.parse(h.readyAtIso) - Date.now();
  assert.ok(left > 100e3 && left <= 120e3, "the sample wait is short (2 minutes)");
  const early = await mock.call("account.waiting.run", { id: h.id });
  assert.ok("problem" in early && early.problem.code === "security.waiting.not-yet", "can't run before its wait");
  const cancelled = await mock.call<{ status: string }>("account.waiting.cancel", { id: h.id });
  assert.ok("ok" in cancelled && cancelled.ok.status === "done");
  // A cancel drops its row from the 24 hours (lib.rs drop_pending): $450 + $50 fits again.
  const after = await send(mock, "50");
  assert.ok("ok" in after && after.ok.status === "moving", "the cancelled one no longer counts");
});

test("bands: one payment over $500 is held at once; its sheet says so before the yes", async () => {
  const mock = demo();
  const sheets: { id: string; words: { lines: string[] } }[] = [];
  mock.on<{ id: string; words: { lines: string[] } }>("approval.needed", (a) => {
    sheets.push(a);
    void mock.call("approval.answer", { id: a.id, approve: true });
  });
  const big = await send(mock, "600");
  assert.ok("ok" in big && big.ok.status === "waiting");
  assert.match(sheets[0].words.lines.join(" "), /Over \$500 in 24 hours/);
  assert.match(sheets[0].words.lines.join(" "), /it waits 1 day/);
  assert.doesNotMatch(sheets[0].words.lines.join(" "), /sample|nothing is sent/i);
});

test("a payment at a partner's price that would be held is refused before the sheet, as the core refuses it (its price lasts a minute)", async () => {
  const mock = demo();
  let asked = 0;
  mock.on<{ id: string }>("approval.needed", (a) => { asked++; void mock.call("approval.answer", { id: a.id, approve: true }); });
  const to = { kind: "chain", chain: "base", address: "0x5a3e000000000000000000000000000000005a3e" };
  const q = await mock.call<{ id: string }>("ledger.quotePay", { fromTokenId: USDC, toTokenId: USDC_BASE, amountOut: "700", to });
  assert.ok("ok" in q);
  const out = await mock.call("ledger.pay", { quoteId: q.ok.id });
  assert.ok("problem" in out && out.problem.code === "security.quote.cant-wait");
  assert.equal(asked, 0, "nothing is signed");
  const q2 = await mock.call<{ id: string }>("ledger.quotePay", { fromTokenId: USDC, toTokenId: USDC_BASE, amountOut: "20", to });
  assert.ok("ok" in q2);
  const small = await mock.call<{ status: string }>("ledger.pay", { quoteId: q2.ok.id });
  assert.ok("ok" in small && small.ok.status === "moving", "under the band a swap runs");
});

test("every change to the rules waits the change wait, tighter or looser; it applies only once released", async () => {
  const mock = demo();
  const tighter = [{ upToUsd: 100, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86400 }];
  const out = await mock.call<{ status: string; id: string; readyAtIso: string }>("account.protection.set", { bands: tighter });
  assert.ok("ok" in out && out.ok.status === "waiting", "on chain set_protection takes the strictest level and the floor, whichever way it goes");
  const before = await mock.call<{ usd: { upToUsd: number | null }[] }>("account.protection.get");
  assert.ok("ok" in before && before.ok.usd[0].upToUsd === 500, "nothing changed yet");
  const waiting = await mock.call<Waiting[]>("account.waiting");
  assert.ok("ok" in waiting);
  assert.match(waiting.ok[0].lines.join(" "), /^Waits 3 days, so you have time to stop a change you didn.t make/);
  const looser = await mock.call<{ status: string }>("account.protection.set", { bands: [{ upToUsd: 5000, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86400 }] });
  assert.ok("ok" in looser && looser.ok.status === "waiting", "a loosening waits too");
  const pair = await mock.call<{ status: string }>("account.secondDevice.pair", { qr: SAMPLE_LAPTOP_CODE });
  assert.ok("ok" in pair && pair.ok.status === "waiting", "a new key is a change: it waits");
  const state = await mock.call<{ account: { keys: { role: string }[] } }>("account.state");
  assert.ok("ok" in state && !state.ok.account.keys.some((k) => k.role === "second-device"), "the laptop isn't on the account until the wait ends");
});

test("a released change does what it asked", async () => {
  const mock = createMockBridge({ latencyMs: 0, mainnetRules: { demoWaitSeconds: 0.01 } });
  const out = await mock.call<{ status: string; id: string }>("account.protection.set", { bands: [{ upToUsd: 100, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86400 }] });
  assert.ok("ok" in out && out.ok.status === "waiting");
  await new Promise((r) => setTimeout(r, 20));
  const ran = await mock.call<{ status: string }>("account.waiting.run", { id: out.ok.id });
  assert.ok("ok" in ran && ran.ok.status === "done");
  const got = await mock.call<{ usd: { upToUsd: number | null }[] }>("account.protection.get");
  assert.ok("ok" in got && got.ok.usd[0].upToUsd === 100);
  // and the new band applies: $150 is now over it
  const pay = await mock.call<{ status: string }>("ledger.transfer", { toAccountId: "bob.near", amount: "150", tokenId: USDC });
  assert.ok("ok" in pay && pay.ok.status === "waiting");
});

test("a recovery's freeze: every payment waits, said as such; ending it lets small ones run again", async () => {
  const mock = demo();
  mock.freeze(new Date(Date.now() + 7 * 86400e3).toISOString());
  const small = await send(mock, "5");
  assert.ok("ok" in small && small.ok.status === "waiting", "spending is frozen while a recovery waits (re-audit 3, A-1)");
  const waiting = await mock.call<Waiting[]>("account.waiting");
  assert.ok("ok" in waiting);
  assert.match(waiting.ok[0].lines.join(" "), /A recovery is open/);
  mock.freeze(null);
  const again = await send(mock, "5");
  assert.ok("ok" in again && again.ok.status === "moving");
});

test("subwallet.export: through the sheet, a key-shaped string no wallet app can read (robot 9)", async () => {
  const mock = demo({ tradeChains: ["sol"] });
  const sheets: { id: string; words: { title: string; lines: string[] } }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (a) => {
    sheets.push(a);
    void mock.call("approval.answer", { id: a.id, approve: true });
  });
  const out = await mock.call<{ secretKey: string }>("subwallet.export", { id: "sw-trade-sol" });
  assert.ok("ok" in out, JSON.stringify(out));
  assert.equal(out.ok.secretKey, SAMPLE_KEY, "the key-shaped string no chain can read (MockBridge.addresses.test.ts)");
  assert.match(sheets[0].words.title, /Show the key of your Solana wallet/);
  assert.doesNotMatch(sheets[0].words.lines.join(" "), /sample|not a real/i);
  const unknown = await mock.call("subwallet.export", { id: "nope" });
  assert.ok("problem" in unknown && unknown.problem.code !== "mock.unknown");
});

test("the public demo's account: a neutral name on mainnet, and no testnet word in what it answers (robot 14)", async () => {
  const mock = demo({ account: { accountId: PUBLIC_SAMPLE_ACCOUNT_ID, network: "mainnet" } });
  const state = await mock.call<{ account: { accountId: string; network: string } }>("account.state");
  assert.ok("ok" in state && state.ok.account.accountId === "zf-account" && state.ok.account.network === "mainnet");
  const near = await mock.call<{ address: string }>("ledger.depositAddress", { chain: "near" });
  assert.ok("ok" in near && near.ok.address === "zf-account");
  const said = JSON.stringify(await Promise.all(["account.activity", "ledger.activity", "account.state"].map((m) => mock.call(m))));
  assert.doesNotMatch(said, /testnet|nearblocks|solscan|basescan/);
  const out = await mock.call<{ explorerUrl: string }>("tx.request", { request: { receiverId: "a", actions: [], why: "w" } });
  assert.ok("ok" in out && out.ok.explorerUrl === "");
});

test("one ledger: the trading wallets hold Trade's sample opening money in the core's own balances (robot 7, 8)", async () => {
  const mock = demo({ tradeChains: ["sol", "hood", "bsc"], float: { opening: { sol: "1420000000", bsc: "80000000000000000", hood: "12000000000000000" } } });
  const sol = await mock.call<{ token: string; amount: string }[]>("subwallet.balances", { id: "sw-trade-sol" });
  assert.ok("ok" in sol && sol.ok[0].amount === "1420000000");
  const bsc = await mock.call<{ token: string; amount: string }[]>("subwallet.balances", { id: "sw-trade-bsc" });
  assert.ok("ok" in bsc && bsc.ok[0].amount === "80000000000000000");
  // and a move home takes it from there (Take out's float.in), never "nothing in Trading"
  const back = await mock.call<{ id: string; status: string }>("subwallet.float.in", { chain: "sol", amount: "all", key: "take-out-key-0001" });
  assert.ok("ok" in back, JSON.stringify(back));
  const after = await mock.call<{ token: string; amount: string }[]>("subwallet.balances", { id: "sw-trade-sol" });
  assert.ok("ok" in after && after.ok[0].amount === "0");
});

test("the demo's laptop: a made-up code is refused before any sheet; only the code the laptop shows adds it", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: { demoWaitSeconds: 0.01 }, sampleLaptop: true });
  let asked = 0;
  mock.on("approval.needed", (a: { id: string }) => { asked++; void mock.call("approval.answer", { id: a.id, approve: true }); });
  for (const qr of ["ABCD-1234", "ZFL1:SAMPLE", `${SAMPLE_LAPTOP_CODE}X`]) {
    const r = await mock.call("account.secondDevice.pair", { qr });
    assert.ok("problem" in r && r.problem.code === "security.pair.code-wrong", qr);
  }
  assert.equal(asked, 0, "no sheet for a code that doesn't match");
  const ok = await mock.call<{ status: string }>("account.secondDevice.pair", { qr: SAMPLE_LAPTOP_CODE });
  assert.ok("ok" in ok && ok.ok.status === "waiting", "the laptop's own code: on the sheet, then the change wait");
  assert.equal(asked, 1);
});

test("the second device: paired after the change wait, then what needs it waits for its yes; a yes runs it, a no drops it", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: { demoWaitSeconds: 0.01 } });
  const release = async (out: unknown) => {
    await new Promise((r) => setTimeout(r, 20));
    const id = (out as { ok: { id: string } }).ok.id;
    const ran = await mock.call<{ status: string }>("account.waiting.run", { id });
    assert.ok("ok" in ran && ran.ok.status === "done", JSON.stringify(ran));
  };
  await release(await mock.call("account.secondDevice.pair", { qr: SAMPLE_LAPTOP_CODE }));
  await release(await mock.call("account.secondDevice.setLimit", { usd: 100 }));
  const pay = await send(mock as ReturnType<typeof demo>, "200");
  assert.ok("ok" in pay && pay.ok.status === "waiting" && pay.ok.held);
  const listed = await mock.call<(Waiting & { needsSecondDevice: boolean; sampleDevice?: boolean })[]>("account.waiting");
  assert.ok("ok" in listed);
  const h = listed.ok.find((w) => w.id === pay.ok.held!.id)!;
  assert.ok(h.needsSecondDevice && h.sampleDevice);
  await new Promise((r) => setTimeout(r, 20));
  const early = await mock.call("account.waiting.run", { id: h.id });
  assert.ok("problem" in early && early.problem.code === "security.waiting.needs-device", "no run without the device's yes");
  const yes = await mock.call("account.waiting.sampleDevice", { id: h.id, approve: true });
  assert.ok("ok" in yes);
  const st = await mock.call<{ state: string }>("account.waiting.status", { id: h.id });
  assert.ok("ok" in st && st.ok.state === "ran", "its wait was over: the yes ran it");
  const pay2 = await send(mock as ReturnType<typeof demo>, "200");
  assert.ok("ok" in pay2 && pay2.ok.held);
  await mock.call("account.waiting.sampleDevice", { id: pay2.ok.held!.id, approve: false });
  const st2 = await mock.call<{ state: string }>("account.waiting.status", { id: pay2.ok.held!.id });
  assert.ok("ok" in st2 && st2.ok.state === "declined");
});

test("the web demo's Skip ahead: a held payment keeps its real wait until skipped, then runs", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, mainnetRules: {} });
  const big = await send(mock as ReturnType<typeof demo>, "600");
  assert.ok("ok" in big && big.ok.held);
  const id = big.ok.held!.id;
  const left = Date.parse(big.ok.held!.readyAtIso) - Date.now();
  assert.ok(left > 86_000e3 && left <= 86_400e3, "the real wait: 1 day");
  const listed = await mock.call<{ id: string; skip?: boolean }[]>("account.waiting");
  assert.ok("ok" in listed && listed.ok.find((w) => w.id === id)?.skip === true);
  const early = await mock.call("account.waiting.run", { id });
  assert.ok("problem" in early);
  await mock.call("account.waiting.skip", { id });
  const ran = await mock.call<{ status: string }>("account.waiting.run", { id });
  assert.ok("ok" in ran && ran.ok.status === "done");
});

test("waitWords says a wait as a person does", () => {
  assert.equal(waitWords(86400), "1 day");
  assert.equal(waitWords(8 * 86400), "8 days");
  assert.equal(waitWords(120), "2 minutes");
});

test("grade 30 Oct item 5: a held change is finished, never sent, and no sheet repeats a wait it ends", async () => {
  const mock = createMockBridge({ latencyMs: 0, mainnetRules: {} });
  const titles: { title: string; lines: string[] }[] = [];
  mock.on<{ id: string; words: { title: string; lines: string[] } }>("approval.needed", (a) => {
    titles.push(a.words);
    void mock.call("approval.answer", { id: a.id, approve: true });
  });
  const change = await mock.call<{ status: string; id: string }>("account.protection.set", { bands: [{ upToUsd: 100, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86400 }] });
  assert.ok("ok" in change && change.ok.status === "waiting");
  await mock.call("account.waiting.skip", { id: change.ok.id });
  titles.length = 0;
  const ran = await mock.call<{ status: string }>("account.waiting.run", { id: change.ok.id });
  assert.ok("ok" in ran && ran.ok.status === "done");
  assert.match(titles[0].title, /^Finish it now: /);
  assert.doesNotMatch(titles[0].lines.join(" "), /Waits|until then/);
  // a payment's run is still "Send it now", and its cancel sheet doesn't repeat "it waits 1 day … until then"
  const big = await send(mock as ReturnType<typeof demo>, "600");
  assert.ok("ok" in big && big.ok.held);
  titles.length = 0;
  await mock.call("account.waiting.cancel", { id: big.ok.held!.id });
  assert.match(titles[0].title, /^Cancel: /);
  assert.doesNotMatch(titles[0].lines.join(" "), /until then/);
  const big2 = await send(mock as ReturnType<typeof demo>, "600");
  assert.ok("ok" in big2 && big2.ok.held);
  await mock.call("account.waiting.skip", { id: big2.ok.held!.id });
  titles.length = 0;
  await mock.call("account.waiting.run", { id: big2.ok.held!.id });
  assert.match(titles[0].title, /^Send it now: /);
});

test("grade 30 Oct item 9: a send leaves the balance the moment it is sent, before it settles, and only once", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 30, mainnetRules: {} });
  const usdc = async () => {
    const r = await mock.call<{ tokenId: string; amount: string }[]>("ledger.balances");
    assert.ok("ok" in r);
    return r.ok.filter((b) => b.tokenId === USDC).reduce((n, b) => n + Number(b.amount), 0);
  };
  const before = await usdc();
  const out = await send(mock as ReturnType<typeof demo>, "25");
  assert.ok("ok" in out && out.ok.status === "moving");
  assert.equal(await usdc(), before - 25, "already lower when the person taps Done");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(await usdc(), before - 25, "settling doesn't take it twice");
});

test("security review 2 Nov (Low): the demo's mock makes Spending's NEAR balance for Trade and the shell only", async () => {
  const mock = demo();
  for (const app of ["browser", "social", "chat"]) {
    const r = await mock.call("subwallet.create", { kind: "trade", chain: "near", app });
    assert.ok("problem" in r && r.problem.code === "security.request.not-allowed", app);
  }
  for (const app of ["trade", undefined]) {
    const r = await mock.call<{ chain: string }>("subwallet.create", { kind: "trade", chain: "near", ...(app ? { app } : {}) });
    assert.ok("ok" in r && r.ok.chain === "near", app ?? "shell");
  }
});
