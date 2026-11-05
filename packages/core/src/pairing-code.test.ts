// Finding 54 (sample-page crawl, 4 Nov): Security → Second phone → Paste the code: a made-up "ZFL1:hello123" went
// straight to the approval sheet. A pasted code is checked whole (prefix, alphabet, exact length, zero padding) before
// any sheet opens, on the screen, in the sample bridge and in the core.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SoftwareKey } from "./device-key.ts";
import { keyFromLaptopCode, laptopCode } from "./second-device.ts";
import { isPairingCode, PAIRING_CODE_LETTERS } from "./pairing-code.ts";
import { createMockBridge, SAMPLE_LAPTOP_CODE } from "../../shell-api/src/MockBridge.ts";

const real = laptopCode(SoftwareKey.generate().publicKey);

test("finding 54: only a whole pairing code passes", () => {
  assert.equal(real.length, "ZFL1:".length + PAIRING_CODE_LETTERS);
  assert.ok(isPairingCode(real), "control: a code a laptop shows");
  assert.ok(isPairingCode(` ${real.toLowerCase()} `), "control: case and spaces around it");
  assert.equal(keyFromLaptopCode(real).startsWith("ml-dsa-65:"), true);
  for (const bad of ["ZFL1:hello123", "ZFL1:", "hello", real.slice(0, -1), `${real}A`, `${real.slice(0, -1)}9`, `${real.slice(0, -1)}B`]) {
    assert.equal(isPairingCode(bad), false, bad.slice(0, 24));
    assert.throws(() => keyFromLaptopCode(bad));
  }
  assert.ok(isPairingCode(SAMPLE_LAPTOP_CODE), "the demo laptop's code is a whole code");
});

test("finding 54: the sample bridge refuses a made-up code before its sheet, for a laptop and a second phone", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  let sheets = 0;
  mock.on("approval.needed", () => { sheets++; });
  for (const kind of ["guardian", "laptop"]) {
    const r = await mock.call("account.secondDevice.pair", { qr: "ZFL1:hello123", kind });
    assert.ok("problem" in r, kind);
  }
  assert.equal(sheets, 0, "no approval sheet opened");
});

test("finding 54: the screen checks the code before it asks the core", () => {
  const src = readFileSync(new URL("../../../apps/web/src/apps/security/SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(src, /return text && isPairingCode\(text\) \? text : null;/, "Paste only takes a whole code");
  assert.match(src, /if \(!isPairingCode\(qr\)\) \{\s*setCode\(qr\);\s*setCodeWrong\(/, "a typed or pasted bad code is said under the field");
  assert.ok(src.indexOf("if (!isPairingCode(qr))") < src.indexOf('call<TxOutcome>("account.secondDevice.pair"'), "before the bridge call");
});
