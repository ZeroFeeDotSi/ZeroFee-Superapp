// The sheets' speed budget (2 Nov): how many network round trips each approval sheet waits for, from the call to the sheet.
//
// Every chain read here takes ROUND ms, as one round trip to two nodes does. Reads are shared as NodePace shares them in
// the app (the same read pinned to a block, asked twice, is asked once; the agreed block is kept a second), so what is
// counted is what the core makes the person wait for: reads asked one after another. Before the 2 Nov speed work,
// Protection's Save waited 5 round trips here (2.0-3.0 s at 4x CPU on testnet, 6.6 s in grade 02e); now 2. A change that adds a round trip
// to a sheet must raise its budget here, on purpose. The numbers are in $ZEROFEE_HOME/SPEED-2026-11-02.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BridgeResult } from "./bridge.ts";
import type { Block } from "./chain.ts";
import { DemoCore } from "./demo-core.ts";
import { SoftwareKey } from "./device-key.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const ROUND = 40;
/** Round trips each sheet may wait for (after the 2 Nov work; before it in brackets). */
export const SHEET_ROUNDS = {
  protectionSave: 2, // [5]
  send: 2, // [4]
  heldCancel: 3, // [5]
  heldFinish: 3, // [5]
  newWords: 2, // [3]
  restoreStart: 2, // [6]
  restoreFinish: 3, // [4]
  exportKey: 0, // [0]
};

const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const HOLD_ABOVE_5_NEAR = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
const NEAR = "000000000000000000000000";
const PINNED = new Set(["account", "accessKey", "accessKeys", "gasPrice", "view", "globalContractSha256"]);
const key = (args: unknown[]) => JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

/**
 * The fake chain behind a network: while `slow`, every read takes one round trip; the agreed block is kept a second as
 * one unit and a read pinned to a block is shared (in flight or answered), as RpcChain and NodePace do. A send drops both.
 *
 * Time here is the network's own, never the test machine's (3 Nov: under the full suite's load the core's own work, an
 * ML-DSA key from new words, took over a wall-clock second, the kept block ran out on the wall clock, and a second read of
 * it counted as one more round trip: protection, restore and G18 failed under load and passed alone). `net.clock` moves
 * only when a read answers, to that read's start plus ROUND: reads asked together move it once, reads asked one after
 * another move it once each, and the core's own work moves it not at all. The kept block's second and each read's start
 * are on that clock.
 */
function network(fake: FakeChain) {
  const net = { slow: false, clock: 0, starts: [] as number[] };
  let head: { until: number | null; block: Promise<Block> } | null = null;
  const kept = new Map<string, Promise<unknown>>();
  const trace = process.env.SHEET_ROUNDS_TRACE ? (what: string) => console.log(`${net.clock} ${what}`) : () => {};
  const wait = (what = "") => {
    if (!net.slow) return Promise.resolve();
    trace(what);
    const at = net.clock;
    net.starts.push(at);
    return new Promise<void>((r) => setTimeout(() => ((net.clock = Math.max(net.clock, at + ROUND)), r()), ROUND));
  };
  const chain = new Proxy(fake, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v !== "function") return v;
      if (!net.slow) return v.bind(t);
      if (k === "commonBlock") {
        return () => {
          if (head && (head.until === null || head.until > net.clock)) return head.block;
          const entry: { until: number | null; block: Promise<Block> } = { until: null, block: wait("commonBlock").then(() => t.commonBlock()) };
          head = entry;
          entry.block.then(() => (entry.until = net.clock + 1_000), () => (head = null));
          return entry.block;
        };
      }
      if (typeof k === "string" && PINNED.has(k)) {
        return (...args: unknown[]) => {
          const id = `${k} ${key(args)}`;
          if (!kept.has(id)) {
            const p = wait(id.slice(0, 90)).then(() => v.apply(t, args));
            kept.set(id, p);
            p.catch(() => kept.delete(id));
          }
          return kept.get(id);
        };
      }
      if (k === "send") {
        return (...args: unknown[]) => ((head = null), kept.clear(), wait().then(() => v.apply(t, args)));
      }
      return (...args: unknown[]) => wait(String(k)).then(() => v.apply(t, args));
    },
  });
  return { chain, net, wait, reset: () => ((head = null), kept.clear(), (net.starts = [])) };
}

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};

function newCore(fake: FakeChain, n: ReturnType<typeof network>, vault = new MemoryVault()) {
  const core = new DemoCore({ chain: n.chain, vault, policyWasm: async () => rulesWasm, createAccount: async (id, pk) => fake.fund(id, pk), prices: async () => (await n.wait("prices"), { near: 4 }), protection: HOLD_ABOVE_5_NEAR, watchIntervalMs: 60_000, indexRetryMs: 1 });
  // Yes to every sheet, except while a sheet is being timed: then it is "no", and how many reads went out before it opened.
  const sheet = { timing: false, opened: false, readsBefore: 0, shown: [] as PlainWords[] };
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    sheet.shown.push(words);
    if (sheet.timing && !sheet.opened) ((sheet.opened = true), (sheet.readsBefore = n.net.starts.length));
    void core.call("approval.answer", { id, approve: !sheet.timing });
  });
  return { core, sheet };
}

async function ready() {
  const fake = new FakeChain();
  fake.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  const n = network(fake);
  const vault = new MemoryVault();
  const { core, sheet } = newCore(fake, n, vault);
  const { accountId } = ok(await core.call<{ accountId: string }>("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  return { fake, n, core, sheet, words, accountId, vault };
}

/**
 * Round trips from the call to its sheet (the sheet answers "no"), on the slow network: reads in waves, a wave being the
 * reads that went out before the ones already on the wire had answered. Counted on the network's clock (each read's start
 * there): reads asked with no answer between them share a start, so the test machine's own speed (the core's checks,
 * signing words, a key from new words) never changes the count.
 */
async function rounds(n: ReturnType<typeof network>, sheet: { timing: boolean; opened: boolean; readsBefore: number }, ask: () => Promise<unknown>): Promise<number> {
  n.reset();
  n.net.slow = true;
  sheet.timing = true;
  sheet.opened = false;
  sheet.readsBefore = 0;
  try {
    await ask();
  } finally {
    n.net.slow = false;
    sheet.timing = false;
  }
  assert.ok(sheet.opened, "the sheet opened");
  const waves = new Set(n.net.starts.slice(0, sheet.readsBefore)).size;
  if (process.env.SHEET_ROUNDS_TRACE) console.log(`sheet: ${waves} round trips`);
  return waves;
}

const pay = (yocto: string) => ({ request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto }], why: "", from: "wallet" } });
const realNow = Date.now;

test("Protection's Save, Send, a held change's Cancel and Finish, new words and Export reach their sheet within their round trips", async () => {
  const { fake, n, core, sheet } = await ready();
  try {
    const save = await rounds(n, sheet, () => core.call("account.protection.set", { bands: [{ upToUsd: 20, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 3600 }] }));
    assert.ok(save <= SHEET_ROUNDS.protectionSave, `Save these rules waits ${save} round trips for its sheet (budget ${SHEET_ROUNDS.protectionSave})`);
    assert.match(sheet.shown.at(-1)!.title, /protection|rules/i);

    const send = await rounds(n, sheet, () => core.call("tx.request", pay(`1${NEAR}`)));
    assert.ok(send <= SHEET_ROUNDS.send, `Send waits ${send} round trips for its sheet (budget ${SHEET_ROUNDS.send})`);

    // A payment the rules hold (over 5 NEAR waits 2 minutes): its Cancel, then another's Finish once its wait is over.
    const held = ok(await core.call<TxOutcome & { id: string }>("tx.request", pay(`6${NEAR}`)));
    assert.equal(held.status, "waiting");
    const cancel = await rounds(n, sheet, () => core.call("account.waiting.cancel", { id: held.id }));
    assert.ok(cancel <= SHEET_ROUNDS.heldCancel, `Cancel waits ${cancel} round trips for its sheet (budget ${SHEET_ROUNDS.heldCancel})`);
    assert.match(sheet.shown.at(-1)!.title, /^Cancel: /);
    fake.skewSeconds = 121;
    Date.now = () => realNow() + 121_000;
    const finish = await rounds(n, sheet, () => core.call("account.waiting.run", { id: held.id }));
    assert.ok(finish <= SHEET_ROUNDS.heldFinish, `Finish waits ${finish} round trips for its sheet (budget ${SHEET_ROUNDS.heldFinish})`);
    assert.match(sheet.shown.at(-1)!.title, /^Send it now: /);

    // New words: the words come first (no sheet), then three are checked and the sheet replaces the backup key.
    const { words } = ok(await core.call<{ words: string[] }>("recovery.renew"));
    const newWords = await rounds(n, sheet, () => core.call("recovery.renewConfirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
    assert.ok(newWords <= SHEET_ROUNDS.newWords, `New words wait ${newWords} round trips for their sheet (budget ${SHEET_ROUNDS.newWords})`);
    assert.equal(sheet.shown.at(-1)!.title, "Replace your backup words");

    // Export: a Spending wallet's key, behind its own sheet. Nothing to read on the chain.
    const created = ok(await core.call<{ id: string }>("subwallet.create", { kind: "trade", chain: "sol" }));
    const exported = await rounds(n, sheet, () => core.call("subwallet.export", { id: created.id }));
    assert.ok(exported <= SHEET_ROUNDS.exportKey, `Export waits ${exported} round trips for its sheet (budget ${SHEET_ROUNDS.exportKey})`);
  } finally {
    Date.now = realNow;
    core.close();
  }
});

test("restore: the start and the finish reach their sheet within their round trips", async () => {
  const { fake, n, core: oldPhone, words } = await ready();
  const { core: newPhone, sheet } = newCore(fake, n);
  try {
    const start = await rounds(n, sheet, () => newPhone.call("recovery.start", { words }));
    assert.ok(start <= SHEET_ROUNDS.restoreStart, `the restore's start waits ${start} round trips for its sheet (budget ${SHEET_ROUNDS.restoreStart})`);
    assert.equal(sheet.shown.at(-1)!.title, "Start moving your account to this device");
    ok(await newPhone.call("recovery.start", { words }));
    fake.skewSeconds = 61;
    Date.now = () => realNow() + 61_000;
    const finish = await rounds(n, sheet, () => newPhone.call("recovery.finish"));
    assert.ok(finish <= SHEET_ROUNDS.restoreFinish, `the restore's finish waits ${finish} round trips for its sheet (budget ${SHEET_ROUNDS.restoreFinish})`);
  } finally {
    Date.now = realNow;
    oldPhone.close();
    newPhone.close();
  }
});

test("G18: the first Send sheet doesn't wait for a slow read of the account's record of sends; every sheet shares one read", async () => {
  // Grade 02g: 4.97 s to the first Send sheet at 4x CPU (1.85 s after): each sheet waited up to 3 s for its own read of
  // the account's past sends. Here that read doesn't answer at all until the sheets are shown: each Send's sheet must come
  // while it is still out (3 Nov: a stopwatch here failed under the full suite's load; the order is what is meant).
  const fake = new FakeChain();
  fake.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  let reads = 0;
  let recordOut = true;
  const held: (() => void)[] = [];
  const answerRecord = () => ((recordOut = false), held.splice(0).forEach((go) => go()));
  const slowPast = new Proxy(fake, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k === "pastTransactions") return (...args: unknown[]) => (reads++, recordOut ? new Promise((res) => held.push(() => res((v as Function).apply(t, args)))) : Promise.resolve((v as Function).apply(t, args)));
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const core = new DemoCore({ chain: slowPast as unknown as FakeChain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => fake.fund(id, pk), prices: async () => ({ near: 4 }), protection: HOLD_ABOVE_5_NEAR, watchIntervalMs: 60_000, indexRetryMs: 1 });
  const shown: PlainWords[] = [];
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
    shown.push(words);
    void core.call("approval.answer", { id, approve: shown.length <= 1 });
  });
  try {
    ok(await core.call("account.create"));
    const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
    ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
    for (const n of [1, 2]) {
      // the record read never answers before answerRecord(): a Send that waited for it would never come back (the guard
      // only turns that hang into a failure, it measures nothing)
      const came = await Promise.race([core.call("tx.request", pay(`1${NEAR}`)).then(() => "sheet"), new Promise((r) => setTimeout(() => r("waited"), 30_000).unref())]);
      assert.equal(came, "sheet", `Send ${n}'s sheet came while the record read was still out (it must not wait for it)`);
      assert.equal(recordOut, true);
    }
    assert.equal(shown.length, 2, "both sheets shown, the record still unread");
    assert.match(shown[0]!.warnings.map((w) => w.text).join(" "), /from this device/, "first sheet, not read yet: the warning says 'from this device', which is true");
    assert.ok(reads <= 1, `one shared read of the record, not one per sheet (${reads})`);
  } finally {
    answerRecord();
    core.close();
  }
});
