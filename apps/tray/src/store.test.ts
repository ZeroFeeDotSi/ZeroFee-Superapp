// The tray's Keychain items: `security` by execFile with an args array, and the secret never in any argv (only on stdin).
// Recorded runs here; the real Keychain only in the opt-in test below (ZF_KEYCHAIN_TEST=1 on a Mac), with its own items.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decodeHeld, decodeSpent, encodeHeld, encodeSpent, execRun, keychainStore, SERVICE, stopHashOf, type Held, type Run } from "./store.ts";

const held = (): Held => ({ seed: new Uint8Array(randomBytes(32)), secret: new Uint8Array(randomBytes(64)), accountId: "a".repeat(56) + ".tg.near", stopHash: stopHashOf("apple river candle"), dayLimitUsd: 1000 });
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/** A recorded `security`: keeps what add-generic-password read from stdin (as its 128-character prompt does), answers find. */
function recorder({ cut = 128 } = {}) {
  const calls: { file: string; args: string[]; input?: string }[] = [];
  const kept = new Map<string, string>();
  const run: Run = async (file, args, input) => {
    calls.push({ file, args: [...args], ...(input !== undefined ? { input } : {}) });
    const key = `${args[args.indexOf("-s") + 1]}/${args[args.indexOf("-a") + 1]}`;
    if (args[0] === "add-generic-password") {
      const [a, b] = (input ?? "").split("\n");
      if (a !== b) return { code: 1, stdout: "" };
      kept.set(key, a!.slice(0, cut));
      return { code: 0, stdout: "" };
    }
    if (args[0] === "find-generic-password") return kept.has(key) ? { code: 0, stdout: `${kept.get(key)}\n` } : { code: 44, stdout: "" };
    if (args[0] === "delete-generic-password") return kept.delete(key) ? { code: 0, stdout: "" } : { code: 44, stdout: "" };
    return { code: 1, stdout: "" };
  };
  return { run, calls, kept };
}

test("save, load, remove through /usr/bin/security; the seed and the secret only ever on stdin, never in argv", async () => {
  const r = recorder();
  const store = keychainStore({ run: r.run });
  const h = held();
  await store.save(h);
  assert.equal(r.kept.size, 4, "three pairing items and the day count");
  const back = (await store.load())!;
  assert.deepEqual([...back.seed], [...h.seed]);
  assert.deepEqual([...back.secret], [...h.secret]);
  assert.equal(back.accountId, h.accountId);
  assert.equal(back.stopHash, h.stopHash);
  assert.equal(back.dayLimitUsd, 1000);
  assert.deepEqual(await store.spent(), [], "a new pairing starts a new count");
  const at = Date.parse("2026-11-03T10:00:00Z");
  assert.equal(await store.setSpent([{ atMs: at, cents: 250 }, { atMs: at + 90_000, cents: 499 }]), true);
  assert.deepEqual(await store.spent(), [{ atMs: at, cents: 250 }, { atMs: at + 120_000, cents: 499 }], "to the minute, rounded up");
  assert.equal(await store.remove(), true);
  assert.equal(await store.load(), null);
  assert.equal(r.kept.size, 0, "the count goes too");
  const secrets = [hex(h.seed), hex(h.secret), b64u(h.seed), b64u(h.secret), ...Object.values(encodeHeld(h)), (250).toString(36), (499).toString(36)];
  for (const c of r.calls) {
    assert.equal(c.file, "/usr/bin/security");
    const argv = c.args.join(" ");
    for (const s of secrets) assert.ok(!argv.includes(s), `${c.args[0]}: nothing secret in argv`);
    assert.ok(c.args.includes(SERVICE));
  }
  const adds = r.calls.filter((c) => c.args[0] === "add-generic-password");
  assert.equal(adds.length, 5, "four items at pairing (seed, secret, account, day limit), one count");
  for (const add of adds) {
    assert.equal(add.args.at(-1), "-w", "-w last with no value: read from stdin");
    assert.ok(add.args.includes("-U"));
    const [v, again] = add.input!.split("\n");
    assert.equal(v, again, "the value and its retype, on stdin");
    assert.ok(v!.length <= 120, "each item fits the 128-character prompt");
  }
});

test("a Keychain that cut or didn't keep an item: an error, and nothing half kept", async () => {
  const cut = recorder({ cut: 40 });
  await assert.rejects(keychainStore({ run: cut.run }).save(held()), /didn't keep it/);
  assert.equal(cut.kept.size, 0, "what it kept is taken back");
  await assert.rejects(keychainStore({ run: async () => ({ code: 0, stdout: "" }) }).save(held()), /didn't keep it/);
});

test("only well-formed items are read back", () => {
  const h = held();
  const v = encodeHeld(h);
  assert.ok(decodeHeld(v));
  assert.equal(decodeHeld({ ...v, "agentzero-seed": null }), null);
  assert.equal(decodeHeld({ ...v, "computer-secret": v["computer-secret"].slice(0, -1) }), null);
  assert.equal(decodeHeld({ ...v, account: v.account.replace("zf1.", "zf2.") }), null);
  assert.equal(decodeHeld({ ...v, account: v.account.replace(".tg.near", ".TG.near") }), null);
  assert.throws(() => encodeHeld({ ...h, secret: new Uint8Array(32) }), /not a pairing/);
  for (const dayLimitUsd of [0, 1001, 2.5, NaN]) assert.throws(() => encodeHeld({ ...h, dayLimitUsd }), /not a pairing/, String(dayLimitUsd));
  assert.equal(decodeHeld({ ...v, account: v.account.replace(/\.1000$/, ".0") }), null);
  assert.equal(decodeHeld({ ...v, account: v.account.replace(/\.1000$/, "") }), null, "no day limit, no pairing");
});

test("the day count: fits one item whatever the payments; past it the oldest merge later (stricter, never looser); junk is unreadable", () => {
  const t0 = Date.parse("2026-11-03T00:00:00Z");
  const many = Array.from({ length: 40 }, (_, i) => ({ atMs: t0 + i * 30 * 60_000, cents: 500 }));
  const text = encodeSpent(many);
  assert.ok(text.length <= 120);
  const back = decodeSpent(text)!;
  assert.equal(back.reduce((s, r) => s + r.cents, 0), 40 * 500, "every cent still counted");
  assert.deepEqual(back.at(-1), many.at(-1), "the newest kept as it is");
  assert.ok(back.every((r, i) => i === 0 || r.atMs >= back[i - 1]!.atMs));
  assert.ok(back[0]!.atMs >= many[0]!.atMs, "a merged one counts until the later time");
  assert.deepEqual(decodeSpent("zf1."), []);
  for (const junk of ["", "zf1.x", "zf1.ab~", "zf0.ab~1", "zf1.ab~1,"]) assert.equal(decodeSpent(junk), null, junk);
});

test("execRun: an args array, stdin piped in, no shell", async () => {
  const out = await execRun("/bin/cat", [], "line one\nline two\n");
  assert.deepEqual(out, { code: 0, stdout: "line one\nline two\n" });
  const shell = await execRun("/bin/echo", ["$HOME;", "`id`"]);
  assert.equal(shell.stdout, "$HOME; `id`\n", "arguments are never read by a shell");
});

test("the real Keychain (opt in: ZF_KEYCHAIN_TEST=1, a Mac): every item round trips by stdin, then is deleted", { skip: !(process.platform === "darwin" && process.env.ZF_KEYCHAIN_TEST === "1") }, async () => {
  const store = keychainStore({ service: `zerofee-tray-test-${process.pid}` });
  const h = held();
  try {
    await store.save(h);
    const back = (await store.load())!;
    assert.deepEqual(encodeHeld(back), encodeHeld(h));
    const at = Math.ceil(Date.now() / 60_000) * 60_000;
    assert.equal(await store.setSpent([{ atMs: at, cents: 500 }]), true);
    assert.deepEqual(await store.spent(), [{ atMs: at, cents: 500 }]);
  } finally {
    assert.equal(await store.remove(), true);
  }
  assert.equal(await store.load(), null);
});
