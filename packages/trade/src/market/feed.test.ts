// One pool's line (feed.ts) on test sockets and the mock clock. The behaviour is wallet V1's, proven in its feed tests
// (52d44eb): live on the first beat, a dropped socket redialled, the nodes polled when the socket stays down and no more
// once it is back, a quiet socket dropped and never shown live, a stop that is final. Trade adds: polling 3 s into a start
// with no socket, a quiet line polled at once, and a hidden page holding no socket and asking no node (Security rule 4).
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { CHECK_EVERY_MS, openFeed, POLL_AFTER_DROP_MS, POLL_AFTER_START_MS, type FeedConfig, type FeedState } from "./feed.ts";
import { ACK_TIMEOUT_MS, closeAllSockets } from "./hub.ts";
import { WS_HOSTS } from "./ws-hosts.ts";
import { socketMaker, type TestSocket } from "./testing.ts";

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)); };
/** Moves the mock clock in 100 ms steps, letting each polling round's promise settle. */
async function pass(t: TestContext, ms: number): Promise<void> { for (let done = 0; done < ms; done += 100) { t.mock.timers.tick(Math.min(100, ms - done)); await settle(); } }

interface World { made: TestSocket[]; states: FeedState[]; heard: unknown[]; rounds: number; nodesDown: boolean; hidden: boolean; cfg: FeedConfig }
function world(t: TestContext): World {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 9_000_000 });
  closeAllSockets();
  t.after(() => closeAllSockets());
  const w = { made: [], states: [], heard: [], rounds: 0, nodesDown: false, hidden: false } as unknown as World;
  w.cfg = {
    chain: "sol", make: socketMaker(w.made),
    wants: [{ tag: "swaps", method: "logsSubscribe", params: [{ mentions: ["POOL"] }, { commitment: "confirmed" }] }, { tag: "beat", method: "slotSubscribe", params: [] }],
    beatTag: "beat", staleMs: 6_000,
    onMessage: (tag, r) => { if (tag === "swaps") w.heard.push(r); },
    poll: async () => { w.rounds++; if (w.nodesDown) throw new Error("no node answered"); w.heard.push("from a poll"); },
    pollEveryMs: 1_500,
    paused: () => w.hidden,
    onState: (s) => w.states.push(s),
    now: () => Date.now(), random: () => 0.5,
  };
  return w;
}
const beat = (s: TestSocket) => s.push(s.idFor((r) => r.method === "slotSubscribe"), { slot: 3 });
const goLive = (s: TestSocket) => { s.accept(); s.confirm(); beat(s); };
const last = (w: World) => w.states.at(-1)!;
/** Every redial fails too, for `ms`. */
async function stayDown(t: TestContext, w: World, ms: number): Promise<void> { for (let done = 0; done < ms; done += 500) { await pass(t, 500); w.made.at(-1)!.hangUp(); } }

describe("a pool's line", () => {
  it("dials the chain's feed host, asks for the pool's logs and slots, is live on the first slot, hands on what arrives; stopping cancels and the socket idles shut", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    assert.deepEqual(w.made.map((m) => m.url), [WS_HOSTS.sol.find((u) => u.includes("solanavibestation"))]);
    goLive(w.made[0]!);
    assert.deepEqual(w.made[0]!.requests.map((r) => r.method), ["logsSubscribe", "slotSubscribe"]);
    assert.deepEqual(last(w), { state: "live", via: "ws" });
    w.made[0]!.push(w.made[0]!.idFor((r) => r.method === "logsSubscribe"), { value: { signature: "SIG" } });
    assert.deepEqual(w.heard, [{ value: { signature: "SIG" } }]);
    feed.stop();
    assert.ok(w.made[0]!.requests.some((r) => r.method === "logsUnsubscribe"));
    await pass(t, 5_100);
    assert.equal(w.made[0]!.closed, true);
  });
  it("a socket that drops is redialled after the first wait and is live again, with no reload", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    goLive(w.made[0]!);
    w.made[0]!.hangUp();
    assert.equal(last(w).state, "reconnecting");
    await pass(t, 700);
    assert.equal(w.made.length, 2);
    goLive(w.made[1]!);
    assert.deepEqual(last(w), { state: "live", via: "ws" });
    feed.stop();
  });
  it("down past POLL_AFTER_DROP_MS: the nodes are polled and it says so; the socket back stops the polling", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    goLive(w.made[0]!);
    w.made[0]!.hangUp();
    await stayDown(t, w, POLL_AFTER_DROP_MS + 10_000);
    assert.ok(w.rounds > 0);
    assert.deepEqual(last(w), { state: "polling", via: "poll" });
    assert.ok(w.heard.includes("from a poll"));
    for (let i = 0; i < 30 && w.made.at(-1)!.closed; i++) await pass(t, 500);
    goLive(w.made.at(-1)!);
    assert.deepEqual(last(w), { state: "live", via: "ws" });
    await settle();
    const rounds = w.rounds;
    await pass(t, 4_000);
    assert.equal(w.rounds, rounds);
    feed.stop();
  });
  it("a host that confirms and never sends a slot is dropped, and another socket is made", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    w.made[0]!.accept(); w.made[0]!.confirm();
    await pass(t, ACK_TIMEOUT_MS + 100);
    assert.equal(w.made[0]!.closed, true);
    await pass(t, 2_000);
    assert.ok(w.made.length >= 2);
    feed.stop();
  });
  it("a live line with no slot for staleMs goes stale, never stays live, drops its socket and asks the nodes straight away", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    goLive(w.made[0]!);
    await pass(t, 6_000 + CHECK_EVERY_MS);
    assert.ok(w.states.some((s) => s.state === "stale"));
    assert.notEqual(last(w).state, "live");
    assert.equal(w.made[0]!.closed, true);
    assert.ok(w.rounds >= 1, "not another 10 s later");
    feed.stop();
  });
  it("with the nodes failing too, it ends stale, not live", async (t) => {
    const w = world(t);
    w.nodesDown = true;
    const feed = openFeed(w.cfg);
    goLive(w.made[0]!);
    w.made[0]!.hangUp();
    await stayDown(t, w, 22_000);
    assert.equal(last(w).state, "stale");
    feed.stop();
  });
  it("after stop() nothing more happens: no state, no redial, no poll", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    goLive(w.made[0]!);
    feed.stop();
    const told = w.states.length;
    await pass(t, 30_000);
    assert.equal(w.made[0]!.closed, true);
    assert.deepEqual([w.states.length, w.made.length, w.rounds], [told, 1, 0]);
  });
});

describe("Trade's own: the start and a hidden page", () => {
  it("a start whose socket never comes up is polled POLL_AFTER_START_MS in, well before the drop grace", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    await pass(t, POLL_AFTER_START_MS);
    assert.equal(w.rounds, 0);
    await pass(t, CHECK_EVERY_MS + 100);
    assert.equal(w.rounds, 1);
    assert.ok(POLL_AFTER_START_MS < POLL_AFTER_DROP_MS);
    feed.stop();
  });
  it("hidden from the start: no socket and no round; visible: the socket", async (t) => {
    const w = world(t);
    w.hidden = true;
    const feed = openFeed(w.cfg);
    await pass(t, 30_000);
    assert.deepEqual([w.made.length, w.rounds, feed.state().state], [0, 0, "paused"]);
    w.hidden = false;
    await pass(t, CHECK_EVERY_MS);
    assert.equal(w.made.length, 1);
    goLive(w.made[0]!);
    assert.equal(feed.state().state, "live");
    feed.stop();
  });
  it("hidden while polling: the socket (the chain's last) closes now, the rounds stop, nothing is asked; visible again: a new socket", async (t) => {
    const w = world(t);
    const feed = openFeed(w.cfg);
    goLive(w.made[0]!);
    w.made[0]!.hangUp();
    await stayDown(t, w, 13_000);
    assert.equal(feed.state().state, "polling");
    w.hidden = true;
    await pass(t, CHECK_EVERY_MS);
    assert.ok(w.made.every((m) => m.closed));
    const [sockets, rounds] = [w.made.length, w.rounds];
    await pass(t, 60_000);
    assert.deepEqual([w.made.length, w.rounds], [sockets, rounds]);
    w.hidden = false;
    await pass(t, CHECK_EVERY_MS);
    assert.equal(w.made.length, sockets + 1);
    goLive(w.made.at(-1)!);
    assert.equal(feed.state().state, "live");
    feed.stop();
  });
  it("the page's visibilitychange closes the socket as it happens, before the next check", (t) => {
    const g = globalThis as Record<string, unknown>;
    const handlers: (() => void)[] = [];
    g.document = { addEventListener: (_: string, h: () => void) => { handlers.push(h); }, removeEventListener: () => undefined };
    try {
      const w = world(t);
      const feed = openFeed(w.cfg);
      goLive(w.made[0]!);
      w.hidden = true;
      handlers.forEach((h) => h());
      assert.equal(w.made[0]!.closed, true);
      feed.stop();
    } finally { delete g.document; }
  });
});
