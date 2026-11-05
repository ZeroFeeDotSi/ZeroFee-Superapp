// Touch ID for the panel's wallet (Security's ruling, 26 Oct): a fake PRF stands in for the authenticator. Both seals
// open the same wallet, a wrong PRF opens nothing and drops Touch ID's seal, and turning it on or off needs the passcode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVault, type Store } from "./vault.ts";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASS = "a long passcode 1";
const memory = (): Store & { dump(): string } => {
  const m = new Map<string, string>();
  return {
    async get<T>(k: string) { const v = m.get(k); return v === undefined ? undefined : (JSON.parse(v) as T); },
    async set(k: string, v: unknown) { m.set(k, JSON.stringify(v)); },
    async remove(k: string) { m.delete(k); },
    dump: () => JSON.stringify([...m]),
  };
};
/** The authenticator's PRF: a fixed 32-byte answer per credential and salt, as hmac-secret gives. */
const fakePrf = (credSecret: number) => async (salt: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([credSecret, ...salt])));
function setup() {
  let t = 1_800_000_000_000;
  const local = memory(), session = memory();
  const vault = createVault({ local, session, kdf: FAST, now: () => t, solUsd: async () => 150, spend: async () => 0n });
  return { vault, local, session, advance: (ms: number) => { t += ms; } };
}
const salt = () => crypto.getRandomValues(new Uint8Array(32));

test("Touch ID and the passcode open the same wallet; the PRF output is never stored", async () => {
  const { vault, local } = setup();
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  const s = salt(), prf = await fakePrf(7)(s);
  const on = await vault.touchOn(PASS, { credId: "cred-1", salt: s, prf });
  assert.ok("ok" in on && on.ok.credId === "cred-1");
  assert.ok(!local.dump().includes(Buffer.from(prf).toString("base64")), "the PRF output isn't in storage");
  await vault.lock();
  const st = await vault.status();
  assert.ok(st.stage === "locked" && st.touch?.credId === "cred-1");
  const byTouch = await vault.unlockTouch(await fakePrf(7)(Buffer.from(st.touch!.salt, "base64")));
  assert.deepEqual(byTouch, { ok: { sol: made.ok.sol } });
  await vault.lock();
  assert.deepEqual(await vault.unlock(PASS), { ok: { sol: made.ok.sol } }, "the passcode still opens it");
});

test("a PRF from another authenticator opens nothing, drops Touch ID's seal, and the passcode still opens the wallet", async () => {
  const { vault } = setup();
  await vault.create(PASS);
  const s = salt();
  await vault.touchOn(PASS, { credId: "cred-1", salt: s, prf: await fakePrf(7)(s) });
  await vault.lock();
  const wrong = await vault.unlockTouch(await fakePrf(9)(s));
  assert.ok("problem" in wrong && wrong.problem.code === "extension.touch.gone");
  assert.equal((await vault.status()).stage, "locked");
  assert.equal((await vault.status() as { touch?: unknown }).touch, undefined, "the seal that no longer opens is gone");
  assert.ok("ok" in (await vault.unlock(PASS)));
});

test("turning Touch ID on or off needs the passcode; a wrong one changes nothing", async () => {
  const { vault } = setup();
  await vault.create(PASS);
  const s = salt(), prf = await fakePrf(7)(s);
  const bad = await vault.touchOn("not the passcode", { credId: "cred-1", salt: s, prf });
  assert.ok("problem" in bad && bad.problem.code === "extension.passcode.wrong");
  assert.equal((await vault.status() as { touch?: unknown }).touch, undefined);
  await vault.touchOn(PASS, { credId: "cred-1", salt: s, prf });
  const badOff = await vault.touchOff("not the passcode");
  assert.ok("problem" in badOff);
  assert.ok((await vault.status() as { touch?: unknown }).touch, "still on after a wrong passcode");
  assert.deepEqual(await vault.touchOff(PASS), { ok: true });
  await vault.lock();
  const none = await vault.unlockTouch(prf);
  assert.ok("problem" in none && none.problem.code === "extension.touch.gone", "off means Touch ID opens nothing");
});

test("Touch ID only re-opens: the idle lock still closes the wallet after an hour", async () => {
  const { vault, advance } = setup();
  await vault.create(PASS);
  const s = salt(), prf = await fakePrf(7)(s);
  await vault.touchOn(PASS, { credId: "cred-1", salt: s, prf });
  await vault.lock();
  assert.ok("ok" in (await vault.unlockTouch(prf)));
  advance(60 * 60_000 + 1);
  assert.equal((await vault.status()).stage, "locked");
});
