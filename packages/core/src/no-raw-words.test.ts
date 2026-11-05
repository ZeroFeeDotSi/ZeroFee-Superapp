// Machine text never reaches the person (mainnet rehearsal on the real core, 3 Nov): the approval sheet named a move from
// the Safe "Let <64-hex> hold USDC… so 17208628…33a1 can hold it", and Activity said "Used aaaaaa20…factory.bridge.near,
// paying 0.000000000000000000000001 NEAR". A sweep over the sheets and rows those came from: no 64-hex id, no NEAR
// service contract's id, no coin figure past 4 decimals on a title, a line or a row. Each sweep has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { TRADING_BALANCE } from "./intents.ts";
import { activityItem } from "./activity.ts";
import { coinShort } from "./coin-short.ts";
import type { PastTx } from "./chain.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { rawInSheet, rawText } from "./testing/no-raw.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const FLOAT = "5f".repeat(32);
const STRANGER = "2566".padEnd(64, "c");
const BRIDGED = "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near";

function setup() {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", "intents", {});
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }), ft_balance_of: () => "50000000" });
  const shown: PlainWords[] = [];
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async (w) => (shown.push(w), true), oneClick: async () => null, quoteKey: TEST_QUOTE_KEY, ownWallets: async () => new Map([[FLOAT, TRADING_BALANCE]]) });
  return { signer };
}
const call = (receiverId: string, method: string, args: Record<string, unknown>, depositYocto = "0"): TxRequest => ({ receiverId, actions: [{ kind: "call", method, args, depositYocto, gas: "30000000000000" }], why: "", from: "wallet" });

test("the sweep catches what the rehearsal saw (control: each old line is flagged; plain words pass)", () => {
  for (const old of [
    `Let ${FLOAT} hold USDC`,
    `Pays 0.00125 NEAR so ${USDC.slice(0, 8)}…${USDC.slice(-4)} can hold it. That comes back later.`,
    `Pays 0.0013 NEAR so ${USDC} can hold it.`,
    "Send 0.127781877210164154267814 wNEAR privately from your SOL wallet",
    "0.000195863293784041 ETH (RH) leaves your ETH (RH) wallet",
    `Used ${BRIDGED}, paying 0.000000000000000000000001 NEAR`,
    `Sent 0.2939 NEAR · with ${STRANGER}`,
  ]) assert.ok(rawText(old).length > 0, old);
  for (const plain of ["Let your NEAR wallet hold USDC", "It costs 0.0013 NEAR, and that comes back later.", "Send about $0.57 (0.1278 wNEAR) privately", "Moved a bridged coin", "Sent 0.2939 NEAR · with the address you gave", "$1,234.56 came in"]) assert.deepEqual(rawText(plain), [], plain);
});

test("a move from the Safe: its storage step names the NEAR wallet and USDC, never their ids, at most 4 decimals; a NEAR account with no name is shortened, its whole id one tap away", async () => {
  const { signer } = setup();
  const own = await signer.describe(call(USDC, "storage_deposit", { account_id: FLOAT, registration_only: true }, "1250000000000000000000"));
  assert.equal(own.title, "Let your NEAR wallet hold USDC");
  assert.ok(own.lines.includes("It costs 0.0013 NEAR, and that comes back later."), JSON.stringify(own.lines));
  assert.deepEqual(rawInSheet(own), []);
  const other = await signer.describe(call(USDC, "storage_deposit", { account_id: STRANGER, registration_only: true }, "1250000000000000000000"));
  assert.equal(other.title, "Let the NEAR account 2566cc…cccc hold USDC");
  assert.deepEqual(rawInSheet(other), []);
  assert.ok(other.details?.some((d) => d.lines.includes(STRANGER)), "the whole id in the disclosure");
  const send = await signer.describe(call(USDC, "ft_transfer", { receiver_id: FLOAT, amount: "1000000" }, "1"));
  assert.equal(send.title, "Send 1 USDC to your NEAR wallet");
  assert.deepEqual(rawInSheet(send), []);
});

test("Activity's rows: a coin's contract and NEAR Intents by name, no one-yocto 'paying', a NEAR account with no name said as one, NEAR at most 4 places (control: the words before were flagged)", () => {
  const past = (receiverId: string, action: object): PastTx => ({ hash: "h", atIso: "2026-11-03T10:00:00.000Z", signerId: "alice.near", signerKey: "ed25519:11111111111111111111111111111111", receiverId, actions: [action as never], ok: true });
  const callOf = (method: string, depositYocto: bigint) => ({ kind: "call", method, args: new Uint8Array(), gas: 0n, depositYocto });
  const rows = [
    activityItem(past(BRIDGED, callOf("ft_transfer_call", 1n)), [], "", "mainnet"),
    activityItem(past(USDC, callOf("storage_deposit", 1_250_000_000_000_000_000_000n)), [], "", "mainnet"),
    activityItem(past("intents.near", callOf("mt_transfer", 1n)), [], "", "mainnet"),
    activityItem(past(STRANGER, { kind: "transfer", yocto: 293_912_345_678_000_000_000_000n }), [], "", "mainnet"),
    activityItem(past("app.ref-finance.near", callOf("swap", 2_000_000_000_000_000_000_000n)), [], "", "mainnet"),
  ];
  assert.deepEqual(rows.map((r) => r.title), [
    "Moved a bridged coin",
    "Set up USDC on your account",
    "Moved money in your Safe",
    "Sent 0.294 NEAR to a NEAR account",
    "Used app.ref-finance.near, paying 0.002 NEAR",
  ]);
  assert.deepEqual(rows.flatMap((r) => [r.title, ...r.lines]).flatMap(rawText), []);
  assert.equal(rows[3]!.sent?.near, "0.293912345678", "the exact figure stays on the record (Wallet's own rows read it)");
  assert.equal(coinShort(1n, 24, "up").text, "under 0.0001", "control: a yocto is never a figure on a row");
});
