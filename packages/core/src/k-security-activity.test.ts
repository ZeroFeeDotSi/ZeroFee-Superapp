// QA's hand crawl on a real account (k-security, 4 Nov, main@b9935fbf, S3): Activity > Account read
// "Reading your account's history…", then "NEAR is busy right now. Try again". The rows are FastNEAR's history; the
// agreed block and the key list (who signed) were read on NEAR's nodes first and held the rows back. Now the keys are
// best-effort: the rows show without them, and a row this device didn't sign says "Another key" (was "Not this phone": "by not this phone", 5 Nov), never a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PastTx } from "./chain.ts";
import { activityItem } from "./activity.ts";
import { keyHandle } from "./key-handle.ts";

const tx = (signerKey: string): PastTx => ({
  hash: "h", atIso: "2026-11-04T13:00:00.000Z", signerId: "zf-0000000a03.near", signerKey, receiverId: "zf-0000000a03.near",
  actions: [{ kind: "call", method: "execute", args: new Uint8Array(), gas: 0n, depositYocto: 0n } as never], ok: true,
});

test("S3: with no key list, a row still shows; one this device didn't sign says \"Another key\"", () => {
  const other = activityItem(tx("ed25519:22222222222222222222222222222222"), null, "", "mainnet");
  assert.equal(other.by, "Another key", "never \"Set-up\" or \"A key you removed later\" on a guess");
  assert.ok(other.title.length > 0);
});

test("5 Nov (\"Set up your account / by not this phone\"): the set-up row is \"Set-up\" with no key list too", () => {
  const key = "ed25519:33333333333333333333333333333333";
  const setup = { ...tx(key), actions: [{ kind: "add-key", publicKey: { text: "ed25519:44444444444444444444444444444444", type: "ed25519", handle: "x" }, nonce: 0n, permission: { kind: "full" } } as never, { kind: "delete-key", publicKey: { text: key } } as never] };
  const row = activityItem(setup, null, "", "mainnet");
  assert.equal(row.title, "Set up your account");
  assert.equal(row.by, "Set-up");
  assert.equal(activityItem(setup, null, keyHandle(key), "mainnet").by, "This phone", "control: this phone's own key still says so");
});

test("S3: the history no longer waits on NEAR's agreed block or key list", () => {
  const core = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  const body = core.slice(core.indexOf("private async activity("), core.indexOf("private async activity(") + 2500);
  assert.doesNotMatch(body, /const block = await this\.chain\.commonBlock\(\);/, "the block read no longer gates the rows");
  assert.match(body, /this\.chain\.commonBlock\(\)\.catch\(\(\) => null\)/);
  assert.match(body, /accessKeys\(s\.accountId, block\)\.catch\(\(\) => null\)/);
});
