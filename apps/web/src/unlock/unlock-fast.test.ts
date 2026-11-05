// Unlock → Home in under a second after the passkey answers (unlock speed, 5 Nov), timed on mock clocks with every
// network call 300 ms. The account.state read the old first unlock waited for is four NEAR round trips in a row (block on
// two nodes, block, access keys, a query: measured in Chrome, 1,385 ms with no added latency). Home now opens from the
// account kept on this device, kept whenever Home shows it, set-up's end and a restore included; the old rule kept it only
// when that read answered, so the first unlock after set-up waited 1.2 s here. The lock is the real one (PRF → HKDF).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UnlockSession } from "@zerofee/core/unlock";
import type { AccountInfo } from "@zerofee/core/signer";
import { lockWithPasskey, memoryDevice, openWithPasskey } from "./device.ts";
import { PRIME_WAIT_MS, accountShown, keepAccount, keptAccount, keptWithin, openFromKept, type Sealed } from "../kept-account.ts";

const NET_MS = 300;
const ACCOUNT: AccountInfo = { accountId: "zf-sample-lena.testnet", network: "testnet", keys: [] } as unknown as AccountInfo;
/** The passkey's PRF output, a fresh copy each time (the seal zeroes what it is given). */
const prf = () => new Uint8Array(32).fill(7);

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

/** Wallet's sealed store: readable only once the lock is open (it throws while locked, as the vault does); 20 ms a read. */
function sealedStore() {
  let value: string | null = null;
  const s = { open: false, get value() { return value; } };
  const sealed: Sealed = {
    get: () => new Promise((r, no) => setTimeout(() => (s.open ? r(value) : no(new Error("locked"))), 20)),
    set: async (v) => {
      if (!s.open) throw new Error("locked");
      value = v;
    },
  };
  return Object.assign(s, { sealed });
}

/** A device locked with a passkey (the real seal), and a session that is locked again: a reload. */
async function lockedDevice() {
  const dev = memoryDevice();
  assert.equal(await lockWithPasskey(dev, new UnlockSession(), async () => ({ credentialId: new Uint8Array([1, 2, 3]), prfSalt: new Uint8Array(32).fill(1), prf: prf() })), "done");
  return dev;
}

/**
 * The page after the passkey answers: the lock opens (the real openWithPasskey), then route(true)'s start as App.tsx has
 * it: Home from the kept account and its figures' copy (local, 20 ms), else Home once account.state answers. The time
 * from the passkey's answer to Home, in mock milliseconds.
 */
async function passkeyToHome(t: TestContext, store: ReturnType<typeof memoryStore>, dev: Awaited<ReturnType<typeof lockedDevice>>, kept: ReturnType<typeof sealedStore>): Promise<number> {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const net = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), NET_MS));
  let homeAt: number | null = null;
  const session = new UnlockSession();
  const run = (async () => {
    await openWithPasskey(dev, session, dev.record as never, async () => prf());
    assert.equal(session.unlocked, true);
    kept.open = true;
    // account.state: block (two nodes), block, access keys, a query, one after another
    const asking = net(1).then(() => net(2)).then(() => net(3)).then(() => net({ stage: "ready", account: ACCOUNT }));
    const show = () => void (homeAt ??= Date.now());
    const prime = () => new Promise((r) => setTimeout(r, 20));
    if (!(await openFromKept(await keptWithin(keptAccount(kept.sealed, store)), prime, show))) {
      await asking;
      show();
    }
  })();
  for (let i = 0; homeAt === null && i < 1000; i++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(5);
  }
  await run;
  t.mock.timers.reset();
  assert.notEqual(homeAt, null, "Home never showed");
  return homeAt!;
}

test("set-up ends on Home: the next unlock opens Home within 1 s of the passkey's answer (300 ms per network call)", async (t) => {
  const dev = await lockedDevice();
  const store = memoryStore();
  const kept = sealedStore();
  // set-up's end (afterBackup) shows Home with the account the core gave; the shell keeps whatever Home shows
  const shown = accountShown({ k: "home", account: ACCOUNT });
  assert.ok(shown);
  kept.open = true;
  await keepAccount(shown, kept.sealed, store);
  kept.open = false; // the reload: locked again
  const ms = await passkeyToHome(t, store, dev, kept);
  t.diagnostic(`passkey → Home: ${ms} ms`);
  assert.ok(ms <= 1000, `passkey → Home took ${ms} ms`);
  assert.ok(ms <= PRIME_WAIT_MS, `Home waited for the network (${ms} ms)`);
});

test("control: the old rule (kept only when account.state answers) left set-up's next unlock waiting over 1 s", async (t) => {
  const dev = await lockedDevice();
  const store = memoryStore(); // set-up's Home kept nothing
  const ms = await passkeyToHome(t, store, dev, sealedStore());
  t.diagnostic(`passkey → Home: ${ms} ms`);
  assert.ok(ms > 1000, `expected the slow path, got ${ms} ms`);
  assert.ok(ms >= 4 * NET_MS, `${ms} ms`);
});

test("only Home's account is kept: set-up's other screens keep nothing, and a damaged copy is no account", async () => {
  for (const k of ["words", "check", "funding", "fundCheck", "welcome", "problem"]) assert.equal(accountShown({ k, account: ACCOUNT }), null, k);
  const store = memoryStore();
  store.setItem("zf.account", "{not json");
  assert.equal(await keptAccount(null, store), null);
  store.setItem("zf.account", JSON.stringify({ accountId: 5 }));
  assert.equal(await keptAccount(null, store), null);
});

test("the lock is unchanged: a wrong passkey output opens nothing, and the kept account opens Home only after the unlock", async () => {
  const dev = await lockedDevice();
  const session = new UnlockSession();
  await assert.rejects(openWithPasskey(dev, session, dev.record as never, async () => new Uint8Array(32).fill(9)));
  assert.equal(session.unlocked, false);
  // the shell's order: App (and route) mount only once the gate is open
  const gate = readFileSync(new URL("./UnlockGate.tsx", import.meta.url), "utf8");
  assert.match(gate, /if \(step\.k === "open"\) return <>\{children\}<\/>;/);
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /const shown = accountShown\(view\);\n\s+useEffect\(\(\) => void \(shown && keepAccount\(shown, KEPT\)\), \[shown\]\);/);
  assert.match(app, /if \(await openFromKept\(kept, \(\) => primeHome\(APP_BRIDGES\.get\("wallet"\)!\), \(account\) => setView\(\{ k: "home", account, start \}\)\)\)/);
});

test("a locked browser shows no account id: kept in the sealed store, never localStorage; a plain one from before moves in", async () => {
  const id = ACCOUNT.accountId;
  const plainHas = (store: ReturnType<typeof memoryStore>) => [...store.m.values()].some((v) => v.includes(id));
  // kept at Home, then locked (a reload): nothing in localStorage names the account
  const store = memoryStore();
  const kept = sealedStore();
  kept.open = true;
  await keepAccount(ACCOUNT, kept.sealed, store);
  kept.open = false;
  assert.equal(plainHas(store), false, "the account id is readable in a locked browser");
  assert.ok(kept.value?.includes(id), "kept sealed");
  // locked: nothing is read, nothing moves
  assert.equal(await keptAccount(kept.sealed, store), null);
  // a browser from before: its plain copy moves into the sealed store on the first read after the unlock, then leaves
  const old = memoryStore();
  old.setItem("zf.account", JSON.stringify(ACCOUNT));
  old.setItem("zerofee.app.terms", "2026-10-26");
  const sealedOld = sealedStore();
  assert.equal(await keptAccount(sealedOld.sealed, old), null, "locked: no read");
  assert.equal(plainHas(old), true, "locked: nothing moved, nothing lost");
  sealedOld.open = true;
  assert.equal((await keptAccount(sealedOld.sealed, old))?.accountId, id);
  assert.equal(plainHas(old), false);
  assert.equal(old.getItem("zerofee.app.terms"), "2026-10-26", "only the account moves");
  assert.equal(JSON.parse(sealedOld.value!).accountId, id);
});

test("control: the phone's store (no sealed one) keeps the account id in plain storage, as before", async () => {
  const store = memoryStore();
  await keepAccount(ACCOUNT, null, store);
  assert.ok([...store.m.values()].some((v) => v.includes(ACCOUNT.accountId)));
  assert.equal((await keptAccount(null, store))?.accountId, ACCOUNT.accountId);
  // and App.tsx picks the sealed store in a browser
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /const KEPT = iosHost\(\) \? null : sealedKept\(APP_BRIDGES\.get\("wallet"\)!\);/);
});
