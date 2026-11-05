// The web wallet's password, asked again before the words or a key are shown, and on every approval sheet (product decision, 4 Nov
// 13:07: like Phantom). It is the password that locks this browser (the lock's own record, Argon2id: unlock.ts), checked
// the lock's way: a wrong one is counted there (the next try waits longer, as at the lock screen, and another tab's tries
// count too), and while a wait runs nothing is tried: every try, the right password too, gets the wait (never "isn't
// right"). The check opens a session of its own and drops it at once; the app's lock is untouched.
//
// One check at a time (review, QA): the record's read, the check and the count's write run as one turn, in this
// page and across every tab of this origin (originLock, Web Locks), so wrong tries made at once each count.
import { originLock } from "@zerofee/core/origin-lock";
import { UnlockSession, WrongSecretError, afterWrongPasscode, passcodeWaitMs, unlock } from "@zerofee/core/unlock";
import { RECORD_LOCK, type UnlockDevice } from "./device.ts";

let turn: Promise<unknown> = Promise.resolve();

/** true: right. false: wrong (counted). `{ waitMs }`: a wait runs, so nothing was checked or counted. */
export function passwordOk(device: UnlockDevice, password: string, now: () => number = Date.now): Promise<boolean | { waitMs: number }> {
  const run = () => originLock(RECORD_LOCK, () => checkOnce(device, password, now));
  const mine = turn.then(run, run);
  turn = mine.catch(() => undefined);
  return mine;
}

async function checkOnce(device: UnlockDevice, password: string, now: () => number): Promise<boolean | { waitMs: number }> {
  const record = await device.readRecord();
  if (!record || record.method !== "passcode") return false;
  const waitMs = passcodeWaitMs(record, now());
  if (waitMs > 0) return { waitMs };
  const session = new UnlockSession();
  try {
    const next = await unlock(session, record, { passcode: password });
    if (next) await device.writeRecord(next);
    return true;
  } catch (e) {
    if (e instanceof WrongSecretError) await device.writeRecord(afterWrongPasscode(record, now()));
    return false;
  } finally {
    session.lock();
  }
}
