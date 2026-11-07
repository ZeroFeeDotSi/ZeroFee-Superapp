// the audit's MUST (7 Nov): just before the core hands a sheet to the key (the phone's chip: signOnSheet, signSetOnSheet), or
// shows its own (a key with no sheet: approve), it says approval.asked with the request's job key (TxRequest.job), so that
// job's row waits on the Face ID; the phone's chip sheet is never heard by the page. Once per sheet; never when the request
// is refused before a sheet, nor for a request with no job (or a malformed one). job.signed names the job too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { SoftwareKey, type SheetSetRequest } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import type { TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const NEAR = 10n ** 24n;
const JOB = "home-swap-0123456789abcdef01234567";

/** Everything in order: "asked:<job>", "approve" (the core's naming of the words), "sheet" / "set" (the chip's own sheet),
 *  "signed:<job>". */
function setup(o: { chip?: "single" | "set" | "single-only"; approve?: () => Promise<boolean> } = {}) {
  const log: string[] = [];
  const chain = new FakeChain();
  const inner = SoftwareKey.generate();
  const chip = o.chip
    ? {
        publicKey: inner.publicKey,
        signHash: async (): Promise<Uint8Array> => assert.fail("a key with its own sheet is never asked for a bare hash"),
        signOnSheet: async (r: { bytes: Uint8Array }) => (log.push("sheet"), inner.signHash(sha256(r.bytes))),
        ...(o.chip === "single-only" ? {} : { signSetOnSheet: async (r: SheetSetRequest) => (log.push("set"), Promise.all(r.txs.map((t) => inner.signHash(sha256(t.bytes))))) }),
      }
    : inner;
  chain.fund("alice.testnet", chip.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  chain.fund("carol.testnet", SoftwareKey.generate().publicKey);
  let mark: string | null = null;
  const signer = new DevSigner({
    accountId: "alice.testnet", chain, key: chip,
    approve: o.approve ?? (async () => (log.push("approve"), true)),
    onAsked: (j) => log.push(`asked:${j}`), onSigned: (j) => log.push(`signed:${j ?? ""}`),
    nonceMark: { get: async () => mark, put: async (v) => void (mark = v) },
  });
  return { log, signer, chain };
}
/** `job` null: a request that names no job. */
const one = (job: string | null = JOB): TxRequest => ({ receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: String(NEAR) }], why: "Move it", from: "wallet", ...(job !== null ? { job } : {}) });
const apart = (job: string | null = JOB): TxRequest => ({ ...one(job), then: [{ receiverId: "carol.testnet", actions: [{ kind: "transfer", yocto: String(NEAR) }] }], apart: true });

test("the phone's chip, one tx: approval.asked with the call's own job key just before signOnSheet, once; then job.signed names it", async () => {
  const { log, signer } = setup({ chip: "single" });
  assert.equal((await signer.request(one())).status, "done");
  assert.deepEqual(log, ["approve", `asked:${JOB}`, "sheet", `signed:${JOB}`]);
});

test("the phone's chip, separate steps (B3's apart): approval.asked with the key just before signSetOnSheet, once for the one sheet", async () => {
  const { log, signer } = setup({ chip: "set" });
  assert.equal((await signer.request(apart())).status, "done");
  assert.deepEqual(log, ["approve", `asked:${JOB}`, "set", `signed:${JOB}`]);
});

test("a key with no sheet of its own (the web's): approval.asked with the key just before approve shows the sheet", async () => {
  const { log, signer } = setup();
  assert.equal((await signer.request(one())).status, "done");
  assert.deepEqual(log, [`asked:${JOB}`, "approve", `signed:${JOB}`]);
});

test("refused before any sheet: no approval.asked (steps the chip can't sign together; a call ZeroFee never makes; a named refusal before the chip's sheet; a nonce that can't be kept)", async () => {
  // separate steps on a chip with no signSetOnSheet: refused before the sheet, never split
  const a = setup({ chip: "single-only" });
  const ra = await a.signer.request(apart());
  assert.ok(ra.status === "problem" && ra.problem.code === "security.steps.not-together", JSON.stringify(ra));
  assert.deepEqual(a.log, []);
  // a request the core refuses as it reads it
  const b = setup({ chip: "single" });
  const rb = await b.signer.request({ receiverId: "intents.near", actions: [{ kind: "call", method: "add_public_key", args: { public_key: "ed25519:x" }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet", job: JOB });
  assert.equal(rb.status, "problem");
  assert.deepEqual(b.log, []);
  // the core's naming of the words refused (a ProblemError), or said no, before the chip's own sheet: no sheet, no ask
  const c = setup({ chip: "single", approve: async () => false });
  assert.deepEqual(await c.signer.request(one()), { status: "declined" });
  assert.deepEqual(c.log, []);
  // control: the same request with a yes asks once
  const d = setup({ chip: "single" });
  await d.signer.request(one());
  assert.deepEqual(d.log.filter((x) => x.startsWith("asked:")), [`asked:${JOB}`]);
});

test("no job, or a malformed one: no approval.asked, the sheet as before; job.signed names none (control: a well formed key is said)", async () => {
  for (const job of [null, "short", "has spaces in it 0123456789", "x".repeat(65)]) {
    const { log, signer } = setup({ chip: "single" });
    assert.equal((await signer.request(one(job))).status, "done", String(job));
    assert.deepEqual(log, ["approve", "sheet", "signed:"], String(job));
  }
  const { log, signer } = setup({ chip: "single" });
  await signer.request(one("move-private-0123456789abcdef0123"));
  assert.ok(log.includes("asked:move-private-0123456789abcdef0123"));
});

test("the job key is a label only: the same request with and without it signs the same bytes", async () => {
  const a = setup({ chip: "single" });
  const b = setup({ chip: "single" });
  await a.signer.request(one());
  await b.signer.request(one(null));
  const strip = (t: { signerId: string; receiverId: string; nonce: bigint; actions: unknown }) => JSON.stringify({ r: t.receiverId, n: String(t.nonce), a: t.actions }, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Array.from(v) : v));
  assert.equal(a.chain.sent.length, 1);
  assert.equal(strip(a.chain.sent[0] as never), strip(b.chain.sent[0] as never));
});

test("wiring (a pin): the core says approval.asked with the job's key; the phone's core passes it to the page through Swift (core:<event>, no Swift change); the shell relays it to the jobs", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(read("./demo-core.ts"), /onAsked: \(job\) => this\.emit\("approval\.asked", \{ jobKey: job \}\)/);
  assert.match(read("./demo-core.ts"), /onSigned: \(job\) => this\.emit\("job\.signed", job \? \{ jobKey: job \} : \{\}\)/);
  assert.match(read("../../../apps/ios/core/entry.ts"), /const EVENTS = \[[^\]]*"approval\.asked"[^\]]*\]/);
  assert.match(read("../../../apps/web/src/shell/ApprovalSheet.tsx"), /bridge\.on<\{ jobKey\?: string \}>\("approval\.asked", \(p\) => approvalAsked\(p\?\.jobKey\)\)/);
});
