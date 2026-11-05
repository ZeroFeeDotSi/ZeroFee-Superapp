// Activity judges a past transaction by its main outcome (grade 1 Nov c, P4): a restore whose finish_recovery went
// through, with one clean-up receipt that found its key already gone, is NOT "didn't go through". And no row shows a
// method's own name. The shape is the tx index's own (tx 5Gdq2t4x… on testnet, receipts trimmed to their statuses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pastOutcome, type PastTx } from "./chain.ts";
import { activityItem } from "./activity.ts";

const ok = { SuccessValue: "" };
const row = (id: string, status: unknown) => ({ receipt: { receipt_id: id }, execution_outcome: { id, outcome: { status } } });
const tx = (receipts: unknown[], top: unknown = { SuccessReceiptId: "main" }) => ({ execution_outcome: { id: "tx", outcome: { status: top } }, receipts });
const keyGone = { Failure: { ActionError: { index: 0, kind: { DeleteKeyDoesNotExist: { account_id: "zf-sample-omar.testnet", public_key: "ml-dsa-65:4PMe" } } } } };
const refused = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: not enough balance" } } } } };

test("the restore's finish_recovery: main receipt done, a clean-up found its key gone → went through, nothing to explain", () => {
  assert.deepEqual(pastOutcome(tx([row("main", ok), row("cleanup", keyGone), row("refund", ok)])), { ok: true });
});

test("the main receipt failed → didn't go through; the transaction itself failed → didn't go through", () => {
  assert.deepEqual(pastOutcome(tx([row("main", refused)])), { ok: false });
  assert.deepEqual(pastOutcome(tx([], refused)), { ok: false });
});

test("a later step that really failed (a coin contract refused) → went through, but partly; never hidden", () => {
  assert.deepEqual(pastOutcome(tx([row("main", ok), row("coin", refused), row("cleanup", keyGone)])), { ok: true, partly: true });
});

test("an index row without its main receipt: any failure still counts, as before", () => {
  assert.deepEqual(pastOutcome(tx([row("other", refused)])), { ok: false });
  assert.deepEqual(pastOutcome(tx([row("other", ok)])), { ok: true });
});

const past = (method: string, receiverId = "zf-sample-omar.testnet"): PastTx => ({
  hash: "h", atIso: "2026-11-01T14:00:00.000Z", signerId: "zf-sample-omar.testnet", signerKey: "ed25519:11111111111111111111111111111111", receiverId,
  actions: [{ kind: "call", method, args: new Uint8Array(), gas: 0n, depositYocto: 0n } as never], ok: true,
});

test("plain words for the account's own methods, never a raw method name, and 'device', never 'phone'", () => {
  const title = (m: string, r?: string) => activityItem(past(m, r), [], "", "testnet").title;
  assert.equal(title("set_protection"), "Changed your protection", "done at once (a saved one says Saved: below)");
  assert.equal(title("finish_recovery"), "Moved the account to a new device");
  assert.equal(title("start_recovery"), "Started moving the account to a new device");
  assert.equal(title("some_new_method"), "Used your account's rules");
  assert.equal(title("ft_transfer", "usdc.fakes.testnet"), "Used usdc.fakes.testnet");
  for (const m of ["set_protection", "execute", "run", "cancel", "add_second_device", "remove_key", "set_recovery_key", "upgrade", "approve", "refill_recovery_key", "some_new_method"]) {
    assert.doesNotMatch(title(m), /[_"()]|phone/, m);
  }
});

test("grade 01d Q1: a Send through the account's rules says what it sent, the word Wallet's Activity uses", () => {
  const send = { receiver_id: "guest-book.testnet", steps: [{ Transfer: { deposit: "10000000000000000000000" } }] };
  const tx = { ...past("execute"), actions: [{ kind: "call", method: "execute", args: new TextEncoder().encode(JSON.stringify(send)), gas: 0n, depositYocto: 0n } as never] };
  assert.equal(activityItem(tx, [], "", "testnet").title, "Sent 0.01 NEAR to guest-book.testnet");
  assert.equal(activityItem(past("execute"), [], "", "testnet").title, "Sent through your account's rules", "unreadable args keep the plain words");
});

test("grade 02f, item 4: a send in the record carries who and how much, so Wallet's Activity and Send's recent people read it", () => {
  const send = { receiver_id: "guest-book.testnet", steps: [{ Transfer: { deposit: "10000000000000000000000" } }] };
  const viaRules = { ...past("execute"), actions: [{ kind: "call", method: "execute", args: new TextEncoder().encode(JSON.stringify(send)), gas: 0n, depositYocto: 0n } as never] };
  assert.deepEqual(activityItem(viaRules, [], "", "testnet").sent, { to: "guest-book.testnet", near: "0.01" });
  const plain = { ...past("x", "bob.testnet"), actions: [{ kind: "transfer", yocto: 2_500_000_000_000_000_000_000_000n } as never] };
  assert.deepEqual(activityItem(plain, [], "", "testnet").sent, { to: "bob.testnet", near: "2.5" });
  assert.equal(activityItem(past("set_protection"), [], "", "testnet").sent, undefined, "control: a rules change sends nothing");
});

// UX walk 2 Nov (a real account): two protection changes its rules saved to wait both read "Changed your
// protection · 1 h ago", so the tester thought they were done. The contract's Outcome says done: false and the change's id.
const outcome = (o: unknown) => ({ SuccessValue: btoa(JSON.stringify(o)) });

test("a change the account saved to wait: pastOutcome names its id; one done at once names none", () => {
  assert.deepEqual(pastOutcome(tx([row("main", outcome({ done: false, id: "3", ready_at_ns: "1", needs_device: false }))])), { ok: true, held: "3" });
  assert.deepEqual(pastOutcome(tx([row("main", outcome({ done: true, id: null, ready_at_ns: null, needs_device: false }))])), { ok: true }, "control: done at once");
  assert.deepEqual(pastOutcome(tx([row("main", { SuccessValue: btoa("not json") })])), { ok: true }, "control: a value that isn't an Outcome");
});

test("Activity: 'Saved …, waiting' while the account holds it, 'Saved …' after; 'Changed' only when it was done", () => {
  const held = { ...past("set_protection"), held: "3" };
  assert.equal(activityItem(held, [], "", "testnet", new Set(["3"])).title, "Saved a change to your protection, waiting");
  assert.equal(activityItem(held, [], "", "testnet", new Set(["2"])).title, "Saved a change to your protection", "finished or cancelled since: its own row says which");
  assert.equal(activityItem(held, [], "", "testnet").title, "Saved a change to your protection", "waiting list unread: never a claimed wait");
  assert.equal(activityItem(past("set_protection"), [], "", "testnet", new Set(["3"])).title, "Changed your protection", "control: done at once");
  assert.equal(activityItem({ ...past("upgrade"), held: "4" }, [], "", "testnet", new Set(["4"])).title, "Saved an update to your account's rules, waiting");
});

test("Activity names installed code without ids: ZeroFee's own release (its short-waits build too) as ZeroFee's, anything else as code ZeroFee doesn't know", () => {
  const deploy = (codeSha256Hex: string) => activityItem({ ...past("x"), actions: [{ kind: "deploy", codeSha256Hex } as never] }, [], "", "testnet").title;
  assert.equal(deploy("03a474c3dae06f4f49d78ab50b5bf1d32bd3f39ac72c7277ad0f83b05ec19985"), "Put ZeroFee's rules on your account");
  assert.equal(deploy("ab".repeat(32)), "Put rules ZeroFee doesn't know on your account");
  assert.doesNotMatch(deploy("ab".repeat(32)), /fingerprint|abab/);
});
