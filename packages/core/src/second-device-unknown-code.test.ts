// QA's MUST (5 Nov, the Safe's update path): the laptop's yes to an Upgrade or AllowRelease counts only for a
// release its own bundle lists (known-contracts). Unknown code reads "Unknown code. Say no" in red and a yes is refused
// before anything is signed. Control: a known release (ZeroFee's current one, release 10) can be approved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCOUNT_POLICY, RELEASE_10 } from "./known-contracts.ts";
import { releaseShaOf } from "./held.ts";
import { UNKNOWN_CODE_TITLE, UNKNOWN_CODE_WARNING, markUnknown, unknownUpdate } from "./second-device.ts";
import type { HeldRequest } from "./held.ts";

const b64 = (hex: string) => btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((h) => parseInt(h, 16))));
const ask = (kind: "Upgrade" | "AllowRelease", hex: string) => ({ kind, releaseSha256Hex: releaseShaOf({ [kind]: { code_hash: b64(hex), asked_at_ns: "1" } }) });

test("a known release (by its sha256, read from the contract's base64 code_hash) can be approved: the control", () => {
  for (const kind of ["Upgrade", "AllowRelease"] as const) {
    for (const hex of [ACCOUNT_POLICY.sha256Hex, RELEASE_10.sha256Hex]) {
      const r = ask(kind, hex);
      assert.equal(r.releaseSha256Hex, hex);
      assert.equal(unknownUpdate(r), false, `${kind} ${hex.slice(0, 8)}`);
    }
  }
});

test("unknown code, an unreadable hash or a short-waits build: refused, whatever words came with it", () => {
  for (const kind of ["Upgrade", "AllowRelease"] as const) {
    assert.equal(unknownUpdate(ask(kind, "ab".repeat(32))), true, "a hash the bundle doesn't list");
    assert.equal(unknownUpdate(ask(kind, RELEASE_10.shortWaits.sha256Hex)), true, "short waits are never offered");
    assert.equal(unknownUpdate({ kind, releaseSha256Hex: releaseShaOf({ [kind]: { code_hash: "not base64!" } }) }), true);
    assert.equal(unknownUpdate({ kind }), true, "no hash at all");
  }
  assert.equal(unknownUpdate({ kind: "Spend" }), false, "a payment isn't an update");
  assert.equal(UNKNOWN_CODE_TITLE, "Unknown code. Say no");
  assert.doesNotMatch(UNKNOWN_CODE_TITLE, /update/i);
});

test("the laptop refuses the yes before any signer is made; the list shows it as unknown code", () => {
  const src = readFileSync(new URL("./second-device.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("private async answerRequest("), src.indexOf("private async approveOnSheet("));
  const refuse = body.indexOf("if (yes && unknownUpdate(request)) throw");
  assert.ok(refuse > 0 && refuse < body.indexOf("new DevSigner("), "refused before signing");
  assert.match(src, /\.map\(withAdvice\)\.map\(markUnknown\)/);
  // control: without the check, nothing between the request and the signer stops it
  const without = body.replace(/\n\s*if \(yes && unknownUpdate\(request\)\) throw[^\n]*/, "");
  assert.equal(without.indexOf("unknownUpdate(request)) throw"), -1);
});

test("the audit's SHOULD: unknown code's warning shows always, first, even over a warning the request already had", () => {
  const base = { id: "1", title: "Update your account's rules", lines: [], readyAtIso: "", needsSecondDevice: true, ready: false, change: true, yesGas: 1 } satisfies Omit<HeldRequest, "kind">;
  const other = markUnknown({ ...base, kind: "Upgrade", releaseSha256Hex: "ab".repeat(32), warning: "Something else." });
  assert.equal(other.title, UNKNOWN_CODE_TITLE);
  assert.ok(other.warning!.startsWith(UNKNOWN_CODE_WARNING), other.warning);
  assert.match(other.warning!, /Something else\.$/);
  assert.equal(markUnknown({ ...base, kind: "Upgrade", releaseSha256Hex: "ab".repeat(32) }).warning, UNKNOWN_CODE_WARNING);
  // control: a known release keeps its own words and no unknown-code warning
  const known = markUnknown({ ...base, kind: "Upgrade", releaseSha256Hex: RELEASE_10.sha256Hex });
  assert.equal(known.title, "Update your account's rules");
  assert.equal(known.warning, undefined);
});
