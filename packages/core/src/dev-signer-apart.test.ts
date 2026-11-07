// Separate steps on ONE sheet, ONE Face ID (TxRequest.apart: an account that can't chain them; the audit's c and C1-C5, 7 Nov).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { SoftwareKey, type SheetSetRequest } from "./device-key.ts";
import { APART_FROM, DevSigner, strictest } from "./dev-signer.ts";
import type { PlainWords, Requester, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const NEAR = 10n ** 24n;

/** The phone's chip key, as the core sees it: one sheet per tx (signOnSheet) and one sheet for a set (signSetOnSheet). */
function chipKey(answer: "sign" | "not-now" | "short" = "sign") {
  const inner = SoftwareKey.generate();
  const sets: SheetSetRequest[] = [];
  const singles: unknown[] = [];
  const key = {
    publicKey: inner.publicKey,
    signHash: async (): Promise<Uint8Array> => assert.fail("a key with its own sheet is never asked for a bare hash"),
    signOnSheet: async (r: { bytes: Uint8Array }) => (singles.push(r), inner.signHash(sha256(r.bytes))),
    signSetOnSheet: async (r: SheetSetRequest) => {
      sets.push(r);
      if (answer === "not-now") return null;
      const sigs = await Promise.all(r.txs.map((t) => inner.signHash(sha256(t.bytes))));
      return answer === "short" ? sigs.slice(0, 1) : sigs;
    },
  };
  return { key, sets, singles };
}

/** A store standing in for the core's sealed vault (the fence's note), shared across "restarts". */
function store() {
  let value: string | null = null;
  const writes: string[] = [];
  return { writes, get: async () => value, put: async (v: string) => void (writes.push(v), (value = v)) };
}

/** `mark`: the fence's sealed store (default: a fresh one, as the core's own signer has); null: a signer with none. */
function setup(o: { answer?: boolean; key?: ReturnType<typeof chipKey>["key"]; mark?: ReturnType<typeof store> | null } = {}) {
  const mark = o.mark === undefined ? store() : o.mark;
  const chain = new FakeChain();
  const key = o.key ?? SoftwareKey.generate();
  chain.fund("alice.testnet", key.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  chain.fund("carol.testnet", SoftwareKey.generate().publicKey);
  const shown: PlainWords[] = [];
  let signed = 0;
  const make = () => new DevSigner({ accountId: "alice.testnet", chain, key, approve: async (w) => (shown.push(w), o.answer ?? true), onSigned: () => signed++, ...(mark ? { nonceMark: mark } : {}) });
  return { chain, key, shown, make, signer: make(), signedCount: () => signed, mark };
}

const steps = (from: Requester = "wallet", n = 2): TxRequest => ({
  receiverId: "bob.testnet",
  actions: [{ kind: "transfer", yocto: String(NEAR) }],
  then: Array.from({ length: n - 1 }, (_x, i) => ({ receiverId: i % 2 ? "bob.testnet" : "carol.testnet", actions: [{ kind: "transfer" as const, yocto: String(2n * NEAR) }] })),
  why: "Move it",
  from,
  apart: true,
});
const plain = (): TxRequest => ({ receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "pay", from: "wallet" });

test("an account that can't chain: two steps, ONE sheet naming both, ONE signSet with both txs, nonces n+1 and n+2 sent in that order", async () => {
  const chip = chipKey();
  const { chain, shown, signer, signedCount } = setup({ key: chip.key });
  const out = await signer.request(steps());
  assert.equal(out.status, "done");
  assert.equal(shown.length, 1, "one sheet");
  assert.equal(chip.sets.length, 1, "one signSet, so one Face ID");
  assert.equal(chip.sets[0]!.txs.length, 2);
  assert.equal(chip.singles.length, 0, "never one sheet per step");
  assert.deepEqual(chip.sets[0]!.txs.map((t) => t.summary.receiver), ["bob.testnet", "carol.testnet"], "each tx with its own summary, for Swift's own decode");
  assert.match(shown[0]!.title, /bob\.testnet.*then.*carol\.testnet/, "the one sheet names every step");
  assert.ok(shown[0]!.lines.includes("Each step happens only if the one before it worked."));
  assert.deepEqual(chain.sent.map((t) => [t.receiverId, t.nonce]), [["bob.testnet", 1n], ["carol.testnet", 2n]], "each step its own nonce, in order");
  assert.equal(signedCount(), 1, "job.signed once, after the last signature");
  assert.equal(out.status === "done" && out.explorerUrls?.length, 2, "both steps' links");
});

test("control: one tx is still one signOnSheet with nonce n+1, and a chained request (no apart) still needs the rules (unchanged)", async () => {
  const chip = chipKey();
  const { chain, signer } = setup({ key: chip.key });
  assert.equal((await signer.request(plain())).status, "done");
  assert.equal(chip.singles.length, 1);
  assert.equal(chip.sets.length, 0);
  assert.deepEqual(chain.sent.map((t) => t.nonce), [1n]);
  const { apart: _a, ...chained } = steps();
  const out = await signer.request(chained);
  assert.ok(out.status === "problem" && /version 2/.test(out.problem.more ?? ""), "a chain on an account with no rules is refused, as before");
});

test("Close on the sheet, or Not now on the phone's own sheet: nothing signed, nothing sent, no job", async () => {
  const closed = chipKey();
  const a = setup({ key: closed.key, answer: false });
  assert.deepEqual(await a.signer.request(steps()), { status: "declined" });
  assert.equal(a.shown.length, 1, "the one sheet was shown");
  assert.equal(closed.sets.length, 0, "Close: the chip is never asked");
  assert.equal(a.chain.sent.length, 0);
  assert.equal(a.signedCount(), 0);
  const notNow = chipKey("not-now");
  const b = setup({ key: notNow.key });
  assert.deepEqual(await b.signer.request(steps()), { status: "declined" });
  assert.equal(b.chain.sent.length, 0);
  assert.equal(b.signedCount(), 0);
  // a short answer from the phone (fewer signatures than txs): none is used
  const short = chipKey("short");
  const c = setup({ key: short.key });
  const out = await c.signer.request(steps());
  assert.ok(out.status === "problem" && out.problem.code === "security.sign.invalid");
  assert.equal(c.chain.sent.length, 0);
});

test("more than 4 steps are refused before any sheet, never split", async () => {
  const chip = chipKey();
  const { chain, shown, signer } = setup({ key: chip.key });
  const out = await signer.request(steps("wallet", 5));
  assert.ok(out.status === "problem" && out.problem.code === "security.request.invalid");
  assert.equal(shown.length, 0);
  assert.equal(chip.sets.length + chip.singles.length, 0);
  assert.equal(chain.sent.length, 0);
  // control: 4 is one sheet
  assert.equal((await signer.request(steps("wallet", 4))).status, "done");
  assert.equal(chip.sets[0]!.txs.length, 4);
});

test("C3: only ZeroFee's own Safe screens may ask for steps apart; every other app is refused by name, never split", async () => {
  assert.deepEqual([...APART_FROM], ["wallet", "trade"]);
  for (const from of ["pay", "extension", "browser", "social", "agent", "earn", "chat", "security", undefined] as const) {
    const chip = chipKey();
    const { chain, shown, signer } = setup({ key: chip.key });
    const out = await signer.request({ ...steps(), from: from as Requester });
    assert.ok(out.status === "problem" && out.problem.code === "security.steps.not-allowed", String(from));
    assert.equal(out.status === "problem" && out.problem.whatHappened, "Only ZeroFee's own screens can ask for steps together, so ZeroFee stopped this. Your money hasn't moved.", String(from));
    assert.deepEqual(out.status === "problem" && out.problem.next, { kind: "nothing", label: "Close" }, String(from));
    assert.equal(shown.length + chip.sets.length + chip.singles.length + chain.sent.length, 0, `${String(from)}: no sheet, nothing signed or sent`);
  }
  // control: Trade's own Safe screen
  const chip = chipKey();
  assert.equal((await setup({ key: chip.key }).signer.request(steps("trade"))).status, "done");
});

test("a phone key that can't sign a set (no signSetOnSheet) refuses steps apart before the sheet, never splits them", async () => {
  const chip = chipKey();
  const { signSetOnSheet: _gone, ...older } = chip.key;
  const { chain, shown, signer } = setup({ key: older as typeof chip.key });
  const out = await signer.request(steps());
  assert.ok(out.status === "problem" && out.problem.code === "security.steps.not-together");
  assert.equal(shown.length + chip.singles.length + chain.sent.length, 0);
});

test("C4: step 1 sent but a receipt in it failed (partly) or it failed outright: step 2's bytes never leave the core", async () => {
  for (const how of ["partly", "failed"] as const) {
    const { chain, signer } = setup();
    if (how === "partly") chain.failLater = true;
    else {
      const real = chain.send.bind(chain);
      let n = 0;
      chain.send = async (...a: Parameters<FakeChain["send"]>) => { const r = await real(...a); return n++ === 0 ? { ...r, status: "failed" as const } : r; };
    }
    const out = await signer.request(steps());
    assert.ok(out.status === "problem" && out.problem.code === (how === "partly" ? "security.send.partly" : "security.send.failed"), how);
    assert.deepEqual(chain.sent.map((t) => t.receiverId), ["bob.testnet"], `${how}: only step 1 went`);
  }
});

test("step 2 fails after step 1 went: the outcome is step 2's own problem, step 1 sent once", async () => {
  const { chain, signer } = setup();
  const real = chain.send.bind(chain);
  let n = 0;
  chain.send = async (...a: Parameters<FakeChain["send"]>) => { const r = await real(...a); return n++ === 1 ? { ...r, status: "failed" as const } : r; };
  const out = await signer.request(steps());
  assert.ok(out.status === "problem" && out.problem.code === "security.send.failed");
  assert.deepEqual(chain.sent.map((t) => [t.receiverId, t.nonce]), [["bob.testnet", 1n], ["carol.testnet", 2n]]);
});

test("C2: step 1 held by the account's rules: waiting, the rest dropped (unsent 1), nothing after it sent", async () => {
  const { chain, signer } = setup();
  const real = chain.send.bind(chain);
  const waiting = btoa(JSON.stringify({ done: false, id: 7, ready_at_ns: "1000000000", needs_device: false }));
  chain.send = async (...a: Parameters<FakeChain["send"]>) => ({ ...(await real(...a)), value: waiting });
  const out = await signer.request(steps());
  assert.ok(out.status === "waiting" && out.unsent === 1 && out.id === "7");
  assert.equal(chain.sent.length, 1);
});

test("C1 fence: step 1 fails, so step 2 (n+2) was signed and never sent; the next action signs n+3, also after a restart", async () => {
  const mark = store();
  const { chain, make, signer } = setup({ mark });
  const real = chain.send.bind(chain);
  let n = 0;
  chain.send = async (...a: Parameters<FakeChain["send"]>) => { const r = await real(...a); return n++ === 0 ? { ...r, status: "failed" as const } : r; };
  assert.equal((await signer.request(steps())).status, "problem");
  assert.deepEqual(chain.sent.map((t) => t.nonce), [1n], "only step 1 went; the chain's nonce is 1");
  assert.ok(mark.writes.length >= 1, "the fence was kept before signing");
  assert.equal((await signer.request(plain())).status, "done");
  assert.equal(chain.sent.at(-1)!.nonce, 3n, "above the dropped step 2 (n+2), so it can never land later");
  // a restart: a new signer, the same sealed store
  assert.equal((await make().request(plain())).status, "done");
  assert.equal(chain.sent.at(-1)!.nonce, 4n);
});

test("C1 fence after a restart with nothing in memory: the kept note alone lifts the nonce", async () => {
  const mark = store();
  const first = setup({ mark });
  const real = first.chain.send.bind(first.chain);
  let n = 0;
  first.chain.send = async (...a: Parameters<FakeChain["send"]>) => { const r = await real(...a); return n++ === 0 ? { ...r, status: "failed" as const } : r; };
  await first.signer.request(steps("wallet", 3));
  const restarted = first.make();
  assert.equal((await restarted.request(plain())).status, "done");
  assert.equal(first.chain.sent.at(-1)!.nonce, 4n, "steps n+1..n+3 signed, only n+1 sent: the next is n+4");
});

test("control: a normal action signs n+1, and a store that can't be kept stops before signing", async () => {
  const mark = store();
  const { chain, signer } = setup({ mark });
  assert.equal((await signer.request(plain())).status, "done");
  assert.deepEqual(chain.sent.map((t) => t.nonce), [1n]);
  assert.equal((await signer.request(plain())).status, "done");
  assert.deepEqual(chain.sent.map((t) => t.nonce), [1n, 2n]);
  const broken = setup({ mark: { get: async () => null, put: async () => { throw new Error("vault down"); }, writes: [] } as ReturnType<typeof store> });
  assert.equal((await broken.signer.request(plain())).status, "done", "one tx writes no note, so a broken store never stops it (MUST 1)");
  const out = await broken.signer.request(steps());
  assert.ok(out.status === "problem" && out.problem.code === "security.sign.not-kept");
  assert.equal(broken.chain.sent.length, 1, "only the single tx went; the set signed nothing");
});

test("a note kept for another key is ignored", async () => {
  const mark = store();
  await mark.put(JSON.stringify({ key: "someone-else", nonce: "99" }));
  const { chain, signer } = setup({ mark });
  assert.equal((await signer.request(plain())).status, "done");
  assert.deepEqual(chain.sent.map((t) => t.nonce), [1n]);
});

test("strictest: the sheet says the strictest step's protection (table)", () => {
  const w = (s: string) => ({ Wait: { seconds: s } });
  const b = (s: string) => ({ Both: { seconds: s } });
  const table: [Parameters<typeof strictest>[0], ReturnType<typeof strictest>][] = [
    [["FaceId", "FaceId"], "FaceId"],
    [["FaceId", "Device"], "Device"],
    [["Device", w("60")], w("60")],
    [[w("60"), w("86400")], w("86400")],
    [[w("86400"), b("60")], b("60")],
    [[b("60"), "FaceId"], b("60")],
  ];
  for (const [levels, want] of table) assert.deepEqual(strictest(levels), want, JSON.stringify(levels));
});

test("setSignatures: the phone's answer to a set, checked before use (table: Not now, one per tx, each over its own bytes, the pair echoed)", async () => {
  const { setSignatures } = await import("./device-key.ts");
  const k = SoftwareKey.generate();
  const txs = [{ bytes: new Uint8Array([1, 2]) }, { bytes: new Uint8Array([3]) }];
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  const good = await Promise.all(txs.map(async (t) => b64(await k.signHash(sha256(t.bytes)))));
  const swapped = [good[1]!, good[0]!];
  const pair = "ab".repeat(32);
  assert.equal(setSignatures(txs, { declined: true }, k.publicKey), null, "Not now");
  assert.equal(setSignatures(txs, { signatures: good }, k.publicKey)!.length, 2, "control: one valid signature per tx");
  assert.equal(setSignatures(txs, { signatures: good, pairHash: pair }, k.publicKey, pair)!.length, 2, "control: the pair echoed");
  for (const [name, answer, ph] of [["one short", { signatures: good.slice(0, 1) }, undefined], ["one extra", { signatures: [...good, good[0]] }, undefined], ["swapped", { signatures: swapped }, undefined], ["not text", { signatures: [1, 2] }, undefined], ["pair changed", { signatures: good, pairHash: "cd".repeat(32) }, pair], ["pair missing", { signatures: good }, pair]] as const) {
    assert.throws(() => setSignatures(txs, answer as never, k.publicKey, ph), Error, name);
  }
});

test("MUST 1: a single Safe signature writes no fence note; a 2-step set writes its last nonce before any signature", async () => {
  const order: string[] = [];
  const mark = store();
  const put = mark.put;
  mark.put = async (v: string) => (order.push(`put ${JSON.parse(v).nonce}`), put(v));
  const chip = chipKey();
  const signSet = chip.key.signSetOnSheet;
  chip.key.signSetOnSheet = async (r) => (order.push("sign"), signSet(r));
  const { signer } = setup({ key: chip.key, mark });
  assert.equal((await signer.request(plain())).status, "done");
  assert.deepEqual(mark.writes, [], "one tx: no note (dropped, the next request signs the same nonce and kills it)");
  assert.equal((await signer.request(steps())).status, "done");
  assert.deepEqual(order, ["put 3", "sign"], "the set's highest nonce (n+2 after the single at n+1) kept before the one Face ID");
});

test("MUST 2: a signer with no fence (the agent's, recovery's, the second device's) refuses a set by name before the sheet; one tx still signs", async () => {
  const chip = chipKey();
  const { chain, shown, signer } = setup({ key: chip.key, mark: null });
  const out = await signer.request(steps());
  assert.ok(out.status === "problem" && out.problem.whatHappened === "This phone can't approve these steps together yet, so nothing was signed. Your money hasn't moved.");
  assert.deepEqual(out.status === "problem" && out.problem.next, { kind: "nothing", label: "Close" });
  assert.equal(shown.length + chip.sets.length + chip.singles.length + chain.sent.length, 0, "no sheet, nothing signed or sent");
  assert.equal((await signer.request(plain())).status, "done", "control: one tx needs no fence");
});

test("MUST 1: hot trading wallets never sign through DevSigner, so the fence doesn't touch them; only these build one", async () => {
  const { readFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const root = new URL("../../../", import.meta.url);
  const built = execFileSync("git", ["grep", "-l", "new DevSigner(", "--", "packages", "apps", ":!*.test.*"], { cwd: root, encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(built, ["packages/core/src/agent-door.ts", "packages/core/src/agent-sign.ts", "packages/core/src/demo-core.ts", "packages/core/src/second-device.ts"]);
  for (const hot of ["packages/core/src/subwallets.ts", "packages/core/src/hot-keys.ts"]) assert.doesNotMatch(readFileSync(new URL(hot, root), "utf8"), /DevSigner|nonceMark/, hot);
  // only the core's own device signer has the fence (control: the other signers have none, so they refuse sets)
  const core = readFileSync(new URL("packages/core/src/demo-core.ts", root), "utf8");
  assert.equal((core.match(/nonceMark: \{/g) ?? []).length, 1);
});
