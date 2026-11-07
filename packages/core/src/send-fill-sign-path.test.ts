// The gate for Send from the Safe through the fill (no real-money proof this round): the core's own sign path end to end,
// wired exactly as DemoCore wires it (demo-core.ts: DevSigner with ownWallets from the core's wallet list, oneClick through
// ownQuote, privateLeg and sendPayout from SubWallets), never MockBridge:
//   leg 1's quote (SubWallets.privateQuoteIn, `through` + `intents`: Train 19's one bridge leg, read back as 1Click signed it)
//   → leg 2 signed and bound to it (SubWallets.privatePay with inDeposit: the payout record)
//   → the Safe's one mt_transfer with the sendFill marker → DevSigner.request: describe → checkIntents (the hotfix's
//     mt_transfer rule) → the sheet → signed and sent.
// Quotes are signed with the TEST key through the same check 1Click's real key passes (quote-signature.ts signedBy1Click;
// quote-signature.test.ts holds a real 1Click-signed quote). No genuinely 1Click-signed CONFIDENTIAL_INTENTS quote is
// recorded in this repo (the only real one, 28 Oct, is a public INTENTS quote whose deadline has passed), so none is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DevSigner } from "./dev-signer.ts";
import { SoftwareKey } from "./device-key.ts";
import { INTENTS, PRIVATE_POCKET, parseQuote, type QuoteFacts } from "./intents.ts";
import { ONE_CLICK_QUOTE_KEY, signedBy1Click } from "./quote-signature.ts";
import { sendPayoutFits } from "./send-fill.ts";
import { throughJoinRefusal } from "./send-words.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import { MemoryVault } from "./vault.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { base64 } from "./sol/bytes.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { securityProblems } from "./security-problems.ts";
import { ProblemError } from "./problem.ts";
import { sendRoom, SEND_FLOOR_USD } from "./send-fill.ts";
import { fillStepUsd } from "./private-route.ts";

const USDC_ID = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC = `nep141:${USDC_ID}`;
const SOL_IN = "nep141:sol.omft.near";
const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const PAYEE = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const OUT = "d".repeat(64);
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const NONCE = base64(new Uint8Array(32).fill(3));

type Tamper = { leg1?: (q: any) => any; leg2?: (q: any) => any; noTag?: true; no?: true; leg1Status?: () => { status: string; amountOut?: string }; /** a fixed Safe key (sheet-words-only: the same bytes on two commits) */ seed?: true };

/** The core's sealed vault, its every write seen with how many transactions the chain had taken by then (the audit's MUST: leg
 *  2's keep comes before leg 1 is sent). */
class SeenVault extends MemoryVault {
  readonly writes: { name: string; sent: number }[] = [];
  sentNow = () => -1;
  override async put(name: string, bytes: Uint8Array) {
    this.writes.push({ name, sent: this.sentNow() });
    return super.put(name, bytes);
  }
}

async function setup(t: Tamper = {}) {
  const quoted = new Map<string, any>();
  let n = 0;
  let pocket = "";
  let leg2: { amountIn: string } | null = null;
  const relay: FloatRelay = {
    quote: async (req) => {
      const depositAddress = `${(n++).toString(16).padStart(2, "0")}${"e".repeat(62)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async (signed: unknown) => (submitted.push(signed), null), status: async () => null,
  };
  const submitted: unknown[] = [];
  // 1Click's status, as signed: leg 2 (OUT) to the payee on Solana; leg 1 (the deposit) as the core asked it
  const privateStatus = async (a: string) => {
    if (a === OUT && leg2) {
      const quoteRequest = { dry: false, originAsset: USDC, destinationAsset: SOL_IN, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: PAYEE, recipientType: "DESTINATION_CHAIN", depositType: "CONFIDENTIAL_INTENTS", deadline: DEADLINE, swapType: "EXACT_INPUT", confidentiality: "basic" };
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: t.leg2 ? t.leg2(quoteRequest) : quoteRequest, quote: { depositAddress: OUT, amountIn: leg2.amountIn, amountInUsd: "250.00", amountOutUsd: "247.50", minAmountOut: "1200000000", amountOut: "1234567890", deadline: DEADLINE } }) };
    }
    const req = quoted.get(a);
    if (!req) return null;
    const quoteRequest = t.leg1 ? t.leg1(req) : req;
    const st = t.leg1Status?.() ?? { status: "PENDING_DEPOSIT" };
    return { status: st.status, ...(st.amountOut ? { swapDetails: { amountOut: st.amountOut } } : {}), quoteResponse: signedQuote({ quoteRequest, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: "300.00", minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] } as unknown as SolChain;
  const vault = new SeenVault();
  const options = { vault, sol, evm: {} as never, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } };
  const w = new SubWallets(options as never);
  pocket = (await w.create("private", "near")).address;
  const pocketId = (await w.list()).find((x) => x.address === pocket)!.id;

  // the Safe on NEAR: 900 USDC in its NEAR Intents balance
  const chain = new FakeChain("mainnet");
  vault.sentNow = () => chain.sent.length;
  const key = t.seed ? SoftwareKey.fromSeed(new Uint8Array(32).fill(9), "development") : SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => (token_id === USDC ? "900000000" : "0") });
  chain.contract(USDC_ID, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract("sol.omft.near", "omft", { ft_metadata: () => ({ symbol: "SOL", decimals: 9 }) });
  const shown: PlainWords[] = [];
  // DemoCore's wiring (demo-core.ts, `this.device = new DevSigner({ ... })`), its own-quote read and the two records
  const ownQuote = async (d: string) => (await w.floatAddFacts(d)) ?? (await w.privateInFacts(d)) ?? (await w.safeSwapFacts(d));
  const events: string[] = [];
  const signerFor = (w: SubWallets) => new DevSigner({
    accountId: "alice.near", chain, key, approve: async (words) => (shown.push(words), !t.no), quoteKey: TEST_QUOTE_KEY,
    // the one Face ID (DemoCore's wiring): leg 2 held for the fill's one sheet, released by its signature only
    pairOf: (paid) => w.pairOf(paid), releasePair: (d, h) => w.releasePair(d, h), dropPair: (d) => w.dropPair(d), endPair: (d) => w.pairEnd(d),
    onSigned: () => events.push(`signed, ${chain.sent.length} sent`),
    ownWallets: async () => new Map((await w.list()).map((x) => [x.address, x.kind === "private" ? PRIVATE_POCKET : x.address])),
    oneClick: async (d) => (await ownQuote(d)) ?? null,
    ownQuote,
    privateLeg: async (d) => w.privateLeg(d),
    sendPayout: async (d) => w.sendPayout(d),
    // fix/bind-intent: the core's own record of what its Swap and Move doors asked (demo-core.ts intentOf)
    ...(t.noTag ? {} : { intentOf: (d: string) => w.intentOf(d) }),
  });
  const signer = signerFor(w);
  /** The app killed and opened again: a new core on the same sealed vault and chain, nothing in memory kept. */
  const restart = () => { const w2 = new SubWallets(options as never); return { w: w2, signer: signerFor(w2) }; };

  /** The Send's two legs, as the wallet builds them (safe-send.ts fromSafe): leg 1's quote, leg 2 signed and bound. */
  const legs = async (units = "300000000") => {
    const leg1 = await w.privateQuoteIn(USDC, units, false, true, true);
    leg2 = { amountIn: "250000000" };
    const payload = { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [`imt:${MINTER}:${USDC}`]: leg2.amountIn } }], signer_id: pocket }), nonce: NONCE, recipient: "intents.far" };
    // the payee pin (audit H4): what the person asked to pay, from Wallet's own request (payee-ask.ts)
    await w.privatePay(pocketId, OUT, { payload }, "Send", "tag-for-this-quote-0001", leg1.depositAddress, undefined, { recipient: PAYEE, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_IN });
    return leg1;
  };
  /** The same two legs with leg 2 HELD for the Safe's one sheet (the audit's c1): checked, not signed. */
  const pairLegs = async (units = "300000000") => {
    const leg1 = await w.privateQuoteIn(USDC, units, false, true, true);
    leg2 = { amountIn: "250000000" };
    const payload = { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [`imt:${MINTER}:${USDC}`]: leg2.amountIn } }], signer_id: pocket }), nonce: NONCE, recipient: "intents.far" };
    const held = await w.privatePay(pocketId, OUT, { payload }, "Send", "tag-for-this-quote-0001", leg1.depositAddress, undefined, { recipient: PAYEE, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_IN }, true);
    return { leg1, held, payload };
  };
  /** The Safe's one transaction (convert.ts mtTransfer, to-private.ts payIntoPocket's last step with `sendFill`). */
  const fill = (deposit: string, units: string, token = USDC, method = "mt_transfer"): TxRequest => ({
    receiverId: INTENTS.account, actions: [{ kind: "call", method, args: { receiver_id: deposit, token_id: token, amount: units, approval: null, ...(method === "mt_transfer_call" ? { msg: "" } : {}) }, depositYocto: "1", gas: "30000000000000" }],
    why: "Send", from: "wallet", sendFill: true,
  } as TxRequest);
  return { w, signer, chain, shown, legs, pairLegs, fill, pocket, quoted, events, vault, submitted, restart };
}

test("the gate (real core sign path): a Send's fill, quoted INTENTS and paid by the Safe's one mt_transfer, is accepted, shown once (the payee, the split, what they get) and signed and sent; the payout bound by the pocket's own signed leg 2", async () => {
  const s = await setup();
  const leg1 = await s.legs();
  assert.equal(s.w.sendPayout(leg1.depositAddress)?.recipient, PAYEE, "leg 2 bound to this move in");
  // bind-intent: leg 1 is under the core's own "move" tag, from its private.quoteIn door's record (never the app's)
  assert.equal(await s.w.intentOf(leg1.depositAddress), "move");
  const out = await s.signer.request(s.fill(leg1.depositAddress, "300000000"));
  assert.equal(out.status, "done", JSON.stringify(out));
  // control: a signer that doesn't read the core's tag record never signs a Send's fill (no path skips the tag)
  const untagged = await setup({ noTag: true });
  const r = await untagged.signer.request(untagged.fill((await untagged.legs()).depositAddress, "300000000"));
  assert.equal(r.status === "problem" && r.problem.code, "security.intent.changed");
  assert.deepEqual([untagged.shown.length, untagged.chain.sent.length], [0, 0], "untagged: no sheet, nothing sent");
  assert.equal(s.shown.length, 1, "one sheet, Face ID's");
  const w = s.shown[0]!;
  assert.equal(w.title, "Send $250.00 from your Safe");
  assert.deepEqual(w.lines.filter((l) => /^(They get|Your Safe sends|From your Safe|Private keeps the rest|Stays in Private|Together|Fees) · /.test(l)), ["They get · 1.2345 SOL (about $247.50)", "From your Safe · $300.00", "Private keeps the rest · about $50.00", "Fees · about $2.50"]);
  assert.equal(w.lines.filter((l) => /They get/.test(l)).length, 1, `"They get" said exactly once: ${String(w.lines)}`);
  // the full address first, unfolded, then where it lands (the audit's D37 condition, the copy review's words)
  assert.deepEqual(w.lines.slice(0, 2), [`To ${PAYEE}`, "Public on Solana. Anyone can see the Safe's part on NEAR."], String(w.lines)); // the copy review (6 Nov): one public line
  assert.ok(w.lines.some((l) => l.startsWith("They get · 1.2345 SOL ")), `the signed coin figure (MUST 4): ${String(w.lines)}`);
  assert.ok(w.amount && w.tap === undefined, "Face ID's sheet");
  assert.equal(s.chain.sent.length, 1, "the Safe's transaction went");
  assert.deepEqual(s.chain.sent[0]!.actions.map((a: any) => a.method), ["mt_transfer"]);
});

test("controls on the same path, each refused before any sheet and nothing sent: a tampered recipient, amount or coin (leg 1's quote, leg 2's payout, or the bytes), mt_transfer_call, no payout bound", async () => {
  const refused = async (why: string, run: (s: Awaited<ReturnType<typeof setup>>) => Promise<{ status: string; problem?: { code: string } }>, code: RegExp) => {
    const s = await setup();
    const r = await run(s).catch((e: any) => ({ status: "problem", problem: e.problem }));
    assert.equal(r.status, "problem", why);
    assert.match(String(r.problem?.code), code, why);
    assert.deepEqual([s.shown.length, s.chain.sent.length], [0, 0], `${why}: no sheet, nothing sent`);
  };
  // the bytes: more, another coin, mt_transfer_call
  await refused("the bytes pay another amount", async (s) => s.signer.request(s.fill((await s.legs()).depositAddress, "300000001")), /security\.intent\.changed/);
  await refused("the bytes pay another coin", async (s) => s.signer.request(s.fill((await s.legs()).depositAddress, "300000000", "nep141:wrap.near")), /security\.(quote\.mismatch|balance)/);
  await refused("mt_transfer_call", async (s) => s.signer.request(s.fill((await s.legs()).depositAddress, "300000000", USDC, "mt_transfer_call")), /security\.(quote\.mismatch|intent\.changed)/);
  // no payout bound to this move in (leg 2 never joined)
  await refused("no payout bound", async (s) => s.signer.request(s.fill((await s.w.privateQuoteIn(USDC, "300000000", false, true, true)).depositAddress, "300000000")), /security\.send\.unbound/);
  // leg 1's signed quote, tampered after the core asked it: the recipient (not the pocket), the coin
  for (const [why, leg1] of [["leg 1 pays someone else", (q: any) => ({ ...q, recipient: "e".repeat(64) })], ["leg 1 in another coin", (q: any) => ({ ...q, originAsset: "nep141:wrap.near" })]] as const) {
    const s = await setup({ leg1 });
    const r = await s.legs().then((l) => s.signer.request(s.fill(l.depositAddress, "300000000"))).catch((e: any) => ({ status: "problem", problem: e.problem }));
    assert.equal(r.status, "problem", why);
    assert.deepEqual([s.shown.length, s.chain.sent.length], [0, 0], `${why}: no sheet, nothing sent`);
  }
  // leg 2's signed payout, tampered: another payee, another coin, another amount than the pocket signs
  for (const [why, leg2] of [["leg 2 to another payee", (q: any) => ({ ...q, recipient: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" })], ["leg 2 in another coin", (q: any) => ({ ...q, originAsset: "nep141:wrap.near" })]] as const) {
    const s = await setup({ leg2 });
    const r = await s.legs().then((l) => s.signer.request(s.fill(l.depositAddress, "300000000"))).catch((e: any) => ({ status: "problem", problem: e.problem }));
    assert.equal(r.status, "problem", why);
    assert.deepEqual([s.shown.length, s.chain.sent.length], [0, 0], `${why}: no sheet, nothing sent`);
  }
  // control: the honest legs go
  const ok = await setup();
  assert.equal((await ok.signer.request(ok.fill((await ok.legs()).depositAddress, "300000000"))).status, "done");
});

test("the wiring this test copies is DemoCore's own (control: a change there fails here)", () => {
  const core = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  assert.match(core, /sendPayout: async \(depositAddress\) => this\.subwallets\.sendPayout\(depositAddress\)/);
  assert.match(core, /privateLeg: async \(depositAddress\) => this\.subwallets\.privateLeg\(depositAddress\)/);
  assert.match(core, /intentOf: \(depositAddress\) => this\.subwallets\.intentOf\(depositAddress\)/);
  assert.match(core, /oneClick: async \(depositAddress\) => \(await this\.ownQuote\(depositAddress\)\) \?\? this\.oneClick\(depositAddress\)/);
  assert.match(core, /return \(await this\.subwallets\.floatAddFacts\(depositAddress\)\) \?\? \(await this\.subwallets\.privateInFacts\(depositAddress\)\) \?\? \(await this\.subwallets\.safeSwapFacts\(depositAddress\)\);/);
});

// ── the audit (5 Nov): over the day's Face ID limit a quoted Send is refused BEFORE Face ID (a held payment can't keep its
// quote), in the copy review's words, with what is left today from the contract's own band state ──────────────────────────────────

const LIMIT = 500_000000n; // $500 of USDC: the first band's dollars
const bands = [{ up_to: [[USDC, LIMIT.toString()], ["nep141:wrap.near", "100000000000000000000000000"], ["near", "1000000000000000000000000000"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "86400" } } }];

test("sendRoom: the day's limit and what ONE Send can still take, its whole fill step included, from protection() and spent_today() (one budget across the band's coins; controls: no Face ID band in dollars: none)", () => {
  assert.deepEqual(sendRoom(bands, []), { limitUsd: 500, leftUsd: sendRoom(bands, [])!.leftUsd });
  const fresh = sendRoom(bands, [])!.leftUsd;
  assert.ok(fillStepUsd(fresh) <= 500 && fillStepUsd(fresh + 0.01) > 500, `the most whose fill fits: ${fresh}`);
  const used = sendRoom(bands, [[USDC, "350000000"]])!;
  assert.ok(fillStepUsd(used.leftUsd) <= 150 && fillStepUsd(used.leftUsd + 0.01) > 150, `$150 left: ${used.leftUsd}`);
  // one budget: half the NEAR limit and $100 of USDC leave 30 %
  const both = sendRoom(bands, [[USDC, "100000000"], ["nep141:wrap.near", "50000000000000000000000000"]])!;
  assert.ok(fillStepUsd(both.leftUsd) <= 150 && fillStepUsd(both.leftUsd + 0.01) > 150, `30 % of $500: ${both.leftUsd}`);
  assert.equal(sendRoom(bands, [[USDC, "500000000"]])!.leftUsd, 0, "all of it used");
  assert.equal(sendRoom(bands, [[USDC, "900000000"]])!.leftUsd, 0, "more than all of it: none, never below 0");
  assert.equal(sendRoom([{ up_to: null, level: { Wait: { seconds: "60" } } }], []), null, "control: no Face ID band");
  assert.equal(sendRoom([{ up_to: [["nep141:wrap.near", "1"]], level: "FaceId" }], []), null, "control: no dollars in the band");
  assert.equal(sendRoom(null, []), null, "control: unread");
});

test("the copy review's words: \"Send up to $Y now\" with a lit \"Send $Y\" at or over the floor; \"Send again tomorrow\" at $0; under the floor the line, no Send button; Protection always the quiet link", () => {
  const some = securityProblems.sendOverLimit(500, 120.5, SEND_FLOOR_USD);
  assert.equal(some.whatHappened, "That's over your Safe's limit of $500.00 today, so ZeroFee didn't send it. Send up to $120.50 now, or change the limit in Protection.");
  assert.deepEqual(some.next, { kind: "open", label: "Send $120.50", screen: "send-up-to:120.50" });
  assert.deepEqual(some.next2, { label: "Protection", kind: "open", screen: "security/protection" });
  assert.deepEqual(some.money, { state: "safe", where: "in your Safe" });
  const none = securityProblems.sendOverLimit(2000, 0, SEND_FLOOR_USD);
  assert.equal(none.whatHappened, "That's over your Safe's limit of $2,000.00 today, so ZeroFee didn't send it. Send again tomorrow, or change the limit in Protection.");
  assert.deepEqual([none.next.kind, none.next.label, none.next2?.label], ["nothing", "Go back", "Protection"]);
  // the floor: a Send button only at or over it
  const under = securityProblems.sendOverLimit(500, SEND_FLOOR_USD - 0.01, SEND_FLOOR_USD);
  assert.match(under.whatHappened, /Send up to \$\d\.\d\d now/);
  assert.equal(under.next.kind, "nothing", "under the floor: no Send button");
  assert.equal(securityProblems.sendOverLimit(500, SEND_FLOOR_USD, SEND_FLOOR_USD).next.kind, "open", "control: at the floor, the button");
  assert.equal(some.code, "security.send.over-limit", "its own code (one per Problem)");
  assert.deepEqual(some.money, { state: "safe", where: "in your Safe" }, "the screen's money line: Your money hasn't moved. It's in your Safe.");
  for (const [x, y] of [[99_999.99, 99_999.98], [500, 0]]) assert.ok(securityProblems.sendOverLimit(x, y, SEND_FLOOR_USD).whatHappened.length < 140, "short, as every Problem");
});

test("the real core: a Send's fill over the day's limit is refused before Face ID with the copy review's line and what is left (spent_today), nothing sent; the old-rules refusal keeps its own step; control: under the limit it signs", async () => {
  const over = async (spent: unknown[], level: unknown = { Wait: { seconds: "86400" } }, b: unknown = bands) => {
    const s = await setup();
    s.chain.withRules("alice.near", b as never);
    s.chain.views.set("alice.near level_for", () => level);
    s.chain.views.set("alice.near protection", () => b);
    s.chain.views.set("alice.near spent_today", () => spent);
    const leg1 = await s.legs();
    return { s, r: await s.signer.request(s.fill(leg1.depositAddress, "300000000")) };
  };
  const { s, r } = await over([[USDC, "350000000"]]);
  assert.equal(r.status, "problem");
  const p = (r as { problem: { code: string; whatHappened: string; next: { kind: string; label: string } } }).problem;
  const left = sendRoom(bands, [[USDC, "350000000"]])!.leftUsd;
  assert.equal(p.whatHappened, `That's over your Safe's limit of $500.00 today, so ZeroFee didn't send it. Send up to $${left.toFixed(2)} now, or change the limit in Protection.`);
  assert.equal(p.next.label, `Send $${left.toFixed(2)}`);
  assert.deepEqual([s.shown.length, s.chain.sent.length], [0, 0], "before Face ID: no sheet, nothing sent");
  const all = await over([[USDC, "500000000"]]);
  assert.match((all.r as { problem: { whatHappened: string } }).problem.whatHappened, /Send again tomorrow, or change the limit in Protection\.$/);
  // control: rules saved before they counted every coin keep their own next step (Save my rules), never the copy review's line
  const old = await over([], { Wait: { seconds: "86400" } }, [{ up_to: [["near", "1000000000000000000000000"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "86400" } } }]);
  assert.doesNotMatch(String((old.r as { problem: { whatHappened: string } }).problem.whatHappened), /limit of/);
  // control: under the limit (Face ID) it signs
  const ok = await over([], "FaceId");
  assert.equal(ok.r.status, "done", JSON.stringify(ok.r));
  assert.equal(ok.s.shown.length, 1);
});

// ── The fill's quote check on 1Click's OWN answers (fixture: two live dry quotes, 5 Nov, through our relay,
// signed with 1Click's real key; a byte-for-byte copy of the private fixture; its pocket and payee are made up, never
// funded). The public copy of this repo leaves the signed file out, and this test skips there ────────────────────────────────────────────────────────────────────────

const LIVE_FILE = new URL("./testing/fixtures/confidential-quote-2026-11-05.json", import.meta.url);
const LIVE = existsSync(LIVE_FILE) ? JSON.parse(readFileSync(LIVE_FILE, "utf8")) : null;

/** The signed terms as the core reads them (parseQuote's own mapping). A dry quote has no status and signs no deadline,
 *  so the join reads it with a real quote's status and the request's deadline: only those two are not 1Click's. */
const factsOf = (r: any): QuoteFacts => ({
  status: "PENDING_DEPOSIT", originAsset: r.quoteRequest.originAsset, amountIn: r.quote.amountIn, refundTo: r.quoteRequest.refundTo, refundType: r.quoteRequest.refundType,
  destinationAsset: r.quoteRequest.destinationAsset, minAmountOut: r.quote.minAmountOut, recipient: r.quoteRequest.recipient, recipientType: r.quoteRequest.recipientType,
  deadline: r.quoteRequest.deadline, depositType: r.quoteRequest.depositType, swapType: r.quoteRequest.swapType, confidentiality: r.quoteRequest.confidentiality, amountOut: r.quote.amountOut, amountInUsd: r.quote.amountInUsd,
});

test("the gate on 1Click's own answers: both live quotes are signed by 1Click's real key (a changed minAmountOut, payee or amount is not); the Safe's move in is a join the fill takes, its payout fits only within what it promises; the core asks for exactly those terms; a dry quote never pays", { skip: LIVE === null && "the live fixture is private (real test accounts)" }, async () => {
  const { moveIn, sendPayout: payout } = LIVE.quotes;
  const pocket: string = LIVE.madeUpAddresses.pocket;
  const at = Date.parse(LIVE.recordedAt);
  // 1. 1Click's signature, with its real key, on both answers as recorded
  assert.equal(signedBy1Click(moveIn.response, ONE_CLICK_QUOTE_KEY), true, "the move in");
  assert.equal(signedBy1Click(payout.response, ONE_CLICK_QUOTE_KEY), true, "the payout");
  const bent = (r: unknown, f: (c: any) => void) => { const c = structuredClone(r) as any; f(c); return c; };
  for (const r of [moveIn.response, payout.response]) {
    assert.equal(signedBy1Click(bent(r, (c) => (c.quote.minAmountOut = String(BigInt(c.quote.minAmountOut) + 1n)))), false, "control: minAmountOut changed");
    assert.equal(signedBy1Click(bent(r, (c) => (c.quoteRequest.recipient = "f".repeat(64)))), false, "control: payee changed");
    assert.equal(signedBy1Click(bent(r, (c) => (c.quoteRequest.amount = "6000000"))), false, "control: amount changed");
    assert.equal(signedBy1Click(r, TEST_QUOTE_KEY), false, "control: another key");
  }
  // 2. audit T-1: a dry quote signs no deposit address, so the core never pays on it, signed or not
  assert.equal(parseQuote({ status: "PENDING_DEPOSIT", quoteResponse: moveIn.response }, "e".repeat(64), ONE_CLICK_QUOTE_KEY, at), null);
  // 3. the move in is the fill's leg 1 as 1Click answers it: INTENTS, to the pocket and refunded to it privately, exact
  //    input, the same coin; it promises 99 % (slippage 100 bps), as the gate's fake models it
  const q1 = factsOf(moveIn.response);
  assert.deepEqual([q1.depositType, q1.recipientType, q1.refundType, q1.recipient, q1.refundTo], ["INTENTS", "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", pocket, pocket]);
  assert.equal(q1.minAmountOut, ((BigInt(q1.amountIn) * 99n) / 100n).toString());
  const fits = { tokenId: payout.response.quoteRequest.originAsset, amount: q1.minAmountOut };
  assert.equal(throughJoinRefusal(q1, pocket, fits, at), null, "the join takes it");
  // the recorded payout pays all 5 USDC, more than a 5 USDC move in promises: refused (the fill step brings more)
  assert.equal(throughJoinRefusal(q1, pocket, { tokenId: fits.tokenId, amount: payout.response.quote.amountIn }, at), "The move into your private balance may bring less than the payment needs. Nothing moved.");
  assert.equal(throughJoinRefusal(q1, "a".repeat(64), fits, at), "The price for the move into your private balance isn't the one asked for. Nothing moved.", "control: another pocket");
  assert.equal(throughJoinRefusal({ ...q1, depositType: "CONFIDENTIAL_INTENTS" }, pocket, fits, at), "The price for the move into your private balance isn't the one asked for. Nothing moved.", "control: not INTENTS or ORIGIN_CHAIN");
  // 4. the payout (leg 2) as 1Click answers it: from Private, refunded to the pocket, to the Solana payee; the sheet's
  //    fit (sendPayoutFits) on the real figures, and the payee pin's three fields
  const p = payout.response.quoteRequest;
  assert.deepEqual([p.depositType, p.refundType, p.refundTo, p.recipientType, p.swapType, p.recipient], ["CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS", pocket, "DESTINATION_CHAIN", "EXACT_INPUT", LIVE.madeUpAddresses.solanaRecipient]);
  const out = { recipient: p.recipient, recipientType: p.recipientType, originAsset: p.originAsset, destinationAsset: p.destinationAsset, amountIn: payout.response.quote.amountIn, amountOut: payout.response.quote.amountOut };
  assert.equal(sendPayoutFits({ ...out, amountIn: q1.minAmountOut }, q1), true, "within what the move in promises");
  assert.equal(sendPayoutFits(out, q1), false, "control: the whole 5 USDC is more than it promises");
  assert.equal(sendPayoutFits({ ...out, amountIn: q1.minAmountOut, originAsset: "nep141:wrap.near" }, q1), false, "control: another coin");
  // 5. the core's own leg 1 (privateQuoteIn, intents) asks 1Click for the very terms of the live answer
  const s = await setup();
  const leg1 = await s.w.privateQuoteIn(USDC, "5000000", false, true, true);
  const asked = s.quoted.get(leg1.depositAddress);
  const terms = ["swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundType", "recipientType", "confidentiality"];
  assert.deepEqual(Object.fromEntries(terms.map((k) => [k, asked[k]])), Object.fromEntries(terms.map((k) => [k, moveIn.request[k]])));
  assert.deepEqual([asked.recipient, asked.refundTo, asked.dry], [s.pocket, s.pocket, false], "to and back to its own pocket; a real quote");
});

test("T4 (the audit's c1/c3/R1, 6 Nov): leg 2 is held, unsigned, until the Safe's one signature of leg 1 checks; then released once, before anything is sent, with job.signed; a second redeem, another hash, a No or a foreign asker gets nothing signed (control: today's path signs leg 2 before the sheet)", async () => {
  const s = await setup();
  const { leg1, held } = await s.pairLegs();
  assert.ok("pair" in held && /^[0-9a-f]{64}$/.test(held.pair.hash), "held: its hash, no signature");
  assert.ok(!("signedData" in held));
  const out = await s.signer.request(s.fill(leg1.depositAddress, "300000000"));
  assert.equal(out.status, "done", JSON.stringify(out));
  // released: signed and kept in the core's sealed vault, never handed back to the app (the audit's MUST)
  assert.ok(!JSON.stringify(out).includes("signature"), `nothing of leg 2 comes back: ${JSON.stringify(out).slice(0, 300)}`);
  assert.ok(s.vault.writes.some((x) => x.name === "send-pair-kept"), "kept in the vault");
  assert.deepEqual(s.events, ["signed, 0 sent"], "job.signed once, before the network");
  assert.equal(s.shown.length, 1, "one sheet");
  assert.equal(await s.w.releasePair(leg1.depositAddress, (held as { pair: { hash: string } }).pair.hash), null, "redeemed once only");
  // another hash: nothing, and the pair is gone
  const h = await setup();
  const two = await h.pairLegs();
  assert.equal(await h.w.releasePair(two.leg1.depositAddress, "0".repeat(64)), null);
  assert.equal(await h.w.releasePair(two.leg1.depositAddress, (two.held as { pair: { hash: string } }).pair.hash), null, "dropped by the wrong ask");
  // Not now: nothing signed, the pair dropped, no job.signed
  const n = await setup({ no: true });
  const three = await n.pairLegs();
  assert.equal((await n.signer.request(n.fill(three.leg1.depositAddress, "300000000"))).status, "declined");
  assert.deepEqual([n.chain.sent.length, n.events.length], [0, 0]);
  assert.equal(await n.w.releasePair(three.leg1.depositAddress, (three.held as { pair: { hash: string } }).pair.hash), null, "Not now dropped it");
  // only Wallet's own Send asks a pair (the audit's c4)
  const { pairAsked } = await import("./send-words.ts");
  for (const [p, ok] of [[{ pair: true, app: "wallet" }, true], [{ pair: true, app: "agent" }, false], [{ pair: true, app: "browser" }, false], [{ pair: true, app: "social" }, false], [{ pair: true }, false], [{ pair: "true", app: "wallet" }, false]] as const) assert.equal(pairAsked(p), ok, JSON.stringify(p));
  // control: without the pair, leg 2 is signed at once, before any sheet
  const c = await setup();
  await c.legs();
  assert.equal(c.shown.length, 0);
});

const keptOf = async (v: MemoryVault): Promise<Record<string, { signed: unknown }>> => {
  const raw = await v.get("send-pair-kept");
  return raw ? JSON.parse(new TextDecoder().decode(raw)) : {};
};

test("T8 (the audit's MUST a, 6 Nov): leg 2, signed with leg 1's one Face ID, is kept in the core's sealed vault BEFORE leg 1 is sent; a killed app between leg 1 sent and the keep can't be, the keep is first (control: a No keeps nothing)", async () => {
  const s = await setup();
  const { leg1 } = await s.pairLegs();
  assert.equal((await s.signer.request(s.fill(leg1.depositAddress, "300000000"))).status, "done");
  const keep = s.vault.writes.find((x) => x.name === "send-pair-kept");
  assert.ok(keep, "kept in the sealed vault");
  assert.equal(keep.sent, 0, "kept while nothing had been sent");
  assert.equal(s.chain.sent.length, 1, "then leg 1 went, once");
  const kept = (await keptOf(s.vault))[leg1.depositAddress];
  assert.ok(kept && typeof (kept.signed as { signature?: unknown }).signature === "string", "the kept record is leg 2's signature");
  assert.equal(s.submitted.length, 0, "not handed to 1Click on its own");
  // control: Not now keeps nothing at all
  const n = await setup({ no: true });
  const two = await n.pairLegs();
  assert.equal((await n.signer.request(n.fill(two.leg1.depositAddress, "300000000"))).status, "declined");
  assert.deepEqual([n.vault.writes.filter((x) => x.name === "send-pair-kept").length, n.chain.sent.length], [0, 0]);
});

test("T9 (the audit's MUST b): the core hands leg 2 to 1Click only once leg 1 reads SUCCESS with at least leg 2's amount; a table over leg 1's status (control: SUCCESS with enough hands it, and again harmlessly)", async () => {
  const { leg1Landed } = await import("./send-words.ts");
  const rows: [Parameters<typeof leg1Landed>[0], boolean][] = [
    [null, false], [{ status: "PENDING_DEPOSIT" }, false], [{ status: "PROCESSING", swapDetails: { amountOut: "300000000" } }, false],
    [{ status: "REFUNDED", swapDetails: { amountOut: "300000000" } }, false], [{ status: "FAILED" }, false], [{ status: "SUCCESS" }, false],
    [{ status: "SUCCESS", swapDetails: { amountOut: "249999999" } }, false], [{ status: "SUCCESS", swapDetails: { amountOut: "x" } }, false],
    [{ status: "SUCCESS", swapDetails: { amountOut: "250000000" } }, true], [{ status: "SUCCESS", swapDetails: { amountOut: "297000000" } }, true],
  ];
  for (const [st, ok] of rows) assert.equal(leg1Landed(st, "250000000"), ok, JSON.stringify(st));
  let st = { status: "PENDING_DEPOSIT" } as { status: string; amountOut?: string };
  const s = await setup({ leg1Status: () => st });
  const { leg1 } = await s.pairLegs();
  assert.equal((await s.signer.request(s.fill(leg1.depositAddress, "300000000"))).status, "done");
  assert.deepEqual(await s.w.pairHand(leg1.depositAddress), { handed: false });
  st = { status: "SUCCESS", amountOut: "100" };
  assert.deepEqual(await s.w.pairHand(leg1.depositAddress), { handed: false }, "short: not handed");
  assert.equal(s.submitted.length, 0);
  st = { status: "SUCCESS", amountOut: "297000000" };
  assert.deepEqual(await s.w.pairHand(leg1.depositAddress), { handed: true });
  assert.equal(s.submitted.length, 1);
  assert.deepEqual(s.submitted[0], (await keptOf(s.vault))[leg1.depositAddress]!.signed, "the kept signature, as is");
});

test("T10 (the audit's MUST c): leg 2's kept signature is deleted when its job ends, and when leg 1 is refused before it went; a No, a refusal before the keep, or a dead pair keep nothing (control: kept until then)", async () => {
  // the job ends: deleted, and nothing can be handed after
  let st = { status: "PENDING_DEPOSIT" } as { status: string; amountOut?: string };
  const s = await setup({ leg1Status: () => st });
  const { leg1 } = await s.pairLegs();
  await s.signer.request(s.fill(leg1.depositAddress, "300000000"));
  st = { status: "SUCCESS", amountOut: "300000000" };
  assert.ok((await keptOf(s.vault))[leg1.depositAddress], "control: kept");
  await s.w.pairEnd(leg1.depositAddress);
  assert.equal((await keptOf(s.vault))[leg1.depositAddress], undefined);
  assert.deepEqual(await s.w.pairHand(leg1.depositAddress), { handed: false });
  assert.equal(s.submitted.length, 0);
  // leg 1 refused by the chain before it went (a named refusal): kept, then deleted, nothing sent
  const r = await setup();
  const two = await r.pairLegs();
  (r.chain as unknown as { send: unknown }).send = async () => { throw new ProblemError(securityProblems.sendUnbound()); };
  assert.equal((await r.signer.request(r.fill(two.leg1.depositAddress, "300000000"))).status, "problem");
  assert.ok(r.vault.writes.some((x) => x.name === "send-pair-kept"), "it was kept first");
  assert.equal((await keptOf(r.vault))[two.leg1.depositAddress], undefined, "and deleted on the refusal");
  // leg 1 maybe sent (no answer): kept, the follower decides by leg 1's own status
  const u = await setup();
  const three = await u.pairLegs();
  (u.chain as unknown as { send: unknown }).send = async () => { throw new Error("timeout"); };
  assert.equal((await u.signer.request(u.fill(three.leg1.depositAddress, "300000000"))).status, "problem");
  assert.ok((await keptOf(u.vault))[three.leg1.depositAddress], "kept: leg 1 may have gone");
  // a dead pair (another hash): nothing signed, nothing kept
  const d = await setup();
  const four = await d.pairLegs();
  assert.equal(await d.w.releasePair(four.leg1.depositAddress, "0".repeat(64)), null);
  assert.equal(d.vault.writes.filter((x) => x.name === "send-pair-kept").length, 0);
});

test("T11 (the audit's MUST d): killed after the keep, before leg 1 went: the restart never sends leg 1 again and never hands leg 2 without leg 1; once leg 1 lands, leg 2 goes once (control: the restart's core still has it)", async () => {
  let st = { status: "PENDING_DEPOSIT" } as { status: string; amountOut?: string };
  const s = await setup({ leg1Status: () => st });
  const { leg1 } = await s.pairLegs();
  // the kill: leg 1's send never comes back and never reaches the chain (the app died there)
  (s.chain as unknown as { send: unknown }).send = () => new Promise(() => {});
  void s.signer.request(s.fill(leg1.depositAddress, "300000000"));
  for (let i = 0; i < 200 && !s.vault.writes.some((x) => x.name === "send-pair-kept"); i++) await new Promise((r) => setTimeout(r, 1));
  assert.ok((await keptOf(s.vault))[leg1.depositAddress], "killed after the keep");
  assert.equal(s.chain.sent.length, 0, "before leg 1 went");
  // the restart: a new core on the same vault
  const again = s.restart();
  delete (s.chain as unknown as { send?: unknown }).send;
  // leg 2 is never handed while leg 1 hasn't landed
  assert.deepEqual(await again.w.pairHand(leg1.depositAddress), { handed: false });
  assert.equal(s.submitted.length, 0, "never leg 2 without leg 1");
  // the same leg 1 asked again after the restart: refused before any sheet, never sent twice (its payout record and its
  // pair died with the app; leg 1's address is marked paid)
  const out = await again.signer.request(s.fill(leg1.depositAddress, "300000000"));
  assert.notEqual(out.status, "done", JSON.stringify(out).slice(0, 200));
  assert.equal(s.chain.sent.length, 0, "leg 1 never sent: once or never, never twice");
  // and a second leg 2 for that leg 1 is never held again: the address is used
  // control: had leg 1 landed (sent by the app before it died), the restart's core hands leg 2, once per ask
  st = { status: "SUCCESS", amountOut: "297000000" };
  assert.deepEqual(await again.w.pairHand(leg1.depositAddress), { handed: true });
  assert.equal(s.submitted.length, 1);
});

// the audit's condition 1 on J2-2 (8 Nov): the Send's sheet rows changed as words only. The same Send through the real sign path
// sends the transaction 9b41a3dc0 sent (sha-256 of every field but the randomized signature, pinned from that commit), and
// the pair hash the sheet carries is leg 2's own payload hash, which no sheet word reaches.
test("the audit's condition 1 (J2-2): a Send's fill signs 9b41a3dc0's transaction and carries leg 2's own payload hash; only its sheet's words changed", async () => {
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const s = await setup({ seed: true });
  const { leg1, held, payload } = await s.pairLegs();
  assert.ok("pair" in held);
  assert.equal(held.pair.hash, hex(sha256(new TextEncoder().encode(JSON.stringify(payload)))), "the pair hash is leg 2's payload, nothing of the sheet");
  const out = await s.signer.request(s.fill(leg1.depositAddress, "300000000"));
  assert.equal(out.status, "done", JSON.stringify(out));
  const tx = hex(sha256(new TextEncoder().encode(JSON.stringify(s.chain.sent[0], (k, v) => (k === "signature" ? undefined : typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? hex(v) : v)))));
  if (process.env.ZF_PRINT_TX) console.log(`TX send ${tx}`);
  assert.equal(tx, SEND_TX_BEFORE, "the signed transaction is 9b41a3dc0's");
  assert.ok(s.shown[0]!.lines.includes("From your Safe · $300.00"), "the words did change: " + s.shown[0]!.lines.join(" | "));
});
const SEND_TX_BEFORE = "ede368d07ef0ce80cd80da20408a43aa153542b117ea9be276e975538cf79843";
