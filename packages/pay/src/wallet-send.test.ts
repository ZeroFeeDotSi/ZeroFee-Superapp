// The public release's Send, which lives in Wallet (shell-api/release.ts, wallet/app/screens/SendOut.tsx): the same
// PayFlow against Wallet's real ledger service, on mainnet, and every transaction it signs read back by Security's real
// decoder (DevSigner.describe), so the approval sheet says what really leaves: to a NEAR account inside the ledger, and
// out to an address on its own chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeBridge } from "@zerofee/core/bridge";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import { INTENTS } from "@zerofee/core/intents";
import type { PlainWords, TxRequest } from "@zerofee/core/signer";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { privateOpen } from "@zerofee/shell-api/release.ts";
import { createApis } from "@zerofee/wallet/apis.ts";
import { createLedgerService } from "@zerofee/wallet/ledger.ts";
import { fakeCore, fakeNear, replayFetch } from "@zerofee/wallet/testing/replay.ts";
import { MAYBE_SENT_MS, PayFlow, type Step } from "./pay.ts";
import { findRecipient, targetForSend } from "./send.ts";

const ME = "kid.near";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SOL_ADDRESS = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const NEAR = 10n ** 24n;
const kind = <K extends Step["kind"]>(s: Step, k: K) => {
  assert.equal(s.kind, k, JSON.stringify(s));
  return s as Extract<Step, { kind: K }>;
};

function setup() {
  const core = fakeCore({ accountId: ME });
  const chain = fakeNear(ME, { nearYocto: NEAR, ledger: { [USDC_SOL]: "200000000" } }, { "bob.near": { nearYocto: NEAR } });
  const ledger = createLedgerService({ bridge: core, chain, apis: createApis(replayFetch()), readCall: async () => ({ kind: "kept", units: 0n }) });
  return { core, flow: new PayFlow({ bridge: routeBridge(core, { ledger }) }) };
}

/** Security's decoder on a fake mainnet: what the approval sheet would say for these bytes. */
function sheet() {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund(ME, key.publicKey);
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, { mt_balance_of: () => (10n ** 27n).toString() });
  chain.contract(USDC_SOL.slice("nep141:".length), "code", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const signer = new DevSigner({ accountId: ME, chain, key, approve: async () => false, oneClick: async () => null, knownRecipients: new Set(["bob.near"]) });
  return (r: TxRequest): Promise<PlainWords> => signer.describe(r);
}
const all = (w: PlainWords) => [w.title, ...w.lines].join(" | ");

test("PS-1: after an uncertain send, Try again (or the same Send again) never submits it twice: it says Check Activity, with the link", async () => {
  // The core handed it to the network but no two nodes confirmed it: "sent, not confirmed yet", with the hash's link.
  const unconfirmed = { code: "security.send.unconfirmed", whatHappened: "We sent it, but the network hasn't confirmed it yet.", money: { state: "on-the-way", where: "on the NEAR network" }, next: { kind: "wait", label: "Wait a moment" }, more: "Follow it here: https://nearblocks.io/txns/abc" } as const;
  const core = fakeCore({ accountId: ME, sign: unconfirmed });
  const chain = fakeNear(ME, { nearYocto: NEAR, ledger: { [USDC_SOL]: "200000000" } }, { "bob.near": { nearYocto: NEAR } });
  const ledger = createLedgerService({ bridge: core, chain, apis: createApis(replayFetch()), readCall: async () => ({ kind: "kept", units: 0n }) });
  let now = Date.UTC(2026, 9, 29, 6);
  const flow = new PayFlow({ bridge: routeBridge(core, { ledger }), now: () => now });
  await flow.warm();
  let asked = 0;
  const realCall = core.call.bind(core);
  core.call = (async (method: string, p?: Record<string, unknown>) => (method === "tx.request" && asked++, realCall(method, p))) as typeof core.call;
  const target = () => {
    const t = targetForSend({ kind: "ledger", accountId: "bob.near" }, flow.tokens!.byAsset(USDC_SOL)!, "25", flow.tokens!);
    assert.ok("ok" in t);
    return t.ok;
  };
  const first = kind(await flow.sendAtOnce(target(), USDC_SOL), "problem");
  assert.equal(first.problem.code, "security.send.unconfirmed");
  assert.equal(asked, 1);
  // Try again: the retry is the same Send (SendOut's last action) or Confirm's Pay: neither reaches the core again.
  const again = kind(await flow.sendAtOnce(target(), USDC_SOL), "problem");
  assert.equal(again.problem.code, "pay.send.maybe-sent");
  assert.deepEqual(again.problem.next, { kind: "open", label: "Check Activity", screen: "activity" });
  assert.match(again.problem.more ?? "", /https:\/\/nearblocks\.io\/txns\/abc/);
  assert.equal(kind(await flow.confirm(), "problem").problem.code, "pay.send.maybe-sent");
  assert.equal(asked, 1, "the core was asked to sign once");
  // Another payment (another amount) isn't held back; and the same one may go again after the window.
  const other = targetForSend({ kind: "ledger", accountId: "bob.near" }, flow.tokens!.byAsset(USDC_SOL)!, "26", flow.tokens!);
  assert.ok("ok" in other);
  await flow.sendAtOnce(other.ok, USDC_SOL);
  assert.equal(asked, 2);
  now += MAYBE_SENT_MS + 1;
  await flow.sendAtOnce(target(), USDC_SOL);
  assert.equal(asked, 3);
});

test("PS-1: a 'no' on the sheet sent nothing, so Try again asks again", async () => {
  const core = fakeCore({ accountId: ME, sign: "declined" });
  const chain = fakeNear(ME, { nearYocto: NEAR, ledger: { [USDC_SOL]: "200000000" } }, { "bob.near": { nearYocto: NEAR } });
  const ledger = createLedgerService({ bridge: core, chain, apis: createApis(replayFetch()), readCall: async () => ({ kind: "kept", units: 0n }) });
  const flow = new PayFlow({ bridge: routeBridge(core, { ledger }) });
  await flow.warm();
  const t = targetForSend({ kind: "ledger", accountId: "bob.near" }, flow.tokens!.byAsset(USDC_SOL)!, "25", flow.tokens!);
  assert.ok("ok" in t);
  const step = await flow.sendAtOnce(t.ok, USDC_SOL);
  assert.notEqual(step.kind === "problem" ? step.problem.code : step.kind, "pay.send.maybe-sent");
  const retry = await flow.confirm();
  assert.ok(!(retry.kind === "problem" && retry.problem.code === "pay.send.maybe-sent"), JSON.stringify(retry));
});

test("the release: Private is open (P-1 is a words problem); only the free build, with no partner key, has none", () => {
  assert.equal(privateOpen(false), true, "the release, its Sim and its extension alike");
  assert.equal(privateOpen(true), false, "the free build");
});

test("Send to a NEAR account in Wallet: one transfer inside NEAR Intents, and the sheet says who gets how much", async () => {
  const { core, flow } = setup();
  await flow.warm();
  const t = targetForSend({ kind: "ledger", accountId: "bob.near" }, flow.tokens!.byAsset(USDC_SOL)!, "25", flow.tokens!);
  assert.ok("ok" in t);
  const step = await flow.sendAtOnce(t.ok, USDC_SOL);
  assert.ok(["paid", "sent"].includes(step.kind), JSON.stringify(step));
  const tx = core.signed[0]!;
  assert.equal(tx.receiverId, "intents.near");
  const a = tx.actions[0] as { kind: "call"; method: string; args: Record<string, unknown> };
  assert.equal(a.method, "mt_transfer");
  assert.deepEqual([a.args.receiver_id, a.args.token_id, a.args.amount], ["bob.near", USDC_SOL, "25000000"]);
  const words = await sheet()(tx);
  assert.match(words.title, /Send 25 USDC to bob\.near/, all(words));
});

/** What Wallet's Send screen does (SendOut.tsx): the coin from the balance row, the receiver from findRecipient. */
async function sendRow(flow: PayFlow, bridge: Parameters<typeof findRecipient>[0], to: string, amount: string): Promise<Step> {
  await flow.warm();
  const found = await findRecipient(bridge, to);
  assert.ok("ok" in found, JSON.stringify(found));
  const coin = flow.tokens!.byAsset("near");
  assert.ok(coin, "the NEAR row has a coin to send");
  const t = targetForSend(found.ok.recipient, coin, amount, flow.tokens!);
  assert.ok("ok" in t, JSON.stringify(t));
  return flow.sendAtOnce(t.ok, "near");
}

test("grade 01c P2: the NEAR row sends plain NEAR from the account to a NEAR account (mainnet)", async () => {
  const core = fakeCore({ accountId: ME });
  const chain = fakeNear(ME, { nearYocto: 2n * NEAR }, { "bob.near": { nearYocto: NEAR } });
  const ledger = createLedgerService({ bridge: core, chain, apis: createApis(replayFetch()), readCall: async () => ({ kind: "kept", units: 0n }) });
  const bridge = routeBridge(core, { ledger });
  const step = await sendRow(new PayFlow({ bridge }), bridge, "bob.near", "0.5");
  assert.ok(["paid", "sent"].includes(step.kind), JSON.stringify(step));
  assert.equal(core.signed.length, 1);
  assert.equal(core.signed[0]!.receiverId, "bob.near");
  assert.deepEqual(core.signed[0]!.actions, [{ kind: "transfer", yocto: (NEAR / 2n).toString() }]);
});

test("grade 01c P2: a test account's Send finishes on testnet: the receiver is found there and test NEAR goes to it", async () => {
  const testChain = new FakeChain("testnet");
  testChain.fund("zf-1.testnet", "ed25519:11111111111111111111111111111111", 0n);
  testChain.accounts.get("zf-1.testnet")!.balance = 10n * NEAR;
  testChain.fund("guest-book.testnet", "ed25519:22222222222222222222222222222222", 0n);
  const core = fakeCore({ accountId: "zf-1.testnet", network: "testnet" });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, {}), testChain, apis: createApis(replayFetch()), readCall: async () => ({ kind: "kept", units: 0n }) });
  const bridge = routeBridge(core, { ledger });
  const step = await sendRow(new PayFlow({ bridge }), bridge, "guest-book.testnet", "0.01");
  assert.ok(["paid", "sent"].includes(step.kind), JSON.stringify(step));
  assert.equal(core.signed[0]!.receiverId, "guest-book.testnet");
  assert.deepEqual(core.signed[0]!.actions, [{ kind: "transfer", yocto: (NEAR / 100n).toString() }]);
});

test("Send to a Solana address in Wallet: a withdraw out of NEAR Intents to that address, decoded in full on the sheet", async () => {
  const { core, flow } = setup();
  await flow.warm();
  const t = targetForSend({ kind: "address", chain: "sol", candidates: ["sol"], address: SOL_ADDRESS }, flow.tokens!.byAsset(USDC_SOL)!, "10", flow.tokens!);
  assert.ok("ok" in t);
  const step = await flow.sendAtOnce(t.ok, USDC_SOL);
  assert.ok(["paid", "sent", "confirm"].includes(step.kind), JSON.stringify(step));
  if (step.kind === "confirm") kind(await flow.confirm(), "sent");
  const tx = core.signed[0]!;
  assert.equal(tx.receiverId, "intents.near");
  const words = await sheet()(tx);
  assert.match(words.title, /Send [\d.]+ USDC to .* on Solana/, all(words));
  assert.ok(words.lines.some((l) => l.includes(SOL_ADDRESS)), "the full address is on the sheet");
});
