// Live push (D134 item 5): the SOL wallet's accountSubscribe and the ETH (RH) wallet's balance over one socket each. Fake
// sockets and a fake clock: no network. Every test has a control (the case that would fail without the rule it pins).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WS_HOSTS } from "../../../trade/src/market/ws-hosts.ts";
import { ANSWER_MS, BALANCE_EVERY_MS, BALANCE_LIVELY_MS, BALANCE_QUIET_MS, MAX_FAILS, PUSH_HOSTS, SILENT_MS, STAGGER_MS, STEADY_MS, TELL_EVERY_MS, startLivePush, type PushChain, type PushSocket } from "./live-push.ts";

const SOL = "J1aER9SnBgtnyeM1up78gqNuBk8Thq5UtAbU1rB65G7x";  // generated sample
const HOOD = "0x28C6c06298d514Db089934071355E5743bf21d60";

class FakeSocket implements PushSocket {
  sent: any[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  msg(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
  drop() {
    this.onclose?.({});
  }
}

function harness(addresses: { sol?: string; hood?: string }, o: { visible?: boolean } = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sockets: FakeSocket[] = [];
  const told: PushChain[] = [];
  let shown = o.visible ?? true;
  let visibility: (() => void) | null = null;
  const stop = startLivePush(addresses, (c) => told.push(c), {
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    random: () => 0.5,
    now: () => now,
    visible: () => shown,
    onVisibility: (cb) => {
      visibility = cb;
      return () => (visibility = null);
    },
  });
  /** Moves the clock, running each timer due on the way, in order. */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const of = (url: string) => sockets.filter((s) => s.url === url);
  const last = (url: string) => of(url).at(-1)!;
  const setShown = (v: boolean) => {
    shown = v;
    visibility?.();
  };
  return { stop, sockets, told, advance, of, last, timers, setShown };
}

const subscribed = (s: FakeSocket, id = 4242) => s.msg({ jsonrpc: "2.0", id: 1, result: id });
const note = (s: FakeSocket, lamports: number, sub = 4242) => s.msg({ jsonrpc: "2.0", method: "accountNotification", params: { subscription: sub, result: { context: { slot: 1 }, value: { lamports, data: ["", "base64"] } } } });
const balanceAsks = (s: FakeSocket) => s.sent.filter((m) => m.method === "eth_getBalance");
const answer = (s: FakeSocket, hex: string) => {
  const ask = balanceAsks(s).at(-1);
  s.msg({ jsonrpc: "2.0", id: ask.id, result: hex });
};

test("the hosts are the WS_HOSTS entries the phone's CSP allows; control: a host outside them is not one", () => {
  assert.ok(WS_HOSTS.sol.includes(PUSH_HOSTS.sol));
  assert.ok(WS_HOSTS.hood.includes(PUSH_HOSTS.hood));
  const buildWeb = readFileSync(fileURLToPath(new URL("../../../../apps/ios/build-web.sh", import.meta.url)), "utf8");
  const wss = /^WSS_HOSTS="([^"]*)"/m.exec(buildWeb)![1].split(" ");
  assert.ok(wss.includes(PUSH_HOSTS.sol) && wss.includes(PUSH_HOSTS.hood));
  assert.ok(!wss.includes("wss://solana-rpc.example.com"), "control");
});

test("SOL: a lamports change tells the page once; the same lamports again tells nothing; control: a second different figure tells again", () => {
  const h = harness({ sol: SOL });
  const s = h.last(PUSH_HOSTS.sol);
  s.open();
  assert.deepEqual(s.sent[0], { jsonrpc: "2.0", id: 1, method: "accountSubscribe", params: [SOL, { commitment: "confirmed", encoding: "base64" }] });
  subscribed(s);
  assert.deepEqual(h.told, [], "a first subscription is not a change (the page has just read the wallet)");
  note(s, 100);
  assert.deepEqual(h.told, ["sol"]);
  note(s, 100);
  assert.deepEqual(h.told, ["sol"], "the same lamports again: nothing");
  note(s, 150);
  assert.deepEqual(h.told, ["sol"], "a second change within TELL_EVERY_MS waits (review M3)");
  h.advance(TELL_EVERY_MS);
  assert.deepEqual(h.told, ["sol", "sol"], "control: a different figure is told, once its time comes");
  // junk is ignored: no lamports, a negative, not JSON
  note(s, -1);
  s.msg({ jsonrpc: "2.0", method: "accountNotification", params: { result: { value: {} } } });
  s.onmessage?.({ data: "{not json" });
  assert.deepEqual(h.told, ["sol", "sol"]);
  h.stop();
});

test("ETH (RH): at most one balance ask a second, never two waiting; a different balance tells; control: the same balance doesn't", () => {
  const h = harness({ hood: HOOD });
  const s = h.last(PUSH_HOSTS.hood);
  s.open();
  assert.equal(balanceAsks(s).length, 1, "asked at once on open");
  answer(s, "0x10");
  assert.deepEqual(h.told, [], "the first answer is where it starts");
  for (let i = 0; i < 9; i++) {
    h.advance(BALANCE_EVERY_MS);
    answer(s, "0x10");
  }
  assert.equal(balanceAsks(s).length, 10, "ten asks in nine seconds and the first: one a second");
  assert.deepEqual(h.told, [], "control: the same balance tells nothing");
  h.advance(BALANCE_EVERY_MS);
  answer(s, "0x11");
  assert.deepEqual(h.told, ["hood"]);
  // an ask unanswered: the next tick doesn't ask again
  h.advance(BALANCE_EVERY_MS);
  const n = balanceAsks(s).length;
  h.advance(BALANCE_EVERY_MS * 3);
  assert.equal(balanceAsks(s).length, n, "never a second ask while one waits");
  assert.ok(s.sent.every((m) => m.method === "eth_getBalance"), "nothing but the balance ask (no newHeads: ~16 KB/s on Robinhood Chain)");
  h.stop();
});

test("ETH (RH), HEAT-2026-11-03: once a second while lively, every 5 s once quiet a minute; a change or quicken() is once a second again", () => {
  const h = harness({ hood: HOOD });
  const s = h.last(PUSH_HOSTS.hood);
  s.open();
  const step = (ms: number) => { h.advance(ms); if (balanceAsks(s).length > answered) { answered = balanceAsks(s).length; answer(s, bal); } };
  let bal = "0x10", answered = 1;
  answer(s, bal);
  for (let t = 0; t < BALANCE_LIVELY_MS; t += BALANCE_EVERY_MS) step(BALANCE_EVERY_MS);
  const lively = balanceAsks(s).length;
  assert.ok(lively >= 60 && lively <= 62, `about one a second for the first minute (${lively})`);
  for (let t = 0; t < 60_000; t += BALANCE_EVERY_MS) step(BALANCE_EVERY_MS);
  const quiet = balanceAsks(s).length - lively;
  assert.ok(quiet >= 11 && quiet <= 13, `one in 5 s once quiet (${quiet} in a minute), never one a second`);
  // the balance changes: told, and once a second again
  bal = "0x11";
  for (let t = 0; t < BALANCE_QUIET_MS; t += BALANCE_EVERY_MS) step(BALANCE_EVERY_MS);
  assert.deepEqual(h.told, ["hood"]);
  const at = balanceAsks(s).length;
  for (let t = 0; t < 10_000; t += BALANCE_EVERY_MS) step(BALANCE_EVERY_MS);
  assert.ok(balanceAsks(s).length - at >= 9, "lively again after a change");
  // quiet again, then the page's own move (quicken): asked at once and once a second
  for (let t = 0; t < BALANCE_LIVELY_MS + 10_000; t += BALANCE_EVERY_MS) step(BALANCE_EVERY_MS);
  const before = balanceAsks(s).length;
  h.stop.quicken();
  assert.equal(balanceAsks(s).length, before + 1, "asked at once");
  answered++; answer(s, bal);
  for (let t = 0; t < 5_000; t += BALANCE_EVERY_MS) step(BALANCE_EVERY_MS);
  assert.ok(balanceAsks(s).length - before >= 5, "once a second after quicken");
  // control: quicken while lively changes nothing (no second chain of asks)
  const c = balanceAsks(s).length;
  h.stop.quicken();
  assert.equal(balanceAsks(s).length, c, "control: already lively, no extra ask");
  h.stop();
});

test("ETH (RH): an ask unanswered for ANSWER_MS replaces the socket; control: answered asks keep the one socket", () => {
  const h = harness({ hood: HOOD });
  const s = h.last(PUSH_HOSTS.hood);
  s.open();
  answer(s, "0x1");
  h.advance(BALANCE_EVERY_MS * 5);
  answer(s, "0x1");
  assert.equal(h.of(PUSH_HOSTS.hood).length, 1, "control");
  h.advance(ANSWER_MS + 2_000); // the ask at 6 s goes unanswered until 16 s, then the first wait (0.5 s)
  assert.ok(s.closed, "the dead socket is closed");
  assert.equal(h.of(PUSH_HOSTS.hood).length, 2, "and a new one made");
  h.stop();
});

test("a dropped socket reconnects after the back-off, subscribes again, and tells the page once; control: the first subscribe tells nothing", () => {
  const h = harness({ sol: SOL });
  const s1 = h.last(PUSH_HOSTS.sol);
  s1.open();
  subscribed(s1);
  assert.deepEqual(h.told, [], "control");
  s1.drop();
  assert.equal(h.of(PUSH_HOSTS.sol).length, 1, "not at once");
  h.advance(500); // the first wait, 0.5 s (jitter 0.5 → ×1)
  assert.equal(h.of(PUSH_HOSTS.sol).length, 2);
  const s2 = h.last(PUSH_HOSTS.sol);
  s2.open();
  assert.equal(s2.sent[0].method, "accountSubscribe");
  assert.equal(s2.sent[0].params[0], SOL);
  subscribed(s2, 99);
  assert.deepEqual(h.told, ["sol"], "a change while the line was down is caught");
  note(s2, 7, 4242);
  h.advance(TELL_EVERY_MS);
  assert.deepEqual(h.told, ["sol"], "a note for another subscription is not ours (review M3)");
  note(s2, 7, 99);
  h.advance(TELL_EVERY_MS);
  assert.deepEqual(h.told, ["sol", "sol"]);
  h.stop();
});

test("back-off grows 0.5 → 30 s and a line that never stays up rests until shown again; control: staying up STEADY_MS starts it over", () => {
  const h = harness({ sol: SOL });
  const waits: number[] = [];
  for (let i = 0; i < MAX_FAILS; i++) {
    const before = h.of(PUSH_HOSTS.sol).length;
    h.last(PUSH_HOSTS.sol).drop();
    let waited = 0;
    while (h.of(PUSH_HOSTS.sol).length === before && waited < 40_000) {
      h.advance(100);
      waited += 100;
    }
    waits.push(waited);
  }
  assert.deepEqual(waits, [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  // the last try fails too: it rests
  const n = h.of(PUSH_HOSTS.sol).length;
  h.last(PUSH_HOSTS.sol).drop();
  h.advance(60_000);
  assert.equal(h.of(PUSH_HOSTS.sol).length, n, "resting: no more tries");
  h.setShown(false);
  h.setShown(true);
  assert.equal(h.of(PUSH_HOSTS.sol).length, n + 1, "shown again, it tries again");
  // control: a socket that got through and stayed up STEADY_MS resets the count
  const s = h.last(PUSH_HOSTS.sol);
  s.open();
  subscribed(s);
  h.advance(STEADY_MS);
  s.msg({ jsonrpc: "2.0", id: 9, result: false });
  s.drop();
  h.advance(500);
  assert.equal(h.of(PUSH_HOSTS.sol).length, n + 2, "back to the first wait");
  h.stop();
});

test("review M3: a node that drops the line after each answer is tried about once in 30 s, and Spending is read at most once a minute (control: a steady line is never dropped)", () => {
  const h = harness({ sol: SOL });
  const start = h.sockets.length;
  // every socket opens, subscribes, and is dropped at once: for ten minutes
  let id = 1000;
  for (let t = 0; t < 600_000; t += 100) {
    const s = h.last(PUSH_HOSTS.sol);
    if (!s.closed && s.sent.length === 0) {
      s.open();
      subscribed(s, ++id);
      s.drop();
    }
    h.advance(100);
  }
  const made = h.sockets.length - start;
  assert.ok(made <= MAX_FAILS + 1, `${made} sockets in ten minutes (it was ~108 a minute), then it rests`);
  assert.ok(h.told.length <= 10, `${h.told.length} reads of Spending told in ten minutes (it was ~107 a minute)`);
  h.stop();
  // control: a steady line stays one socket
  const g = harness({ sol: SOL });
  const s = g.last(PUSH_HOSTS.sol);
  s.open();
  subscribed(s);
  for (let t = 0; t < 120_000; t += 20_000) {
    g.advance(20_000);
    s.msg({ jsonrpc: "2.0", id: 9, result: false }); // the heartbeat's answer
  }
  assert.equal(g.sockets.length, 1);
  g.stop();
});

test("a silent socket is replaced after SILENT_MS; control: the heartbeat's answers keep it", () => {
  const h = harness({ sol: SOL });
  const s = h.last(PUSH_HOSTS.sol);
  s.open();
  subscribed(s);
  // answered heartbeats: alive for minutes
  for (let t = 0; t < 180_000; t += 25_000) {
    h.advance(25_000);
    const beat = s.sent.at(-1);
    assert.equal(beat.method, "accountUnsubscribe", "the heartbeat names no address");
    assert.ok(!JSON.stringify(beat).includes(SOL));
    s.msg({ jsonrpc: "2.0", id: beat.id, error: { code: -32603, message: "Internal error", data: "subscription not found" } });
  }
  assert.equal(h.of(PUSH_HOSTS.sol).length, 1, "control: answered, it stays");
  // nothing answers any more
  h.advance(SILENT_MS + 1);
  assert.ok(s.closed);
  h.advance(600);
  assert.equal(h.of(PUSH_HOSTS.sol).length, 2, "replaced");
  h.stop();
});

test("one socket per address, and no message carries two of the person's addresses; control: each socket's messages name its own", () => {
  const h = harness({ sol: SOL, hood: HOOD });
  h.advance(STAGGER_MS); // the second line opens a moment after the first
  assert.deepEqual(h.sockets.map((s) => s.url).sort(), [PUSH_HOSTS.hood, PUSH_HOSTS.sol].sort());
  const sol = h.last(PUSH_HOSTS.sol), hood = h.last(PUSH_HOSTS.hood);
  sol.open();
  hood.open();
  subscribed(sol);
  answer(hood, "0x1");
  h.advance(30_000);
  for (const s of h.sockets) {
    for (const m of s.sent) {
      const text = JSON.stringify(m);
      assert.ok(!(text.includes(SOL) && text.toLowerCase().includes(HOOD.toLowerCase())), "never both");
    }
  }
  assert.ok(sol.sent.some((m) => JSON.stringify(m).includes(SOL)) && !sol.sent.some((m) => JSON.stringify(m).toLowerCase().includes(HOOD.toLowerCase())), "control: SOL's socket names only SOL");
  assert.ok(hood.sent.some((m) => JSON.stringify(m).includes(HOOD)) && !hood.sent.some((m) => JSON.stringify(m).includes(SOL)), "control: ETH (RH)'s names only its own");
  h.stop();
});

test("hidden: every socket closes; shown again: they reopen and the page is told once per wallet; control: no hide, no tell", () => {
  const h = harness({ sol: SOL, hood: HOOD });
  h.advance(STAGGER_MS); // the second line opens a moment after the first
  const sol = h.last(PUSH_HOSTS.sol), hood = h.last(PUSH_HOSTS.hood);
  sol.open();
  hood.open();
  subscribed(sol);
  answer(hood, "0x5");
  h.advance(5_000);
  assert.deepEqual(h.told, [], "control");
  h.setShown(false);
  assert.ok(sol.closed && hood.closed);
  h.advance(120_000);
  assert.equal(h.sockets.length, 2, "nothing opens while hidden");
  h.setShown(true);
  h.advance(STAGGER_MS);
  assert.deepEqual([...h.told].sort(), ["hood", "sol"]);
  const sol2 = h.last(PUSH_HOSTS.sol), hood2 = h.last(PUSH_HOSTS.hood);
  sol2.open();
  hood2.open();
  subscribed(sol2);
  answer(hood2, "0x9");
  assert.equal(h.told.length, 2, "told once each, not again by the reconnect or the new first balance");
  h.stop();
});

test("stop closes every socket and cancels every timer; nothing is told after it; control: before stop, a note is told", () => {
  const h = harness({ sol: SOL, hood: HOOD });
  h.advance(STAGGER_MS); // the second line opens a moment after the first
  const sol = h.last(PUSH_HOSTS.sol), hood = h.last(PUSH_HOSTS.hood);
  sol.open();
  hood.open();
  subscribed(sol);
  note(sol, 1);
  assert.deepEqual(h.told, ["sol"], "control");
  h.stop();
  assert.ok(sol.closed && hood.closed);
  assert.equal(h.timers.size, 0, "no timer left");
  note(sol, 2);
  h.advance(60_000);
  assert.deepEqual(h.told, ["sol"]);
  assert.equal(h.sockets.length, 2, "nothing reopens");
});

test("starting hidden opens nothing; a bad address opens nothing; control: a good one opens its socket", () => {
  const hidden = harness({ sol: SOL }, { visible: false });
  assert.equal(hidden.sockets.length, 0);
  hidden.stop();
  const bad = harness({ sol: "not-an-address", hood: "0x123" });
  assert.equal(bad.sockets.length, 0);
  bad.stop();
  const good = harness({ hood: HOOD });
  assert.equal(good.sockets.length, 1, "control");
  good.stop();
});

test("a socket maker that throws (a CSP that refuses it) never throws into the page and soon rests; control: none is made after it rests", () => {
  let made = 0;
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let seq = 0;
  const stop = startLivePush({ sol: SOL }, () => {}, {
    socket: () => {
      made++;
      throw new Error("refused by CSP");
    },
    setTimeout: (fn, ms) => (timers.set(++seq, { at: now + ms, fn }), seq),
    clearTimeout: (id) => void timers.delete(id as number),
    random: () => 0.5,
    visible: () => true,
    onVisibility: () => () => {},
  });
  for (let i = 0; i < 100 && timers.size; i++) {
    const [id, t] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    timers.delete(id);
    now = t.at;
    t.fn();
  }
  assert.ok(made <= 2, `made ${made}`);
  assert.equal(timers.size, 0, "control: resting, nothing scheduled");
  stop();
});

test("review L6: the SOL and ETH (RH) lines go to two operators and never open together (control: one wallet's line opens at once)", () => {
  assert.notEqual(new URL(PUSH_HOSTS.sol).host.split(".").slice(-2).join("."), new URL(PUSH_HOSTS.hood).host.split(".").slice(-2).join("."));
  const h = harness({ sol: SOL, hood: HOOD });
  assert.deepEqual(h.sockets.map((s) => s.url), [PUSH_HOSTS.sol], "the second waits");
  h.advance(STAGGER_MS);
  assert.equal(h.sockets.length, 2);
  h.stop();
  const one = harness({ hood: HOOD });
  assert.deepEqual(one.sockets.map((s) => s.url), [PUSH_HOSTS.hood], "control: a single line opens at once");
  one.stop();
});
