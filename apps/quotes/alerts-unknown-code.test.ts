// MUST 1 (QA, 5 Nov, the thief): new code waiting on an account whose hash the relay's own list doesn't know is
// emailed as unknown code ("Say no"), never as an update, and always first; the relay's list is the core's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
// @ts-ignore: plain JS
import { KNOWN_RELEASE_SHA, releaseOf } from "./alerts.mjs";
import { proofBy, setup, type State } from "./alerts-harness.ts";
import { ACCOUNT_POLICY, OFFERED_RELEASES, knownReleaseBySha } from "../../packages/core/src/known-contracts.ts";

const ACCOUNT = "kim.near";
const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
const UNKNOWN = "ab".repeat(32);

test("the relay's release list is exactly the core's bundle (ACCOUNT_POLICY and every offered release)", () => {
  const core = Object.fromEntries([ACCOUNT_POLICY.sha256Hex, ...OFFERED_RELEASES.map((r) => r.sha256Hex)].map((h) => [h, knownReleaseBySha(h)]));
  assert.deepEqual(KNOWN_RELEASE_SHA, core);
  assert.equal(releaseOf({ Upgrade: { code_hash: b64(OFFERED_RELEASES[0]!.sha256Hex) } }), OFFERED_RELEASES[0]!.version);
  assert.equal(releaseOf({ AllowRelease: { code_hash: b64(UNKNOWN), asked_at_ns: "1" } }), null);
  assert.equal(releaseOf({ AllowRelease: { code_hash: "not base64!" } }), null);
  assert.equal(releaseOf({ Spend: {} }), undefined);
});

test("unknown code is emailed red-worded and first, above a recovery; control: ZeroFee's own release is an update", async () => {
  const state: State = { waiting: [] };
  const s = setup({ stateOf: () => state });
  const key = s.keyFor(ACCOUNT);
  await s.post("/v0/alerts/subscribe", { accountId: ACCOUNT, email: "kim@example.com", proof: proofBy(key, ACCOUNT, "kim@example.com") });
  await s.settle();
  await s.press(await s.get(s.linkIn(s.mails.at(-1)!)));
  await s.round();
  const before = s.mails.length;
  // Control: the compiled release waiting is named as an update.
  state.waiting = [{ id: "7", change: { AllowRelease: { code_hash: b64(OFFERED_RELEASES[0]!.sha256Hex), asked_at_ns: "1" } }, ready_at_ns: "1800000000000000000" }];
  await s.round();
  assert.equal(s.mails.at(-1)!.subject, "Something is waiting on your ZeroFee account");
  assert.match(s.mails.at(-1)!.text, new RegExp(`an update to your Safe \\(ZeroFee version ${OFFERED_RELEASES[0]!.version}\\) is waiting`));
  // A recovery starts and unknown code waits in the same round: the unknown code is told first.
  state.pending = { new_key: "x", ready_at_ns: "1800000000000000000" };
  state.waiting = [...state.waiting!, { id: "8", change: { Upgrade: { code_hash: b64(UNKNOWN) } }, ready_at_ns: "1800000000000000000" }];
  await s.round();
  const subjects = s.mails.slice(before + 1).map((m) => m.subject);
  assert.deepEqual(subjects, ["Unknown code is waiting on your ZeroFee account", "Someone started moving your ZeroFee account to a new phone"]);
  const text = s.mails[before + 1]!.text;
  assert.match(text, /unknown code, not ZeroFee's, is waiting/);
  assert.match(text, /Say no: open ZeroFee on your phone and cancel it before/);
  assert.doesNotMatch(text, /update/i);
});
