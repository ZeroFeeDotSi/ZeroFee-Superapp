import { test } from "node:test";
import assert from "node:assert/strict";
import qrcode from "qrcode-generator";

// The laptop's pairing code: "ZFL1:" + base32 of a 1,952-byte ML-DSA-65 key = 3,129 capitals, digits and a colon. It
// only fits a QR in alphanumeric mode at error level L; QrCode.tsx must pick those, or it throws "code length overflow".
const code = "ZFL1:" + "A".repeat(3124);

test("the laptop pairing code fits a QR in alphanumeric mode at level L", () => {
  const qr = qrcode(0, "L");
  qr.addData(code, "Alphanumeric");
  qr.make();
  assert.ok(qr.getModuleCount() <= 177);
});

test("the same code as bytes does not fit, which is why the mode matters", () => {
  const qr = qrcode(0, "M");
  qr.addData(code, "Byte");
  assert.throws(() => qr.make(), /overflow/);
});
