// Settings' recovery phrase and key export on the web wallet: the password goes to the core, and only 24 words or a key
// come back; a wrong password says so, anything else says it didn't open (never the core's code).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { WEB_WORDS as W } from "@zerofee/shell-api/web-wallet-words.ts";
import { readFileSync } from "node:fs";
import { CLIPBOARD_FORGET_MS, SECRET_SHOWN_MS, forgetCopied, readSecret } from "./web-secret.ts";
import { holdCopied, wipeCopiedNow } from "./copied-secret.ts";

const words = Array.from({ length: 24 }, (_, i) => `w${i}`);
const bridge = (answer: (m: string, p: unknown) => unknown, seen: unknown[] = []) => ({ call: async (m: string, p: unknown) => { seen.push([m, p]); return answer(m, p); } }) as unknown as Bridge;

test("readSecret: the words with the password; a key for one wallet; each method called with exactly what it needs", async () => {
  const seen: unknown[] = [];
  const b = bridge((m) => (m === "account.web.showWords" ? { ok: { words } } : { ok: { key: "ed25519:abc" } }), seen);
  assert.deepEqual(await readSecret(b, { k: "words" }, "pw"), { words });
  assert.deepEqual(await readSecret(b, { k: "key", wallet: "near", name: "NEAR" }, "pw"), { key: "ed25519:abc" });
  assert.deepEqual(seen, [["account.web.showWords", { password: "pw" }], ["account.web.exportKey", { wallet: "near", password: "pw" }]]);
});

test("readSecret: a wrong password says so; any other refusal, a short list or a throw says it didn't open", async () => {
  assert.deepEqual(await readSecret(bridge(() => ({ problem: { code: "security.web.password" } })), { k: "words" }, "x"), { why: W.wrongPassword });
  assert.deepEqual(await readSecret(bridge(() => ({ problem: { code: "security.web.no-safe" } })), { k: "words" }, "x"), { why: W.failed });
  assert.deepEqual(await readSecret(bridge(() => ({ problem: { code: "security.web.wait", whatHappened: "Too many tries. Try again in 30 seconds." } })), { k: "words" }, "x"), { why: "Too many tries. Try again in 30 seconds." }, "a wait says how long");
  assert.deepEqual(await readSecret(bridge(() => ({ problem: { code: "security.web.wait" } })), { k: "words" }, "x"), { why: W.failed }, "control: no line, the plain one");
  assert.deepEqual(await readSecret(bridge(() => ({ ok: { words: words.slice(1) } })), { k: "words" }, "x"), { why: W.failed }, "23 words is never shown");
  assert.deepEqual(await readSecret(bridge(() => ({ ok: { key: "" } })), { k: "key", wallet: "sol", name: "SOL" }, "x"), { why: W.failed });
  assert.deepEqual(await readSecret(bridge(() => { throw new Error("down"); }), { k: "words" }, "x"), { why: W.failed });
});

test("a copied key leaves the clipboard about 30 s later, only if it is still there (QA); never before then", async () => {
  const run = async (o: { ours: boolean; now: string | null }) => {
    const timers: { ms: number; go: () => Promise<void> }[] = [];
    const wrote: string[] = [];
    forgetCopied("KEY", (go, ms) => { timers.push({ go, ms }); }, async (t) => { wrote.push(t); }, async () => o.now, () => o.ours);
    assert.deepEqual(wrote, [], "control: still there until the timer");
    assert.equal(timers.length, 1);
    assert.equal(timers[0]!.ms, CLIPBOARD_FORGET_MS);
    await timers[0]!.go();
    return wrote;
  };
  assert.equal(CLIPBOARD_FORGET_MS, 30_000);
  assert.deepEqual(await run({ ours: true, now: "KEY" }), [""], "still the key: wiped");
  assert.deepEqual(await run({ ours: true, now: null }), [""], "can't read it (no permission), nothing copied here since: wiped");
  assert.deepEqual(await run({ ours: true, now: "something else" }), [], "the person copied something else: left alone");
  assert.deepEqual(await run({ ours: false, now: null }), [], "a copy in the app since: left alone");
});

test("the words and a key hide by themselves after about 60 s, and a translator never rewrites them", () => {
  assert.equal(SECRET_SHOWN_MS, 60_000);
  const rows = readFileSync(new URL("./WebWalletRows.tsx", import.meta.url), "utf8");
  assert.match(rows, /setTimeout\(\(\) => setGot\(null\), SECRET_SHOWN_MS\)/);
  assert.match(rows, /<ol className="set__words" translate="no"/);
  assert.match(rows, /<p className="set__key" translate="no"/);
  assert.match(rows, /forgetCopied\(/, "Copy clears the clipboard later");
});

// ── QA (4 Nov): the 30 s wipe is a page timer, so Lock, the idle lock and the page going run it first ──
/** A page with pagehide listeners, run by hand. */
const page = () => {
  const fns = new Set<() => void>();
  return { addEventListener: (_t: "pagehide", f: () => void) => void fns.add(f), removeEventListener: (_t: "pagehide", f: () => void) => void fns.delete(f), hide: () => { for (const f of [...fns]) f(); }, fns };
};

test("Lock (and the idle lock) wipes a copied key before the reload, with the same check, and only once", async () => {
  const wrote: string[] = [];
  const timers: (() => Promise<void>)[] = [];
  const p = page();
  forgetCopied("KEY", (go) => void timers.push(go), async (t) => { wrote.push(t); }, async () => "KEY", () => true, (w) => holdCopied(w, p));
  assert.deepEqual(wrote, [], "control: nothing before Lock");
  await wipeCopiedNow();
  assert.deepEqual(wrote, [""], "Lock: wiped");
  await timers[0]!();
  p.hide();
  await wipeCopiedNow();
  assert.deepEqual(wrote, [""], "the timer, the page going and a second Lock don't wipe again (the person may have copied since)");
  assert.equal(p.fns.size, 0, "the page listener goes once it ran");
});

test("closing the tab (pagehide) wipes a copied key that is still there; another copy since is left alone", async () => {
  const run = async (now: string) => {
    const wrote: string[] = [];
    const p = page();
    forgetCopied("KEY", () => {}, async (t) => { wrote.push(t); }, async () => now, () => true, (w) => holdCopied(w, p));
    assert.equal(p.fns.size, 1, "held until the page goes");
    p.hide();
    await new Promise((r) => setTimeout(r, 0));
    return wrote;
  };
  assert.deepEqual(await run("KEY"), [""]);
  assert.deepEqual(await run("something else"), [], "control: the person copied something else: left alone");
  await wipeCopiedNow();
});

test("nothing copied: Lock has nothing to wipe; Lock, the idle lock and Copy are wired; the line next to Copy is the Copywriter's", async () => {
  await wipeCopiedNow(); // nothing held: resolves, writes nothing
  const gate = readFileSync(new URL("../unlock/UnlockGate.tsx", import.meta.url), "utf8");
  assert.match(gate, /export function lockNow\(\): void \{\n\s+vaultSession\.lock\(\);\n(.*\n)*?\s+void Promise\.race\(\[wipeCopiedNow\(\), /);
  assert.doesNotMatch(gate, /const lockNow = \(\) => \{/, "the idle lock is the same lockNow, never a reload without the wipe");
  assert.equal(W.copyAfter, "After you paste the key, copy something else over it.");
  const rows = readFileSync(new URL("./WebWalletRows.tsx", import.meta.url), "utf8");
  assert.match(rows, /\{copied \? W\.copied : W\.copy\}<\/button>\n\s+<p className="zf-small set__fn" data-testid="web-key-clear">\{W\.copyAfter\}<\/p>/);
});
