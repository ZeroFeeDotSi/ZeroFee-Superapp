// The private pocket's way out (pocket-moves.ts): home to the main balance, as the core asks for it itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { FloatRelay } from "./float-moves.ts";
import { PocketMoves } from "./pocket-moves.ts";
import { nep413Hash } from "./private-pocket.ts";
import { base64, fromBase58 } from "./sol/bytes.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const MAIN = "kim.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const SECRET = new Uint8Array(32).fill(9);
const POCKET = Buffer.from(ed25519.getPublicKey(SECRET)).toString("hex");
const key = (n: number) => `pocket-home-${String(n).padStart(4, "0")}`;

/** ZeroFee's relay in front of 1Click, as the float's tests have it: `lie` changes what 1Click signed. */
function relay(o: { lie?: (req: any) => any; minOut?: (req: any) => string; submit?: () => Promise<unknown> } = {}) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; deadline: string }>();
  let state = "PENDING_DEPOSIT";
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const depositAddress = (asked.length.toString(16) + "c".repeat(64)).slice(0, 64);
      const deadline = new Date(Date.now() + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, deadline });
      return { quote: { depositAddress, amountIn: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), o.submit ? o.submit() : { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.lie ? o.lie(q.req) : q.req;
      const minAmountOut = o.minOut?.(req) ?? String((BigInt(req.amount) * 99n) / 100n);
      return { status: state, quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: q.req.amount, minAmountOut, deadline: q.deadline } }) };
    },
  };
  return { r, asked, submitted, set: (s: string) => (state = s) };
}

function setup(o: Parameters<typeof relay>[0] = {}) {
  const fake = relay(o);
  const moves = new PocketMoves({
    vault: new MemoryVault(),
    relay: fake.r,
    quoteKey: TEST_QUOTE_KEY,
    pocket: async () => ({ address: POCKET, secret: async () => SECRET.slice() }),
    mainAccount: async () => MAIN,
    balances: async () => [{ tokenId: USDC, amount: "42000000" }, { tokenId: WNEAR, amount: "0" }],
  });
  return { moves, ...fake };
}

test("home: the core asks for the quote itself, the pocket's coin to the same coin in the main balance; signs as the pocket and sends it", async () => {
  const { moves, asked, submitted, set } = setup();
  const m = await moves.home(USDC, "all", key(1));
  const req = asked[0];
  assert.deepEqual(
    [req.originAsset, req.destinationAsset, req.amount, req.depositType, req.swapType, req.confidentiality],
    [USDC, USDC, "42000000", "CONFIDENTIAL_INTENTS", "EXACT_INPUT", "basic"],
    '"all" is what 1Click holds in the pocket',
  );
  assert.deepEqual([req.recipient, req.recipientType, req.refundTo, req.refundType], [MAIN, "INTENTS", POCKET, "CONFIDENTIAL_INTENTS"]);
  assert.equal(submitted.length, 1);
  const s = submitted[0];
  assert.equal(s.public_key, `ed25519:${(await import("./sol/bytes.ts")).base58(ed25519.getPublicKey(SECRET))}`);
  assert.ok(ed25519.verify(fromBase58(s.signature.slice(8)), nep413Hash(s.payload), ed25519.getPublicKey(SECRET)), "the pocket's own signature over exactly that transfer");
  assert.deepEqual([m.status, m.where, m.sent.amount, m.expected.amount], ["pending", "in-flight", "42000000", "41160000"]);
  set("SUCCESS");
  assert.deepEqual(await moves.move(m.id).then((x) => [x.status, x.where]), ["done", "main"]);
  assert.equal((await moves.moves()).length, 1);
});

test("home: the same key gives the same move; a key reused for another move, a bad coin or amount, and none of the coin are refused", async () => {
  const { moves, asked } = setup();
  const a = await moves.home(USDC, "1000000", key(2));
  assert.deepEqual(await moves.home(USDC, "1000000", key(2)), a);
  assert.equal(asked.length, 1, "asked once");
  const code = (e: any) => e.problem.code;
  await assert.rejects(moves.home(USDC, "2000000", key(2)), (e) => code(e) === "security.request.invalid");
  await assert.rejects(moves.home("wrap.near", "1", key(3)), (e) => code(e) === "security.request.invalid");
  await assert.rejects(moves.home(USDC, "1.5", key(3)), (e) => code(e) === "security.request.invalid");
  await assert.rejects(moves.home(USDC, "1", "short"), (e) => code(e) === "security.request.invalid");
  await assert.rejects(moves.home(WNEAR, "all", key(4)), (e) => code(e) === "security.request.invalid", "none of it in the pocket");
});

test("home: a quote that isn't the one asked for is never signed", async () => {
  const cases: [string, Parameters<typeof relay>[0]][] = [
    ["pays someone else", { lie: (q) => ({ ...q, recipient: "thief.near" }) }],
    ["pays a chain address", { lie: (q) => ({ ...q, recipientType: "DESTINATION_CHAIN" }) }],
    ["another coin", { lie: (q) => ({ ...q, destinationAsset: "nep141:eth.omft.near" }) }],
    ["refunds elsewhere", { lie: (q) => ({ ...q, refundTo: "e".repeat(64) }) }],
    ["paid from somewhere else", { lie: (q) => ({ ...q, depositType: "INTENTS" }) }],
    ["promises too little", { minOut: (q) => String((BigInt(q.amount) * 97n) / 100n) }],
  ];
  for (const [what, o] of cases) {
    const { moves, submitted } = setup(o);
    await assert.rejects(moves.home(USDC, "1000000", key(5)), (e: any) => e.problem.code === "security.subwallet.refused", what);
    assert.equal(submitted.length, 0, `${what}: nothing sent`);
    const [m] = await moves.moves();
    assert.deepEqual([m.status, m.where], ["failed", "pocket"], what);
  }
});

test("home: with no answer the signed move stays pending and asking where it is sends it again; 1Click's own no ends it", async () => {
  let fail = true;
  const quiet = setup({ submit: async () => { if (fail) throw new Error("timeout"); return { intentHash: "h" }; } });
  const m = await quiet.moves.home(USDC, "1000000", key(6));
  assert.deepEqual([m.status, m.where], ["pending", "pocket"]);
  fail = false;
  assert.equal((await quiet.moves.move(m.id)).where, "in-flight");
  assert.equal(quiet.submitted.length, 2, "the same signed transfer, once more");

  const no = setup({ submit: async () => { throw Object.assign(new Error("bad intent"), { refused: true }); } });
  await assert.rejects(no.moves.home(USDC, "1000000", key(7)), (e: any) => e.problem.code === "security.subwallet.refused");
  const [ended] = await no.moves.moves();
  assert.deepEqual([ended.status, ended.where], ["failed", "pocket"]);
});

test("QA (3 Nov): Hidden's move home is held to 98 %, exactly the floor Move's sheet reads (float-floors.ts): 1Click's signed promise at 98 % is signed, a unit under it never (so the sheet says \"At least\", never \"whole\")", async () => {
  const { POCKET_HOME_LEAST_PERCENT } = await import("./float-floors.ts");
  assert.equal(POCKET_HOME_LEAST_PERCENT, 98n);
  const at = (o: Parameters<typeof relay>[0]) => setup(o);
  const ok = at({ minOut: (q) => String((BigInt(q.amount) * POCKET_HOME_LEAST_PERCENT) / 100n) });
  const m = await ok.moves.home(USDC, "1000000", key(7));
  assert.equal(ok.submitted.length, 1, "1Click's promise of exactly 98 % is signed");
  assert.equal(m.expected.amount, "980000", "the move expects the floor");
  const short = at({ minOut: (q) => String((BigInt(q.amount) * POCKET_HOME_LEAST_PERCENT) / 100n - 1n) });
  await assert.rejects(short.moves.home(USDC, "1000000", key(8)), (e: any) => e.problem.code === "security.subwallet.refused");
  assert.equal(short.submitted.length, 0, "control: one unit under the floor is never signed");
});
