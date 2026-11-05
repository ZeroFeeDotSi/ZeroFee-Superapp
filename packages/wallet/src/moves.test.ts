// The ledger's transactions, run through Security's real pipeline (DevSigner: build → decode → words) on a fake mainnet,
// to prove each one gets the approval sheet's clear words, not the "unknown" fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import { INTENTS } from "@zerofee/core/intents";
import type { PlainWords, TxRequest } from "@zerofee/core/signer";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { mtTransfer, mtTransferCall, nearIntoLedger, registerOn, withdrawHome, withdrawToNear, WRAP_STORAGE_YOCTO } from "./moves.ts";

const ME = "kid.near";
const USDC_SOL = "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";

function sheet() {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund(ME, key.publicKey);
  chain.contract(INTENTS.account, INTENTS.codeHashBase58, {
    mt_balance_of: () => (10n ** 27n).toString(),
  });
  chain.contract(USDC_SOL, "code", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract("wrap.near", "code", { ft_metadata: () => ({ symbol: "wNEAR", decimals: 24 }) });
  const signer = new DevSigner({ accountId: ME, chain, key, approve: async () => false, oneClick: async () => null, knownRecipients: new Set(["bob.near"]) });
  return (r: TxRequest): Promise<PlainWords> => signer.describe(r);
}

const all = (w: PlainWords) => [w.title, ...w.lines, ...w.warnings.map((x) => x.text)].join(" | ");

test("a home withdraw reads as a withdraw to that address on that chain", async () => {
  const words = await sheet()(withdrawHome({ contract: USDC_SOL, address: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", units: 1_030_000n, why: "test" }));
  assert.match(words.title, /Send 1\.03 USDC to .* on Solana/, all(words));
  assert.ok(words.lines.some((l) => l.includes("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK")), "the full address is on a line");
  assert.ok(!words.warnings.some((w) => w.kind === "unknown-contract"), all(words));
});

test("a destination tag goes into the memo after the address", async () => {
  const r = withdrawHome({ contract: "xrp.omft.near", address: "rU5kdnTYveMv5yTSizKHdgYhzDrwUednbu", tag: "12345", units: 1n, why: "t" });
  assert.equal((r.actions[0] as { args: { memo: string } }).args.memo, "WITHDRAW_TO:rU5kdnTYveMv5yTSizKHdgYhzDrwUednbu:12345");
  assert.throws(() => withdrawHome({ contract: "v2_1.omni.hot.tg", address: "x", units: 1n, why: "t" }), /isn't a bridged coin/);
});

test("a move inside the ledger reads as a send to that account inside NEAR Intents", async () => {
  const words = await sheet()(mtTransfer({ to: "bob.near", tokenId: `nep141:${USDC_SOL}`, units: 12_500_000n, memo: "split 2/4", why: "t" }));
  assert.match(words.title, /Send 12\.5 USDC to bob\.near/, all(words));
  assert.match(all(words), /from your Safe/);
});

test("a transfer the receiver acts on carries the memo and the msg exactly, and the sheet says it asks the receiver", async () => {
  const r = mtTransferCall({ to: "bob.near", tokenId: `nep141:${USDC_SOL}`, units: 30_000_000n, memo: "Dinner", msg: '{"bill":"3"}', why: "t" });
  const a = r.actions[0] as { method: string; args: Record<string, unknown>; depositYocto: string };
  assert.deepEqual([r.receiverId, a.method, a.depositYocto], [INTENTS.account, "mt_transfer_call", "1"]);
  assert.deepEqual(a.args, { receiver_id: "bob.near", token_id: `nep141:${USDC_SOL}`, amount: "30000000", approval: null, memo: "Dinner", msg: '{"bill":"3"}' });
  const words = await sheet()(r);
  assert.match(words.title, /Send 30 USDC to bob\.near/, all(words));
  assert.match(all(words), /act on it/);
});

test("a withdraw to a NEAR account says where it goes, with no refund warning (no msg)", async () => {
  const words = await sheet()(withdrawToNear({ contract: "wrap.near", receiverId: "bob.near", units: 5n * 10n ** 22n, why: "t" }));
  assert.match(words.title, /^Move .* to bob\.near$/, all(words));
  assert.doesNotMatch(all(words), /won't come back/i);
});

test("putting NEAR into the ledger and paying a contract's storage both decode", async () => {
  const describe = sheet();
  const into = await describe(nearIntoLedger({ accountId: ME, yocto: 10n ** 23n, why: "t" }));
  assert.ok(into.title.length > 0, all(into));
  const reg = await describe(registerOn({ contract: "wrap.near", accountId: "abc.near", yocto: WRAP_STORAGE_YOCTO, why: "t" }));
  assert.ok(reg.title.length > 0, all(reg));
});
