// Home's Send (the Home plan §1.3, E3 and E4; D128): from a wallet (ledger.hiddenFromRow) or from the Safe
// (ledger.sendFromSafe) to ANY address on any chain 1Click pays, privately through NEAR, landing as that chain's own coin
// (send-to.ts LANDS_AS). Leg 2 is handed to 1Click only after 1Click says leg 1 landed with enough; back, short or slow,
// nothing is paid and the line says where the money is.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { QuoteRefused, createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { LANDS_AS, RELAY_LIMIT_LINE } from "./send-to.ts";
import { SAFE_SEND_OPEN } from "./send-open.ts";
import { createSendJobs, sendWords, type SendJob } from "./send-job.ts";
import { readFileSync } from "node:fs";
import { CONVERT_ROUTES } from "./convert.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Movement } from "./types.ts";
import { pairs } from "@zerofee/core/testing/explorer-pairs";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SOL_PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const EVM_PAYEE = "0x12345678901234567890123456789012345678ab";

interface Opt { leg1Status?: string[]; landed?: string; pocket?: boolean; kid?: boolean; privatePay?: "sign" | "decline"; sign?: "done" | "declined" | "waiting"; routeOpen?: boolean; refuse?: QuoteRefused; core?: ReturnType<typeof fakeCore>; submitThrows?: boolean; outStatus?: () => string; sheetHangs?: boolean; registered?: string[]; sameOut?: boolean; safeUnits?: string }
function setup(o: Opt = {}) {
  const core = o.core ?? fakeCore({ accountId: ME, kid: o.kid, privatePay: o.privatePay, sign: o.sign, subwallets: o.pocket === false ? [] : [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const order: string[] = [];
  const created: unknown[] = [];
  const legs: { method: string; p: any }[] = [];
  let made = false;
  const bridge: Bridge = {
    call: async (method: string, p?: any) => {
      order.push(method);
      // a row's own leg (subwallet.hiddenFromRow) as the core answers after its one yes
      if (method === "subwallet.hiddenFromRow") return (legs.push({ method, p }), { ok: { leg1: { status: "done", explorerUrl: "https://solscan.io/tx/x" }, signedData: { signature: "row-sig" } } }) as any;
      if (method === "subwallet.private.quoteIn" && p?.outside) {
        legs.push({ method, p });
        return { ok: { depositAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amountIn: p.amount, minAmountOut: ((BigInt(p.amount) * 99n) / 100n).toString(), deadlineIso: new Date(Date.now() + 86_400_000).toISOString(), statusTag: "row-leg-one-status-tag" } } as any;
      }
      // the Safe's sheet that never answers: the app dies with it open (security review L2)
      if (method === "tx.request" && o.sheetHangs) return new Promise(() => undefined) as any;
      if (method === "subwallet.create") return (created.push(p), (made = true), { ok: { id: "sw-private", address: POCKET } }) as any;
      if (method === "subwallet.list" && o.pocket === false) return { ok: made ? [{ kind: "private", id: "sw-private", address: POCKET, chain: "near", label: "" }] : [] } as any;
      return core.call(method, p);
    },
    on: core.on.bind(core),
  } as Bridge;
  const asked: any[] = [];
  const submitted: unknown[] = [];
  const statuses = o.leg1Status ?? ["PENDING_DEPOSIT", "SUCCESS"];
  let reads = 0;
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const apis: Apis = {
    ...base,
    quote: async (req: any) => {
      asked.push(req);
      if (o.refuse) throw o.refuse;
      return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: o.sameOut ? req.amount : "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any;
    },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async (_via, signed) => { submitted.push(signed); if (o.submitThrows) throw new Error("timed out"); return { intentHash: "h" }; },
    // as the relay answers: what arrived only with the quote's own tag (security review M2)
    status: async (a: string, _via?: string, tag?: string) => {
      if (a === QUOTE_ADDRESS || a.startsWith("9WzD")) return { status: statuses[Math.min(reads++, statuses.length - 1)]!, ...(tag ? { swapDetails: { amountOut: o.landed ?? "999999999999999999999999" } } : {}) } as any;
      return { status: o.outStatus ? o.outStatus() : "SUCCESS" } as any;
    },
  };
  // 1Click's address already has its USDC storage, so the Safe's move in is one ft_withdraw (one sheet, one hold)
  const make = () => createLedgerService({ bridge, chain: fakeNear(ME, { ledger: { [USDC]: o.safeUnits ?? "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} }, ...Object.fromEntries((o.registered ?? []).map((a) => [a, { ledger: {} }])) }), apis, routes: { intents: false, nearOrigin: o.routeOpen !== false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY });
  return { ledger: make(), make, core, order, created, legs, asked, submitted };
}
const wait = async (ledger: Bridge, id: string, until = (m: Movement) => m.status !== "moving" && m.status !== "waiting") => {
  for (let i = 0; i < 400; i++) {
    const r = await ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
    const m = "ok" in r ? r.ok.find((x) => x.id === id) : undefined;
    if (m && until(m)) return m;
    await new Promise((res) => setTimeout(res, 3));
  }
  throw new Error(`never settled: ${id}`);
};

// ---- E3: from a wallet

test("E3: a wallet sends to any chain, as that chain's own coin: exactly the amount leaves, leg 2 pays exactly leg 1's signed minimum", async () => {
  const cases = [
    { chain: "sol", to: { kind: "chain", chain: "bsc", address: EVM_PAYEE }, lands: LANDS_AS.bsc.tokenId, inUnits: "500000000" },
    { chain: "hood", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, lands: LANDS_AS.sol.tokenId, inUnits: "2000000000000000" },
    { chain: "sol", to: { kind: "chain", chain: "near", address: "alice.near" }, lands: LANDS_AS.near.tokenId, inUnits: "500000000" },
    { chain: "sol", to: { kind: "ledger", accountId: "alice.near" }, lands: LANDS_AS.near.tokenId, inUnits: "500000000" },
    { chain: "hood", to: { kind: "chain", chain: "base", address: EVM_PAYEE }, lands: LANDS_AS.base.tokenId, inUnits: "2000000000000000" },
  ] as const;
  for (const c of cases) {
    const s = setup();
    const r = await s.ledger.call<Movement>("ledger.hiddenFromRow", { chain: c.chain, to: c.to, amountIn: c.chain === "sol" ? "0.5" : "0.002", caller: "wallet" });
    assert.ok("ok" in r, `${c.chain} → ${JSON.stringify(c.to)}: ${"problem" in r ? r.problem.code : ""}`);
    const leg1 = s.legs.find((l) => l.method === "subwallet.private.quoteIn")!.p;
    assert.deepEqual([leg1.amount, leg1.outside, leg1.through], [c.inUnits, true, true], "leg 1: exactly the amount, passing through");
    const leg2 = s.asked.at(-1);
    assert.deepEqual([leg2.dry, leg2.swapType, leg2.amount, leg2.destinationAsset, leg2.depositType], [false, "EXACT_INPUT", ((BigInt(c.inUnits) * 99n) / 100n).toString(), c.lands, "CONFIDENTIAL_INTENTS"], "leg 2: exactly leg 1's minimum, no trim (D137), landing as the chain's own coin");
    assert.equal(leg2.recipientType, c.to.kind === "ledger" ? "INTENTS" : "DESTINATION_CHAIN");
    assert.equal((await wait(s.ledger, r.ok.id)).status, "done");
    assert.deepEqual(s.submitted, [{ signature: "row-sig" }], "leg 2 handed over once, after leg 1 landed");
  }
});

test("audit H1 (fix #3): a wallet's Send rounds its inflow UP to the grid when the wallet holds it, the payee gets exactly the asked share, the rest stays in the private balance; an explorer pairing in and out by amount links the old Send and not this one (control: no upTo, exactly as before)", async () => {
  // the explorer: leg 1's amount in, leg 2's amount out (the same coin, SOL units here), within 1Click's usual 0.2 % to 3 %
  const linked = (inUnits: bigint, outUnits: bigint) => Number(outUnits) <= Number(inUnits) * 0.998 && Number(outUnits) >= Number(inUnits) * 0.97;
  const send = async (upTo?: string) => {
    const s = setup();
    const r = await s.ledger.call<Movement>("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "bsc", address: EVM_PAYEE }, amountIn: "0.04953", ...(upTo ? { upTo } : {}), caller: "wallet" });
    assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
    return { s, m: r.ok, in1: BigInt(s.legs.find((l) => l.method === "subwallet.private.quoteIn")!.p.amount), out2: BigInt(s.asked.at(-1).amount) };
  };
  const old = await send();
  assert.equal(old.in1, 49_530_000n, "control: no upTo, exactly what was asked leaves");
  assert.ok(linked(old.in1, old.out2), "control: the explorer links the old Send");
  const grid = await send("1.42");
  assert.equal(grid.in1, 52_000_000n, "0.04953 SOL → 0.052 SOL on the grid");
  assert.equal(grid.out2, (51_480_000n * 49_530_000n) / 52_000_000n, "the payment: exactly the asked share of leg 1's minimum");
  assert.equal(grid.m.amount, "0.04953", "the Send is what was asked");
  assert.equal(grid.m.kept, "0.00247", "the rest stays in the private balance, said on the movement");
  assert.ok(!linked(grid.in1, grid.out2), "the explorer can't pair them by amount");
  // the wallet can't hold the grid's amount: exactly as asked
  assert.equal((await send("0.05")).in1, 49_530_000n);
});

test("privacy audit (4 Nov, review): a Max Send from a wallet and from the Safe brings the grid amount under the balance, pays the asked share (at least 3 % under), keeps the rest in the private balance, and the explorer pairs neither (before, c12a56c4: ~99 % out of what went in, paired)", async () => {
  const w = setup();
  const r = await w.ledger.call<Movement>("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "bsc", address: EVM_PAYEE }, amountIn: "1.42", upTo: "1.42", caller: "wallet" });
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  const wIn = Number(w.legs.find((l) => l.method === "subwallet.private.quoteIn")!.p.amount), wOut = Number(w.asked.at(-1).amount);
  assert.equal(pairs([{ amount: wIn, at: 0 }], [{ amount: wOut, at: 2 }]), 0, "the wallet's Max: not paired");
  assert.equal(wIn, 1_400_000_000, "leg 1: 1.4 SOL on the grid; 0.02 stays in the wallet");
  assert.deepEqual([r.ok.amount, r.ok.kept], ["1.3592233", "0.0407767"], "what goes to them, and what stays in the private balance");
  const s = setup();
  const q = await one(s.ledger, { ...safeAsk, amount: "498.37", upTo: "498.37" });
  assert.ok("ok" in q, "problem" in q ? `${q.problem.code} ${q.problem.whatHappened}` : "");
  const sIn = Number(s.core.privateIns[0]!.amount), sOut = Number(s.asked.at(-1).amount);
  assert.equal(pairs([{ amount: sIn, at: 0 }], [{ amount: sOut, at: 2 }]), 0, "the Safe's Max: not paired");
  assert.equal(sIn, 490_000_000, "leg 1: $490 on the grid; $8.37 stays in the Safe");
  assert.deepEqual([q.ok.amount, q.ok.kept], ["475.728155", "14.271845"]);
});

test("review (4 Nov): a Max Send whose coin is 3 % of its inflow already in Private keeps the gap on the TOTAL payout: the Safe's (pocket part plus its share) isn't paired; the wallet's never adds the pocket (controls: no pocket part, not paired)", async () => {
  const withPocket = (tokenId: string, amount: string) => fakeCore({ accountId: ME, pocket: [{ tokenId, amount }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  // the Safe: $500 of its own, $15 (3 % of the $500 inflow) in the pocket, Max $515
  const s = setup({ core: withPocket(USDC, "15000000") });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount: "515", upTo: "515" });
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  const sIn = Number(s.core.privateIns[0]!.amount);
  const sOut = s.asked.filter((q) => !q.dry).reduce((n, q) => n + Number(q.amount), 0);
  assert.equal(pairs([{ amount: sIn, at: 0 }], [{ amount: sOut, at: 2 }]), 0, `the Safe's Max with 3 % in Private: ${sOut} out of ${sIn} in, not paired`);
  assert.equal(sIn, 500_000_000);
  assert.deepEqual(r.ok.map((m) => m.amount), ["15", "470.436893"], "the pocket's $15, then the Safe's share: $485.436893 in all");
  const c = setup();
  await one(c.ledger, { ...safeAsk, amount: "500", upTo: "500" });
  assert.equal(pairs([{ amount: Number(c.core.privateIns[0]!.amount), at: 0 }], [{ amount: Number(c.asked.at(-1).amount), at: 2 }]), 0, "control: no pocket part");
  // the wallet: 0.042 SOL (3 % of a 1.4 SOL inflow) in Private, Max 1.42
  const w = setup({ core: withPocket("nep141:sol.omft.near", "42000000") });
  const q = await w.ledger.call<Movement>("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "bsc", address: EVM_PAYEE }, amountIn: "1.42", upTo: "1.42", caller: "wallet" });
  assert.ok("ok" in q, "problem" in q ? q.problem.code : "");
  const wIn = Number(w.legs.find((l) => l.method === "subwallet.private.quoteIn")!.p.amount);
  const wOut = w.asked.filter((x) => !x.dry).reduce((n, x) => n + Number(x.amount), 0);
  assert.equal(pairs([{ amount: wIn, at: 0 }], [{ amount: wOut, at: 2 }]), 0, "the wallet's Max: the pocket isn't added, not paired");
});

test("review (4 Nov): a Max Send whose Private share alone fills the gap's limit pays the WHOLE Private share, with no inflow at all (nothing public to pair with), and the Safe's part stays in the Safe (control: a small Private share still goes through the grid)", async () => {
  const withPocket = (amount: string) => fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  // $600 in Private, $500 in the Safe: the most under a $500 inflow's gap is $485.44, less than Private holds
  const s = setup({ core: withPocket("600000000") });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount: "1100", upTo: "1100" });
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(r.ok.map((m) => [m.id.split(":")[0], m.amount]), [["pocket-send", "600"]], "all of the Private share, one payment");
  assert.deepEqual(s.core.privateIns, [], "nothing leaves the Safe");
  const c = setup({ core: withPocket("15000000") });
  const q = await c.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount: "515", upTo: "515" });
  assert.ok("ok" in q);
  assert.deepEqual(c.core.privateIns.map((p) => p.amount), ["500000000"], "control: a small Private share, the Safe's part on the grid");
});

test("audit H1 (fix #2): the private balance already holds enough of the wallet's coin: the Send is paid from there, one leg, nothing leaves the wallet (control: with less there, leg 1 as before)", async () => {
  const SOL = "nep141:sol.omft.near";
  const withSol = (amount: string) => fakeCore({ accountId: ME, pocket: [{ tokenId: SOL, amount }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const s = setup({ core: withSol("60000000") });
  const r = await s.ledger.call<Movement>("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "bsc", address: EVM_PAYEE }, amountIn: "0.04953", upTo: "1.42", caller: "wallet" });
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.match(r.ok.id, /^pocket-send:/);
  assert.equal(s.legs.filter((l) => l.method === "subwallet.private.quoteIn" || l.method === "subwallet.hiddenFromRow").length, 0, "no leg 1: nothing leaves the wallet");
  assert.deepEqual([s.asked.at(-1).amount, s.asked.at(-1).originAsset], ["49530000", SOL], "the payment: exactly the asked SOL, from the private balance");
  const c = setup({ core: withSol("40000000") });
  const two = await c.ledger.call<Movement>("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "bsc", address: EVM_PAYEE }, amountIn: "0.04953", upTo: "1.42", caller: "wallet" });
  assert.ok("ok" in two && /^hidden-row:/.test(two.ok.id), "control: not enough there, leg 1 as before");
});

test("E3: a payee checked for its own network before anything is priced (control: the same address on its own network goes)", async () => {
  const s = setup();
  for (const to of [{ kind: "chain", chain: "bsc", address: SOL_PAYEE }, { kind: "chain", chain: "sol", address: EVM_PAYEE }, { kind: "chain", chain: "near", address: EVM_PAYEE.toUpperCase().replace("0X", "0x") }, { kind: "chain", chain: "near", address: "a..near" }, { kind: "chain", chain: "btc", address: SOL_PAYEE }, { kind: "chain", chain: "ton", address: "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2" }]) {
    const r = await s.ledger.call("ledger.hiddenFromRow", { chain: "sol", to, amountIn: "0.5", caller: "wallet" });
    assert.ok("problem" in r && r.problem.code === "ledger.address.invalid", JSON.stringify(to));
  }
  const wrongCoin = await s.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "hood", address: EVM_PAYEE }, toTokenId: LANDS_AS.base.tokenId, amountIn: "0.5", caller: "wallet" });
  assert.ok("problem" in wrongCoin && /doesn't land on Robinhood Chain/.test(wrongCoin.problem.more ?? ""), "never ETH on Base for a Robinhood Chain address");
  assert.equal(s.asked.length + s.legs.length, 0, "nothing priced or asked of the core");
  const ok = await s.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "hood", address: EVM_PAYEE }, amountIn: "0.5", caller: "wallet" });
  assert.ok("ok" in ok);
});

test("E3: no pocket yet: the Send makes it (D128), once; never for a child's account (control: with a pocket, nothing is made)", async () => {
  const fresh = setup({ pocket: false });
  const r = await fresh.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "0.5", caller: "wallet" });
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.deepEqual(fresh.created, [{ kind: "private", chain: "near" }]);
  const had = setup();
  await had.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "0.5", caller: "wallet" });
  assert.deepEqual(had.created, [], "control");
  const kid = setup({ pocket: false, kid: true });
  const k = await kid.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "0.5", caller: "wallet" });
  assert.ok("problem" in k && k.problem.code === "ledger.private.child");
  assert.deepEqual(kid.created, []);
});

test("the quote relay's own limit is said as the relay's, by name (control: 1Click's own no stays 1Click's)", async () => {
  // the relay's own words (apps/quotes relay.mjs): its figure is what the line says (security review L6)
  const big = setup({ refuse: new QuoteRefused("A private send goes up to $10,000.", "quotes.request.too-big") });
  const r = await big.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "5", caller: "wallet" });
  assert.ok("problem" in r);
  assert.equal(r.problem.code, "ledger.send.relay-limit");
  assert.equal(r.problem.whatHappened, `${RELAY_LIMIT_LINE} Nothing was sent.`);
  const raised = setup({ refuse: new QuoteRefused("A private send goes up to $25,000.", "quotes.request.too-big") });
  const g = await raised.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "5", caller: "wallet" });
  assert.ok("problem" in g && g.problem.whatHappened === "ZeroFee's price server takes up to $25,000 a send. Nothing was sent.", "control: another figure from the relay is that figure, never one kept here");
  const other = setup({ refuse: new QuoteRefused("Amount is too low") });
  const o = await other.ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "5", caller: "wallet" });
  assert.ok("problem" in o && o.problem.code === "ledger.quote.unavailable" && o.problem.more === "Amount is too low");
});

// QA's lap (5 Nov): a private Send to a 64-hex NEAR account landed once, then 5 of 5 were refused
// (relay 400 quotes.upstream.refused) and the sheet said "1Click gave no price". 1Click's own answer to a payout on NEAR,
// read with dry quotes the same day: "Quoting for this pair is not available", from any coin, while Solana quoted.
test("dust lap: a payout to a NEAR account that 1Click refuses is said as NEAR Intents', by name, nothing sent (controls: the same refusal to Solana, and to a NEAR Intents balance, stay as they were)", async () => {
  const UPSTREAM = () => new QuoteRefused("1Click didn't take that request.", "quotes.upstream.refused");
  const near = { kind: "chain", chain: "near", address: "e".repeat(64) };
  for (const [what, call, p] of [
    ["from a wallet", "ledger.hiddenFromRow", { chain: "sol", to: near, amountIn: "0.5", caller: "wallet" }],
    ["from the Safe", "ledger.sendFromSafe", { ...safeAsk, to: near }],
  ] as const) {
    const s = setup({ refuse: UPSTREAM() });
    const r = await s.ledger.call(call, p);
    assert.ok("problem" in r, what);
    assert.equal(r.problem.code, "ledger.quote.near-closed", what);
    assert.equal(r.problem.whatHappened, "NEAR Intents said no to this payout, so nothing was sent.", what);
    assert.doesNotMatch(r.problem.whatHappened, /1Click/, `${what}: voice never names 1Click on screen`);
    assert.equal(s.submitted.length, 0, `${what}: nothing handed over`);
  }
  const sol = await setup({ refuse: UPSTREAM() }).ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "0.5", caller: "wallet" });
  assert.ok("problem" in sol && sol.problem.code === "ledger.quote.unavailable", "control: a payout to Solana keeps its own line");
  const intents = await setup({ refuse: UPSTREAM() }).ledger.call("ledger.hiddenFromRow", { chain: "sol", to: { kind: "ledger", accountId: "e".repeat(64) }, amountIn: "0.5", caller: "wallet" });
  assert.ok("problem" in intents && intents.problem.code === "ledger.quote.unavailable", "control: a NEAR Intents balance (no payout on chain) keeps its own line");
  const other = await setup({ refuse: new QuoteRefused("Amount is too low") }).ledger.call("ledger.hiddenFromRow", { chain: "sol", to: near, amountIn: "0.5", caller: "wallet" });
  assert.ok("problem" in other && other.problem.code === "ledger.quote.unavailable", "control: another refusal to NEAR (no upstream code) keeps its own line");
});

// ---- E4: from the Safe

const safeAsk = { tokenId: USDC, amount: "250", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, caller: "wallet" };
/** A Send from the Safe with nothing of that coin in the pocket: one part, the Safe's. */
const one = async (ledger: Bridge, p: Record<string, unknown> = safeAsk): Promise<{ ok: Movement } | { problem: import("@zerofee/core/problem").Problem }> => {
  const r = await ledger.call<Movement[]>("ledger.sendFromSafe", p);
  if ("problem" in r) return r;
  assert.equal(r.ok.length, 1, "one part: nothing of it in the pocket");
  return { ok: r.ok[0]! };
};

test("E4: the pocket's payment is signed first (joined to leg 1), then the Safe's move in; leg 2 is handed over only after leg 1 lands; over $100 goes (D128)", async () => {
  const s = setup();
  const r = await one(s.ledger);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual([r.ok.kind, r.ok.private, r.ok.from, r.ok.amount, r.ok.status], ["pay", true, USDC, "250", "moving"]);
  const pay = s.order.indexOf("subwallet.privatePay"), sign = s.order.indexOf("tx.request");
  assert.ok(pay >= 0 && sign > pay, `the pocket's sheet, then the Safe's: ${s.order.join(", ")}`);
  assert.equal(s.core.privatePays[0]!.inDeposit, QUOTE_ADDRESS, "joined to leg 1's own address");
  assert.deepEqual(s.core.privateIns.map((p) => [p.tokenId, p.amount, p.through]), [[USDC, "250000000", true]], "leg 1: exactly $250 of USDC, passing through");
  const leg2 = s.asked.at(-1);
  assert.deepEqual([leg2.swapType, leg2.amount, leg2.destinationAsset, leg2.recipient], ["EXACT_INPUT", "247500000", LANDS_AS.sol.tokenId, SOL_PAYEE], "leg 2: exactly leg 1's minimum, no trim (D137)");
  const a = s.core.signed[0]!.actions[0] as { method: string; args: Record<string, unknown> };
  assert.deepEqual([a.method, a.args.receiver_id, a.args.amount], ["ft_withdraw", QUOTE_ADDRESS, "250000000"]);
  assert.equal((await wait(s.ledger, r.ok.id)).status, "done");
  assert.equal(s.submitted.length, 1, "handed over once");
  // paid: 1Click said SUCCESS for the payment itself, so the job has nothing left to follow (H1: it was marked handed
  // before the submit; the E3 test reads that mark while the outcome is unknown)
  assert.equal(JSON.parse(s.core.store.get("send-jobs") ?? "{}")[r.ok.id], undefined);
});

test("audit H1 (fix #3): a Send from the Safe rounds the Safe's leg 1 UP to the grid when the Safe holds it ($247.30 → $260); the payee gets exactly the asked share; the rest stays in the private balance (control: no upTo, exactly as before)", async () => {
  const s = setup();
  const r = await one(s.ledger, { ...safeAsk, amount: "247.3", upTo: "500" });
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(s.core.privateIns.map((p) => p.amount), ["260000000"], "leg 1: $260 on the grid");
  assert.equal(s.asked.at(-1).amount, String((257_400_000n * 247_300_000n) / 260_000_000n), "leg 2: exactly the asked share of leg 1's minimum");
  assert.deepEqual([r.ok.amount, r.ok.kept], ["247.3", "12.7"]);
  const c = setup();
  await one(c.ledger, { ...safeAsk, amount: "247.3" });
  assert.deepEqual(c.core.privateIns.map((p) => p.amount), ["247300000"], "control: exactly as asked");
});

test("a Safe coin partly in the pocket: each part from where it really is, the pocket's share first, straight out, then the Safe's through E4 (two movements)", async () => {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "100000000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const s = setup({ core });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", safeAsk);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(r.ok.map((m) => [m.id.split(":")[0], m.from, m.amount, m.private]), [["pocket-send", USDC, "100", true], ["safe-send", USDC, "150", true]], "the pocket's $100 first, then the Safe's $150");
  assert.deepEqual(core.privatePays.map((p) => [p.send ?? null, p.inDeposit ?? null]), [[true, null], [null, QUOTE_ADDRESS]], "the pocket's own Send sheet, then leg 2 joined to the Safe's leg 1");
  assert.deepEqual(s.asked.filter((q) => !q.dry).map((q) => [q.swapType, q.amount]), [["EXACT_INPUT", "100000000"], ["EXACT_INPUT", "148500000"]]);
  assert.deepEqual(core.privateIns.map((p) => p.amount), ["150000000"], "the Safe moves in only its own part");
  const a = core.signed[0]!.actions[0] as { args: Record<string, unknown> };
  assert.equal(a.args.amount, "150000000");
  assert.ok(s.order.indexOf("tx.request") > s.order.lastIndexOf("subwallet.privatePay"));
  for (const m of r.ok) assert.equal((await wait(s.ledger, m.id)).status, "done");
});

test("route B closed (the real core today): only the pocket's share can go; more says the most, before any sheet (control: up to the share goes, and exactly the share)", async () => {
  const held = () => fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "12500000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const more = setup({ core: held(), routeOpen: false });
  const r = await more.ledger.call("ledger.sendFromSafe", { ...safeAsk, amount: "20" });
  assert.ok("problem" in r);
  assert.deepEqual([r.problem.code, r.problem.whatHappened, r.problem.money], ["ledger.safe-send.most", "Up to 12.5 USDC can go now. The rest stays in your Safe.", { state: "safe", where: "in your Safe" }]);
  assert.deepEqual([more.core.privatePays.length, more.core.signed.length, more.asked.length], [0, 0, 0], "no sheet, nothing priced");
  for (const amount of ["10", "12.5"]) {
    const ok = setup({ core: held(), routeOpen: false });
    const g = await ok.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount });
    assert.ok("ok" in g, `${amount}: ${"problem" in g ? g.problem.code : ""}`);
    assert.deepEqual(g.ok.map((m) => [m.id.split(":")[0], m.amount]), [["pocket-send", amount]]);
    assert.deepEqual([ok.core.signed.length, ok.core.privateIns.length], [0, 0], "the Safe signs nothing");
  }
});

test("security review L5: a Safe coin's pocket share leaves out what an open Send still needs from the pocket (control: with no open Send, all of it can go)", async () => {
  const held = () => fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "12500000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const open: SendJob = { id: "hidden-row:open", inDeposit: "9WzD", outDeposit: "e".repeat(64), signedData: {}, coinId: USDC, leg2In: "4500000", coin: "USDC", startedAtIso: "2026-11-03T00:00:00.000Z" };
  const busy = held();
  busy.store.set("send-jobs", JSON.stringify({ [open.id]: open }));
  const s = setup({ core: busy, routeOpen: false });
  const r = await s.ledger.call("ledger.sendFromSafe", { ...safeAsk, amount: "12.5" });
  assert.ok("problem" in r);
  assert.equal(r.problem.whatHappened, "Up to 8 USDC can go now. The rest stays in your Safe.", "4.5 is the open Send's");
  assert.deepEqual(s.core.privatePays.length, 0, "no sheet");
  const fits = setup({ core: busy, routeOpen: false });
  const g = await fits.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount: "8" });
  assert.ok("ok" in g && g.ok[0]!.amount === "8", "up to the free part goes");
  const free = setup({ core: held(), routeOpen: false });
  const all = await free.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount: "12.5" });
  assert.ok("ok" in all && all.ok[0]!.amount === "12.5", "control: no open Send, all of it");
});

test("E4: leg 1 comes back or lands short: leg 2 is never handed over, and the line says where the money is (control: exactly enough goes)", async () => {
  const back = setup({ leg1Status: ["PENDING_DEPOSIT", "REFUNDED"] });
  const b = await one(back.ledger);
  assert.ok("ok" in b);
  const m = await wait(back.ledger, b.ok.id);
  // the money left the Safe for Private: said there, by name (QA's MUST 3, rule 8), never "nothing was paid"
  assert.deepEqual([m.status, m.problem?.code, m.problem?.whatHappened, m.problem?.money?.where], ["problem", "ledger.send.back", "It wasn't paid. The $250.00 is back in Private.", "in Private"]);
  assert.deepEqual(back.submitted, []);
  const short = setup({ leg1Status: ["SUCCESS"], landed: "247499999" });
  const s = await one(short.ledger);
  assert.ok("ok" in s);
  assert.equal((await wait(short.ledger, s.ok.id)).problem?.code, "ledger.send.short");
  assert.deepEqual(short.submitted, []);
  const enough = setup({ leg1Status: ["SUCCESS"], landed: "247500000" });
  const e = await one(enough.ledger);
  assert.ok("ok" in e);
  assert.equal((await wait(enough.ledger, e.ok.id)).status, "done");
  assert.equal(enough.submitted.length, 1);
});

test("E4: a No on the pocket's sheet signs nothing for leg 1; a No on the Safe's sheet keeps no job; neither hands anything over", async () => {
  const no2 = setup({ privatePay: "decline" });
  const a = await no2.ledger.call("ledger.sendFromSafe", safeAsk);
  assert.ok("problem" in a && a.problem.code === "ledger.signature.declined");
  assert.deepEqual([no2.core.signed.length, no2.order.includes("tx.request")], [0, false], "the Safe's sheet never rose");
  const no1 = setup({ sign: "declined" });
  const b = await no1.ledger.call("ledger.sendFromSafe", safeAsk);
  assert.ok("problem" in b && b.problem.code === "ledger.signature.declined");
  assert.equal(no1.core.store.get("send-jobs") ?? "{}", "{}", "no job kept: leg 2's signature is dropped");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual([no1.submitted, no2.submitted], [[], []]);
});

test("security review L2: the Safe's Send is on the device before its sheet, so an app that dies with it open is followed after a restart (control: a No takes both back)", async () => {
  const dies = setup({ sheetHangs: true });
  void dies.ledger.call("ledger.sendFromSafe", safeAsk);
  for (let i = 0; i < 200 && !dies.order.includes("tx.request"); i++) await new Promise((r) => setTimeout(r, 2));
  assert.ok(dies.order.includes("tx.request"), "the Safe's sheet is up");
  const kept = Object.values(JSON.parse(dies.core.store.get("send-jobs") ?? "{}")) as { id: string }[];
  assert.equal(kept.length, 1, "the job (with the payment signed) is kept before the sheet");
  assert.deepEqual(dies.submitted, [], "and nothing is handed over while it is open");
  // the app died there; the person had said yes and leg 1 went: a restart finds both and pays once leg 1 lands
  const after = setup({ core: dies.core, leg1Status: ["SUCCESS"] });
  const listed = await after.ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
  assert.ok("ok" in listed && listed.ok.some((m) => m.id === kept[0]!.id && m.status === "moving"), "Activity has it, moving");
  assert.equal((await wait(after.ledger, kept[0]!.id)).status, "done");
  assert.equal(after.submitted.length, 1);
  // control: a No on the Safe's sheet leaves neither the movement nor the job
  const no = setup({ sign: "declined" });
  assert.ok("problem" in (await no.ledger.call("ledger.sendFromSafe", safeAsk)));
  const none = await no.ledger.call<Movement[]>("ledger.activity", { caller: "wallet" });
  assert.ok("ok" in none && !none.ok.some((m) => m.id.startsWith("safe-send:")), "no Activity line for a No");
  assert.equal(no.core.store.get("send-jobs") ?? "{}", "{}");
});

test("security review L4: a Send is followed once per run, even after it ends: a resume that read it before its end can't start a second follower (control: another Send is followed)", async () => {
  const kv = new Map<string, string>();
  const moving = (id: string): Movement => ({ id, kind: "pay", status: "moving", amount: "1", startedAtIso: "", updatedAtIso: "", explorerUrls: [] });
  let movements: Movement[] = [moving("safe-send:a"), moving("safe-send:b")];
  const read: string[] = [];
  const jobs = createSendJobs({
    apis: { status: async (a: string) => (read.push(a), { status: "SUCCESS" }), submitIntent: async () => ({ intentHash: "h" }) } as never,
    relayed: RELAY, remember: async (m) => void (movements = [m, ...movements.filter((y) => y.id !== m.id)]), note: async () => undefined, forget: async () => undefined,
    loadMovements: async () => movements, emit: () => undefined, stored: async (k) => kv.get(k) ?? null, store: async (k, v) => void kv.set(k, v), serially: (f) => f(), iso: () => "", now: () => Date.now(), trackMs: 1,
  });
  const job = (id: string, out: string): SendJob => ({ id, outDeposit: out, signedData: {}, coinId: "c", leg2In: "1", coin: "USDC", startedAtIso: "", handed: true });
  const a = job("safe-send:a", "out-a");
  await jobs.start(a);
  for (let i = 0; i < 200 && movements.find((m) => m.id === a.id)!.status === "moving"; i++) await new Promise((r) => setTimeout(r, 2));
  assert.equal(movements.find((m) => m.id === a.id)!.status, "done");
  // what a resume in the gap saw: the job still saved and its Send still moving
  movements = [moving(a.id), ...movements.filter((m) => m.id !== a.id)];
  const before = read.length;
  jobs.follow(a);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(read.length, before, "no second follower: nothing read, nothing handed over, nothing written over");
  jobs.follow(job("safe-send:b", "out-b"));
  for (let i = 0; i < 200 && !read.includes("out-b"); i++) await new Promise((r) => setTimeout(r, 2));
  assert.ok(read.includes("out-b"), "control: another Send is followed");
});

test("E4: a restart follows the saved job again: leg 2 handed over once leg 1 lands, never twice (control: the run that saved it stops when it ends)", async () => {
  const first = setup({ leg1Status: ["PENDING_DEPOSIT"] });
  const r = await one(first.ledger);
  assert.ok("ok" in r);
  assert.ok(JSON.parse(first.core.store.get("send-jobs")!)[r.ok.id], "the job is kept on this device");
  // the same device, a fresh ledger (an app restart) that sees leg 1 land
  const after = setup({ core: first.core, leg1Status: ["SUCCESS"] });
  const m = await wait(after.ledger, r.ok.id);
  assert.equal(m.status, "done");
  assert.equal(after.submitted.length, 1, "handed over by the restarted run");
  assert.deepEqual(first.submitted, [], "and never by the first run");
  // a third start finds it ended: nothing handed over again
  const third = setup({ core: first.core, leg1Status: ["SUCCESS"] });
  await third.ledger.call("ledger.activity", { caller: "wallet" });
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(third.submitted, []);
});

test("E4: a held leg 1 (the Safe's safety wait) keeps the job: waiting until the hold runs, then leg 2 once leg 1 lands", async () => {
  const s = setup({ sign: "waiting" });
  const r = await one(s.ledger);
  assert.ok("ok" in r);
  assert.equal(r.ok.status, "waiting");
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(s.submitted, [], "nothing while held");
  s.core.emit("account.waiting.ended", { id: r.ok.held!.id, ended: "ran", txHash: "tx-held", explorerUrl: "https://nearblocks.io/txns/tx-held" });
  assert.equal((await wait(s.ledger, r.ok.id)).status, "done");
  assert.equal(s.submitted.length, 1);
  // a hold cancelled on the account: the job ends with it, nothing paid
  const c = setup({ sign: "waiting" });
  const cr = await one(c.ledger);
  assert.ok("ok" in cr);
  c.core.emit("account.waiting.ended", { id: cr.ok.held!.id, ended: "cancelled" });
  assert.equal((await wait(c.ledger, cr.ok.id)).problem?.code, "ledger.hold.cancelled");
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(c.submitted, []);
});

test("E4 is closed in the real core today (route B off): refused plainly, nothing asked; SAFE_SEND_OPEN says so for the screens", async () => {
  const closed = setup({ routeOpen: false });
  const r = await closed.ledger.call("ledger.sendFromSafe", safeAsk);
  assert.ok("problem" in r && r.problem.code === "ledger.private.unavailable");
  assert.deepEqual([closed.core.privateIns.length, closed.core.privatePays.length, closed.core.signed.length], [0, 0, 0]);
  // route B for everyone stays shut; Send opens the Safe's part with its own fill (safe-fill.test.ts)
  assert.equal(CONVERT_ROUTES.nearOrigin, false);
  assert.equal(SAFE_SEND_OPEN, true, "the shipped build: the Safe's coins are offered in Send, through the fill");
  const other = setup();
  const p = await other.ledger.call("ledger.sendFromSafe", { ...safeAsk, caller: "pay" });
  assert.ok("problem" in p && p.problem.code === "ledger.caller.refused", "Wallet's own Send only");
});

test("security review H1: the pocket's share whose submit errors is 'It may have gone', never a Try again; its own status ends it (control: refunded is not paid)", async () => {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  let out = "PROCESSING";
  const s = setup({ core, routeOpen: false, submitThrows: true, outStatus: () => out });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount: "10" });
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "the old code threw 'didn't answer… Try again' here");
  const m = await wait(s.ledger, r.ok[0]!.id, (x) => !!x.problem);
  assert.deepEqual([m.status, m.problem?.whatHappened, m.problem?.next.kind], ["moving", "It may have gone. Activity will say.", "wait"]);
  assert.equal(JSON.parse(s.core.store.get("send-jobs")!)[m.id].handed, true, "marked handed over before the submit");
  out = "SUCCESS";
  assert.equal((await wait(s.ledger, m.id)).status, "done", "1Click's own status of the payment ends it: paid");
  const core2 = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  const t = setup({ core: core2, routeOpen: false, submitThrows: true, outStatus: () => "REFUNDED" });
  const q = await t.ledger.call<Movement[]>("ledger.sendFromSafe", { ...safeAsk, amount: "10" });
  assert.ok("ok" in q);
  const n = await wait(t.ledger, q.ok[0]!.id);
  assert.deepEqual([n.status, n.problem?.whatHappened], ["problem", "It wasn't paid. The money came back to you."]);
});

test("security review M5 with audit H1: the pocket goes home to the Safe once it holds $100 or more and no Send needs it, at start and after a Send ends; under that it rests there, shown, for the next Send (control: never while a Send is open; $20 rests)", async () => {
  const until = async (ok: () => boolean) => { for (let i = 0; i < 400 && !ok(); i++) await new Promise((res) => setTimeout(res, 3)); };
  const pocketOf = (usdc: string) => [{ tokenId: USDC, amount: usdc }, { tokenId: "nep141:usdt.tether-token.near", amount: "500000" }];
  const withPocket = (usdc = "150000000") => fakeCore({ accountId: ME, pocket: pocketOf(usdc), subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
  // at start, nothing open: $150 of USDC goes home; the $0.50 of USDT stays (dust 1Click can't move)
  const a = setup({ core: withPocket() });
  await a.ledger.call("ledger.activity", { caller: "wallet" });
  await until(() => a.core.privateHomes.length > 0);
  assert.deepEqual(a.core.privateHomes.map((p) => [p.tokenId, p.amount]), [[USDC, "all"]]);
  // control (H1): $20 rests in the private balance, shown there, for the next Send
  const rest = setup({ core: withPocket("20000000") });
  await rest.ledger.call("ledger.activity", { caller: "wallet" });
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(rest.core.privateHomes, [], "under $100: it rests");
  // a Send still on its way: nothing moves (its leg 1 lands in the pocket); once it ends, the pocket goes home
  const b = setup({ core: withPocket(), leg1Status: [...Array(30).fill("PENDING_DEPOSIT"), "REFUNDED"] });
  const r = await b.ledger.call<Movement>("ledger.hiddenFromRow", { chain: "sol", to: { kind: "chain", chain: "sol", address: SOL_PAYEE }, amountIn: "0.5", caller: "wallet" });
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  await b.ledger.call("ledger.activity", { caller: "wallet" });
  await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(b.core.privateHomes, [], "control: never while a Send still needs the pocket");
  assert.equal((await wait(b.ledger, r.ok.id)).problem?.code, "ledger.send.back");
  await until(() => b.core.privateHomes.length > 0);
  assert.deepEqual(b.core.privateHomes.map((p) => p.tokenId), [USDC], "after it ended: home to the Safe");
});

test("a Send's endings have codes of their own, each in errors.md: none is another problem's, so \"nothing was paid\" never reads as Activity's Unconfirmed (control: the code M2's ending first took is one)", () => {
  const ends = [sendWords.unknown(), sendWords.back("SOL"), sendWords.short("SOL"), sendWords.slow("SOL"), sendWords.unread("SOL"), sendWords.notPaid()].map((p) => p.code);
  const others = [...readFileSync(new URL("./wallet-problems.ts", import.meta.url), "utf8").matchAll(/code: "([a-z.-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ends.filter((c) => others.includes(c)), []);
  assert.equal(new Set(ends).size, ends.length);
  const doc = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
  for (const c of ends) assert.ok(doc.includes(`| \`${c}\` |`), c);
  assert.ok(others.includes("ledger.send.unread"), "control: that code is the ledger's own NEAR transfer, Unconfirmed in Activity");
});

// ---- QA's real-test conditions on the Safe's USDC to a NEAR account (5 Nov)

const pocketUsdc = () => fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "20000000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });
const toBob = { tokenId: USDC, amount: "12.5", to: { kind: "chain", chain: "near", address: "bob.near" }, toTokenId: USDC, caller: "wallet" };

test("(b) the Safe's USDC to a NEAR account that isn't set up for USDC is refused by name before any price or sheet (control: set up, it goes as USDC)", async () => {
  const s = setup({ core: pocketUsdc(), routeOpen: false, sameOut: true });
  const r = await s.ledger.call("ledger.sendFromSafe", toBob);
  assert.ok("problem" in r);
  assert.equal(r.problem.code, "ledger.send.payee-not-set-up");
  assert.equal(r.problem.whatHappened, "bob.near can't take USDC yet. Nothing left your Safe.");
  assert.deepEqual([s.asked.length, s.core.privatePays.length], [0, 0], "no price asked, no sheet");
  const ok = setup({ core: pocketUsdc(), routeOpen: false, sameOut: true, registered: ["bob.near"] });
  const g = await ok.ledger.call<Movement[]>("ledger.sendFromSafe", toBob);
  assert.ok("ok" in g, "problem" in g ? g.problem.code : "");
  assert.deepEqual([ok.asked.at(-1).destinationAsset, ok.asked.at(-1).recipient, ok.asked.at(-1).recipientType], [USDC, "bob.near", "DESTINATION_CHAIN"]);
});

test("(c) wNEAR to a NEAR account is as before: no set-up read stops it (control for (b): only a coin other than NEAR is read)", async () => {
  const s = setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: "nep141:wrap.near", amount: "5000000000000000000000000" }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] }), routeOpen: false });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", { tokenId: "nep141:wrap.near", amount: "1", to: { kind: "chain", chain: "near", address: "bob.near" }, caller: "wallet" });
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.equal(s.asked.at(-1).destinationAsset, LANDS_AS.near.tokenId);
});

test("(a) USDC to USDC pays exactly what was typed: a price that pays less is refused before the sheet (control: an exact price goes, 12.5 USDC out)", async () => {
  const short = setup({ core: pocketUsdc(), routeOpen: false, registered: ["bob.near"] });
  const r = await short.ledger.call("ledger.sendFromSafe", toBob);
  assert.ok("problem" in r);
  assert.equal(r.problem.code, "ledger.send.same-coin-short");
  assert.equal(short.core.privatePays.length, 0, "no sheet");
  const exact = setup({ core: pocketUsdc(), routeOpen: false, registered: ["bob.near"], sameOut: true });
  const g = await exact.ledger.call<Movement[]>("ledger.sendFromSafe", toBob);
  assert.ok("ok" in g, "problem" in g ? g.problem.code : "");
  assert.equal(exact.asked.at(-1).amount, "12500000");
  assert.equal(g.ok[0]!.amount, "12.5");
  // control: another coin out (SOL to a Solana address) is a swap, never held to the same figure
  const swap = setup({ core: pocketUsdc(), routeOpen: false });
  assert.ok("ok" in (await swap.ledger.call("ledger.sendFromSafe", { ...safeAsk, amount: "12.5" })));
});

// ---- Send from the Safe through the fill (product decision, 5 Nov: Send works for every coin, Safe money included; every
// money move through NEAR Confidential). Route B for everyone stays shut: Send's own `fill` opens it for this call.

const fillAsk = { ...safeAsk, fill: true };
const pocketCore = (amount: string) => fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount }], subwallets: [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }] });

test("Send fill, MUST 1 (bind before you sign): the payout's quote is got and the pocket's payment joined to the move in FIRST, then the Safe's ONE sheet carries the sendFill marker (the core says the bound payout there); the pocket then pays exactly that quote's address (controls: no `fill`, refused before anything; Private covers it: Private pays, no Safe sheet)", async () => {
  const s = setup({ routeOpen: false });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in r, "problem" in r ? r.problem.code : "");
  assert.equal(r.ok.length, 1);
  assert.match(r.ok[0]!.id, /^safe-send:/);
  assert.ok(s.order.indexOf("subwallet.privatePay") < s.order.indexOf("tx.request"), `the payout bound before the Safe signs: ${s.order.join(",")}`);
  assert.equal(s.core.privatePays.length, 1);
  assert.deepEqual([s.core.privatePays[0]!.inDeposit, s.core.privatePays[0]!.depositAddress], [QUOTE_ADDRESS, OUT], "the pocket's payment is joined to this move in, to the payout quote's own address");
  assert.equal(s.core.signed.length, 1, "one Safe sheet");
  const req = s.core.signed[0]! as { sendFill?: true; moveFill?: true };
  assert.deepEqual([req.sendFill, req.moveFill], [true, undefined], "the Send's marker, never the Move's");
  assert.equal((await wait(s.ledger, r.ok[0]!.id)).status, "done");
  assert.equal(s.submitted.length, 1, "the bound payment handed over once, after the fill landed");
  // controls
  const closed = setup({ routeOpen: false });
  const c = await closed.ledger.call("ledger.sendFromSafe", safeAsk);
  assert.ok("problem" in c && c.problem.code === "ledger.private.unavailable", "no fill: refused");
  assert.deepEqual([closed.core.privatePays.length, closed.core.signed.length], [0, 0], "nothing signed");
  const covered = setup({ routeOpen: false, core: pocketCore("300000000") });
  const p = await covered.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in p);
  assert.deepEqual([p.ok.map((m) => m.id.split(":")[0]), covered.core.signed.length, covered.core.privatePays[0]!.send], [["pocket-send"], 0, true], "Private covers it: Private pays (its own outside sheet), no fill");
});

test("Send fill, MUST 2: the fill is a whole step over the Send, the extra kept in Private under the $500 buffer (control: Private's share plus the step's extra over $500, the fill is exactly the Send)", async () => {
  const s = setup({ routeOpen: false });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in r);
  assert.equal(s.core.privateIns[0]!.amount, "300000000", "$250 fills a $300 step");
  assert.equal(r.ok[0]!.kept, "50", "the $50 extra stays in Private, said on the row");
  const step = setup({ routeOpen: false, safeUnits: "2000000000" });
  const a = await step.ledger.call<Movement[]>("ledger.sendFromSafe", { ...fillAsk, amount: "490" });
  assert.ok("ok" in a);
  assert.deepEqual([step.core.privateIns[0]!.amount, a.ok[0]!.kept], ["600000000", "110"], "control: an empty Private takes the $600 step");
  const full = setup({ routeOpen: false, safeUnits: "2000000000", core: pocketCore("450000000") });
  const b = await full.ledger.call<Movement[]>("ledger.sendFromSafe", { ...fillAsk, amount: "490" });
  assert.ok("ok" in b, "problem" in b ? b.problem.code : "");
  assert.deepEqual([full.core.privateIns[0]!.amount, b.ok[0]!.kept], ["490000000", undefined], "$450 in Private + $110 extra would pass $500: the fill is the Send's own amount, nothing kept");
});

test("Send fill, MUST 2: the Safe's sheet is the band's (the contract counts the fill): over the band it waits and nothing is handed over (control: under it, Face ID and on its way)", async () => {
  const held = setup({ routeOpen: false, sign: "waiting" });
  const r = await held.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in r);
  assert.deepEqual([r.ok[0]!.status, Boolean(r.ok[0]!.held)], ["waiting", true]);
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(held.submitted, [], "the payout waits with the fill");
  const now = setup({ routeOpen: false });
  const n = await now.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in n);
  assert.equal(n.ok[0]!.status, "moving");
});

test("Send fill, MUST 3: a payout that fails after the fill says the money is in Private, by name (rule 8), never 'nothing moved' (control: a payout that goes is done)", async () => {
  const s = setup({ routeOpen: false, leg1Status: ["SUCCESS"], outStatus: () => "REFUNDED" });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in r);
  const m = await wait(s.ledger, r.ok[0]!.id);
  // the copy review's words: the figure, never "your <coin>"
  assert.deepEqual([m.status, m.problem?.whatHappened, m.problem?.money.where], ["problem", "It wasn't paid. The $250.00 is back in Private.", "in Private"]);
  assert.doesNotMatch(JSON.stringify(m.problem), /[Nn]othing (moved|was paid)/);
  const ok = setup({ routeOpen: false, leg1Status: ["SUCCESS"] });
  const o = await ok.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in o);
  assert.equal((await wait(ok.ledger, o.ok[0]!.id)).status, "done");
});

test("Send fill, MUST 4 (one job): Private short, ONE movement, ONE saved job, ONE payout, ONE Safe sheet; Private's own share stays put, never a second payout with its own Face ID (control: Private covering it is MUST 1's own test: Private pays alone)", async () => {
  const s = setup({ routeOpen: false, core: pocketCore("100000000") });
  const r = await s.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in r);
  assert.equal(r.ok.length, 1, "one movement");
  assert.equal(Object.keys(JSON.parse(s.core.store.get("send-jobs") ?? "{}")).length, 1, "one saved job");
  assert.deepEqual([s.core.privatePays.length, s.core.privatePays[0]!.send, s.core.signed.length], [1, undefined, 1], "one payout (joined), one Safe sheet");
  assert.equal(s.core.privateIns[0]!.amount, "300000000", "the Safe pays the whole $250 Send through Private");
});

test("QA's add (5 Nov): Private's payment signed before a fill that failed is thrown away and never handed over, not in this run and not after a reload (fill came back; the Safe's sheet refused) (control: a fill that lands hands it over once)", async () => {
  const settle = () => new Promise((res) => setTimeout(res, 40));
  // the fill came back: the job ends, its signed payment with it
  const back = setup({ routeOpen: false, leg1Status: ["REFUNDED"] });
  const r = await back.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in r);
  assert.equal((await wait(back.ledger, r.ok[0]!.id)).problem?.code, "ledger.send.back");
  assert.equal(back.core.store.get("send-jobs") ?? "{}", "{}", "the job and its signature are gone");
  const reloaded = back.make();
  await reloaded.call("ledger.activity", { caller: "wallet" });
  await settle();
  assert.deepEqual(back.submitted, [], "never handed over, after a reload too");
  // the Safe's sheet refused (a No): the job is never kept, so a reload has nothing to send
  const no = setup({ routeOpen: false, sign: "declined" });
  const n = await no.ledger.call("ledger.sendFromSafe", fillAsk);
  assert.ok("problem" in n);
  assert.equal(no.core.store.get("send-jobs") ?? "{}", "{}");
  await no.make().call("ledger.activity", { caller: "wallet" });
  await settle();
  assert.deepEqual(no.submitted, [], "never handed over, after a reload too");
  // control
  const ok = setup({ routeOpen: false, leg1Status: ["SUCCESS"] });
  const o = await ok.ledger.call<Movement[]>("ledger.sendFromSafe", fillAsk);
  assert.ok("ok" in o);
  assert.equal((await wait(ok.ledger, o.ok[0]!.id)).status, "done");
  assert.equal(ok.submitted.length, 1);
});
