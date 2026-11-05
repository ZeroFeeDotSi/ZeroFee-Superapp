// The Safe's update (product decision, 5 Nov): the card shows only when the newest release compiled into this app is newer than
// the code the account runs on chain (and two nodes show it published by hash); one Face ID places both steps; the held
// screen's time is the contract's; Cancel clears both; unknown code waiting is red and never an update (MUST 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bytesToBase64, toBase58 } from "@fastnear/utils";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { guardNews } from "./guard-dog.ts";
import { ACCOUNT_POLICY, OFFERED_RELEASES, RELEASE_10, isKnownRelease, knownRelease, releaseShaHex } from "./known-contracts.ts";
import { RELEASE_NOTES } from "./release-notes.ts";
import type { SafeUpdate } from "./safe-update.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const DAY = 86_400;
const HOUR_DELAY = 172_800; // the 48-hour account (the default)
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const b64 = (hex: string) => bytesToBase64(bytes(hex));
const UNKNOWN = "ab".repeat(32);

/** A new account (release 9) with the default 48-hour delay; counts the Face ID sheets it is asked. */
async function release9() {
  const chain = new FakeChain();
  chain.fund("bob.testnet", (await import("./device-key.ts")).SoftwareKey.generate().publicKey, 0n);
  const core: Bridge & { close(): void } = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: HOUR_DELAY });
  const sheets: string[] = [];
  core.on<{ id: string; words?: { title?: string } }>("approval.needed", ({ id, words }) => {
    sheets.push(String(words?.title ?? ""));
    void core.call("approval.answer", { id, approve: true });
  });
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  sheets.length = 0;
  return { chain, core, accountId, a: chain.accounts.get(accountId)!, sheets };
}

test("knownRelease: the bundle's releases in every form a hash travels in; anything else is unknown (control)", () => {
  for (const r of [ACCOUNT_POLICY, RELEASE_10]) {
    const v = ACCOUNT_POLICY.versions[r.codeHashBase58];
    assert.equal(knownRelease(r.sha256Hex), v, "hex");
    assert.equal(knownRelease(b64(r.sha256Hex)), v, "base64, the contract's JSON");
    assert.equal(knownRelease(r.codeHashBase58), v, "base58, NEAR's code hash");
    assert.equal(releaseShaHex(toBase58(bytes(r.sha256Hex))), r.sha256Hex);
  }
  // Controls: never offered or never ZeroFee's.
  for (const h of [UNKNOWN, b64(UNKNOWN), RELEASE_10.shortWaits.sha256Hex, ACCOUNT_POLICY.shortWaits.sha256Hex, ...RELEASE_10.beforeAudit, "", "zz", "AAAA", null, undefined, 42]) {
    assert.equal(isKnownRelease(h), false, String(h));
  }
});

test("what changed: one line for every release this build offers", () => {
  for (const v of [ACCOUNT_POLICY.versions[ACCOUNT_POLICY.codeHashBase58]!, ...OFFERED_RELEASES.map((r) => r.version)]) {
    assert.ok(RELEASE_NOTES[v] && RELEASE_NOTES[v]!.length <= 80 && !RELEASE_NOTES[v]!.includes("\n"), `release ${v} has one short line`);
  }
});

test("the trigger: only the compiled release, newer than the code on chain, published by its pinned hash; never anything else", async () => {
  const { chain, core, a } = await release9();
  try {
    // Control: not published → nothing.
    assert.equal(ok(await core.call<SafeUpdate>("account.safeUpdate")).state, "none");
    // Someone publishes other code, and code under release 10's hash with another sha256: still nothing.
    chain.publishGlobal(toBase58(bytes(UNKNOWN)), UNKNOWN);
    chain.publishGlobal(RELEASE_10.codeHashBase58, "00".repeat(32));
    assert.equal(ok(await core.call<SafeUpdate>("account.safeUpdate")).state, "none");
    // Published as pinned → the offer, release 10, its line from the table, the contract's own waits.
    chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
    const offer = ok(await core.call<SafeUpdate>("account.safeUpdate"));
    assert.equal(offer.state, "offer");
    if (offer.state !== "offer") return;
    assert.equal(offer.version, 10);
    assert.equal(offer.whatChanged, RELEASE_NOTES[10]);
    assert.equal(offer.phoneOnlySeconds, 7 * DAY, "the 48-hour account, phone alone: the words' fallback (3 x 48 h, at least 7 days)");
    assert.equal(offer.withSecondDeviceSeconds, 3 * DAY, "with a second device's yes: the floor, 48 h + 24 h");
    // The account already on the newest release: nothing.
    a.codeHash = RELEASE_10.codeHashBase58;
    assert.equal(ok(await core.call<SafeUpdate>("account.safeUpdate")).state, "none");
    // The account running code nobody knows: nothing is offered (no "update" for code that isn't ours).
    a.codeHash = toBase58(bytes(UNKNOWN));
    const r = await core.call<SafeUpdate>("account.safeUpdate");
    assert.ok("problem" in r || r.ok.state === "none");
  } finally {
    core.close();
  }
});

test("no network message can make the card appear: the trigger's code reads no inbox, push, relay, mail or fetch", () => {
  const src = readFileSync(new URL("./safe-update.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./held.ts", "./release-notes.ts"], "pure: what the core read and the compiled notes");
  const core = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  const body = (name: string) => {
    const start = core.indexOf(`  private async ${name}(`);
    assert.ok(start > 0, name);
    return core.slice(start, core.indexOf("\n  }\n", start));
  };
  for (const name of ["rulesInfo", "rulesPublished", "safeUpdate", "rulesUpdate"]) {
    assert.doesNotMatch(body(name), /fetch\(|relay|inbox|mail|push|notif|this\.on\(|message/i, `${name} reads only the chain and the compiled list`);
  }
  // The offer is the compiled table's (offeredUpdateFor the code on chain), never a hash from anywhere else.
  assert.match(body("rulesInfo"), /const offer = offeredUpdateFor\(code, this\.chain\.network\);/);
  assert.match(body("rulesUpdate"), /const offer = offeredUpdateFor\(codeOf\(await this\.chain\.account\(signer\.accountId, block\)\), this\.chain\.network\);/);
});

test("one Face ID places both steps (the listing and the switch) by the compiled hash; the held time is the contract's; Cancel clears both", async () => {
  const { chain, core, a, sheets } = await release9();
  try {
    chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
    const asked = Date.now();
    assert.equal(ok(await core.call<{ status: string }>("account.rules.update")).status, "waiting");
    assert.deepEqual(sheets, ["Update your Safe"], "one sheet, one Face ID");
    assert.deepEqual(a.rules!.waiting.map((w) => Object.keys(w.change)[0]), ["AllowRelease", "Upgrade"]);
    for (const w of a.rules!.waiting) assert.equal((Object.values(w.change)[0] as { code_hash: string }).code_hash, b64(RELEASE_10.sha256Hex));
    // Asked again: refused, nothing more placed.
    assert.equal(code(await core.call("account.rules.update")), "security.request.not-allowed");
    assert.equal(a.rules!.waiting.length, 2);

    const held = ok(await core.call<SafeUpdate>("account.safeUpdate"));
    assert.equal(held.state, "held");
    if (held.state !== "held") return;
    // The contract holds the switch only at its floor (3 days) but refuses it until the listing ran (7 days): the
    // screen says 7 days, never the sooner number (control: the raw list says 3).
    assert.ok(Math.abs(Date.parse(held.readyAtIso) - (asked + 7 * DAY * 1000)) < 60_000, held.readyAtIso);
    const rawSwitch = a.rules!.waiting.find((w) => w.change.Upgrade)!;
    assert.ok(Math.abs(Number(rawSwitch.readyAtNs / 1_000_000n) - (asked + 3 * DAY * 1000)) < 60_000, "control: the switch's own level time is the floor");
    assert.equal(held.coSigned, false, "the phone asked alone: the backup words would drop it");
    assert.equal(held.whatChanged, RELEASE_NOTES[10]);
    // Finish before the time: refused, nothing signed.
    assert.notEqual(code(await core.call("account.safeUpdate.finish")), "ok");

    sheets.length = 0;
    assert.equal(ok(await core.call<{ status: string }>("account.safeUpdate.cancel")).status, "done");
    assert.deepEqual(sheets, ["Cancel your Safe's update"]);
    assert.equal(a.rules!.waiting.length, 0, "both steps cancelled in one go");
    assert.equal(ok(await core.call<SafeUpdate>("account.safeUpdate")).state, "offer", "and it can be asked again");
  } finally {
    core.close();
  }
});

test("co-signed by a FALLBACK-aged second device: the floor and coSigned (a recovery start keeps it); ready → Finish installs release 10 by hash", async () => {
  const { chain, core, a, sheets } = await release9();
  const realNow = Date.now;
  try {
    chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
    const asked = Date.now();
    ok(await core.call("account.rules.update"));
    // The laptop (a second device of age) said yes to both.
    a.rules!.second.push("ed25519:laptop");
    for (const w of a.rules!.waiting) Object.assign(w, { approved: true, approvedBy: "ed25519:laptop" });
    const readyAt = async () => {
      const u = ok(await core.call<SafeUpdate>("account.safeUpdate"));
      assert.equal(u.state, "held");
      return u.state === "held" ? { at: Date.parse(u.readyAtIso), coSigned: u.coSigned } : { at: 0, coSigned: false };
    };
    // R9-AL1: a yes counts only from a laptop on the account for the FALLBACK wait. Controls: no view (release 9) and a
    // laptop of age but not fallback-aged both say the fallback's 7 days.
    let r = await readyAt();
    assert.equal(r.coSigned, true);
    assert.ok(Math.abs(r.at - (asked + 7 * DAY * 1000)) < 60_000, "no second_device_yes_from (release 9): 7 days");
    a.rules!.yesFromNs = new Map([["ed25519:laptop", String(BigInt(asked + 5 * DAY * 1000) * 1_000_000n)]]);
    r = await readyAt();
    assert.ok(Math.abs(r.at - (asked + 7 * DAY * 1000)) < 60_000, "a laptop of age, not fallback-aged: 7 days");
    a.rules!.yesFromNs = new Map([["ed25519:laptop", "0"]]);
    r = await readyAt();
    assert.ok(Math.abs(r.at - (asked + 3 * DAY * 1000)) < 60_000, "fallback-aged laptop: the 72-hour floor");

    Date.now = () => asked + 3 * DAY * 1000 + 5_000;
    const ready = ok(await core.call<SafeUpdate>("account.safeUpdate"));
    assert.equal(ready.state, "ready");
    sheets.length = 0;
    assert.equal(ok(await core.call<{ status: string }>("account.safeUpdate.finish")).status, "done");
    assert.deepEqual(sheets, ["Finish your Safe's update"], "one Face ID");
    assert.equal(a.codeHash, RELEASE_10.codeHashBase58, "the account runs release 10 by its published hash");
    assert.equal(ok(await core.call<SafeUpdate>("account.safeUpdate")).state, "none");
  } finally {
    Date.now = realNow;
    core.close();
  }
});

test("MUST 1: a waiting release whose hash this build doesn't know is unknown code (red, Cancel), never an update; control: the known one", async () => {
  const { chain, core, a } = await release9();
  try {
    chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
    const now = BigInt(Date.now()) * 1_000_000n;
    a.rules!.waiting.push({ id: 90, change: { AllowRelease: { code_hash: b64(UNKNOWN), asked_at_ns: String(now) } }, readyAtNs: now + 3n * 86_400_000_000_000n, needsDevice: false, approved: false });
    const u = ok(await core.call<SafeUpdate>("account.safeUpdate"));
    assert.equal(u.state, "unknown", "not an offer, not an update");
    const list = ok(await core.call<{ id: string; title: string; warning?: string }[]>("account.waiting"));
    assert.match(list[0]!.title, /^Unknown code/);
    assert.ok(list[0]!.warning);
    // The guard-dog: red words, even if this phone placed it (a thief with the phone).
    const held = ok(await core.call<{ id: string; title: string; readyAtIso: string; kind: string; release?: { shaHex: string | null; version: number | null } }[]>("account.waiting"));
    const news = guardNews({ accountId: "x", keys: null, held, seen: {}, mine: { keys: [], held: ["90"] }, agentPerDayUsd: null, when: () => "Fri" });
    assert.deepEqual(news.alerts.map((n) => [n.title, n.unknownCode]), [["Unknown code is waiting on your account", true]]);
    assert.ok(Math.abs(Date.parse(held[0]!.readyAtIso) - Date.now()) > DAY * 1000);
    // Cancel clears it.
    assert.equal(ok(await core.call<{ status: string }>("account.safeUpdate.cancel")).status, "done");
    assert.equal(a.rules!.waiting.length, 0);

    // Control: the compiled release waiting is an update, and the phone's own one is no news.
    ok(await core.call("account.rules.update"));
    const known = ok(await core.call<{ id: string; title: string; readyAtIso: string; kind: string; release?: { shaHex: string | null; version: number | null } }[]>("account.waiting"));
    assert.equal(ok(await core.call<SafeUpdate>("account.safeUpdate")).state, "held");
    assert.ok(known.every((h) => h.release?.version === 10));
    const quiet = guardNews({ accountId: "x", keys: null, held: known, seen: {}, mine: { keys: [], held: known.map((h) => h.id) }, agentPerDayUsd: null, when: () => "Fri" });
    assert.equal(quiet.alerts.length, 0);
    const told = guardNews({ accountId: "x", keys: null, held: known, seen: {}, mine: { keys: [], held: [] }, agentPerDayUsd: null, when: () => "Fri" });
    assert.ok(told.alerts.every((n) => !n.unknownCode && n.title === "A payment or change is waiting on your account"));
  } finally {
    core.close();
  }
});

test("MUST 1: unknown code is first in the phone's held list, above another waiting change; control: a known release keeps its place", async () => {
  const { core, a } = await release9();
  try {
    const now = BigInt(Date.now()) * 1_000_000n;
    const later = now + 3n * 86_400_000_000_000n;
    const spend = { id: 50, change: { SetProtection: { bands: a.rules!.bands } }, readyAtNs: later, needsDevice: false, approved: false };
    a.rules!.waiting.push(spend, { id: 51, change: { Upgrade: { code_hash: b64(UNKNOWN) } }, readyAtNs: later, needsDevice: false, approved: false });
    const list = ok(await core.call<{ id: string; title: string; warning?: string }[]>("account.waiting"));
    assert.deepEqual(list.map((h) => h.id), ["51", "50"]);
    assert.match(list[0]!.title, /^Unknown code/);
    a.rules!.waiting = [spend, { id: 52, change: { Upgrade: { code_hash: b64(RELEASE_10.sha256Hex) } }, readyAtNs: later, needsDevice: false, approved: false }];
    assert.deepEqual(ok(await core.call<{ id: string }[]>("account.waiting")).map((h) => h.id), ["50", "52"], "control: order as the contract holds it");
    // The guard-dog: unknown code first, above a new key's alert.
    const held = [{ id: "1", title: "x", readyAtIso: new Date().toISOString(), kind: "SetProtection" }, { id: "2", title: "y", readyAtIso: new Date().toISOString(), kind: "Upgrade", release: { shaHex: UNKNOWN, version: null } }];
    const news = guardNews({ accountId: "x", keys: [{ handle: "k1", nonce: 0n, permission: { kind: "full" } }], held, seen: { keys: [] }, mine: { keys: [], held: [] }, agentPerDayUsd: null, when: () => "Fri" });
    assert.deepEqual(news.alerts.map((n) => n.id), ["held:2", "key:k1", "held:1"]);
  } finally {
    core.close();
  }
});

test("NIT: the offer is keyed on the code's hash, so a re-spun build of the newest release is offered; the newest build is not", async () => {
  const { offeredUpdateFor } = await import("./known-contracts.ts");
  assert.equal(offeredUpdateFor(ACCOUNT_POLICY.codeHashBase58)?.codeHashBase58, RELEASE_10.codeHashBase58, "release 9 → 10");
  assert.equal(offeredUpdateFor(RELEASE_10.codeHashBase58), null, "the newest build: nothing");
  assert.equal(offeredUpdateFor(RELEASE_10.shortWaits.codeHashBase58, "testnet"), null, "its short-waits twin: nothing");
  // An earlier build of release 10 (as a re-spin leaves behind): known as release 10, still offered the newest build.
  const old = "Old10Build1111111111111111111111111111111111";
  ACCOUNT_POLICY.versions[old] = 10;
  ACCOUNT_POLICY.olderCodeHashes.push(old);
  try {
    assert.equal(offeredUpdateFor(old)?.codeHashBase58, RELEASE_10.codeHashBase58);
  } finally {
    delete ACCOUNT_POLICY.versions[old];
    ACCOUNT_POLICY.olderCodeHashes.pop();
  }
  // Controls: unknown code and nothing get none.
  assert.equal(offeredUpdateFor(toBase58(bytes(UNKNOWN))), null);
  assert.equal(offeredUpdateFor(undefined), null);
});
