// Security review (slota-addr, 3 Nov): the demo's made-up addresses never route a real wallet to the demo engine, and
// every real send path refuses each sample before signing. Each check has a control that passes the same path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { SAMPLE_EVM, SAMPLE_FLOAT, SAMPLE_POCKET, SAMPLE_SOL, createMockBridge } from "./MockBridge.ts";
import { isSampleAddress } from "@zerofee/trade/demo-engine.ts";
import { evmAddress, checksumAddress, checksumOk } from "@zerofee/core/evm";
import { solAddress } from "@zerofee/core/solana";
import { validAddress } from "@zerofee/wallet/addresses.ts";
import { ACCOUNT_ID } from "@zerofee/wallet/send.ts";
import { findRecipient } from "@zerofee/pay/send";
import type { Bridge } from "@zerofee/core/bridge";

// 1. exact, case-sensitive; no form the real core can produce equals SAMPLE_EVM
test("review 1: isSampleAddress matches SAMPLE_EVM only as typed; every form a real core makes is refused", () => {
  assert.equal(isSampleAddress(SAMPLE_EVM), true);
  for (const v of [SAMPLE_EVM.toLowerCase(), "0x" + SAMPLE_EVM.slice(2).toUpperCase(), checksumAddress(SAMPLE_EVM.toLowerCase())]) assert.equal(isSampleAddress(v), false, v);
  // the real core: evmAddress = lowercase hex of keccak(pubkey) (subwallets.ts addressOf); solAddress = base58
  for (let i = 0; i < 200; i++) {
    const seed = randomBytes(32);
    const evm = evmAddress(seed), sol = solAddress(seed);
    assert.match(evm, /^0x[0-9a-f]{40}$/, "core lists EVM wallets in lowercase");
    assert.equal(isSampleAddress(evm) || isSampleAddress(checksumAddress(evm)) || isSampleAddress(sol), false);
  }
  // SAMPLE_EVM is no single-case and no EIP-55 string: unreachable from any normaliser
  assert.notEqual(checksumAddress(SAMPLE_EVM.toLowerCase()), SAMPLE_EVM);
});

test("review 1: the demo's bridge hands Trade SAMPLE_EVM byte for byte (else ?demo would pick the real engine)", async () => {
  const mock = createMockBridge({ tradeChains: ["sol", "bsc", "hood"] } as never);
  const r = await mock.call<{ chain: string; address: string }[]>("subwallet.list", {});
  assert.ok("ok" in r);
  for (const c of ["bsc", "hood"]) assert.equal(r.ok.find((w) => w.chain === c)?.address, SAMPLE_EVM, c);
  assert.equal(r.ok.find((w) => w.chain === "sol")?.address, SAMPLE_SOL);
});

// 2. the real send paths refuse each sample before signing
const bridge = { call: async (m: string, p: { accountId?: string }) => (m === "ledger.recipientInfo" ? { ok: { exists: true, hasLedgerBalance: false, accountId: p.accountId } } : { problem: { code: "x" } }) } as unknown as Bridge;
const VALID_SOL = "So11111111111111111111111111111111111111112";

test("review 2: EVM and Solana samples are refused by Pay, the ledger's withdraw check and the core's send check; valid ones pass", async () => {
  // Pay (findRecipient): what a person types or pastes
  for (const a of [SAMPLE_EVM, SAMPLE_SOL]) assert.ok("problem" in (await findRecipient(bridge, a)), a);
  assert.ok("ok" in (await findRecipient(bridge, SAMPLE_EVM.toLowerCase())), "control: lowercase EVM is found");
  assert.ok("ok" in (await findRecipient(bridge, VALID_SOL)), "control: a base58 address is found");
  // wallet ledger withdraw / quotePay / planSend (validAddress) and core sendPlainNow (checksumOk)
  for (const c of ["base", "bsc", "hood", "eth"]) assert.equal(validAddress(c, SAMPLE_EVM), false, c);
  assert.equal(validAddress("sol", SAMPLE_SOL), false);
  assert.equal(checksumOk(SAMPLE_EVM), false);
  assert.equal(validAddress("base", checksumAddress(SAMPLE_EVM.toLowerCase())), true, "control");
  assert.equal(checksumOk(checksumAddress(SAMPLE_EVM.toLowerCase())), true, "control");
  assert.equal(validAddress("sol", VALID_SOL), true, "control");
});

test("review 2: NEAR samples (float, pocket) are refused by the core's account check AND by Pay's findRecipient", async () => {
  for (const id of [SAMPLE_FLOAT, SAMPLE_POCKET]) assert.equal(ACCOUNT_ID.test(id), false, `planSend: ${id}`);
  assert.equal(ACCOUNT_ID.test(SAMPLE_FLOAT.toLowerCase()), false, "66 characters: no account even lowercased");
  assert.equal(ACCOUNT_ID.test(SAMPLE_FLOAT.toLowerCase().slice(0, 64)), true, "control: 64 lowercase hex is an implicit account");
  // findTyped lowercases before its 64-hex test (pay/src/send.ts:122-123): the samples are 66 long, so nothing is found
  const old = "4C07335141687C36498869F9D7E9E361787AB5EB8588C9D864A9D9FAF6B93B39";
  assert.ok("ok" in (await findRecipient(bridge, old)), "control: a 64-hex capital id is lowercased and found by Pay (the review's M1)");
  for (const id of [SAMPLE_FLOAT, SAMPLE_POCKET]) {
    const r = await findRecipient(bridge, id);
    assert.ok("problem" in r, `Pay accepted ${id} as ${JSON.stringify("ok" in r ? r.ok.recipient : null)}`);
  }
});
