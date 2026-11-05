import { test } from "node:test";
import assert from "node:assert/strict";
import { createOverlayQueue, type Overlay } from "./overlay-queue.ts";

const problem = (code: string): Overlay => ({ kind: "problem", problem: { code, whatHappened: code, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } });
const retry = { kind: "retry" as const, label: "Try again" };
const ok = { kind: "nothing" as const, label: "OK" };

test("each app has its own first-in, first-out line", async () => {
  const q = createOverlayQueue();
  const first = q.push("pay", problem("pay.one"));
  const second = q.push("pay", problem("pay.two"));
  const other = q.push("trade", problem("trade.one"));
  assert.equal(q.count("pay"), 2);
  assert.equal(q.count("trade"), 1);
  assert.equal(q.count("wallet"), 0);
  assert.deepEqual(q.first("pay"), problem("pay.one"));
  assert.deepEqual(q.first("trade"), problem("trade.one"));
  assert.equal(q.first("wallet"), undefined);

  assert.equal(q.finish("pay", retry), true);
  assert.deepEqual(await first, retry);
  // The second is still waiting, now first in line; Trade's was never touched.
  assert.deepEqual(q.first("pay"), problem("pay.two"));
  assert.deepEqual(q.first("trade"), problem("trade.one"));

  assert.equal(q.finish("pay", ok), true);
  assert.deepEqual(await second, ok);
  assert.equal(q.first("pay"), undefined);
  assert.equal(q.count("pay"), 0);

  assert.equal(q.finish("trade", ok), true);
  assert.deepEqual(await other, ok);
});

test("every Problem resolves its own promise, even when many were queued at once", async () => {
  const q = createOverlayQueue();
  const steps = Array.from({ length: 5 }, (_, i) => ({ kind: "nothing" as const, label: `step ${i}` }));
  const promises = steps.map((_, i) => q.push("wallet", problem(`wallet.${i}`)));
  for (const step of steps) assert.equal(q.finish("wallet", step), true);
  assert.deepEqual(await Promise.all(promises), steps);
});

test("finishing an app with nothing showing is a no-op", () => {
  const q = createOverlayQueue();
  assert.equal(q.finish("pay", ok), false);
  assert.equal(q.first("pay"), undefined);
});

test("a Waiting screen lines up like a Problem and never replaces the one showing", () => {
  const q = createOverlayQueue();
  const held = { id: "held-1", readyAtIso: "2026-01-01T00:00:00.000Z", needsSecondDevice: false };
  void q.push("earn", problem("earn.one"));
  void q.push("earn", { kind: "waiting", held });
  void q.push("earn", { kind: "waiting", held: { ...held, id: "held-2" } });
  assert.deepEqual(q.first("earn"), problem("earn.one"));
  q.finish("earn", ok);
  assert.deepEqual(q.first("earn"), { kind: "waiting", held });
  q.finish("earn", ok);
  assert.equal((q.first("earn") as { held: { id: string } }).held.id, "held-2");
});

test("QA (4 Nov): the same Problem asked again while it's lined up is one screen: one Back leaves it, and every asker hears the step", async () => {
  const q = createOverlayQueue();
  const price = (): Overlay => ({ kind: "problem", problem: { code: "security.partner.unreachable", whatHappened: "Solana's price isn't read yet. Nothing moved.", money: { state: "not-involved" }, next: retry } });
  const asks = [q.push("wallet", price()), q.push("wallet", price()), q.push("wallet", price())];
  assert.equal(q.count("wallet"), 1, "three holds, one screen");
  assert.equal(q.finish("wallet", ok), true);
  assert.deepEqual(await Promise.all(asks), [ok, ok, ok]);
  assert.equal(q.first("wallet"), undefined, "Back left it: nothing behind it");
  // control: a different Problem still lines up behind the one showing
  void q.push("wallet", problem("wallet.a"));
  void q.push("wallet", problem("wallet.b"));
  assert.equal(q.count("wallet"), 2);
});
