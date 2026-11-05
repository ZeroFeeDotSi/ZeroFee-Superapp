// The chains' live-feed sockets (hub.ts), on test sockets and node:test's mock clock. First Security's rules of 27 Oct 2026:
// WS_HOSTS only, subscriptions only and no key, frames under 64 KB, a capped retry wait, a hidden page's socket closed at
// once. Then how followers share a socket; those cases are the ones wallet V1 proved (its hub tests at 52d44eb), rewritten.
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ACK_TIMEOUT_MS, allowedOrigin, BACKOFF_MS, browserWs, ChainSocket, closeAllSockets, CONNECT_TIMEOUT_MS, FEED_HOSTS, IDLE_CLOSE_MS, MAX_MSG_BYTES, parseMessage, socketFor, SUB_METHODS, type Listener, type Subscription } from "./hub.ts";
import { WS_HOSTS } from "./ws-hosts.ts";
import { socketMaker, type TestSocket } from "./testing.ts";
import type { ChainId } from "../types.ts";

const VIBE = WS_HOSTS.sol.find((u) => u.includes("solanavibestation"))!;
const PUBLIC = WS_HOSTS.sol.find((u) => u.includes("publicnode"))!;
const SLOTS: Subscription = { tag: "beat", method: "slotSubscribe", params: [] };
const logsOf = (pool: string): Subscription => ({ tag: "swaps", method: "logsSubscribe", params: [{ mentions: [pool] }, { commitment: "confirmed" }] });

interface Heard { got: [string, unknown][]; ups: boolean[] }
function follower(wants: Subscription[]): Listener & Heard {
  const got: [string, unknown][] = [], ups: boolean[] = [];
  return { wants, beatTag: "beat", deliver: (tag, r) => { got.push([tag, r]); }, status: (up) => { ups.push(up); }, got, ups };
}
function clock(t: TestContext): void { t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 5_000_000 }); }
/** The mock clock runs what falls due only at the end of one tick, so a timer set by a timer needs the clock moved in steps. */
function wait(t: TestContext, ms: number, step = 100): void { for (let done = 0; done < ms; done += step) t.mock.timers.tick(Math.min(step, ms - done)); }
function solSocket(made: TestSocket[], hosts: readonly string[] = [VIBE, PUBLIC], random = () => 0.5): ChainSocket {
  return new ChainSocket("sol", hosts, socketMaker(made), { now: () => Date.now(), random });
}
const beat = (s: TestSocket) => s.push(s.idFor((r) => r.method === "slotSubscribe"), { slot: 9 });
const goLive = (s: TestSocket) => { s.accept(); s.confirm(); beat(s); };

describe("Security rule 1: hosts", () => {
  it("only a WS_HOSTS entry of the same chain, as written, over wss, is allowed", () => {
    const chains = Object.keys(WS_HOSTS) as ChainId[];
    for (const chain of chains) {
      for (const host of WS_HOSTS[chain]) {
        assert.ok(allowedOrigin(chain, host), host);
        for (const other of chains) if (other !== chain && !WS_HOSTS[other].includes(host)) assert.equal(allowedOrigin(other, host), false, `${host} on ${other}`);
        const name = host.replace("wss://", "");
        const lookalikes = [`ws://${name}`, `https://${name}`, `${host}/`, `${host}/ws`, `${host}?api-key=abc`, `${host}/?token=1`, `${host}:443`,
          `wss://${name}.evil.example`, `wss://evil.example/${name}`, `wss://user:pw@${name}`, host.toUpperCase(), ` ${host}`, `${host} `];
        for (const u of lookalikes) assert.equal(allowedOrigin(chain, u), false, u);
      }
    }
    assert.equal(allowedOrigin("sol", ""), false);
    assert.equal(allowedOrigin("sol", null as unknown as string), false);
    assert.equal(allowedOrigin("sol", "ws://x.example", { sol: ["ws://x.example"], bsc: [], hood: [] }), false, "a ws:// entry would not pass either");
  });
  it("handed a list with lookalikes, a socket only ever dials the allowed entry, through every retry", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made, ["wss://evil.example", `ws://${VIBE.slice(6)}`, `${VIBE}/?api-key=abc`, `${VIBE}:443`, WS_HOSTS.bsc[0]!, VIBE]);
    s.join(follower([logsOf("POOL"), SLOTS]));
    for (let i = 0; i < 10; i++) { made.at(-1)!.hangUp(); t.mock.timers.tick(15_000); }
    assert.ok(made.length > 10);
    assert.deepEqual([...new Set(made.map((m) => m.url))], [VIBE]);
    s.destroy();
  });
  it("with no allowed entry at all, no socket is ever made", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made, ["wss://evil.example", "ws://solana-rpc.publicnode.com", WS_HOSTS.hood[0]!]);
    s.join(follower([logsOf("POOL"), SLOTS]));
    t.mock.timers.tick(300_000);
    assert.equal(made.length, 0);
    s.destroy();
  });
  it("the app's shared sockets dial FEED_HOSTS, each a WS_HOSTS entry of its chain; Solana's is the node that delivers logs", (t) => {
    clock(t);
    for (const chain of Object.keys(WS_HOSTS) as ChainId[]) {
      assert.ok(FEED_HOSTS[chain].length > 0);
      for (const h of FEED_HOSTS[chain]) assert.ok(WS_HOSTS[chain].includes(h), h);
      const made: TestSocket[] = [];
      socketFor(chain, socketMaker(made), { now: () => Date.now() }).join(follower([SLOTS]));
      assert.deepEqual(made.map((m) => m.url), [FEED_HOSTS[chain][0]]);
    }
    assert.deepEqual(FEED_HOSTS.sol, [VIBE]);
    closeAllSockets();
  });
  it("the page's own socket maker refuses anything outside WS_HOSTS, and there is none without a page", () => {
    const g = globalThis as Record<string, unknown>;
    const before = { WebSocket: g.WebSocket, document: g.document };
    const dialled: string[] = [];
    try {
      g.WebSocket = class { constructor(u: string) { dialled.push(u); } };
      delete g.document;
      assert.equal(browserWs(), undefined);
      g.document = {};
      const make = browserWs()!;
      make(VIBE);
      make(WS_HOSTS.hood[0]!);
      for (const bad of ["wss://evil.example", `${VIBE}?api-key=1`, `ws://${VIBE.slice(6)}`]) assert.throws(() => make(bad), bad);
      assert.deepEqual(dialled, [VIBE, WS_HOSTS.hood[0]]);
    } finally {
      for (const k of ["WebSocket", "document"] as const) { if (before[k] === undefined) delete g[k]; else g[k] = before[k]; }
    }
  });
});

describe("Security rule 1: what is sent", () => {
  it("exactly the subscriptions asked for, first; a method that isn't one never leaves", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    s.join(follower([logsOf("POOL"), { tag: "x", method: "eth_sendRawTransaction", params: ["0x02f8"] }, { tag: "y", method: "getAccountInfo", params: ["POOL"] }, SLOTS]));
    goLive(made[0]!);
    assert.deepEqual(made[0]!.frames, [
      '{"jsonrpc":"2.0","id":1,"method":"logsSubscribe","params":[{"mentions":["POOL"]},{"commitment":"confirmed"}]}',
      '{"jsonrpc":"2.0","id":2,"method":"slotSubscribe","params":[]}',
    ]);
    assert.equal(s.isUp(), true);
    s.destroy();
  });
  it("over a reconnect and a leave, every frame is a numbered JSON-RPC 2.0 subscribe or unsubscribe, with no key in it", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    const leave = s.join(follower([logsOf("POOL"), SLOTS]));
    goLive(made[0]!);
    made[0]!.hangUp(); t.mock.timers.tick(1_000); goLive(made[1]!);
    leave(true);
    const allowed = new Set([...Object.keys(SUB_METHODS), ...Object.values(SUB_METHODS)]);
    for (const m of made) {
      m.requests.forEach((r, i) => {
        assert.equal(r.jsonrpc, "2.0"); assert.ok(Number.isInteger(r.id)); assert.ok(allowed.has(r.method), r.method);
        assert.doesNotMatch(m.frames[i]!, /key|token|secret|auth|bearer/i);
      });
    }
    assert.ok(made[1]!.requests.some((r) => r.method === "logsUnsubscribe"));
  });
  it("a confirmation whose id isn't a small number or short hex is a refusal: the socket goes, and nothing of it is sent back", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made, [VIBE]);
    const leave = s.join(follower([logsOf("POOL"), SLOTS]));
    made[0]!.accept();
    made[0]!.deliver({ jsonrpc: "2.0", id: 1, result: "<img src=x onerror=alert(1)>" });
    assert.equal(made[0]!.closed, true);
    leave(true);
    assert.ok(made.every((m) => m.frames.every((f) => !f.includes("img"))));
  });
});

describe("Security rule 3: what is read", () => {
  it("parseMessage takes a JSON object of at most 64 KB of UTF-8, and nothing else", () => {
    const sized = (bytes: number) => { const open = '{"k":"', end = '"}'; return open + "a".repeat(bytes - open.length - end.length) + end; };
    assert.equal(MAX_MSG_BYTES, 64 * 1024);
    assert.ok(parseMessage(sized(MAX_MSG_BYTES)));
    assert.equal(parseMessage(sized(MAX_MSG_BYTES + 1)), undefined);
    const twoByte = '{"k":"' + "ß".repeat(40_000) + '"}';             // 40 k characters, 80 KB
    assert.ok(twoByte.length < MAX_MSG_BYTES);
    assert.equal(parseMessage(twoByte), undefined);
    assert.ok(parseMessage('{"k":"' + "ß".repeat(30_000) + '"}'));
    for (const v of ["{oops", "[1]", "null", "7", '"text"', new Uint8Array([123, 125]), new ArrayBuffer(4), { k: 1 }, undefined]) assert.equal(parseMessage(v), undefined, String(v));
  });
  it("an oversized notification, a binary frame and broken JSON reach no follower and don't cost the socket; a normal one does", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const f = follower([logsOf("POOL"), SLOTS]);
    const s = solSocket(made);
    s.join(f);
    goLive(made[0]!);
    const id = made[0]!.idFor((r) => r.method === "logsSubscribe");
    made[0]!.push(id, { value: { signature: "S", logs: ["a".repeat(MAX_MSG_BYTES)] } });
    made[0]!.deliver(new Uint8Array(16));
    made[0]!.deliver("{oops");
    assert.equal(f.got.filter(([tag]) => tag === "swaps").length, 0);
    made[0]!.push(id, { value: { signature: "S", logs: ["a".repeat(500)] } });
    assert.equal(f.got.filter(([tag]) => tag === "swaps").length, 1);
    assert.equal(made[0]!.closed, false);
    s.destroy();
  });
});

describe("Security rule 4: retries back off to a cap", () => {
  const madeAfter = (t: TestContext, made: TestSocket[], ms: number): boolean => { const n = made.length; t.mock.timers.tick(ms); return made.length > n; };
  it("with the jitter at its middle: 0.5, 1, 2, 4, 8 s and then 8 s each time", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made, [VIBE]);
    s.join(follower([logsOf("POOL"), SLOTS]));
    goLive(made[0]!);
    for (const ms of [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000]) {
      made.at(-1)!.hangUp();
      assert.equal(madeAfter(t, made, ms - 1), false, `waits ${ms} ms`);
      assert.equal(madeAfter(t, made, 1), true, `then dials, at ${ms} ms`);
    }
    assert.deepEqual([...BACKOFF_MS], [500, 1000, 2000, 4000, 8000]);
    s.destroy();
  });
  it("the jitter stays within +-25 % (no wait over 10 s), and a socket that held 5 s starts the waits over", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const high = solSocket([], [VIBE], () => 1), low = solSocket([], [VIBE], () => 0);
    for (let n = 0; n < 20; n++) assert.ok(high.backoff(n) <= 10_000 && low.backoff(n) >= 375, String(n));
    assert.equal(high.backoff(99), 10_000);
    const s = solSocket(made, [VIBE]);
    s.join(follower([logsOf("POOL"), SLOTS]));
    for (let i = 0; i < 5; i++) { goLive(made.at(-1)!); made.at(-1)!.hangUp(); t.mock.timers.tick(10_000); }
    goLive(made.at(-1)!);
    t.mock.timers.tick(5_001);
    made.at(-1)!.hangUp();
    assert.equal(madeAfter(t, made, 500), true);
    s.destroy();
  });
});

describe("Security rule 4: leaving", () => {
  it("the last follower leaving at once (a hidden page) closes the socket now and nothing redials; leaving normally closes it IDLE_CLOSE_MS later", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    const first = s.join(follower([logsOf("POOL"), SLOTS]));
    goLive(made[0]!);
    first(true);
    assert.equal(made[0]!.closed, true);
    assert.equal(s.holdsSocket(), false);
    t.mock.timers.tick(120_000);
    assert.equal(made.length, 1);
    const second = s.join(follower([logsOf("POOL"), SLOTS]));
    goLive(made[1]!);
    second();
    t.mock.timers.tick(IDLE_CLOSE_MS - 1);
    assert.equal(made[1]!.closed, false);
    t.mock.timers.tick(1);
    assert.equal(made[1]!.closed, true);
    s.destroy();
  });
});

describe("sharing a chain's socket", () => {
  it("three followers, two on the same pool: one socket, one subscription per pool, one beat, and each told what it asked for", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    const a = follower([logsOf("A"), SLOTS]), b = follower([logsOf("A"), SLOTS]), c = follower([logsOf("C"), SLOTS]);
    s.join(a); s.join(b); s.join(c);
    assert.equal(made.length, 1);
    made[0]!.accept();
    assert.deepEqual(made[0]!.requests.map((r) => r.method).sort(), ["logsSubscribe", "logsSubscribe", "slotSubscribe"]);
    made[0]!.confirm();
    const on = (pool: string) => made[0]!.idFor((r) => JSON.stringify(r.params).includes(`"${pool}"`));
    made[0]!.push(on("A"), "swap in A");
    made[0]!.push(on("C"), "swap in C");
    assert.deepEqual(a.got, [["swaps", "swap in A"]]);
    assert.deepEqual(b.got, [["swaps", "swap in A"]]);
    assert.deepEqual(c.got, [["swaps", "swap in C"]]);
    s.destroy();
  });
  it("confirmed is not yet up: the first beat is", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    const f = follower([logsOf("A"), SLOTS]);
    s.join(f);
    made[0]!.accept(); made[0]!.confirm();
    assert.equal(f.ups.at(-1), false);
    beat(made[0]!);
    assert.equal(f.ups.at(-1), true);
    s.destroy();
  });
  it("a late follower's new pool is asked on the open socket; a pool is cancelled on the node only when its last follower goes", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    const one = s.join(follower([logsOf("A"), SLOTS]));
    made[0]!.accept(); made[0]!.confirm();
    const sentBefore = made[0]!.frames.length;
    const two = s.join(follower([logsOf("A"), SLOTS]));
    const three = s.join(follower([logsOf("C"), SLOTS]));
    assert.equal(made[0]!.frames.length - sentBefore, 1, "only C is new to the node");
    const cancels = () => made[0]!.requests.filter((r) => r.method === "logsUnsubscribe").length;
    one();
    assert.equal(cancels(), 0, "A is still followed");
    two();
    assert.equal(cancels(), 1);
    three();
    s.destroy();
  });
  it("switching coins within IDLE_CLOSE_MS keeps the socket", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    const leaveA = s.join(follower([logsOf("A"), SLOTS]));
    goLive(made[0]!);
    leaveA();
    t.mock.timers.tick(2_000);
    const leaveB = s.join(follower([logsOf("B"), SLOTS]));
    t.mock.timers.tick(10_000);
    assert.deepEqual([made.length, made[0]!.closed], [1, false]);
    leaveB();
    t.mock.timers.tick(IDLE_CLOSE_MS);
    assert.equal(made[0]!.closed, true);
    s.destroy();
  });
  it("a new socket after a drop is asked for every follower's subscriptions again", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    const f = follower([logsOf("A"), SLOTS]);
    s.join(f); s.join(follower([logsOf("B"), SLOTS]));
    goLive(made[0]!);
    made[0]!.hangUp();
    assert.equal(f.ups.at(-1), false);
    t.mock.timers.tick(700);
    assert.equal(made.length, 2);
    made[1]!.accept();
    assert.deepEqual(made[1]!.requests.map((r) => r.method).sort(), ["logsSubscribe", "logsSubscribe", "slotSubscribe"]);
    s.destroy();
  });
  it("a slow handshake gets CONNECT_TIMEOUT_MS before the other host is dialled", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    s.join(follower([logsOf("A"), SLOTS]));
    wait(t, CONNECT_TIMEOUT_MS - 100);
    assert.equal(made.length, 1);
    wait(t, 200);
    assert.deepEqual(made.map((m) => m.url), [VIBE, PUBLIC]);
    s.destroy();
  });
  it("a host that never confirms, one that refuses, and one that confirms but never beats are each dropped for the next", (t) => {
    clock(t);
    const made: TestSocket[] = [];
    const s = solSocket(made);
    s.join(follower([logsOf("A"), SLOTS]));
    made[0]!.accept();
    wait(t, ACK_TIMEOUT_MS + 1_200);
    assert.equal(made.at(-1)!.url, PUBLIC, "the silent host is rested");
    const refusing = made.at(-1)!;
    refusing.accept();
    refusing.deliver({ jsonrpc: "2.0", id: refusing.requests[0]!.id, error: { code: -32601, message: "method is not available on free plan" } });
    assert.equal(refusing.closed, true);
    wait(t, 3_000);
    const mute = made.at(-1)!;
    assert.notEqual(mute, refusing);
    mute.accept(); mute.confirm();
    wait(t, ACK_TIMEOUT_MS + 100);
    assert.equal(mute.closed, true);
    s.destroy();
  });
});
