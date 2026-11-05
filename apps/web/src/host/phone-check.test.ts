// The phone check (H16, H17): each blocker is its own designed screen under the error contract (Z8): what happened, where
// the money is, exactly one next step; no raw code; and no "Try again" where it can never work (no chip).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "@zerofee/core/bridge";
import { PHONE_BLOCKERS, phoneProblem } from "@zerofee/core/security-problems";
import { opensSettings, phoneBlocker } from "./phone-check.ts";
import type { IosHost } from "./ios.ts";

const host = (blocker: string | null): IosHost => ({
  call: async <T>(method: string) => (method === "device.phoneCheck" ? ({ ok: { blocker } } as BridgeResult<T>) : ({ ok: {} } as BridgeResult<T>)),
  on: () => () => {},
}) as unknown as IosHost;

const moneyLine = /balance|hasn't moved|is safe|refunded|on its way back/;

test("every blocker is a designed screen: what happened, where the money is, one step, no raw code", async () => {
  for (const code of PHONE_BLOCKERS) {
    for (const setUp of [true, false]) {
      const p = phoneProblem(code, setUp);
      assert.ok(p, code);
      assert.equal(p.code, code);
      assert.ok(p.whatHappened.length > 10 && !/error|fail|\(\d+\)|-\d{2,}|LAError/i.test(p.whatHappened), p.whatHappened);
      const money = p.money.state === "safe" ? `Your money hasn't moved. It's ${p.money.where}.` : p.more ?? "";
      assert.match(money, moneyLine, `${code}: says where the money is`);
      assert.ok(p.next.label && p.next.kind !== "nothing", `${code}: one step`);
      assert.ok(!p.next2, `${code}: exactly one step`);
    }
  }
});

test("no chip: never Try again (it can't work on this phone); Face ID off opens ZeroFee's Settings", () => {
  const chip = phoneProblem("security.chip.missing")!;
  assert.notEqual(chip.next.kind, "retry");
  assert.doesNotMatch(chip.next.label, /try again/i);
  assert.ok(opensSettings(phoneProblem("security.faceid.off")!));
  assert.equal(phoneProblem("security.faceid.locked")!.next.kind, "retry");
  assert.equal(phoneProblem("anything.else"), null);
});

test("the page asks the phone before set-up; a ready phone, or a browser, goes straight on", async () => {
  assert.equal(await phoneBlocker(null), null);
  assert.equal(await phoneBlocker(host(null)), null);
  assert.equal((await phoneBlocker(host("security.faceid.not-set-up")))?.whatHappened, "Face ID isn't set up on this iPhone.");
});

test("Swift: the check covers each Face ID reason, and no raw error code reaches a screen", () => {
  const swift = readFileSync(new URL("../../../ios/ZeroFee/ChipKey.swift", import.meta.url), "utf8");
  for (const c of [".passcodeNotSet", ".biometryNotEnrolled", ".biometryLockout", ".biometryNotAvailable"]) assert.ok(swift.includes(`case ${c}`), c);
  for (const code of PHONE_BLOCKERS) assert.ok(swift.includes(`"${code}"`), code);
  assert.doesNotMatch(swift, /\(\\\(e\.code\)\)/, "no \"(<code>)\" in any words");
  assert.match(swift, /if let blocked = PhoneCheck\.blocker\(\) \{ throw Blocked\(check: blocked\) \}/, "the key is made only after the check");
  const bridge = readFileSync(new URL("../../../ios/ZeroFee/Bridge.swift", import.meta.url), "utf8");
  assert.match(bridge, /"device\.phoneCheck"/);
  assert.match(bridge, /UIApplication\.openSettingsURLString/);
});
