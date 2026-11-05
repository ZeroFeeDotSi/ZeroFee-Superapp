// The web wallet's password (product decision, 4 Nov): Show recovery phrase and Export private key ask for it again. The check
// is the lock's own (Argon2id, unlock.ts): a wrong one is counted in this browser's record, so the waits grow as at the
// lock screen, and while one waits nothing is checked: every try, the right one too, gets the wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnlockSession, passcodeWaitMs } from "@zerofee/core/unlock";
import { lockWithPasscode, memoryDevice } from "./device.ts";
import { passwordOk } from "./web-password.ts";

const PASSWORD = "correct horse battery";

test("web wallet: the right password passes; a wrong one fails and is counted; while it waits even the right one fails", async () => {
  const device = memoryDevice();
  await lockWithPasscode(device, new UnlockSession(), PASSWORD);
  let now = 1_000_000;
  const clock = () => now;
  assert.equal(await passwordOk(device, PASSWORD, clock), true);
  assert.equal(await passwordOk(device, "wrong password here", clock), false);
  assert.equal(device.record?.method === "passcode" && device.record.failed, 1, "the wrong try is counted in the record");
  // the third wrong try in a row brings a wait (the lock's own table)
  for (let i = 0; i < 2; i++) assert.equal(await passwordOk(device, `wrong password ${i}`, clock), false);
  const wait = passcodeWaitMs(device.record!, now);
  assert.ok(wait > 0, "after wrong tries the next one waits");
  const before = JSON.stringify(device.record);
  assert.deepEqual(await passwordOk(device, PASSWORD, clock), { waitMs: wait }, "while it waits, the right one gets the wait, never \"wrong\"");
  assert.deepEqual(await passwordOk(device, "wrong password again", clock), { waitMs: wait }, "and a wrong one isn't checked or counted");
  assert.equal(JSON.stringify(device.record), before, "nothing tried, nothing counted while it waits");
  now += wait;
  assert.equal(await passwordOk(device, PASSWORD, clock), true);
  assert.equal(device.record?.method === "passcode" && (device.record.failed ?? 0), 0, "a right one clears the count");
});

test("web wallet: no password lock in this browser (a passkey or none) means no password passes", async () => {
  assert.equal(await passwordOk(memoryDevice(), PASSWORD), false);
});

test("web wallet: wrong passwords tried at once each count (one check at a time: originLock and this page's turn)", async () => {
  const device = memoryDevice();
  await lockWithPasscode(device, new UnlockSession(), PASSWORD);
  const at = 5_000_000;
  const out = await Promise.all([passwordOk(device, "wrong password one", () => at), passwordOk(device, "wrong password two", () => at)]);
  assert.deepEqual(out, [false, false]);
  assert.equal(device.record?.method === "passcode" && device.record.failed, 2, "both counted, never one lost write");
});
