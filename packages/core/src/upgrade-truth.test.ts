// The Safe update says the contract's own times (QA's SHOULDs from the release-4 → 10 proof, 5 Nov):
// 1. a listing (AllowRelease) runs at max(its ready_at, asked + max(fallback, floor)): 21 days on a week's delay without a
//    fallback-aged laptop's yes, never its level's 8; account.waiting, account.rules and account.rules.update's own answer
//    all say so, and the listing's sheet and the switch's sheet say different things;
// 2. release 4's update waits its 2 minutes either way: no "second device's yes" line;
// 3. removing a laptop on release 4 (no record of its full key, none in the history) names the cause and the update.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { listingRunsAtNs, updateRunsAtIso, type HeldRequest } from "./held.ts";
import { ACCOUNT_POLICY, RELEASE_10, RELEASE6_SECOND_DEVICE_METHODS, ownAccountCall } from "./known-contracts.ts";
import { v4Account } from "./release4-account.test.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { bytesToBase64 } from "@fastnear/utils";

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const DAY = 86_400;
const MS = 1000;
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 60_000, `${what}: ${new Date(a).toISOString()} vs ${new Date(b).toISOString()}`);
type Rules = { release: number; current: number; update?: { waitSeconds: number; thenWaitSeconds?: number; listFirst?: true; waiting?: { id: string; readyAtIso: string } } };
type Outcome = { status: string; id: string; readyAtIso: string };

/** Every sheet's words (title and lines), answered yes. */
function sheets(core: Bridge, answer: boolean) {
  const seen: { title: string; lines: string[] }[] = [];
  core.on<{ id: string; words?: { title?: string; lines?: string[] } }>("approval.needed", ({ id, words }) => {
    seen.push({ title: String(words?.title ?? ""), lines: [...(words?.lines ?? [])] });
    if (answer) void core.call("approval.answer", { id, approve: true });
  });
  return seen;
}

/** A release-9 account with a week's delay: floor 8 days, words-only fallback 21 (the proof's numbers). */
async function release9() {
  const chain = new FakeChain();
  chain.fund("bob.testnet", (await import("./device-key.ts")).SoftwareKey.generate().publicKey, 0n);
  const core: Bridge & { close(): void } = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, recoveryDelaySeconds: 604_800 });
  const seen = sheets(core, true);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  seen.length = 0;
  return { chain, core, accountId, a: chain.accounts.get(accountId)!, seen };
}

test("listingRunsAtNs: max(ready_at, asked + the listing's wait); a yes that counts drops the fallback; not a listing: null", () => {
  const asked = 1_000n * 1_000_000_000n;
  const w = { ready_at_ns: String(asked + 8n * 86_400n * 1_000_000_000n), change: { AllowRelease: { code_hash: "x", asked_at_ns: String(asked) } } };
  const wait = 21n * 86_400n * 1_000_000_000n;
  assert.equal(listingRunsAtNs(w, wait, false), asked + wait, "21 days, not the level's 8");
  assert.equal(listingRunsAtNs(w, wait, true), BigInt(w.ready_at_ns), "control: a counted yes leaves the level's 8");
  assert.equal(listingRunsAtNs({ ...w, ready_at_ns: String(asked + 30n * 86_400n * 1_000_000_000n) }, wait, false), asked + 30n * 86_400n * 1_000_000_000n, "a later level time wins");
  assert.equal(listingRunsAtNs({ ready_at_ns: w.ready_at_ns, change: { Upgrade: { code_hash: "x" } } }, wait, false), null);
});

test("updateRunsAtIso: placed with its listing, the switch is said at the listing's time; otherwise the contract's own", () => {
  const own = "2026-12-26T19:06:09.102Z"; // the proof's 8-day answer
  assert.equal(updateRunsAtIso(own, { levelSeconds: 8 * DAY, listSeconds: 21 * DAY, listedNow: true }), "2027-01-08T19:06:09.102Z", "21 days: the proof's account.rules time");
  assert.equal(updateRunsAtIso(own, { levelSeconds: 8 * DAY, listSeconds: 8 * DAY, listedNow: true }), own, "control: same waits, unchanged");
  assert.equal(updateRunsAtIso(own, { levelSeconds: 8 * DAY, listSeconds: 21 * DAY, listedNow: false, listingReadyIso: "2027-01-01T00:00:00.000Z" }), "2027-01-01T00:00:00.000Z", "behind a waiting listing: its time");
  assert.equal(updateRunsAtIso(own, { levelSeconds: 8 * DAY, listSeconds: 21 * DAY, listedNow: false }), own, "control: nothing to wait behind");
});

test("21 days, not 8: the update's answer, account.waiting and account.rules say the listing's real time; the sheet says 21 days", async () => {
  const { chain, core, a, seen } = await release9();
  try {
    chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
    const asked = Date.now();
    const out = ok(await core.call<Outcome>("account.rules.update"));
    assert.equal(out.status, "waiting");
    near(Date.parse(out.readyAtIso), asked + 21 * DAY * MS, "account.rules.update's answer");
    // Control: the contract's own answer (the switch's ready_at) is its level's 8 days: what the proof's result said.
    const rawSwitch = a.rules!.waiting.find((w) => w.change.Upgrade)!;
    near(Number(rawSwitch.readyAtNs / 1_000_000n), asked + 8 * DAY * MS, "control: the raw switch is 8 days");
    const rawListing = a.rules!.waiting.find((w) => w.change.AllowRelease)!;
    near(Number(rawListing.readyAtNs / 1_000_000n), asked + 8 * DAY * MS, "control: the raw listing is 8 days");

    const held = ok(await core.call<HeldRequest[]>("account.waiting"));
    const listing = held.find((h) => h.kind === "AllowRelease")!;
    near(Date.parse(listing.readyAtIso), asked + 21 * DAY * MS, "account.waiting's listing");
    const rules = ok(await core.call<Rules>("account.rules"));
    assert.equal(rules.update?.waiting?.readyAtIso, held.find((h) => h.kind === "Upgrade")!.readyAtIso, "account.rules and account.waiting: one time");

    // The sheet: one Face ID for both steps, saying the listing and its 21 days; never "It waits 8 days".
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]!.lines.slice(2, 4), ["First, your Safe allows the new version. That takes 21 days.", "Then it switches right away. You can cancel before that."]);
    assert.ok(!seen[0]!.lines.some((l) => /8 days|waits longer/.test(l)), seen[0]!.lines.join(" | "));
  } finally {
    core.close();
  }
});

test("a laptop's yes not on the account for the fallback wait: account.rules says 21 days like account.waiting (it said 8)", async () => {
  const { chain, core, a } = await release9();
  try {
    chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
    const asked = Date.now();
    ok(await core.call("account.rules.update"));
    // Only the listing waits (the switch cancelled), co-signed by a laptop of age that is NOT fallback-aged (R9-AL1).
    a.rules!.waiting = a.rules!.waiting.filter((w) => w.change.AllowRelease);
    a.rules!.second.push("ed25519:laptop");
    for (const w of a.rules!.waiting) Object.assign(w, { approved: true, approvedBy: "ed25519:laptop" });
    a.rules!.yesFromNs = new Map([["ed25519:laptop", String(BigInt(asked + 5 * DAY * MS) * 1_000_000n)]]);
    const rules = ok(await core.call<Rules>("account.rules"));
    const held = ok(await core.call<HeldRequest[]>("account.waiting")).find((h) => h.kind === "AllowRelease")!;
    near(Date.parse(rules.update!.waiting!.readyAtIso), asked + 21 * DAY * MS, "account.rules (the old rule said the level's 8 days)");
    assert.equal(rules.update!.waiting!.readyAtIso, held.readyAtIso, "one rule, one time");
    // Control: a fallback-aged laptop's yes counts in both: the level's 8 days.
    a.rules!.yesFromNs = new Map([["ed25519:laptop", "0"]]);
    const rules2 = ok(await core.call<Rules>("account.rules"));
    near(Date.parse(rules2.update!.waiting!.readyAtIso), asked + 8 * DAY * MS, "a fallback-aged yes: 8 days");
    assert.equal(rules2.update!.waiting!.readyAtIso, ok(await core.call<HeldRequest[]>("account.waiting")).find((h) => h.kind === "AllowRelease")!.readyAtIso);
  } finally {
    core.close();
  }
});

test("release 4: the update's sheet says its 2 minutes and nothing about a second device; the waiting row neither", async () => {
  const { chain, core } = await v4Account();
  const seen = sheets(core, false);
  try {
    chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
    const asked = Date.now();
    const out = ok(await core.call<Outcome>("account.rules.update"));
    assert.equal(out.status, "waiting");
    near(Date.parse(out.readyAtIso), asked + 120 * MS, "2 minutes");
    const lines = seen.at(-1)!.lines;
    assert.equal(lines[2], "Your Safe switches to the new version in 2 minutes. You can cancel until then.");
    assert.ok(!lines.some((l) => /second device|waits longer|First, your Safe/.test(l)), lines.join(" | "));
    const row = ok(await core.call<HeldRequest[]>("account.waiting")).find((h) => h.kind === "Upgrade")!;
    assert.ok(!row.lines.some((l) => /second device/.test(l)), row.lines.join(" | "));
    near(Date.parse(row.readyAtIso), asked + 120 * MS, "the row: 2 minutes");
  } finally {
    core.close();
  }
});

test("the listing's sheet and the switch's sheet never carry the same words", async () => {
  const listing = (await (async () => {
    const { chain, core, seen } = await release9();
    try {
      chain.publishGlobal(RELEASE_10.codeHashBase58, RELEASE_10.sha256Hex);
      ok(await core.call("account.rules.update"));
      return seen[0]!.lines.slice(2, -1);
    } finally {
      core.close();
    }
  })());
  const { chain, core } = await v4Account();
  const seen = sheets(core, false);
  try {
    chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
    ok(await core.call("account.rules.update"));
    const sw = seen.at(-1)!.lines.slice(2, -1);
    assert.ok(sw.length > 0 && listing.length > 0);
    assert.deepEqual(sw.filter((l) => listing.includes(l)), [], `shared: ${sw.join(" | ")} vs ${listing.join(" | ")}`);
  } finally {
    core.close();
  }
});

test("the upgrade call's words never promise a second device's yes makes it sooner", () => {
  const b64 = (hex: string) => bytesToBase64(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));
  for (const sha of [ACCOUNT_POLICY.sha256Hex, RELEASE_10.sha256Hex]) {
    const w = ownAccountCall("upgrade", { code_hash: b64(sha) })!;
    assert.ok(!w.lines.some((l) => /second device|waits longer/.test(l)), w.lines.join(" | "));
  }
});

test("release 4: removing a laptop names the cause and the update, never a dead Try again; control: published update missing or newer release", async () => {
  const { chain, core, accountId, a } = await v4Account();
  try {
    // The laptop as release 4 paired it: the contract's own receipt added it (no transaction names it), approve and decline.
    // Release 4's add_second_device takes ML-DSA-65 keys only, so the laptop's key is one (audit, 5 Nov).
    const handle = "ml-dsa-65-hash:8a1bdbB2FDXh8sWbmLGF1y6CpY3hUuZm9wHtUUQ1Fw4n";
    a.keys.set(handle, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: [...RELEASE6_SECOND_DEVICE_METHODS], allowanceYocto: null } });
    // Control (audit, key-flags wins): an ed25519 key with the second device's methods on a Safe with rules is refused up
    // front (the contract's remove_key takes ML-DSA-65 keys only), never sent to the update.
    const classical = "ed25519:8a1bdbB2FDXh8sWbmLGF1y6CpY3hUuZm9wHtUUQ1Fw4n";
    a.keys.set(classical, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: [...RELEASE6_SECOND_DEVICE_METHODS], allowanceYocto: null } });
    assert.equal(code(await core.call("account.removeKey", { handle: classical })), "security.request.not-allowed");
    a.keys.delete(classical);
    // Control: no published update to offer: the old words (the update row isn't there to send the person to).
    assert.equal(code(await core.call("account.removeKey", { handle })), "security.key.not-found");
    chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
    const r = await core.call("account.removeKey", { handle });
    assert.ok("problem" in r);
    if (!("problem" in r)) return;
    assert.equal(r.problem.code, "security.key.needs-update");
    assert.equal(r.problem.whatHappened, "Your Safe's rules are too old to remove this device. Nothing was removed.");
    assert.equal(r.problem.money.state, "safe");
    assert.deepEqual(r.problem.next, { kind: "open", label: "Update your Safe", screen: "security/protection" });
    assert.notEqual(r.problem.next.kind, "retry", "a retry can never find the key");
    // Control: on a later release (its own record would name the key), the same miss stays "not found".
    const v4Code = a.codeHash;
    a.codeHash = ACCOUNT_POLICY.codeHashBase58;
    assert.notEqual(code(await core.call("account.removeKey", { handle })), "security.key.needs-update");
    // Control: a plain classical key (a leftover set-up key, not a second device) is still its own full text: it never
    // gets the second device's not-found or update refusal.
    a.codeHash = v4Code;
    const plain = "ed25519:9fXq1nYb3Zr4oTpX7m2L8kVwQe5sRdUcJhGaBy6NtPzK";
    a.keys.set(plain, { nonce: 0n, permission: { kind: "full" } });
    const plainCode = code(await core.call("account.removeKey", { handle: plain }));
    assert.ok(!["security.key.not-found", "security.key.needs-update"].includes(plainCode), plainCode);
  } finally {
    core.close();
  }
});
