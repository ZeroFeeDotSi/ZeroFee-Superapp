import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { SoftwareKey } from "./device-key.ts";
import type { HeldRequest } from "./held.ts";
import { NO_GAS, NO_GAS_MEASURED_WORST, SecondDeviceCore, floorSeconds, keyFromLaptopCode, laptopCode, pauseOnNo, type SecondDeviceRequest } from "./second-device.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const NEAR = "000000000000000000000000";
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
function sheet(core: Bridge, answer = true) {
  const shown: PlainWords[] = [];
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    shown.push(words);
    void core.call("approval.answer", { id, approve: answer });
  });
  return shown;
}
const realNow = Date.now;
const advance = (seconds: number) => {
  const base = Date.now();
  Date.now = () => base + seconds * 1000;
};

async function phoneAndLaptop() {
  const chain = new FakeChain();
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  // Face ID up to 5 NEAR, more waits 2 minutes: the bands these tests hold payments with (the default is tested in demo-core.test).
  const protection = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
  const phone = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection, watchIntervalMs: 20, indexRetryMs: 1 });
  const phoneSheet = sheet(phone);
  const { accountId } = ok(await phone.call<{ accountId: string }>("account.create"));
  const { words } = ok(await phone.call<{ words: string[] }>("recovery.words"));
  ok(await phone.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const laptop = new SecondDeviceCore({ chain, vault: new MemoryVault() });
  const laptopSheet = sheet(laptop);
  return { chain, phone, phoneSheet, laptop, laptopSheet, accountId };
}

test("the pairing code carries the whole key, in QR-friendly letters, and nothing else reads as one", () => {
  const key = SoftwareKey.generate().publicKey;
  const c = laptopCode(key);
  assert.match(c, /^ZFL1:[A-Z2-7]{3124}$/);
  assert.equal(keyFromLaptopCode(c), key);
  assert.equal(keyFromLaptopCode(key), key);
  assert.throws(() => keyFromLaptopCode(c.slice(0, -8)));
  assert.throws(() => keyFromLaptopCode("ZFL1:hello"));
});

test("the laptop is paired from its code, then a big payment needs its yes, read from the account itself", async () => {
  const { chain, phone, phoneSheet, laptop, laptopSheet, accountId } = await phoneAndLaptop();
  try {
    const before = ok(await laptop.call<{ code: string; fingerprint: string; accounts: string[] }>("secondDevice.state"));
    assert.deepEqual(before.accounts, []);
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: before.code }));
    assert.equal(paired.status, "waiting");
    assert.ok([...phoneSheet.at(-1)!.lines, ...(phoneSheet.at(-1)!.details ?? []).flatMap((d) => d.lines)].some((l) => l.includes(before.fingerprint)), "the phone's sheet shows the fingerprint the laptop shows (one tap down)");
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    assert.deepEqual(ok(await laptop.call<{ accounts: string[] }>("secondDevice.state")).accounts, [accountId]);

    // "Ask my laptop above $20": 5 NEAR at $4. Below stays Face ID; above, the 2-minute wait AND the laptop.
    const limit = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.setLimit", { usd: 20 }));
    advance(250);
    ok(await phone.call("account.waiting.run", { id: limit.id }));
    const { bands } = ok(await phone.call<{ bands: any[] }>("account.protection.get"));
    assert.deepEqual(bands.map((b) => b.level), ["FaceId", { Both: { seconds: "120" } }]);

    const pay = ok(await phone.call<TxOutcome & { id: string; needsSecondDevice: boolean }>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `6${NEAR}` }], why: "", from: "wallet" } }));
    assert.equal(pay.needsSecondDevice, true);
    const waiting = ok(await laptop.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests"));
    assert.deepEqual(waiting.map((a) => [a.accountId, a.requests.map((r) => r.title)]), [[accountId, ["Send 6 NEAR to bob.testnet"]]]);

    const yes = ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: pay.id, approve: true }));
    assert.equal(yes.status, "waiting", "its wait isn't over yet");
    assert.equal(laptopSheet.at(-1)!.title, "Say yes to: Send 6 NEAR to bob.testnet");
    // H43: the yes shows on both devices until it goes, never silently. On the phone, the held item says the device said
    // yes (and needs nothing more from it); on the laptop, the item stays listed as said, with nothing left to answer.
    const phoneHeld = ok(await phone.call<HeldRequest[]>("account.waiting")).find((w) => String(w.id) === String(pay.id))!;
    assert.equal(phoneHeld.needsSecondDevice, false);
    assert.equal(phoneHeld.secondDeviceSaidYes, true);
    const [said] = ok(await laptop.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests"));
    const saidItem = said!.requests.find((r) => String(r.id) === String(pay.id))!;
    assert.equal(saidItem.secondDeviceSaidYes, true);
    assert.equal(saidItem.needsSecondDevice, false);
    advance(500);
    assert.equal(ok(await phone.call<TxOutcome>("account.waiting.run", { id: pay.id })).status, "done");
    assert.equal(chain.accounts.get("bob.testnet")!.balance, 6n * 10n ** 24n);
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("a guardian is paired the same way and said to be one; it also sees the phone's stop of a recovery, to let it go or refuse it", async () => {
  const { chain, phone, laptop: guardian, laptopSheet: guardianSheet, accountId } = await phoneAndLaptop();
  try {
    const code = ok(await guardian.call<{ code: string }>("secondDevice.state")).code;
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: code, kind: "guardian" }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    assert.deepEqual(ok(await phone.call<{ kind: string }[]>("account.secondDevices")).map((d) => d.kind), ["guardian"]);
    // The phone asked to stop a recovery (release 6: it waits a day, and the second device may refuse it).
    chain.accounts.get(accountId)!.rules!.waiting.push({ id: 50, change: "CancelRecovery" as any, readyAtNs: BigInt(Date.now() + 86_400_000) * 1_000_000n, needsDevice: false, approved: false });
    const waiting = ok(await guardian.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests"));
    const stop = waiting[0]!.requests.find((r) => r.id === "50")!;
    assert.equal(stop.title, "Stop a move to a new device");
    assert.match(stop.lines.join(" "), /Say no if a thief may have it/);
    // The phone's own list says what it is, without advice meant for the device that answers it.
    const own = ok(await phone.call<HeldRequest[]>("account.waiting")).find((r) => r.id === "50")!;
    assert.equal(own.title, "Stop a move to a new device");
    assert.doesNotMatch(own.lines.join(" "), /Say yes/);
    ok(await guardian.call<TxOutcome>("secondDevice.answer", { accountId, id: "50", approve: false }));
    assert.equal(guardianSheet.at(-1)!.title, "Say no to: Stop a move to a new device");
    assert.ok(guardianSheet.at(-1)!.lines.includes("With your no, the move to a new device goes on."), "a no to the stop doesn't say nothing is sent");
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("account.secondDevices says when a second device not yet of age counts fully, or that its clock waits for a move", async () => {
  const { chain, phone, laptop, accountId } = await phoneAndLaptop();
  try {
    const { code: c } = ok(await laptop.call<{ code: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: c }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    const [device] = ok(await phone.call<{ handle: string; countsFullyFromIso?: string; waitsForMove?: true }[]>("account.secondDevices"));
    assert.equal(device!.countsFullyFromIso, undefined, "of age: nothing said");
    const rules = chain.accounts.get(accountId)!.rules!;
    const at = Date.UTC(2026, 10, 5, 10);
    rules.fullAtNs = new Map([[rules.second[0]!, String(BigInt(at) * 1_000_000n)]]);
    assert.equal(ok(await phone.call<{ countsFullyFromIso?: string }[]>("account.secondDevices"))[0]!.countsFullyFromIso, new Date(at).toISOString());
    rules.fullAtNs = new Map([[rules.second[0]!, "18446744073709551615"]]);
    assert.equal(ok(await phone.call<{ waitsForMove?: true }[]>("account.secondDevices"))[0]!.waitsForMove, true);
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("the laptop's no stops it; a laptop that isn't paired can't answer anything", async () => {
  const { chain, phone, laptop, accountId } = await phoneAndLaptop();
  try {
    const { code: c } = ok(await laptop.call<{ code: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: c }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    const limit = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.setLimit", { usd: "always" }));
    advance(250);
    ok(await phone.call("account.waiting.run", { id: limit.id }));
    const pay = ok(await phone.call<TxOutcome & { id: string }>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `1${NEAR}` }], why: "", from: "wallet" } }));
    assert.equal(ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: pay.id, approve: false })).status, "done");
    assert.deepEqual(ok(await phone.call("account.waiting")), []);

    const stranger = new SecondDeviceCore({ chain, vault: new MemoryVault() });
    sheet(stranger);
    assert.equal(code(await stranger.call("secondDevice.answer", { accountId, id: "1", approve: true })), "security.request.not-allowed");
    assert.equal(code(await phone.call("account.secondDevice.pair", { qr: "ZFL1:NOTAKEY" })), "security.pairing.code-wrong");
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("the laptop veto (release 10): a no that pauses the main device is marked with the pause, read from the account; an older contract's no is not", async () => {
  const { chain, phone, laptop, accountId } = await phoneAndLaptop();
  try {
    const { code: c, borshKey } = ok(await laptop.call<{ code: string; borshKey: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: c }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    const limit = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.setLimit", { usd: "always" }));
    advance(250);
    ok(await phone.call("account.waiting.run", { id: limit.id }));
    const pay = ok(await phone.call<TxOutcome & { id: string }>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `1${NEAR}` }], why: "", from: "wallet" } }));
    const listed = async () => ok(await laptop.call<{ accountId: string; requests: SecondDeviceRequest[] }[]>("secondDevice.requests"))[0]!.requests.find((r) => r.id === pay.id)!;
    // control: this build has no veto (no second_device_yes_from), so its no ends only this payment and asks nothing first
    assert.equal((await listed()).pauseSeconds, undefined);
    // the veto's build, on the app's 48-hour account, this laptop of age: its no pauses for 72 hours
    const view = (m: string, v: unknown) => chain.views.set(`${accountId} ${m}`, () => v);
    view("second_device_yes_from", [[borshKey, "0"]]);
    view("second_device_ages", [[borshKey, "0"]]);
    view("delay_seconds", "172800");
    assert.equal((await listed()).pauseSeconds, 72 * 3600);
    // a 24-hour account: 48 hours (the delay plus at most a day)
    view("delay_seconds", "86400");
    assert.equal((await listed()).pauseSeconds, 48 * 3600);
    // a laptop not yet of age: its no ends only this payment (lib.rs decline), so nothing is asked first
    view("second_device_ages", [[borshKey, String(10n ** 18n)]]);
    assert.equal((await listed()).pauseSeconds, undefined);
    // the audit's SHOULD: a node's error on any of the veto's views never takes the list (and its No) away: the payment is
    // still listed, marked unknown, so Say no asks first all the same
    for (const m of ["second_device_yes_from", "second_device_ages", "delay_seconds"]) {
      const was = chain.views.get(`${accountId} ${m}`)!;
      chain.views.set(`${accountId} ${m}`, () => { throw new ProblemError(securityProblems.nodesUnreachable()); });
      const r = await listed();
      assert.equal(r.pauseUnknown, true, m);
      assert.equal(r.pauseSeconds, undefined, m);
      chain.views.set(`${accountId} ${m}`, was);
    }
    // control: a clean null (an older contract: no second_device_yes_from) is no pause, not unknown: it answers at once
    chain.views.delete(`${accountId} second_device_yes_from`);
    const older = await listed();
    assert.equal(older.pauseUnknown, undefined);
    assert.equal(older.pauseSeconds, undefined);
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("pauseOnNo follows lib.rs decline: only a device of age, only what the phone asked alone, never a removal of a second device, a stop or the move", () => {
  const veto = { aged: true, floorSeconds: floorSeconds(172_800), secondDevices: ["K1"] };
  assert.equal(floorSeconds(172_800), 259_200);
  assert.equal(floorSeconds(604_800), 691_200);
  assert.equal(pauseOnNo({ kind: "Spend" }, veto), 259_200);
  assert.equal(pauseOnNo({ kind: "SetProtection" }, veto), 259_200);
  assert.equal(pauseOnNo({ kind: "RemoveKey", removesKey: "PHONE" }, veto), 259_200, "a key that isn't a second device's: phone-alone like any other");
  assert.equal(pauseOnNo({ kind: "Spend" }, null), undefined, "an older contract");
  assert.equal(pauseOnNo({ kind: "Spend" }, { ...veto, aged: false }), undefined, "a device not yet of age");
  for (const kind of ["CancelRecovery", "Recovery", "RemoveThisDevice"]) assert.equal(pauseOnNo({ kind }, veto), undefined, kind);
  assert.equal(pauseOnNo({ kind: "RemoveKey", removesKey: "K1" }, veto), undefined, "a second device's removal");
  assert.equal(pauseOnNo({ kind: "Spend", secondDeviceSaidYes: true }, veto), undefined, "co-signed");
  // unread (a node's error): unknown for anything that may pause, failing toward asking; never for a stop or the move
  assert.equal(pauseOnNo({ kind: "Spend" }, "unknown"), "unknown");
  assert.equal(pauseOnNo({ kind: "RemoveKey", removesKey: "K1" }, "unknown"), "unknown");
  for (const kind of ["CancelRecovery", "Recovery", "RemoveThisDevice"]) assert.equal(pauseOnNo({ kind }, "unknown"), undefined, kind);
});

test("release 7: a waiting recovery is a request the second device answers: its yes lets the words finish after the delay, its no ends the move and freezes spending", async () => {
  const { chain, phone, laptop, laptopSheet, accountId } = await phoneAndLaptop();
  try {
    const { code: c } = ok(await laptop.call<{ code: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: c }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    assert.deepEqual(ok(await laptop.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests")).map((a) => a.requests.length), [0]);
    // The words start a move to a new device (the fake's recovery, as the words' key would start it).
    const account = chain.accounts.get(accountId)!;
    const newPhone = SoftwareKey.generate();
    const newKey = Buffer.from([2, ...decodePublicKey(newPhone.publicKey)]).toString("base64");
    const readyAtNs = BigInt(Date.now() + 60_000) * 1_000_000n;
    account.policy!.pending = { newKey, readyAtNs };
    const status = ok(await phone.call<{ pending: { needsSecondDevice?: boolean; approved?: boolean; canFinishAtIso?: string; fallbackAtIso?: string } | null }>("recovery.status"));
    assert.equal(status.pending?.needsSecondDevice, true, "the second device of age must say yes");
    assert.equal(status.pending?.approved, false);
    assert.equal(status.pending?.canFinishAtIso, status.pending?.fallbackAtIso, "without the yes, the words alone can finish only at the fallback");
    // The device sees the move as a request of its own, with advice.
    const [{ requests }] = ok(await laptop.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests"));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.id, "recovery");
    assert.equal(requests[0]!.title, "A move to a new device");
    assert.match(requests[0]!.lines.join(" "), /Say yes if you are moving to a new device/);
    // Its yes: bound to this recovery; the contract then lets the words finish after the delay.
    assert.equal(ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: "recovery", approve: true })).status, "done");
    assert.equal(laptopSheet.at(-1)!.title, "Say yes to: A move to a new device");
    assert.equal(account.policy!.recoveryYes, account.rules!.second[0]);
    const after = ok(await phone.call<{ pending: { approved?: boolean; canFinishAtIso?: string; readyAtIso: string } | null }>("recovery.status"));
    assert.equal(after.pending?.approved, true);
    assert.equal(after.pending?.canFinishAtIso, after.pending?.readyAtIso);
    // Re-audit 7 (R7-2): a move the device said yes to can't be stopped by the phone alone; the core says so first.
    assert.equal(code(await phone.call("recovery.cancel")), "security.recovery.stop-approved");
    // Its no: the move ends and everyday spending is frozen for a change's wait.
    assert.equal(ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: "recovery", approve: false })).status, "done");
    assert.equal(laptopSheet.at(-1)!.title, "Say no to: A move to a new device");
    assert.equal(account.policy!.pending, null);
    const frozen = ok(await phone.call<{ pending: unknown; frozenUntilIso?: string | null }>("recovery.status"));
    assert.equal(frozen.pending, null);
    assert.ok(frozen.frozenUntilIso && Date.parse(frozen.frozenUntilIso) > Date.now(), "frozen after the device's refusal");
    assert.deepEqual(ok(await laptop.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests")).map((a) => a.requests.length), [0]);
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("R7-1: the phone's request to remove this device shows on it as a warning, with no yes or no", async () => {
  const { phone, laptop, accountId } = await phoneAndLaptop();
  try {
    const { code: c } = ok(await laptop.call<{ code: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: c }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    const [device] = ok(await phone.call<{ handle: string }[]>("account.secondDevices"));
    const removal = ok(await phone.call<TxOutcome & { id: string }>("account.removeKey", { handle: device!.handle }));
    assert.equal(removal.status, "waiting", "a key removal waits a change's wait");
    const [mine] = ok(await laptop.call<{ accountId: string; requests: HeldRequest[] }[]>("secondDevice.requests"));
    const warning = mine!.requests.find((r) => r.id === removal.id)!;
    assert.equal(warning.kind, "RemoveThisDevice");
    assert.equal(warning.warning, "Not you? Use your 24 words to move your account to a new device.");
    assert.equal(warning.needsSecondDevice, false);
    assert.equal(mine!.requests[0]!.id, removal.id, "listed first");
    assert.equal(code(await laptop.call("secondDevice.answer", { accountId, id: removal.id, approve: false })), "security.waiting.gone", "no yes or no to its own removal");
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("H09: a lost laptop is removed from the phone alone, its full key read from the contract's own record (no transaction ever added it)", async () => {
  const { chain, phone, laptop } = await phoneAndLaptop();
  try {
    const { code: c } = ok(await laptop.call<{ code: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: c }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    // On NEAR the contract adds the laptop's key in its own receipt, so the account's transactions never name it.
    chain.keysFromHistory = async () => [];
    const [device] = ok(await phone.call<{ handle: string }[]>("account.secondDevices"));
    const removal = ok(await phone.call<TxOutcome & { id: string; needsSecondDevice?: boolean }>("account.removeKey", { handle: device!.handle }));
    assert.equal(removal.status, "waiting", "it waits (at least the fallback, for a device of age)");
    assert.notEqual(removal.needsSecondDevice, true, "a lost laptop's removal never needs the laptop");
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("R7-9: a no to the move with the phone's stop waiting freezes, unless the laptop says freeze: false (its confirmation of that stop)", async () => {
  const { chain, phone, laptop, laptopSheet, accountId } = await phoneAndLaptop();
  try {
    const { code: c } = ok(await laptop.call<{ code: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: c }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    const account = chain.accounts.get(accountId)!;
    const newKey = Buffer.from([2, ...decodePublicKey(SoftwareKey.generate().publicKey)]).toString("base64");
    const start = () => {
      account.policy!.pending = { newKey, readyAtNs: BigInt(Date.now() + 60_000) * 1_000_000n };
      account.policy!.frozenUntilNs = undefined;
      account.rules!.waiting.push({ id: 80, change: "CancelRecovery" as any, readyAtNs: BigInt(Date.now() + 86_400_000) * 1_000_000n, needsDevice: false, approved: false });
    };
    // A plain no: the move ends, the stop goes, and spending is frozen.
    start();
    assert.equal(ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: "recovery", approve: false })).status, "done");
    assert.ok(laptopSheet.at(-1)!.lines.some((l) => l.includes("payments pause for a while")));
    assert.equal(account.policy!.pending, null);
    assert.ok(account.policy!.frozenUntilNs && account.policy!.frozenUntilNs > BigInt(Date.now()) * 1_000_000n, "frozen");
    // freeze: true says the same.
    start();
    assert.equal(ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: "recovery", approve: false, freeze: true })).status, "done");
    assert.ok(account.policy!.frozenUntilNs && account.policy!.frozenUntilNs > BigInt(Date.now()) * 1_000_000n, "frozen");
    // freeze: false confirms the phone's stop: the move ends, the stop goes, nothing is frozen.
    start();
    assert.equal(ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: "recovery", approve: false, freeze: false })).status, "done");
    assert.ok(laptopSheet.at(-1)!.lines.some((l) => l.includes("nothing pauses")));
    assert.equal(account.policy!.pending, null);
    assert.equal(account.policy!.frozenUntilNs, undefined, "not frozen");
    assert.ok(!account.rules!.waiting.some((w) => w.id === 80), "the stop went with the move");
    // freeze: false with no stop waiting: the contract refuses it (nothing to confirm).
    account.policy!.pending = { newKey, readyAtNs: BigInt(Date.now() + 60_000) * 1_000_000n };
    assert.notEqual(ok(await laptop.call<TxOutcome>("secondDevice.answer", { accountId, id: "recovery", approve: false, freeze: false })).status, "done");
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("S-1 on the second device: a change waiting or a new key on the account it guards is told once; its own key never; with no key of its own it says nothing and makes none", async () => {
  const { chain, phone, laptop, accountId } = await phoneAndLaptop();
  try {
    type A = { kind: string; id: string; title: string; body: string }[];
    // Not paired, no key yet: nothing, and asking makes no key.
    const fresh = new SecondDeviceCore({ chain, vault: new MemoryVault() });
    assert.deepEqual(ok(await fresh.call<A>("secondDevice.alerts")), []);
    const before = ok(await laptop.call<{ code: string }>("secondDevice.state"));
    const paired = ok(await phone.call<TxOutcome & { id: string }>("account.secondDevice.pair", { qr: before.code }));
    advance(121);
    ok(await phone.call("account.waiting.run", { id: paired.id }));
    // The first look learns what's there (its own key included).
    assert.deepEqual(ok(await laptop.call<A>("secondDevice.alerts")), []);
    // A payment held on the guarded account: told once.
    assert.equal(ok(await phone.call<TxOutcome>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `6${NEAR}` }], why: "", from: "wallet" } })).status, "waiting");
    const held = ok(await laptop.call<A>("secondDevice.alerts"));
    assert.deepEqual(held.map((a) => [a.kind, a.title]), [["held", "Something is waiting on an account you guard"]]);
    // Security audit 11 (4 Nov): the account it guards, never the amount or the receiver.
    assert.match(held[0]!.body, new RegExp(`^On ${accountId.replace(/\./g, "\\.")}: It can go .+\\. If it wasn't you, open ZeroFee and cancel it before then\\.$`));
    assert.deepEqual(ok(await laptop.call<A>("secondDevice.alerts")), [], "told once");
    // A key someone added: told once, in words. A full-access one on this account with rules bypasses them (audit): red.
    chain.accounts.get(accountId)!.keys.set("ed25519:9fXq1nYb3Zr4oTpX7m2L8kVwQe5sRdUcJhGaBy6NtPzK", { nonce: 0n, permission: { kind: "full" } });
    const key = ok(await laptop.call<A>("secondDevice.alerts"));
    assert.deepEqual(key.map((a) => [a.kind, a.title, a.body, (a as { red?: true }).red]), [["key", "A key on an account you guard can bypass its rules", `On ${accountId}: This key can bypass your Safe's rules. If it wasn't you, open ZeroFee now.`, true]]);
    assert.deepEqual(ok(await laptop.call<A>("secondDevice.alerts")), [], "told once");
  } finally {
    Date.now = realNow;
    phone.close();
  }
});

test("G3-1: a no carries at least 40 Tgas, above the measured worst (a full queue's drop, 19.52 Tgas)", () => {
  assert.ok(NO_GAS >= 40_000_000_000_000n, `NO_GAS ${NO_GAS}`);
  assert.ok(NO_GAS >= 2n * NO_GAS_MEASURED_WORST, "twice the measured worst");
  // Within the second device's 1 NEAR fee allowance many times over (NEAR prices an allowance at 1e9 yocto a gas, protocol 85).
  assert.ok(NO_GAS * 1_000_000_000n <= 1_000_000_000_000_000_000_000_000n / 10n, "at most 0.1 NEAR of the 1 NEAR allowance");
});
