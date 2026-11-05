// The test flight recorder (flight.ts, flight-tap.ts, flight-seal.ts): what a sealed batch holds, and never holds.
// Hermetic: the relay is a captured `post`, the reader's key is made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Bridge } from "@zerofee/core/bridge";
import { flightBridge, setFlightSink } from "./flight-tap.ts";
import { QUEUE_MAX, callEvent, createRecorder, errorOf, firstFrame, scrub, tapOf, type FlightEvent } from "./flight.ts";
import { openBatch, readerKey, readerKeys, sealBatch } from "./flight-seal.ts";

const ID = "0123456789abcdef0123456789abcdef";
// twelve backup-list words, built at run time (never twelve in a row in the source: the leak guard)
const PHRASE = ["abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse", "access", "accident"].join(" ");
const SECRETS = {
  phrase: PHRASE,
  privateKey: "ed25519:5Jq1x9QwErTyUiOpAsDfGhJkLzXcVbNm1234567890abcdefGHIJ",
  to: "0x7D06e272b5305a4b9D40e872C7950D3437547e3D",
  account: "owner-secret.near",
  token: "sk-ant-api03-XyZzY1234567890abcdefghijklmnop",
  amount: "987654.321",
};

function rig(now = () => 1_700_000_000_000) {
  const { secret, publicKey } = readerKeys();
  const posts: { url: string; body: string; final: boolean }[] = [];
  const rec = createRecorder({ reader: readerKey(publicKey)!, id: ID, url: `https://relay.example/v0/trace/${ID}`, source: "phone", post: async (url, body, final) => (posts.push({ url, body, final }), 201), now });
  const opened = () => posts.map((p) => openBatch(p.body, secret, ID));
  return { rec, posts, opened, secret };
}

test("a call's secret params and result never reach the sealed batch: only its method, ms and outcome do", async () => {
  const { rec, posts, opened } = rig();
  const inner: Bridge = {
    call: async (method) =>
      method === "account.send"
        ? ({ ok: { phrase: PHRASE, key: SECRETS.privateKey } } as never)
        : ({ problem: { code: "security.request.notAllowed", whatHappened: `AgentZero can't pay ${SECRETS.to} from ${SECRETS.account}.`, money: { state: "safe" }, next: { kind: "nothing", label: "Go back" } } } as never),
    on: () => () => {},
  };
  setFlightSink((n) => rec.push(callEvent(n, 1)));
  try {
    const b = flightBridge(inner);
    const ok = await b.call("account.send", { ...SECRETS, words: PHRASE.split(" "), clipboard: SECRETS.token });
    assert.deepEqual(ok, { ok: { phrase: PHRASE, key: SECRETS.privateKey } }, "the app still gets its answer, untouched");
    const refused = await b.call("account.agent.wallet", { ...SECRETS });
    assert.ok("problem" in refused);
  } finally {
    setFlightSink(null);
  }
  rec.flush(true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.url, `https://relay.example/v0/trace/${ID}`);
  const plain = opened()[0]!;
  assert.ok(plain, "the reader opens it");
  for (const [name, s] of Object.entries({ ...SECRETS, firstWord: "abandon ability", keyTail: "5Jq1x9QwErTy", addrTail: "52908400098527886" })) assert.ok(!plain.includes(s), `${name} is not in the plaintext`);
  // controls: what it is for is there
  const { src, ev } = JSON.parse(plain) as { src: string; ev: FlightEvent[] };
  assert.equal(src, "phone");
  assert.deepEqual(ev.map((e) => e.k === "call" && e.m), ["account.send", "account.agent.wallet"]);
  const p = ev[1] as Extract<FlightEvent, { k: "call" }>;
  assert.equal(p.code, "security.request.notAllowed");
  assert.match(p.what!, /^AgentZero can't pay 0x… from ….near\.$/);
  assert.equal((ev[0] as { code?: string }).code, undefined, "ok: no code");
  // the relay holds only ciphertext: no method name in the box, and it opens only for this trace
  assert.ok(!posts[0]!.body.includes("account"));
  assert.equal(openBatch(posts[0]!.body, readerKeys().secret, ID), null, "another reader's key: won't open");
  assert.equal(openBatch(posts[0]!.body, rig().secret, "f".repeat(32)), null, "another trace id: won't open");
});

test("a call that throws is noted by message (scrubbed) and still throws", async () => {
  const got: unknown[] = [];
  setFlightSink((n) => got.push(callEvent(n, 1)));
  try {
    const b = flightBridge({ call: async () => { throw new Error(`no key for ${SECRETS.to}`); }, on: () => () => {} });
    await assert.rejects(b.call("account.state"), /no key/);
  } finally {
    setFlightSink(null);
  }
  assert.deepEqual(got, [{ t: 1, k: "call", m: "account.state", ms: (got[0] as { ms: number }).ms, threw: "no key for 0x…" }]);
});

test("calls before the recorder starts are kept (the first 100) and handed over in order", async () => {
  setFlightSink(null);
  const b = flightBridge({ call: async () => ({ ok: 1 }) as never, on: () => () => {} });
  await b.call("account.id");
  await b.call("account.state");
  const got: string[] = [];
  setFlightSink((n) => got.push(n.method));
  setFlightSink(null);
  assert.deepEqual(got, ["account.id", "account.state"]);
});

const el = (attrs: Record<string, string>, text: string, extra: { tagName?: string; disabled?: boolean; field?: boolean; className?: string } = {}) => {
  const me = {
    tagName: extra.tagName ?? "BUTTON",
    className: extra.className ?? "",
    textContent: text,
    disabled: extra.disabled,
    getAttribute: (n: string) => attrs[n] ?? null,
    closest: (sel: string) => (extra.field ? (sel.startsWith("input") ? me : null) : sel.startsWith("input") ? null : me),
  };
  return me;
};

test("taps: the label (aria-label first) up to 40 characters; a recovery word or a keypad digit never; a field's value never", () => {
  assert.deepEqual(tapOf(el({}, "Fund $5"), 1), { t: 1, k: "tap", l: "Fund $5" });
  assert.deepEqual(tapOf(el({ "aria-label": "Back" }, "‹"), 1), { t: 1, k: "tap", l: "Back" }, "aria-label first");
  assert.deepEqual(tapOf(el({}, "Hold to send", { disabled: true }), 1), { t: 1, k: "tap", l: "Hold to send", dis: 1 }, "a disabled button: its tap is the cause");
  assert.equal((tapOf(el({}, "A very long label that goes on and on past forty characters"), 1) as { l: string }).l.length, 40);
  for (const word of ["abandon", "3. zoo", "abandon ability", " able "]) assert.equal((tapOf(el({}, word), 1) as { l: string }).l, "[word]", word);
  for (const key of ["1", "0", ".", "00"]) assert.equal((tapOf(el({}, key), 1) as { l: string }).l, "[key]", key);
  assert.equal((tapOf(el({}, `Copy ${SECRETS.to}`), 1) as { l: string }).l, "Copy 0x…");
  assert.equal((tapOf(el({}, "", { className: "zf-icon-btn af-menu" }), 1) as { l: string }).l, "button.zf-icon-btn", "no name: its tag and class");
  const field = el({ "aria-label": "Amount", value: SECRETS.amount }, SECRETS.amount, { tagName: "INPUT", field: true });
  const f = JSON.stringify(tapOf(field, 1));
  assert.ok(!f.includes(SECRETS.amount), "a field's value never");
  assert.match(f, /"field Amount"/);
  assert.equal(tapOf(null, 1), null);
});

test("scrub: addresses, keys, tokens, emails, NEAR names and a phrase go; plain words and dollars stay", () => {
  const s = scrub(`Send $5 to ${SECRETS.to}, ${SECRETS.account}, me@example.com, ${SECRETS.privateKey}, ${PHRASE}, https://api.example.com/v1/x?key=abc`, 400);
  for (const v of [SECRETS.to.slice(2, 12), "owner-secret", "me@example", "5Jq1x9Qw", "abandon", "key=abc"]) assert.ok(!s.includes(v), v);
  assert.match(s, /^Send \$5 to 0x…, ….near, @…, ed25519:…, \[words\], api\.example\.com\/…$/);
  assert.equal(scrub("Cannot read properties of undefined (reading 'x')", 160), "Cannot read properties of undefined (reading 'x')", "control: an ordinary message stays");
});

test("errors: the message and the first frame, no origin, no query", () => {
  const e = new Error(`boom ${SECRETS.to}`);
  e.stack = `Error: boom\n    at sendIt (https://zerofee.si/assets/index-Bx12.js?v=3:12:345)\n    at other (https://zerofee.si/assets/b.js:1:2)`;
  assert.deepEqual(errorOf(e, 1), { t: 1, k: "error", msg: "Error: boom 0x…", at: "sendIt index-Bx12.js:12:345" });
  assert.equal(firstFrame("sendIt@zerofee-app://app/assets/index.js:9:8\nx@y.js:1:1"), "sendIt index.js:9:8", "WebKit's form");
  assert.deepEqual(errorOf({ code: "core.locked", secret: SECRETS.phrase }, 1), { t: 1, k: "error", msg: "problem core.locked" }, "a Problem: its code only");
  assert.deepEqual(errorOf({ phrase: PHRASE }, 1), { t: 1, k: "error", msg: "[object]" }, "any other object: its type only");
});

test("batches: at 30 events (never sooner than 600 ms after the last), else on the tick; past 500 queued, dropped and counted", () => {
  let t = 1_000_000;
  const { rec, posts, opened } = rig(() => t);
  for (let i = 0; i < 29; i++) rec.push({ t, k: "long", ms: 201 });
  assert.equal(posts.length, 0);
  rec.push({ t, k: "long", ms: 201 });
  assert.equal(posts.length, 1, "the 30th sends at once");
  for (let i = 0; i < 30; i++) rec.push({ t, k: "long", ms: 202 });
  assert.equal(posts.length, 1, "control: not again within 600 ms");
  t += 600;
  rec.flush();
  assert.equal(posts.length, 2, "the tick sends it");
  t += 1;
  for (let i = 0; i < QUEUE_MAX + 25; i++) rec.push({ t, k: "vis", s: "visible" });
  assert.equal(rec.queued(), QUEUE_MAX);
  t += 600;
  rec.flush();
  const third = JSON.parse(opened()[2]!) as { seq: number; ev: FlightEvent[] };
  assert.equal(third.seq, 2);
  assert.deepEqual(third.ev[0], { t, k: "drop", n: 25 }, "the drops are said");
  assert.equal(third.ev.length, 101, "at most 100 events a batch, the rest on the next ticks");
  assert.ok(posts.every((p) => p.body.length <= 60_000));
});

test("the sealed batch: version 1, an ephemeral key, the id in its AAD; a tampered one won't open", () => {
  const { secret, publicKey } = readerKeys();
  const box = sealBatch("hello", readerKey(publicKey)!, ID);
  assert.equal(openBatch(box, secret, ID), "hello");
  assert.notEqual(sealBatch("hello", readerKey(publicKey)!, ID), box, "a fresh key and nonce each time");
  const flipped = box.slice(0, -2) + (box.at(-2) === "A" ? "B" : "A") + box.at(-1);
  assert.equal(openBatch(flipped, secret, ID), null);
  assert.throws(() => sealBatch("x", readerKey(publicKey)!, "nope"));
  assert.equal(readerKey("too-short"), null);
});

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("only the test builds: the public build (deploy-app.sh) never sets VITE_TEST_TRACE and clears it; the mount and the tap need the flag, the key and the id, and never the public build", () => {
  const sh = read("../../deploy-app.sh");
  assert.ok(!/VITE_TEST_TRACE[A-Z_]*=/.test(sh), "deploy-app.sh never sets it");
  assert.match(sh, /^unset VITE_TEST_TRACE VITE_TEST_TRACE_KEY VITE_TEST_TRACE_ID$/m, "and clears it from the shell");
  const gate = 'import.meta.env.VITE_TEST_TRACE === "1" && import.meta.env.VITE_ZEROFEE_PUBLIC !== "1" && !!import.meta.env.VITE_TEST_TRACE_KEY && !!import.meta.env.VITE_TEST_TRACE_ID';
  const main = read("../main.tsx");
  assert.ok(main.includes(`if (${gate}) {\n  void import("./shell/flight.ts")`), "main.tsx: a dynamic import behind the gate");
  assert.ok(!/^import .*flight/m.test(main), "control: never a static import");
  const core = read("../core.ts");
  assert.ok(core.includes(`export const shellBridge: Bridge = ${gate} ? flightBridge(shellOwn) : shellOwn;`), "core.ts: the one bridge wrapped behind the same gate");
});
