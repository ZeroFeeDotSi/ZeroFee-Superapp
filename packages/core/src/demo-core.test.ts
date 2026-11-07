import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { forApps, routeBridge } from "./bridge.ts";
import type { Bridge, BridgeResult } from "./bridge.ts";
import { contractBands, DEFAULT_PROTECTION, defaultBands, DemoCore, usdBands } from "./demo-core.ts";
import { seedToWords, wordsToSeed } from "./recovery-words.ts";
import { hotRoot, hotSecret } from "./hot-keys.ts";
import { solAddress } from "./solana.ts";
import type { AccountInfo, PlainWords, TxOutcome } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { availableYocto } from "./near-available.ts";
import { MemoryVault } from "./vault.ts";
import { ACCOUNT_POLICY, RECOVERY_POLICY, ownAccountCall } from "./known-contracts.ts";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner, handleOf } from "./dev-signer.ts";
import { toBase58 } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";

// The account contract's short-waits build: the recovery-only contract is never installed any more (audit, core integrity 4).
const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));

function newCore(chain: FakeChain, vault = new MemoryVault(), over: Partial<ConstructorParameters<typeof DemoCore>[0]> = {}) {
  return new DemoCore({ chain, vault, policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, ...over });
}

/** A demo sheet: records what it was shown and answers yes (or no). */
function sheet(core: Bridge, answer = true) {
  const shown: PlainWords[] = [];
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    shown.push(words);
    void core.call("approval.answer", { id, approve: answer });
  });
  return shown;
}

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};
const code = (r: BridgeResult<unknown>) => ("problem" in r ? r.problem.code : "ok");

async function readyAccount(chain = new FakeChain()) {
  const core = newCore(chain);
  const shown = sheet(core);
  const account = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
  return { chain, core, shown, words, accountId: account.accountId };
}

test("testnet's account service: a hiccup is tried again by itself; a long 'not now' says its real wait; Try again needs no new key", async () => {
  const { HelperBusy, retryAfterMs, waitWords } = await import("./demo-core.ts");
  assert.equal(retryAfterMs("120", "", 0), 120_000);
  assert.equal(retryAfterMs(null, "Too many requests, retry in 10 hours", 0), 36_000_000);
  assert.equal(retryAfterMs(null, "nope", 0), null);
  assert.match(waitWords(10 * 3_600_000 + 60_000, 0), /^after \d{1,2}:\d\d [AP]M$/);
  assert.equal(waitWords(30 * 3_600_000, 0), "in about 30 hours");
  // A clock time, never a count that stays on screen (grade 02h, H5), rounded up to the minute
  assert.match(waitWords(3 * 60_000, 0), /^after \d{1,2}:\d\d [AP]M$/);
  const t0 = Date.parse("2026-11-02T06:33:00");
  assert.equal(waitWords(t0 + 7 * 60_000 + 30_000, t0), "after 6:41 AM");
  assert.equal(waitWords(t0 + 8 * 60_000, t0), "after 6:41 AM");

  const chain = new FakeChain();
  const vault = new MemoryVault();
  let tries = 0;
  const flaky = newCore(chain, vault, { createRetryMs: 1, createAccount: async (id, pk) => { if (++tries < 3) throw new Error("faucet 502"); chain.fund(id, pk); } });
  const steps: unknown[] = [];
  flaky.on("account.create.step", (s) => steps.push(s));
  ok(await flaky.call("account.create"));
  assert.equal(tries, 3, "two hiccups, then made");
  assert.deepEqual(steps.slice(0, 3), [{ step: 1 }, { step: 1, retrying: true }, { step: 1, retrying: true }]);
  flaky.close();

  const busyVault = new MemoryVault();
  let made = 0;
  let calls = 0;
  const busy = newCore(new FakeChain(), busyVault, {
    createRetryMs: 1,
    deviceKeys: { make: async () => (made++, SoftwareKey.generate()), get: async () => (made ? SoftwareKey.generate() : null), forget: async () => {} },
    createAccount: async () => { calls++; throw new HelperBusy(Date.now() + 10 * 3_600_000); },
  });
  const p = (await busy.call("account.create")) as { problem: { code: string; whatHappened: string; next: { kind: string; label: string; untilIso?: string } } };
  assert.equal(p.problem.code, "security.account.create-later");
  assert.match(p.problem.whatHappened, /^NEAR's free test service is busy\. Try again after \d{1,2}:\d\d [AP]M\.$/);
  assert.deepEqual((p.problem as { next2?: unknown }).next2, { label: "Look around with sample money for now", kind: "url", url: "/?demo" }, "never a dead end");
  assert.equal(p.problem.next.kind, "wait");
  assert.equal((p.problem.next as { disabledUntil?: string }).disabledUntil, p.problem.next.untilIso, "the pill stays off until then");
  assert.ok(Date.parse(p.problem.next.untilIso!) > Date.now() + 9 * 3_600_000);
  assert.equal(calls, 1, "a long wait isn't hammered");
  assert.deepEqual(ok(await busy.call("account.state")), { stage: "none" }, "nothing unfinished is left");
  await busy.call("account.create");
  assert.equal(made, 1, "Try again keeps the key: no second Face ID");
  busy.close();
});

test("making an account tells the first-run screen each step as it starts: the account, its key and rules, the check", async () => {
  const chain = new FakeChain();
  const core = newCore(chain);
  const steps: unknown[] = [];
  core.on<{ step: number }>("account.create.step", ({ step }) => steps.push(step));
  ok(await core.call("account.create"));
  assert.deepEqual(steps, [1, 2, 3]);
  core.close();
});

test("a new account has exactly one key, post-quantum, plus ZeroFee's account rules (never the recovery-only contract)", async () => {
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { secretsInMemory: true });
  assert.deepEqual(ok(await core.call("account.state")), { stage: "none" });
  const account = ok(await core.call<{ accountId: string }>("account.create"));
  const onChain = chain.accounts.get(account.accountId)!;
  assert.deepEqual([...onChain.keys.keys()].map((k) => k.split(":")[0]), ["ml-dsa-65"]);
  assert.equal(onChain.codeHash, ACCOUNT_POLICY.shortWaits.codeHashBase58);
  assert.notEqual(onChain.codeHash, RECOVERY_POLICY.codeHashBase58);
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "needs-backup");
  // Nothing can be signed for an app until the backup is done.
  assert.equal(code(await core.call("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "", from: "wallet" } })), "security.backup.needed");
});

test("the recovery key goes on-chain only after three words are confirmed", async () => {
  const chain = new FakeChain();
  // a browser's words (audit K-2): made when shown, their key on chain once three are checked
  const core = newCore(chain, new MemoryVault(), { secretsInMemory: true });
  const shown = sheet(core);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  assert.equal(words.length, 24);
  const wrong = await core.call("recovery.confirm", { positions: [3, 7, 20], words: [words[2], "zoo", words[19]] });
  assert.equal(code(wrong), "security.words.wrong");
  assert.equal("problem" in wrong && wrong.problem.next.kind === "fix-input" && wrong.problem.next.field, "word-7");
  assert.equal(chain.accounts.get(accountId)!.keys.size, 1);

  ok(await core.call("recovery.confirm", { positions: [3, 7, 20], words: [words[2], words[6].toUpperCase(), ` ${words[19]} `] }));
  assert.equal(shown.at(-1)!.title, "Add your backup words to your account");
  // the phone's key is a limited key too now (the account rules'), never a full-access one
  assert.ok([...chain.accounts.get(accountId)!.keys.values()].every((k) => k.permission.kind === "function-call"), "no full-access key");
  const recoveryKey = [...chain.accounts.get(accountId)!.keys.values()].find((k) => k.permission.kind === "function-call" && k.permission.methods.includes("start_recovery"))!;
  assert.deepEqual(recoveryKey.permission, { kind: "function-call", receiverId: accountId, methods: ["start_recovery", "finish_recovery"], allowanceYocto: 250_000_000_000_000_000_000_000n });
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
});

test("closing the app during the backup leaves no key nobody wrote down: the words just change", async () => {
  const chain = new FakeChain();
  const vault = new MemoryVault();
  const first = newCore(chain, vault, { secretsInMemory: true });
  const { accountId } = ok(await first.call<{ accountId: string }>("account.create"));
  const before = ok(await first.call<{ words: string[] }>("recovery.words")).words;
  const reopened = newCore(chain, vault, { secretsInMemory: true });
  sheet(reopened);
  const after = ok(await reopened.call<{ words: string[] }>("recovery.words")).words;
  assert.notDeepEqual(after, before);
  assert.equal(code(await reopened.call("recovery.confirm", { positions: [1, 2, 3], words: before.slice(0, 3) })), "security.words.wrong");
  assert.equal(chain.accounts.get(accountId)!.keys.size, 1);
});

test("a policy build that isn't the official one is refused before any account exists", async () => {
  const chain = new FakeChain();
  const tampered = wasm.slice();
  tampered[tampered.length - 1] ^= 1;
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => tampered });
  assert.equal(code(await core.call("account.create")), "security.build.mismatch");
  assert.equal(chain.accounts.size, 0);
});

test("a failed faucet leaves nothing behind", async () => {
  const core = newCore(new FakeChain(), new MemoryVault(), { createAccount: async () => { throw new Error("429"); } });
  assert.equal(code(await core.call("account.create")), "security.account.create-failed");
  assert.deepEqual(ok(await core.call("account.state")), { stage: "none" });
});

test("apps can neither see nor answer approvals, nor pose as another app", async () => {
  const { core, shown } = await readyAccount();
  const app = forApps(core, "trade");
  let peeked = false;
  app.on("approval.needed", () => (peeked = true));
  assert.equal(code(await app.call("approval.answer", { id: "x", approve: true })), "security.bridge.not-allowed");
  const outcome = ok(await app.call<TxOutcome>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "Official security update", from: "security" } }));
  assert.equal(outcome.status, "done");
  assert.equal(peeked, false);
  // The app claimed to be ZeroFee's security layer; the sheet names the app that really asked.
  assert.equal(shown.at(-1)!.hint, "Trade says: Official security update");
});

test("with no approval sheet listening, nothing is signed", async () => {
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { secretsInMemory: true });
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  assert.equal(code(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) })), "security.backup.declined");
  assert.equal(chain.accounts.get(accountId)!.keys.size, 1);
});

test("device calls carry the real app's id, whatever the app claims", async () => {
  const seen: Record<string, unknown>[] = [];
  const host: Bridge = { call: async (_m, p) => (seen.push(p ?? {}), { ok: null as any }), on: () => () => {} };
  await forApps(host, "pay").call("device.store.get", { key: "contacts", app: "wallet" });
  assert.deepEqual(seen, [{ key: "contacts", app: "pay" }]);
});

test("services answer their own methods; core methods can't be taken over", async () => {
  const core = newCore(new FakeChain());
  const ledger: Bridge = { call: async (m) => ({ ok: `ledger answered ${m}` as any }), on: () => () => {} };
  const bridge = routeBridge(core, { ledger });
  assert.equal(ok(await bridge.call("ledger.balances")), "ledger answered ledger.balances");
  assert.deepEqual(ok(await bridge.call("account.state")), { stage: "none" });
  for (const name of ["tx", "approval", "account", "recovery", "subwallet"]) assert.throws(() => routeBridge(core, { [name]: ledger }));
});

test("on the phone the words are typed on its own screen and go straight to the core; the page's words are refused", async () => {
  const { chain, words, core: oldPhone } = await readyAccount();
  const asked: string[] = [];
  let typed: string[] | null = words;
  const native = { typeWords: async (purpose: "restore" | "check") => (asked.push(purpose), typed) };
  // "Check my words" on the old phone: typed there, matched by the core.
  const checker = newCore(chain, (oldPhone as any).vault, native);
  assert.deepEqual(ok(await checker.call("recovery.check")), { matches: true });
  assert.equal(code(await checker.call("recovery.check", { words })), "security.request.not-allowed", "words from the page");
  // A restore on a new device.
  const newPhone = newCore(chain, new MemoryVault(), native);
  sheet(newPhone);
  typed = null;
  assert.equal(code(await newPhone.call("recovery.start")), "security.words.stopped");
  assert.equal(code(await newPhone.call("recovery.start", { words })), "security.request.not-allowed");
  typed = words;
  assert.ok(Date.parse(ok(await newPhone.call<{ readyAtIso: string }>("recovery.start")).readyAtIso) > Date.now());
  assert.deepEqual(asked, ["check", "restore", "restore"]);
  oldPhone.close();
  checker.close();
  newPhone.close();
});

test("grade 01c P12: the recovery watcher reads the status once a tick and hands it out (recovery.status), never twice", async () => {
  const { chain, core } = await readyAccount();
  const realView = chain.view.bind(chain);
  let reads = 0;
  chain.view = (async (contractId: string, method: string, args?: Record<string, unknown>, block?: unknown) => {
    if (method === "delay_seconds") reads++;
    return realView(contractId, method, args, block as never);
  }) as typeof chain.view;
  const statuses: unknown[] = [];
  const offStatus = core.on("recovery.status", (s) => statuses.push(s));
  const off = core.on("recovery.started", () => {});
  await new Promise((r) => setTimeout(r, 200));
  off();
  offStatus();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(statuses.length >= 2, `ticks: ${statuses.length}`);
  assert.ok(reads <= statuses.length + 1, `status read ${reads} times for ${statuses.length} ticks`);
  assert.deepEqual(statuses.at(-1), ok(await core.call("recovery.status")));
  core.close();
});

test("typed words are checked precisely, and words for no account say so", async () => {
  const core = newCore(new FakeChain());
  const words = seedToWords(new Uint8Array(randomBytes(32)));
  assert.equal(code(await core.call("recovery.start", { words: words.slice(0, 23) })), "security.words.count");
  assert.equal(code(await core.call("recovery.start", { words: [...words.slice(0, 6), "notaword", ...words.slice(7)] })), "security.words.unknown");
  assert.equal(code(await core.call("recovery.start", { words })), "security.words.no-account");
});

test("recovery: words alone start it, the old phone sees it and cancels; after the wait, the new device takes over", async () => {
  const { chain, core: oldPhone, words, accountId } = await readyAccount();
  const started: string[] = [];
  oldPhone.on<{ readyAtIso: string }>("recovery.started", ({ readyAtIso }) => started.push(readyAtIso));

  const newPhone = newCore(chain);
  const newSheet = sheet(newPhone);
  const { readyAtIso } = ok(await newPhone.call<{ readyAtIso: string }>("recovery.start", { words }));
  assert.equal(newSheet.at(-1)!.title, "Start moving your account to this device");
  assert.ok(Date.parse(readyAtIso) > Date.now());
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(started, [readyAtIso]);

  assert.equal(ok(await oldPhone.call<TxOutcome>("recovery.cancel")).status, "done");
  assert.equal(code(await newPhone.call("recovery.finish")), "security.recovery.stopped");
  assert.equal(ok(await newPhone.call<{ stage: string }>("account.state")).stage, "none");

  ok(await newPhone.call("recovery.start", { words }));
  assert.equal(code(await newPhone.call("recovery.finish")), "security.recovery.waiting");
  chain.skewSeconds = 61;
  // The demo core reads the clock itself, so move it forward too.
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    const account = ok(await newPhone.call<{ accountId: string }>("recovery.finish"));
    assert.equal(account.accountId, accountId);
  } finally {
    Date.now = realNow;
  }
  const restored = ok(await newPhone.call<{ stage: string; restoredAtIso?: string }>("account.state"));
  assert.equal(restored.stage, "ready");
  // A12: the new device knows it came back from the words, so Activity says earlier history isn't on it
  assert.ok(restored.restoredAtIso && Date.parse(restored.restoredAtIso) > 0, "restoredAtIso");
  const sent = ok(await newPhone.call<TxOutcome>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "", from: "wallet" } }));
  assert.equal(sent.status, "done");

  // The account rules' recovery takes the old phone's key off itself (the recovery-only contract left it on: audit, core
  // integrity 4). The new device can't remove its own key nor the backup key.
  const info = ok(await newPhone.call<{ account: { keys: { handle: string; role: string; current?: boolean }[] } }>("account.state")).account;
  assert.equal(info.keys.filter((k) => k.role === "device" && !k.current).length, 0, "the old phone's key is gone");
  const ownKey = info.keys.find((k) => k.current)!;
  const backupKey = info.keys.find((k) => k.role === "recovery")!;
  assert.equal(code(await newPhone.call("account.removeKey", { handle: ownKey.handle })), "security.request.not-allowed");
  assert.equal(code(await newPhone.call("account.removeKey", { handle: backupKey.handle })), "security.request.not-allowed");
  assert.equal(code(await oldPhone.call("account.state")), "security.key.missing");

  // The activity list says what happened and which key signed it.
  const log = ok(await newPhone.call<{ title: string; by: string; ok: boolean }[]>("account.activity", { limit: 50 }));
  const row = (title: string) => log.find((r) => r.title.startsWith(title));
  const setup = log.find((r) => r.title === "Set up your account") as { by: string; lines: string[] } | undefined;
  assert.equal(setup?.by, "Set-up");
  assert.ok(setup?.lines.includes("Removed the set-up key"), setup?.lines.join(" / "));
  assert.ok(!log.some((r) => /…|post-quantum/.test(r.title)), log.map((r) => r.title).join(" / "));
  assert.equal(row("Started moving the account to a new device")?.by, "Your backup words");
  assert.equal(row("Stopped a move to a new device")?.by, "A key you removed later");
  assert.equal(row("Moved the account to a new device")?.by, "Your backup words");
  oldPhone.close();
  newPhone.close();
});

test("the words bring back the hot wallets: a restore lists Trading's balance and the pocket at the same addresses", async () => {
  const { chain, core: oldPhone, words } = await readyAccount();
  const float = ok(await oldPhone.call<{ address: string; inWords?: true }>("subwallet.create", { kind: "trade", chain: "near" }));
  const pocket = ok(await oldPhone.call<{ address: string; inWords?: true }>("subwallet.create", { kind: "private", chain: "near" }));
  const sol3 = ok(await oldPhone.call<{ address: string }>("subwallet.create", { kind: "trade", chain: "sol", slot: 3 }));
  assert.deepEqual([float.inWords, pocket.inWords], [true, true]);

  const newPhone = newCore(chain);
  sheet(newPhone);
  ok(await newPhone.call("recovery.start", { words }));
  chain.skewSeconds = 61;
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    ok(await newPhone.call("recovery.finish"));
  } finally {
    Date.now = realNow;
  }
  const back = ok(await newPhone.call<{ kind: string; chain: string; address: string; inWords?: true }[]>("subwallet.list"));
  assert.deepEqual(back.map((w) => [w.kind, w.chain, w.address, w.inWords]).sort(), [["private", "near", pocket.address, true], ["trade", "near", float.address, true]].sort());
  // Anything the restore didn't list comes back the moment it's asked for: the same key from the same words.
  assert.equal(ok(await newPhone.call<{ address: string }>("subwallet.create", { kind: "trade", chain: "sol", slot: 3 })).address, sol3.address);
  // The new device keeps the hot root itself, so the wallets it makes from here on come from the words too.
  const vault = (newPhone as unknown as { vault: MemoryVault }).vault;
  assert.ok(await vault.get("hot-root"));
});

test("an older account's hot wallets stay usable and are marked; once the words are typed, new ones come from them", async () => {
  const { core, words } = await readyAccount();
  const vault = (core as unknown as { vault: MemoryVault }).vault;
  await vault.delete("hot-root"); // as an account made before the words made the hot wallets
  const old = ok(await core.call<{ address: string; inWords?: true }>("subwallet.create", { kind: "trade", chain: "sol", slot: 0 }));
  assert.equal(old.inWords, undefined);
  assert.equal(ok(await core.call<{ matches: boolean }>("recovery.check", { words })).matches, true);
  const fresh = ok(await core.call<{ address: string; inWords?: true }>("subwallet.create", { kind: "trade", chain: "sol", slot: 1 }));
  assert.equal(fresh.inWords, true);
  // One wallet per chain (D55): the chain's wallet is now index 0 of the words; the older one stays listed, as older.
  const current = ok(await core.call<{ id: string; address: string; inWords?: true; current?: boolean }>("subwallet.create", { chain: "sol" }));
  assert.deepEqual([current.inWords, current.current], [true, true]);
  assert.notEqual(current.address, old.address);
  const listed = ok(await core.call<{ address: string; current?: boolean }[]>("subwallet.list")).find((w) => w.address === old.address)!;
  assert.equal(listed.current, false, "the older one is listed, as an older wallet");
});

test("checking the backup words signs nothing and says only whether they match", async () => {
  const { chain, core, words } = await readyAccount();
  const sent = chain.sent.length;
  assert.deepEqual(ok(await core.call("recovery.check", { words })), { matches: true });
  assert.deepEqual(ok(await core.call("recovery.check", { words: seedToWords(new Uint8Array(randomBytes(32))) })), { matches: false });
  assert.equal(code(await core.call("recovery.check", { words: words.slice(1) })), "security.words.count");
  assert.equal(code(await core.call("recovery.check", { words: [...words.slice(0, 4), "nope", ...words.slice(5)] })), "security.words.unknown");
  assert.equal(chain.sent.length, sent);
});

// ── With the account contract: protection by amount ──

// The short-waits build (a minute's least delay) off mainnet, as the tests' fake chain is testnet; the pinned release on mainnet.
const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const mainnetWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const realNow = Date.now;
/** Move the clock forward (the fake chain and the core both read Date.now). */
const advance = (seconds: number) => {
  const base = Date.now();
  Date.now = () => base + seconds * 1000 + (realNow() - realNow());
};
const restoreClock = () => (Date.now = realNow);
const pay = (yocto: string) => ({ request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto }], why: "", from: "wallet" } });
const NEAR = "000000000000000000000000";

/** Bands these tests hold payments with: Face ID up to 5 NEAR, more waits 2 minutes (the default is DEFAULT_PROTECTION, tested on its own). */
const HOLD_ABOVE_5_NEAR = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];

/** A ready account on the release. `modules`: on v6's first build instead, which has Agent, Legacy and Kids. */
async function readyWithRules(o: { modules?: boolean; over?: Partial<ConstructorParameters<typeof DemoCore>[0]> } = {}) {
  const chain = new FakeChain();
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  // These test cores have no native sheet, so they stand for the web: D103's user check passes here unless a test says
  // otherwise (the D103 test does).
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }), protection: HOLD_ABOVE_5_NEAR, userVerified: async () => true, ...o.over });
  const shown = sheet(core);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  if (o.modules) chain.withModules(accountId);
  return { chain, core, shown, accountId };
}

test("first run, one sheet: the words' recovery key goes in with the account, so checking the words signs nothing", async () => {
  const chain = new FakeChain();
  const vault = new MemoryVault();
  const core = newCore(chain, vault, { policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }) });
  const shown = sheet(core);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  // Already on chain before the words are shown: the recovery key, its two methods only.
  const methods = [...chain.accounts.get(accountId)!.keys.values()].map((k) => (k.permission.kind === "full" ? "full" : k.permission.methods.join()));
  assert.ok(methods.includes(ACCOUNT_POLICY.recoveryKeyMethods.join()));
  core.close();
  // The app restarts before the words: the same words come back (kept in this device's vault until checked).
  const again = newCore(chain, vault, { policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }) });
  const shownAgain = sheet(again);
  const { words } = ok(await again.call<{ words: string[] }>("recovery.words"));
  ok(await again.call("recovery.confirm", { positions: [2, 9, 20], words: [words[1], words[8], words[19]] }));
  assert.equal(shown.length + shownAgain.length, 0, "no approval sheet at all after making the key");
  assert.equal(ok(await again.call<{ stage: string }>("account.state")).stage, "ready");
  assert.equal(await vault.get("pending-words"), null, "the words leave the vault once checked");
  assert.deepEqual(ok(await again.call<{ matches: boolean }>("recovery.check", { words })), { matches: true }, "and they are the words of the key on chain");
  again.close();
});

test("no Check later (J2, B2): the check can't be skipped; an account from before that skipped it is reminded until a check matches", async () => {
  const chain = new FakeChain();
  const vault = new MemoryVault();
  const core = newCore(chain, vault, { policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }) });
  sheet(core);
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  assert.equal(code(await core.call("recovery.later")), "security.method.unknown", "gone, even with the words on screen");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "needs-backup", "so the words are still to check");
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  // An account made before J2 with "Check later": its record says so, and the reminder holds until a check matches.
  const saved = JSON.parse(new TextDecoder().decode((await vault.get("state"))!));
  await vault.put("state", new TextEncoder().encode(JSON.stringify({ ...saved, checkDue: true })));
  const state = ok(await core.call<{ stage: string; wordsCheckDue?: boolean }>("account.state"));
  assert.deepEqual([state.stage, state.wordsCheckDue], ["ready", true]);
  const wrong = [...words];
  wrong[0] = words[0] === "abandon" ? "ability" : "abandon";
  assert.ok(code(await core.call("recovery.check", { words: wrong })), "a wrong word is a Problem");
  assert.equal(ok(await core.call<{ wordsCheckDue?: boolean }>("account.state")).wordsCheckDue, true, "a wrong check keeps the reminder");
  assert.equal(ok(await core.call<{ matches: boolean }>("recovery.check", { words })).matches, true);
  assert.equal(ok(await core.call<{ wordsCheckDue?: boolean }>("account.state")).wordsCheckDue, undefined, "the first match ends it");
  core.close();
});

test("with the account contract, no key can do anything alone: the phone's key only asks the account's rules", async () => {
  const { chain, accountId } = await readyWithRules();
  const onChain = chain.accounts.get(accountId)!;
  assert.equal(onChain.codeHash, ACCOUNT_POLICY.shortWaits.codeHashBase58, "testnet: the short-waits build of the same release");
  const permissions = [...onChain.keys.values()].map((k) => (k.permission.kind === "full" ? "full" : k.permission.methods.join()));
  assert.deepEqual(permissions.sort(), [ACCOUNT_POLICY.deviceMethods.join(), ACCOUNT_POLICY.recoveryKeyMethods.join()].sort());
});

test("a new account's protection is DEFAULT_PROTECTION in dollars: Face ID up to $500 each day, then a wait (2 minutes on testnet)", async () => {
  assert.deepEqual(DEFAULT_PROTECTION, { faceIdUpToUsd: 500, waitSeconds: { mainnet: 86_400, testnet: 120 } });
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }) });
  try {
    ok(await core.call("account.create"));
    const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
    ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
    const { bands } = ok(await core.call<{ bands: unknown[] }>("account.protection.get"));
    // $500 at $4 a NEAR is 125 NEAR; its last digits carry the $500 (50,000 cents, then the mark).
    assert.deepEqual(bands, [{ up_to: [["near", `${125n * 10n ** 24n + 50_000n * 1_000_000n + 777_777n}`]], level: "FaceId" },{ up_to: null, level: { Wait: { seconds: "120" } } }]);
  } finally {
    core.close();
  }
  // No prices: nothing is set up, rather than an account with bands that measure nothing.
  const blind = newCore(new FakeChain(), new MemoryVault(), { policyWasm: async () => rulesWasm, prices: async () => Promise.reject(new Error("offline")) });
  try {
    assert.ok("problem" in (await blind.call("account.create")));
  } finally {
    blind.close();
  }
});

test("on mainnet the default measures USDC and USDT like NEAR, and waits 24 hours above $500", () => {
  const bands = contractBands(defaultBands("mainnet"), { near: 2.5, usdc: 1, usdt: 0.999 }, "mainnet") as { up_to: [string, string][] | null; level: unknown }[];
  assert.deepEqual(bands[0]!.up_to!.slice(0, 4), [
    ["near", `200${"0".repeat(24)}`],
    ["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "500000000"],
    ["nep141:usdt.tether-token.near", "500000000"],
    ["nep141:wrap.near", `200${"0".repeat(24)}`],
  ], "a stablecoin counts at $1, whatever its listed price (audit NF-09); wNEAR as NEAR (H01)");
  assert.equal(bands[0]!.level, "FaceId");
  assert.deepEqual(bands[1], { up_to: null, level: { Wait: { seconds: "86400" } } });
  assert.throws(() => contractBands(defaultBands("mainnet"), { near: 0 }, "mainnet"), "no NEAR price, no bands");
});

test("protection.get says the account's rules in dollars: exactly what set-up wrote, on testnet and mainnet", async () => {
  // Testnet, end to end: a new account, then the read the Protection screen opens on.
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => rulesWasm, prices: async () => ({ near: 3.17 }) });
  try {
    ok(await core.call("account.create"));
    const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
    ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
    const got = ok(await core.call<{ usd: unknown }>("account.protection.get"));
    assert.deepEqual(got.usd, defaultBands("testnet"));
    assert.deepEqual(got.usd, [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 120 }]);
  } finally {
    core.close();
  }
  // Mainnet: USDC is written at $1, so the dollars come back exact, whatever NEAR costs now (no price needed).
  for (const near of [1.07, 2.5, 7.93]) {
    assert.deepEqual(usdBands(contractBands(defaultBands("mainnet"), { near }, "mainnet"), null), defaultBands("mainnet"));
    assert.deepEqual(usdBands(contractBands(defaultBands("mainnet"), { near }, "mainnet"), null), [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86_400 }]);
  }
  // Testnet's NEAR-only limit at the price it was written at reads back to the cent.
  for (const near of [1.07, 3.17, 7.93]) assert.deepEqual(usdBands(contractBands(defaultBands("testnet"), { near }, "testnet"), near), defaultBands("testnet"));
  // The limit carries its dollars, so no price is needed; an older one without them and no price, or a shape it can't
  // read: null, never a guess.
  assert.deepEqual(usdBands(contractBands(defaultBands("testnet"), { near: 2 }, "testnet"), null), defaultBands("testnet"));
  assert.equal(usdBands([{ up_to: [["near", "114416400000000000000000000"]], level: "FaceId" }, { up_to: null, level: "FaceId" }], null), null);
  for (const bad of [null, [], "x", [{ up_to: null, level: "Mystery" }], [{ up_to: "5", level: "FaceId" }]]) assert.equal(usdBands(bad, 2), null);
  // A single Face ID band, and a laptop's.
  assert.deepEqual(usdBands([{ up_to: null, level: "FaceId" }], null), [{ upToUsd: null, level: "faceid" }]);
  assert.deepEqual(usdBands([{ up_to: [["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "250000000"]], level: "Device" }, { up_to: null, level: { Both: { seconds: "3600" } } }], null), [{ upToUsd: 250, level: "device" }, { upToUsd: null, level: "both", waitSeconds: 3600 }]);
});

test("N5: a NEAR-only limit shows the dollars the person chose, whatever the price does since; elsewhere a round 'about'", async () => {
  let near = 4;
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => rulesWasm, prices: async () => ({ near }) });
  sheet(core);
  try {
    ok(await core.call("account.create"));
    const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
    ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
    near = 4.0123;
    assert.equal(ok(await core.call<{ usd: { upToUsd: number | null }[] }>("account.protection.get")).usd[0].upToUsd, 500, "set-up's $500, not $501.54");
    // A limit another device set reads the same here (02e, E3): the dollars it carries, whatever the price since.
    const onChain = contractBands([{ upToUsd: 750, level: "faceid" }, { upToUsd: null, level: "faceid" }], { near: 4 }, "testnet");
    assert.deepEqual(usdBands(onChain, 4.31)![0], { upToUsd: 750, level: "faceid" });
    // An older limit carries none: today's price, said as a round "about" figure.
    const older = [{ up_to: [["near", "187500000000000000000000000"]], level: "FaceId" }, { up_to: null, level: "FaceId" }];
    assert.deepEqual(usdBands(older, 4.31)![0], { upToUsd: 810, about: true, level: "faceid" });
  } finally {
    core.close();
  }
});

test("release 6, no second device: the phone's stop of a recovery says payments then wait, and they do", async () => {
  const { chain, core, shown, accountId } = await readyWithRules();
  try {
    // Someone with the backup words starts a recovery (the fake records it as the contract would).
    const policy = chain.accounts.get(accountId)!.policy!;
    const readyAtNs = (BigInt(Date.now()) * 1_000_000n) + policy.delayNs;
    policy.pending = { newKey: Buffer.from([2, ...new Uint8Array(1952).fill(0x11)]).toString("base64"), readyAtNs };
    const waiting = ok(await core.call<{ pending: { readyAtIso: string } | null; frozenUntilIso?: string | null }>("recovery.status"));
    assert.equal(waiting.frozenUntilIso, waiting.pending!.readyAtIso, "frozen at least until the recovery could finish");
    const held = ok(await core.call<TxOutcome>("tx.request", pay(`1${NEAR}`)));
    assert.equal(held.status, "waiting", "while it waits, even a small payment waits");

    assert.equal(ok(await core.call<TxOutcome>("recovery.cancel")).status, "done");
    assert.equal(shown.at(-1)!.title, "Stop moving your account to a new device");
    assert.ok(shown.at(-1)!.lines.includes("The move stops now. Then payments wait 2 minutes, so a thief gains nothing."));
    const after = ok(await core.call<{ pending: unknown; frozenUntilIso?: string | null }>("recovery.status"));
    assert.equal(after.pending, null);
    assert.ok(Date.parse(after.frozenUntilIso!) > Date.now() + 100_000, "for a change's wait after the stop");
    assert.equal(ok(await core.call<TxOutcome>("tx.request", pay(`1${NEAR}`))).status, "waiting");
    // A change's wait after the stop, the Face ID band is back.
    chain.skewSeconds = 121;
    const realNow = Date.now;
    Date.now = () => realNow() + 121_000;
    try {
      assert.equal(ok(await core.call<{ frozenUntilIso?: string | null }>("recovery.status")).frozenUntilIso, null);
      assert.equal(ok(await core.call<TxOutcome>("tx.request", pay(`1${NEAR}`))).status, "done");
    } finally {
      Date.now = realNow;
    }
  } finally {
    core.close();
  }
});

test("new backup words: shown, three checked, the backup key replaced through the rules; when it runs the hot root moves", async () => {
  const { chain, core, shown, accountId } = await readyWithRules();
  try {
    const before = ok(await core.call<{ id: string; address: string; inWords?: true; oldWords?: true }>("subwallet.create", { kind: "trade", chain: "sol", slot: 0 }));
    assert.equal(before.inWords, true);
    const { words } = ok(await core.call<{ words: string[] }>("recovery.renew"));
    assert.equal(words.length, 24);
    assert.deepEqual(ok(await core.call<{ words: string[] }>("recovery.renew")).words, words, "asked again before the check: the same words");
    assert.equal(code(await core.call("recovery.renewConfirm", { positions: [1, 2, 3], words: [words[0], words[1], "zoo"] })), "security.words.wrong");
    const out = ok(await core.call<TxOutcome>("recovery.renewConfirm", { positions: [4, 9, 20], words: [words[3], words[8], words[19]] }));
    assert.equal(out.status, "waiting", "a change's wait, as any change (re-audit 2, N1 (a))");
    assert.equal(Date.parse(out.readyAtIso!) - Date.now() > 110_000, true, "the floor (120 s here), not the band's");
    assert.equal(shown.at(-1)!.title, "Replace your backup words");
    assert.equal(shown.at(-1)!.lines[0], "Your new words become your account's backup key. Your old words stop working when this goes through.");
    assert.equal(code(await core.call("recovery.renew")), "security.words.renew-waiting");
    // Until it runs, nothing about the hot wallets changes.
    ok(await core.call("recovery.status"));
    assert.equal(ok(await core.call<{ inWords?: true }[]>("subwallet.list")).find((w: any) => w.id === before.id)!.inWords, true);

    chain.skewSeconds = 121;
    const realNow = Date.now;
    Date.now = () => realNow() + 121_000;
    try {
      const held = ok(await core.call<{ id: string }[]>("account.waiting"));
      assert.equal(ok(await core.call<TxOutcome>("account.waiting.run", { id: held[0]!.id })).status, "done");
      ok(await core.call("recovery.status"));
      const recoveryKeys = [...chain.accounts.get(accountId)!.keys.values()].filter((k) => k.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.recoveryKeyMethods.join());
      assert.equal(recoveryKeys.length, 1, "the old words' key is gone");
      const list = ok(await core.call<{ id: string; address: string; inWords?: true; oldWords?: true }[]>("subwallet.list"));
      const old = list.find((w) => w.id === before.id)!;
      assert.deepEqual([old.inWords, old.oldWords], [undefined, true], "made from the old words: listed, marked");
      // One wallet per chain (D55): the old words' wallet is older; the chain's wallet is the new words' index 0.
      assert.equal(ok(await core.call<{ id: string; current?: boolean }[]>("subwallet.list")).find((w) => w.id === before.id)!.current, false, "older now");
      const now0 = ok(await core.call<{ id: string; address: string; current?: boolean }>("subwallet.create", { chain: "sol" }));
      assert.deepEqual([now0.current, now0.address], [true, solAddress(hotSecret(hotRoot(wordsToSeed(words)), "trade", "sol", 0)!)], "the new words' index 0");
      const fresh = ok(await core.call<{ address: string; inWords?: true }>("subwallet.create", { kind: "trade", chain: "sol", slot: 1 }));
      assert.equal(fresh.inWords, true);
      assert.equal(fresh.address, solAddress(hotSecret(hotRoot(wordsToSeed(words)), "trade", "sol", 1)!), "a new place comes from the new words");
      assert.equal(ok(await core.call<{ words: string[] }>("recovery.renew")).words.length, 24, "and new words can be asked for again");
    } finally {
      Date.now = realNow;
    }
  } finally {
    core.close();
  }
});

test("new backup words can't be asked while a move to a new device waits, and a start drops those waiting", async () => {
  const { chain, core, accountId } = await readyWithRules();
  try {
    const { words } = ok(await core.call<{ words: string[] }>("recovery.renew"));
    assert.equal(ok(await core.call<TxOutcome>("recovery.renewConfirm", { positions: [1, 2, 3], words: words.slice(0, 3) })).status, "waiting");
    // The backup words start a recovery (the fake records it, and drops what the phone asked alone, as the contract does).
    const rules = chain.accounts.get(accountId)!.rules!;
    const policy = chain.accounts.get(accountId)!.policy!;
    policy.pending = { newKey: Buffer.from([2, ...new Uint8Array(1952).fill(0x11)]).toString("base64"), readyAtNs: BigInt(Date.now()) * 1_000_000n + policy.delayNs };
    rules.waiting = rules.waiting.filter((w) => w.approved);
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60_000;
    try {
      // The dropped words are forgotten, and none can be asked for while the recovery waits.
      const refused = await core.call("recovery.renew");
      assert.equal(code(refused), "security.words.renew-recovery-waiting");
      assert.match((refused as any).problem.whatHappened, /while a move is waiting/);
    } finally {
      Date.now = realNow;
    }
  } finally {
    core.close();
  }
});

test("new backup words cancelled before they run: forgotten once the chain shows it, and new ones can be asked for", async () => {
  const { core } = await readyWithRules();
  try {
    const { words } = ok(await core.call<{ words: string[] }>("recovery.renew"));
    assert.equal(ok(await core.call<TxOutcome>("recovery.renewConfirm", { positions: [1, 2, 3], words: words.slice(0, 3) })).status, "waiting");
    const held = ok(await core.call<{ id: string }[]>("account.waiting"));
    assert.equal(ok(await core.call<TxOutcome>("account.waiting.cancel", { id: held[0]!.id })).status, "done");
    assert.equal(code(await core.call("recovery.renew")), "security.words.renew-waiting", "a node may not show the cancel yet: kept for a while");
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60_000;
    try {
      const again = ok(await core.call<{ words: string[] }>("recovery.renew")).words;
      assert.notDeepEqual(again, words);
    } finally {
      Date.now = realNow;
    }
  } finally {
    core.close();
  }
});

test("the audit (rule 1): on an account with rules a classical key is refused by account.removeKey before any sheet (remove_key takes ML-DSA-65 only); control: no rules, it goes", async () => {
  const OLD = "ed25519:9fXq1nYb3Zr4oTpX7m2L8kVwQe5sRdUcJhGaBy6NtPzK";
  const { chain, core, accountId, shown } = await readyWithRules();
  chain.accounts.get(accountId)!.keys.set(OLD, { nonce: 0n, permission: { kind: "full" } });
  const before = shown.length;
  const r = await core.call("account.removeKey", { handle: OLD });
  assert.equal(code(r), "security.request.not-allowed");
  assert.match(JSON.stringify(r), /This older key can only be replaced from its own device. Replace it from that device\./);
  assert.equal(shown.length, before, "no sheet: nothing signed that would fail on chain");
  assert.ok(chain.accounts.get(accountId)!.keys.has(OLD));
  // control: the same key on an account without the account contract (an older recovery-only one): no gate, it goes
  const plain = await readyAccount();
  const acct = plain.chain.accounts.get(plain.accountId)! as { codeHash: string; global?: string };
  acct.codeHash = RECOVERY_POLICY.codeHashBase58;
  delete acct.global;
  plain.chain.accounts.get(plain.accountId)!.keys.set(OLD, { nonce: 0n, permission: { kind: "full" } });
  // (the fake's phone key stays the rules' function-call key, so NEAR itself turns the delete-key down: the point is that
  // the core lets it through to the sheet and the chain, never its own refusal)
  const sheets = plain.shown.length;
  const pr = await plain.core.call<TxOutcome>("account.removeKey", { handle: OLD });
  assert.equal(code(pr), "ok", JSON.stringify(pr));
  assert.equal(plain.shown.length, sheets + 1, "it reached the sheet");
});

test("background alerts: what's new since last asked, each told once, in plain words; what the open app showed is never told again", async () => {
  const { chain, core, accountId } = await readyWithRules();
  try {
    type Alerts = { alerts: { kind: string; id: string; title: string; body: string }[] };
    assert.deepEqual(ok(await core.call<Alerts>("alerts.poll")).alerts, []);
    // S-1: a payment this phone asked for is its own, never news to it.
    assert.equal(ok(await core.call<TxOutcome>("tx.request", pay(`6${NEAR}`))).status, "waiting");
    assert.deepEqual(ok(await core.call<Alerts>("alerts.poll")).alerts, [], "the phone's own change: no push");
    // One this phone didn't place (its record of its own wiped, as when another device asked): told.
    assert.equal(ok(await core.call<TxOutcome>("tx.request", pay(`8${NEAR}`))).status, "waiting");
    await (core as any).mineWrites;
    await (core as any).vault.delete("alerts-mine");
    const held = ok(await core.call<Alerts>("alerts.poll")).alerts;
    assert.deepEqual(held.map((a) => [a.kind, a.title]), [["held", "A payment or change is waiting on your account"]]);
    // Security audit 11 (4 Nov): the lock screen never carries the amount or the receiver.
    assert.match(held[0]!.body, /^It can go .+\. If it wasn't you, open ZeroFee and cancel it before then\.$/);
    assert.doesNotMatch(held[0]!.body, /NEAR|bob\.testnet/);
    assert.deepEqual(ok(await core.call<Alerts>("alerts.poll")).alerts, [], "told once");
    // S-1: a key someone else put on the account: told once, in words, never the key.
    chain.accounts.get(accountId)!.keys.set("ed25519:9fXq1nYb3Zr4oTpX7m2L8kVwQe5sRdUcJhGaBy6NtPzK", { nonce: 0n, permission: { kind: "full" } });
    const keyNews = ok(await core.call<Alerts>("alerts.poll")).alerts;
    // the audit (5 Nov): a full-access key on this account with rules bypasses the contract entirely: red, in those words.
    assert.deepEqual(keyNews.map((a) => [a.kind, a.title, a.body, (a as { red?: true }).red]), [["key", "A key can bypass your Safe's rules", "This key can bypass your Safe's rules. If it wasn't you, open ZeroFee now.", true]]);
    assert.deepEqual(ok(await core.call<Alerts>("alerts.poll")).alerts, [], "told once");
    // The same key read end to end on Security's side: the account says its rules are on, and the key is full access.
    const st = ok(await core.call<{ account: { rules?: boolean; keys: { handle: string; access?: string }[] } }>("account.state")).account;
    assert.equal(st.rules, true);
    assert.equal(st.keys.find((k) => k.handle === "ed25519:9fXq1nYb3Zr4oTpX7m2L8kVwQe5sRdUcJhGaBy6NtPzK")?.access, "full");
    // The backup words start a recovery (the test chain records it as the contract would).
    const policy = chain.accounts.get(accountId)!.policy!;
    policy.pending = { newKey: Buffer.from([2, ...new Uint8Array(1952).fill(0x11)]).toString("base64"), readyAtNs: BigInt(Date.now()) * 1_000_000n + policy.delayNs };
    const rec = ok(await core.call<Alerts>("alerts.poll")).alerts;
    assert.deepEqual(rec.map((a) => [a.kind, a.title]), [["recovery", "Someone started moving your account to a new device"]]);
    assert.match(rec[0]!.body, /^If it wasn't you, open ZeroFee and stop it before .+\.$/);
    // Seen in the open app: marked, never told later.
    assert.equal(ok(await core.call<TxOutcome>("tx.request", pay(`7${NEAR}`))).status, "waiting");
    assert.deepEqual(ok(await core.call<Alerts>("alerts.poll", { notify: false })).alerts, []);
    assert.deepEqual(ok(await core.call<Alerts>("alerts.poll")).alerts, []);
  } finally {
    core.close();
  }
});

test("email alerts: the relay is asked to email the link that turns them on, or the one that stops them; nothing else", async () => {
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => rulesWasm, privateQuotes: "https://relay.test/" });
  sheet(core);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const real = globalThis.fetch;
  const asked: { url: string; body: unknown }[] = [];
  let answer = new Response(JSON.stringify({ asked: true }));
  globalThis.fetch = (async (url: string, init: RequestInit) => (asked.push({ url, body: JSON.parse(String(init.body)) }), answer)) as typeof fetch;
  try {
    assert.deepEqual(ok(await core.call("account.alertsEmail", { email: " kim@example.com " })), { asked: true });
    assert.deepEqual(ok(await core.call("account.alertsEmailStop", { email: "kim@example.com" })), { asked: true });
    // Turning them on carries the account's own NEP-413 proof (audit NF-01), checked here with the relay's own code.
    const { proof, ...sub } = asked[0]!.body as { proof: { deadline: string; nonce: string; publicKey: string; signature: string } };
    // S-1: with the phone's own time zone, so the emails say times as the person reads them.
    assert.deepEqual([asked[0]!.url, sub], ["https://relay.test/v0/alerts/subscribe", { accountId, email: "kim@example.com", zone: Intl.DateTimeFormat().resolvedOptions().timeZone }]);
    assert.deepEqual(asked[1], { url: "https://relay.test/v0/alerts/remove-ask", body: { accountId, email: "kim@example.com" } }, "the stop link needs no proof");
    const relay = await import("../../../apps/quotes/alerts.mjs");
    const hash = relay.nep413Hash({ message: relay.alertsProofMessage(accountId, "kim@example.com", proof.deadline), nonce: Buffer.from(proof.nonce, "base64"), recipient: "relay.test" });
    assert.equal(relay.signatureOk(proof.publicKey, proof.signature, hash), true, "the relay accepts the core's proof");
    assert.ok(Date.parse(proof.deadline) > Date.now() && Date.parse(proof.deadline) <= Date.now() + relay.PROOF_MS);
    assert.match(proof.publicKey, /^ml-dsa-65:/);
    assert.equal(relay.signatureOk(proof.publicKey, proof.signature, relay.nep413Hash({ message: relay.alertsProofMessage(accountId, "eve@example.com", proof.deadline), nonce: Buffer.from(proof.nonce, "base64"), recipient: "relay.test" })), false, "for that email only");
    assert.equal(code(await core.call("account.alertsEmail", { email: "not an email" })), "security.request.invalid");
    answer = new Response(JSON.stringify({ code: "quotes.alerts.off" }), { status: 503 });
    assert.equal(code(await core.call("account.alertsEmail", { email: "kim@example.com" })), "security.request.not-allowed", "the relay hasn't got them set up");
    answer = new Response(JSON.stringify({ code: "quotes.alerts.full", whatHappened: "An account can email at most 3 addresses." }), { status: 400 });
    const full = await core.call("account.alertsEmail", { email: "kim@example.com" });
    assert.ok("problem" in full && full.problem.code === "security.request.invalid" && /at most 3/.test(String(full.problem.more ?? full.problem.whatHappened)));
  } finally {
    globalThis.fetch = real;
    core.close();
  }
});

test("held requests say whether they're a change to the account (the words can stop those) and carry any warning", async () => {
  const { chain, core, accountId } = await readyWithRules();
  try {
    assert.equal(ok(await core.call<TxOutcome>("tx.request", pay(`6${NEAR}`))).status, "waiting");
    const rules = chain.accounts.get(accountId)!.rules!;
    rules.waiting.push({ id: 99, change: { Upgrade: { code_hash: Buffer.alloc(32, 0xab).toString("base64") } }, readyAtNs: BigInt(Date.now() + 86_400_000) * 1_000_000n, needsDevice: false, approved: false });
    const list = ok(await core.call<{ id: string; title: string; change: boolean; warning?: string }[]>("account.waiting"));
    const payment = list.find((w) => w.id !== "99")!;
    const upgrade = list.find((w) => w.id === "99")!;
    assert.deepEqual([payment.change, payment.warning], [false, undefined]);
    assert.deepEqual([upgrade.title, upgrade.change], ["Unknown code. Cancel this", true]);
    assert.match(upgrade.warning!, /This isn't a ZeroFee version/);
  } finally {
    core.close();
  }
});

test("second devices: what each is, and a refill when its fee allowance is unlimited (added before release 5) or low", async () => {
  const { chain, core, shown, accountId } = await readyWithRules();
  try {
    assert.deepEqual(ok(await core.call("account.secondDevices")), []);
    // A laptop from before release 5: on chain with no cap on its fees.
    const laptop = SoftwareKey.generate();
    chain.accounts.get(accountId)!.keys.set(laptop.publicKey, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: [...ACCOUNT_POLICY.secondDeviceMethods], allowanceYocto: null } });
    chain.accounts.get(accountId)!.rules!.second.push(laptop.publicKey);
    (chain as any).remember(accountId, laptop.publicKey);
    const before = ok(await core.call<{ handle: string; kind: string; needsRefill: boolean }[]>("account.secondDevices"));
    assert.deepEqual(before.map((d) => [d.kind, d.needsRefill]), [["second device", true]]);
    const out = ok(await core.call<TxOutcome>("account.secondDevice.refill"));
    assert.equal(out.status, "done");
    assert.equal(shown.at(-1)!.title, "Refill your second device's network fees");
    assert.match(shown.at(-1)!.lines[0], /^It can again spend up to 1 NEAR from your Safe on network fees/);
    assert.deepEqual(ok(await core.call<{ needsRefill: boolean }[]>("account.secondDevices")).map((d) => d.needsRefill), [false], "capped at 1 NEAR now");
    assert.equal(code(await core.call("account.secondDevice.refill")), "security.request.invalid", "nothing to refill");
  } finally {
    core.close();
  }
});

test("release 6 to 7: a second device with only approve and decline is listed, marked to add again, and the re-add gives it the recovery methods", async () => {
  const { chain, core, shown, accountId } = await readyWithRules();
  try {
    // A laptop added under release 6: NEAR lets it call approve and decline only, so it can't answer a move to a new device.
    const laptop = SoftwareKey.generate();
    chain.accounts.get(accountId)!.keys.set(laptop.publicKey, { nonce: 0n, permission: { kind: "function-call", receiverId: accountId, methods: ["approve", "decline"], allowanceYocto: 10n ** 24n } });
    chain.accounts.get(accountId)!.rules!.second.push(laptop.publicKey);
    (chain as any).remember(accountId, laptop.publicKey);
    const before = ok(await core.call<{ kind: string; needsRefill: boolean; needsReAdd?: true }[]>("account.secondDevices"));
    assert.deepEqual(before.map((d) => [d.kind, d.needsRefill, d.needsReAdd]), [["second device", false, true]]);
    // It is the laptop on the account's key list, never "another phone".
    const state = ok(await core.call<{ account: AccountInfo }>("account.state"));
    assert.equal(state.account.keys.find((k) => k.handle === handleOf(laptop.publicKey))?.role, "second-device");
    const out = ok(await core.call<TxOutcome>("account.secondDevice.refill"));
    assert.equal(out.status, "done");
    assert.equal(shown.at(-1)!.title, "Re-add your second device");
    assert.equal(shown.at(-1)!.lines[0], "Then it can also say yes or no to a move to a new device. Nothing else changes.");
    const key = chain.accounts.get(accountId)!.keys.get(laptop.publicKey)!;
    assert.deepEqual(key.permission.kind === "function-call" ? key.permission.methods : [], [...ACCOUNT_POLICY.secondDeviceMethods]);
    assert.deepEqual(ok(await core.call<{ needsReAdd?: true }[]>("account.secondDevices")).map((d) => d.needsReAdd), [undefined]);
    assert.equal(code(await core.call("account.secondDevice.refill")), "security.request.invalid", "nothing left to add again");
  } finally {
    core.close();
  }
});

test("small payments go at once; bigger ones wait, can be cancelled, and go after the wait", async () => {
  const { chain, core, shown } = await readyWithRules();
  try {
    assert.equal(ok(await core.call<TxOutcome>("tx.request", pay(`1${NEAR}`))).status, "done");
    assert.equal(shown.at(-1)!.protection?.level, "faceid");

    const held = ok(await core.call<TxOutcome>("tx.request", pay(`6${NEAR}`)));
    assert.equal(held.status, "waiting");
    assert.equal(shown.at(-1)!.protection?.text, "It waits 2 minutes. You, or your backup words, can stop it.");
    const list = ok(await core.call<{ id: string; title: string; ready: boolean }[]>("account.waiting"));
    assert.deepEqual(list.map((w) => [w.title, w.ready]), [["Send 6 NEAR to bob.testnet", false]]);
    const ends: unknown[] = [];
    core.on("account.waiting.ended", (e) => ends.push(e));
    assert.equal(ok(await core.call<{ state: string }>("account.waiting.status", { id: list[0].id })).state, "waiting");
    await core.call("account.waiting.cancel", { id: list[0].id });
    assert.deepEqual(ok(await core.call("account.waiting")), []);
    assert.equal((ends[0] as { ended: string }).ended, "cancelled");
    assert.equal(ok(await core.call<{ state: string }>("account.waiting.status", { id: list[0].id })).state, "cancelled");

    const again = ok(await core.call<TxOutcome & { id: string }>("tx.request", pay(`6${NEAR}`)));
    assert.equal(code(await core.call("account.waiting.run", { id: again.id })), "security.waiting.not-yet");
    advance(121);
    assert.equal(ok(await core.call<{ ready: boolean }[]>("account.waiting"))[0].ready, true);
    assert.equal(ok(await core.call<TxOutcome>("account.waiting.run", { id: again.id })).status, "done");
    assert.equal(chain.accounts.get("bob.testnet")!.balance, 7n * 10n ** 24n);
  } finally {
    restoreClock();
    core.close();
  }
});

test("changing the protection waits behind the current strictest level, then applies", async () => {
  const { core, shown } = await readyWithRules();
  try {
    const out = ok(await core.call<TxOutcome & { id: string }>("account.protection.set", { bands: [{ upToUsd: 20, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 3600 }] }));
    assert.equal(out.status, "waiting");
    assert.deepEqual(shown.at(-1)!.lines.slice(0, 2), ["Payments up to 5 NEAR go as soon as you approve.", "Bigger ones wait 1 hour. You can cancel them."]);
    advance(121);
    ok(await core.call("account.waiting.run", { id: out.id }));
    const { bands } = ok(await core.call<{ bands: any[] }>("account.protection.get"));
    assert.deepEqual(bands.at(-1).level, { Wait: { seconds: "3600" } });
  } finally {
    restoreClock();
    core.close();
  }
});

test("above the band that needs it, the second device must say yes; the phone alone can't", async () => {
  const { chain, core, accountId } = await readyWithRules();
  try {
    const laptop = SoftwareKey.generate();
    const paired = ok(await core.call<TxOutcome & { id: string }>("account.secondDevice.pair", { publicKey: laptop.publicKey }));
    advance(121);
    ok(await core.call("account.waiting.run", { id: paired.id }));
    const changed = ok(await core.call<TxOutcome & { id: string }>("account.protection.set", { bands: [{ upToUsd: 20, level: "faceid" }, { upToUsd: null, level: "device" }] }));
    advance(250);
    ok(await core.call("account.waiting.run", { id: changed.id }));

    const big = ok(await core.call<TxOutcome & { id: string; needsSecondDevice: boolean }>("tx.request", pay(`6${NEAR}`)));
    assert.equal(big.status, "waiting");
    assert.equal(big.needsSecondDevice, true);
    assert.equal(code(await core.call("account.waiting.run", { id: big.id })), "security.waiting.needs-device");

    const second = new DevSigner({ accountId, chain, key: laptop, approve: async () => true });
    const yes = await second.run(accountId, [{ kind: "call", method: "approve", args: new TextEncoder().encode(JSON.stringify({ id: big.id })), gas: 300_000_000_000_000n, depositYocto: 0n }]);
    assert.equal(yes.status, "done");
    assert.equal(chain.accounts.get("bob.testnet")!.balance, 6n * 10n ** 24n);
  } finally {
    restoreClock();
    core.close();
  }
});

// ── Agent (the account contract v3) ──

const at = (y: number, m: number, d: number) => String(BigInt(Date.UTC(y, m, d, 12)) * 1_000_000n);

test("Agent: its budget is approved once on the sheet; its own payments, orders and converts don't run by themselves while its own wallet is off (sandbox order, M13)", async () => {
  const { chain, core, shown, accountId } = await readyWithRules({ modules: true, over: { agentWallet: { on: false } } /* the sandbox order's own path: explicitly off */ });
  try {
    const budget = { coins: [{ coin: "near", per_day: `1${NEAR}`, per_month: `10${NEAR}`, convert_per_day: "0" }], recipients: ["bob.testnet"], ends_at_ns: at(2027, 0, 15), max_spends_per_day: 5 };
    const orders = [{ payout: "Near", to: "landlord.testnet", amount: `2${NEAR}`, dates_ns: [at(2026, 10, 1), at(2026, 11, 1), at(2027, 0, 1)], grace_seconds: "86400" }];
    const out = ok(await core.call<TxOutcome & { id: string }>("account.agent.set", { budget, orders }));
    assert.equal(out.status, "waiting");
    const words = shown.at(-1)!;
    assert.equal(words.title, "Let AgentZero spend for you");
    assert.deepEqual(words.lines.slice(0, 8), [
      "2 NEAR to landlord.testnet on the 1st of each month",
      "3 payments: the first on 1 Nov 2026, the last on 1 Jan 2027",
      "If a payment misses its date, it can still go up to 1 day later.",
      "On its own: up to 1 NEAR in 24 hours and 10 NEAR a month",
      "Only to bob.testnet",
      "At most 5 payments in 24 hours, until 15 Jan 2027",
      "AgentZero's key can't do anything else. It can spend at most 0.5 NEAR on network fees.",
      "It waits 2 minutes. You, or your backup words, can stop it.",
    ]);
    assert.equal(code(await core.call("account.agent.spend", { kind: "pay", payout: "Near", to: "bob.testnet", amount: `5${NEAR.slice(1)}` })), "security.request.not-allowed");
    advance(121);
    ok(await core.call("account.waiting.run", { id: out.id }));
    const keys = [...chain.accounts.get(accountId)!.keys.values()].map((k) => (k.permission.kind === "function-call" ? k.permission.methods.join() : "full"));
    assert.ok(keys.includes(ACCOUNT_POLICY.agentMethods.join()));
    const view = ok(await core.call<any>("account.agent.view"));
    assert.deepEqual([view.keyOnThisPhone, view.renewSuggested, view.orders.length], [true, false, 1]);

    // The product sandbox order (audit M13): AgentZero's own payments (agent_pay), standing orders and converts don't
    // run by themselves while its own wallet is off: refused by name, nothing signed, no sheet. Still only the agent app
    // reaches the door at all.
    const half = `5${NEAR.slice(1)}`;
    assert.equal(code(await forApps(core, "wallet").call("account.agent.spend", { kind: "pay", payout: "Near", to: "bob.testnet", amount: half })), "security.bridge.not-allowed");
    assert.equal(code(await forApps(core, "chat").call("account.agent.spend", { kind: "pay-private", to: "bob.testnet", amount: "5000000" })), "security.bridge.not-allowed");
    const agentApp = forApps(core, "agent");
    const sheets = shown.length;
    chain.fund("landlord.testnet", SoftwareKey.generate().publicKey, 0n);
    Date.now = () => Date.UTC(2026, 10, 1, 13); // the standing order's own date
    const bob = chain.accounts.get("bob.testnet")!.balance;
    for (const p of [{ kind: "pay", payout: "Near", to: "bob.testnet", amount: half }, { kind: "pay-private", to: "bob.testnet", amount: "5000000" }, { kind: "order", id: "1" }, { kind: "convert", fromToken: "nep141:wrap.near", toToken: "nep141:usdt.tether-token.near", amount: "1" }]) {
      const r = await agentApp.call<TxOutcome>("account.agent.spend", p);
      assert.equal(code(r), "security.request.not-allowed", p.kind);
      assert.equal("problem" in r ? r.problem.more : "", "AgentZero's own wallet isn't on yet, so it can't do this by itself. Nothing moved.", p.kind);
    }
    assert.equal(chain.accounts.get("bob.testnet")!.balance, bob, "nothing paid");
    assert.equal(chain.accounts.get("landlord.testnet")!.balance, 0n, "the order didn't run");
    assert.equal(shown.length, sheets, "no sheet");
    restoreClock();

    ok(await core.call("account.agent.pause"));
    assert.equal(shown.at(-1)!.title, "Pause AgentZero");
    ok(await core.call("account.agent.removeOrder", { id: "1" }));
    assert.equal(shown.at(-1)!.title, "Stop paying landlord.testnet 2 NEAR");
    assert.equal(ok(await core.call<TxOutcome>("account.agent.revoke")).status, "done");
    assert.ok(![...chain.accounts.get(accountId)!.keys.values()].some((k) => k.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.agentMethods.join()));
    assert.equal(code(await agentApp.call("account.agent.spend", { kind: "pay", payout: "Near", to: "bob.testnet", amount: "1" })), "security.request.not-allowed");
  } finally {
    restoreClock();
    core.close();
  }
});

test("an heir's sheet reads the legacy from the owner's account; a look-alike contract gets no such words", async () => {
  const { chain, core, accountId } = await readyWithRules();
  try {
    chain.fund("mum.testnet", SoftwareKey.generate().publicKey);
    chain.withRules("mum.testnet", [{ up_to: null, level: "FaceId" }]);
    chain.withModules("mum.testnet");
    chain.accounts.get("mum.testnet")!.rules!.legacy = {
      config: { heirs: [{ account_id: accountId, share_pct: 70 }, { account_id: "leo.testnet", share_pct: 30 }], quiet_seconds: "60", claim_delay_seconds: String(7 * 86400), tokens: [] },
      lastSeenNs: 0n,
      claim: null,
      lastStopped: null,
    };
    const ask = (receiverId: string, method: string) => core.call<PlainWords>("tx.describe", { request: { receiverId, actions: [{ kind: "call", method, args: method === "legacy_distribute" ? { balances: [] } : {}, depositYocto: "0", gas: "30000000000000" }], why: "", from: "legacy" } });
    const claim = ok(await ask("mum.testnet", "legacy_start_claim"));
    assert.equal(claim.title, "Ask for what mum.testnet left you");
    assert.equal(claim.lines[0], "mum.testnet can stop it by using their account.");
    assert.match(claim.lines[1], /^If no one stops it, it can be paid out from \d{1,2} \w{3} \d{4}\.$/);
    assert.deepEqual(claim.warnings, []);
    const payOut = ok(await ask("mum.testnet", "legacy_distribute"));
    assert.deepEqual([payOut.title, payOut.lines[1]], ["Pay out mum.testnet's legacy", "Your share: 70%."]);

    chain.fund("fake-mum.testnet", SoftwareKey.generate().publicKey);
    const fake = ok(await ask("fake-mum.testnet", "legacy_start_claim"));
    assert.equal(fake.title, "Use fake-mum.testnet");
    assert.ok(fake.warnings.some((w) => w.kind === "unknown-contract"));
  } finally {
    core.close();
  }
});

test("a held chain reads in the same words as its sheet; an upgrade says whether ZeroFee knows the release", async () => {
  const { chain, core, shown } = await readyWithRules();
  try {
    chain.fund("carol.testnet", SoftwareKey.generate().publicKey, 0n);
    const held = ok(await core.call<TxOutcome>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: `4${NEAR}` }], then: [{ receiverId: "carol.testnet", actions: [{ kind: "transfer", yocto: `3${NEAR}` }] }], why: "", from: "wallet" } }));
    assert.equal(held.status, "waiting");
    const [w] = ok(await core.call<{ title: string; lines: string[] }[]>("account.waiting"));
    assert.equal(w.title, shown.at(-1)!.title);
    assert.equal(w.title, "Send 4 NEAR to bob.testnet, then Send 3 NEAR to carol.testnet");

    const known = ownAccountCall("upgrade", { code_hash: Buffer.from(ACCOUNT_POLICY.sha256Hex, "hex").toString("base64") })!;
    assert.equal(known.title, "Update your account's rules");
    const unknown = ownAccountCall("upgrade", { code_hash: Buffer.alloc(32, 7).toString("base64") })!;
    assert.equal(unknown.title, "Unknown code. Cancel this");
    assert.match(unknown.lines[0]!, /^Unknown code, not ZeroFee's\.$/);
    assert.match(unknown.details?.[0]?.lines[0] ?? "", /^Fingerprint: [0-9a-f]{64}$/, "the fingerprint is one tap down");
    assert.equal(unknown.warnings?.[0]?.kind, "unknown-contract");
  } finally {
    core.close();
  }
});

test("Agent's swap goes only into a live 1Click quote that pays the account's own balance", async () => {
  const { convertQuoteRefusal } = await import("./agent-convert.ts");
  const q = { status: "PENDING_DEPOSIT", originAsset: "nep141:usdc.near", amountIn: "100", refundTo: "me.near", refundType: "INTENTS", destinationAsset: "nep141:wrap.near", minAmountOut: "1", recipient: "me.near", recipientType: "INTENTS", deadline: "2099-01-01T00:00:00Z" };
  const now = Date.UTC(2026, 9, 25);
  assert.equal(convertQuoteRefusal(q, "me.near", "nep141:usdc.near", "100", now), null);
  assert.match(convertQuoteRefusal({ ...q, recipient: "attacker.near" }, "me.near", "nep141:usdc.near", "100", now)!, /own Safe/);
  assert.match(convertQuoteRefusal({ ...q, recipientType: "DESTINATION_CHAIN" }, "me.near", "nep141:usdc.near", "100", now)!, /own Safe/);
  assert.match(convertQuoteRefusal({ ...q, refundTo: "attacker.near" }, "me.near", "nep141:usdc.near", "100", now)!, /refund/);
  assert.match(convertQuoteRefusal({ ...q, amountIn: "99" }, "me.near", "nep141:usdc.near", "100", now)!, /terms/);
  assert.match(convertQuoteRefusal(q, "me.near", "nep141:usdc.near", "100", Date.UTC(2100, 0, 1))!, /run out/);
  assert.match(convertQuoteRefusal(null, "me.near", "nep141:usdc.near", "100", now)!, /doesn't know that payment address/);
});

test("the core makes Agent's swap quote itself, into the account's own balance, and checks it before Agent signs", async () => {
  const { agentConvertPlan, agentConvertPrice } = await import("./agent-convert.ts");
  const { signedQuote, TEST_QUOTE_KEY } = await import("./quote-test-key.ts");
  const now = Date.UTC(2026, 9, 25);
  const asked: Record<string, unknown>[] = [];
  // 1Click's answer, signed as 1Click signs (audit T-1: the core believes a quote only that way).
  const answer = (over: Record<string, unknown> = {}, quote: Record<string, unknown> = {}, sign = true) => async (req: Record<string, unknown>) => {
    asked.push(req);
    const r = { quoteRequest: { ...req, ...over }, quote: { depositAddress: "abc123", amountIn: req.amount, amountOut: "120", minAmountOut: "118", deadline: new Date(now + 10 * 60_000).toISOString(), ...quote } };
    return sign ? signedQuote(r, new Date(now).toISOString()) : r;
  };
  const plan = await agentConvertPlan(answer(), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", "110", now, TEST_QUOTE_KEY);
  assert.deepEqual(plan, { payout: { Ledger: { token_id: "nep141:usdc.near" } }, to: "abc123", amount: "100" });
  assert.deepEqual([asked[0].recipient, asked[0].recipientType, asked[0].refundTo, asked[0].refundType, asked[0].dry], ["me.near", "INTENTS", "me.near", "INTENTS", false]);
  // 1Click answering with someone else as recipient, a lower floor than asked, or another coin: refused.
  await assert.rejects(agentConvertPlan(answer({ recipient: "attacker.near" }), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", undefined, now, TEST_QUOTE_KEY), (e: any) => /own Safe/.test(JSON.stringify(e.problem)));
  await assert.rejects(agentConvertPlan(answer({}, { minAmountOut: "100" }), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", "110", now, TEST_QUOTE_KEY), (e: any) => /least you'd accept/.test(JSON.stringify(e.problem)));
  await assert.rejects(agentConvertPlan(answer({ destinationAsset: "nep141:evil.near" }), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", undefined, now, TEST_QUOTE_KEY), (e: any) => /terms/.test(JSON.stringify(e.problem)));
  await assert.rejects(agentConvertPlan(answer({}, { depositAddress: undefined }), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", undefined, now, TEST_QUOTE_KEY), (e: any) => /no payment address/.test(JSON.stringify(e.problem)));
  // T-1: an unsigned answer, or one signed by any other key, or a dry one: refused before anything is planned.
  await assert.rejects(agentConvertPlan(answer({}, {}, false), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", undefined, now, TEST_QUOTE_KEY), (e: any) => /didn't confirm this price/.test(JSON.stringify(e.problem)));
  await assert.rejects(agentConvertPlan(answer(), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", undefined, now), (e: any) => /didn't confirm this price/.test(JSON.stringify(e.problem)));
  await assert.rejects(agentConvertPlan(answer({ dry: true }), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", undefined, now, TEST_QUOTE_KEY), (e: any) => /didn't confirm this price/.test(JSON.stringify(e.problem)));
  // The price only: a dry quote, nothing that could be paid.
  assert.deepEqual(await agentConvertPrice(answer(), "me.near", "nep141:usdc.near", "nep141:wrap.near", "100", now), { amountOut: "120", minAmountOut: "118" });
  assert.equal(asked.at(-1)!.dry, true);
});

/** Words first (J2, O-2c): the words shown and checked, as set-up's screens do before the account opens. */
async function wordsChecked(core: DemoCore): Promise<void> {
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
}

test("mainnet: an account the person funds themselves, from the setup address to backed up, resumable at each step", async () => {
  const chain = new FakeChain("mainnet");
  chain.fund("near", SoftwareKey.generate().publicKey, 0n);
  const vault = new MemoryVault();
  const make = () => new DemoCore({ chain, vault, policyWasm: async () => mainnetWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, settleMs: 1 });
  let core = make();
  sheet(core);
  const funding = ok(await core.call<{ stage: string; accountId: string; fundAddress: string; needYocto: string; haveYocto: string }>("account.create"));
  assert.equal(funding.stage, "needs-funding");
  assert.match(funding.accountId, /^zf-[0-9a-f]{10}\.near$/);
  assert.match(funding.fundAddress, /^[0-9a-f]{64}$/);
  assert.ok(BigInt(funding.needYocto) > BigInt(rulesWasm.length) * 10n ** 19n, "the contract's storage, and a margin");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "needs-funding");

  // Not enough yet: the same answer, with what has arrived. (Asking again, from a reopened app, is the same.)
  chain.fund(funding.fundAddress, `ed25519:${toBase58(Buffer.from(funding.fundAddress, "hex"))}`, 1n);
  core.close();
  core = make();
  sheet(core);
  const short = ok(await core.call<{ stage: string; haveYocto: string; fundAddress: string }>("account.create"));
  assert.deepEqual([short.stage, short.haveYocto, short.fundAddress], ["needs-funding", String(10n ** 24n), funding.fundAddress]);

  // Funded: the account is created, its rules installed, and the post-quantum device key is left on it, with the
  // backup words' recovery key (its two methods only), which went in with the account.
  chain.accounts.get(funding.fundAddress)!.balance = BigInt(funding.needYocto);
  // O-2c: funded, but the words aren't checked: nothing opens, the NEAR waits at the setup address.
  const waits = ok(await core.call<{ stage: string; wordsDue?: boolean }>("account.create"));
  assert.deepEqual([waits.stage, waits.wordsDue], ["needs-funding", true]);
  assert.equal(chain.accounts.has(funding.accountId), false, "no account before the words");
  assert.equal(chain.accounts.get(funding.fundAddress)!.balance, BigInt(funding.needYocto), "the NEAR waits where it was sent");
  await wordsChecked(core);
  const account = ok(await core.call<{ accountId: string }>("account.create"));
  assert.equal(account.accountId, funding.accountId);
  const onChain = chain.accounts.get(funding.accountId)!;
  assert.equal(onChain.codeHash, ACCOUNT_POLICY.codeHashBase58);
  assert.deepEqual([...onChain.keys.values()].map((k) => (k.permission.kind === "full" ? "full" : k.permission.methods.join())).sort(), [ACCOUNT_POLICY.deviceMethods.join(), ACCOUNT_POLICY.recoveryKeyMethods.join()].sort());
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready", "the words were checked first: no second words step");
  assert.equal(code(await core.call("account.create")), "security.account.exists");
  // Finding 10: the opening's row adds up to the Safe: what came in, less what opening it keeps, is what the Safe can use.
  (core as any).sheetNearUsd = async () => 4; // the row's dollars at a fixed price (no 1Click in a unit test)
  const { opened } = ok(await core.call<{ opened: { amount: string; keptAmount?: string } | null }>("subwallet.received", {}));
  assert.equal(opened?.amount, funding.needYocto, "the NEAR that opened it");
  assert.ok(opened?.keptAmount && BigInt(opened.keptAmount) > 0n, "what opening it keeps is said");
  assert.equal(BigInt(opened!.amount) - BigInt(opened!.keptAmount!), availableYocto(await chain.account(funding.accountId, await chain.commonBlock())), "received less kept is the Safe");
  // 48 hours (release 7), not a minute, before a new device could take over on mainnet.
  assert.equal(ok(await core.call<{ delaySeconds: number }>("recovery.status")).delaySeconds, 2 * 86_400);
  core.close();
});

test("mainnet set-up strands nothing: the setup address deletes itself into the new account, which gets every yocto but the fees; a failed deletion is resumed", async () => {
  const chain = new FakeChain("mainnet");
  chain.fund("near", SoftwareKey.generate().publicKey, 0n);
  const vault = new MemoryVault();
  const make = () => new DemoCore({ chain, vault, policyWasm: async () => mainnetWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, settleMs: 1 });
  let core = make();
  sheet(core);
  const funding = ok(await core.call<{ accountId: string; fundAddress: string; needYocto: string }>("account.create"));
  await wordsChecked(core); // words first (O-2c): the opening waits for them
  const sent = BigInt(funding.needYocto) + 7n * 10n ** 23n; // the person sends a little more than asked
  chain.fund(funding.fundAddress, `ed25519:${toBase58(Buffer.from(funding.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(funding.fundAddress)!.balance = sent;

  // The first deletion doesn't go (a node down): the named account exists, the setup key and the stage are kept.
  const send = chain.send.bind(chain);
  let down = true;
  chain.send = async (signed, hash, signer) => {
    if (down && signer === funding.fundAddress && chain.accounts.has(funding.accountId)) {
      down = false;
      throw new Error("node down");
    }
    return send(signed, hash, signer);
  };
  assert.equal(code(await core.call("account.create")), "security.account.create-failed");
  assert.ok(chain.accounts.has(funding.fundAddress) && chain.accounts.has(funding.accountId), "both there: nothing lost, nothing stranded yet");
  assert.ok(await vault.get("setup-key"), "the setup key is kept until the address is empty");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "needs-funding", "the app shows the set-up screen again, to carry on");

  // Again (a reopened app): the address deletes itself into the account, then the set-up runs.
  core.close();
  core = make();
  sheet(core);
  ok(await core.call<{ accountId: string }>("account.create"));
  assert.equal(chain.accounts.has(funding.fundAddress), false, "the setup address is gone: nothing is left there");
  const deletion = chain.history.find((t) => t.signerId === funding.fundAddress && t.actions.some((a) => a.kind === "delete-account"));
  assert.ok(deletion?.ok && deletion.receiverId === funding.fundAddress);
  assert.deepEqual(deletion.actions, [{ kind: "delete-account", beneficiaryId: funding.accountId }], "into the new account, never anywhere else");
  const fees = BigInt(chain.history.filter((t) => t.signerId === funding.fundAddress || t.signerId === funding.accountId).length) * 10n ** 18n;
  assert.equal(chain.accounts.get(funding.accountId)!.balance, sent - fees, "the new account holds everything sent, less only the network fees");
  assert.equal(await vault.get("setup-key"), null, "the setup key is forgotten only after");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready", "words checked first: ready");
  core.close();
});

test("the card wallet's key is shown only from Settings (the shell), never through an app (D34)", async () => {
  const { core } = await readyAccount();
  try {
    const card = ok(await forApps(core, "pay").call<{ id: string }>("subwallet.create", { kind: "pay", chain: "gnosis" }));
    assert.equal(code(await forApps(core, "pay").call("subwallet.export", { id: card.id })), "security.request.not-allowed");
    assert.ok("secretKey" in ok(await core.call<{ secretKey: string }>("subwallet.export", { id: card.id })), "the shell's own call: after the sheet");
  } finally {
    core.close();
  }
});

test("Wallet reaches only the private pocket among the separate wallets", async () => {
  const { core } = await readyAccount();
  try {
    const wallet = forApps(core, "wallet");
    const pocket = ok(await wallet.call<{ kind: string; chain: string }>("subwallet.create", { kind: "private", chain: "near" }));
    assert.deepEqual([pocket.kind, pocket.chain], ["private", "near"]);
    assert.equal(code(await wallet.call("subwallet.create", { kind: "trade", chain: "sol" })), "security.request.not-allowed");
    ok(await forApps(core, "trade").call("subwallet.create", { kind: "trade", chain: "sol" }));
    assert.deepEqual(ok(await wallet.call<{ kind: string }[]>("subwallet.list")).map((x) => x.kind), ["private"]);
    assert.equal(code(await wallet.call("subwallet.create", { chain: "sol" })), "security.request.not-allowed", "nor a chain's wallet");
  } finally {
    core.close();
  }
});

test("one wallet per chain (D55): Trade, Browser and Apps share each chain's wallet; Spending's balance is Trade's; the Extension, Pay and Wallet keep their own", async () => {
  const { core } = await readyAccount();
  try {
    const trade = forApps(core, "trade"), browser = forApps(core, "browser"), social = forApps(core, "social");
    const float = ok(await trade.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "near" }));
    const sol = ok(await browser.call<{ id: string; kind: string; current?: boolean }>("subwallet.create", { chain: "sol" }));
    assert.deepEqual([sol.kind, sol.current], ["trade", true]);
    assert.equal(ok(await trade.call<{ id: string }>("subwallet.create", { chain: "sol" })).id, sol.id, "the same wallet, whichever app asks");
    assert.equal(ok(await social.call<{ id: string }>("subwallet.create", { chain: "sol" })).id, sol.id);
    for (const app of [browser, social]) {
      const listed = ok(await app.call<{ id: string }[]>("subwallet.list")).map((x) => x.id);
      assert.ok(listed.includes(sol.id) && !listed.includes(float.id), "the chain wallets, never Trading's balance");
      assert.equal(code(await app.call("subwallet.float.out", { chain: "sol", amount: "100000000", key: "trade-job-00000003" })), "security.request.not-allowed");
      assert.equal(code(await app.call("subwallet.create", { kind: "extension", chain: "sol" })), "security.request.not-allowed");
    }
    for (const app of ["extension", "pay"] as const) {
      assert.equal(code(await forApps(core, app).call("subwallet.create", { chain: "sol" })), "security.request.not-allowed", app);
      assert.equal(code(await forApps(core, app).call("subwallet.balances", { id: sol.id })), "security.request.not-allowed", app);
    }
  } finally {
    core.close();
  }
});

test("security review 2 Nov (Low): Browser, Apps and Chat can neither make Spending's NEAR balance nor learn its address; Trade and the shell can", async () => {
  const { core } = await readyAccount();
  try {
    for (const app of ["browser", "social", "chat"] as const) {
      const r = await forApps(core, app).call<{ address?: string }>("subwallet.create", { kind: "trade", chain: "near" });
      // Chat doesn't reach subwallet.create at all: the bridge refuses it before the core
      assert.equal(code(r), app === "chat" ? "security.bridge.not-allowed" : "security.request.not-allowed", app);
      assert.ok(!("ok" in r), `${app}: no address back`);
    }
    assert.equal(ok(await core.call<{ id: string }[]>("subwallet.list")).filter((w) => (w as { chain?: string }).chain === "near").length, 0, "nothing was made");
    const float = ok(await forApps(core, "trade").call<{ id: string; address: string }>("subwallet.create", { kind: "trade", chain: "near" }));
    assert.equal(ok(await core.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "near" })).id, float.id, "the shell: the same one");
    for (const app of ["browser", "social"] as const) assert.equal(code(await forApps(core, app).call("subwallet.create", { kind: "trade", chain: "near" })), "security.request.not-allowed", `${app}, once it exists`);
    // and the core's own rule, whatever the bridge lets through
    assert.equal(code(await core.call("subwallet.create", { kind: "trade", chain: "near", app: "chat" })), "security.request.not-allowed", "chat, at the core");
  } finally {
    core.close();
  }
});

test("subwallet.send is shut for everyone, Wallet too (the HARD RULE: every money move through NEAR Confidential; no screen sends it); Chat reaches nothing else of subwallet.*", async () => {
  const { core } = await readyAccount();
  const shown = sheet(core);
  try {
    const ask = { chain: "sol", to: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", amount: "0.1" };
    // the door is shut even for Wallet, with every shape of ask
    for (const other of [ask, { ...ask, chain: "eth", to: "0x7d06e272b5305a4b9d40e872c7950d3437547e3d" }, { ...ask, token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }]) {
      assert.equal(code(await forApps(core, "wallet").call("subwallet.send", other)), "security.request.not-allowed", "Wallet's own call");
    }
    // D143: a hot key's send has no sheet, so Chat (it pays from the private balance) is refused like every other app
    for (const app of ["chat", "pay", "trade", "extension", "browser", "social", "agent", "earn"] as const) {
      assert.ok(["security.request.not-allowed", "security.bridge.not-allowed"].includes(code(await forApps(core, app).call("subwallet.send", ask)) as string), app);
    }
    assert.equal(code(await core.call("subwallet.send", ask)), "security.request.not-allowed", "the shell itself");
    assert.equal(code(await core.call("subwallet.send", { ...ask, app: "chat" })), "security.request.not-allowed", "Chat, at the core, whatever the bridge lets through");
    assert.equal(shown.length, 0, "no sheet for any of them");
    for (const m of ["subwallet.list", "subwallet.create", "subwallet.signTx", "subwallet.sign", "subwallet.export"]) {
      assert.equal(code(await forApps(core, "chat").call(m, {})), "security.bridge.not-allowed", m);
    }
  } finally {
    core.close();
  }
});

test("the Trade session: Trade starts it in dollars and ends it; no other app can", async () => {
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { nativeUsd: async (c) => (c === "sol" ? 150 : null) });
  const shown = sheet(core);
  try {
    ok(await core.call("account.create"));
    const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
    ok(await core.call("recovery.confirm", { positions: [1, 12, 24], words: [words[0], words[11], words[23]] }));
    const trade = forApps(core, "trade");
    const before = shown.length;
    const started = ok(await trade.call<{ endsAtIso: string }>("subwallet.session.start", { perTxUsd: 100, totalUsd: 500, minutes: 30, why: "Trade fast" }));
    assert.ok(Date.parse(started.endsAtIso) > Date.now());
    assert.equal(shown.length, before, "D143: it starts with no sheet");
    for (const app of ["wallet", "pay", "browser", "social", "extension"] as const) {
      assert.equal(code(await forApps(core, app).call("subwallet.session.start", { perTxUsd: 10, totalUsd: 10, minutes: 5 })), "security.request.not-allowed", app);
    }
    assert.equal(code(await trade.call("subwallet.session.start", { perTxUsd: 150, totalUsd: 500, minutes: 30 })), "security.request.not-allowed");
    assert.deepEqual(ok(await trade.call("subwallet.session.end", { id: "trade" })), { ok: true });
    assert.equal(code(await forApps(core, "wallet").call("subwallet.session.end", { id: "trade" })), "security.request.not-allowed");
  } finally {
    core.close();
  }
});

test("Trade's float: Trade makes it and reads its fee guard; no other app reaches either", async () => {
  const { core } = await readyAccount();
  try {
    const trade = forApps(core, "trade");
    const float = ok(await trade.call<{ kind: string; chain: string; label: string }>("subwallet.create", { kind: "trade", chain: "near" }));
    assert.deepEqual([float.kind, float.chain, float.label], ["trade", "near", "Your NEAR wallet's cash"]);
    assert.deepEqual(ok(await trade.call("subwallet.float.limits")), { movesLeftToday: 20, perDay: 20, minUsd: 2, open: ["sol", "hood"] }, "BNB opens after its own test");
    assert.deepEqual(ok(await core.call("subwallet.float.limits")), { movesLeftToday: 20, perDay: 20, minUsd: 2, open: ["sol", "hood"] }, "ZeroFee's own screens");
    for (const app of ["wallet", "pay", "browser", "social", "extension"] as const) {
      assert.equal(code(await forApps(core, app).call("subwallet.float.limits")), "security.request.not-allowed", app);
    }
    assert.ok(!ok(await forApps(core, "wallet").call<{ id: string }[]>("subwallet.list")).some((x) => x.id === (float as { id?: string }).id), "Wallet doesn't list it");
    // Its moves: Trade's only; without the quote server set up, refused before anything is asked.
    ok(await trade.call("subwallet.create", { kind: "trade", chain: "sol" }));
    assert.equal(code(await trade.call("subwallet.float.out", { chain: "sol", slot: 0, amount: "100000000", key: "trade-job-00000001" })), "security.subwallet.refused");
    assert.equal(code(await forApps(core, "wallet").call("subwallet.float.out", { chain: "sol", slot: 0, amount: "100000000", key: "trade-job-00000001" })), "security.request.not-allowed");
    assert.equal(code(await forApps(core, "pay").call("subwallet.float.home", { amount: "1000000", key: "trade-job-00000002" })), "security.request.not-allowed");
    assert.deepEqual(ok(await trade.call("subwallet.float.moves")), []);
    assert.equal(code(await trade.call("subwallet.float.move", { id: "fm-none" })), "security.float.unknown-move");
    assert.deepEqual(ok(await trade.call<{ tokens: unknown[]; usd: number }>("subwallet.float.balance")).tokens, []);
    // home/add2: Wallet reads it (only reads), so Home lists the SOL or ETH it holds by name; control: another app can't
    assert.deepEqual(ok(await forApps(core, "wallet").call<{ tokens: unknown[] }>("subwallet.float.balance")).tokens, []);
    assert.equal(code(await forApps(core, "pay").call("subwallet.float.balance")), "security.request.not-allowed");
    // The Add's quote: Trade's, or Wallet's on its behalf (ledger.toTrading); no other app's.
    for (const app of ["trade", "wallet"] as const) assert.equal(code(await forApps(core, app).call("subwallet.float.quoteAdd", { amount: "10000000" })), "security.subwallet.refused", app);
    for (const app of ["pay", "browser", "extension"] as const) assert.equal(code(await forApps(core, app).call("subwallet.float.quoteAdd", { amount: "10000000" })), "security.request.not-allowed", app);
  } finally {
    core.close();
  }
});

test("D1 (V4 Swap, D111): Home's Swap in Wallet reaches the core's swap inside Spending; every other app is still refused", async () => {
  const { core } = await readyAccount();
  try {
    const trade = forApps(core, "trade"), wallet = forApps(core, "wallet");
    ok(await trade.call("subwallet.create", { kind: "trade", chain: "near" }));
    const coin = "nep141:qtc.omft.near";
    // Without the quote server set up here, Wallet's call gets as far as the core's own refusal (control: today's code
    // answered "not allowed" before anything was asked).
    for (const method of ["subwallet.float.swapQuote", "subwallet.float.swap"]) {
      const params = { side: "buy", coin, amount: "5000000", atLeast: "0", key: "swap-key-00000001" };
      assert.equal(code(await wallet.call(method, params)), "security.subwallet.refused", `wallet ${method}: past the gate, refused by the core itself (no quote server here)`);
      assert.equal(code(await wallet.call(method, { ...params, session: { perTxUsd: 100, totalUsd: 500, minutes: 30 } })), "security.subwallet.refused", `wallet ${method} with a session`);
      for (const app of ["pay", "browser", "social", "extension", "chat", ...(method === "subwallet.float.swap" ? (["agent"] as const) : [])] as const) {
        assert.match(code(await forApps(core, app).call(method, params)), /^security\.(request|bridge)\.not-allowed$/, `${app} ${method}`);
      }
    }
    // AgentZero's quote_dry: its dry price passes the gate (to the core's own refusal here: no quote server); its swap
    // never does (above, control)
    assert.equal(code(await forApps(core, "agent").call("subwallet.float.swapQuote", { side: "buy", coin, amount: "5000000" })), "security.subwallet.refused", "agent: a dry price only");
    // Wallet still moves nothing else of Spending's float, and never reads it
    assert.equal(code(await wallet.call("subwallet.float.out", { chain: "sol", slot: 0, amount: "100000000", key: "trade-job-00000009" })), "security.request.not-allowed");
    assert.equal(code(await wallet.call("subwallet.float.home", { amount: "1000000", key: "trade-job-00000010" })), "security.request.not-allowed");
    assert.equal(code(await wallet.call("subwallet.session.start", { perTxUsd: 10, totalUsd: 10, minutes: 5 })), "security.request.not-allowed");
  } finally {
    core.close();
  }
});

test("on the phone the account key is the chip's: the core signs through it and never keeps a seed", async () => {
  const chain = new FakeChain();
  const vault = new MemoryVault();
  // A stand-in for the iPhone's chip key: the core gets only the public key and a way to ask for signatures.
  const chip = SoftwareKey.generate();
  let made = 0;
  let signed = 0;
  const chipKey = { kind: "secure-chip" as const, publicKey: chip.publicKey, publicKeyHandle: chip.publicKeyHandle, signHash: async (h: Uint8Array) => (signed++, chip.signHash(h)) };
  const deviceKeys = { make: async () => (made++, chipKey), get: async () => (made ? chipKey : null), forget: async () => {} };
  const core = newCore(chain, vault, { deviceKeys });
  sheet(core);
  const account = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  assert.equal(await vault.get("device-seed"), null, "no device seed in the vault");
  // the backup key went on chain with the account's rules at set-up; the first payment is the chip's to sign
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  assert.equal(ok(await core.call<TxOutcome>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "", from: "wallet" } })).status, "done");
  assert.ok(signed >= 1, "the payment was signed by the chip");
  const keys = [...chain.accounts.get(account.accountId)!.keys.keys()];
  assert.ok(keys.includes(chip.publicKey), "the chip's key is the account's device key");
  core.close();
});

test("on the phone (S1.6) every chip signature is approved on the chip's own sheet, the only sheet; the next sheet waits for it", async () => {
  const chain = new FakeChain();
  const chip = SoftwareKey.generate();
  const onSheet: { id: string; title: string }[] = [];
  let hold: Promise<void> = Promise.resolve();
  const chipKey = {
    kind: "secure-chip" as const,
    publicKey: chip.publicKey,
    publicKeyHandle: chip.publicKeyHandle,
    signHash: async (): Promise<Uint8Array> => assert.fail("the chip is never asked for a bare hash"),
    signOnSheet: async ({ id, words, bytes }: { id: string; words: PlainWords; bytes: Uint8Array }) => {
      onSheet.push({ id, title: words.title });
      await hold;
      return chip.signHash(sha256(bytes));
    },
  };
  let made = 0;
  const deviceKeys = { make: async () => (made++, chipKey), get: async () => (made ? chipKey : null), forget: async () => {} };
  const core = newCore(chain, new MemoryVault(), { deviceKeys });
  const webSheets = sheet(core);
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  assert.equal(webSheets.length, 0, "no web sheet for a chip signature: one sheet, one tap");

  // While the chip's sheet is open, another approval (a separate wallet's) waits; it shows only once that sheet closes.
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  let release = () => {};
  hold = new Promise<void>((r) => (release = r));
  const before = onSheet.length;
  const paying = core.call<TxOutcome>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "", from: "wallet" } });
  while (onSheet.length === before) await new Promise((r) => setTimeout(r, 5));
  const w = ok(await forApps(core, "trade").call<{ id: string }>("subwallet.create", { kind: "trade", chain: "sol" }));
  const exporting = forApps(core, "trade").call("subwallet.export", { id: w.id });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(webSheets.length, 0, "the wallet's sheet waits while the chip's sheet is open");
  release();
  assert.equal(ok(await paying).status, "done");
  assert.ok(onSheet.length >= 1 && onSheet.every((s) => s.id.length === 32), "the payment was approved on the chip's sheet, with an id");
  ok(await exporting);
  assert.equal(webSheets.length, 1, "then it shows");
  assert.match(onSheet.at(-1)!.title, /bob\.testnet/, "the chip's sheet named the payment");
  core.close();
});

test("with its own sheet (the isolated core on the phone) every approval goes there, never to approval.needed", async () => {
  const chain = new FakeChain();
  const asked: string[] = [];
  let answer = true;
  const core = newCore(chain, new MemoryVault(), { sheet: async (w: PlainWords) => (asked.push(w.title), answer) });
  let heard = 0;
  core.on("approval.needed", () => heard++);
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  const pay = () => core.call<TxOutcome>("tx.request", { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "", from: "wallet" } });
  assert.equal(ok(await pay()).status, "done");
  assert.ok(asked.length >= 1, "the payment was approved on the core's own sheet");
  answer = false;
  assert.equal(ok(await pay()).status, "declined", "its No is a no");
  assert.equal(heard, 0, "the shell's sheet never heard an approval");
  core.close();
});

test("with the words' own screen (the phone, S1.6) the page never gets the 24 words; that screen checks three, then the key goes on chain", async () => {
  const chain = new FakeChain();
  let shownWords: string[] = [];
  let answer: "right" | "wrong" | "later" = "later";
  const core = newCore(chain, new MemoryVault(), {
    showWords: async (words: string[]) => {
      shownWords = words;
      if (answer === "later") return null;
      const positions = [2, 9, 24];
      return { positions, words: positions.map((p) => (answer === "right" ? words[p - 1] : "zoo")) };
    },
  });
  sheet(core);
  ok(await core.call("account.create"));
  assert.equal(code(await core.call("recovery.words")), "security.request.not-allowed", "the page can't read them");
  assert.equal(code(await core.call("recovery.backup")), "security.backup.declined", "Later adds nothing");
  assert.equal(shownWords.length, 24);
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "needs-backup");
  answer = "wrong";
  assert.equal(code(await core.call("recovery.backup")), "security.words.wrong", "the core checks the three again");
  answer = "right";
  const first = shownWords.join(" ");
  ok(await core.call("recovery.backup"));
  assert.equal(shownWords.join(" "), first, "the same words each time until they're added");
  assert.equal(ok(await core.call<{ stage: string }>("account.state")).stage, "ready");
  core.close();
});

test("without the words' own screen (a browser), recovery.backup isn't there and the page shows the words as before", async () => {
  const core = newCore(new FakeChain());
  sheet(core);
  ok(await core.call("account.create"));
  assert.equal(code(await core.call("recovery.backup")), "security.method.unknown");
  assert.equal(ok(await core.call<{ words: string[] }>("recovery.words")).words.length, 24);
  core.close();
});

test("an app never reaches the background alerts' read or this device's second devices; the shell does (audits, Lows; IOS-4)", async () => {
  const { appMayCall } = await import("./bridge.ts");
  for (const app of ["trade", "wallet", "pay", "agent", "earn", "browser", "extension"] as const) {
    assert.equal(appMayCall(app, "alerts.poll"), false, `${app}: alerts.poll`);
    assert.equal(appMayCall(app, "secondDevice.state"), false, `${app}: secondDevice.state`);
    assert.equal(appMayCall(app, "secondDevice.answer"), false, `${app}: secondDevice.answer`);
  }
});

test("grade 02h, H1: every app reads the core's one NEAR price snapshot (account.nearPrice): one read kept a minute, the same figure the sheet prices with", async () => {
  const { appMayCall } = await import("./bridge.ts");
  for (const app of ["wallet", "pay", "trade", "chat"] as const) assert.equal(appMayCall(app, "account.nearPrice"), true, app);
  const real = globalThis.fetch;
  let reads = 0;
  let price = 4.2795;
  globalThis.fetch = (async () => (reads++, new Response(JSON.stringify([{ assetId: "nep141:wrap.near", price, priceUpdatedAt: new Date().toISOString() }])))) as typeof fetch;
  try {
    const core = newCore(new FakeChain(), new MemoryVault(), { sheetPrices: true });
    assert.deepEqual(ok(await core.call("account.nearPrice")), { usd: 4.2795 });
    price = 4.31;
    assert.deepEqual(ok(await core.call("account.nearPrice")), { usd: 4.2795 }, "kept: the same amount reads the same dollars");
    assert.equal(reads, 1);
    core.close();
    // No price read: null, never a made-up figure, and not kept (the next screen asks again).
    globalThis.fetch = (async () => (reads++, new Response("nope", { status: 500 }))) as typeof fetch;
    const off = newCore(new FakeChain(), new MemoryVault(), { sheetPrices: true });
    assert.deepEqual(ok(await off.call("account.nearPrice")), { usd: null });
    await new Promise((r) => setTimeout(r, 5));
    const before = reads;
    await off.call("account.nearPrice");
    assert.equal(reads, before + 1);
    off.close();
  } finally {
    globalThis.fetch = real;
  }
});

test("email alerts: Not now on the proof's sheet asks the relay nothing; the sheet says what is signed and for whom", async () => {
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => rulesWasm, privateQuotes: "https://relay.test/" });
  let answer = true;
  const shown: PlainWords[] = [];
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => (shown.push(words), void core.call("approval.answer", { id, approve: answer })));
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = (async () => (asked++, new Response(JSON.stringify({ asked: true })))) as typeof fetch;
  try {
    answer = false;
    assert.deepEqual(ok(await core.call("account.alertsEmail", { email: "kim@example.com" })), { declined: true });
    assert.equal(asked, 0, "nothing reached the relay");
    assert.equal(shown.at(-1)!.title, "Turn on email alerts to kim@example.com");
    assert.ok(shown.at(-1)!.lines.includes(`For ${accountId}`) && shown.at(-1)!.lines.some((l) => /relay\.test only\. No money moves\./.test(l)));
  } finally {
    globalThis.fetch = real;
    core.close();
  }
});

test("release 7: set-up offers the recovery delay (D49: 48 h default, 3, 7, 14, 30 d on mainnet; a minute too on testnet), the choice goes on chain and is fixed", async () => {
  const chain = new FakeChain();
  const core = newCore(chain, new MemoryVault(), { policyWasm: async () => rulesWasm });
  try {
    const choices = ok(await core.call<{ seconds: number; label: string; line: string; default: boolean }[]>("account.recoveryChoices"));
    assert.deepEqual(choices.map((c) => c.seconds), [60, 172_800, 259_200, 604_800, 1_209_600, 2_592_000]);
    assert.deepEqual(choices.filter((c) => c.default).map((c) => c.seconds), [172_800]);
    assert.ok(choices.every((c) => c.line.includes("how long a stranger with your words must wait".replace("how", "How")) && c.line.includes("You can stop them in that time")), "one plain line each");
    assert.equal(code(await core.call("account.create", { recoveryDelaySeconds: 59 })), "security.request.invalid", "under the contract's least");
    const { accountId } = ok(await core.call<{ accountId: string }>("account.create", { recoveryDelaySeconds: 120 }));
    assert.equal(ok(await core.call<{ delaySeconds: number }>("recovery.status")).delaySeconds, 120, "the choice went on chain");
    assert.equal(chain.accounts.get(accountId)!.policy!.delayNs, 120_000_000_000n);
    assert.equal(code(await core.call("account.create", { recoveryDelaySeconds: 86_400 })), "security.account.exists", "fixed after set-up");
  } finally {
    core.close();
  }
  // On mainnet only the five choices (no 24 hours, D49); the pinned release refuses a minute.
  const main = new FakeChain("mainnet");
  const mcore = new DemoCore({ chain: main, vault: new MemoryVault(), policyWasm: async () => mainnetWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1 });
  try {
    assert.deepEqual(ok(await mcore.call<{ seconds: number }[]>("account.recoveryChoices")).map((c) => c.seconds), [172_800, 259_200, 604_800, 1_209_600, 2_592_000]);
    assert.equal(code(await mcore.call("account.create", { recoveryDelaySeconds: 60 })), "security.request.invalid");
    assert.equal(code(await mcore.call("account.create", { recoveryDelaySeconds: 86_400 })), "security.request.invalid", "24 hours is no longer offered");
    assert.equal(code(await mcore.call("account.create", { recoveryDelaySeconds: 3 * 86_400 + 1 })), "security.request.invalid");
  } finally {
    mcore.close();
  }
});

test("AgentZero's USDC (release 10, D89): with its own wallet off, its key pays no one by itself, a listed name included, and the keep job's top-up is refused (sandbox order, M13)", async () => {
  const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const { chain, core, accountId } = await readyWithRules({ modules: true, over: { agentWallet: { on: false } } /* the sandbox order's own path: explicitly off */ });
  try {
    const budget = { coins: [{ coin: USDC, per_day: "20000000", per_month: "600000000", convert_per_day: "0" }], recipients: ["bob.testnet"], ends_at_ns: at(2027, 0, 15), max_spends_per_day: 12 };
    const out = ok(await core.call<TxOutcome & { id: string }>("account.agent.set", { budget, orders: [] }));
    advance(121);
    if (out.status === "waiting") ok(await core.call("account.waiting.run", { id: out.id }));
    chain.fundIntents(accountId, USDC, 50_000_000n);
    const agentApp = forApps(core, "agent");
    // The sandbox order (M13): with AgentZero's own wallet off, its key pays nothing by itself, even a listed name inside
    // the day, and the keep job's top-up is refused the same way; nothing moves.
    for (const p of [{ kind: "pay", payout: { Ledger: { token_id: USDC } }, to: "bob.testnet", amount: "5000000" }, { kind: "top-up", amount: "5000000", to: "mallory.testnet" }]) {
      const r = await agentApp.call<TxOutcome>("account.agent.spend", p);
      assert.equal("problem" in r ? r.problem.more : "", "AgentZero's own wallet isn't on yet, so it can't do this by itself. Nothing moved.", p.kind);
    }
    assert.equal(chain.intentsBalance("bob.testnet", USDC), 0n);
    assert.equal(chain.intentsBalance(accountId, USDC), 50_000_000n);
  } finally {
    restoreClock();
    core.close();
  }
});

test("AgentZero's stop cancels only AgentZero's waiting LOOSENING (review M4), never a tightening in flight, never anything of the person's", async () => {
  const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const { core, shown } = await readyWithRules({ modules: true, over: { agentWallet: { on: false } } /* the Safe agent key exists only with AgentZero's own wallet off (agent-door.ts SAFE_KEY_DOORS; agent-safe-key.test.ts) */ });
  try {
    const coin = (any: string) => ({ coins: [{ coin: USDC, per_day: "20000000", per_month: "600000000", convert_per_day: any }], recipients: ["bob.testnet"], ends_at_ns: at(2027, 0, 15), max_spends_per_day: 12 });
    const set = ok(await core.call<TxOutcome & { id: string }>("account.agent.set", { budget: coin("0"), orders: [] }));
    advance(121);
    if (set.status === "waiting") ok(await core.call("account.waiting.run", { id: set.id }));
    // A looser budget (the any-address cap opened) waits; so does a big payment of the person's own.
    const loosen = ok(await core.call<TxOutcome & { id: string }>("account.agent.setBudget", { budget: coin("20000000") }));
    assert.equal(loosen.status, "waiting");
    const held = ok(await core.call<TxOutcome & { id: string }>("tx.request", pay(`6${NEAR}`))).status;
    assert.equal(held, "waiting", "the person's 6 NEAR payment is held too (over the Face ID band)");
    const before = ok(await core.call<{ id: string; kind: string }[]>("account.waiting"));
    assert.ok(before.some((w) => w.kind === "AgentSetBudget"));
    const agentApp = forApps(core, "agent");
    // The agent app can't reach the general cancel at all.
    assert.equal(code(await agentApp.call("account.waiting.cancel", { id: loosen.id })), "security.bridge.not-allowed");
    // A tightening in flight too (on this account every budget change waits): it must be left to land.
    const tighten = ok(await core.call<TxOutcome & { id: string }>("account.agent.setBudget", { budget: { ...coin("0"), recipients: [] } }));
    assert.equal(tighten.status, "waiting");
    const out = ok(await agentApp.call<{ cancelled: number }>("account.agent.cancelWaiting"));
    assert.equal(out.cancelled, 1, "only the loosening");
    assert.match(shown.at(-1)!.title, /^Cancel: /, "on the core's own Cancel sheet");
    const after = ok(await core.call<{ id: string; kind: string }[]>("account.waiting"));
    assert.equal(after.filter((w) => w.kind === "AgentSetBudget").length, 1, "the tightening is still waiting");
    assert.ok(after.some((w) => w.id === tighten.id));
    assert.ok(!after.some((w) => w.id === loosen.id));
    assert.equal(after.length, before.length, "the loosening went, the tightening came in, the person's payment stayed");
  } finally {
    restoreClock();
    core.close();
  }
});

test("Use AgentZero on a computer (D101): the core's own sheet with the check code, then only a sealed box to the relay's one-time mailbox; the computer opens AgentZero's own key", async () => {
  const { makeOffer, openSeed } = await import("./pair.ts");
  const { chain, core, shown, accountId } = await readyWithRules({ modules: true, over: { agentWallet: { on: false } } /* the Safe agent key exists only with AgentZero's own wallet off (agent-door.ts SAFE_KEY_DOORS; agent-safe-key.test.ts) */ });
  const realFetch = globalThis.fetch;
  const posted: { url: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    posted.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
  try {
    const budget = { coins: [{ coin: "near", per_day: `1${NEAR}`, per_month: `10${NEAR}`, convert_per_day: "0" }], recipients: ["bob.testnet"], ends_at_ns: at(2027, 0, 15), max_spends_per_day: 5 };
    const set = ok(await core.call<TxOutcome & { id: string }>("account.agent.set", { budget, orders: [] }));
    advance(121);
    if (set.status === "waiting") ok(await core.call("account.waiting.run", { id: set.id }));
    const agentApp = forApps(core, "agent");
    // No relay configured in this test core: the method says so, and nothing is sent.
    assert.equal(code(await agentApp.call("account.agent.pairComputer", { offer: makeOffer().offer })), "security.request.not-allowed");
    assert.equal(posted.length, 0);
    // A core with the pinned relay: the real path.
    // A phone: its core's sheet is the native one (Face ID on the iPhone); pairing is phone-only (second review).
    const nativeShown: PlainWords[] = [];
    const r = await readyWithRules({ modules: true, over: { privateQuotes: "https://relay.test/", sheet: async (w: PlainWords) => (nativeShown.push(w), true), agentWallet: { on: false } } });
    const set2 = ok(await r.core.call<TxOutcome & { id: string }>("account.agent.set", { budget, orders: [] }));
    advance(121);
    if (set2.status === "waiting") ok(await r.core.call("account.waiting.run", { id: set2.id }));
    const app2 = forApps(r.core, "agent");
    // Junk instead of a computer's code: refused before any sheet.
    const sheets = nativeShown.length;
    assert.equal(code(await app2.call("account.agent.pairComputer", { offer: "pay 5 to drainer.near" })), "security.request.invalid");
    assert.equal(nativeShown.length, sheets);
    // The computer's offer: the core's own sheet names the check code; then one POST of a sealed box.
    const computer = makeOffer();
    const out = ok(await app2.call<{ status: string; words: string[] }>("account.agent.pairComputer", { offer: computer.offer }));
    assert.equal(out.status, "paired");
    const words = nativeShown.at(-1)!;
    assert.equal(words.title, "Use AgentZero on a computer");
    // The computer's own words on the core's sheet, before anything was sealed (security review).
    assert.deepEqual(out.words, computer.words);
    assert.equal(words.lines[0], `Your computer must show these words: ${computer.words.join(" ")}.`);
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.url, `https://relay.test/v0/pair/${computer.mailbox}`);
    const { box } = JSON.parse(posted[0]!.body) as { box: string };
    assert.deepEqual(Object.keys(JSON.parse(posted[0]!.body)), ["box"], "only the box goes to the relay");
    assert.doesNotMatch(box, new RegExp(r.accountId.replace(/\./g, "\\.")), "no account id in the clear");
    // The computer's side: it opens AgentZero's own key (the key on the account with only agent_pay), the same code.
    const opened = openSeed(box, computer.mailbox, computer.secret)!;
    assert.equal(opened.accountId, r.accountId);
    const { SoftwareKey: SK } = await import("./device-key.ts");
    const agentKey = SK.fromSeed(opened.seed, "development");
    const onAccount = [...r.chain.accounts.get(r.accountId)!.keys.entries()].find(([, k]) => k.permission.kind === "function-call" && k.permission.methods.join() === ACCOUNT_POLICY.agentMethods.join());
    assert.ok(onAccount, "AgentZero's key is on the account");
    assert.equal(onAccount![0], agentKey.publicKey, "the computer got AgentZero's own key, nothing else");
    agentKey.destroy();
    r.core.close();
  } finally {
    globalThis.fetch = realFetch;
    restoreClock();
    core.close();
  }
});

test("D103: on the web (no native Face ID sheet) pairing a computer and loosening AgentZero need the passkey's user check; without it they're refused by name, a tightening never needs it", async () => {
  const { makeOffer } = await import("./pair.ts");
  const budget = (any = "0", day = `1${NEAR}`) => ({ coins: [{ coin: "near", per_day: day, per_month: `10${NEAR}`, convert_per_day: any }], recipients: ["bob.testnet"], ends_at_ns: at(2027, 0, 15), max_spends_per_day: 5 });
  // No user check on this web host: turning AgentZero on is refused by name; nothing is placed.
  const bare = await readyWithRules({ modules: true, over: { userVerified: undefined, privateQuotes: "https://relay.test/", agentWallet: { on: false } } /* the Safe agent key exists only with AgentZero's own wallet off (agent-door.ts SAFE_KEY_DOORS; agent-safe-key.test.ts) */ });
  const off = await bare.core.call("account.agent.set", { budget: budget(), orders: [] });
  assert.equal(code(off), "security.request.not-allowed");
  assert.match("problem" in off ? String(off.problem.more) : "", /Give AgentZero more from the ZeroFee app on your phone/);
  bare.core.close();
  // A user check that fails (the passkey couldn't verify): the same; one that passes (control): AgentZero turns on.
  let verify = false;
  const r = await readyWithRules({ modules: true, over: { userVerified: async () => verify, privateQuotes: "https://relay.test/", agentWallet: { on: false } } });
  assert.equal(code(await r.core.call("account.agent.set", { budget: budget(), orders: [] })), "security.request.not-allowed");
  verify = true;
  const set = ok(await r.core.call<TxOutcome & { id: string }>("account.agent.set", { budget: budget(), orders: [] }));
  advance(121);
  if (set.status === "waiting") ok(await r.core.call("account.waiting.run", { id: set.id }));
  // A tightening needs no check, even when the check would fail: it goes to the account (placed, here it waits).
  verify = false;
  assert.ok(["waiting", "done"].includes(ok(await r.core.call<TxOutcome>("account.agent.setBudget", { budget: budget("0", `5${NEAR.slice(1)}`) })).status));
  // A loosening does; so do a standing order, a resume, and a number the contract would read but isn't canonical.
  assert.equal(code(await r.core.call("account.agent.setBudget", { budget: budget(`1${NEAR}`) })), "security.request.not-allowed");
  assert.equal(code(await r.core.call("account.agent.setBudget", { budget: budget("0", `+5${NEAR.slice(1)}`) })), "security.request.not-allowed", "a '+' number");
  assert.equal(code(await r.core.call("account.agent.setBudget", { budget: budget("0", `00${NEAR}`) })), "security.request.not-allowed", "zero-padded");
  assert.equal(code(await r.core.call("account.agent.addOrder", { plan: { payout: "Near", to: "bob.testnet", amount: "1", dates_ns: [at(2027, 0, 1)], grace_seconds: "60" } })), "security.request.not-allowed");
  assert.equal(code(await r.core.call("account.agent.resume")), "security.request.not-allowed");
  // Pairing a computer on the web: the check fails → refused by name, nothing sent.
  const realFetch = globalThis.fetch;
  const posted: string[] = [];
  globalThis.fetch = (async (u: string) => (posted.push(String(u)), new Response("{}", { status: 201 }))) as typeof fetch;
  try {
    // Pairing on the web is refused by name EVEN with a passing user check: a web page answers its own sheets, so the
    // check can't prove the person saw the words (second review). The phone pairs (the join test above).
    for (const v of [false, true]) {
      verify = v;
      const no = await forApps(r.core, "agent").call("account.agent.pairComputer", { offer: makeOffer().offer });
      assert.equal(code(no), "security.request.not-allowed");
      assert.match("problem" in no ? String(no.problem.more) : "", /Pair a computer from the ZeroFee app on your phone/);
    }
    assert.equal(posted.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    restoreClock();
    r.core.close();
  }
});

test("AgentZero's pocket (D107) through the core: only the agent app reaches it; with AgentZero's own wallet off its trading day doesn't start and it signs no trade by itself (sandbox order, M13); subwallet.signTx refuses the pocket for every caller (P1); pause, Stop and the end stay safe", async () => {
  const { buy, pocketNode } = await import("./testing/pocket-tx.ts");
  const solOver = { sol: pocketNode(), nativeUsd: async (c: string) => (c === "sol" ? 150 : null), agentWallet: { on: false } }; // the sandbox order's own path: explicitly off
  const budget = { coins: [{ coin: "near", per_day: `1${NEAR}`, per_month: `10${NEAR}`, convert_per_day: "0" }], recipients: ["bob.testnet"], ends_at_ns: at(2027, 0, 15), max_spends_per_day: 5 };
  const day = { perTxUsd: 5, totalUsd: 20, minutes: 60 };
  const sandboxed = (r: unknown) => "problem" in (r as object) && (r as { problem: { more?: string } }).problem.more === "AgentZero's own wallet isn't on yet, so it can't do this by itself. Nothing moved.";
  const r = await readyWithRules({ modules: true, over: solOver });
  const agent = forApps(r.core, "agent");
  // D117: its address is the SOL row's own wallet (Trade's); reading it is not a money act.
  const pocket = ok(await agent.call<{ id: string; address: string }>("account.agent.pocket"));
  assert.match(pocket.id, /^trade-sol-/);
  const set = ok(await r.core.call<TxOutcome & { id: string }>("account.agent.set", { budget, orders: [] }));
  advance(121);
  if (set.status === "waiting") ok(await r.core.call("account.waiting.run", { id: set.id }));
  // Other apps never reach it.
  for (const app of ["trade", "social", "browser", "chat", "wallet", "pay"] as const) {
    for (const m of ["account.agent.pocket", "account.agent.pocketSession", "account.agent.pocketSign", "account.agent.pocketEnd"]) {
      assert.equal(code(await forApps(r.core, app).call(m, { ...day, tx: buy(pocket.address, 1) })), "security.bridge.not-allowed", `${app} ${m}`);
    }
  }
  // AgentZero on, its budget set: still no day and no trade by itself while its own wallet is off; no sheet.
  const sheets = r.shown.length;
  assert.ok(sandboxed(await agent.call("account.agent.pocketSession", day)));
  assert.ok(sandboxed(await agent.call("account.agent.pocketSign", { tx: buy(pocket.address, 2) })));
  assert.equal(r.shown.length, sheets, "no sheet");
  // P1 holds for an old pocket: ZeroFee's own screens get the binding's refusal; a "trade" or "agent" stamp the core's
  // app check; the agent app can't reach subwallet.* at all.
  const old = ok(await r.core.call<{ id: string; address: string }>("subwallet.create", { kind: "site", chain: "sol", siteId: "agentzero" }));
  for (const [app, want] of [[undefined, "security.subwallet.refused"], ["trade", "security.request.not-allowed"], ["agent", "security.request.not-allowed"]] as const) {
    assert.equal(code(await r.core.call("subwallet.signTx", { id: old.id, tx: buy(old.address, 2), ...(app ? { app } : {}) })), want, String(app));
  }
  assert.equal(code(await agent.call("subwallet.signTx", { id: pocket.id, tx: buy(pocket.address, 2) })), "security.bridge.not-allowed");
  assert.equal((ok(await agent.call<{ oldPocket?: true }>("account.agent.pocket"))).oldPocket, true, "the screen learns there's an old pocket to move");
  // Pause, the end and Stop: always safe.
  ok(await r.core.call("account.agent.pause"));
  assert.ok(sandboxed(await agent.call("account.agent.pocketSession", day)));
  ok(await agent.call("account.agent.pocketEnd"));
  assert.equal(ok(await r.core.call<TxOutcome>("account.agent.revoke")).status, "done");
  r.core.close();
});

test("Ask me above $X (item 1) through the core: the agent app sets it (lower at once, higher on the sheet); with its own wallet off a payment is refused by the sandbox first (M13)", async () => {
  const r = await readyWithRules({ modules: true, over: { agentWallet: { on: false } } /* the sandbox order's own path: explicitly off */ });
  const agent = forApps(r.core, "agent");
  assert.deepEqual(ok(await agent.call("account.agent.askAbove", {})), { askAboveUsd: null });
  const sheets = r.shown.length;
  assert.deepEqual(ok(await agent.call("account.agent.askAbove", { set: true, usd: 5 })), { askAboveUsd: 5 });
  assert.equal(r.shown.length, sheets, "tighter: no sheet");
  // With its own wallet off (sandbox order, M13) a payment is refused by name before "Ask me first" is even read.
  const usdc = { Ledger: { token_id: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" } };
  const over = await agent.call("account.agent.spend", { kind: "pay-private", to: "bob.testnet", payout: usdc, amount: "6000000", usd: 6 });
  assert.equal("problem" in over ? over.problem.more : "", "AgentZero's own wallet isn't on yet, so it can't do this by itself. Nothing moved.");
  assert.deepEqual(ok(await agent.call("account.agent.askAbove", { set: true, usd: 50 })), { askAboveUsd: 50 });
  assert.equal(r.shown.at(-1)!.title, "Let AgentZero pay more without asking");
  for (const app of ["trade", "chat", "browser"] as const) assert.equal(code(await forApps(r.core, app).call("account.agent.askAbove", { set: true, usd: null })), "security.bridge.not-allowed", app);
  r.core.close();
});

test("V4 Send from a row, D143: the core's plain transfer (no sheet) is Wallet's only, at subwallets.ts itself, whatever demo-core lets through", async () => {
  const { SubWallets } = await import("./subwallets.ts");
  const shown: PlainWords[] = [];
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as never, evm: {} as never, approve: async (words) => (shown.push(words), true), emit: () => {} });
  const to = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const said = async (app: string) => w.sendPlain("sol", to, "0.1", undefined, "ZeroFee", app).then(() => "sent", (e) => e?.problem?.code);
  for (const app of ["chat", "trade", "browser", "social", "agent", "extension", "pay", ""]) assert.equal(await said(app), "security.request.not-allowed", app || "no app");
  // control: Wallet's own goes past it (no Solana wallet here: unknown)
  assert.equal(await said("wallet"), "security.subwallet.unknown");
  assert.equal(shown.length, 0, "no sheet");
});

test("A-10 through the core: agent.<you>.near only once the account's release can make it, on the core's sheet, holding only its storage and a function-call key on itself (never full access)", async () => {
  const { IDENTITY_STORAGE_YOCTO } = await import("./testing/fake-chain.ts");
  const r = await readyWithRules({ modules: true });
  const agent = forApps(r.core, "agent");
  const sub = `agent.${r.accountId}`;
  // An account whose release has no such method yet: said, no sheet, nothing made.
  assert.deepEqual(ok(await agent.call("account.agent.identity")), { name: null, line: "AgentZero's own name comes with your account's next update. Nothing changed.", canMake: false });
  const sheets = r.shown.length;
  assert.equal(code(await agent.call("account.agent.identityCreate")), "security.request.not-allowed");
  assert.equal(r.shown.length, sheets);
  assert.equal(r.chain.accounts.has(sub), false);
  // With the release: the sheet's line, then the name, with only its storage and only a function-call key on itself.
  r.chain.withIdentity(r.accountId);
  assert.equal(ok<{ canMake: boolean }>(await agent.call("account.agent.identity")).canMake, true);
  assert.deepEqual(ok(await agent.call("account.agent.identityCreate")), { name: sub });
  assert.equal(r.shown.at(-1)!.title, "Give AgentZero its own name");
  assert.equal(r.shown.at(-1)!.lines[0], `${sub} is AgentZero's name. It holds no money and can't move yours.`);
  const made = r.chain.accounts.get(sub)!;
  assert.equal(made.balance, IDENTITY_STORAGE_YOCTO, "only its storage");
  const keys = [...made.keys.values()];
  assert.equal(keys.length, 1);
  assert.equal(keys[0]!.permission.kind, "function-call", "never full access");
  assert.ok(keys[0]!.permission.kind === "function-call" && keys[0]!.permission.receiverId === sub && keys[0]!.permission.methods.length === 0 && keys[0]!.permission.allowanceYocto === 0n, "it can call nothing and pay no gas: a name, not a pot");
  assert.deepEqual(ok(await agent.call("account.agent.identity")), { name: sub, line: null, canMake: false });
  for (const app of ["trade", "browser", "chat"] as const) assert.equal(code(await forApps(r.core, app).call("account.agent.identityCreate")), "security.bridge.not-allowed", app);
  r.core.close();
});

test("money that came in: the NEAR that opened the account is one lasting Received row, its dollars priced once it is open (control: before the opening, none; another app may not read it)", async () => {
  const chain = new FakeChain("mainnet");
  chain.fund("near", SoftwareKey.generate().publicKey, 0n);
  const vault = new MemoryVault();
  const core = new DemoCore({ chain, vault, policyWasm: async () => mainnetWasm, prices: async () => ({ near: 4 }), nativeUsd: async () => 4, watchIntervalMs: 20, indexRetryMs: 1, settleMs: 1 });
  sheet(core);
  const funding = ok(await core.call<{ accountId: string; fundAddress: string; needYocto: string }>("account.create"));
  await wordsChecked(core);
  const sent = BigInt(funding.needYocto) + 3n * 10n ** 24n;
  chain.fund(funding.fundAddress, `ed25519:${toBase58(Buffer.from(funding.fundAddress, "hex"))}`, 0n);
  chain.accounts.get(funding.fundAddress)!.balance = sent;
  ok(await core.call("account.create"));
  const read = () => core.call<{ adds: unknown[]; opened: { id: string; kind: string; into: string; tokenId: string; amount: string; usd?: string } | null }>("subwallet.received", {});
  const r = ok(await read());
  assert.deepEqual([r.opened?.id, r.opened?.kind, r.opened?.into, r.opened?.tokenId, r.opened?.amount], [`open:${funding.accountId}`, "open", "safe", "near", sent.toString()]);
  assert.equal(r.opened?.usd, ((Number(sent) / 1e24) * 4).toFixed(2));
  assert.deepEqual(ok(await read()).opened, r.opened, "read again: the same one row");
  assert.equal(code(await core.call("subwallet.received", { app: "trade" })), "security.request.not-allowed", "Wallet's only");
  core.close();
  // control: an account still waiting for its money has no opening row (the record is written when the opening begins)
  const chain2 = new FakeChain("mainnet");
  chain2.fund("near", SoftwareKey.generate().publicKey, 0n);
  const early = new DemoCore({ chain: chain2, vault: new MemoryVault(), policyWasm: async () => mainnetWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, settleMs: 1 });
  sheet(early);
  ok(await early.call("account.create"));
  const before = await early.call<{ opened: unknown }>("subwallet.received", {});
  assert.ok("problem" in before || before.ok.opened === null, "nothing before the opening");
  early.close();
});

test("D134 item 3: account.state is read once per open and kept a moment for every caller; a change drops it (control)", async () => {
  const { chain, core, accountId } = await readyAccount();
  let heads = 0;
  const head = chain.commonBlock.bind(chain);
  chain.commonBlock = () => (heads++, head());
  const first = ok(await core.call<{ stage: string }>("account.state"));
  assert.equal(first.stage, "ready");
  const after = heads;
  assert.ok(after > 0, "the first read reads the chain");
  await Promise.all([core.call("account.state"), core.call("account.state"), core.call("account.state")]);
  assert.equal(heads, after, "three more callers, no more chain reads");
  // control: a call that isn't a read (anything that may change the account) drops the kept state
  await core.call("nothing.here");
  ok(await core.call("account.state"));
  assert.ok(heads > after, "read again after a change");
  // item 4: whose account, from the vault alone (no chain read), for the balance read to start at unlock
  const before = heads;
  assert.deepEqual(ok(await core.call("account.id")), { accountId, network: "testnet" });
  assert.equal(heads, before);
});

test("review L5: the kept account.state is each caller's own copy (control: the kept one is still shared, no new read)", async () => {
  const { chain, core } = await readyAccount();
  let heads = 0;
  const head = chain.commonBlock.bind(chain);
  chain.commonBlock = () => (heads++, head());
  const one = ok(await core.call<{ stage: string; account: { accountId: string } }>("account.state"));
  const after = heads;
  one.account.accountId = "changed.testnet";
  const two = ok(await core.call<{ stage: string; account: { accountId: string } }>("account.state"));
  assert.notEqual(two.account.accountId, "changed.testnet", "one caller changing its answer never changes another's");
  assert.equal(heads, after, "control: still the kept read, not a new one");
});

test("audit 2 (review of 134e5b5b, 1, 4, 5): the sweep's flag is in before the marks; the sweep runs beside the sync, one at a time, never inside it; an empty pass keeps watching the old wallets for 7 days", async () => {
  const { chain, core } = await readyWithRules();
  const sw = (core as any).subwallets;
  const vault = (core as any).vault as MemoryVault;
  const DUE = "old-words-sweep-due";
  let flagAtMark: boolean | null = null;
  const mark = sw.markOldWords.bind(sw);
  sw.markOldWords = async () => {
    flagAtMark = !!(await vault.get(DUE));
    return mark();
  };
  let calls = 0;
  let release!: (r: unknown) => void;
  sw.rotateAfterNewWords = () => (calls++, new Promise((r) => (release = r)));
  const realNow = Date.now;
  try {
    const { words } = ok(await core.call<{ words: string[] }>("recovery.renew"));
    ok(await core.call<TxOutcome>("recovery.renewConfirm", { positions: [4, 9, 20], words: [words[3], words[8], words[19]] }));
    chain.skewSeconds = 121;
    const base = realNow() + 121_000;
    Date.now = () => base;
    const held = ok(await core.call<{ id: string }[]>("account.waiting"));
    assert.equal(ok(await core.call<TxOutcome>("account.waiting.run", { id: held[0]!.id })).status, "done");
    // The words take over on this read; a sweep that never answers doesn't hold it (review 5).
    ok(await core.call("recovery.status"));
    assert.equal(flagAtMark, true, "review 4: the flag was in before anything was marked");
    assert.equal(calls, 1, "the sweep started at once");
    ok(await core.call("recovery.status"));
    ok(await core.call("recovery.status"));
    assert.equal(calls, 1, "one at a time: the syncs while it runs start none");
    release({ moving: 0, left: 0, coins: [] });
    await (core as any).sweepFlight;
    // Review 1: nothing found, but money can still land on an old wallet: the watch goes on.
    assert.ok(await vault.get(DUE), "an empty pass doesn't end the watch");
    sw.rotateAfterNewWords = async () => (calls++, { moving: 0, left: 0, coins: [] });
    Date.now = () => base + 11 * 60_000;
    ok(await core.call("recovery.status"));
    await (core as any).sweepFlight;
    assert.equal(calls, 2, "asked again on a later sync");
    assert.ok(await vault.get(DUE), "still inside the 7 days");
    Date.now = () => base + 7 * 86_400_000 + 60_000;
    ok(await core.call("recovery.status"));
    await (core as any).sweepFlight;
    assert.equal(calls, 3);
    assert.ok(!(await vault.get(DUE)), "7 days with nothing in them: the watch ends");
    // Wallet's Try again watches again.
    ok(await core.call("subwallet.oldWords.move", { app: "wallet" }));
    assert.equal(calls, 4);
    assert.ok(await vault.get(DUE));
    assert.equal(code(await core.call("subwallet.oldWords", { app: "trade" })), "security.request.not-allowed");
  } finally {
    Date.now = realNow;
    core.close();
  }
});
