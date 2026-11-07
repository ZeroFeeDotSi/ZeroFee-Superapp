// Private (D27): money moves from the main account into Security's capped pocket through a confidential 1Click quote,
// quoted through the quote server (it holds the partner key, which never lives in the app). The move in is visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { readFileSync } from "node:fs";
import { GENERATED, QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Movement, PrivatePocket, Quote } from "./types.ts";

const ME = "kid.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL = "nep141:sol.omft.near";
const POCKET = "a1".repeat(32);
/** The relay's base (apps/quotes), as the shell gives it; its 1Click calls go to <base>/v0. */
const RELAY = "https://quotes.example";
const SERVER = `${RELAY}/v0`;

function setup(o: { routeOpen?: boolean; pocket?: boolean; server?: boolean; usdc?: string; privatePay?: "sign" | "decline"; kid?: boolean; held?: { tokenId: string; amount: string }[]; pocketMove?: "pending" | "done" | "failed" | "refunded" } = {}) {
  const core = fakeCore({ accountId: ME, kid: o.kid, privatePay: o.privatePay, pocket: o.held, pocketMove: o.pocketMove, subwallets: o.pocket === false ? [] : [{ kind: "private", id: "sw-private", address: POCKET } as { kind: string; address: string }, { kind: "trade", address: "trade-wallet" }] });
  const fetch = replayFetch({ privateQuotes: SERVER });
  const ledger = createLedgerService({
    bridge: core,
    chain: fakeNear(ME, { ledger: { [USDC]: o.usdc ?? "500000000", [SOL]: "5000000000" } }),
    apis: createApis(fetch),
    routes: { intents: false, nearOrigin: o.routeOpen !== false },
    trackMs: 5,
    readCall: async () => ({ kind: "ran" }),
    ...(o.server === false ? {} : { privateQuotes: RELAY }),
  });
  return { core, fetch, ledger };
}
const ok = async <T>(ledger: Bridge, method: string, params?: Record<string, unknown>): Promise<T> => {
  const r = await ledger.call<T>(method, params);
  if ("problem" in r) assert.fail(`${method} gave ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const problem = async (ledger: Bridge, method: string, params?: Record<string, unknown>) => {
  const r = await ledger.call(method, params);
  assert.ok("problem" in r, `${method} should be refused`);
  return r.problem.code;
};

test("a quote into Private is confidential, through the quote server, to the pocket, with refunds to the pocket", async () => {
  const { ledger, fetch } = setup();
  const q = await ok<Quote>(ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "50" });
  assert.deepEqual([q.from, q.to, q.amountIn, q.amountOut, q.minOut], [USDC, "private", "50", "50", "49.5"], "as 1Click quoted the same move: no fee, 1% slippage");
  const sent = fetch.calls.find((c) => c.url === `${SERVER}/quote`)!;
  assert.ok(sent, "asked the quote server, never 1Click directly");
  assert.ok(!fetch.calls.some((c) => c.url.endsWith("1click.chaindefuser.com/v0/quote")));
  assert.deepEqual(
    { ...sent.body, deadline: undefined },
    { dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC, depositType: "ORIGIN_CHAIN", destinationAsset: USDC, amount: "50000000", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", deadline: undefined, confidentiality: "basic" },
  );
  assert.ok(!JSON.stringify(sent.body).includes(ME), "the quote server never sees the main account's name");
});

test("the move in is paid on NEAR from the ledger (one ft_withdraw to 1Click's address), and followed through the quote server", async () => {
  const { ledger, core, fetch } = setup();
  const q = await ok<Quote>(ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "50" });
  const done = new Promise<Movement>((resolve) => ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => movement.status === "done" && resolve(movement)));
  const m = await ok<Movement>(ledger, "ledger.toPrivate", { quoteId: q.id });
  assert.deepEqual([m.kind, m.from, m.to, m.amount, m.status], ["private", USDC, "private", "50", "moving"]);
  const last = core.signed.at(-1)!;
  const a = last.actions[0] as { method: string; args: Record<string, unknown> };
  assert.deepEqual([last.receiverId, a.method, a.args.receiver_id, a.args.amount, last.why], ["intents.near", "ft_withdraw", QUOTE_ADDRESS, "50000000", "Move 50 USDC to Private"]);
  // The real quote is the core's own (subwallet.private.quoteIn), so the main sheet reads it as 1Click signed it; Wallet
  // asks the quote server only for the dry one it shows.
  assert.deepEqual(core.privateIns.map((p) => [p.tokenId, p.amount]), [[USDC, "50000000"]]);
  assert.ok(!fetch.calls.some((c) => c.url === `${SERVER}/quote` && (c.body as { dry?: unknown })?.dry === false), "Wallet never asks for the real quote itself");
  assert.equal((await done).kind, "private");
  assert.ok(!fetch.calls.some((c) => c.url.endsWith("/deposit/submit")), "P-4: no dead deposit notice through the quote server (1Click finds the deposit itself)");
  assert.ok(fetch.calls.some((c) => c.url.startsWith(`${SERVER}/status`)), "so does its status");
  assert.equal((await problem(ledger, "ledger.toPrivate", { quoteId: q.id })), "ledger.quote.expired", "a quote is used once");
});

test("Private refuses plainly: no pocket, no quote server, a coin not native to NEAR, more than $10,000 (D132), another app", async () => {
  assert.equal(await problem(setup({ pocket: false }).ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "5" }), "ledger.private.unavailable");
  assert.equal(await problem(setup({ server: false }).ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "5" }), "ledger.private.unavailable");
  assert.equal(await problem(setup({ server: false }).ledger, "ledger.privateSetup"), "ledger.private.unavailable");
  const { ledger, core } = setup();
  assert.equal(await problem(ledger, "ledger.quoteToPrivate", { tokenId: SOL, amount: "0.1" }), "ledger.private.coin");
  assert.equal(await problem(ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "20000" }), "ledger.private.cap");
  const was = await ledger.call("ledger.quoteToPrivate", { tokenId: USDC, amount: "150" });
  assert.ok(!("problem" in was && was.problem.code === "ledger.private.cap"), "control: $150, over the old $100, is no cap now");
  assert.equal(await problem(ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "5", caller: "pay" }), "ledger.caller.refused", "only Wallet moves money into Private");
  assert.equal(await problem(setup({ usdc: "1000000" }).ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "5" }), "ledger.balance.low");
  assert.equal(core.signed.length, 0, "nothing was signed");
});

const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SOL_ADDR = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const payPrivately = { fromTokenId: USDC, toTokenId: SOL_USDC, to: { kind: "chain", chain: "sol", address: SOL_ADDR }, amountOut: "30", confidential: true, caller: "pay" };

test("paying from Private: a quote from the pocket through the quote server, then 1Click's transfer signed by the core and submitted", async () => {
  const { ledger, core, fetch } = setup();
  const q = await ok<{ id: string; amountIn: string; amountOut: string; refundTo: string }>(ledger, "ledger.quotePay", payPrivately);
  assert.deepEqual([q.amountOut, q.amountIn, q.refundTo], ["30", "30.09", POCKET]);
  const asked = fetch.calls.find((c) => c.url === `${SERVER}/quote`)!.body;
  assert.deepEqual([asked.swapType, asked.depositType, asked.refundType, asked.refundTo, asked.recipient, asked.recipientType, asked.confidentiality, asked.amount], ["EXACT_OUTPUT", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", POCKET, SOL_ADDR, "DESTINATION_CHAIN", "basic", "30000000"]);
  assert.ok(!JSON.stringify(asked).includes(ME), "the quote server never sees the main account's name");

  const done = new Promise<Movement>((resolve) => ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => movement.status === "done" && resolve(movement)));
  const m = await ok<Movement>(ledger, "ledger.pay", { quoteId: q.id, label: "Dinner with Kim", caller: "pay" });
  const gen = fetch.calls.find((c) => c.url === `${SERVER}/generate-intent`)!.body;
  assert.deepEqual(gen, { type: "swap_transfer", standard: "nep413", signerId: POCKET, depositAddress: GENERATED.quote.depositAddress });
  // H4 (audit 3 Nov): and the person's own payee, coin and amount, so the core signs only a quote that pays exactly them
  const payee = { recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", minAmountOut: "30000000" };
  assert.deepEqual(core.privatePays, [{ id: "sw-private", depositAddress: GENERATED.quote.depositAddress, intent: { payload: GENERATED.generateIntent.response.intent.payload }, why: "Dinner with Kim", statusTag: "tag-for-the-core", payee }], "the core gets 1Click's transfer verbatim, Pay's words as Pay's, and the quote's status tag");
  const sub = fetch.calls.find((c) => c.url === `${SERVER}/submit-intent`)!.body;
  assert.deepEqual([sub.type, sub.signedData.standard, sub.signedData.payload], ["swap_transfer", "nep413", GENERATED.generateIntent.response.intent.payload]);
  assert.deepEqual([m.kind, m.private, m.status, m.amount, m.from, m.label, m.caller], ["pay", true, "moving", "30.09", USDC, "Dinner with Kim", "pay"]);
  assert.equal(core.signed.length, 0, "nothing is signed by the main account");
  assert.equal((await done).id, m.id, "followed until 1Click says it's done");
  assert.ok(fetch.calls.some((c) => c.url.startsWith(`${SERVER}/status`)), "its status, through the quote server");
});

test("paying from Private: a no on the core's sheet sends nothing; no pocket is refused plainly; never sent in public", async () => {
  const declined = setup({ privatePay: "decline" });
  const q = await ok<{ id: string }>(declined.ledger, "ledger.quotePay", payPrivately);
  assert.equal(await problem(declined.ledger, "ledger.pay", { quoteId: q.id, caller: "pay" }), "ledger.signature.declined");
  assert.ok(!declined.fetch.calls.some((c) => c.url === `${SERVER}/submit-intent`), "nothing submitted");
  assert.equal(await problem(setup({ pocket: false }).ledger, "ledger.quotePay", payPrivately), "ledger.private.unavailable");
  assert.equal(await problem(setup({ server: false }).ledger, "ledger.quotePay", payPrivately), "ledger.private.unavailable");
  assert.equal(await problem(setup().ledger, "ledger.quotePay", { ...payPrivately, to: { kind: "chain", chain: "sol", address: "not-an-address" } }), "ledger.address.invalid");
  const { ledger, core } = setup();
  for (const method of ["ledger.transfer", "ledger.quoteConvert", "ledger.convert"]) {
    assert.equal(await problem(ledger, method, { confidential: true, caller: "pay" }), "ledger.private.unavailable", `${method} can't pay from Private yet`);
  }
  assert.equal(core.signed.length + core.privatePays.length, 0);
});

test("Private shows what the core reads in the pocket; with no quote server it isn't shown at all (D13)", async () => {
  assert.deepEqual(await ok<PrivatePocket>(setup({ server: false }).ledger, "ledger.private"), { available: false, ready: false, rows: [], defaultOn: false });
  assert.deepEqual(await ok<PrivatePocket>(setup({ pocket: false }).ledger, "ledger.private"), { available: true, ready: false, rows: [], defaultOn: false, canAdd: true, fillOpen: SAFE_FILL_OPEN });
  const p = await ok<PrivatePocket>(setup({ held: [{ tokenId: USDC, amount: "12500000" }] }).ledger, "ledger.private");
  assert.deepEqual([p.available, p.ready, p.rows.map((r) => [r.tokenId, r.amount, r.held])], [true, true, [[USDC, "12.5", "private"]]]);
});

test("out of Private: every coin in the pocket goes home to the main balance through the core, and Activity follows each", async () => {
  const { ledger, core } = setup({ held: [{ tokenId: USDC, amount: "12500000" }, { tokenId: SOL, amount: "0" }] });
  const moved = await ok<Movement[]>(ledger, "ledger.fromPrivate");
  assert.deepEqual(core.privateHomes.map((h) => [h.tokenId, h.amount]), [[USDC, "all"]], "only coins it holds, all of each");
  assert.match(String(core.privateHomes[0]!.key), /^[A-Za-z0-9_-]{8,80}$/);
  assert.deepEqual(moved.map((m) => [m.kind, m.from, m.to, m.amount, m.status]), [["private", "private", USDC, "12.5", "moving"]]);
  const before = await ok<Movement[]>(ledger, "ledger.activity");
  assert.equal(before.find((m) => m.id === moved[0]!.id)!.status, "moving");
  const done = setup({ held: [{ tokenId: USDC, amount: "1000000" }], pocketMove: "done" });
  const m = (await ok<Movement[]>(done.ledger, "ledger.fromPrivate"))[0]!;
  assert.equal((await ok<Movement[]>(done.ledger, "ledger.activity")).find((x) => x.id === m.id)!.status, "done", "read from the core's own record");
  assert.equal(await problem(setup({ pocket: false }).ledger, "ledger.fromPrivate"), "ledger.private.unavailable");
  assert.equal(await problem(setup({ kid: true }).ledger, "ledger.fromPrivate"), "ledger.private.child");
  assert.equal(await problem(ledger, "ledger.fromPrivate", { caller: "pay" }), "ledger.caller.refused");
});

test("the audit's SHOULD (8 Nov): Private grows between the sheet and Approve (a refund, a fill): the core moves at most what the sheet showed (upTo), never \"all\"; a coin it didn't show stays [before: upTo ignored, \"all\" of each]", async () => {
  // the sheet showed 12.5 USDC; by Approve Private holds 20 USDC and 3 SOL
  const { ledger, core } = setup({ held: [{ tokenId: USDC, amount: "20000000" }, { tokenId: SOL, amount: "3000000000" }] });
  const moved = await ok<Movement[]>(ledger, "ledger.fromPrivate", { upTo: { [USDC]: "12.5" } });
  assert.deepEqual(core.privateHomes.map((h) => [h.tokenId, h.amount]), [[USDC, "12500000"]], "at most the shown 12.5 USDC; the SOL that wasn't shown stays");
  assert.deepEqual(moved.map((m) => [m.to, m.amount]), [[USDC, "12.5"]], "Activity says what moved");
  // shrank instead (a payment went first): what it holds, never more
  const less = setup({ held: [{ tokenId: USDC, amount: "10000000" }] });
  await ok<Movement[]>(less.ledger, "ledger.fromPrivate", { upTo: { [USDC]: "12.5" } });
  assert.deepEqual(less.core.privateHomes.map((h) => h.amount), ["10000000"]);
  // a cap that isn't an amount is refused before anything moves
  const bad = setup({ held: [{ tokenId: USDC, amount: "10000000" }] });
  assert.equal(await problem(bad.ledger, "ledger.fromPrivate", { upTo: { [USDC]: "-1" } }), "ledger.amount.invalid");
  assert.equal(await problem(bad.ledger, "ledger.fromPrivate", { upTo: "all" }), "ledger.amount.invalid");
  assert.equal(bad.core.privateHomes.length, 0);
  // control: no upTo (no sheet's figures) is all of each coin, as before
  const all = setup({ held: [{ tokenId: USDC, amount: "20000000" }] });
  await ok<Movement[]>(all.ledger, "ledger.fromPrivate");
  assert.deepEqual(all.core.privateHomes.map((h) => h.amount), ["all"]);
});

test("1Click's real answers to a basic quote, recorded through the partner key (25 Oct), read through the quote server", async () => {
  const recorded = JSON.parse(readFileSync(new URL("./testing/fixtures/oneclick-private-quotes.json", import.meta.url), "utf8"));
  const add = recorded.results.addToPrivate;
  assert.deepEqual([add.request.refundType, add.request.recipientType, add.amountOut], ["CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", add.request.amount], "Add to Private's own shape, quoted with no fee");
  for (const r of Object.values<any>(recorded.results)) {
    assert.deepEqual([r.status, r.confidentiality], [201, "basic"]);
    const asked: string[] = [];
    const request = { ...recorded.request, ...r.request, recipient: "intents.near", deadline: new Date().toISOString() };
    const apis = createApis((async (url: string) => (asked.push(url), new Response(JSON.stringify({ quote: { amountIn: request.amount, amountOut: r.amountOut, minAmountOut: r.minAmountOut, timeEstimate: r.timeEstimate }, quoteRequest: { confidentiality: r.confidentiality } }), { status: r.status }))) as typeof fetch);
    const q = await apis.quote(request, SERVER);
    assert.deepEqual([asked, q.quote.amountOut, q.quote.minAmountOut], [[`${SERVER}/quote`], r.amountOut, r.minAmountOut]);
  }
});

test("the Private default is the person's one choice, kept on this phone, read by every app, changed only by Wallet", async () => {
  const { ledger, core } = setup();
  assert.equal((await ok<PrivatePocket>(ledger, "ledger.privateDefault", { on: true })).defaultOn, true);
  assert.equal(core.store.get("private-default"), "on");
  assert.equal((await ok<PrivatePocket>(ledger, "ledger.private", { caller: "pay" })).defaultOn, true, "Pay presets its switch from it");
  assert.equal(await problem(ledger, "ledger.privateDefault", { on: false, caller: "pay" }), "ledger.caller.refused");
  assert.equal((await ok<PrivatePocket>(ledger, "ledger.privateDefault", { on: false })).defaultOn, false);
});

test("a child's account has no Private: setting it up, a quote into it and the move in are each refused, nothing signed (D30)", async () => {
  const { ledger, core } = setup({ kid: true });
  assert.equal(await problem(ledger, "ledger.privateSetup"), "ledger.private.child");
  assert.equal(await problem(ledger, "ledger.quoteToPrivate", { tokenId: USDC, amount: "5" }), "ledger.private.child");
  assert.equal(await problem(ledger, "ledger.toPrivate", { quoteId: "pq-any" }), "ledger.private.child");
  assert.equal(core.signed.length, 0);
});

test("O-2b review H1: ledger.private says whether a move into Hidden can be priced here (canAdd), the route the quote itself needs", async () => {
  const open = setup();
  assert.equal((await ok<{ canAdd?: boolean }>(open.ledger, "ledger.private")).canAdd, true);
  assert.equal((await ok<{ canAdd?: boolean }>(setup({ pocket: false }).ledger, "ledger.private")).canAdd, true, "before the pocket too");
  // Closed (the shipped build's CONVERT_ROUTES): canAdd false, and the quote is refused, so nothing may offer a move.
  const closed = setup({ routeOpen: false });
  assert.equal((await ok<{ canAdd?: boolean; available: boolean }>(closed.ledger, "ledger.private")).canAdd, false);
  assert.ok("problem" in (await closed.ledger.call("ledger.quoteToPrivate", { tokenId: USDC, amount: "5" })), "control: the quote is refused when canAdd is false");
});

test("the audit's check (8 Nov): upTo with no decimals reader reads decimals 0, so a figure with cents (\"33.86\") is refused (ledger.amount.invalid), never rounded to 33; nothing asked of the core", async () => {
  const { fromPrivate } = await import("./private-pay.ts");
  const homes: string[] = [];
  const x = { rows: [{ tokenId: USDC, amount: "40" }], home: async (_t: string, _k: string, amount: string) => { homes.push(amount); return { ok: { id: "pm-1", status: "pending" } }; }, status: () => "moving" as const, remember: async () => {}, emit: () => {}, iso: () => "2026-11-08T00:00:00.000Z" };
  await assert.rejects(fromPrivate({ upTo: { [USDC]: "33.86" } }, "wallet", x), (e: { problem?: { code?: string } }) => e.problem?.code === "ledger.amount.invalid");
  assert.deepEqual(homes, [], "refused before the core is asked");
  // control: a whole figure at decimals 0 is that many units, the least of it and what is held
  await fromPrivate({ upTo: { [USDC]: "33" } }, "wallet", x);
  assert.deepEqual(homes, ["33"]);
});
