// Two tabs of one browser on one lock (QA's audit, 4 Nov): a password chosen in a tab opened before the wallet
// was made never writes over the lock another tab made, and passcode tries made in many tabs at once are one at a time
// (each counted, never N tries per wait). Controls: the same steps without the origin's lock (Web Locks swapped for none).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UnlockSession, WrongSecretError } from "@zerofee/core/unlock";
import { AlreadyLockedError, TooSoonError, lockWithPasscode, memoryDevice, openWithPasscode, start } from "./device.ts";

const yes = async () => true;
/** The runtime's Web Locks swapped for none (each caller just runs), for the controls. */
async function withoutLocks<T>(run: () => Promise<T>): Promise<T> {
  const none = { request: <R>(_n: string, cb: () => Promise<R>) => cb() };
  Object.defineProperty(globalThis.navigator, "locks", { value: none, configurable: true });
  try {
    return await run();
  } finally {
    delete (globalThis.navigator as { locks?: unknown }).locks;
  }
}

test("an old tab's password never replaces the lock another tab made: refused by name, nothing written, A's password still opens", async () => {
  const dev = memoryDevice();
  // tab B opens first: nothing locked yet, so it shows "Choose a password"
  assert.equal((await start(dev, yes)).k, "setup");
  // tab A locks (and would make and fund the wallet)
  await lockWithPasscode(dev, new UnlockSession(), "tab A password 1");
  const before = JSON.stringify(dev.record);
  // tab B's password, typed later
  const b = new UnlockSession();
  await assert.rejects(lockWithPasscode(dev, b, "tab B password 2"), AlreadyLockedError);
  assert.equal(JSON.stringify(dev.record), before, "A's lock is untouched");
  assert.equal(b.unlocked, false, "B's own root is dropped: nothing is sealed under it");
  const open = new UnlockSession();
  await openWithPasscode(dev, open, "tab A password 1");
  assert.equal(open.unlocked, true, "A's password still opens");
  await assert.rejects(openWithPasscode(dev, new UnlockSession(), "tab B password 2"), WrongSecretError);
});

test("two tabs choosing a password at the same moment: exactly one lock is kept, the other refused", async () => {
  const dev = memoryDevice();
  const out = await Promise.allSettled([lockWithPasscode(dev, new UnlockSession(), "first password 1"), lockWithPasscode(dev, new UnlockSession(), "second password 2")]);
  assert.deepEqual(out.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.ok(out.some((r) => r.status === "rejected" && r.reason instanceof AlreadyLockedError));
});

test("control: the old keep (a write with no read again) replaces A's root, so A's password no longer opens", async () => {
  const dev = memoryDevice();
  await lockWithPasscode(dev, new UnlockSession(), "tab A password 1");
  const a = dev.record;
  const other = memoryDevice();
  await lockWithPasscode(other, new UnlockSession(), "tab B password 2");
  await dev.writeRecord(other.record!);
  assert.notDeepEqual(dev.record, a);
  await assert.rejects(openWithPasscode(dev, new UnlockSession(), "tab A password 1"), WrongSecretError);
});

test("wrong passcodes in many tabs at once: one try at a time, each counted, and no extra tries past the wait", async () => {
  const dev = memoryDevice();
  await lockWithPasscode(dev, new UnlockSession(), "maple river 42");
  const at = () => 7_000_000;
  const out = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => openWithPasscode(dev, new UnlockSession(), `wrong river ${i}`, at)));
  const wrong = out.filter((r) => r.status === "rejected" && r.reason instanceof WrongSecretError).length;
  const tooSoon = out.filter((r) => r.status === "rejected" && r.reason instanceof TooSoonError).length;
  assert.deepEqual([wrong, tooSoon], [3, 2], "three tries, then the wait: five tabs never get five tries");
  assert.equal(dev.record?.method === "passcode" && dev.record.failed, 3, "every try counted");
});

test("control: without the origin's lock the same five tabs each get a try and the count loses four", async () => {
  const dev = memoryDevice();
  await lockWithPasscode(dev, new UnlockSession(), "maple river 42");
  const at = () => 7_000_000;
  const out = await withoutLocks(() => Promise.allSettled([1, 2, 3, 4, 5].map((i) => openWithPasscode(dev, new UnlockSession(), `wrong river ${i}`, at))));
  assert.equal(out.filter((r) => r.status === "rejected" && r.reason instanceof WrongSecretError).length, 5);
  assert.equal(dev.record?.method === "passcode" && dev.record.failed, 1);
});

test("the gate says which tab's password works, from the Copywriter's lines, and set-up's both ways read it", () => {
  const gate = readFileSync(new URL("./UnlockGate.tsx", import.meta.url), "utf8");
  assert.match(gate, /elsewhere: "Your wallet was already made in another tab\. Reload, then use the password you set there\.",/);
  assert.match(gate, /LOCKED_ELSEWHERE = "ZeroFee was already set up in another tab\. Reload this page to unlock it\.";/);
  assert.match(gate, /setSay\(\{ text: e instanceof AlreadyLockedError \? elsewhere\(web\) : "That didn't work\. Try again\.", bad: true \}\);/);
  assert.match(gate, /if \(e instanceof AlreadyLockedError\) return setSay\(\{ text: elsewhere\(web\), bad: true \}\);/);
});
