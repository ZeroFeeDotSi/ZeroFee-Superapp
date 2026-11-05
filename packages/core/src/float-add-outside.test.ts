// Home's Add and Request from another chain (E1, E2; add-outside.ts, float-add.ts addOutside): a one-time confidential
// 1Click address on the coin's own chain whose recipient and refund are the float, then the float's own move on to the
// chain's wallet (E1) or home to the Safe (E2), as one saved job. Every check has a control that passes the same path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ADD_LEAST_USD, ADD_OPEN, ADD_SHOWN_MS, ADD_USED, type AddChain } from "./add-outside.ts";
import { FloatGuard } from "./float.ts";
import { CHAIN_COIN, EMPTY_RECONCILE_MS, FLOAT_USDC, FloatMoves, RECONCILE_MS, type FloatMoveDeps, type FloatRelay } from "./float-moves.ts";
import { ADD_FORWARD_GAP_MS, ADD_PUSH_FAST_MS, PART_MOST_USD, planParts } from "./float-add.ts";
import { base64 } from "./sol/bytes.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const FLOAT_SECRET = new Uint8Array(32).fill(3);
const FLOAT = Array.from(ed25519.getPublicKey(FLOAT_SECRET), (b) => b.toString(16).padStart(2, "0")).join("");
const SOL_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const EVM_WALLET = "0x1111111111111111111111111111111111111111";
const MAIN = "kim.near";
const SOL = "nep141:sol.omft.near";
const HOOD = "nep141:hood.omft.near";
// base58 Solana-shaped deposit addresses, one per quote
const SOL_DEPOSITS = ["5SbU76n3zBhLtzfyMyTQaN3vcpNrRmo6HW4cWKEY1qfn", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH", "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9"];  // generated sample
const key = (n: number) => `add-sheet-key-${String(n).padStart(6, "0")}`;

/** ZeroFee's relay in front of 1Click, as an honest one answers (FLEX_INPUT: 1Click signs 3 days past the ask): `lie`
 *  changes the signed quote's request; `deposit` picks the address; `minIn` the least it takes. */
function relay(o: { lie?: (req: any) => any; deposit?: (req: any, n: number) => string; minOut?: (req: any) => string; minIn?: (req: any) => string | undefined; cap?: number } = {}) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; deadline: string }>();
  const state = new Map<string, { status: string; details?: unknown }>();
  let n = 0;
  const r: FloatRelay = {
    quote: async (req) => {
      // the relay's one-quote limit (relay.mjs POCKET_USD), at $150 a SOL: refused, and nothing asked of 1Click
      if (o.cap !== undefined && req.originAsset === SOL && (Number(req.amount) / 1e9) * 150 > o.cap) throw Object.assign(new Error("over the limit"), { refused: true });
      asked.push(req);
      const origin = req.depositType === "ORIGIN_CHAIN";
      const nearOrigin = origin && req.originAsset === "nep141:wrap.near";
      const depositAddress = o.deposit?.(req, n) ?? (origin && !nearOrigin ? (req.originAsset === SOL ? SOL_DEPOSITS[n % SOL_DEPOSITS.length]! : `0x${String(n + 1).padStart(40, "a")}`) : (n + 1).toString(16).padStart(64, "d"));
      n++;
      const deadline = new Date(Date.parse(req.deadline) + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.lie ? o.lie(q.req) : q.req;
      const minAmountOut = o.minOut?.(req) ?? String((BigInt(req.amount) * 99n) / 100n);
      const minAmountIn = o.minIn ? o.minIn(req) : String((BigInt(req.amount) * 99n) / 100n);
      const quoteResponse = signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: req.amount, ...(minAmountIn ? { minAmountIn } : {}), minAmountOut, amountOut: req.amount, deadline: q.deadline, timeEstimate: 20 } });
      const s = state.get(depositAddress);
      return { status: s?.status ?? "PENDING_DEPOSIT", quoteResponse, ...(s?.details ? { swapDetails: s.details } : {}) };
    },
  };
  const set = (dep: string, status: string, details?: unknown) => state.set(dep, { status, ...(details ? { details } : {}) });
  /** Every move out of the float (a confidential deposit) 1Click has settled (`details`: its swapDetails). */
  const settleOut = (details?: unknown) => { for (const [dep, q] of quotes) if (q.req.depositType === "CONFIDENTIAL_INTENTS") set(dep, "SUCCESS", details); };
  return { r, asked, submitted, set, settleOut };
}

function setup(o: Parameters<typeof relay>[0] = {}, opts: { vault?: MemoryVault; fake?: ReturnType<typeof relay>; open?: Partial<Record<AddChain, boolean>>; held?: { tokenId: string; amount: string }[]; clock?: { t: number }; oldWords?: boolean } = {}) {
  const vault = opts.vault ?? new MemoryVault();
  const fake = opts.fake ?? relay(o);
  const clock = opts.clock ?? { t: Date.now() };
  const held = opts.held ?? [];
  const deps: FloatMoveDeps = {
    vault, guard: new FloatGuard(vault, () => clock.t), relay: fake.r, now: () => clock.t, quoteKey: TEST_QUOTE_KEY,
    usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600),
    tokenPrice: async () => ({ usd: 4, decimals: 24, symbol: "wNEAR" }),
    float: async () => ({ address: FLOAT, secret: async () => FLOAT_SECRET }),
    wallet: async (chain) => ({ id: `trade-${chain}-abc123`, address: chain === "sol" ? SOL_WALLET : EVM_WALLET, ...(opts.oldWords ? { oldWords: true } : {}) }),
    mainAccount: async () => MAIN,
    spendable: async () => 0n,
    pay: async () => null,
    approve: async () => false,
    confidentialBalances: async () => held,
    ...(opts.open ? { addOpen: (c: AddChain) => opts.open![c] ?? ADD_OPEN[c] } : {}),
  };
  return { f: new FloatMoves(deps), vault, clock, held, ...fake };
}

test("E1: the core asks 1Click for a one-time address on SOL's own chain, the same coin into the float, refunds to the float, FLEX_INPUT; read back and checked", async () => {
  const { f, asked } = setup();
  const a = await f.addOutside("sol", "wallet", key(1));
  const req = asked[0];
  assert.deepEqual(
    [req.originAsset, req.depositType, req.destinationAsset, req.swapType, req.recipient, req.recipientType, req.refundTo, req.refundType, req.confidentiality, req.dry],
    [SOL, "ORIGIN_CHAIN", SOL, "FLEX_INPUT", FLOAT, "CONFIDENTIAL_INTENTS", FLOAT, "CONFIDENTIAL_INTENTS", "basic", false],
  );
  // sized for ADD_LEAST_USD at the core's own $150: 0.02 SOL, rounded up at 8 places
  assert.equal(req.amount, "20000000");
  assert.equal(a.depositAddress, SOL_DEPOSITS[0]);
  assert.deepEqual([a.chain, a.to, a.symbol, a.decimals, a.amountIn, a.minAmountIn], ["sol", "wallet", "SOL", 9, "20000000", "19800000"]);
  // our own ask ends within the day 1Click's +3 days is still under the 4 days a quote may be believed for
  assert.ok(Date.parse(req.deadline) - Date.now() < ADD_SHOWN_MS);
  assert.ok(Date.parse(a.untilIso) <= Date.now() + ADD_SHOWN_MS + 1000, "the sheet shows it for a day at most");
  assert.equal(a.etaSeconds, 20);
  // ETH (RH) too: its own coin, an EVM address
  const h = await f.addOutside("hood", "wallet", key(2));
  assert.match(h.depositAddress, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(asked[1].originAsset, HOOD);
});

test("E1: a quote whose recipient isn't the float (or another refund, coin, kind, amount or price) is refused and never shown; the honest one passes", async () => {
  const cases: [string, Parameters<typeof relay>[0]][] = [
    ["another recipient", { lie: (q) => ({ ...q, recipient: "e".repeat(64) }) }],
    ["paid out on a chain", { lie: (q) => ({ ...q, recipientType: "DESTINATION_CHAIN", recipient: SOL_WALLET }) }],
    ["refunds elsewhere", { lie: (q) => ({ ...q, refundTo: "e".repeat(64) }) }],
    ["refunds to a public wallet", { lie: (q) => ({ ...q, refundType: "ORIGIN_CHAIN", refundTo: SOL_WALLET }) }],
    ["another coin out", { lie: (q) => ({ ...q, destinationAsset: FLOAT_USDC }) }],
    ["an exact price", { lie: (q) => ({ ...q, swapType: "EXACT_INPUT" }) }],
    ["not confidential", { lie: (q) => ({ ...q, confidentiality: "public" }) }],
    ["another amount", { lie: (q) => ({ ...q, amount: "1" }) }],
    ["too little promised", { minOut: (q) => String((BigInt(q.amount) * 90n) / 100n) }],
  ];
  for (const [what, o] of cases) {
    const { f } = setup(o);
    await assert.rejects(f.addOutside("sol", "wallet", key(3)), (e: any) => e.problem.code === "security.subwallet.refused", what);
    // the same key again never hands out the address that failed
    await assert.rejects(f.addOutside("sol", "wallet", key(3)), (e: any) => e.problem.code === "security.subwallet.refused", `${what}, asked again`);
  }
  const { f } = setup();
  assert.equal((await f.addOutside("sol", "wallet", key(3))).depositAddress, SOL_DEPOSITS[0], "control: the honest quote passes");
});

test("E1: the same key gives the same address and asks 1Click once; a new key, a new address; a key used for another Add is refused", async () => {
  const { f, asked } = setup();
  const [a, b] = await Promise.all([f.addOutside("sol", "wallet", key(4)), f.addOutside("sol", "wallet", key(4))]);
  const c = await f.addOutside("sol", "wallet", key(4));
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.equal(asked.length, 1);
  const d = await f.addOutside("sol", "wallet", key(5));
  assert.notEqual(d.depositAddress, a.depositAddress, "control: a new key is a new address");
  assert.equal(asked.length, 2);
  await assert.rejects(f.addOutside("hood", "wallet", key(4)), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(f.addOutside("sol", "safe", key(4)), (e: any) => e.problem.code === "security.request.invalid");
  await assert.rejects(f.addOutside("sol", "wallet", "short"), (e: any) => e.problem.code === "security.request.invalid");
});

test("H1 (review): a key's address is never handed out again once money reached it or it ran out, whatever Home's line says (control: unpaid and in time, the same address)", async () => {
  const clock = { t: Date.now() };
  const held = [{ tokenId: SOL, amount: "150000000" }];
  const s = setup({}, { clock, held });
  // asked while the test clock is still at real time (a quote 1Click signs is believed for 4 days from its own time)
  const a = await s.f.addOutside("sol", "wallet", key(40));
  const b = await s.f.addOutside("sol", "wallet", key(41));
  const c = await s.f.addOutside("sol", "wallet", key(42));
  assert.ok(c);
  // control: unpaid, the same key gives the same address
  clock.t += 20_000;
  assert.equal((await s.f.addOutside("sol", "wallet", key(40))).depositAddress, a.depositAddress, "control: unpaid, the same address");
  // the review's PoC A: it lands and goes on; 61 minutes later Home's line has dropped it
  s.set(a.depositAddress, "SUCCESS", { amountOut: "150000000" });
  await s.f.addsOnWay();
  clock.t += 60_000;
  await s.f.addsOnWay();
  clock.t += 61 * 60_000;
  await s.f.addsOnWay();
  await assert.rejects(s.f.addOutside("sol", "wallet", key(40)), (e: any) => e.problem.code === ADD_USED, "the used address is never shown again");
  // 1Click has only seen the deposit (not landed yet): the ask itself reads it and refuses at once
  s.set(b.depositAddress, "KNOWN_DEPOSIT_TX");
  clock.t += 16_000;
  await assert.rejects(s.f.addOutside("sol", "wallet", key(41)), (e: any) => e.problem.code === ADD_USED, "money seen: never shown again");
  // ran out (past its shown end, still unpaid)
  clock.t += ADD_SHOWN_MS + 1;
  await assert.rejects(s.f.addOutside("sol", "wallet", key(42)), (e: any) => e.problem.code === ADD_USED, "ran out: never shown again");
});

test("M1 (review): money that lands between two reads is counted once, by its Add, never also by the count's correction (control: no Add open, the correction still holds the count to 1Click)", async () => {
  const clock = { t: Date.now() };
  const held: { tokenId: string; amount: string }[] = [];
  const s = setup({}, { clock, held });
  const a = await s.f.addOutside("sol", "wallet", key(50));
  await s.f.addsOnWay(); // read: PENDING_DEPOSIT
  clock.t += 5_000;
  // 1Click settles and credits the float; Trading's balance reads before the Add is due for its own read
  s.set(a.depositAddress, "SUCCESS", { amountOut: "150000000" });
  held.push({ tokenId: SOL, amount: "150000000" });
  clock.t += 5_000;
  const sol = (b: { tokens: { tokenId: string; amount: string }[] }) => b.tokens.find((t) => t.tokenId === SOL)?.amount;
  assert.equal(sol(await s.f.balance()), "150000000", "counted once");
  clock.t += 30_000;
  // read as done, it goes on to the SOL wallet in that same turn (D137): all 0.15 SOL leave once, so nothing stays counted
  // (a double count would leave 0.15 SOL here)
  assert.equal(sol(await s.f.balance()), undefined, "and still once when the Add is read as done (the PoC counted 3.0 SOL here)");
  assert.deepEqual(s.asked.filter((q) => q.depositType === "CONFIDENTIAL_INTENTS").map((q) => q.amount), ["150000000"], "its forward took what arrived, once");
  // control: with no Add open, a difference from what 1Click holds is still corrected
  const c = setup({}, { clock: { t: Date.now() }, held: [{ tokenId: SOL, amount: "7000000" }] });
  assert.equal(sol(await c.f.balance()), "7000000", "control: the count follows 1Click's own balance");
});

test("M2 (review): a deposit over the relay's one-quote limit goes on in legs at or under it, each the moment the one before lands (D137); a refusal says the true reason (control: the PoC's 3 SOL into a $100 relay)", async () => {
  // 100 SOL ($15,000) into the relay's $10,000 (D132): two legs, each under PART_MOST_USD, both forwarded
  const clock = { t: Date.now() };
  const held = [{ tokenId: SOL, amount: "100000000000" }];
  const s = setup({ cap: 10_000 }, { clock, held });
  const a = await s.f.addOutside("sol", "wallet", key(60));
  s.set(a.depositAddress, "SUCCESS", { amountOut: "100000000000" });
  await s.f.addsOnWay();
  const legs = () => s.asked.filter((q) => q.depositType === "CONFIDENTIAL_INTENTS");
  assert.equal(legs().length, 1, "the first leg in the same turn it landed");
  // the first leg lands: the next turn reads it and sends the second in that same turn
  s.settleOut();
  clock.t += 1_000;
  await s.f.addsOnWay();
  assert.equal(legs().length, 2, "the second leg the moment the first landed");
  const fwds = legs();
  assert.equal(fwds.reduce((n, q) => n + BigInt(q.amount), 0n), 100000000000n, "together, all of it");
  for (const q of fwds) assert.ok((Number(q.amount) / 1e9) * 150 <= PART_MOST_USD, `${q.amount}: under the cap`);
  // the plan itself: every leg under the cap, all of the money, all due at once (each goes when the one before lands)
  const plan = planParts(10n ** 12n, 150_000, 1234);
  assert.ok(plan.length >= 16 && plan.every((p) => (Number(p.units) / 1e9) * 150 <= PART_MOST_USD));
  assert.equal(plan.reduce((n, p) => n + BigInt(p.units), 0n), 10n ** 12n);
  assert.ok(plan.every((p) => p.atMs === 1234 && p.tries === 0));
  // control (the review's PoC C): the old $100 relay refuses every part of 3 SOL ($450); the line says why, truly
  // its own clock from real time (a quote 1Click signs is believed for 4 days from its own time)
  const clock2 = { t: Date.now() };
  const old = setup({ cap: 100 }, { clock: clock2, held: [{ tokenId: SOL, amount: "3000000000" }] });
  const b = await old.f.addOutside("sol", "wallet", key(61));
  old.set(b.depositAddress, "SUCCESS", { amountOut: "3000000000" });
  let line = await old.f.addsOnWay();
  for (let i = 0; i < 12 && line[0]?.stage !== "held"; i++) {
    clock2.t += 5 * 60_000;
    line = await old.f.addsOnWay();
  }
  assert.deepEqual([line[0]!.stage, line[0]!.reason], ["held", "The swap service said no 3 times, so it stays in your NEAR wallet."]);
});

test("D137: the plan is one leg, due the moment it lands, whatever the amount under the relay's cap: no random gap, no random split; set-up's too (control: over the cap, more legs, all due at once)", () => {
  const now = 1_000_000;
  for (const [units, usd] of [[333_333_333n, 50], [100_000_000n, 15], [60_000_000_000n, 9_000]] as const) {
    assert.deepEqual(planParts(units, usd, now), [{ units: String(units), atMs: now, tries: 0 }], `$${usd}: one leg, now`);
  }
  // control: over PART_MOST_USD the relay's own limit cuts it, still all due at once
  const over = planParts(100_000_000_000n, 15_000, now);
  assert.deepEqual([over.length, over.every((p) => p.atMs === now)], [2, true]);
});

test("D137: the forward is asked in the same turn the money lands, all of it in one leg, nothing waits but the network (control: a try the swap service refused waits its retry gap, the one wait kept)", async () => {
  const clock = { t: Date.now() };
  // $50 of SOL (before D137: two random parts, the first 3 to 20 minutes after it landed)
  const s = setup({}, { clock, held: [{ tokenId: SOL, amount: "333333333" }] });
  const a = await s.f.addOutside("sol", "wallet", key(90));
  assert.deepEqual(await s.f.addsOnWay(), [], "nothing landed yet: nothing asked");
  assert.equal(s.asked.length, 1);
  s.set(a.depositAddress, "SUCCESS", { amountOut: "333333333" });
  clock.t += 31_000;
  // the one turn that reads the landing
  const [line] = await s.f.addsOnWay();
  const legs = s.asked.filter((q) => q.depositType === "CONFIDENTIAL_INTENTS");
  assert.equal(legs.length, 1, "asked in the same turn it landed, in one leg");
  assert.deepEqual([legs[0].amount, legs[0].recipient, legs[0].originAsset], ["333333333", SOL_WALLET, SOL], "all of it, to the SOL wallet");
  assert.equal(s.submitted.length, 1, "signed and sent in that turn");
  // Home's line: on its way, about a minute (1Click's own move), no planned wait
  assert.deepEqual([line!.stage, line!.etaSeconds], ["forwarding", 60]);
  // control: the swap service says no to the forward; it waits ADD_FORWARD_GAP_MS before the next try, never sooner
  const clock2 = { t: Date.now() };
  const c = setup({ cap: 10 }, { clock: clock2, held: [{ tokenId: SOL, amount: "333333333" }] });
  let tries = 0;
  const quote = c.r.quote;
  c.r.quote = (req) => ((tries += req.depositType === "CONFIDENTIAL_INTENTS" ? 1 : 0), quote(req));
  const b = await c.f.addOutside("sol", "wallet", key(91));
  c.set(b.depositAddress, "SUCCESS", { amountOut: "333333333" });
  await c.f.addsOnWay();
  assert.equal(tries, 1, "control: the first try went in the same turn too");
  clock2.t += ADD_FORWARD_GAP_MS - 1_000;
  await c.f.addsOnWay();
  assert.equal(tries, 1, "control: a refused try waits its gap");
  clock2.t += 2_000;
  await c.f.addsOnWay();
  assert.equal(tries, 2, "control: then tries again");
  // an Add an older core planned with its 3-20 min gap (kept on the phone before D137): its first leg goes now too
  const clock3 = { t: Date.now() };
  const held3: { tokenId: string; amount: string }[] = [];
  const o = setup({}, { clock: clock3, held: held3 });
  const d = await o.f.addOutside("sol", "wallet", key(92));
  o.set(d.depositAddress, "SUCCESS", { amountOut: "100000000" });
  await o.f.addsOnWay(); // landed; 1Click's balance doesn't show it yet, so no plan
  const log = JSON.parse(new TextDecoder().decode((await o.vault.get("float-move-log"))!));
  log.kept.find((k: any) => k.outside).fwd = { parts: [{ units: "100000000", atMs: clock3.t + 20 * 60_000, tries: 0 }] };
  await o.vault.put("float-move-log", new TextEncoder().encode(JSON.stringify(log)));
  held3.push({ tokenId: SOL, amount: "100000000" });
  await o.f.addsOnWay();
  assert.equal(o.asked.filter((q) => q.depositType === "CONFIDENTIAL_INTENTS").length, 1, "an old plan's gap is not waited");
});

test("L1 (review): set-up's address is never sized under an Add's own least, so its forward always has a price floor (control: a bigger need is sized as asked)", async () => {
  const s = setup();
  await s.f.addSetup("sol", key(80), "5b".repeat(32), 0.3);
  assert.equal(s.asked[0].amount, "20000000", "$0.30 asked: sized at $3 (0.02 SOL at $150)");
  await s.f.addSetup("sol", key(81), "5b".repeat(32), 10);
  assert.equal(s.asked[1].amount, String(Math.ceil((10 / 150) * 1e4) * 1e5), "control: $10 as asked");
});

test("E1: an address is never given out twice: one 1Click gave before (any case on EVM) is refused; a fresh one passes", async () => {
  const same = setup({ deposit: () => SOL_DEPOSITS[1]! });
  await same.f.addOutside("sol", "wallet", key(6));
  await assert.rejects(same.f.addOutside("sol", "wallet", key(7)), (e: any) => e.problem.code === "security.subwallet.refused" && /gave before/.test(e.problem.more));
  const evm = setup({ deposit: (_r, n) => (n === 0 ? "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" : "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD") });
  await evm.f.addOutside("hood", "wallet", key(8));
  await assert.rejects(evm.f.addOutside("hood", "wallet", key(9)), (e: any) => /gave before/.test(e.problem.more), "the same EVM address in capitals");
  const fresh = setup();
  await fresh.f.addOutside("sol", "wallet", key(6));
  assert.ok(await fresh.f.addOutside("sol", "wallet", key(7)), "control: a new address passes");
});

test("E1: once it lands, the float forwards it to the SOL wallet at once, once; a restart resumes the job and never forwards twice", async () => {
  const vault = new MemoryVault();
  const clock = { t: Date.now() };
  const fake = relay();
  const held = [{ tokenId: SOL, amount: "100000000" }];
  const first = setup({}, { vault, fake, clock, held });
  const a = await first.f.addOutside("sol", "wallet", key(10));
  // 0.15 SOL arrives ($22.50); 1Click says it's done
  fake.set(a.depositAddress, "KNOWN_DEPOSIT_TX");
  clock.t += 40_000;
  assert.deepEqual((await first.f.addsOnWay()).map((x) => [x.stage, x.chain, x.to]), [["arriving", "sol", "wallet"]]);
  fake.set(a.depositAddress, "SUCCESS", { amountOut: "100000000" });
  clock.t += 40_000;
  assert.equal((await first.f.addsOnWay())[0]!.stage, "forwarding");
  assert.equal(fake.asked.length, 2, "the forward's quote, at once (D137)");
  // a restart: a new core on the same vault picks the job up
  clock.t += 60_000;
  const second = setup({}, { vault, fake, clock, held });
  const on = await second.f.addsOnWay();
  assert.equal(on[0]!.stage, "forwarding");
  assert.equal(fake.asked.length, 2, "no second forward after the restart");
  const fwd = fake.asked[1];
  assert.deepEqual(
    [fwd.originAsset, fwd.depositType, fwd.destinationAsset, fwd.swapType, fwd.amount, fwd.recipient, fwd.recipientType, fwd.refundTo, fwd.refundType],
    [SOL, "CONFIDENTIAL_INTENTS", SOL, "EXACT_INPUT", "100000000", SOL_WALLET, "DESTINATION_CHAIN", FLOAT, "CONFIDENTIAL_INTENTS"],
  );
  assert.equal(fake.submitted.length, 1);
  // asked again, and after another restart: the same forward, never a second
  clock.t += 5 * 60_000;
  await second.f.addsOnWay();
  const third = setup({}, { vault, fake, clock, held });
  await third.f.addsOnWay();
  await third.f.balance();
  assert.equal(fake.asked.length, 2, "one forward only");
  assert.equal(fake.submitted.length, 1);
  // it lands in the wallet
  const fwdDeposit = [...(await third.f.moves())].find((m) => m.kind === "out")!;
  fake.set((await vault.get("float-move-log")) ? JSON.parse(new TextDecoder().decode((await vault.get("float-move-log"))!)).kept.find((k: any) => k.move.id === fwdDeposit.id).depositAddress : "", "SUCCESS");
  clock.t += 60_000;
  assert.equal((await third.f.addsOnWay())[0]!.stage, "landed");
});

test("E1: a restart in the middle of the forward asks again with the same key and gets the same move (control: a fresh try has a new key)", async () => {
  const vault = new MemoryVault();
  const clock = { t: Date.now() };
  const fake = relay();
  const held = [{ tokenId: SOL, amount: "100000000" }];
  const one = setup({}, { vault, fake, clock, held });
  const a = await one.f.addOutside("sol", "wallet", key(11));
  fake.set(a.depositAddress, "SUCCESS", { amountOut: "100000000" });
  await one.f.addsOnWay();
  assert.equal(fake.submitted.length, 1, "forwarded in the turn it landed");
  // the add's record as a restart mid-way would leave it: the try's key kept, its move id not yet marked
  const log = JSON.parse(new TextDecoder().decode((await vault.get("float-move-log"))!));
  const add = log.kept.find((k: any) => k.outside);
  const fwdId = add.fwd.parts[0].id;
  delete add.fwd.parts[0].id;
  assert.equal(add.fwd.parts[0].key, `${key(11).slice(0, 52)}-p0f1`, "the try's key is kept before it starts");
  await vault.put("float-move-log", new TextEncoder().encode(JSON.stringify(log)));
  const two = setup({}, { vault, fake, clock, held });
  await two.f.addsOnWay();
  assert.equal(fake.asked.length, 2, "no second forward quote");
  assert.equal(fake.submitted.length, 1);
  const after = JSON.parse(new TextDecoder().decode((await vault.get("float-move-log"))!)).kept.find((k: any) => k.outside);
  assert.equal(after.fwd.parts[0].id, fwdId, "marked with the same move");
});

test("E1: the forward never sends more than 1Click holds for the float (the relay's settled figure is unsigned); nothing held yet, it waits", async () => {
  const clock = { t: Date.now() };
  const held: { tokenId: string; amount: string }[] = [];
  const s = setup({}, { clock, held });
  const a = await s.f.addOutside("sol", "wallet", key(12));
  s.set(a.depositAddress, "SUCCESS", { amountOut: "900000000" });
  await s.f.addsOnWay();
  clock.t += 60_000;
  await s.f.addsOnWay();
  assert.equal(s.asked.length, 1, "1Click's balance shows nothing yet: no forward");
  held.push({ tokenId: SOL, amount: "100000000" });
  await s.f.addsOnWay(); // planned and sent now, from what 1Click holds
  assert.equal(s.asked[1].amount, "100000000", "what 1Click holds (0.1 SOL, $15: one leg), not the relay's 0.9 SOL");
});

test("E2: an Add to the Safe goes home as USDC to the Safe's own account, at once; Home's line says the Safe", async () => {
  const clock = { t: Date.now() };
  const s = setup({}, { clock, held: [{ tokenId: SOL, amount: "100000000" }] });
  const a = await s.f.addOutside("sol", "safe", key(13));
  assert.equal(a.to, "safe");
  s.set(a.depositAddress, "SUCCESS", { amountOut: "100000000" });
  const line = await s.f.addsOnWay();
  const home = s.asked[1];
  assert.deepEqual([home.originAsset, home.depositType, home.destinationAsset, home.swapType, home.amount, home.recipient, home.recipientType], [SOL, "CONFIDENTIAL_INTENTS", FLOAT_USDC, "EXACT_INPUT", "100000000", MAIN, "INTENTS"]);
  assert.deepEqual([line[0]!.to, line[0]!.stage], ["safe", "forwarding"]);
});

test("E1: a refund comes back to the float and Home says so; an address nobody paid stays off Home's line", async () => {
  const clock = { t: Date.now() };
  // what 1Click holds for the float once the refund is in (the count is held to it when nothing is open)
  const s = setup({}, { clock, held: [{ tokenId: SOL, amount: "5000000" }] });
  const a = await s.f.addOutside("sol", "wallet", key(14));
  await s.f.addOutside("sol", "wallet", key(15));
  assert.deepEqual(await s.f.addsOnWay(), [], "unpaid addresses aren't on the line");
  s.set(a.depositAddress, "REFUNDED", { refundedAmount: "5000000" });
  // each address waits its turn between reads (the relay's 60 a minute), Home reads every 20 s
  clock.t += 31_000;
  const line = await s.f.addsOnWay();
  assert.deepEqual(line.map((x) => x.stage), ["refunded"]);
  assert.equal((await s.f.balance()).tokens.find((t) => t.tokenId === SOL)?.amount, "5000000", "the refund counts in the float");
});

test("E1: a wallet ZeroFee stopped filling gets no address; NEAR and BNB stay off while their switches are off (control: switched on in a test, both quote)", async () => {
  await assert.rejects(setup({}, { oldWords: true }).f.addOutside("sol", "wallet", key(16)), (e: any) => /old words/.test(e.problem.more));
  assert.ok(await setup({}, { oldWords: true }).f.addOutside("sol", "safe", key(16)), "control: the Safe still takes it");
  assert.equal(ADD_OPEN.near, false);
  assert.equal(ADD_OPEN.bsc, false);
  assert.equal(CHAIN_COIN.bsc.open, false, "BNB's Add is shut with its chain");
  for (const c of ["near", "bsc"] as const) await assert.rejects(setup().f.addOutside(c, "wallet", key(17)), (e: any) => /opens once ZeroFee has tested it/.test(e.problem.more), c);
  const on = setup({}, { open: { near: true, bsc: true } });
  const near = await on.f.addOutside("near", "safe", key(18));
  assert.deepEqual([near.tokenId, near.symbol], ["nep141:wrap.near", "NEAR"]);
  assert.match(near.depositAddress, /^[0-9a-f]{64}$/);
  const bnb = await on.f.addOutside("bsc", "wallet", key(19));
  assert.equal(on.asked[1].originAsset, "nep245:v2_1.omni.hot.tg:56_11111111111111111111", "BNB's nep245 coin");
  assert.match(bnb.depositAddress, /^0x[0-9a-fA-F]{40}$/);
});

test("Request: dollars sized at the core's own price, cut to what a line shows; under $3 and over $9,500 refused (room under the relay's $10,000 per quote, D132)", async () => {
  const { f, asked } = setup();
  const a = await f.addOutside("sol", "wallet", key(20), "20.00");
  // $20 at $150: 0.1333 SOL (cut down at 4 places, the most a line shows: the payer sends exactly what the line says)
  assert.equal(asked[0].amount, "133300000");
  assert.equal(a.usd, "20.00");
  await assert.rejects(f.addOutside("sol", "wallet", key(21), String(ADD_LEAST_USD - 1)), (e: any) => /or more/.test(e.problem.more));
  await assert.rejects(f.addOutside("sol", "wallet", key(22), "9500.01"), (e: any) => /or less/.test(e.problem.more));
  await assert.rejects(f.addOutside("sol", "wallet", key(23), "abc"), (e: any) => e.problem.code === "security.request.invalid");
  assert.ok(await f.addOutside("sol", "wallet", key(24), "9500"), "control: $9,500 passes");
});

test("set-up, the private way: a landed first money goes on as NEAR to the account being opened (never a wallet's address); once the account is open, a late one goes to the Safe", async () => {
  const SETUP = "5b".repeat(32);
  const clock = { t: Date.now() };
  const held = [{ tokenId: SOL, amount: "20000000" }];
  let open = false;
  // 0.02 SOL is $3 at $150; NEAR at $4: 1Click promises 0.7 NEAR (the core's floor is ($3 - $0.50) / 1.03 of NEAR)
  const s = setup({ minOut: (req) => (req.destinationAsset === "nep141:wrap.near" ? (7n * 10n ** 23n).toString() : ((BigInt(req.amount) * 99n) / 100n).toString()) }, { clock, held });
  // the same core, with the account still opening (no main account yet), then open
  (s.f as any).d.mainAccount = async () => (open ? MAIN : Promise.reject(new Error("not open")));
  const a = await s.f.addSetup("sol", key(30), SETUP, 3);
  const q = s.asked[0];
  assert.deepEqual([q.recipient, q.recipientType, q.refundTo, q.refundType, q.originAsset, q.destinationAsset], [FLOAT, "CONFIDENTIAL_INTENTS", FLOAT, "CONFIDENTIAL_INTENTS", SOL, SOL]);
  assert.equal((await s.f.setupFacts(key(30), 0))?.status, "PENDING_DEPOSIT");
  // S2: under the least, set-up's checklist hears 1Click's own word (fund-start.ts says "short"), never "on its way"
  s.set(a.depositAddress, "INCOMPLETE_DEPOSIT", { depositedAmount: "10000000" });
  assert.equal((await s.f.setupFacts(key(30), 0))?.status, "INCOMPLETE_DEPOSIT");
  s.set(a.depositAddress, "KNOWN_DEPOSIT_TX");
  assert.equal((await s.f.setupFacts(key(30), 0))?.status, "KNOWN_DEPOSIT_TX");
  s.set(a.depositAddress, "SUCCESS", { amountOut: "20000000" });
  assert.equal((await s.f.setupFacts(key(30), 0))?.status, "PROCESSING");
  assert.deepEqual(await s.f.addsOnWay(), [], "set-up's money is never on Home's line");
  // D137: sent on in the same read that saw it land (no 30 s to 3 min wait)
  const fwd = s.asked[1];
  assert.deepEqual(
    [fwd.originAsset, fwd.depositType, fwd.destinationAsset, fwd.swapType, fwd.amount, fwd.recipient, fwd.recipientType, fwd.refundTo],
    [SOL, "CONFIDENTIAL_INTENTS", "nep141:wrap.near", "EXACT_INPUT", "20000000", SETUP, "DESTINATION_CHAIN", FLOAT],
  );
  assert.equal(s.submitted.length, 1, "signed by the float and sent");
  // control: a NEAR price under the core's floor is never signed
  const low = setup({ minOut: (req) => (req.destinationAsset === "nep141:wrap.near" ? (5n * 10n ** 23n).toString() : ((BigInt(req.amount) * 99n) / 100n).toString()) }, { clock, held });
  (low.f as any).d.mainAccount = async () => Promise.reject(new Error("not open"));
  const b = await low.f.addSetup("sol", key(33), SETUP, 3);
  low.set(b.depositAddress, "SUCCESS", { amountOut: "20000000" });
  await low.f.setupFacts(key(33), 0);
  assert.equal(low.asked.length, 2, "asked");
  assert.equal(low.submitted.length, 0, "under the floor: not signed");
  // a late deposit after the opening (control: the same job, now the account is open): home to the Safe instead
  open = true;
  const late = await s.f.addSetup("sol", key(31), SETUP, 3);
  s.set(late.depositAddress, "SUCCESS", { amountOut: "20000000" });
  await s.f.setupFacts(key(31), 0);
  const home = s.asked.at(-1);
  assert.deepEqual([home.recipient, home.recipientType, home.destinationAsset], [MAIN, "INTENTS", FLOAT_USDC]);
  await assert.rejects(s.f.addSetup("sol", key(32), "kim.near", 3), (e: any) => e.problem.code === "security.request.invalid", "only a 64-hex setup address");
});

test("BNB's nep245 coin: Hidden's in-quote refuses it while BNB Chain is shut (control: opened in a test, it passes that gate)", async () => {
  const { SubWallets } = await import("./subwallets.ts");
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as never, evm: {} as never, emit: () => {}, approve: async () => false } as never);
  const BNB = "nep245:v2_1.omni.hot.tg:56_11111111111111111111";
  await assert.rejects(w.privateQuoteIn(BNB, "1000", true), (e: any) => /BNB Chain opens once/.test(e.problem.more));
  await assert.rejects(w.privateQuoteIn(BNB, "1000", false), (e: any) => e.problem.code === "security.request.invalid", "never as a NEAR coin");
  CHAIN_COIN.bsc.open = true;
  try {
    await assert.rejects(w.privateQuoteIn(BNB, "1000", true), (e: any) => /Set up your private balance first/.test(e.problem.more), "past the gate: the next check");
  } finally {
    CHAIN_COIN.bsc.open = false;
  }
});

// Money that came in (product decision, 3 Nov was wrong): each Add once it ended is one lasting row in the
// core's record (subwallet.received), joined with its forward; Home's line lets it go after an hour, this never does.
test("Received: an Add that landed in the SOL wallet is one lasting row (what came in, where it landed, the swaps' fee in dollars), fixed when first seen; read again, past Home's hour and after a restart, still one (control: on its way, none)", async () => {
  const vault = new MemoryVault();
  const clock = { t: Date.now() };
  const fake = relay();
  const held = [{ tokenId: SOL, amount: "100000000" }];
  const s = setup({}, { vault, fake, clock, held });
  const a = await s.f.addOutside("sol", "wallet", key(40));
  // 0.101 SOL deposited; 1Click delivers 0.1 SOL to the NEAR wallet
  fake.set(a.depositAddress, "SUCCESS", { amountIn: "101000000", amountOut: "100000000" });
  clock.t += 40_000;
  assert.equal((await s.f.addsOnWay())[0]!.stage, "forwarding");
  assert.deepEqual(await s.f.addsReceived(), [], "control: on its way, no row yet");
  // its forward lands 0.099 SOL in the SOL wallet
  fake.settleOut({ amountOut: "99000000" });
  clock.t += 40_000;
  assert.equal((await s.f.addsOnWay())[0]!.stage, "landed");
  const rows = await s.f.addsReceived();
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.deepEqual([r.kind, r.chain, r.into, r.tokenId, r.decimals, r.amount, r.usd, r.feeUsd], ["add", "sol", "sol", SOL, 9, "101000000", "15.15", "0.30"]);
  assert.ok(r.id.startsWith("add:") && !r.id.includes(a.depositAddress), "its own id, never its address");
  // read again, and Home's line asked again: still one
  await s.f.addsOnWay();
  assert.equal((await s.f.addsReceived()).length, 1, "once");
  // past Home's hour the line lets it go; the row stays
  clock.t += 2 * 3_600_000;
  assert.deepEqual(await s.f.addsOnWay(), [], "Home's line is gone");
  // a restart, at another price: the same one row, its dollars as first seen
  const again = setup({}, { vault, fake, clock, held });
  (again.f as any).d.usdPrice = async () => 999;
  assert.deepEqual(await again.f.addsReceived(), rows, "kept, never priced again");
});

test("Received: an Add to the Safe is one row into the Safe, its USDC counted in dollars; a refund is one row into the NEAR wallet (control: an unpaid address, none)", async () => {
  const clock = { t: Date.now() };
  const s = setup({}, { clock, held: [{ tokenId: SOL, amount: "100000000" }] });
  const a = await s.f.addOutside("sol", "safe", key(41));
  await s.f.addOutside("sol", "wallet", key(42));
  s.set(a.depositAddress, "SUCCESS", { amountOut: "100000000" });
  await s.f.addsOnWay();
  // home as USDC: $14.70 for $15.00 of SOL
  s.settleOut({ amountOut: "14700000" });
  clock.t += 40_000;
  await s.f.addsOnWay();
  const rows = await s.f.addsReceived();
  assert.deepEqual(rows.map((r) => [r.into, r.amount, r.usd, r.feeUsd]), [["safe", "100000000", "15.00", "0.30"]], "one row: the unpaid address has none");
  const b = setup({}, { clock, held: [{ tokenId: SOL, amount: "5000000" }] });
  const c = await b.f.addOutside("sol", "wallet", key(43));
  b.set(c.depositAddress, "REFUNDED", { refundedAmount: "5000000" });
  clock.t += 31_000;
  await b.f.addsOnWay();
  assert.deepEqual((await b.f.addsReceived()).map((r) => [r.into, r.amount, r.feeUsd]), [["near", "5000000", "0.00"]], "back in the NEAR wallet: money in all the same");
});

test("Received: set-up money that opened the account is never an Add row (the opening's own row says it); one sent home to an account already open is (control)", async () => {
  const SETUP = "5b".repeat(32);
  const clock = { t: Date.now() };
  let open = false;
  const s = setup({ minOut: (req) => (req.destinationAsset === "nep141:wrap.near" ? (7n * 10n ** 23n).toString() : ((BigInt(req.amount) * 99n) / 100n).toString()) }, { clock, held: [{ tokenId: SOL, amount: "20000000" }] });
  (s.f as any).d.mainAccount = async () => (open ? MAIN : Promise.reject(new Error("not open")));
  const a = await s.f.addSetup("sol", key(44), SETUP, 3);
  s.set(a.depositAddress, "SUCCESS", { amountOut: "20000000" });
  await s.f.setupFacts(key(44), 0);
  s.settleOut({ amountOut: (7n * 10n ** 23n).toString() });
  clock.t += 10_000;
  await s.f.setupFacts(key(44), 0);
  assert.equal((await s.f.setupFacts(key(44), 0))?.status, "SUCCESS", "its NEAR reached the setup address");
  assert.deepEqual(await s.f.addsReceived(), [], "the opening's own row, never a second");
  open = true;
  const late = await s.f.addSetup("sol", key(45), SETUP, 3);
  s.set(late.depositAddress, "SUCCESS", { amountOut: "20000000" });
  await s.f.setupFacts(key(45), 0);
  s.settleOut({ amountOut: "2900000" });
  clock.t += 10_000;
  await s.f.setupFacts(key(45), 0);
  assert.deepEqual((await s.f.addsReceived()).map((r) => [r.into, r.amount]), [["safe", "20000000"]], "control: sent home to the open account, one row");
});

test("the Safe watch's float side: the coins the float's own moves to or from the Safe touched, open or since a time (control: an old one, none)", async () => {
  const clock = { t: Date.now() };
  const s = setup({}, { clock, held: [{ tokenId: SOL, amount: "100000000" }] });
  const a = await s.f.addOutside("sol", "safe", key(46));
  s.set(a.depositAddress, "SUCCESS", { amountOut: "100000000" });
  await s.f.addsOnWay();
  const before = clock.t;
  assert.deepEqual((await s.f.safeTouched(before)).sort(), [FLOAT_USDC, SOL].sort(), "the move home, open");
  s.settleOut({ amountOut: "14700000" });
  clock.t += 40_000;
  await s.f.addsOnWay();
  assert.deepEqual((await s.f.safeTouched(before)).sort(), [FLOAT_USDC, SOL].sort(), "ended since");
  clock.t += 3_600_000;
  assert.deepEqual(await s.f.safeTouched(clock.t - 60_000), [], "control: ended long before");
});

// ── The test mainnet test (3 Nov): 1 SOL reached a one-time address, 1Click took it in 2 s, and the app showed
// nothing for 10 minutes. The phone's push now says "money is here" at once, the Add is followed on every read from then,
// its forward goes in the same turn it lands, each step has its time and proof, and the money counts once all the way. ──

const sol = (b: { tokens: { tokenId: string; amount: string }[] }) => b.tokens.find((t) => t.tokenId === SOL)?.amount;
const DEPOSIT_TX = "Vm5aFvCLVkP36vFnbZQ8BJQmDzXvBavWJ8TCr1qMrLqKxZdFwaAoTVpKZujSGke4vU8N1W4CgV59J4t9b1diEgy";
const LANDED_TX = "ACgymXfAmgf7oqXDPG1fCrii5qwXZ2PYWd7nEiw7rtojXWsS7Uex6rrrJR6gKUdakJ78FnLf7mw3XGwmN7tmXSL";
const keptOf = async (vault: MemoryVault) => JSON.parse(new TextDecoder().decode((await vault.get("float-move-log"))!)).kept as any[];

test("push: a push on a one-time address asks 1Click at once and on every turn; it is 'arriving' once 1Click has the deposit, Received at the push's moment (control: unseen, PENDING_DEPOSIT stays off Home's line and waits its 30 s round)", async () => {
  const clock = { t: Date.now() };
  const held: { tokenId: string; amount: string }[] = [];
  const s = setup({}, { clock, held });
  const a = await s.f.addOutside("sol", "wallet", key(70));
  const b = await s.f.addOutside("sol", "wallet", key(71));
  assert.deepEqual(await s.f.addsOnWay(), [], "control: nobody paid, nothing on its way");
  // the push on `a` spoke (its lamports changed)
  clock.t += 1_000;
  const pushAt = clock.t;
  assert.equal(await s.f.addSeen(a.depositAddress), true);
  assert.deepEqual(await s.f.addsOnWay(), [], "a push alone is no Received: 1Click still says PENDING_DEPOSIT");
  s.set(a.depositAddress, "KNOWN_DEPOSIT_TX");
  clock.t += 2_000;
  const on = await s.f.addsOnWay();
  assert.deepEqual(on.map((x) => [x.key, x.stage]), [[a.depositAddress.slice(-6), "arriving"]], "read on the very next turn (no 30 s round): 1Click has it");
  assert.equal(on[0]!.at?.received, pushAt, "its Received time is the moment the phone's push spoke");
  // 1Click takes it within seconds: 2 s later, the very next read has it (no 30 s round), and the forward goes in that turn
  s.set(a.depositAddress, "SUCCESS", { amountIn: "1000000000", amountOut: "1000000000", originChainTxHashes: [{ hash: DEPOSIT_TX, explorerUrl: "https://solscan.io/tx/" + DEPOSIT_TX }] });
  held.push({ tokenId: SOL, amount: "1000000000" });
  s.set(b.depositAddress, "KNOWN_DEPOSIT_TX");
  clock.t += 2_000;
  const next = await s.f.addsOnWay();
  assert.equal(next.find((x) => x.key === a.depositAddress.slice(-6))?.stage, "forwarding", "seen: read on this turn, landed and sent on");
  assert.equal(s.asked.filter((q) => q.depositType === "CONFIDENTIAL_INTENTS").length, 1, "its forward asked in the same turn (D137)");
  assert.equal(next.find((x) => x.key === b.depositAddress.slice(-6)), undefined, "control: unseen and read 3 s ago, `b` waits its 30 s round");
  clock.t += 30_000;
  assert.equal((await s.f.addsOnWay()).find((x) => x.key === b.depositAddress.slice(-6))?.stage, "arriving", "control: on its round, 1Click's word puts it on the line");
});

test("push: only an address this core gave and still follows is marked seen (control: the real one is)", async () => {
  const s = setup();
  const a = await s.f.addOutside("sol", "wallet", key(72));
  for (const bad of [SOL_WALLET, "", 42, null, "x".repeat(200), SOL_DEPOSITS[4]]) assert.equal(await s.f.addSeen(bad), false, String(bad).slice(0, 20));
  assert.deepEqual(await s.f.addsOnWay(), [], "nothing on its way");
  assert.equal(await s.f.addSeen(a.depositAddress), true, "control");
});

test("push: the watch list is the open one-time SOL addresses, newest first, at most 4; never one already seen, paid, run out, set-up's or another chain's (control: each, before)", async () => {
  const clock = { t: Date.now() };
  const s = setup({}, { clock });
  const made = [];
  for (let i = 0; i < 5; i++) { made.push(await s.f.addOutside("sol", "wallet", key(80 + i))); clock.t += 1; }
  await s.f.addOutside("hood", "wallet", key(89));
  const w = await s.f.addWatch();
  assert.deepEqual(w.map((x) => x.address), made.slice(1).reverse().map((a) => a.depositAddress), "newest 4, SOL only");
  assert.ok(w.every((x) => x.chain === "sol"));
  await s.f.addSeen(made[4]!.depositAddress);
  assert.ok(!(await s.f.addWatch()).some((x) => x.address === made[4]!.depositAddress), "seen: followed by 1Click's status instead");
  assert.ok((await s.f.addWatch()).some((x) => x.address === made[0]!.depositAddress), "control: a slot freed, the next newest is watched");
  clock.t += ADD_SHOWN_MS + 1;
  assert.deepEqual(await s.f.addWatch(), [], "run out: none");
});

test("steps and proof: each step's time, the deposit's own transaction, the private middle, and the transaction that landed it in the SOL wallet (control: on its way, no landed proof made up)", async () => {
  const clock = { t: Date.now() };
  const vault = new MemoryVault();
  const held = [{ tokenId: SOL, amount: "1000000000" }];
  const s = setup({}, { clock, held, vault });
  const a = await s.f.addOutside("sol", "wallet", key(73));
  const t0 = clock.t;
  s.set(a.depositAddress, "PROCESSING", { amountIn: "1000000000", originChainTxHashes: [{ hash: DEPOSIT_TX, explorerUrl: "https://evil.example/tx/" + DEPOSIT_TX }] });
  const going = (await s.f.addsOnWay())[0]!;
  assert.equal(going.stage, "arriving");
  assert.deepEqual(going.at, { received: t0 });
  assert.deepEqual(going.proof, { received: { chain: "sol", hash: DEPOSIT_TX, url: "https://solscan.io/tx/" + DEPOSIT_TX }, swap: a.depositAddress }, "the explorer link built from the chain, never 1Click's other host");
  assert.equal(going.proof?.landed, undefined, "control: nothing landed, no landed proof");
  clock.t += 4_000;
  s.set(a.depositAddress, "SUCCESS", { amountIn: "1000000000", amountOut: "1000000000", originChainTxHashes: [DEPOSIT_TX] });
  const fwd = (await s.f.addsOnWay())[0]!;
  assert.equal(fwd.stage, "forwarding");
  assert.equal(fwd.at?.private, t0 + 4_000);
  // the forward's leg lands in the SOL wallet: 1Click names its Solana transaction
  clock.t += 25_000;
  const leg = (await keptOf(vault)).find((k: any) => k.move.kind === "out");
  s.set(leg.depositAddress, "SUCCESS", { amountOut: "995000000", destinationChainTxHashes: [{ hash: LANDED_TX }] });
  await s.f.addsOnWay();
  const done = (await s.f.addsOnWay())[0]!;
  assert.equal(done.stage, "landed");
  assert.ok(done.at!.landed! >= t0 + 29_000);
  assert.deepEqual(done.proof?.landed, { chain: "sol", hash: LANDED_TX, url: "https://solscan.io/tx/" + LANDED_TX });
  assert.deepEqual([done.at!.received, done.at!.private], [t0, t0 + 4_000], "the earlier steps keep their times");
});

test("D140: from Received on the money counts exactly once: on its way (onWayUsd), then in the NEAR wallet, then sent on (onWayUsd again), then in the wallet (control: the old count dropped it while it moved)", async () => {
  const clock = { t: Date.now() };
  const vault = new MemoryVault();
  const held: { tokenId: string; amount: string }[] = [];
  const s = setup({}, { clock, held, vault });
  const a = await s.f.addOutside("sol", "wallet", key(74));
  // 1 SOL at $150 seen by 1Click; nothing in the float's count yet
  s.set(a.depositAddress, "KNOWN_DEPOSIT_TX", { amountIn: "1000000000" });
  const arriving = (await s.f.addsOnWay())[0]!;
  assert.equal(sol(await s.f.balance()), undefined, "not in the NEAR wallet's count yet");
  assert.equal(arriving.onWayUsd, "150.00", "so Home adds it from Received");
  // lands in the float: the forward's leg is signed in that same turn, so the float lets it go and it is on its way again
  s.set(a.depositAddress, "SUCCESS", { amountIn: "1000000000", amountOut: "1000000000" });
  held.push({ tokenId: SOL, amount: "1000000000" });
  clock.t += 2_000;
  await s.f.addSeen(a.depositAddress); // a late push note changes nothing once 1Click has it
  const moving = (await s.f.addsOnWay())[0]!;
  assert.equal(moving.stage, "forwarding");
  const inFloat = BigInt(sol(await s.f.balance()) ?? "0");
  assert.equal(inFloat, 0n, "the leg is signed: the float let it go");
  assert.equal(moving.onWayUsd, "150.00", "and Home still counts it, once");
  // lands in the SOL wallet: in neither the float nor on its way (the wallet's own balance has it)
  const leg = (await keptOf(vault)).find((k: any) => k.move.kind === "out");
  s.set(leg.depositAddress, "SUCCESS", { amountOut: "995000000" });
  held.length = 0; // 1Click's own balance of the float: the leg took it all
  clock.t += 20_000;
  await s.f.addsOnWay();
  const landed = (await s.f.addsOnWay())[0]!;
  assert.equal(landed.stage, "landed");
  assert.equal(landed.onWayUsd, undefined, "landed: counted by the wallet alone");
  assert.equal(sol(await s.f.balance()), undefined);
});

test("next open: an Add paid while the app was closed is read on the first turn of a new core, ahead of older unpaid ones (control: the oldest waits its turn)", async () => {
  const clock = { t: Date.now() };
  const vault = new MemoryVault();
  const fake = relay();
  const first = setup({}, { clock, vault, fake });
  const made = [];
  for (let i = 0; i < 5; i++) { made.push(await first.f.addOutside("sol", i % 2 ? "wallet" : "safe", key(90 + i))); clock.t += 1_000; }
  const paid = made[4]!;
  fake.set(paid.depositAddress, "PROCESSING", { amountIn: "20000000" });
  fake.set(made[0]!.depositAddress, "PROCESSING", { amountIn: "20000000" });
  clock.t += 10 * 60_000;
  // the app opens again: a new core on the same vault (readAt starts empty); 4 are read a turn, the newest first
  const second = setup({}, { clock, vault, fake });
  const on = await second.f.addsOnWay();
  assert.deepEqual(on.map((x) => [x.key, x.stage, x.to]), [[paid.depositAddress.slice(-6), "arriving", "safe"]], "the newest paid one, on the first read");
  // control: the oldest (paid too) waits for the next turn, two seconds later on the phone's fast read
  clock.t += 2_000;
  assert.deepEqual((await second.f.addsOnWay()).map((x) => x.key).sort(), [paid.depositAddress.slice(-6), made[0]!.depositAddress.slice(-6)].sort(), "control: then the oldest is read");
});

test("D155: set-up takes any chain's own coin NEAR Intents lists, through the same one-time confidential address (Bitcoin here): its coin into the float, refunds there too, then on as NEAR to the account being opened (controls: an address not in Bitcoin's shape is refused; a memo chain, an unknown one, and Home's own Add of Bitcoin are refused)", async () => {
  const SETUP = "5b".repeat(32);
  const BTC = "nep141:btc.omft.near";
  const clock = { t: Date.now() };
  const held = [{ tokenId: BTC, amount: "10000" }];
  const btcAt = (req: any, n: number) => (req.originAsset === BTC && req.depositType === "ORIGIN_CHAIN" ? ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l"][n % 2]! : (n + 1).toString(16).padStart(64, "d"));
  const prices = async (id: string) => (id === BTC ? { usd: 77_500, decimals: 8, symbol: "BTC" } : { usd: 4, decimals: 24, symbol: "wNEAR" });
  // 0.0001 BTC is $7.75 at $77,500; NEAR at $4: 1Click promises 2 NEAR (over the core's floor of ($7.75 - $0.50) / 1.03)
  const s = setup({ deposit: btcAt, minOut: (req) => (req.destinationAsset === "nep141:wrap.near" ? (2n * 10n ** 24n).toString() : ((BigInt(req.amount) * 99n) / 100n).toString()) }, { clock, held });
  (s.f as any).d.mainAccount = async () => Promise.reject(new Error("not open"));
  (s.f as any).d.tokenPrice = prices;
  const a = await s.f.addSetup("btc", key(40), SETUP, 3);
  assert.equal(a.depositAddress, "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
  const q = s.asked[0];
  assert.deepEqual([q.recipient, q.recipientType, q.refundTo, q.refundType, q.originAsset, q.destinationAsset, q.swapType, q.amount], [FLOAT, "CONFIDENTIAL_INTENTS", FLOAT, "CONFIDENTIAL_INTENTS", BTC, BTC, "FLEX_INPUT", "10000"], "its own coin in, to the person's own confidential balance and refunded there; $3 rounded up to 0.0001 BTC");
  s.set(a.depositAddress, "SUCCESS", { amountOut: "10000" });
  assert.equal((await s.f.setupFacts(key(40), 0))?.status, "PROCESSING");
  const fwd = s.asked[1];
  assert.deepEqual([fwd.originAsset, fwd.depositType, fwd.destinationAsset, fwd.amount, fwd.recipient, fwd.recipientType], [BTC, "CONFIDENTIAL_INTENTS", "nep141:wrap.near", "10000", SETUP, "DESTINATION_CHAIN"], "then on as NEAR to the account being opened");
  assert.equal(s.submitted.length, 1, "signed by the float and sent");
  // controls
  const bad = setup({ deposit: () => "0x" + "ab".repeat(20) }, { clock, held });
  (bad.f as any).d.tokenPrice = prices;
  await assert.rejects(bad.f.addSetup("btc", key(41), SETUP, 3), (e: any) => e.problem.code === "security.subwallet.refused" && /Bitcoin/.test(JSON.stringify(e.problem)), "an address not in Bitcoin's shape is never shown");
  await assert.rejects(s.f.addSetup("xrp", key(42), SETUP, 3), (e: any) => e.problem.code === "security.request.invalid", "XRP needs a memo: not taken");
  await assert.rejects(s.f.addSetup("foo", key(43), SETUP, 3), (e: any) => e.problem.code === "security.request.invalid", "an unknown chain");
  await assert.rejects(s.f.addOutside("btc", "safe", key(44)), (e: any) => e.problem.code === "security.request.invalid", "Home's own Add stays on its four chains");
});

// Phone test, 4 Nov: Add sheets opened (each row makes its own one-time address), then "Adding SOL to
// your Safe" and "Adding SOL to your wallet", "Received ✓ · Making it private…", for five hours, with nothing sent. The
// push speaks after every reconnect and return to the page ("it may have changed"), the page told the core "seen", and
// the core kept that as a Received for good. A push is now only a reason to ask 1Click; a mark an older core kept is dropped.
test("bug (Activity stuck): a push with no deposit puts nothing on the line, and a Received an older core kept from a push is dropped; the address is watched again (control: 1Click's deposit puts it on, at the push's moment)", async () => {
  const clock = { t: Date.now() };
  const s = setup({}, { clock });
  const a = await s.f.addOutside("sol", "wallet", key(90));
  const b = await s.f.addOutside("sol", "safe", key(91));
  clock.t += 1_000;
  await s.f.addSeen(a.depositAddress); // the page came back: the push tells both sockets in the same second
  await s.f.addSeen(b.depositAddress);
  assert.deepEqual(await s.f.addsOnWay(), [], "nothing sent: no row");
  assert.equal((await keptOf(s.vault)).find((k) => k.depositAddress === a.depositAddress)?.outside.seenMs, undefined, "and no Received kept");
  // an older core's mark on `a` (the test phone): kept seenMs, 1Click still waiting for a deposit
  const log = JSON.parse(new TextDecoder().decode((await s.vault.get("float-move-log"))!));
  log.kept.find((k: any) => k.depositAddress === a.depositAddress).outside.seenMs = clock.t - 5 * 3_600_000;
  await s.vault.put("float-move-log", new TextEncoder().encode(JSON.stringify(log)));
  const s2 = setup({}, { clock, vault: s.vault, fake: { r: s.r, asked: s.asked, submitted: s.submitted, set: s.set, settleOut: () => {} } as any });
  s.set(b.depositAddress, "KNOWN_DEPOSIT_TX"); // control: b's money really came
  await s2.f.addSeen(b.depositAddress);
  const pushAt = clock.t;
  clock.t += 2_000;
  const line = await s2.f.addsOnWay();
  assert.deepEqual(line.map((x) => [x.key, x.stage]), [[b.depositAddress.slice(-6), "arriving"]], "a: the old mark is dropped, off the line; b: 1Click's word puts it on");
  assert.equal(line[0]!.at?.received, pushAt, "control: Received at the push's moment");
  assert.equal((await keptOf(s.vault)).find((k) => k.depositAddress === a.depositAddress)?.outside.seenMs, undefined, "a's old mark is gone from the kept record");
  assert.ok((await s2.f.addWatch()).some((w) => w.address === a.depositAddress), "a's address is watched again");
  clock.t += ADD_PUSH_FAST_MS;
  assert.deepEqual((await s2.f.addsOnWay()).map((x) => x.key), [b.depositAddress.slice(-6)], "a long-quiet push puts nothing on");
});

test("S2 (QA, 4 Nov): under the least, 1Click says INCOMPLETE_DEPOSIT: Home's line says 'short' with what arrived, what it needed and when it goes back, never 'arriving' (controls: topped up, it goes on; refunded, it ends)", async () => {
  const clock = { t: Date.now() };
  const s = setup({}, { clock });
  const a = await s.f.addOutside("sol", "wallet", key(90));
  // $3 at $150 a SOL is 0.02 SOL; 1Click takes 99 % of it (0.0198 SOL); 0.0133 SOL ($2.00) arrived
  s.set(a.depositAddress, "INCOMPLETE_DEPOSIT", { depositedAmount: "13333333" });
  clock.t += 31_000;
  const [short] = await s.f.addsOnWay();
  assert.equal(short?.stage, "short");
  assert.equal(short?.amount, "13333333");
  assert.equal(short?.usd, "2.00");
  assert.equal(short?.needUsd, "2.97");
  assert.equal(short?.needAmount, a.minAmountIn);
  assert.equal(short?.backAtMs, Date.parse(a.deadlineIso), "it goes back at 1Click's own deadline for the address");
  assert.equal(short?.etaSeconds, undefined, "no time to arrive: it isn't on its way");
  assert.equal(short?.onWayUsd, "2.00", "D140: still counted once, in neither place yet (it comes to the NEAR wallet either way)");
  // a read that failed (the relay down) changes nothing: still short, never back to "arriving"
  const status = s.r.status;
  s.r.status = async () => { throw new Error("relay down"); };
  clock.t += 31_000;
  assert.equal((await s.f.addsOnWay())[0]?.stage, "short");
  s.r.status = status;
  // control: topped up to the least before the deadline, 1Click takes it all and it is on its way again
  s.set(a.depositAddress, "PROCESSING", { depositedAmount: "20000000" });
  clock.t += 31_000;
  assert.equal((await s.f.addsOnWay())[0]?.stage, "arriving");
  // control: never topped up, 1Click sends it back at the deadline: refunded, an end
  s.set(a.depositAddress, "REFUNDED", { refundedAmount: "13333333" });
  clock.t += 31_000;
  assert.equal((await s.f.addsOnWay())[0]?.stage, "refunded");
});

test("privsec P2 (5 Nov): a $0 float with nothing moved asks 1Click hourly at most, not every few minutes (each read signs in with its key); control: a float with money is still held to 1Click every few minutes", async () => {
  const sol = (b: { tokens: { tokenId: string; amount: string }[] }) => b.tokens.find((t) => t.tokenId === SOL)?.amount;
  const clock = { t: Date.now() };
  const held: { tokenId: string; amount: string }[] = [];
  const s = setup({}, { clock, held });
  assert.equal(sol(await s.f.balance()), undefined, "first open: read once (a restore's money would show), nothing there");
  held.push({ tokenId: SOL, amount: "7000000" });                     // another device with the same words adds money
  clock.t += RECONCILE_MS + 1_000;
  assert.equal(sol(await s.f.balance()), undefined, "a few minutes on, $0 and nothing moved: no new sign-in");
  clock.t += EMPTY_RECONCILE_MS;
  assert.equal(sol(await s.f.balance()), "7000000", "within the hour it reads again and shows it");
  // control: money counted here, the count is held to 1Click every few minutes as before
  const c = { t: Date.now() };
  const h2 = [{ tokenId: SOL, amount: "7000000" }];
  const m = setup({}, { clock: c, held: h2 });
  assert.equal(sol(await m.f.balance()), "7000000");
  h2[0] = { tokenId: SOL, amount: "9000000" };
  c.t += RECONCILE_MS + 1_000;
  assert.equal(sol(await m.f.balance()), "9000000", "control: not empty, read after a few minutes");
});
