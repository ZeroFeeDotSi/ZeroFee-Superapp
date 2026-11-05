// Audit (core integrity, finding 2): a coin put into NEAR Intents (ft_transfer_call to intents.near) is credited to the
// account its msg names. A JSON msg ({"receiver_id": …}) credited someone else with no first-time warning and its raw
// JSON on the sheet. Now: the account it credits is the recipient, said in plain words; a msg ZeroFee can't read is
// refused before the sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS } from "./intents.ts";
import type { OneClickLookup } from "./intents.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NOTHING: OneClickLookup = async () => null;

function setup() {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: () => "0" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const shown: PlainWords[] = [];
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async (w) => (shown.push(w), true), oneClick: NOTHING });
  return { chain, signer, shown };
}

const deposit = (msg: unknown): TxRequest => ({
  receiverId: USDC,
  actions: [{ kind: "call", method: "ft_transfer_call", args: { receiver_id: "intents.near", amount: "5000000", msg }, depositYocto: "1", gas: "100000000000000" }],
  why: "",
  from: "wallet",
});
const firstTime = (w: PlainWords) => w.warnings.filter((x) => x.kind === "first-time-recipient").map((x) => x.text);
const all = (w: PlainWords) => [w.title, ...w.lines].join(" | ");

test("a deposit whose JSON msg credits another account names that account and warns the first time", async () => {
  const { signer } = setup();
  const words = await signer.describe(deposit(JSON.stringify({ receiver_id: "mallory.near" })));
  assert.deepEqual(firstTime(words), ["You haven't sent to mallory.near from this device before."]);
  assert.match(all(words), /Only mallory\.near can take it out\./);
  assert.doesNotMatch(all(words), /receiver_id|\{/, "no raw JSON on the sheet");
  // a plain account in the msg is said the same way
  const plain = await signer.describe(deposit("bob.near"));
  assert.deepEqual(firstTime(plain), ["You haven't sent to bob.near from this device before."]);
  assert.match(all(plain), /Only bob\.near can take it out\./);
});

test("a deposit msg ZeroFee can't read is refused before the sheet: broken JSON, intents to run, no one named", async () => {
  for (const msg of ["{not json", JSON.stringify({ receiver_id: "mallory.near", execute_intents: [{ intent: "transfer" }] }), JSON.stringify({ refund_if_fails: true }), JSON.stringify({ receiver_id: "Not An Account!" }), "Not An Account!"]) {
    const { signer, chain, shown } = setup();
    const out = await signer.request(deposit(msg));
    assert.equal(out.status, "problem", msg);
    assert.equal(out.status === "problem" && out.problem.code, "security.request.not-allowed", msg);
    assert.equal(shown.length, 0, `${msg}: no sheet`);
    assert.equal(chain.sent.length, 0, `${msg}: nothing sent`);
  }
});

test("controls: an empty msg or one naming this account puts the coin into the Safe, no first-time warning", async () => {
  const { signer } = setup();
  for (const msg of ["", JSON.stringify({ receiver_id: "alice.near" }), JSON.stringify({ receiver_id: "alice.near", refund_if_fails: true, execute_intents: [] })]) {
    const words = await signer.describe(deposit(msg));
    assert.deepEqual(firstTime(words), [], msg);
    assert.match(words.title, /into your Safe/, msg);
  }
});
