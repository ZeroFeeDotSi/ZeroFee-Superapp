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

// the audit's way-home audit M9 (7 Nov): pocket-moves added the service's raw text to the refusal ("NEAR Intents said no.
// Nothing moved. fetch failed"). Now: what failed by name first, where the money is, the next tap; the raw text on the
// error's cause only (for the log). Fails on main (the raw text on screen).
import { refusalFace } from "@zerofee/shell-api/refusal-face.ts";
import { HOME_REFUSED } from "./pocket-moves.ts";

const faceOf = (e: any) => refusalFace(e.problem)!;
const noMachine = (s: string) => !/fetch failed|HTTP \d|ECONN|socket|TypeError|undefined|null|[{}]|nep\d{3}:|0x[0-9a-f]/i.test(s);
/** every word the person can read on it: never the generic "This wallet can't approve this" / "in that wallet" */
const shown = (p: any): string[] => [p.whatHappened, "where" in p.money ? p.money.where : "", p.more ?? "", p.next.label];

test("M9: the relay's fetch throws: \"NEAR Intents didn't answer.\", the money in Private, try again; the raw text only on the cause", async () => {
  const { moves, r } = setup();
  r.quote = async () => { throw new TypeError("fetch failed"); };
  const e: any = await moves.home(USDC, "1000000", key(1)).catch((x) => x);
  assert.equal(e.problem.code, "security.subwallet.refused");
  assert.equal(e.problem.more, "NEAR Intents didn't answer. Your money is still in Private. Try again in a minute.");
  assert.deepEqual(faceOf(e), { head: "NEAR Intents didn't answer.", body: "Your money is still in Private. Try again in a minute." });
  for (const w of shown(e.problem)) assert.ok(noMachine(w) && !/can't approve this|that wallet/.test(w), w);
  assert.equal(e.cause?.message, "fetch failed", "kept for the log");
  assert.deepEqual([e.problem.whatHappened, e.problem.money], ["NEAR Intents didn't answer.", { state: "safe", where: "in Private" }]);
});

test("M9: 1Click's own no (a 4xx through the relay, its message machine text): \"NEAR Intents said no.\", never its message", async () => {
  const { moves, r } = setup();
  r.generateIntent = async () => { throw Object.assign(new Error("HTTP 400 {\"code\":\"bad\",\"detail\":\"nep141:x undefined\"}"), { refused: true }); };
  const e: any = await moves.home(USDC, "1000000", key(2)).catch((x) => x);
  assert.equal(faceOf(e).head, HOME_REFUSED.said);
  assert.equal(faceOf(e).body, HOME_REFUSED.still);
  for (const w of shown(e.problem)) assert.ok(noMachine(w) && !/can't approve this|that wallet/.test(w), w);
});

test("M9: submit refused after signing: \"NEAR Intents didn't take it.\", Activity for where the money is, never the service's text", async () => {
  const { moves } = setup({ submit: async () => { throw Object.assign(new Error("HTTP 409 intent nonce used 0xdeadbeef"), { refused: true }); } });
  const e: any = await moves.home(USDC, "1000000", key(3)).catch((x) => x);
  assert.equal(e.problem.more, "NEAR Intents didn't take it. Check Activity for where your money is.");
  for (const w of shown(e.problem)) assert.ok(noMachine(w) && !/can't approve this|that wallet/.test(w), w);
  assert.equal(e.problem.money.state, "unsure", "after the signature: never said to be in Private for sure");
});

test("M9: a price that fails ZeroFee's check says so by name, then where the money is (control: the check's own reason only on the cause)", async () => {
  const { moves } = setup({ lie: (req) => ({ ...req, destinationAsset: WNEAR }) });
  const e: any = await moves.home(USDC, "1000000", key(4)).catch((x) => x);
  assert.equal(faceOf(e).head, "ZeroFee stopped it: NEAR Intents' price wasn't the one it asked for.");
  assert.equal(faceOf(e).body, HOME_REFUSED.still);
  assert.equal(e.cause, "It doesn't deliver the same coin.");
  // every head names who, every refusal line has no machine text
  for (const w of Object.values(HOME_REFUSED)) { assert.match(w, /NEAR Intents|Private/); assert.ok(noMachine(w)); }
});
